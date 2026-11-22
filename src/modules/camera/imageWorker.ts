/**
 * Web Worker for off-thread camera capture resizing, orientation baking,
 * EXIF-free JPEG encoding, and blur detection using createImageBitmap + OffscreenCanvas.
 */

interface WorkerProcessRequest {
  id: number;
  blob?: Blob;
  bitmap?: ImageBitmap;
  digitalScale?: number;
  rotationDeg?: 0 | 90 | 180 | 270;
  maxDim: number;
  quality: number;
  blurThreshold: number;
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

function computeLaplacianVar(
  grayPixels: Uint8Array,
  width: number,
  height: number
): number {
  if (width < 3 || height < 3 || grayPixels.length < width * height) return 0;
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    const prev = (y - 1) * width;
    const next = (y + 1) * width;
    for (let x = 1; x < width - 1; x++) {
      const lap =
        grayPixels[prev + x] +
        grayPixels[next + x] +
        grayPixels[row + x - 1] +
        grayPixels[row + x + 1] -
        4 * grayPixels[row + x];
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }
  if (count === 0) return 0;
  const mean = sum / count;
  return Math.max(0, sumSq / count - mean * mean);
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
    listener: (e: MessageEvent<WorkerProcessRequest>) => void
  ) => void;
  postMessage: (message: unknown) => void;
};

workerScope.addEventListener('message', async (event) => {
  const {
    id,
    blob,
    bitmap: incomingBitmap,
    digitalScale = 1,
    rotationDeg = 0,
    maxDim,
    quality,
    blurThreshold,
  } = event.data;

  let bitmap: ImageBitmap | null = incomingBitmap || null;
  try {
    if (!bitmap && blob) {
      bitmap = await createUprightBitmapFromBlob(blob);
    }
    if (!bitmap) {
      throw new Error('No image source provided');
    }

    const srcW = bitmap.width;
    const srcH = bitmap.height;
    const scale = digitalScale > 1.01 ? digitalScale : 1;
    const cropW = srcW / scale;
    const cropH = srcH / scale;
    const cropX = (srcW - cropW) / 2;
    const cropY = (srcH - cropH) / 2;

    const quarterTurn = rotationDeg === 90 || rotationDeg === 270;
    const target = calcTargetDims(
      quarterTurn ? cropH : cropW,
      quarterTurn ? cropW : cropH,
      maxDim
    );
    const outCanvas = new OffscreenCanvas(target.width, target.height);
    const outCtx = outCanvas.getContext('2d');
    if (!outCtx) {
      throw new Error('OffscreenCanvas 2d context unavailable');
    }

    outCtx.imageSmoothingEnabled = true;
    outCtx.imageSmoothingQuality = 'high';
    outCtx.save();
    if (rotationDeg === 90) {
      outCtx.translate(target.width, 0);
      outCtx.rotate(Math.PI / 2);
      outCtx.drawImage(
        bitmap,
        cropX,
        cropY,
        cropW,
        cropH,
        0,
        0,
        target.height,
        target.width
      );
    } else if (rotationDeg === 180) {
      outCtx.translate(target.width, target.height);
      outCtx.rotate(Math.PI);
      outCtx.drawImage(
        bitmap,
        cropX,
        cropY,
        cropW,
        cropH,
        0,
        0,
        target.width,
        target.height
      );
    } else if (rotationDeg === 270) {
      outCtx.translate(0, target.height);
      outCtx.rotate(-Math.PI / 2);
      outCtx.drawImage(
        bitmap,
        cropX,
        cropY,
        cropW,
        cropH,
        0,
        0,
        target.height,
        target.width
      );
    } else {
      outCtx.drawImage(
        bitmap,
        cropX,
        cropY,
        cropW,
        cropH,
        0,
        0,
        target.width,
        target.height
      );
    }
    outCtx.restore();

    let variance = 100;
    let isBlurry = false;
    if (blurThreshold > 0) {
      const blurW = Math.min(200, target.width);
      const blurH = Math.max(12, Math.round((target.height * blurW) / target.width));
      const blurCanvas = new OffscreenCanvas(blurW, blurH);
      const blurCtx = blurCanvas.getContext('2d', { willReadFrequently: true });
      if (blurCtx) {
        blurCtx.drawImage(outCanvas, 0, 0, blurW, blurH);
        const px = blurCtx.getImageData(0, 0, blurW, blurH).data;
        const gray = new Uint8Array(blurW * blurH);
        for (let i = 0, p = 0; i < px.length; i += 4, p++) {
          gray[p] = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
        }
        variance = Math.round(computeLaplacianVar(gray, blurW, blurH) * 10) / 10;
        isBlurry = variance < blurThreshold;
      }
    }

    const jpegBlob = await outCanvas.convertToBlob({
      type: 'image/jpeg',
      quality,
    });
    const dataUrl = await blobToJpegDataUrl(jpegBlob);

    workerScope.postMessage({
      id,
      ok: true,
      dataUrl,
      width: target.width,
      height: target.height,
      variance,
      isBlurry,
    });
  } catch (err) {
    workerScope.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : 'Worker processing failed',
    });
  } finally {
    try {
      bitmap?.close();
    } catch {
      // Ignore close error
    }
  }
});
