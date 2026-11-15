import {
  AnalyzeShelfResponse,
  KnownProduct,
  Shelf,
  ShelfPhoto,
  ShortageItem,
} from '../../types';
import {
  cleanupExpiredDonePhotos,
  createOrUpdateKnownProduct,
  getAllKnownProducts,
  getAllShelves,
  getPendingPhotos,
  getPhotoById,
  getSettings,
  recordPullEventsForDate,
  recoverStuckAnalyzingPhotos,
  replacePhotoShortages,
  savePhoto,
  saveShelf,
} from '../db';
import {
  cropProductBoxFromDataUrl,
  resizeDataUrl,
  splitPhotoDataUrlIntoTwoHalves,
} from '../camera/imageCompression';
import { sortShortagesRTLTopToBottom } from './boxMerge';
import { matchProductWithGemini, matchShelfWithGemini } from './productMatcher';

type QueueListener = () => void;

class AnalysisQueueService {
  private isProcessing = false;
  private paused = true;
  private aiEnabled = true;
  private listeners = new Set<QueueListener>();
  private initialized = false;
  private dailyIntervalId: number | null = null;
  private pendingUpgrades = new Map<string, Promise<void>>();

  public registerPendingUpgrade(photoId: string, promise: Promise<void>) {
    const wrapped = promise
      .catch(() => {})
      .finally(() => {
        if (this.pendingUpgrades.get(photoId) === wrapped) {
          this.pendingUpgrades.delete(photoId);
        }
      });
    this.pendingUpgrades.set(photoId, wrapped);
  }

  public async waitForPhotoReady(photoId: string): Promise<void> {
    const p = this.pendingUpgrades.get(photoId);
    if (p) {
      await p;
    }
  }

  public setAiEnabled(enabled: boolean) {
    this.aiEnabled = enabled;
  }

  public setPaused(paused: boolean) {
    if (this.paused === paused) return;
    this.paused = paused;
    if (!paused && this.initialized && this.aiEnabled) {
      if (typeof navigator === 'undefined' || navigator.onLine) {
        this.processQueue();
      }
    }
  }

  public init() {
    if (this.initialized) return;
    this.initialized = true;

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        if (!this.paused && this.aiEnabled) {
          this.processQueue();
        }
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          this.runAutoCleanupIfEnabled();
        }
      });
      // Run daily check periodically while app stays open
      this.dailyIntervalId = window.setInterval(() => {
        this.runAutoCleanupIfEnabled();
      }, 1000 * 60 * 60 * 6);
    }

    getSettings()
      .then((s) => {
        this.aiEnabled = s.aiAnalysisEnabled;
      })
      .then(() => this.runAutoCleanupIfEnabled())
      .then(() => recoverStuckAnalyzingPhotos())
      .then(() => {
        if (
          this.aiEnabled &&
          !this.paused &&
          (typeof navigator === 'undefined' || navigator.onLine)
        ) {
          this.processQueue();
        }
      })
      .catch(() => {});
  }

  public dispose() {
    if (this.dailyIntervalId !== null && typeof window !== 'undefined') {
      window.clearInterval(this.dailyIntervalId);
      this.dailyIntervalId = null;
    }
  }

  public async runAutoCleanupIfEnabled(): Promise<number> {
    const settings = await getSettings();
    if (!settings.autoDeletePhotos) return 0;
    const cleaned = await cleanupExpiredDonePhotos(settings.keepPhotosDays, false);
    if (cleaned > 0) {
      this.notify();
    }
    return cleaned;
  }

  public subscribe(fn: QueueListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  public notify() {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {
        // Ignore subscriber error
      }
    }
  }

  public async retryPhoto(photoId: string): Promise<void> {
    const settings = await getSettings();
    this.aiEnabled = settings.aiAnalysisEnabled;
    if (!this.aiEnabled) return;

    const photo = await getPhotoById(photoId);
    if (!photo) return;
    await savePhoto({
      ...photo,
      status: 'pending',
      done: false,
      errorMessage: undefined,
    });
    this.notify();
    if (!this.paused) {
      await this.processQueue();
    }
  }

  public async processQueue(): Promise<void> {
    if (this.isProcessing || this.paused || !this.aiEnabled) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return;
    }

    const settings = await getSettings();
    this.aiEnabled = settings.aiAnalysisEnabled;
    if (!this.aiEnabled) return;

    this.isProcessing = true;
    this.notify();

    try {
      let processedAny = false;
      while (true) {
        if (this.paused || !this.aiEnabled) break;
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          break;
        }
        const pending = await getPendingPhotos();
        if (pending.length === 0) break;

        if (processedAny) {
          // Short delay between photos to respect rate limits
          await new Promise((r) => setTimeout(r, 750));
          if (this.paused || !this.aiEnabled) break;
        }

        const nextPhoto = pending[0];
        await this.analyzeSinglePhoto(nextPhoto);
        processedAny = true;
        this.notify();
      }
    } finally {
      this.isProcessing = false;
      this.notify();
    }
  }

  private async assignShelfForPhoto(photo: ShelfPhoto): Promise<Shelf> {
    const existingShelves = await getAllShelves();
    const compactThumb = await resizeDataUrl(photo.dataUrl, 512, 0.8);

    if (photo.shelfId) {
      const preAssigned = existingShelves.find((s) => s.id === photo.shelfId);
      if (preAssigned) return preAssigned;
    }

    const matched = await matchShelfWithGemini(compactThumb, existingShelves);
    const now = Date.now();
    if (matched) {
      const updated: Shelf = {
        ...matched,
        thumbnailDataUrl: matched.thumbnailDataUrl || compactThumb,
        updatedAt: now,
      };
      await saveShelf(updated);
      return updated;
    }

    const newShelf: Shelf = {
      id: `shelf_${now}_${Math.random().toString(36).slice(2, 6)}`,
      label: `رف ${existingShelves.length + 1}`,
      thumbnailDataUrl: compactThumb,
      createdAt: now,
      updatedAt: now,
    };
    await saveShelf(newShelf);
    return newShelf;
  }

  private async analyzeSinglePhoto(photo: ShelfPhoto): Promise<void> {
    await this.waitForPhotoReady(photo.id);
    if (!this.aiEnabled) return;

    const latest = await getPhotoById(photo.id);
    if (!latest || !latest.dataUrl) {
      return;
    }
    photo = latest;

    await savePhoto({
      ...photo,
      status: 'analyzing',
      errorMessage: undefined,
    });
    this.notify();

    if (!this.aiEnabled) {
      await savePhoto({
        ...photo,
        status: 'manual_only',
        errorMessage: undefined,
      });
      this.notify();
      return;
    }

    try {
      // 1. Assign photo to a shelf (or create a new shelf if none matches)
      const shelf = await this.assignShelfForPhoto(photo);
      const updatedPhotoWithShelf: ShelfPhoto = {
        ...photo,
        shelfId: shelf.id,
      };

      // 2. Split max-2048px photo into two halves with 20% overlap
      const { leftDataUrl, rightDataUrl } =
        await splitPhotoDataUrlIntoTwoHalves(photo.dataUrl);

      const res = await fetch('/api/analyze-shelf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          photoDataUrl: photo.dataUrl,
          halfLeftDataUrl: leftDataUrl,
          halfRightDataUrl: rightDataUrl,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message =
          typeof data?.error === 'string' && data.error.trim()
            ? data.error
            : 'تعذر تحليل الصورة. تأكد من الاتصال وأعد المحاولة.';
        await savePhoto({
          ...updatedPhotoWithShelf,
          status: 'error',
          errorMessage: message,
        });
        return;
      }

      const result = data as AnalyzeShelfResponse;
      if (result.photoQuality === 'poor') {
        await savePhoto({
          ...updatedPhotoWithShelf,
          status: 'poor_quality',
          photoQuality: 'poor',
          errorMessage: 'الصورة غير واضحة أو مقطوعة، يُفضل إعادة التصوير.',
          analyzedAt: Date.now(),
        });
        return;
      }

      const rawShortages = Array.isArray(result.shortages) ? result.shortages : [];
      const orderedShortages = sortShortagesRTLTopToBottom(rawShortages);
      const savedPool: KnownProduct[] = await getAllKnownProducts();
      const shortageRecords: ShortageItem[] = [];
      const detectedProductIds: string[] = [];

      for (let i = 0; i < orderedShortages.length; i++) {
        const item = orderedShortages[i];
        // Permanent 256px thumbnail crop of one remaining unit (including its label)
        const thumb256 = await cropProductBoxFromDataUrl(
          photo.dataUrl,
          item.productBox,
          item.gapBox,
          256
        );

        // Visually match against up to 6 saved crops
        const matched = await matchProductWithGemini(
          thumb256,
          item.productDescription,
          savedPool
        );

        const savedProduct = await createOrUpdateKnownProduct({
          id: matched?.id,
          productDescription: item.productDescription,
          thumbnailDataUrl: matched?.thumbnailDataUrl || thumb256,
        });

        if (!matched) {
          savedPool.unshift(savedProduct);
        }

        detectedProductIds.push(savedProduct.id);
        const defaultQuantity =
          typeof savedProduct.lastQuantity === 'number' &&
          savedProduct.lastQuantity > 0
            ? savedProduct.lastQuantity
            : Math.max(1, item.estimatedMissing || 1);

        shortageRecords.push({
          id: `sh_${photo.id}_${i}_${Math.random().toString(36).slice(2, 6)}`,
          photoId: photo.id,
          shelfId: shelf.id,
          dateKey: photo.dateKey,
          timestamp: photo.timestamp,
          productId: savedProduct.id,
          productName: savedProduct.productName,
          productDescription: item.productDescription,
          gapBox: item.gapBox,
          productBox: item.productBox,
          estimatedMissing: Math.max(1, item.estimatedMissing || 1),
          quantity: defaultQuantity,
          status: 'new',
          colorIndex: i,
          confidence: item.confidence,
          source: 'ai',
          updatedAt: Date.now(),
        });
      }

      await replacePhotoShortages(photo.id, shortageRecords);
      await recordPullEventsForDate(photo.dateKey, detectedProductIds);

      await savePhoto({
        ...updatedPhotoWithShelf,
        status: 'completed',
        photoQuality: 'good',
        errorMessage: undefined,
        analyzedAt: Date.now(),
      });
    } catch {
      const stillOnline =
        typeof navigator === 'undefined' ? true : navigator.onLine;
      await savePhoto({
        ...photo,
        status: stillOnline ? 'error' : 'pending',
        errorMessage: stillOnline
          ? 'فشل الاتصال بخدمة التحليل، اضغط لإعادة المحاولة.'
          : undefined,
      });
    }
  }
}

export const analysisQueue = new AnalysisQueueService();
