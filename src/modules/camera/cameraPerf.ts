import { CaptureMode, PreviewResolutionSetting } from '../../types';
import {
  CameraDiagnosticsInfo,
} from './cameraDiagnostics';
import { formatCaptureModeLabel } from './captureQueue';
import { formatEnhanceLevelLabel } from './photoEnhancement';

export const ADAPTIVE_FPS_LOW_THRESHOLD = 20;
export const ADAPTIVE_FPS_SUSTAIN_MS = 3000;
export const PERF_TEST_DURATION_MS = 10000;

export function resolvePreviewResolutionSetting(
  setting?: PreviewResolutionSetting,
  legacyHighQuality?: boolean
): PreviewResolutionSetting {
  if (setting === '1080p' || setting === '720p' || setting === 'auto') {
    return setting;
  }
  if (legacyHighQuality === false) {
    return '720p';
  }
  return 'auto';
}

export function getTargetPreviewDims(
  setting?: PreviewResolutionSetting,
  targetFrameRate: number = 30
): { width: number; height: number; frameRate: number } {
  const frameRate =
    Number.isFinite(targetFrameRate) && targetFrameRate > 0
      ? Math.round(targetFrameRate)
      : 30;
  if (setting === '720p') {
    return { width: 1280, height: 720, frameRate };
  }
  return { width: 1920, height: 1080, frameRate };
}

export function formatPreviewResolutionLabel(
  setting?: PreviewResolutionSetting
): string {
  const resolved = resolvePreviewResolutionSetting(setting);
  if (resolved === '1080p') return '1080p';
  if (resolved === '720p') return '720p';
  return 'تلقائي';
}

export interface AdaptivePreviewState {
  downgraded: boolean;
  lowFpsSinceMs: number | null;
}

export function createAdaptivePreviewState(): AdaptivePreviewState {
  return {
    downgraded: false,
    lowFpsSinceMs: null,
  };
}

/**
 * Monitors measured preview FPS in 'auto' mode.
 * Returns shouldDowngrade=true once measured FPS stays below threshold
 * continuously for >= 3 seconds while not actively capturing.
 */
export function stepAdaptivePreviewState(
  prev: AdaptivePreviewState,
  input: {
    mode: PreviewResolutionSetting;
    currentFps: number | null;
    nowMs: number;
    isCapturing: boolean;
    targetFps?: number;
  }
): { nextState: AdaptivePreviewState; shouldDowngrade: boolean } {
  if (input.mode !== 'auto' || prev.downgraded) {
    return { nextState: prev, shouldDowngrade: false };
  }
  if (input.isCapturing || input.currentFps === null || !Number.isFinite(input.currentFps)) {
    return {
      nextState: { ...prev, lowFpsSinceMs: null },
      shouldDowngrade: false,
    };
  }
  const threshold =
    typeof input.targetFps === 'number' &&
    Number.isFinite(input.targetFps) &&
    input.targetFps < ADAPTIVE_FPS_LOW_THRESHOLD
      ? Math.max(8, Math.round(input.targetFps - 4))
      : ADAPTIVE_FPS_LOW_THRESHOLD;

  if (input.currentFps < threshold) {
    if (prev.lowFpsSinceMs === null) {
      return {
        nextState: { ...prev, lowFpsSinceMs: input.nowMs },
        shouldDowngrade: false,
      };
    }
    if (input.nowMs - prev.lowFpsSinceMs >= ADAPTIVE_FPS_SUSTAIN_MS) {
      return {
        nextState: { downgraded: true, lowFpsSinceMs: null },
        shouldDowngrade: true,
      };
    }
    return { nextState: prev, shouldDowngrade: false };
  }

  return {
    nextState: { ...prev, lowFpsSinceMs: null },
    shouldDowngrade: false,
  };
}

export interface VideoFrameStats {
  frameCount: number;
  durationMs: number;
  avgFps: number;
  longestGapMs: number;
  gapsOver100Ms: number;
}

export function computeVideoFrameStats(
  timestampsMs: readonly number[]
): VideoFrameStats {
  if (timestampsMs.length < 2) {
    return {
      frameCount: timestampsMs.length,
      durationMs: 0,
      avgFps: 0,
      longestGapMs: 0,
      gapsOver100Ms: 0,
    };
  }

  let longestGapMs = 0;
  let gapsOver100Ms = 0;
  for (let i = 1; i < timestampsMs.length; i++) {
    const gap = Math.max(0, timestampsMs[i] - timestampsMs[i - 1]);
    if (gap > longestGapMs) longestGapMs = gap;
    if (gap > 100) gapsOver100Ms++;
  }

  const durationMs = Math.max(
    1,
    timestampsMs[timestampsMs.length - 1] - timestampsMs[0]
  );
  const intervals = timestampsMs.length - 1;
  const avgFps = Math.round(((intervals * 1000) / durationMs) * 10) / 10;

  return {
    frameCount: timestampsMs.length,
    durationMs: Math.round(durationMs),
    avgFps,
    longestGapMs: Math.round(longestGapMs * 10) / 10,
    gapsOver100Ms,
  };
}

export interface LongTaskSummary {
  countOver50Ms: number;
  longestMs: number;
}

export function summarizeLongTasks(
  durationsMs: readonly number[]
): LongTaskSummary {
  let countOver50Ms = 0;
  let longestMs = 0;
  for (const d of durationsMs) {
    if (!Number.isFinite(d) || d <= 0) continue;
    if (d > 50) countOver50Ms++;
    if (d > longestMs) longestMs = d;
  }
  return {
    countOver50Ms,
    longestMs: Math.round(longestMs * 10) / 10,
  };
}

export interface CameraPerfReport {
  measuredAt: number;
  durationSec: number;
  avgFps: number;
  longestGapMs: number;
  gapsOver100Ms: number;
  longTasksSupported: boolean;
  longTaskCountOver50Ms: number;
  longestLongTaskMs: number;
  requestedWidth: number;
  requestedHeight: number;
  requestedFps: number;
  actualWidth: number;
  actualHeight: number;
  actualFps: number;
  captureMode: CaptureMode;
  lastCaptureMs?: number;
  lastProcessingMs?: number;
  lastSavingMs?: number;
  lastEnhanceMs?: number;
  lastEnhanceLevel?: string;
}

export function buildCameraPerfReport(input: {
  frameTimestampsMs: readonly number[];
  longTaskDurationsMs: readonly number[];
  longTasksSupported: boolean;
  requestedWidth: number;
  requestedHeight: number;
  requestedFps: number;
  actualWidth: number;
  actualHeight: number;
  captureMode?: CaptureMode;
  diagnostics?: CameraDiagnosticsInfo | null;
  durationMs?: number;
}): CameraPerfReport {
  const frameStats = computeVideoFrameStats(input.frameTimestampsMs);
  const longTasks = summarizeLongTasks(input.longTaskDurationsMs);
  const diag = input.diagnostics || {};
  const effectiveMode = input.captureMode ?? diag.lastCaptureMode ?? 'fast';

  return {
    measuredAt: Date.now(),
    durationSec: Math.round(((input.durationMs ?? frameStats.durationMs) / 1000) * 10) / 10,
    avgFps: frameStats.avgFps,
    longestGapMs: frameStats.longestGapMs,
    gapsOver100Ms: frameStats.gapsOver100Ms,
    longTasksSupported: input.longTasksSupported,
    longTaskCountOver50Ms: longTasks.countOver50Ms,
    longestLongTaskMs: longTasks.longestMs,
    requestedWidth: input.requestedWidth,
    requestedHeight: input.requestedHeight,
    requestedFps: input.requestedFps,
    actualWidth: input.actualWidth || diag.previewWidth || 0,
    actualHeight: input.actualHeight || diag.previewHeight || 0,
    actualFps: frameStats.avgFps,
    captureMode: effectiveMode,
    lastCaptureMs: diag.lastCaptureMs,
    lastProcessingMs: diag.lastProcessingMs,
    lastSavingMs: diag.lastSavingMs,
    lastEnhanceMs: diag.lastEnhanceMs,
    lastEnhanceLevel: diag.lastEnhanceLevel
      ? formatEnhanceLevelLabel(diag.lastEnhanceLevel)
      : undefined,
  };
}

export function formatPerfReportRows(
  report: CameraPerfReport
): Array<{ label: string; value: string }> {
  const reqRes = `${report.requestedWidth}×${report.requestedHeight} @ ${report.requestedFps}fps`;
  const actRes =
    report.actualWidth && report.actualHeight
      ? `${report.actualWidth}×${report.actualHeight} @ ${report.actualFps}fps`
      : `غير متاح (${report.actualFps}fps)`;

  const longTaskText = report.longTasksSupported
    ? `${report.longTaskCountOver50Ms} مهمة (الأطول ${report.longestLongTaskMs} م.ث)`
    : 'غير مدعوم في هذا المتصفح';

  const hasStages =
    typeof report.lastCaptureMs === 'number' ||
    typeof report.lastProcessingMs === 'number' ||
    typeof report.lastSavingMs === 'number';
  const stagesText = hasStages
    ? `التقاط: ${Math.round(report.lastCaptureMs ?? 0)} م.ث · معالجة: ${Math.round(
        report.lastProcessingMs ?? 0
      )} م.ث · حفظ: ${Math.round(report.lastSavingMs ?? 0)} م.ث`
    : 'لم تُلتقط صورة بعد';

  const enhanceText =
    typeof report.lastEnhanceMs === 'number'
      ? `${Math.round(report.lastEnhanceMs)} م.ث${
          report.lastEnhanceLevel ? ` (${report.lastEnhanceLevel})` : ''
        }`
      : 'لم يُنفذ بعد';

  return [
    { label: 'متوسط إطارات المعاينة (FPS)', value: `${report.avgFps} إطار/ث` },
    { label: 'أطول فجوة بين إطارين', value: `${report.longestGapMs} م.ث` },
    { label: 'فجوات أكبر من 100 م.ث', value: `${report.gapsOver100Ms}` },
    { label: 'مهام الخيط الرئيسي > 50 م.ث', value: longTaskText },
    {
      label: 'دقة المعاينة (المطلوب / الفعلي)',
      value: `المطلوب ${reqRes} · الفعلي ${actRes}`,
    },
    { label: 'نمط الالتقاط', value: formatCaptureModeLabel(report.captureMode) },
    { label: 'مراحل آخر التقاط', value: stagesText },
    { label: 'زمن تحسين الصورة', value: enhanceText },
  ];
}

export function formatPerfReportText(report: CameraPerfReport): string {
  const rows = formatPerfReportRows(report);
  return [
    `تقرير أداء الكاميرا (${report.durationSec || 10} ثوانٍ):`,
    ...rows.map((r) => `- ${r.label}: ${r.value}`),
  ].join('\n');
}
