/**
 * Pure brightness & hysteresis state machine for Smart Auto Flash / Torch.
 * Accounts for mobile camera continuous auto-exposure boosting dim scenes,
 * plus reflection/flicker protection once the LED torch is active.
 */

export const AUTO_FLASH_DEFAULTS = {
  veryDarkLumaThreshold: 72,
  lowLumaThreshold: 106,
  shadowAssistMaxLuma: 122,
  shadowAssistMaxP90: 152,
  shadowAssistMinDarkRatio: 0.25,
  baseHighLumaThreshold: 165,
  maxHighLumaThreshold: 215,
  maxDarkRatioToTurnOff: 0.08,
  sampleIntervalMs: 300,
  veryDarkHoldMs: 200,
  turnOnHoldMs: 400,
  turnOffHoldMs: 1000,
  exposureSettleAfterOnMs: 1400,
  flickerCooldownMs: 2200,
} as const;

export interface BrightnessMetrics {
  avgLuma: number;
  p90Luma: number;
  darkRatio: number;
}

export interface AutoFlashState {
  torchOn: boolean;
  lowLumaSince: number | null;
  highLumaSince: number | null;
  adaptiveHighLuma: number;
  lastTurnedOnAt: number;
  lastTurnedOffAt: number;
}

export function createInitialAutoFlashState(
  initialTorchOn = false
): AutoFlashState {
  return {
    torchOn: initialTorchOn,
    lowLumaSince: null,
    highLumaSince: null,
    adaptiveHighLuma: AUTO_FLASH_DEFAULTS.baseHighLumaThreshold,
    lastTurnedOnAt: initialTorchOn ? Date.now() : 0,
    lastTurnedOffAt: 0,
  };
}

export function computeBrightnessMetricsFromRgba(
  pixels: Uint8ClampedArray | number[]
): BrightnessMetrics {
  const totalPixels = Math.floor(pixels.length / 4);
  if (totalPixels <= 0) {
    return { avgLuma: 128, p90Luma: 128, darkRatio: 0 };
  }

  const lumas = new Float32Array(totalPixels);
  let sum = 0;
  let darkCount = 0;

  for (let i = 0, p = 0; p < totalPixels; i += 4, p++) {
    const luma =
      0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    lumas[p] = luma;
    sum += luma;
    if (luma < 65) {
      darkCount++;
    }
  }

  lumas.sort();
  const p90Idx = Math.min(totalPixels - 1, Math.floor(totalPixels * 0.9));

  return {
    avgLuma: sum / totalPixels,
    p90Luma: lumas[p90Idx],
    darkRatio: darkCount / totalPixels,
  };
}

export function isSceneDimForTorch(metrics: BrightnessMetrics): boolean {
  if (metrics.avgLuma < AUTO_FLASH_DEFAULTS.lowLumaThreshold) {
    return true;
  }
  return (
    metrics.avgLuma < AUTO_FLASH_DEFAULTS.shadowAssistMaxLuma &&
    metrics.p90Luma < AUTO_FLASH_DEFAULTS.shadowAssistMaxP90 &&
    metrics.darkRatio >= AUTO_FLASH_DEFAULTS.shadowAssistMinDarkRatio
  );
}

export function stepAutoFlashState(
  prev: AutoFlashState,
  metrics: BrightnessMetrics,
  now: number
): { nextState: AutoFlashState; desiredTorch: boolean | null } {
  const state = { ...prev };

  if (!state.torchOn) {
    state.highLumaSince = null;
    if (isSceneDimForTorch(metrics)) {
      const requiredHoldMs =
        metrics.avgLuma < AUTO_FLASH_DEFAULTS.veryDarkLumaThreshold
          ? AUTO_FLASH_DEFAULTS.veryDarkHoldMs
          : AUTO_FLASH_DEFAULTS.turnOnHoldMs;
      if (state.lowLumaSince === null) {
        state.lowLumaSince = now;
      } else if (now - state.lowLumaSince >= requiredHoldMs) {
        if (
          state.lastTurnedOffAt > 0 &&
          now - state.lastTurnedOffAt < AUTO_FLASH_DEFAULTS.flickerCooldownMs
        ) {
          state.adaptiveHighLuma = Math.min(
            AUTO_FLASH_DEFAULTS.maxHighLumaThreshold,
            state.adaptiveHighLuma + 22
          );
        }
        state.lowLumaSince = null;
        state.torchOn = true;
        state.lastTurnedOnAt = now;
        return { nextState: state, desiredTorch: true };
      }
    } else {
      state.lowLumaSince = null;
      if (metrics.avgLuma > 130 && metrics.darkRatio < 0.12) {
        state.adaptiveHighLuma = AUTO_FLASH_DEFAULTS.baseHighLumaThreshold;
      }
    }
    return { nextState: state, desiredTorch: null };
  }

  state.lowLumaSince = null;
  if (now - state.lastTurnedOnAt < AUTO_FLASH_DEFAULTS.exposureSettleAfterOnMs) {
    state.highLumaSince = null;
    return { nextState: state, desiredTorch: null };
  }

  const isBrightEverywhere =
    metrics.avgLuma >= state.adaptiveHighLuma &&
    metrics.darkRatio <= AUTO_FLASH_DEFAULTS.maxDarkRatioToTurnOff;

  if (isBrightEverywhere) {
    if (state.highLumaSince === null) {
      state.highLumaSince = now;
    } else if (now - state.highLumaSince >= AUTO_FLASH_DEFAULTS.turnOffHoldMs) {
      state.highLumaSince = null;
      state.torchOn = false;
      state.lastTurnedOffAt = now;
      return { nextState: state, desiredTorch: false };
    }
  } else {
    state.highLumaSince = null;
  }

  return { nextState: state, desiredTorch: null };
}
