/**
 * Client-side blur detection using 3x3 discrete Laplacian variance on downscaled grayscale canvas.
 */

export function computeLaplacianVariance(
  grayPixels: Uint8ClampedArray | Uint8Array | number[],
  width: number,
  height: number
): number {
  if (width < 3 || height < 3 || grayPixels.length < width * height) {
    return 0;
  }

  let sum = 0;
  let sumSq = 0;
  let count = 0;

  for (let y = 1; y < height - 1; y++) {
    const rowOffset = y * width;
    const prevRow = (y - 1) * width;
    const nextRow = (y + 1) * width;

    for (let x = 1; x < width - 1; x++) {
      const center = grayPixels[rowOffset + x];
      const lap =
        grayPixels[prevRow + x] +
        grayPixels[nextRow + x] +
        grayPixels[rowOffset + x - 1] +
        grayPixels[rowOffset + x + 1] -
        4 * center;

      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }

  if (count === 0) return 0;
  const mean = sum / count;
  return Math.max(0, sumSq / count - mean * mean);
}

export const DEFAULT_BLUR_THRESHOLD = 42;

export function checkImageBlurFromCanvas(
  sourceCanvas: HTMLCanvasElement,
  threshold: number = DEFAULT_BLUR_THRESHOLD
): { variance: number; isBlurry: boolean } {
  const srcW = sourceCanvas.width;
  const srcH = sourceCanvas.height;
  if (!srcW || !srcH) {
    return { variance: 0, isBlurry: true };
  }

  const targetW = Math.min(200, srcW);
  const scale = targetW / srcW;
  const targetH = Math.max(12, Math.round(srcH * scale));

  const workCanvas = document.createElement('canvas');
  workCanvas.width = targetW;
  workCanvas.height = targetH;
  const ctx = workCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return { variance: 100, isBlurry: false };
  }

  ctx.drawImage(sourceCanvas, 0, 0, targetW, targetH);
  const imageData = ctx.getImageData(0, 0, targetW, targetH).data;
  const gray = new Uint8Array(targetW * targetH);

  for (let i = 0, p = 0; i < imageData.length; i += 4, p++) {
    gray[p] = Math.round(
      0.299 * imageData[i] + 0.587 * imageData[i + 1] + 0.114 * imageData[i + 2]
    );
  }

  const variance = computeLaplacianVariance(gray, targetW, targetH);
  return {
    variance: Math.round(variance * 10) / 10,
    isBlurry: variance < threshold,
  };
}
