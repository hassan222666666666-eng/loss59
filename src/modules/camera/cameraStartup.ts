export const CAMERA_START_TIMEOUT_MS = 6000;
export const CAMERA_RETRY_DELAYS_MS = [500, 1000, 2000] as const;
export const CAMERA_BACKGROUND_RETRY_MS = 5000;
export const CAMERA_TAKE_PHOTO_TIMEOUT_MS = 2000;
export const CAMERA_ZOOM_FOCUS_SETTLE_MS = 300;
export const CAMERA_POST_PLAY_APPLY_DELAY_MS = 300;

export interface PhotoDimensionsRange {
  min?: number;
  max?: number;
  step?: number;
}

export interface PhotoCapabilitiesLike {
  imageWidth?: PhotoDimensionsRange;
  imageHeight?: PhotoDimensionsRange;
  photoWidth?: PhotoDimensionsRange;
  photoHeight?: PhotoDimensionsRange;
  fillLightMode?: string[];
}

export interface ExtendedTrackCapabilities {
  torch?: boolean;
  zoom?: { min: number; max: number; step?: number };
  focusMode?: string[];
  exposureMode?: string[];
  whiteBalanceMode?: string[];
}

/**
 * Constraint ladder:
 * When highQuality is true (default):
 *   1. ideal 1920x1080 (min 1280x720), facingMode environment, frameRate ideal 30
 *   2. fallback 1280x720, facingMode environment, frameRate ideal 30
 *   3. facingMode environment only
 *   4. bare `{ video: true }`
 * When highQuality is false:
 *   starts at 1280x720 and falls back down to `{ video: true }`.
 */
export function buildCameraConstraintAttempts(
  qualityOrRes: boolean | 'auto' | '1080p' | '720p' = true,
  targetDeviceId?: string | null,
  targetFrameRate?: number
): MediaStreamConstraints[] {
  const highQuality = qualityOrRes !== false && qualityOrRes !== '720p';
  const cleanDeviceId = targetDeviceId?.trim();
  const hasExplicitFps =
    typeof targetFrameRate === 'number' &&
    Number.isFinite(targetFrameRate) &&
    targetFrameRate > 0;
  const primaryFrameRateConstraint: MediaTrackConstraints['frameRate'] =
    hasExplicitFps
      ? { ideal: targetFrameRate, max: targetFrameRate }
      : { ideal: 30 };
  const relaxedFrameRateConstraint: MediaTrackConstraints['frameRate'] =
    hasExplicitFps ? { ideal: targetFrameRate } : { ideal: 30 };

  if (cleanDeviceId) {
    const preferredWidth = highQuality ? 1920 : 1280;
    const preferredHeight = highQuality ? 1080 : 720;
    return [
      {
        audio: false,
        video: {
          deviceId: { exact: cleanDeviceId },
          width: { ideal: preferredWidth },
          height: { ideal: preferredHeight },
          frameRate: primaryFrameRateConstraint,
        },
      },
      {
        audio: false,
        video: {
          deviceId: { exact: cleanDeviceId },
          width: { ideal: preferredWidth },
          height: { ideal: preferredHeight },
          frameRate: relaxedFrameRateConstraint,
        },
      },
      {
        audio: false,
        video: {
          deviceId: { exact: cleanDeviceId },
        },
      },
      {
        audio: false,
        video: {
          deviceId: { exact: cleanDeviceId },
        },
      },
    ];
  }

  if (highQuality) {
    return [
      {
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { min: 1280, ideal: 1920 },
          height: { min: 720, ideal: 1080 },
          frameRate: primaryFrameRateConstraint,
        },
      },
      {
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: relaxedFrameRateConstraint,
        },
      },
      {
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
        },
      },
      {
        audio: false,
        video: true,
      },
    ];
  }

  return [
    {
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: primaryFrameRateConstraint,
      },
    },
    {
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
      },
    },
    {
      audio: false,
      video: true,
    },
    {
      audio: false,
      video: true,
    },
  ];
}

export function extractMaxPhotoDimensions(
  photoCaps?: PhotoCapabilitiesLike | null
): { imageWidth?: number; imageHeight?: number } {
  if (!photoCaps) return {};
  const maxW = photoCaps.imageWidth?.max ?? photoCaps.photoWidth?.max;
  const maxH = photoCaps.imageHeight?.max ?? photoCaps.photoHeight?.max;
  const validW = typeof maxW === 'number' && Number.isFinite(maxW) && maxW > 0 ? Math.round(maxW) : undefined;
  const validH = typeof maxH === 'number' && Number.isFinite(maxH) && maxH > 0 ? Math.round(maxH) : undefined;
  return {
    ...(validW ? { imageWidth: validW } : {}),
    ...(validH ? { imageHeight: validH } : {}),
  };
}

export function buildTakePhotoSettings(input: {
  fillLightMode?: 'auto' | 'off' | 'flash';
  torchActive?: boolean;
  maxPhotoDims?: { imageWidth?: number; imageHeight?: number } | null;
}): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  if (input.fillLightMode && !input.torchActive) {
    out.fillLightMode = input.fillLightMode;
  }
  if (input.maxPhotoDims?.imageWidth && input.maxPhotoDims?.imageHeight) {
    out.imageWidth = input.maxPhotoDims.imageWidth;
    out.imageHeight = input.maxPhotoDims.imageHeight;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function extractContinuousConstraints(caps?: ExtendedTrackCapabilities | null): {
  combined: Record<string, string> | null;
  individual: Record<string, string>[];
} {
  if (!caps) return { combined: null, individual: [] };
  const combined: Record<string, string> = {};
  const individual: Record<string, string>[] = [];

  if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
    combined.focusMode = 'continuous';
    individual.push({ focusMode: 'continuous' });
  }
  if (Array.isArray(caps.exposureMode) && caps.exposureMode.includes('continuous')) {
    combined.exposureMode = 'continuous';
    individual.push({ exposureMode: 'continuous' });
  }
  if (
    Array.isArray(caps.whiteBalanceMode) &&
    caps.whiteBalanceMode.includes('continuous')
  ) {
    combined.whiteBalanceMode = 'continuous';
    individual.push({ whiteBalanceMode: 'continuous' });
  }

  return {
    combined: Object.keys(combined).length > 0 ? combined : null,
    individual,
  };
}

export async function applyContinuousTrackModes(
  track: MediaStreamTrack,
  caps?: ExtendedTrackCapabilities | null
): Promise<void> {
  const { combined, individual } = extractContinuousConstraints(caps);
  if (!combined) return;

  try {
    await track.applyConstraints({
      advanced: [combined as unknown as MediaTrackConstraintSet],
    });
  } catch {
    for (const single of individual) {
      try {
        await track.applyConstraints({
          advanced: [single as unknown as MediaTrackConstraintSet],
        });
      } catch {
        // Ignore individual unsupported constraint rejection
      }
    }
  }
}

export function computeFocusSettleWaitMs(
  lastZoomChangedAt: number,
  nowMs: number,
  settleWindowMs: number = CAMERA_ZOOM_FOCUS_SETTLE_MS
): number {
  if (!lastZoomChangedAt || lastZoomChangedAt <= 0) return 0;
  const elapsed = nowMs - lastZoomChangedAt;
  if (elapsed < 0 || elapsed >= settleWindowMs) return 0;
  return settleWindowMs - elapsed;
}

export function isCameraPermissionDeniedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; message?: string };
  const name = String(e.name || '').toLowerCase();
  const msg = String(e.message || '').toLowerCase();
  return (
    name === 'notallowederror' ||
    name === 'permissiondeniederror' ||
    name === 'securityerror' ||
    msg.includes('permission') ||
    msg.includes('notallowed') ||
    msg.includes('denied')
  );
}

export function isCameraBusyOrOverconstrainedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; message?: string };
  const name = String(e.name || '').toLowerCase();
  const msg = String(e.message || '').toLowerCase();
  return (
    name === 'notreadableerror' ||
    name === 'aborterror' ||
    name === 'overconstrainederror' ||
    name === 'trackstarterror' ||
    msg.includes('busy') ||
    msg.includes('in use') ||
    msg.includes('overconstrained') ||
    msg.includes('could not start video source')
  );
}

export function isCameraStartTimeoutError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  return (err as { name?: string; message?: string }).name === 'CameraTimeoutError';
}

export async function acquireStreamWithTimeout(
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>,
  constraints: MediaStreamConstraints,
  timeoutMs: number = CAMERA_START_TIMEOUT_MS
): Promise<MediaStream> {
  let timedOut = false;
  let timerId: ReturnType<typeof setTimeout> | null = null;

  const streamPromise = getUserMedia(constraints).then((stream) => {
    if (timedOut) {
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {
          // Ignore
        }
      }
    }
    return stream;
  });

  const timeoutPromise = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => {
      timedOut = true;
      const err = new Error('Camera start timeout');
      err.name = 'CameraTimeoutError';
      reject(err);
    }, timeoutMs);
  });

  try {
    return await Promise.race([streamPromise, timeoutPromise]);
  } finally {
    if (timerId !== null) {
      clearTimeout(timerId);
    }
  }
}

export async function startCameraWithRetryLadder(options: {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  highQuality?: boolean;
  previewResolution?: 'auto' | '1080p' | '720p';
  frameRate?: number;
  targetDeviceId?: string | null;
  isCancelled?: () => boolean;
  beforeAttempt?: (attemptIndex: number) => void | Promise<void>;
  timeoutMs?: number;
  retryDelaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}): Promise<MediaStream> {
  const attempts = buildCameraConstraintAttempts(
    options.previewResolution ?? (options.highQuality ?? true),
    options.targetDeviceId,
    options.frameRate
  );
  const delays = options.retryDelaysMs ?? CAMERA_RETRY_DELAYS_MS;
  const timeoutMs = options.timeoutMs ?? CAMERA_START_TIMEOUT_MS;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let lastErr: unknown = new Error('Camera unavailable');

  for (let i = 0; i < attempts.length; i++) {
    if (options.isCancelled?.()) {
      throw new Error('Cancelled');
    }
    await options.beforeAttempt?.(i);
    if (options.isCancelled?.()) {
      throw new Error('Cancelled');
    }

    try {
      const stream = await acquireStreamWithTimeout(
        options.getUserMedia,
        attempts[i],
        timeoutMs
      );
      if (options.isCancelled?.()) {
        for (const t of stream.getTracks()) {
          try {
            t.stop();
          } catch {
            // Ignore
          }
        }
        throw new Error('Cancelled');
      }
      return stream;
    } catch (err) {
      lastErr = err;
      if (i < delays.length && !options.isCancelled?.()) {
        await sleep(delays[i]);
      }
    }
  }

  throw lastErr;
}
