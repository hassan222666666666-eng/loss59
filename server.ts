import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  LEFT_HALF_SLICE,
  RIGHT_HALF_SLICE,
  mergeDuplicateShortages,
  remapHalfBoxToFullPhoto,
  HalfSlice,
} from './src/modules/analysis/boxMerge';
import { AnalyzedShortageRaw, NormalizedBox } from './src/types';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_URL_REGEX = /^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/;

function clampBox(raw: unknown, fallback: NormalizedBox): NormalizedBox {
  if (!raw || typeof raw !== 'object') return fallback;
  const r = raw as Record<string, unknown>;
  let x = Number(r.x);
  let y = Number(r.y);
  let w = Number(r.w);
  let h = Number(r.h);

  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(w) ||
    !Number.isFinite(h)
  ) {
    return fallback;
  }

  if (x > 1 || y > 1 || w > 1 || h > 1) {
    if (x <= 1000 && y <= 1000 && w <= 1000 && h <= 1000) {
      x /= 1000;
      y /= 1000;
      w /= 1000;
      h /= 1000;
    }
  }

  x = Math.max(0, Math.min(0.98, x));
  y = Math.max(0, Math.min(0.98, y));
  w = Math.max(0.02, Math.min(1 - x, w));
  h = Math.max(0.02, Math.min(1 - y, h));

  return {
    x: Math.round(x * 10000) / 10000,
    y: Math.round(y * 10000) / 10000,
    w: Math.round(w * 10000) / 10000,
    h: Math.round(h * 10000) / 10000,
  };
}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  app.use(express.json({ limit: '50mb' }));

  const apiKey = process.env.GEMINI_API_KEY;
  const ai = apiKey
    ? new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      })
    : null;

  const PRIMARY_MODEL = 'gemini-4-hydrogen';
  const FALLBACK_MODEL = 'gemini-3.1-flash-lite';

  async function generateWithFallback(
    parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>,
    responseSchema: Record<string, unknown>,
    useHighThinking: boolean
  ): Promise<string> {
    const callModel = async (model: string, timeoutMs: number) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const isPrimary = model === PRIMARY_MODEL;
        return await ai!.models.generateContent({
          model,
          contents: { parts },
          config: {
            abortSignal: controller.signal,
            thinkingConfig: {
              thinkingLevel:
                isPrimary && useHighThinking
                  ? ThinkingLevel.HIGH
                  : ThinkingLevel.MEDIUM,
            },
            responseMimeType: 'application/json',
            responseSchema,
          },
        });
      } finally {
        clearTimeout(timer);
      }
    };

    let activeModel = PRIMARY_MODEL;
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await callModel(activeModel, 52000);
        return result.text || '{}';
      } catch (apiErr: unknown) {
        const msg = apiErr instanceof Error ? apiErr.message : String(apiErr);
        const isRateLimited =
          msg.includes('429') ||
          msg.includes('RESOURCE_EXHAUSTED') ||
          msg.includes('exceeded your current quota') ||
          msg.includes('quota');
        const isTransient = msg.includes('503') || msg.includes('UNAVAILABLE');

        // Fall back to faster model only if rate limited
        if (isRateLimited && activeModel !== FALLBACK_MODEL) {
          activeModel = FALLBACK_MODEL;
          continue;
        }
        if ((isRateLimited || isTransient) && attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 1200 * attempt));
          continue;
        }
        throw apiErr;
      }
    }
    return '{}';
  }

  // ----------------- 1. SHELF SHORTAGE GAP ANALYSIS -----------------
  app.post('/api/analyze-shelf', async (req, res) => {
    try {
      const {
        photoDataUrl,
        halfLeftDataUrl,
        halfRightDataUrl,
      } = req.body ?? {};

      if (!photoDataUrl || typeof photoDataUrl !== 'string') {
        return res.status(400).json({ error: 'بيانات الصورة مفقودة.' });
      }

      if (!DATA_URL_REGEX.test(photoDataUrl)) {
        return res.status(400).json({ error: 'صيغة الصورة غير صالحة.' });
      }

      if (!ai) {
        return res.status(503).json({
          error:
            'مفتاح Gemini API غير مهيأ على الخادم (GEMINI_API_KEY). يرجى إعداده لتفعيل التحليل.',
        });
      }

      const boxSchema = {
        type: Type.OBJECT,
        properties: {
          x: { type: Type.NUMBER },
          y: { type: Type.NUMBER },
          w: { type: Type.NUMBER },
          h: { type: Type.NUMBER },
        },
        required: ['x', 'y', 'w', 'h'],
      };

      const responseSchema = {
        type: Type.OBJECT,
        properties: {
          photoQuality: {
            type: Type.STRING,
            enum: ['good', 'poor'],
          },
          shortages: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                productDescription: { type: Type.STRING },
                gapBox: boxSchema,
                productBox: boxSchema,
                estimatedMissing: { type: Type.INTEGER },
                confidence: { type: Type.NUMBER },
              },
              required: [
                'productDescription',
                'gapBox',
                'productBox',
                'estimatedMissing',
                'confidence',
              ],
            },
          },
        },
        required: ['photoQuality', 'shortages'],
      };

      const analyzeSlice = async (
        imageUrl: string,
        sliceInfo: HalfSlice | null
      ): Promise<{
        photoQuality: 'good' | 'poor';
        shortages: AnalyzedShortageRaw[];
      }> => {
        const match = imageUrl.match(DATA_URL_REGEX);
        if (!match) {
          throw new Error('صيغة جزء الصورة غير صالحة.');
        }

        const promptText = `Find EVERY place where a product is missing or there is an empty gap/thin column on this supermarket shelf (exposed shelf board where units should stand), including small ones.
gapBox must cover the WHOLE empty region (minimum 8% of photo width), not a point at the shelf edge.
For each shortage return:
- productDescription: a short English visual description of the product (colors, bottle/package shape, cap, size) taken from neighboring units in the same column. Do not depend on reading printed brand names.
- gapBox: {x, y, w, h} normalized 0-1 covering the whole empty gap area.
- productBox: {x, y, w, h} normalized 0-1 tightly around one remaining unit of that product INCLUDING its label (taken from neighboring units in the same column).
- estimatedMissing: integer estimate of missing units compared to a full shelf.
- confidence: number 0-1.
If the photo is too blurry or cut off, set photoQuality='poor'.
Return strict JSON only: {photoQuality, shortages:[{productDescription, gapBox:{x,y,w,h}, productBox:{x,y,w,h}, estimatedMissing, confidence}]}.`;

        const parts: Array<{
          text?: string;
          inlineData?: { mimeType: string; data: string };
        }> = [
          {
            inlineData: {
              mimeType: match[1],
              data: match[2],
            },
          },
        ];

        parts.push({ text: promptText });

        const responseText = await generateWithFallback(
          parts,
          responseSchema,
          true
        );

        const cleaned = responseText
          .replace(/^```json\s*/i, '')
          .replace(/```\s*$/i, '')
          .trim();
        const parsed = JSON.parse(cleaned || '{}') as {
          photoQuality?: string;
          shortages?: Array<Record<string, unknown>>;
        };

        const photoQuality: 'good' | 'poor' =
          parsed.photoQuality === 'poor' ? 'poor' : 'good';

        const rawList = Array.isArray(parsed.shortages) ? parsed.shortages : [];
        const mapped: AnalyzedShortageRaw[] = rawList.map((item) => {
          const rawGap = clampBox(item.gapBox, {
            x: 0.25,
            y: 0.25,
            w: 0.16,
            h: 0.25,
          });
          const rawProd = clampBox(item.productBox, rawGap);

          const gapBox = sliceInfo
            ? remapHalfBoxToFullPhoto(rawGap, sliceInfo)
            : rawGap;
          const productBox = sliceInfo
            ? remapHalfBoxToFullPhoto(rawProd, sliceInfo)
            : rawProd;

          const estimatedMissing = Math.max(
            1,
            Math.round(Number(item.estimatedMissing) || 1)
          );
          const confidenceRaw = Number(item.confidence);
          const confidence = Number.isFinite(confidenceRaw)
            ? Math.max(0, Math.min(1, confidenceRaw))
            : 0.75;

          return {
            productDescription:
              typeof item.productDescription === 'string' &&
              item.productDescription.trim()
                ? item.productDescription.trim()
                : 'Supermarket packaged product',
            gapBox,
            productBox,
            estimatedMissing,
            confidence,
          };
        });

        return { photoQuality, shortages: mapped };
      };

      if (
        typeof halfLeftDataUrl === 'string' &&
        typeof halfRightDataUrl === 'string' &&
        DATA_URL_REGEX.test(halfLeftDataUrl) &&
        DATA_URL_REGEX.test(halfRightDataUrl)
      ) {
        const [leftRes, rightRes] = await Promise.all([
          analyzeSlice(halfLeftDataUrl, LEFT_HALF_SLICE),
          analyzeSlice(halfRightDataUrl, RIGHT_HALF_SLICE),
        ]);

        const combined = mergeDuplicateShortages([
          ...leftRes.shortages,
          ...rightRes.shortages,
        ]);
        const photoQuality: 'good' | 'poor' =
          leftRes.photoQuality === 'poor' &&
          rightRes.photoQuality === 'poor' &&
          combined.length === 0
            ? 'poor'
            : 'good';

        return res.json({
          photoQuality,
          shortages: combined,
        });
      }

      const single = await analyzeSlice(photoDataUrl, null);
      return res.json({
        photoQuality: single.photoQuality,
        shortages: mergeDuplicateShortages(single.shortages),
      });
    } catch (err: unknown) {
      console.error('Gemini shelf analysis error:', err);
      const errMsg = err instanceof Error ? err.message : String(err);
      const isAbort =
        err instanceof Error &&
        (err.name === 'AbortError' || errMsg.includes('aborted'));
      const isBusy = errMsg.includes('503') || errMsg.includes('UNAVAILABLE');
      const isQuota =
        errMsg.includes('429') ||
        errMsg.includes('RESOURCE_EXHAUSTED') ||
        errMsg.includes('quota');
      const isAuth =
        errMsg.includes('401') ||
        errMsg.includes('403') ||
        errMsg.includes('API_KEY');

      const status = isAbort
        ? 504
        : isBusy
        ? 503
        : isQuota
        ? 429
        : isAuth
        ? 401
        : 500;

      const arabicMessage = isAbort
        ? 'انتهت مهلة الاتصال بخدمة التحليل، يرجى إعادة المحاولة.'
        : isBusy
        ? 'خادم التحليل مشغول مؤقتاً الآن، أعد المحاولة بعد لحظات.'
        : isQuota
        ? 'تم تجاوز حد طلبات التحليل المؤقت، انتظر دقيقة ثم أعد المحاولة.'
        : isAuth
        ? 'مفتاح التحليل غير صالح أو غير مصرح به.'
        : 'حدث خطأ أثناء تحليل الصورة، يرجى إعادة المحاولة.';

      return res.status(status).json({ error: arabicMessage });
    }
  });

  // ----------------- 2. SHELF ASSIGNMENT MATCHER -----------------
  app.post('/api/match-shelf', async (req, res) => {
    try {
      const { photoDataUrl, shelves } = req.body ?? {};
      if (!photoDataUrl || typeof photoDataUrl !== 'string') {
        return res.status(400).json({ error: 'بيانات الصورة مفقودة.' });
      }
      const newMatch = photoDataUrl.match(DATA_URL_REGEX);
      if (!newMatch || !ai) {
        return res.json({ matchIndex: -1, matchedShelfId: null });
      }

      const validShelves: Array<{
        shelfId: string;
        mimeType: string;
        data: string;
      }> = [];

      if (Array.isArray(shelves)) {
        for (const s of shelves.slice(0, 6)) {
          if (
            s &&
            typeof s.shelfId === 'string' &&
            typeof s.imageDataUrl === 'string'
          ) {
            const m = s.imageDataUrl.match(DATA_URL_REGEX);
            if (m) {
              validShelves.push({
                shelfId: s.shelfId,
                mimeType: m[1],
                data: m[2],
              });
            }
          }
        }
      }

      if (validShelves.length === 0) {
        return res.json({ matchIndex: -1, matchedShelfId: null });
      }

      const parts: Array<{
        text?: string;
        inlineData?: { mimeType: string; data: string };
      }> = [
        {
          inlineData: {
            mimeType: newMatch[1],
            data: newMatch[2],
          },
        },
      ];

      for (const sh of validShelves) {
        parts.push({
          inlineData: {
            mimeType: sh.mimeType,
            data: sh.data,
          },
        });
      }

      parts.push({
        text: `The first image is a newly photographed supermarket shelf. The ${validShelves.length} images that follow are existing recorded shelves indexed 0 to ${validShelves.length - 1}.
Is the first photo showing the SAME physical supermarket shelf section (same bay, shelf rows, and product families) as one of the following images? Return the matching index (0 to ${validShelves.length - 1}) or -1 if it is a new/different shelf.`,
      });

      const shelfSchema = {
        type: Type.OBJECT,
        properties: {
          matchIndex: { type: Type.INTEGER },
        },
        required: ['matchIndex'],
      };

      const rawText = await generateWithFallback(parts, shelfSchema, false);
      const cleaned = rawText
        .replace(/^```json\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
      const parsed = JSON.parse(cleaned || '{}') as { matchIndex?: number };
      const idx =
        typeof parsed.matchIndex === 'number' &&
        Number.isInteger(parsed.matchIndex) &&
        parsed.matchIndex >= 0 &&
        parsed.matchIndex < validShelves.length
          ? parsed.matchIndex
          : -1;

      return res.json({
        matchIndex: idx,
        matchedShelfId: idx >= 0 ? validShelves[idx].shelfId : null,
      });
    } catch (err) {
      console.error('Gemini shelf match error:', err);
      return res.status(200).json({ matchIndex: -1, matchedShelfId: null });
    }
  });

  // ----------------- 3. VISUAL PRODUCT IDENTITY MATCHER -----------------
  app.post('/api/match-product', async (req, res) => {
    try {
      const { newCropDataUrl, candidates } = req.body ?? {};
      if (!newCropDataUrl || typeof newCropDataUrl !== 'string') {
        return res.status(400).json({ error: 'بيانات الصورة المقتطعة مفقودة.' });
      }
      const newMatch = newCropDataUrl.match(DATA_URL_REGEX);
      if (!newMatch) {
        return res.status(400).json({ error: 'صيغة الصورة غير صالحة.' });
      }

      if (!ai) {
        return res.status(503).json({
          error: 'مفتاح Gemini API غير مهيأ على الخادم.',
        });
      }

      const validCandidates: Array<{
        productId: string;
        mimeType: string;
        data: string;
      }> = [];

      if (Array.isArray(candidates)) {
        for (const c of candidates.slice(0, 6)) {
          if (
            c &&
            typeof c.productId === 'string' &&
            typeof c.cropDataUrl === 'string'
          ) {
            const m = c.cropDataUrl.match(DATA_URL_REGEX);
            if (m) {
              validCandidates.push({
                productId: c.productId,
                mimeType: m[1],
                data: m[2],
              });
            }
          }
        }
      }

      if (validCandidates.length === 0) {
        return res.json({ matchIndex: -1, matchedProductId: null });
      }

      const parts: Array<{
        text?: string;
        inlineData?: { mimeType: string; data: string };
      }> = [
        {
          inlineData: {
            mimeType: newMatch[1],
            data: newMatch[2],
          },
        },
      ];

      for (const cand of validCandidates) {
        parts.push({
          inlineData: {
            mimeType: cand.mimeType,
            data: cand.data,
          },
        });
      }

      parts.push({
        text: `The first image is a product cropped from a supermarket shelf. The ${validCandidates.length} images that follow are saved candidate products indexed 0 to ${validCandidates.length - 1}.
Is it the same product? Compare packaging shape, brand look, colors, cap color, and size. Return the matching index (0 to ${validCandidates.length - 1}) or -1.`,
      });

      const matchSchema = {
        type: Type.OBJECT,
        properties: {
          matchIndex: { type: Type.INTEGER },
        },
        required: ['matchIndex'],
      };

      const rawText = await generateWithFallback(parts, matchSchema, false);
      const cleaned = rawText
        .replace(/^```json\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
      const parsed = JSON.parse(cleaned || '{}') as { matchIndex?: number };
      const idx =
        typeof parsed.matchIndex === 'number' &&
        Number.isInteger(parsed.matchIndex) &&
        parsed.matchIndex >= 0 &&
        parsed.matchIndex < validCandidates.length
          ? parsed.matchIndex
          : -1;

      return res.json({
        matchIndex: idx,
        matchedProductId: idx >= 0 ? validCandidates[idx].productId : null,
      });
    } catch (err) {
      console.error('Gemini product match error:', err);
      return res.status(200).json({ matchIndex: -1, matchedProductId: null });
    }
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'نقطة API غير موجودة.' });
  });

  app.use(
    (
      err: unknown,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      if (req.path.startsWith('/api')) {
        const status =
          typeof (err as { status?: number })?.status === 'number'
            ? (err as { status: number }).status
            : 500;
        const message =
          err instanceof Error ? err.message : 'خطأ غير متوقع في الخادم';
        return res.status(status).json({ error: message });
      }
      return next(err);
    }
  );

  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        host: '0.0.0.0',
        port: PORT,
        hmr: false,
        ws: false,
      },
      appType: 'spa',
    });

    app.get('/@vite/client', async (_req, res, next) => {
      try {
        const result = await vite.transformRequest('/@vite/client');
        if (!result) return next();
        const patched = result.code.replace(
          'transport.connect(createHMRHandler(handleMessage));',
          '/* HMR WebSocket disabled */\ntransport.connect = async () => {};\ntransport.disconnect = async () => {};\ntransport.send = async () => {};'
        );
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        if (result.etag) res.setHeader('ETag', result.etag);
        return res.send(patched);
      } catch {
        return next();
      }
    });

    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[NaqsAlrofoof Server] Ready at http://0.0.0.0:${PORT}`);
  });
}

startServer();
