import { CaptureMode } from '../../types';

export const MAX_CAPTURE_QUEUE_PENDING = 5;
export const FREEZE_OVERLAY_MAX_MS = 1200;
export const MAX_SAVED_PHOTO_LONG_SIDE = 4096;
export const SAVED_PHOTO_JPEG_QUALITY = 0.92;
export const THUMBNAIL_MAX_LONG_SIDE = 480;
export const THUMBNAIL_JPEG_QUALITY = 0.8;

export function resolveCaptureMode(mode?: CaptureMode): CaptureMode {
  return mode === 'high-quality' ? 'high-quality' : 'fast';
}

export function formatCaptureModeLabel(mode?: CaptureMode): string {
  return resolveCaptureMode(mode) === 'fast' ? 'سريع' : 'جودة عالية';
}

export interface CaptureQueueState {
  pendingCount: number;
  maxPending: number;
}

export function canAcceptCapture(
  state: CaptureQueueState
): boolean {
  return state.pendingCount < state.maxPending;
}

export function enqueuePendingCapture(
  state: CaptureQueueState
): { accepted: boolean; next: CaptureQueueState } {
  if (!canAcceptCapture(state)) {
    return { accepted: false, next: state };
  }
  return {
    accepted: true,
    next: {
      ...state,
      pendingCount: state.pendingCount + 1,
    },
  };
}

export function completePendingCapture(
  state: CaptureQueueState
): CaptureQueueState {
  return {
    ...state,
    pendingCount: Math.max(0, state.pendingCount - 1),
  };
}

export function computeFreezeDismissDelayMs(
  startedAtMs: number,
  nowMs: number,
  maxOverlayMs: number = FREEZE_OVERLAY_MAX_MS
): number {
  const elapsed = Math.max(0, nowMs - startedAtMs);
  return Math.max(0, maxOverlayMs - elapsed);
}
