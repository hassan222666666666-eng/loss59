import { NormalizedBox } from '../../types';

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
  maxDim: number = 2048
): { width: number; height: number } {
  if (width <= 0 || height <= 0) {
    return { width: 1, height: 1 };
  }
  if (width <= maxDim && height <= maxDim) {
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
  maxDim: number = 2048,
  quality: number = 0.9
): { dataUrl: string; width: number; height: number } {
  const target = calculateTargetDimensions(
    sourceCanvas.width,
    sourceCanvas.height,
    maxDim
  );

  if (
    target.width === sourceCanvas.width &&
    target.height === sourceCanvas.height
  ) {
    return {
      dataUrl: sourceCanvas.toDataURL('image/jpeg', quality),
      width: target.width,
      height: target.height,
    };
  }

  const outCanvas = document.createElement('canvas');
  outCanvas.width = target.width;
  outCanvas.height = target.height;
  const ctx = outCanvas.getContext('2d');
  if (!ctx) {
    return {
      dataUrl: sourceCanvas.toDataURL('image/jpeg', quality),
      width: sourceCanvas.width,
      height: sourceCanvas.height,
    };
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sourceCanvas, 0, 0, target.width, target.height);

  return {
    dataUrl: outCanvas.toDataURL('image/jpeg', quality),
    width: target.width,
    height: target.height,
  };
}

export async function fileOrDataUrlToCanvas(
  source: File | string,
  maxDim: number = 2048
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
  width: number;
  height: number;
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
          width?: number;
          height?: number;
          variance?: number;
          isBlurry?: boolean;
          error?: string;
        }>
      ) => {
        const msg = ev.data;
        const cb = workerCallbacks.get(msg.id);
        if (!cb) return;
        workerCallbacks.delete(msg.id);
        if (msg.ok && msg.dataUrl && msg.width && msg.height) {
          cb.resolve({
            dataUrl: msg.dataUrl,
            width: msg.width,
            height: msg.height,
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
 * Resizes, crops (if digital zoom > 1), compresses to max 2048px JPEG, and checks blur
 * inside a Web Worker using createImageBitmap + OffscreenCanvas. Falls back cleanly
 * to main-thread createImageBitmap/canvas only if Worker/OffscreenCanvas is unavailable.
 */
export async function processCaptureOffThread(options: {
  blob?: Blob;
  bitmap?: ImageBitmap;
  digitalScale?: number;
  rotationDeg?: 0 | 90 | 180 | 270;
  maxDim?: number;
  quality?: number;
  blurThreshold?: number;
  fallbackCanvas?: () => HTMLCanvasElement | null;
  fallbackBlurCheck?: (canvas: HTMLCanvasElement) => {
    variance: number;
    isBlurry: boolean;
  };
}): Promise<ProcessedCaptureResult> {
  const maxDim = options.maxDim ?? 2048;
  const quality = options.quality ?? 0.9;
  const digitalScale = options.digitalScale ?? 1;
  const rotationDeg = options.rotationDeg ?? 0;
  const blurThreshold = options.blurThreshold ?? 42;

  const worker = getOrCreateImageWorker();
  if (worker && (options.blob || options.bitmap)) {
    try {
      return await new Promise<ProcessedCaptureResult>((resolve, reject) => {
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
          blurThreshold,
        };
        if (options.bitmap) {
          worker.postMessage(payload, [options.bitmap]);
        } else {
          worker.postMessage(payload);
        }
      });
    } catch {
      // Fallback below if worker runtime rejects OffscreenCanvas
    }
  }

  // Fallback on main thread: guard against detached ImageBitmap (width === 0 after transfer)
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
  return {
    ...compressed,
    variance: blur.variance,
    isBlurry: blur.isBlurry,
  };
}

/**
 * Permanently rotates a saved dataUrl photo 90 degrees clockwise and re-encodes as EXIF-free JPEG.
 */
export async function rotateDataUrl90CW(
  dataUrl: string,
  maxDim: number = 2048,
  quality: number = 0.9
): Promise<{ dataUrl: string; width: number; height: number }> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('تعذر تحميل الصورة للتدوير'));
    img.src = dataUrl;
  });

  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) {
    return { dataUrl, width: 1, height: 1 };
  }

  const target = calculateTargetDimensions(ih, iw, maxDim);
  const canvas = document.createElement('canvas');
  canvas.width = target.width;
  canvas.height = target.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { dataUrl, width: iw, height: ih };
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

  return {
    dataUrl: canvas.toDataURL('image/jpeg', quality),
    width: target.width,
    height: target.height,
  };
}

function isValidBox(box?: NormalizedBox | null): box is NormalizedBox {
  return Boolean(
    box &&
      Number.isFinite(box.x) &&
      Number.isFinite(box.y) &&
      Number.isFinite(box.w) &&
      Number.isFinite(box.h) &&
      box.w > 0.015 &&
      box.h > 0.015
  );
}

/**
 * Crops the productBox (or gapBox fallback) from the full shelf photo cleanly (default 256px for permanent product thumbnail).
 */
export async function cropProductBoxFromDataUrl(
  photoDataUrl: string,
  productBox: NormalizedBox,
  fallbackBox?: NormalizedBox,
  maxCropDim: number = 256
): Promise<string> {
  const chosen = isValidBox(productBox)
    ? productBox
    : isValidBox(fallbackBox)
    ? fallbackBox
    : { x: 0.2, y: 0.2, w: 0.6, h: 0.6 };

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const iw = img.naturalWidth || img.width;
      const ih = img.naturalHeight || img.height;
      if (!iw || !ih) {
        resolve(photoDataUrl);
        return;
      }

      const padX = Math.min(0.03, chosen.w * 0.1);
      const padY = Math.min(0.03, chosen.h * 0.1);

      const x0 = Math.max(0, chosen.x - padX);
      const y0 = Math.max(0, chosen.y - padY);
      const x1 = Math.min(1, chosen.x + chosen.w + padX);
      const y1 = Math.min(1, chosen.y + chosen.h + padY);

      const sx = Math.max(0, Math.floor(x0 * iw));
      const sy = Math.max(0, Math.floor(y0 * ih));
      const sw = Math.max(16, Math.min(iw - sx, Math.ceil((x1 - x0) * iw)));
      const sh = Math.max(16, Math.min(ih - sy, Math.ceil((y1 - y0) * ih)));

      const outDim = calculateTargetDimensions(sw, sh, maxCropDim);
      const canvas = document.createElement('canvas');
      canvas.width = outDim.width;
      canvas.height = outDim.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(photoDataUrl);
        return;
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outDim.width, outDim.height);
      resolve(canvas.toDataURL('image/jpeg', 0.9));
    };

    img.onerror = () => resolve(photoDataUrl);
    img.src = photoDataUrl;
  });
}

/**
 * Expands a gapBox to at least 40% of photo width and 30% of photo height,
 * centered on the gap and clamped to the photo bounds [0..1].
 */
export function computeContextWindow(gapBox: NormalizedBox): {
  windowBox: NormalizedBox;
  relativeGapBox: NormalizedBox;
} {
  const winW = Math.min(1, Math.max(0.4, gapBox.w + 0.22));
  const winH = Math.min(1, Math.max(0.3, gapBox.h + 0.16));

  const cx = gapBox.x + gapBox.w / 2;
  const cy = gapBox.y + gapBox.h / 2;

  const x = Math.max(0, Math.min(1 - winW, cx - winW / 2));
  const y = Math.max(0, Math.min(1 - winH, cy - winH / 2));

  const windowBox: NormalizedBox = { x, y, w: winW, h: winH };
  const relativeGapBox: NormalizedBox = {
    x: Math.max(0, Math.min(1, (gapBox.x - x) / winW)),
    y: Math.max(0, Math.min(1, (gapBox.y - y) / winH)),
    w: Math.max(0.02, Math.min(1, gapBox.w / winW)),
    h: Math.max(0.02, Math.min(1, gapBox.h / winH)),
  };

  return { windowBox, relativeGapBox };
}

/**
 * Crops the contextual shelf area around a gap preserving original aspect ratio.
 */
export async function cropContextAreaFromDataUrl(
  photoDataUrl: string,
  gapBox: NormalizedBox
): Promise<{
  cropDataUrl: string;
  relativeGapBox: NormalizedBox;
  aspectRatio: number;
}> {
  const { windowBox, relativeGapBox } = computeContextWindow(gapBox);

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const iw = img.naturalWidth || img.width;
      const ih = img.naturalHeight || img.height;
      if (!iw || !ih) {
        resolve({
          cropDataUrl: photoDataUrl,
          relativeGapBox: gapBox,
          aspectRatio: 4 / 3,
        });
        return;
      }

      const sx = Math.max(0, Math.floor(windowBox.x * iw));
      const sy = Math.max(0, Math.floor(windowBox.y * ih));
      const sw = Math.max(24, Math.min(iw - sx, Math.ceil(windowBox.w * iw)));
      const sh = Math.max(24, Math.min(ih - sy, Math.ceil(windowBox.h * ih)));

      const outDim = calculateTargetDimensions(sw, sh, 1024);
      const canvas = document.createElement('canvas');
      canvas.width = outDim.width;
      canvas.height = outDim.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve({
          cropDataUrl: photoDataUrl,
          relativeGapBox,
          aspectRatio: sw / sh,
        });
        return;
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outDim.width, outDim.height);

      resolve({
        cropDataUrl: canvas.toDataURL('image/jpeg', 0.9),
        relativeGapBox,
        aspectRatio: outDim.width / outDim.height,
      });
    };

    img.onerror = () =>
      resolve({
        cropDataUrl: photoDataUrl,
        relativeGapBox: gapBox,
        aspectRatio: 4 / 3,
      });
    img.src = photoDataUrl;
  });
}

/**
 * Splits a shelf photo dataUrl into Left [0..0.6] and Right [0.4..1.0] halves (20% overlap)
 * at max 2048px for high-resolution Gemini analysis.
 */
export async function splitPhotoDataUrlIntoTwoHalves(
  photoDataUrl: string
): Promise<{ leftDataUrl: string; rightDataUrl: string }> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('تعذر قراءة الصورة للتحليل'));
    img.src = photoDataUrl;
  });

  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) {
    return { leftDataUrl: photoDataUrl, rightDataUrl: photoDataUrl };
  }

  const cropSlice = (offsetX: number, spanX: number): string => {
    const sx = Math.floor(offsetX * iw);
    const sw = Math.max(32, Math.min(iw - sx, Math.ceil(spanX * iw)));
    const target = calculateTargetDimensions(sw, ih, 2048);
    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return photoDataUrl;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, 0, sw, ih, 0, 0, target.width, target.height);
    return canvas.toDataURL('image/jpeg', 0.9);
  };

  return {
    leftDataUrl: cropSlice(0, 0.6),
    rightDataUrl: cropSlice(0.4, 0.6),
  };
}
