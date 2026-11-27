import {
  MAX_SAVED_PHOTO_LONG_SIDE,
  SAVED_PHOTO_JPEG_QUALITY,
  THUMBNAIL_JPEG_QUALITY,
  THUMBNAIL_MAX_LONG_SIDE,
} from './captureQueue';
import {
  runExclusiveWorkerTask,
  waitForBackgroundSlot,
} from './backgroundCameraQueue';

export function getScreenOrientationAngle(): number {
  if (
    typeof screen !== 'undefined' &&
    screen.orientation &&
    typeof screen.orientation.angle === 'number'
  ) {
    return ((screen.orientation.angle % 360) + 360) % 360;
  }
  if (
    typeof window !== 'undefined' &&
    typeof (window as unknown as { orientation?: number }).orientation === 'number'
  ) {
    const wo = (window as unknown as { orientation: number }).orientation;
    return ((wo % 360) + 360) % 360;
  }
  return 0;
}

export function getVideoCaptureRotationDeg(
  frameWidth: number,
  frameHeight: number,
  previewWidth: number,
  previewHeight: number,
  screenAngle: number = getScreenOrientationAngle()
): 0 | 90 | 180 | 270 {
  if (!frameWidth || !frameHeight || !previewWidth || !previewHeight) return 0;

  const angle = ((screenAngle % 360) + 360) % 360;
  const previewIsPortrait = previewHeight > previewWidth;
  const frameIsPortrait = frameHeight > frameWidth;

  if (previewIsPortrait === frameIsPortrait) {
    return angle === 180 ? 180 : 0;
  }

  if (previewIsPortrait && !frameIsPortrait) {
    return angle === 180 ? 270 : 90;
  }

  if (!previewIsPortrait && frameIsPortrait) {
    return angle === 270 ? 90 : 270;
  }

  return 0;
}

export function calculateTargetDimensions(
  width: number,
  height: number,
  maxDim: number = MAX_SAVED_PHOTO_LONG_SIDE
): { width: number; height: number } {
  if (width <= 0 || height <= 0) {
    return { width: 1, height: 1 };
  }
  if (
    !Number.isFinite(maxDim) ||
    maxDim <= 0 ||
    (width <= maxDim && height <= maxDim)
  ) {
    return { width: Math.round(width), height: Math.round(height) };
  }
  if (width >= height) {
    return {
      width: maxDim,
      height: Math.max(1, Math.round((height * maxDim) / width)),
    };
  }
  return {
    width: Math.max(1, Math.round((width * maxDim) / height)),
    height: maxDim,
  };
}

export function estimateDataUrlBytes(dataUrl: string): number {
  if (!dataUrl) return 0;
  const commaIdx = dataUrl.indexOf(',');
  const b64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

export function drawCroppedRotatedToCanvas(
  ctx: CanvasRenderingContext2D,
  source: ImageBitmap | HTMLCanvasElement | HTMLImageElement | HTMLVideoElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  outW: number,
  outH: number,
  rotationDeg: 0 | 90 | 180 | 270 = 0
): void {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.save();
  if (rotationDeg === 90) {
    ctx.translate(outW, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, outH, outW);
  } else if (rotationDeg === 180) {
    ctx.translate(outW, outH);
    ctx.rotate(Math.PI);
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, outW, outH);
  } else if (rotationDeg === 270) {
    ctx.translate(0, outH);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, outH, outW);
  } else {
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, outW, outH);
  }
  ctx.restore();
}

export function compressCanvasToJpeg(
  sourceCanvas: HTMLCanvasElement,
  maxDim: number = MAX_SAVED_PHOTO_LONG_SIDE,
  quality: number = SAVED_PHOTO_JPEG_QUALITY
): { dataUrl: string; thumbnailDataUrl: string; width: number; height: number; byteLength: number } {
  const target = calculateTargetDimensions(
    sourceCanvas.width,
    sourceCanvas.height,
    maxDim
  );

  let workingCanvas = sourceCanvas;
  if (
    target.width !== sourceCanvas.width ||
    target.height !== sourceCanvas.height
  ) {
    const outCanvas = document.createElement('canvas');
    outCanvas.width = target.width;
    outCanvas.height = target.height;
    const ctx = outCanvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(sourceCanvas, 0, 0, target.width, target.height);
      workingCanvas = outCanvas;
    }
  }

  const dataUrl = workingCanvas.toDataURL('image/jpeg', quality);
  let thumbnailDataUrl = dataUrl;
  const thumbTarget = calculateTargetDimensions(
    workingCanvas.width,
    workingCanvas.height,
    THUMBNAIL_MAX_LONG_SIDE
  );
  if (
    thumbTarget.width < workingCanvas.width ||
    thumbTarget.height < workingCanvas.height
  ) {
    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = thumbTarget.width;
    thumbCanvas.height = thumbTarget.height;
    const tCtx = thumbCanvas.getContext('2d');
    if (tCtx) {
      tCtx.imageSmoothingEnabled = true;
      tCtx.imageSmoothingQuality = 'high';
      tCtx.drawImage(
        workingCanvas,
        0,
        0,
        thumbTarget.width,
        thumbTarget.height
      );
      thumbnailDataUrl = thumbCanvas.toDataURL(
        'image/jpeg',
        THUMBNAIL_JPEG_QUALITY
      );
    }
  }

  return {
    dataUrl,
    thumbnailDataUrl,
    width: workingCanvas.width,
    height: workingCanvas.height,
    byteLength: estimateDataUrlBytes(dataUrl),
  };
}

export async function fileOrDataUrlToCanvas(
  source: File | string,
  maxDim: number = MAX_SAVED_PHOTO_LONG_SIDE
): Promise<HTMLCanvasElement> {
  if (typeof source !== 'string' && typeof createImageBitmap === 'function') {
    try {
      let bitmap: ImageBitmap;
      try {
        bitmap = await createImageBitmap(source, {
          imageOrientation: 'from-image',
        });
      } catch {
        bitmap = await createImageBitmap(source);
      }
      const target = calculateTargetDimensions(bitmap.width, bitmap.height, maxDim);
      const canvas = document.createElement('canvas');
      canvas.width = target.width;
      canvas.height = target.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bitmap, 0, 0, target.width, target.height);
      }
      bitmap.close();
      return canvas;
    } catch {
      // Fallback to Image element below
    }
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    let objectUrl: string | null = null;

    img.onload = () => {
      try {
        const target = calculateTargetDimensions(
          img.naturalWidth || img.width,
          img.naturalHeight || img.height,
          maxDim
        );
        const canvas = document.createElement('canvas');
        canvas.width = target.width;
        canvas.height = target.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, target.width, target.height);
        }
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        resolve(canvas);
      } catch (err) {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        reject(err);
      }
    };

    img.onerror = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      reject(new Error('تعذر تحميل الصورة'));
    };

    if (typeof source === 'string') {
      img.src = source;
    } else {
      objectUrl = URL.createObjectURL(source);
      img.src = objectUrl;
    }
  });
}

export async function resizeDataUrl(
  dataUrl: string,
  maxDim: number = 512,
  quality: number = 0.85
): Promise<string> {
  try {
    const canvas = await fileOrDataUrlToCanvas(dataUrl, maxDim);
    return compressCanvasToJpeg(canvas, maxDim, quality).dataUrl;
  } catch {
    return dataUrl;
  }
}

export interface ProcessedCaptureResult {
  dataUrl: string;
  thumbnailDataUrl?: string;
  width: number;
  height: number;
  byteLength: number;
  processingMs: number;
  savingMs: number;
  savedInWorker: boolean;
  photoId?: string;
  variance: number;
  isBlurry: boolean;
}

let workerInstance: Worker | null = null;
let workerFailedPermanently = false;
let workerReqSeq = 1;
const workerCallbacks = new Map<
  number,
  {
    resolve: (val: ProcessedCaptureResult) => void;
    reject: (err: Error) => void;
  }
>();

function isOffscreen2dSupported(): boolean {
  if (
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

function getOrCreateImageWorker(): Worker | null {
  if (
    workerFailedPermanently ||
    typeof Worker === 'undefined' ||
    !isOffscreen2dSupported()
  ) {
    return null;
  }
  if (!workerInstance) {
    try {
      workerInstance = new Worker(new URL('./imageWorker.ts', import.meta.url), {
        type: 'module',
      });
      workerInstance.onmessage = (
        ev: MessageEvent<{
          id: number;
          ok: boolean;
          dataUrl?: string;
          thumbnailDataUrl?: string;
          width?: number;
          height?: number;
          byteLength?: number;
          processingMs?: number;
          savingMs?: number;
          savedInWorker?: boolean;
          photoId?: string;
          variance?: number;
          isBlurry?: boolean;
          error?: string;
        }>
      ) => {
        const msg = ev.data;
        const cb = workerCallbacks.get(msg.id);
        if (!cb) return;
        workerCallbacks.delete(msg.id);
        if (msg.ok && msg.width && msg.height && (msg.savedInWorker || msg.dataUrl)) {
          cb.resolve({
            dataUrl: msg.dataUrl || '',
            thumbnailDataUrl: msg.thumbnailDataUrl || undefined,
            width: msg.width,
            height: msg.height,
            byteLength: msg.byteLength ?? estimateDataUrlBytes(msg.dataUrl || ''),
            processingMs: msg.processingMs ?? 0,
            savingMs: msg.savingMs ?? 0,
            savedInWorker: Boolean(msg.savedInWorker),
            photoId: msg.photoId,
            variance: msg.variance ?? 100,
            isBlurry: Boolean(msg.isBlurry),
          });
        } else {
          cb.reject(new Error(msg.error || 'Worker failed'));
        }
      };
      workerInstance.onerror = () => {
        workerFailedPermanently = true;
        workerInstance = null;
        for (const [, cb] of workerCallbacks) {
          cb.reject(new Error('Image worker crashed'));
        }
        workerCallbacks.clear();
      };
    } catch {
      workerFailedPermanently = true;
      workerInstance = null;
      return null;
    }
  }
  return workerInstance;
}

/**
 * Resizes (max 4096px), bakes orientation, generates separate thumbnail, encodes JPEG (0.92),
 * checks blur if requested, and writes to IndexedDB inside a Web Worker.
 * Falls back cleanly to main-thread canvas only if Worker/OffscreenCanvas is unavailable.
 */
export async function processCaptureOffThread(options: {
  blob?: Blob;
  bitmap?: ImageBitmap;
  digitalScale?: number;
  rotationDeg?: 0 | 90 | 180 | 270;
  maxDim?: number;
  quality?: number;
  thumbnailMaxDim?: number;
  thumbnailQuality?: number;
  blurThreshold?: number;
  saveToDb?: boolean;
  waitForIdleSlot?: boolean;
  photoMeta?: {
    id: string;
    sessionId: string;
    timestamp: number;
    dateKey: string;
    enhancementStatus?: 'pending';
  };
  fallbackCanvas?: () => HTMLCanvasElement | null;
  fallbackBlurCheck?: (canvas: HTMLCanvasElement) => {
    variance: number;
    isBlurry: boolean;
  };
}): Promise<ProcessedCaptureResult> {
  const maxDim = options.maxDim ?? MAX_SAVED_PHOTO_LONG_SIDE;
  const quality = options.quality ?? SAVED_PHOTO_JPEG_QUALITY;
  const thumbnailMaxDim = options.thumbnailMaxDim ?? THUMBNAIL_MAX_LONG_SIDE;
  const thumbnailQuality = options.thumbnailQuality ?? THUMBNAIL_JPEG_QUALITY;
  const digitalScale = options.digitalScale ?? 1;
  const rotationDeg = options.rotationDeg ?? 0;
  const blurThreshold = options.blurThreshold ?? 42;

  if (options.waitForIdleSlot) {
    await waitForBackgroundSlot({ requireIdle: true });
  }

  const worker = getOrCreateImageWorker();
  if (worker && (options.blob || options.bitmap)) {
    try {
      return await runExclusiveWorkerTask(
        () =>
          new Promise<ProcessedCaptureResult>((resolve, reject) => {
            const id = workerReqSeq++;
            workerCallbacks.set(id, { resolve, reject });
            const payload = {
              id,
              blob: options.blob,
              bitmap: options.bitmap,
              digitalScale,
              rotationDeg,
              maxDim,
              quality,
              thumbnailMaxDim,
              thumbnailQuality,
              blurThreshold,
              saveToDb: Boolean(options.saveToDb),
              photoMeta: options.photoMeta,
            };
            if (options.bitmap) {
              worker.postMessage(payload, [options.bitmap]);
            } else {
              worker.postMessage(payload);
            }
          })
      );
    } catch {
      // Fallback below if worker runtime rejects OffscreenCanvas
    }
  }

  // Fallback on main thread: guard against detached ImageBitmap (width === 0 after transfer)
  const procStart = performance.now();
  let canvas: HTMLCanvasElement | null = null;
  if (options.bitmap && options.bitmap.width > 0 && options.bitmap.height > 0) {
    const bmp = options.bitmap;
    const scale = digitalScale > 1.01 ? digitalScale : 1;
    const sw = bmp.width / scale;
    const sh = bmp.height / scale;
    const sx = (bmp.width - sw) / 2;
    const sy = (bmp.height - sh) / 2;
    const quarterTurn = rotationDeg === 90 || rotationDeg === 270;
    const target = calculateTargetDimensions(
      quarterTurn ? sh : sw,
      quarterTurn ? sw : sh,
      maxDim
    );
    canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      drawCroppedRotatedToCanvas(
        ctx,
        bmp,
        sx,
        sy,
        sw,
        sh,
        target.width,
        target.height,
        rotationDeg
      );
    }
    try {
      bmp.close();
    } catch {
      // ignore
    }
  } else if (options.blob && typeof createImageBitmap === 'function') {
    let bmp: ImageBitmap;
    try {
      bmp = await createImageBitmap(options.blob, {
        imageOrientation: 'from-image',
      });
    } catch {
      bmp = await createImageBitmap(options.blob);
    }
    const scale = digitalScale > 1.01 ? digitalScale : 1;
    const sw = bmp.width / scale;
    const sh = bmp.height / scale;
    const sx = (bmp.width - sw) / 2;
    const sy = (bmp.height - sh) / 2;
    const quarterTurn = rotationDeg === 90 || rotationDeg === 270;
    const target = calculateTargetDimensions(
      quarterTurn ? sh : sw,
      quarterTurn ? sw : sh,
      maxDim
    );
    canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      drawCroppedRotatedToCanvas(
        ctx,
        bmp,
        sx,
        sy,
        sw,
        sh,
        target.width,
        target.height,
        rotationDeg
      );
    }
    bmp.close();
  }

  if (!canvas && options.fallbackCanvas) {
    canvas = options.fallbackCanvas();
  }

  if (!canvas) {
    throw new Error('تعذر معالجة الصورة الملتقطة');
  }

  const compressed = compressCanvasToJpeg(canvas, maxDim, quality);
  const blur = options.fallbackBlurCheck
    ? options.fallbackBlurCheck(canvas)
    : { variance: 100, isBlurry: false };
  const processingMs = Math.max(1, Math.round(performance.now() - procStart));

  return {
    dataUrl: compressed.dataUrl,
    thumbnailDataUrl: compressed.thumbnailDataUrl,
    width: compressed.width,
    height: compressed.height,
    byteLength: compressed.byteLength,
    processingMs,
    savingMs: 0,
    savedInWorker: false,
    photoId: options.photoMeta?.id,
    variance: blur.variance,
    isBlurry: blur.isBlurry,
  };
}

/**
 * Permanently rotates a saved dataUrl photo 90 degrees clockwise and re-encodes as EXIF-free JPEG.
 */
export async function rotateDataUrl90CW(
  dataUrl: string,
  maxDim: number = MAX_SAVED_PHOTO_LONG_SIDE,
  quality: number = SAVED_PHOTO_JPEG_QUALITY
): Promise<{ dataUrl: string; thumbnailDataUrl: string; width: number; height: number }> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('تعذر تحميل الصورة للتدوير'));
    img.src = dataUrl;
  });

  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) {
    return { dataUrl, thumbnailDataUrl: dataUrl, width: 1, height: 1 };
  }

  const target = calculateTargetDimensions(ih, iw, maxDim);
  const canvas = document.createElement('canvas');
  canvas.width = target.width;
  canvas.height = target.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { dataUrl, thumbnailDataUrl: dataUrl, width: iw, height: ih };
  }

  drawCroppedRotatedToCanvas(
    ctx,
    img,
    0,
    0,
    iw,
    ih,
    target.width,
    target.height,
    90
  );

  const compressed = compressCanvasToJpeg(canvas, maxDim, quality);
  return {
    dataUrl: compressed.dataUrl,
    thumbnailDataUrl: compressed.thumbnailDataUrl,
    width: compressed.width,
    height: compressed.height,
  };
}
