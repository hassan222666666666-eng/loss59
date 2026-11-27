import express from 'express';
import { createServer as createViteServer } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  const isProd = process.env.NODE_ENV === 'production';
  const staticRoot = isProd
    ? path.join(__dirname, 'dist')
    : path.join(__dirname, 'public');

  app.use(express.json({ limit: '50mb' }));

  const sendPublicAsset = (
    fileName: string,
    contentType: string,
    extraHeaders?: Record<string, string>
  ) => {
    return (_req: express.Request, res: express.Response, next: express.NextFunction) => {
      const target = path.join(staticRoot, fileName);
      const fallback = path.join(__dirname, 'public', fileName);
      const resolved = fs.existsSync(target) ? target : fs.existsSync(fallback) ? fallback : null;
      if (!resolved) return next();
      res.setHeader('Content-Type', contentType);
      if (extraHeaders) {
        for (const [k, v] of Object.entries(extraHeaders)) {
          res.setHeader(k, v);
        }
      }
      return res.sendFile(resolved);
    };
  };

  app.get(
    '/manifest.webmanifest',
    sendPublicAsset('manifest.webmanifest', 'application/manifest+json; charset=utf-8', {
      'Cache-Control': 'no-cache',
    })
  );
  app.get(
    '/sw.js',
    sendPublicAsset('sw.js', 'application/javascript; charset=utf-8', {
      'Service-Worker-Allowed': '/',
      'Cache-Control': 'no-cache',
    })
  );
  app.get('/pwa-192x192.png', sendPublicAsset('pwa-192x192.png', 'image/png'));
  app.get('/pwa-512x512.png', sendPublicAsset('pwa-512x512.png', 'image/png'));
  app.get(
    '/pwa-maskable-512x512.png',
    sendPublicAsset('pwa-maskable-512x512.png', 'image/png')
  );
  app.get('/apple-touch-icon.png', sendPublicAsset('apple-touch-icon.png', 'image/png'));
  app.get('/icon.svg', sendPublicAsset('icon.svg', 'image/svg+xml'));

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

  if (isProd) {
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
