import { formatBytesArabic } from '../../utils/arabicText';
import { formatAudioTime } from './musicLogic';
import { MusicPlaybackDiagnostics } from './types';

export const AUDIO_EXTENSION_MIME_MAP: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/opus',
  wav: 'audio/wav',
  flac: 'audio/flac',
  webm: 'audio/webm',
  wma: 'audio/x-ms-wma',
};

export function extractFileExtensionLower(fileName?: string): string {
  const name = (fileName || '').trim().toLowerCase();
  const dotIdx = name.lastIndexOf('.');
  if (dotIdx <= 0 || dotIdx === name.length - 1) return '';
  return name.slice(dotIdx + 1);
}

export function resolveAudioMimeType(
  storedMime?: string | null,
  fileName?: string | null
): string {
  const raw = (storedMime || '').trim().toLowerCase();
  const ext = extractFileExtensionLower(fileName || undefined);
  const extMime = ext ? AUDIO_EXTENSION_MIME_MAP[ext] : undefined;

  if (extMime) {
    // Prefer audio/mp4 or audio/webm when video container MIME was reported,
    // or when MIME is missing / generic octet-stream.
    if (
      !raw ||
      raw === 'application/octet-stream' ||
      raw === 'video/mp4' ||
      raw === 'video/webm' ||
      raw === 'audio/mp3'
    ) {
      return extMime;
    }
  }

  if (raw === 'video/mp4') return 'audio/mp4';
  if (raw === 'video/webm') return 'audio/webm';
  if (raw && raw !== 'application/octet-stream') return raw;
  return extMime || 'audio/mpeg';
}

export interface FormattedPlaybackError {
  message: string;
  reasonOnly: string;
  isDecodeOrSourceError: boolean;
  isAbort: boolean;
}

export function formatMediaErrorReason(params: {
  mediaErrorCode?: number | null;
  mediaErrorMessage?: string;
  playError?: unknown;
  mimeType?: string;
  sizeBytes?: number;
  fileName?: string;
  isRadio?: boolean;
}): FormattedPlaybackError {
  const {
    mediaErrorCode,
    mediaErrorMessage,
    playError,
    mimeType,
    sizeBytes = 0,
    fileName,
    isRadio = false,
  } = params;

  const errObj =
    playError && typeof playError === 'object'
      ? (playError as { name?: string; message?: string })
      : null;
  const playErrName = errObj?.name || '';

  if (playErrName === 'AbortError' && !mediaErrorCode) {
    return {
      message: '',
      reasonOnly: '',
      isDecodeOrSourceError: false,
      isAbort: true,
    };
  }

  let baseReason = '';
  let isDecodeOrSourceError = false;

  if (mediaErrorCode === 1) {
    baseReason = 'توقف التحميل';
  } else if (mediaErrorCode === 2) {
    baseReason = 'خطأ في الشبكة';
  } else if (mediaErrorCode === 3) {
    baseReason = 'تعذر فك تشفير الصوت';
    isDecodeOrSourceError = true;
  } else if (mediaErrorCode === 4) {
    baseReason = 'صيغة أو مصدر غير مدعوم';
    isDecodeOrSourceError = true;
  } else if (playErrName === 'NotAllowedError') {
    baseReason = 'منع المتصفح التشغيل التلقائي — اضغط تشغيل مجدداً';
  } else if (playErrName === 'NotSupportedError') {
    baseReason = 'صيغة أو مصدر غير مدعوم';
    isDecodeOrSourceError = true;
  } else if (mediaErrorMessage && mediaErrorMessage.trim()) {
    baseReason = mediaErrorMessage.trim();
  } else if (errObj?.message && errObj.message.trim()) {
    baseReason = errObj.message.trim();
  } else if (playErrName) {
    baseReason = playErrName;
  } else {
    baseReason = 'فشل غير معروف في التشغيل';
  }

  const resolvedMime = isRadio
    ? 'بث مباشر'
    : resolveAudioMimeType(mimeType, fileName);
  const sizeLabel = isRadio ? '' : ` · ${formatBytesArabic(Math.max(0, sizeBytes))}`;
  const detailSuffix = `(${resolvedMime}${sizeLabel})`;
  const reasonOnly = `${baseReason} ${detailSuffix}`;

  return {
    message: `تعذر التشغيل: ${reasonOnly}`,
    reasonOnly,
    isDecodeOrSourceError,
    isAbort: false,
  };
}

export function resolveInitialVolumeReset(params: {
  volume: number;
  muted: boolean;
  lastNonZeroVolume?: number;
  alreadyReset: boolean;
}): {
  volume: number;
  muted: boolean;
  lastNonZeroVolume: number;
  didReset: boolean;
  toastText: string | null;
} {
  const safeVol = Number.isFinite(params.volume)
    ? Math.max(0, Math.min(1, params.volume))
    : 1;
  const safeLast =
    params.lastNonZeroVolume && params.lastNonZeroVolume > 0
      ? Math.max(0.05, Math.min(1, params.lastNonZeroVolume))
      : safeVol > 0
      ? safeVol
      : 1;

  if (!params.alreadyReset && (params.muted || safeVol <= 0)) {
    return {
      volume: 1,
      muted: false,
      lastNonZeroVolume: 1,
      didReset: true,
      toastText: 'تم رفع الصوت',
    };
  }

  return {
    volume: safeVol,
    muted: Boolean(params.muted),
    lastNonZeroVolume: safeLast,
    didReset: false,
    toastText: null,
  };
}

export function resolvePlayVolumeState(params: {
  volume: number;
  muted: boolean;
  lastNonZeroVolume?: number;
}): {
  volume: number;
  muted: false;
  lastNonZeroVolume: number;
  didAutoUnmute: boolean;
  toastText: string | null;
} {
  const safeVol = Number.isFinite(params.volume)
    ? Math.max(0, Math.min(1, params.volume))
    : 1;
  const fallbackVol =
    params.lastNonZeroVolume && params.lastNonZeroVolume > 0
      ? Math.max(0.05, Math.min(1, params.lastNonZeroVolume))
      : 0.8;

  if (params.muted || safeVol <= 0) {
    const restored = safeVol > 0 ? safeVol : fallbackVol;
    return {
      volume: restored,
      muted: false,
      lastNonZeroVolume: restored,
      didAutoUnmute: true,
      toastText: 'كان الصوت مكتوماً — تم تشغيله',
    };
  }

  return {
    volume: safeVol,
    muted: false,
    lastNonZeroVolume: safeVol,
    didAutoUnmute: false,
    toastText: null,
  };
}

export function describeReadyState(state: number): string {
  switch (state) {
    case 0:
      return '0 (HAVE_NOTHING)';
    case 1:
      return '1 (HAVE_METADATA)';
    case 2:
      return '2 (HAVE_CURRENT_DATA)';
    case 3:
      return '3 (HAVE_FUTURE_DATA)';
    case 4:
      return '4 (HAVE_ENOUGH_DATA)';
    default:
      return String(state);
  }
}

export function describeNetworkState(state: number): string {
  switch (state) {
    case 0:
      return '0 (NETWORK_EMPTY)';
    case 1:
      return '1 (NETWORK_IDLE)';
    case 2:
      return '2 (NETWORK_LOADING)';
    case 3:
      return '3 (NETWORK_NO_SOURCE)';
    default:
      return String(state);
  }
}

export function formatPlaybackDiagnosticsText(
  diag: MusicPlaybackDiagnostics
): string {
  return [
    'تشخيص التشغيل — المشغّل الصوتي',
    `المقطع: ${diag.trackTitle || 'لا يوجد'}`,
    `اسم الملف: ${diag.fileName || 'غير متوفر'}`,
    `نوع الملف (MIME): ${diag.mimeType || 'غير محدد'} (المستخدم: ${diag.resolvedMimeType})`,
    `الحجم: ${formatBytesArabic(diag.sizeBytes)}`,
    `المدة: ${diag.durationSec > 0 ? formatAudioTime(diag.durationSec) : '--:--'}`,
    `readyState: ${describeReadyState(diag.readyState)}`,
    `networkState: ${describeNetworkState(diag.networkState)}`,
    `audio.volume: ${Math.round(diag.volume * 100)}%`,
    `audio.muted: ${diag.muted ? 'نعم (مكتوم)' : 'لا'}`,
    `آخر خطأ: ${diag.lastError || 'لا يوجد'}`,
    'ملاحظة: إذا بدا كل شيء طبيعياً ولا يزال بدون صوت، تأكد من رفع صوت الوسائط من أزرار الهاتف.',
  ].join('\n');
}
