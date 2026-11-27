import { AppSettings, ShelfPhoto } from '../../types';
import { getAllPhotos, getPhotoById, savePhoto } from '../db';
import { saveCameraDiagnostics } from './cameraDiagnostics';
import {
  SAVED_PHOTO_JPEG_QUALITY,
  THUMBNAIL_JPEG_QUALITY,
  THUMBNAIL_MAX_LONG_SIDE,
} from './captureQueue';
import {
  runExclusiveWorkerTask,
  waitForEnhancementSlot,
} from './backgroundCameraQueue';
import {
  calculateTargetDimensions,
  fileOrDataUrlToCanvas,
} from './imageCompression';
import type {
  EnhanceWorkerRequest,
  EnhanceWorkerResponse,
} from './enhanceWorker';
import {
  ActivePhotoEnhanceLevel,
  ENHANCE_TIMEOUT_MS,
  enhanceRgbaBuffer,
  resolveEnhanceLevel,
} from './photoEnhancement';

type EnhancementListener = () => void;

const listeners = new Set<EnhancementListener>();
const queuedPhotoIds = new Set<string>();
let enhanceChain: Promise<void> = Promise.resolve();

let enhanceWorker: Worker | null = null;
let enhanceWorkerReqSeq = 1;
const pendingWorkerCallbacks = new Map<
  number,
  {
    resolve: (res: EnhanceWorkerResponse) => void;
    reject: (err: Error) => void;
  }
>();

function notifyEnhancementListeners(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // Ignore subscriber errors
    }
  }
}

export function subscribeEnhancementUpdates(
  listener: EnhancementListener
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function isOffscreenEnhancementSupported(): boolean {
  if (
    typeof Worker === 'undefined' ||
    typeof OffscreenCanvas === 'undefined' ||
    typeof OffscreenCanvas.prototype?.convertToBlob !== 'function'
  ) {
    return false;
  }
  try {
    const test = new OffscreenCanvas(2, 2);
    return Boolean(test.getContext('2d'));
  } catch {
    return false;
  }
}

function resetEnhanceWorker(reason: string): void {
  if (enhanceWorker) {
    try {
      enhanceWorker.terminate();
    } catch {
      // Ignore terminate error
    }
    enhanceWorker = null;
  }
  for (const [, cb] of pendingWorkerCallbacks) {
    cb.reject(new Error(reason));
  }
  pendingWorkerCallbacks.clear();
}

function getOrCreateEnhanceWorker(): Worker | null {
  if (!isOffscreenEnhancementSupported()) return null;
  if (!enhanceWorker) {
    try {
      enhanceWorker = new Worker(
        new URL('./enhanceWorker.ts', import.meta.url),
        { type: 'module' }
      );
      enhanceWorker.onmessage = (ev: MessageEvent<EnhanceWorkerResponse>) => {
        const msg = ev.data;
        const cb = pendingWorkerCallbacks.get(msg.id);
        if (!cb) return;
        pendingWorkerCallbacks.delete(msg.id);
        cb.resolve(msg);
      };
      enhanceWorker.onerror = () => {
        resetEnhanceWorker('Enhance worker crashed');
      };
    } catch {
      enhanceWorker = null;
      return null;
    }
  }
  return enhanceWorker;
}

async function runEnhancementOnFallbackCanvas(
  sourceDataUrl: string,
  level: ActivePhotoEnhanceLevel,
  keepOriginal: boolean
): Promise<EnhanceWorkerResponse> {
  const start = performance.now();
  const canvas = await fileOrDataUrlToCanvas(sourceDataUrl, 4096);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('2d context unavailable');
  }
  const width = canvas.width;
  const height = canvas.height;
  const imageData = ctx.getImageData(0, 0, width, height);
  const { beforeLuminance, afterLuminance } = enhanceRgbaBuffer(
    imageData.data,
    width,
    height,
    level
  );
  ctx.putImageData(imageData, 0, 0);

  const enhancedDataUrl = canvas.toDataURL('image/jpeg', SAVED_PHOTO_JPEG_QUALITY);
  let thumbnailDataUrl = enhancedDataUrl;
  const thumbDims = calculateTargetDimensions(
    width,
    height,
    THUMBNAIL_MAX_LONG_SIDE
  );
  if (thumbDims.width < width || thumbDims.height < height) {
    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = thumbDims.width;
    thumbCanvas.height = thumbDims.height;
    const tCtx = thumbCanvas.getContext('2d');
    if (tCtx) {
      tCtx.imageSmoothingEnabled = true;
      tCtx.imageSmoothingQuality = 'high';
      tCtx.drawImage(canvas, 0, 0, thumbDims.width, thumbDims.height);
      thumbnailDataUrl = thumbCanvas.toDataURL(
        'image/jpeg',
        THUMBNAIL_JPEG_QUALITY
      );
    }
  }

  return {
    id: 0,
    ok: true,
    dataUrl: enhancedDataUrl,
    thumbnailDataUrl,
    ...(keepOriginal ? { originalDataUrl: sourceDataUrl } : {}),
    width,
    height,
    enhanceMs: Math.max(1, Math.round(performance.now() - start)),
    beforeLuminance: Math.round(beforeLuminance * 10) / 10,
    afterLuminance: Math.round(afterLuminance * 10) / 10,
    level,
  };
}

async function executeEnhancementWithTimeout(params: {
  sourceDataUrl: string;
  level: ActivePhotoEnhanceLevel;
  keepOriginal: boolean;
}): Promise<EnhanceWorkerResponse> {
  const worker = getOrCreateEnhanceWorker();

  const workPromise: Promise<EnhanceWorkerResponse> = worker
    ? new Promise<EnhanceWorkerResponse>((resolve, reject) => {
        const id = enhanceWorkerReqSeq++;
        pendingWorkerCallbacks.set(id, { resolve, reject });
        const payload: EnhanceWorkerRequest = {
          id,
          dataUrl: params.sourceDataUrl,
          level: params.level,
          keepOriginal: params.keepOriginal,
          quality: SAVED_PHOTO_JPEG_QUALITY,
          thumbnailMaxDim: THUMBNAIL_MAX_LONG_SIDE,
          thumbnailQuality: THUMBNAIL_JPEG_QUALITY,
        };
        try {
          worker.postMessage(payload);
        } catch (err) {
          pendingWorkerCallbacks.delete(id);
          reject(err instanceof Error ? err : new Error('Worker post failed'));
        }
      })
    : runEnhancementOnFallbackCanvas(
        params.sourceDataUrl,
        params.level,
        params.keepOriginal
      );

  let timeoutId: number | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      // Terminate stuck worker cleanly so future captures remain responsive
      if (worker) {
        resetEnhanceWorker('Photo enhancement timeout');
      }
      reject(new Error('Photo enhancement timeout (>8s)'));
    }, ENHANCE_TIMEOUT_MS);
  });

  try {
    return await Promise.race([workPromise, timeoutPromise]);
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  }
}

async function processSingleEnhancementJob(params: {
  photoId: string;
  sourceDataUrl?: string;
  level: ActivePhotoEnhanceLevel;
  keepOriginal: boolean;
}): Promise<ShelfPhoto | null> {
  const startMs = performance.now();
  const initial = await getPhotoById(params.photoId);
  if (!initial || initial.imageCleaned || !initial.dataUrl) {
    return null;
  }

  const inputDataUrl =
    params.sourceDataUrl || initial.originalDataUrl || initial.dataUrl;
  if (!inputDataUrl) {
    return null;
  }

  try {
    const res = await runExclusiveWorkerTask(() =>
      executeEnhancementWithTimeout({
        sourceDataUrl: inputDataUrl,
        level: params.level,
        keepOriginal: params.keepOriginal,
      })
    );

    if (!res.ok || !res.dataUrl) {
      throw new Error(res.error || 'Enhancement failed');
    }

    // Re-read latest photo so user actions (done / delete / cleanup) during background work are never clobbered
    const latest = await getPhotoById(params.photoId);
    if (!latest || latest.imageCleaned || !latest.dataUrl) {
      return null;
    }

    const updated: ShelfPhoto = {
      ...latest,
      dataUrl: res.dataUrl,
      thumbnailDataUrl: res.thumbnailDataUrl || res.dataUrl,
      ...(params.keepOriginal
        ? { originalDataUrl: latest.originalDataUrl || inputDataUrl }
        : {}),
      enhancementStatus: 'enhanced',
      enhancementLevel: params.level,
    };
    await savePhoto(updated);

    saveCameraDiagnostics({
      lastEnhanceMs:
        res.enhanceMs ?? Math.max(1, Math.round(performance.now() - startMs)),
      lastEnhanceBeforeLuminance: res.beforeLuminance,
      lastEnhanceAfterLuminance: res.afterLuminance,
      lastEnhanceLevel: params.level,
      lastEnhanceFailed: false,
    });

    notifyEnhancementListeners();
    return updated;
  } catch {
    const elapsedMs = Math.max(1, Math.round(performance.now() - startMs));
    const latest = await getPhotoById(params.photoId);
    if (latest && !latest.imageCleaned && latest.dataUrl) {
      const marked: ShelfPhoto = {
        ...latest,
        enhancementStatus: 'unenhanced',
      };
      await savePhoto(marked);
      saveCameraDiagnostics({
        lastEnhanceMs: elapsedMs,
        lastEnhanceLevel: params.level,
        lastEnhanceFailed: true,
      });
      notifyEnhancementListeners();
      return marked;
    }
    return null;
  }
}

/**
 * Enqueues post-capture automatic enhancement on the background queue.
 * Pauses 1.5s after any shutter press while the Capture tab is open and
 * resumes immediately at full speed when leaving Capture.
 */
export function enqueuePhotoEnhancement(params: {
  photoId: string;
  sourceDataUrl?: string;
  level: ActivePhotoEnhanceLevel;
  keepOriginal: boolean;
}): void {
  if (!params.photoId || queuedPhotoIds.has(params.photoId)) {
    return;
  }
  queuedPhotoIds.add(params.photoId);

  const job = async () => {
    try {
      await waitForEnhancementSlot();
      await processSingleEnhancementJob(params);
    } finally {
      queuedPhotoIds.delete(params.photoId);
    }
  };

  enhanceChain = enhanceChain.then(job, job);
}

/**
 * Re-enhances an existing photo from its preserved originalDataUrl (if present) or current dataUrl.
 */
export async function reEnhancePhotoNow(
  photo: ShelfPhoto,
  level: ActivePhotoEnhanceLevel
): Promise<ShelfPhoto> {
  const sourceDataUrl = photo.originalDataUrl || photo.dataUrl;
  if (!sourceDataUrl) {
    throw new Error('لا توجد بيانات صورة متاحة للتحسين');
  }

  const pendingRecord: ShelfPhoto = {
    ...photo,
    enhancementStatus: 'pending',
  };
  await savePhoto(pendingRecord);
  notifyEnhancementListeners();

  const resultPromise = enhanceChain.then(
    () =>
      processSingleEnhancementJob({
        photoId: photo.id,
        sourceDataUrl,
        level,
        keepOriginal: Boolean(photo.originalDataUrl),
      }),
    () =>
      processSingleEnhancementJob({
        photoId: photo.id,
        sourceDataUrl,
        level,
        keepOriginal: Boolean(photo.originalDataUrl),
      })
  );

  enhanceChain = resultPromise.then(
    () => undefined,
    () => undefined
  );

  const updated = await resultPromise;
  return updated || (await getPhotoById(photo.id)) || photo;
}

/**
 * Restores photo.dataUrl back to the preserved originalDataUrl and regenerates its thumbnail.
 */
export async function restoreOriginalPhotoRecord(
  photo: ShelfPhoto
): Promise<ShelfPhoto> {
  if (!photo.originalDataUrl) {
    throw new Error('لم يتم حفظ الصورة الأصلية لهذه اللقطة');
  }

  let thumbnailDataUrl = photo.originalDataUrl;
  try {
    const thumbCanvas = await fileOrDataUrlToCanvas(
      photo.originalDataUrl,
      THUMBNAIL_MAX_LONG_SIDE
    );
    thumbnailDataUrl = thumbCanvas.toDataURL(
      'image/jpeg',
      THUMBNAIL_JPEG_QUALITY
    );
  } catch {
    thumbnailDataUrl = photo.originalDataUrl;
  }

  const restored: ShelfPhoto = {
    ...photo,
    dataUrl: photo.originalDataUrl,
    thumbnailDataUrl,
    originalDataUrl: photo.originalDataUrl,
    enhancementStatus: 'unenhanced',
  };
  await savePhoto(restored);
  notifyEnhancementListeners();
  return restored;
}

/**
 * Resumes any photos still marked enhancementStatus === 'pending' (e.g. after app reload).
 */
export async function resumePendingPhotoEnhancements(
  settings: AppSettings
): Promise<void> {
  try {
    const all = await getAllPhotos();
    const activeLevel = resolveEnhanceLevel(settings.photoEnhanceLevel) || 'medium';
    const keepOriginal = Boolean(settings.keepOriginalPhoto);

    for (const p of all) {
      if (p.enhancementStatus === 'pending' && p.dataUrl && !p.imageCleaned) {
        enqueuePhotoEnhancement({
          photoId: p.id,
          sourceDataUrl: p.originalDataUrl || p.dataUrl,
          level: activeLevel,
          keepOriginal: keepOriginal || Boolean(p.originalDataUrl),
        });
      }
    }
  } catch {
    // Non-fatal startup check
  }
}
