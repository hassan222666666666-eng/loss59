import {
  AppSettings,
  BatterySaverMode,
  CameraIdleTimeoutSec,
  PreviewFrameRateSetting,
} from '../../types';

export const BATTERY_SAVER_LOW_THRESHOLD = 0.2;
export const BATTERY_SAVER_FORCED_FPS: PreviewFrameRateSetting = 15;
export const BATTERY_SAVER_FORCED_IDLE_SEC: CameraIdleTimeoutSec = 30;

export function resolveCameraIdleTimeoutSec(
  val?: unknown
): CameraIdleTimeoutSec {
  if (val === 30 || val === 60 || val === 120 || val === 0) {
    return val;
  }
  return 60;
}

export function resolvePreviewFrameRateSetting(
  val?: unknown
): PreviewFrameRateSetting {
  if (val === 30 || val === 24 || val === 15) {
    return val;
  }
  return 24;
}

export function resolveBatterySaverMode(val?: unknown): BatterySaverMode {
  if (val === 'off' || val === 'auto' || val === 'always') {
    return val;
  }
  return 'auto';
}

export function evaluateBatterySaverActive(input: {
  mode: BatterySaverMode;
  batterySupported: boolean;
  level: number | null;
  charging: boolean | null;
}): boolean {
  if (input.mode === 'always') return true;
  if (input.mode === 'off') return false;
  if (!input.batterySupported) return false;
  if (input.level === null || !Number.isFinite(input.level)) return false;
  return (
    input.charging === false &&
    input.level <= BATTERY_SAVER_LOW_THRESHOLD + 1e-6
  );
}

export function getEffectiveCameraPowerProfile(input: {
  settings: Pick<
    AppSettings,
    'cameraIdleTimeoutSec' | 'previewFrameRate' | 'batterySaverMode'
  >;
  isBatterySaverOn: boolean;
}): {
  frameRate: PreviewFrameRateSetting;
  idleTimeoutSec: CameraIdleTimeoutSec;
} {
  if (input.isBatterySaverOn) {
    return {
      frameRate: BATTERY_SAVER_FORCED_FPS,
      idleTimeoutSec: BATTERY_SAVER_FORCED_IDLE_SEC,
    };
  }
  return {
    frameRate: resolvePreviewFrameRateSetting(input.settings.previewFrameRate),
    idleTimeoutSec: resolveCameraIdleTimeoutSec(
      input.settings.cameraIdleTimeoutSec
    ),
  };
}

export function formatIdleTimeoutLabel(sec: CameraIdleTimeoutSec): string {
  if (sec === 30) return '30 ثانية';
  if (sec === 60) return '60 ثانية';
  if (sec === 120) return '2 دقيقة';
  return 'أبداً';
}

export function formatBatterySaverModeLabel(mode: BatterySaverMode): string {
  if (mode === 'always') return 'دائماً';
  if (mode === 'off') return 'إيقاف';
  return 'تلقائي';
}

export function formatSessionDurationArabic(ms: number): string {
  const safeSec = Math.max(0, Math.round(ms / 1000));
  if (safeSec < 60) {
    return `${safeSec} ث`;
  }
  const mins = Math.floor(safeSec / 60);
  const secs = safeSec % 60;
  if (mins < 60) {
    return secs > 0 ? `${mins} د ${secs} ث` : `${mins} د`;
  }
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hours} س ${remMins} د` : `${hours} س`;
}

export function formatBatteryLevelPercent(level: number | null): string {
  if (level === null || !Number.isFinite(level)) {
    return 'غير متاح';
  }
  const pct = Math.max(0, Math.min(100, Math.round(level * 100)));
  return `${pct}%`;
}

export interface SessionPowerTelemetry {
  cameraActiveMs: number;
  sessionCaptures: number;
  batterySupported: boolean;
  initialBatteryLevel: number | null;
  currentBatteryLevel: number | null;
  batteryCharging: boolean | null;
  batterySaverOn: boolean;
  batterySaverMode: BatterySaverMode;
}

export function buildBatteryMeasurementRows(
  t: SessionPowerTelemetry
): Array<{ label: string; value: string }> {
  const modeLabel = formatBatterySaverModeLabel(t.batterySaverMode);
  const saverStatusText = t.batterySaverOn
    ? `مُفعّل (${modeLabel})`
    : `متوقف (${modeLabel})`;

  const initialBatteryText = t.batterySupported
    ? formatBatteryLevelPercent(t.initialBatteryLevel)
    : 'غير مدعوم في هذا المتصفح';
  const currentBatteryText = t.batterySupported
    ? `${formatBatteryLevelPercent(t.currentBatteryLevel)}${
        t.batteryCharging === true ? ' (قيد الشحن)' : ''
      }`
    : 'غير مدعوم في هذا المتصفح';

  return [
    {
      label: 'تشغيل الكاميرا في الجلسة',
      value: formatSessionDurationArabic(t.cameraActiveMs),
    },
    {
      label: 'عدد اللقطات في الجلسة',
      value: `${Math.max(0, Math.round(t.sessionCaptures))}`,
    },
    {
      label: 'البطارية عند فتح التطبيق',
      value: initialBatteryText,
    },
    {
      label: 'البطارية الآن',
      value: currentBatteryText,
    },
    {
      label: 'وضع توفير البطارية',
      value: saverStatusText,
    },
  ];
}

export function formatBatteryMeasurementClipboardText(
  t: SessionPowerTelemetry
): string {
  const rows = buildBatteryMeasurementRows(t);
  return ['قياس البطارية والأداء:', ...rows.map((r) => `- ${r.label}: ${r.value}`)].join(
    '\n'
  );
}

// Lightweight timestamp-diff session tracker (zero polling timers)
let accumulatedActiveMs = 0;
let activeSegmentStartedAt: number | null = null;
let sessionCaptureCount = 0;
const trackerListeners = new Set<() => void>();

function emitTrackerChange(): void {
  for (const fn of trackerListeners) {
    try {
      fn();
    } catch {
      // Ignore
    }
  }
}

export function subscribeSessionPowerStats(listener: () => void): () => void {
  trackerListeners.add(listener);
  return () => {
    trackerListeners.delete(listener);
  };
}

export function markCameraSessionStarted(nowMs: number = Date.now()): void {
  if (activeSegmentStartedAt === null) {
    activeSegmentStartedAt = nowMs;
    emitTrackerChange();
  }
}

export function markCameraSessionStopped(nowMs: number = Date.now()): void {
  if (activeSegmentStartedAt !== null) {
    accumulatedActiveMs += Math.max(0, nowMs - activeSegmentStartedAt);
    activeSegmentStartedAt = null;
    emitTrackerChange();
  }
}

export function isCameraSessionRunning(): boolean {
  return activeSegmentStartedAt !== null;
}

export function incrementSessionCaptureCount(): number {
  sessionCaptureCount += 1;
  emitTrackerChange();
  return sessionCaptureCount;
}

export function getSessionCameraActiveMs(nowMs: number = Date.now()): number {
  const liveDelta =
    activeSegmentStartedAt !== null
      ? Math.max(0, nowMs - activeSegmentStartedAt)
      : 0;
  return accumulatedActiveMs + liveDelta;
}

export function getSessionCaptureCount(): number {
  return sessionCaptureCount;
}

export function __resetSessionPowerTrackerForTest(): void {
  accumulatedActiveMs = 0;
  activeSegmentStartedAt = null;
  sessionCaptureCount = 0;
  trackerListeners.clear();
}
