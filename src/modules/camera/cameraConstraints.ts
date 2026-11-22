export interface UnifiedCameraConstraintState {
  torch: boolean;
  zoom: number;
  focusMode: 'continuous';
  exposureMode: 'continuous';
  whiteBalanceMode: 'continuous';
}

export interface CameraTrackCapabilitiesLike {
  torch?: boolean;
  zoom?: { min?: number; max?: number; step?: number };
  focusMode?: string[];
  exposureMode?: string[];
  whiteBalanceMode?: string[];
}

export interface CameraTrackSettingsLike {
  deviceId?: string;
  torch?: boolean;
  zoom?: number;
  focusMode?: string;
  exposureMode?: string;
  whiteBalanceMode?: string;
  width?: number;
  height?: number;
  frameRate?: number;
}

export interface ApplyUnifiedConstraintsResult {
  attempted: boolean;
  applied: boolean;
  torchSupported: boolean;
  requestedTorch: boolean;
  actualTorch: boolean | undefined;
  constraintsSent: MediaTrackConstraints | null;
  errorMessage: string | null;
  trackSettings: CameraTrackSettingsLike | undefined;
}

export function createDefaultCameraConstraintState(): UnifiedCameraConstraintState {
  return {
    torch: false,
    zoom: 1,
    focusMode: 'continuous',
    exposureMode: 'continuous',
    whiteBalanceMode: 'continuous',
  };
}

export function formatConstraintsError(err: unknown): string {
  if (!err) return 'Unknown applyConstraints error';
  if (typeof err === 'string') return err;
  if (typeof err === 'object') {
    const e = err as {
      name?: unknown;
      message?: unknown;
      constraint?: unknown;
    };
    const name = typeof e.name === 'string' ? e.name.trim() : '';
    const msg = typeof e.message === 'string' ? e.message.trim() : '';
    const constraint =
      typeof e.constraint === 'string' && e.constraint.trim()
        ? ` (${e.constraint.trim()})`
        : '';
    if (name && msg) return `${name}${constraint}: ${msg}`;
    if (name) return `${name}${constraint}`;
    if (msg) return msg;
  }
  return String(err);
}

/**
 * Builds ONE single `{ advanced: [ { ...all supported fields from state } ] }` object.
 * applyConstraints() replaces previous advanced constraints, so every update must
 * include all currently supported fields (including torch and zoom) together.
 */
export function buildUnifiedAdvancedConstraints(
  state: UnifiedCameraConstraintState,
  caps?: CameraTrackCapabilitiesLike | null
): MediaTrackConstraints | null {
  if (!caps) return null;

  const advancedSet: Record<string, unknown> = {};

  if (caps.torch === true) {
    advancedSet.torch = Boolean(state.torch);
  }

  if (
    caps.zoom &&
    typeof caps.zoom.min === 'number' &&
    typeof caps.zoom.max === 'number' &&
    Number.isFinite(caps.zoom.min) &&
    Number.isFinite(caps.zoom.max) &&
    caps.zoom.max > caps.zoom.min
  ) {
    const rawZoom = Number.isFinite(state.zoom) ? state.zoom : caps.zoom.min;
    const clamped = Math.max(caps.zoom.min, Math.min(caps.zoom.max, rawZoom));
    advancedSet.zoom = Math.round(clamped * 100) / 100;
  }

  if (Array.isArray(caps.focusMode) && caps.focusMode.includes(state.focusMode)) {
    advancedSet.focusMode = state.focusMode;
  }

  if (
    Array.isArray(caps.exposureMode) &&
    caps.exposureMode.includes(state.exposureMode)
  ) {
    advancedSet.exposureMode = state.exposureMode;
  }

  if (
    Array.isArray(caps.whiteBalanceMode) &&
    caps.whiteBalanceMode.includes(state.whiteBalanceMode)
  ) {
    advancedSet.whiteBalanceMode = state.whiteBalanceMode;
  }

  if (Object.keys(advancedSet).length === 0) {
    return null;
  }

  return {
    advanced: [advancedSet as MediaTrackConstraintSet],
  };
}

export interface CameraTrackLike {
  readyState: MediaStreamTrackState | string;
  getCapabilities?: () => CameraTrackCapabilitiesLike | MediaTrackCapabilities;
  getSettings?: () => CameraTrackSettingsLike | MediaTrackSettings;
  applyConstraints: (constraints?: MediaTrackConstraints) => Promise<void>;
}

export function readTrackSettingsSnapshot(
  track: Pick<CameraTrackLike, 'getSettings'> | null | undefined
): CameraTrackSettingsLike | undefined {
  if (!track || typeof track.getSettings !== 'function') return undefined;
  try {
    return track.getSettings() as CameraTrackSettingsLike;
  } catch {
    return undefined;
  }
}

export async function applyUnifiedTrackConstraints(
  track: CameraTrackLike,
  state: UnifiedCameraConstraintState,
  providedCaps?: CameraTrackCapabilitiesLike | null
): Promise<ApplyUnifiedConstraintsResult> {
  const caps =
    providedCaps ??
    (typeof track.getCapabilities === 'function'
      ? (track.getCapabilities() as CameraTrackCapabilitiesLike)
      : null);

  const torchSupported = Boolean(caps?.torch === true);
  const requestedTorch = Boolean(state.torch);
  const constraintsSent = buildUnifiedAdvancedConstraints(state, caps);

  if (!constraintsSent) {
    const snap = readTrackSettingsSnapshot(track);
    return {
      attempted: false,
      applied: false,
      torchSupported,
      requestedTorch,
      actualTorch: typeof snap?.torch === 'boolean' ? snap.torch : undefined,
      constraintsSent: null,
      errorMessage: null,
      trackSettings: snap,
    };
  }

  let applied = false;
  let errorMessage: string | null = null;

  try {
    await track.applyConstraints(constraintsSent);
    applied = true;
  } catch (err) {
    errorMessage = formatConstraintsError(err);
  }

  let snap = readTrackSettingsSnapshot(track);
  // Some camera HALs update getSettings().torch one frame after applyConstraints resolves
  if (
    applied &&
    torchSupported &&
    requestedTorch &&
    snap?.torch === false
  ) {
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    if (track.readyState === 'live') {
      snap = readTrackSettingsSnapshot(track);
    }
  }

  const actualTorch = typeof snap?.torch === 'boolean' ? snap.torch : undefined;

  return {
    attempted: true,
    applied,
    torchSupported,
    requestedTorch,
    actualTorch,
    constraintsSent,
    errorMessage,
    trackSettings: snap,
  };
}
