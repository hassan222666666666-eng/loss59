import { PhotoEnhanceLevel } from '../../types';

export type ActivePhotoEnhanceLevel = Exclude<PhotoEnhanceLevel, 'off'>;

export const ENHANCE_TIMEOUT_MS = 8000;
export const ENHANCE_TILE_HEIGHT = 256;
export const ENHANCE_TILE_PAD = 2;
export const DARK_DENOISE_LUMA_THRESHOLD = 80;
export const AUTO_EXPOSURE_LUMA_THRESHOLD = 110;

export const ENHANCE_LEVEL_STRENGTH: Record<ActivePhotoEnhanceLevel, number> = {
  light: 0.5,
  medium: 1.0,
  strong: 1.5,
};

export interface ImageAnalyzeAccumulator {
  pixelCount: number;
  histogram: Uint32Array;
  sumY: number;
  sumR: number;
  sumG: number;
  sumB: number;
}

export interface AnalyzedImageStats {
  pixelCount: number;
  histogram: Uint32Array;
  meanLuminance: number;
  meanR: number;
  meanG: number;
  meanB: number;
  isSingleColorDominated: boolean;
}

export interface EnhancementPlan {
  level: ActivePhotoEnhanceLevel;
  strength: number;
  beforeLuminance: number;
  gamma: number;
  exposureLut: Uint8Array;
  contrastLow: number;
  contrastHigh: number;
  contrastTargetLow: number;
  contrastScaleStrength: number;
  rGain: number;
  gGain: number;
  bGain: number;
  wbSkipped: boolean;
  satBoost: number;
  applyDenoise: boolean;
  denoiseEdgeThreshold: number;
  sharpenAmount: number;
  sharpenThreshold: number;
}

function clampByte(v: number): number {
  if (v <= 0) return 0;
  if (v >= 255) return 255;
  return v < 0 ? 0 : Math.round(v);
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function resolveEnhanceLevel(
  level?: PhotoEnhanceLevel | null
): ActivePhotoEnhanceLevel | null {
  if (level === 'off') return null;
  if (level === 'light' || level === 'medium' || level === 'strong') {
    return level;
  }
  return 'medium';
}

export function formatEnhanceLevelLabel(
  level?: PhotoEnhanceLevel | null
): string {
  switch (level) {
    case 'off':
      return 'إيقاف';
    case 'light':
      return 'خفيف';
    case 'strong':
      return 'قوي';
    case 'medium':
      return 'متوسط';
    default:
      return 'لم يُنفّذ بعد';
  }
}

export function createEmptyAnalyzeAccumulator(): ImageAnalyzeAccumulator {
  return {
    pixelCount: 0,
    histogram: new Uint32Array(256),
    sumY: 0,
    sumR: 0,
    sumG: 0,
    sumB: 0,
  };
}

export function accumulateTileStats(
  acc: ImageAnalyzeAccumulator,
  rgba: Uint8ClampedArray | Uint8Array
): void {
  const hist = acc.histogram;
  let sumY = acc.sumY;
  let sumR = acc.sumR;
  let sumG = acc.sumG;
  let sumB = acc.sumB;
  let count = acc.pixelCount;

  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    const bin = y <= 0 ? 0 : y >= 255 ? 255 : Math.round(y);
    hist[bin]++;
    sumY += y;
    sumR += r;
    sumG += g;
    sumB += b;
    count++;
  }

  acc.sumY = sumY;
  acc.sumR = sumR;
  acc.sumG = sumG;
  acc.sumB = sumB;
  acc.pixelCount = count;
}

export function finalizeImageStats(
  acc: ImageAnalyzeAccumulator
): AnalyzedImageStats {
  const n = Math.max(1, acc.pixelCount);
  const meanLuminance = acc.sumY / n;
  const meanR = acc.sumR / n;
  const meanG = acc.sumG / n;
  const meanB = acc.sumB / n;

  const avgRgb = (meanR + meanG + meanB) / 3;
  const maxC = Math.max(meanR, meanG, meanB);
  const minC = Math.min(meanR, meanG, meanB);
  const maxDeviation = Math.max(
    Math.abs(meanR - avgRgb),
    Math.abs(meanG - avgRgb),
    Math.abs(meanB - avgRgb)
  );
  const spreadRatio = maxDeviation / Math.max(14, avgRgb);
  const dominanceRatio = maxC / Math.max(10, minC);

  // Skip gray-world WB when a single strong color clearly dominates the frame
  const isSingleColorDominated =
    acc.pixelCount > 0 &&
    avgRgb > 8 &&
    (spreadRatio >= 0.24 || dominanceRatio >= 1.65);

  return {
    pixelCount: acc.pixelCount,
    histogram: acc.histogram,
    meanLuminance,
    meanR,
    meanG,
    meanB,
    isSingleColorDominated,
  };
}

function findPercentileBin(
  hist: Uint32Array,
  totalPixels: number,
  fraction: number
): number {
  if (totalPixels <= 0) return 0;
  const target = totalPixels * fraction;
  let running = 0;
  for (let i = 0; i < 256; i++) {
    running += hist[i];
    if (running >= target) return i;
  }
  return 255;
}

export function computeEnhancementPlan(
  stats: AnalyzedImageStats,
  level: ActivePhotoEnhanceLevel
): EnhancementPlan {
  const strength = ENHANCE_LEVEL_STRENGTH[level];
  const meanY = stats.meanLuminance;

  // (a) Auto exposure: lift dark images with gamma in [0.6, 1.0]; leave >=110 untouched
  let gamma = 1.0;
  if (meanY < AUTO_EXPOSURE_LUMA_THRESHOLD) {
    const deficit = clamp(
      (AUTO_EXPOSURE_LUMA_THRESHOLD - meanY) / AUTO_EXPOSURE_LUMA_THRESHOLD,
      0,
      1
    );
    gamma = clamp(1.0 - deficit * 0.34 * strength, 0.6, 1.0);
  }

  const exposureLut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    exposureLut[i] =
      gamma < 0.999 ? clampByte(255 * Math.pow(i / 255, gamma)) : i;
  }

  // Remap luminance histogram through exposureLut for post-exposure contrast range
  const postExposureHist = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    if (stats.histogram[i] > 0) {
      postExposureHist[exposureLut[i]] += stats.histogram[i];
    }
  }

  // (b) Auto contrast between 0.5% and 99.5% percentiles
  const pLow = findPercentileBin(postExposureHist, stats.pixelCount, 0.005);
  const pHigh = findPercentileBin(postExposureHist, stats.pixelCount, 0.995);
  const span = pHigh - pLow;
  // Preserve lifted shadow floor on underexposed scenes so contrast doesn't undo exposure gamma lift
  const contrastTargetLow =
    gamma < 0.999 ? Math.round(pLow * 0.85) : Math.min(Math.round(pLow * 0.25), 14);
  // Skip flat/solid surfaces (<16 gray levels span) to avoid amplifying noise
  const contrastScaleStrength =
    span >= 16 ? clamp(0.45 + 0.25 * strength, 0.45, 0.9) : 0;

  // (c) Gentle gray-world white balance with tight clamp; skipped on single-color dominance
  let rGain = 1;
  let gGain = 1;
  let bGain = 1;
  const wbSkipped = stats.isSingleColorDominated || stats.pixelCount === 0;
  if (!wbSkipped) {
    const avgRgb = (stats.meanR + stats.meanG + stats.meanB) / 3;
    if (avgRgb > 6) {
      const minBound = level === 'light' ? 0.95 : 0.9;
      const maxBound = level === 'light' ? 1.05 : 1.1;
      const wbBlend =
        level === 'light' ? 0.55 : level === 'medium' ? 0.85 : 1.0;

      const rawR = avgRgb / Math.max(4, stats.meanR);
      const rawG = avgRgb / Math.max(4, stats.meanG);
      const rawB = avgRgb / Math.max(4, stats.meanB);

      rGain = clamp(1 + (rawR - 1) * wbBlend, minBound, maxBound);
      gGain = clamp(1 + (rawG - 1) * wbBlend, minBound, maxBound);
      bGain = clamp(1 + (rawB - 1) * wbBlend, minBound, maxBound);
    }
  }

  // (d) Saturation boost: +8% scaled by level (0.5 -> +4%, 1.0 -> +8%, 1.5 -> +12%)
  const satBoost = 0.08 * strength;

  // (f) Light noise reduction ONLY for dark photos (meanLuminance < 80) before sharpening
  const applyDenoise = stats.pixelCount > 0 && meanY < DARK_DENOISE_LUMA_THRESHOLD;
  const denoiseEdgeThreshold = 24 + 6 * strength;

  // (e) Unsharp mask (amount 0.4–0.8 scaled by level, threshold prevents amplifying flat noise)
  const sharpenAmount =
    level === 'light' ? 0.4 : level === 'medium' ? 0.6 : 0.8;
  const sharpenThreshold = level === 'light' ? 7 : level === 'medium' ? 6 : 5;

  return {
    level,
    strength,
    beforeLuminance: meanY,
    gamma,
    exposureLut,
    contrastLow: pLow,
    contrastHigh: pHigh,
    contrastTargetLow,
    contrastScaleStrength,
    rGain,
    gGain,
    bGain,
    wbSkipped,
    satBoost,
    applyDenoise,
    denoiseEdgeThreshold,
    sharpenAmount,
    sharpenThreshold,
  };
}

function computeSkinProtectionFactor(r: number, g: number, b: number): number {
  // Smooth skin-tone guard in 0..255 sRGB range
  if (r <= 80 || g <= 35 || b <= 18) return 1;
  const maxC = Math.max(r, g, b);
  const minC = Math.min(r, g, b);
  if (maxC - minC <= 12) return 1;
  if (r <= g || r <= b || r - g <= 10) return 1;
  if (g >= r * 0.94 || g <= r * 0.34 || b >= g * 0.96) return 1;
  return 0.12;
}

/**
 * Steps a (auto exposure), b (same-gain contrast stretch), c (gentle WB), d (protected saturation).
 */
export function applyToneAndColorInPlace(
  rgba: Uint8ClampedArray | Uint8Array,
  plan: EnhancementPlan
): void {
  const {
    gamma,
    exposureLut,
    contrastLow,
    contrastHigh,
    contrastTargetLow,
    contrastScaleStrength,
    rGain,
    gGain,
    bGain,
    satBoost,
  } = plan;
  const span = Math.max(1, contrastHigh - contrastLow);
  const targetSpan = Math.max(1, 255 - contrastTargetLow);
  const hasExposureLift = gamma < 0.999;
  const hasContrast = contrastScaleStrength > 0;
  const hasWb =
    Math.abs(rGain - 1) > 1e-4 ||
    Math.abs(gGain - 1) > 1e-4 ||
    Math.abs(bGain - 1) > 1e-4;

  for (let i = 0; i < rgba.length; i += 4) {
    let r = rgba[i];
    let g = rgba[i + 1];
    let b = rgba[i + 2];

    // Step (a): Auto exposure gamma lift without clipping highlights
    if (hasExposureLift) {
      const yIn = 0.299 * r + 0.587 * g + 0.114 * b;
      if (yIn > 0.5) {
        const yBin = yIn >= 255 ? 255 : Math.round(yIn);
        const yOut = exposureLut[yBin];
        let expScale = yOut / yIn;
        const maxC = Math.max(r, g, b);
        if (maxC > 0 && maxC * expScale > 255) {
          expScale = Math.max(1, 255 / maxC);
        }
        r = clamp(r * expScale, 0, 255);
        g = clamp(g * expScale, 0, 255);
        b = clamp(b * expScale, 0, 255);
      }
    }

    // Step (b): Auto contrast between 0.5% and 99.5% with identical gain across R, G, B
    if (hasContrast) {
      const yCur = 0.299 * r + 0.587 * g + 0.114 * b;
      if (yCur > 0.5) {
        const clampedY = clamp(yCur, contrastLow, contrastHigh);
        const stretchedY =
          contrastTargetLow + ((clampedY - contrastLow) / span) * targetSpan;
        const targetGain = stretchedY / yCur;
        const blendedGain = clamp(
          1 + (targetGain - 1) * contrastScaleStrength,
          0.35,
          1.75
        );
        const maxC = Math.max(r, g, b);
        const safeGain =
          maxC > 0 && blendedGain > 1
            ? Math.min(blendedGain, 255 / maxC)
            : blendedGain;
        r = clamp(r * safeGain, 0, 255);
        g = clamp(g * safeGain, 0, 255);
        b = clamp(b * safeGain, 0, 255);
      }
    }

    // Step (c): Gentle white balance gains clamped to [0.9, 1.1] (or [0.95, 1.05])
    if (hasWb) {
      r = clamp(r * rGain, 0, 255);
      g = clamp(g * gGain, 0, 255);
      b = clamp(b * bGain, 0, 255);
    }

    // Step (d): Saturation +8% scaled by level, protecting skin tones & already-saturated pixels
    if (satBoost > 0) {
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      if (maxC > 4 && maxC > minC) {
        const sat = (maxC - minC) / maxC;
        const satHeadroom = clamp((0.78 - sat) / 0.45, 0, 1);
        const skinFactor = computeSkinProtectionFactor(r, g, b);
        const effectiveBoost = satBoost * satHeadroom * skinFactor;
        if (effectiveBoost > 0.001) {
          const ySat = 0.299 * r + 0.587 * g + 0.114 * b;
          const mult = 1 + effectiveBoost;
          r = ySat + (r - ySat) * mult;
          g = ySat + (g - ySat) * mult;
          b = ySat + (b - ySat) * mult;
        }
      }
    }

    rgba[i] = clampByte(r);
    rgba[i + 1] = clampByte(g);
    rgba[i + 2] = clampByte(b);
  }
}

/**
 * Step (f): Light 3x3 edge-preserving range filter for dark photos (meanLuminance < 80).
 * Executed BEFORE sharpening so noise isn't amplified.
 */
export function applyEdgePreservingDenoise(
  srcRgba: Uint8ClampedArray | Uint8Array,
  dstRgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  edgeThreshold: number = 30
): void {
  if (width < 3 || height < 3) {
    dstRgba.set(srcRgba);
    return;
  }

  const luma = new Float32Array(width * height);
  for (let i = 0, p = 0; p < luma.length; i += 4, p++) {
    luma[p] =
      0.299 * srcRgba[i] + 0.587 * srcRgba[i + 1] + 0.114 * srcRgba[i + 2];
  }

  const invEdge = 1 / Math.max(1, edgeThreshold);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const centerIdx = (y * width + x) * 4;
      if (y === 0 || y === height - 1 || x === 0 || x === width - 1) {
        dstRgba[centerIdx] = srcRgba[centerIdx];
        dstRgba[centerIdx + 1] = srcRgba[centerIdx + 1];
        dstRgba[centerIdx + 2] = srcRgba[centerIdx + 2];
        dstRgba[centerIdx + 3] = srcRgba[centerIdx + 3];
        continue;
      }

      const cY = luma[y * width + x];
      let wSum = 0;
      let rAcc = 0;
      let gAcc = 0;
      let bAcc = 0;

      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        const rowOff = ny * width;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const nP = rowOff + nx;
          const diff = Math.abs(luma[nP] - cY);
          if (diff >= edgeThreshold) continue;
          const spatialW = dx === 0 && dy === 0 ? 2.0 : dx === 0 || dy === 0 ? 1.0 : 0.7;
          const rangeW = 1 - diff * invEdge;
          const w = spatialW * rangeW;
          const nIdx = nP * 4;
          wSum += w;
          rAcc += srcRgba[nIdx] * w;
          gAcc += srcRgba[nIdx + 1] * w;
          bAcc += srcRgba[nIdx + 2] * w;
        }
      }

      if (wSum > 0) {
        dstRgba[centerIdx] = clampByte(rAcc / wSum);
        dstRgba[centerIdx + 1] = clampByte(gAcc / wSum);
        dstRgba[centerIdx + 2] = clampByte(bAcc / wSum);
      } else {
        dstRgba[centerIdx] = srcRgba[centerIdx];
        dstRgba[centerIdx + 1] = srcRgba[centerIdx + 1];
        dstRgba[centerIdx + 2] = srcRgba[centerIdx + 2];
      }
      dstRgba[centerIdx + 3] = srcRgba[centerIdx + 3];
    }
  }
}

/**
 * Step (e): Unsharp mask on luminance (5-tap separable Gaussian ~1.2px radius)
 * with coring threshold so flat areas & noise are not amplified, applied uniformly across RGB.
 */
export function applyUnsharpMaskLuminance(
  srcRgba: Uint8ClampedArray | Uint8Array,
  dstRgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  amount: number,
  threshold: number
): void {
  if (width < 3 || height < 3 || amount <= 0) {
    dstRgba.set(srcRgba);
    return;
  }

  const total = width * height;
  const luma = new Float32Array(total);
  const horiz = new Float32Array(total);
  const blurred = new Float32Array(total);

  for (let i = 0, p = 0; p < total; i += 4, p++) {
    luma[p] =
      0.299 * srcRgba[i] + 0.587 * srcRgba[i + 1] + 0.114 * srcRgba[i + 2];
  }

  // Horizontal pass: [1, 4, 6, 4, 1] / 16
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const xm2 = x >= 2 ? x - 2 : 0;
      const xm1 = x >= 1 ? x - 1 : 0;
      const xp1 = x + 1 < width ? x + 1 : width - 1;
      const xp2 = x + 2 < width ? x + 2 : width - 1;
      horiz[row + x] =
        (luma[row + xm2] +
          4 * luma[row + xm1] +
          6 * luma[row + x] +
          4 * luma[row + xp1] +
          luma[row + xp2]) *
        0.0625;
    }
  }

  // Vertical pass: [1, 4, 6, 4, 1] / 16
  for (let y = 0; y < height; y++) {
    const ym2 = (y >= 2 ? y - 2 : 0) * width;
    const ym1 = (y >= 1 ? y - 1 : 0) * width;
    const y0 = y * width;
    const yp1 = (y + 1 < height ? y + 1 : height - 1) * width;
    const yp2 = (y + 2 < height ? y + 2 : height - 1) * width;

    for (let x = 0; x < width; x++) {
      blurred[y0 + x] =
        (horiz[ym2 + x] +
          4 * horiz[ym1 + x] +
          6 * horiz[y0 + x] +
          4 * horiz[yp1 + x] +
          horiz[yp2 + x]) *
        0.0625;
    }
  }

  for (let p = 0, i = 0; p < total; p++, i += 4) {
    const diff = luma[p] - blurred[p];
    const absDiff = Math.abs(diff);
    if (absDiff > threshold) {
      const excess = (absDiff - threshold) * (diff > 0 ? 1 : -1);
      const delta = clamp(excess * amount, -48, 48);
      dstRgba[i] = clampByte(srcRgba[i] + delta);
      dstRgba[i + 1] = clampByte(srcRgba[i + 1] + delta);
      dstRgba[i + 2] = clampByte(srcRgba[i + 2] + delta);
    } else {
      dstRgba[i] = srcRgba[i];
      dstRgba[i + 1] = srcRgba[i + 1];
      dstRgba[i + 2] = srcRgba[i + 2];
    }
    dstRgba[i + 3] = srcRgba[i + 3];
  }
}

export function computeMeanLuminance(
  rgba: Uint8ClampedArray | Uint8Array
): number {
  if (rgba.length < 4) return 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    sum += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    count++;
  }
  return count > 0 ? sum / count : 0;
}

/**
 * Convenience full-buffer helper (used by unit tests and non-tiled fallback)
 * running steps (a)-(f) in exact order.
 */
export function enhanceRgbaBuffer(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  level: ActivePhotoEnhanceLevel
): {
  beforeLuminance: number;
  afterLuminance: number;
  plan: EnhancementPlan;
} {
  const acc = createEmptyAnalyzeAccumulator();
  accumulateTileStats(acc, rgba);
  const stats = finalizeImageStats(acc);
  const plan = computeEnhancementPlan(stats, level);

  applyToneAndColorInPlace(rgba, plan);

  if (plan.applyDenoise) {
    const denoised = new Uint8ClampedArray(rgba.length);
    applyEdgePreservingDenoise(
      rgba,
      denoised,
      width,
      height,
      plan.denoiseEdgeThreshold
    );
    rgba.set(denoised);
  }

  const sharpened = new Uint8ClampedArray(rgba.length);
  applyUnsharpMaskLuminance(
    rgba,
    sharpened,
    width,
    height,
    plan.sharpenAmount,
    plan.sharpenThreshold
  );
  rgba.set(sharpened);

  const afterLuminance = computeMeanLuminance(rgba);
  return {
    beforeLuminance: plan.beforeLuminance,
    afterLuminance,
    plan,
  };
}
