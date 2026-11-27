import {
  ActivePhotoEnhanceLevel,
  ENHANCE_TILE_HEIGHT,
  ENHANCE_TILE_PAD,
  accumulateTileStats,
  applyEdgePreservingDenoise,
  applyToneAndColorInPlace,
  applyUnsharpMaskLuminance,
  computeEnhancementPlan,
  createEmptyAnalyzeAccumulator,
  finalizeImageStats,
} from './photoEnhancement';

export interface EnhanceWorkerRequest {
  id: number;
  dataUrl: string;
  level: ActivePhotoEnhanceLevel;
  keepOriginal: boolean;
  quality?: number;
  thumbnailMaxDim?: number;
  thumbnailQuality?: number;
}

export interface EnhanceWorkerResponse {
  id: number;
  ok: boolean;
  dataUrl?: string;
  thumbnailDataUrl?: string;
  originalDataUrl?: string;
  width?: number;
  height?: number;
  enhanceMs?: number;
  beforeLuminance?: number;
  afterLuminance?: number;
  level?: ActivePhotoEnhanceLevel;
  error?: string;
}

function calcTargetDims(
  width: number,
  height: number,
  maxDim: number
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 1, height: 1 };
  if (!Number.isFinite(maxDim) || maxDim <= 0 || (width <= maxDim && height <= maxDim)) {
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

async function createUprightBitmapFromBlob(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    return await createImageBitmap(blob);
  }
}

async function blobToJpegDataUrl(blob: Blob): Promise<string> {
  const scope = self as unknown as {
    FileReaderSync?: new () => { readAsDataURL(b: Blob): string };
  };
  if (typeof scope.FileReaderSync === 'function') {
    try {
      return new scope.FileReaderSync().readAsDataURL(blob);
    } catch {
      // Fallback below
    }
  }
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x2000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

const workerScope = self as unknown as {
  addEventListener: (
    type: 'message',
    listener: (e: MessageEvent<EnhanceWorkerRequest>) => void
  ) => void;
  postMessage: (message: EnhanceWorkerResponse) => void;
};

workerScope.addEventListener('message', async (event) => {
  const {
    id,
    dataUrl,
    level,
    keepOriginal,
    quality = 0.92,
    thumbnailMaxDim = 480,
    thumbnailQuality = 0.8,
  } = event.data;

  let bitmap: ImageBitmap | null = null;
  let outCanvas: OffscreenCanvas | null = null;

  try {
    const startMs = performance.now();
    const res = await fetch(dataUrl);
    const inputBlob = await res.blob();
    bitmap = await createUprightBitmapFromBlob(inputBlob);

    const width = Math.max(1, bitmap.width);
    const height = Math.max(1, bitmap.height);

    outCanvas = new OffscreenCanvas(width, height);
    const ctx = outCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      throw new Error('OffscreenCanvas 2d context unavailable');
    }
    ctx.drawImage(bitmap, 0, 0, width, height);

    try {
      bitmap.close();
    } catch {
      // Ignore close error
    }
    bitmap = null;

    // Pass 1: Analyze luminance histogram & color stats in horizontal tiles
    const acc = createEmptyAnalyzeAccumulator();
    for (let y0 = 0; y0 < height; y0 += ENHANCE_TILE_HEIGHT) {
      const tileH = Math.min(ENHANCE_TILE_HEIGHT, height - y0);
      const tileData = ctx.getImageData(0, y0, width, tileH);
      accumulateTileStats(acc, tileData.data);
    }

    const stats = finalizeImageStats(acc);
    const plan = computeEnhancementPlan(stats, level);

    // Pass 2: Enhance in horizontal tiles using unmodified 2px overlap rows
    const rowByteLen = width * 4;
    let savedTopPadRows: Uint8ClampedArray | null = null;
    let savedTopPadCount = 0;
    let afterSumY = 0;

    for (let y0 = 0; y0 < height; y0 += ENHANCE_TILE_HEIGHT) {
      const y1 = Math.min(height, y0 + ENHANCE_TILE_HEIGHT);
      const tileH = y1 - y0;
      const bottomPadCount = Math.min(ENHANCE_TILE_PAD, height - y1);
      const topPadCount = savedTopPadCount;

      const fetchH = tileH + bottomPadCount;
      const fetched = ctx.getImageData(0, y0, width, fetchH);
      const totalH = topPadCount + tileH + bottomPadCount;

      // Save the unmodified last ENHANCE_TILE_PAD rows of [y0, y1) for the next tile's top border
      const nextPadCount = Math.min(ENHANCE_TILE_PAD, tileH);
      const nextPadRows =
        y1 < height
          ? fetched.data.slice(
              (tileH - nextPadCount) * rowByteLen,
              tileH * rowByteLen
            )
          : null;

      const workRgba = new Uint8ClampedArray(totalH * rowByteLen);
      if (topPadCount > 0 && savedTopPadRows) {
        workRgba.set(savedTopPadRows, 0);
      }
      workRgba.set(fetched.data, topPadCount * rowByteLen);

      // Steps (a), (b), (c), (d)
      applyToneAndColorInPlace(workRgba, plan);

      let stageBuffer = workRgba;

      // Step (f): Light noise reduction ONLY for dark photos (meanLuminance < 80) BEFORE sharpening
      if (plan.applyDenoise) {
        const denoised = new Uint8ClampedArray(stageBuffer.length);
        applyEdgePreservingDenoise(
          stageBuffer,
          denoised,
          width,
          totalH,
          plan.denoiseEdgeThreshold
        );
        stageBuffer = denoised;
      }

      // Step (e): Unsharp mask on luminance (amount 0.4–0.8 scaled by level)
      const sharpened = new Uint8ClampedArray(stageBuffer.length);
      applyUnsharpMaskLuminance(
        stageBuffer,
        sharpened,
        width,
        totalH,
        plan.sharpenAmount,
        plan.sharpenThreshold
      );

      // Copy ONLY the interior [topPadCount .. topPadCount + tileH) rows back
      const innerStart = topPadCount * rowByteLen;
      const innerEnd = (topPadCount + tileH) * rowByteLen;
      const innerSlice = sharpened.subarray(innerStart, innerEnd);
      const outTile = ctx.createImageData(width, tileH);
      outTile.data.set(innerSlice);
      ctx.putImageData(outTile, 0, y0);

      for (let i = 0; i < innerSlice.length; i += 4) {
        afterSumY +=
          0.299 * innerSlice[i] +
          0.587 * innerSlice[i + 1] +
          0.114 * innerSlice[i + 2];
      }

      savedTopPadRows = nextPadRows;
      savedTopPadCount = nextPadRows ? nextPadCount : 0;
    }

    const afterLuminance = afterSumY / Math.max(1, width * height);

    const outBlob = await outCanvas.convertToBlob({
      type: 'image/jpeg',
      quality,
    });
    const enhancedDataUrl = await blobToJpegDataUrl(outBlob);

    // Regenerate thumbnail (480px, quality 0.8)
    let thumbnailDataUrl = enhancedDataUrl;
    const thumbDims = calcTargetDims(width, height, thumbnailMaxDim);
    if (thumbDims.width < width || thumbDims.height < height) {
      const thumbCanvas = new OffscreenCanvas(thumbDims.width, thumbDims.height);
      const thumbCtx = thumbCanvas.getContext('2d');
      if (thumbCtx) {
        thumbCtx.imageSmoothingEnabled = true;
        thumbCtx.imageSmoothingQuality = 'high';
        thumbCtx.drawImage(outCanvas, 0, 0, thumbDims.width, thumbDims.height);
        const thumbBlob = await thumbCanvas.convertToBlob({
          type: 'image/jpeg',
          quality: thumbnailQuality,
        });
        thumbnailDataUrl = await blobToJpegDataUrl(thumbBlob);
      }
      thumbCanvas.width = 0;
      thumbCanvas.height = 0;
    }

    const enhanceMs = Math.max(1, Math.round(performance.now() - startMs));

    workerScope.postMessage({
      id,
      ok: true,
      dataUrl: enhancedDataUrl,
      thumbnailDataUrl,
      ...(keepOriginal ? { originalDataUrl: dataUrl } : {}),
      width,
      height,
      enhanceMs,
      beforeLuminance: Math.round(plan.beforeLuminance * 10) / 10,
      afterLuminance: Math.round(afterLuminance * 10) / 10,
      level,
    });
  } catch (err) {
    workerScope.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : 'Photo enhancement failed',
    });
  } finally {
    try {
      bitmap?.close();
    } catch {
      // Ignore
    }
    if (outCanvas) {
      outCanvas.width = 0;
      outCanvas.height = 0;
    }
  }
});
