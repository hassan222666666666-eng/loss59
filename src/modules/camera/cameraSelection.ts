export const MAX_BACK_CAMERA_CANDIDATES = 4;

export interface MediaDeviceLike {
  deviceId: string;
  kind: string;
  label?: string;
}

export interface CameraZoomRangeInfo {
  min: number;
  max: number;
  step?: number;
}

export interface CameraCandidateRecord {
  deviceId: string;
  label: string;
  index: number;
  isPreferredMainBack: boolean;
  torchSupported: boolean;
  zoomMin?: number;
  zoomMax?: number;
  zoomStep?: number;
  probed: boolean;
  probeError?: string;
}

const BACK_INCLUDE_RE = /(back|rear|environment)/i;
const MAIN_BACK_EXCLUDE_RE = /(wide|ultra|macro|depth|tele|front)/i;
const FRONT_ONLY_RE = /(front|selfie|\buser\b)/i;

export function areVideoDeviceLabelsEmpty(
  devices: readonly MediaDeviceLike[]
): boolean {
  const videoInputs = devices.filter((d) => d.kind === 'videoinput');
  if (videoInputs.length === 0) return true;
  return videoInputs.every((d) => !d.label || d.label.trim().length === 0);
}

export function isPreferredMainBackLabel(label: string): boolean {
  const clean = label.trim();
  if (!clean) return false;
  return BACK_INCLUDE_RE.test(clean) && !MAIN_BACK_EXCLUDE_RE.test(clean);
}

export function isExplicitBackLabel(label: string): boolean {
  const clean = label.trim();
  if (!clean) return false;
  return BACK_INCLUDE_RE.test(clean) && !/\bfront\b/i.test(clean);
}

export function isFrontCameraLabel(label: string): boolean {
  const clean = label.trim();
  if (!clean) return false;
  return FRONT_ONLY_RE.test(clean);
}

/**
 * Selects up to 4 back-camera candidates from enumerated `videoinput` devices.
 * Priority:
 *  1. Preferred main back camera (contains back/rear/environment and NOT wide/ultra/macro/depth/tele/front)
 *  2. Other back/rear/environment cameras (e.g., wide/tele/macro rear lenses)
 *  3. Generic non-front cameras (when no back/rear/environment label is found)
 */
export function selectBackCameraCandidates(
  devices: readonly MediaDeviceLike[],
  maxCandidates: number = MAX_BACK_CAMERA_CANDIDATES
): Array<{
  deviceId: string;
  label: string;
  index: number;
  isPreferredMainBack: boolean;
}> {
  const videoInputs = devices.filter(
    (d) => d.kind === 'videoinput' && Boolean(d.deviceId)
  );

  const preferredMain: Array<{
    deviceId: string;
    label: string;
    index: number;
    isPreferredMainBack: boolean;
  }> = [];
  const otherBack: Array<{
    deviceId: string;
    label: string;
    index: number;
    isPreferredMainBack: boolean;
  }> = [];
  const nonFrontFallback: Array<{
    deviceId: string;
    label: string;
    index: number;
    isPreferredMainBack: boolean;
  }> = [];

  videoInputs.forEach((dev, idx) => {
    const label = (dev.label || '').trim();
    if (isFrontCameraLabel(label)) {
      return;
    }
    if (isPreferredMainBackLabel(label)) {
      preferredMain.push({
        deviceId: dev.deviceId,
        label,
        index: idx,
        isPreferredMainBack: true,
      });
    } else if (isExplicitBackLabel(label)) {
      otherBack.push({
        deviceId: dev.deviceId,
        label,
        index: idx,
        isPreferredMainBack: false,
      });
    } else {
      nonFrontFallback.push({
        deviceId: dev.deviceId,
        label,
        index: idx,
        isPreferredMainBack: false,
      });
    }
  });

  const ordered =
    preferredMain.length > 0 || otherBack.length > 0
      ? [...preferredMain, ...otherBack]
      : nonFrontFallback;

  const seen = new Set<string>();
  const deduped: typeof ordered = [];
  for (const item of ordered) {
    if (seen.has(item.deviceId)) continue;
    seen.add(item.deviceId);
    deduped.push(item);
    if (deduped.length >= maxCandidates) break;
  }
  return deduped;
}

export function pickBestTorchCandidate(
  candidates: readonly CameraCandidateRecord[]
): CameraCandidateRecord | null {
  const preferredWithTorch = candidates.find(
    (c) => c.probed && c.isPreferredMainBack && c.torchSupported
  );
  if (preferredWithTorch) return preferredWithTorch;

  const anyWithTorch = candidates.find((c) => c.probed && c.torchSupported);
  if (anyWithTorch) return anyWithTorch;

  return null;
}

export function computeDevicesSignature(
  devices: readonly MediaDeviceLike[]
): string {
  return devices
    .filter((d) => d.kind === 'videoinput')
    .map((d) => `${d.deviceId}:${(d.label || '').trim()}`)
    .join('|');
}

export function extractZoomRangeFromCapabilities(caps?: {
  zoom?: { min?: number; max?: number; step?: number };
} | null): CameraZoomRangeInfo | undefined {
  if (
    !caps?.zoom ||
    typeof caps.zoom.min !== 'number' ||
    typeof caps.zoom.max !== 'number' ||
    !Number.isFinite(caps.zoom.min) ||
    !Number.isFinite(caps.zoom.max) ||
    caps.zoom.max <= caps.zoom.min
  ) {
    return undefined;
  }
  return {
    min: Math.round(caps.zoom.min * 100) / 100,
    max: Math.round(caps.zoom.max * 100) / 100,
    ...(typeof caps.zoom.step === 'number' && Number.isFinite(caps.zoom.step)
      ? { step: caps.zoom.step }
      : {}),
  };
}

export const ZOOM_PRESETS = [1, 2, 3] as const;

/**
 * Returns supported zoom presets (1x, 2x, 3x) ONLY when the camera track natively supports zoom.
 * If the track does not support zoom (or max <= 1.2), returns [] so 2x/3x UI controls stay hidden
 * and the preview is never scaled with CSS.
 */
export function resolveAvailableZoomPresets(
  zoomRange: CameraZoomRangeInfo | null | undefined
): number[] {
  if (
    !zoomRange ||
    !Number.isFinite(zoomRange.min) ||
    !Number.isFinite(zoomRange.max) ||
    zoomRange.max <= zoomRange.min ||
    zoomRange.max < 1.5
  ) {
    return [];
  }
  const presets = ZOOM_PRESETS.filter(
    (p) => p >= zoomRange.min - 0.05 && p <= zoomRange.max + 0.05
  );
  return presets.length >= 2 ? presets : [];
}

export function clampHardwareZoom(
  requested: number,
  zoomRange: CameraZoomRangeInfo | null | undefined
): number {
  if (!zoomRange || zoomRange.max <= zoomRange.min) return 1;
  const clamped = Math.max(zoomRange.min, Math.min(zoomRange.max, requested));
  return Math.round(clamped * 10) / 10;
}

