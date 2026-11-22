import type { CameraCandidateRecord } from './cameraSelection';

export interface CameraDiagnosticsInfo {
  previewWidth?: number;
  previewHeight?: number;
  frameRate?: number;
  takePhotoSupported?: boolean;
  maxPhotoWidth?: number;
  maxPhotoHeight?: number;
  focusMode?: string;
  exposureMode?: string;
  whiteBalanceMode?: string;
  lastSavedPhotoWidth?: number;
  lastSavedPhotoHeight?: number;
  lastSavedPhotoMethod?: 'takePhoto' | 'videoFrame' | 'gallery';
  torchSupported?: boolean;
  requestedTorch?: boolean;
  actualTorch?: boolean | null;
  lastApplyConstraintsError?: string | null;
  lastAppliedConstraints?: Record<string, unknown> | null;
  rememberedTorchDeviceId?: string | null;
  selectedCameraDeviceId?: string | null;
  activeCameraDeviceId?: string | null;
  activeCameraLabel?: string | null;
  cameraProbeSignature?: string | null;
  noTorchCandidateFound?: boolean;
  candidates?: CameraCandidateRecord[];
  updatedAt?: number;
}

const CAMERA_DIAG_KEY = 'naqs_camera_diagnostics_v1';

export function readCameraDiagnostics(): CameraDiagnosticsInfo {
  if (typeof window === 'undefined' || !window.localStorage) {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(CAMERA_DIAG_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveCameraDiagnostics(
  partial: Partial<CameraDiagnosticsInfo>
): CameraDiagnosticsInfo {
  const next: CameraDiagnosticsInfo = {
    ...readCameraDiagnostics(),
    ...partial,
    updatedAt: Date.now(),
  };
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(CAMERA_DIAG_KEY, JSON.stringify(next));
    } catch {
      // Ignore quota/storage issues
    }
  }
  return next;
}

export interface CameraDiagnosticsDisplayRow {
  label: string;
  value: string;
}

export function formatCameraCandidateSummary(
  cand: CameraCandidateRecord,
  isInUse: boolean
): CameraDiagnosticsDisplayRow {
  const title = cand.label?.trim() || `كاميرا #${cand.index + 1}`;
  const torchText = cand.probed
    ? cand.torchSupported
      ? 'فلاش: نعم'
      : 'فلاش: لا'
    : 'فلاش: غير مفحوص';
  const zoomText =
    typeof cand.zoomMin === 'number' && typeof cand.zoomMax === 'number'
      ? `تقريب: ${cand.zoomMin}–${cand.zoomMax}x`
      : 'تقريب: غير متاح';
  const parts = [title, torchText, zoomText];
  if (cand.probeError) {
    parts.push(`خطأ: ${cand.probeError}`);
  }
  return {
    label: isInUse
      ? `كاميرا ${cand.index + 1} (المستخدمة)`
      : `كاميرا ${cand.index + 1}`,
    value: parts.join(' · '),
  };
}

export function buildCameraDiagnosticsRows(
  info: CameraDiagnosticsInfo,
  fallbackLastPhoto?: { width?: number; height?: number } | null
): CameraDiagnosticsDisplayRow[] {
  const previewText =
    info.previewWidth && info.previewHeight
      ? `${info.previewWidth} × ${info.previewHeight}${
          info.frameRate ? ` (${Math.round(info.frameRate)} إطار/ث)` : ''
        }`
      : 'غير متاحة (افتح الكاميرا أولاً)';

  const lastW = info.lastSavedPhotoWidth ?? fallbackLastPhoto?.width;
  const lastH = info.lastSavedPhotoHeight ?? fallbackLastPhoto?.height;
  const methodLabel =
    info.lastSavedPhotoMethod === 'takePhoto'
      ? ' · takePhoto'
      : info.lastSavedPhotoMethod === 'videoFrame'
      ? ' · إطار فيديو'
      : info.lastSavedPhotoMethod === 'gallery'
      ? ' · المعرض'
      : '';
  const lastPhotoText =
    lastW && lastH ? `${lastW} × ${lastH}${methodLabel}` : 'لم تُحفظ صورة بعد';

  const takePhotoText =
    info.takePhotoSupported === undefined
      ? 'غير مفحوص بعد'
      : info.takePhotoSupported
      ? info.maxPhotoWidth && info.maxPhotoHeight
        ? `مدعوم (الحد الأقصى ${info.maxPhotoWidth} × ${info.maxPhotoHeight})`
        : 'مدعوم'
      : 'غير مدعوم (يستخدم إطار الفيديو الكامل)';

  const focusText = info.focusMode || 'تلقائي افتراضي';
  const exposureText = info.exposureMode || 'تلقائي افتراضي';

  const torchSupportedText =
    info.torchSupported === undefined
      ? 'غير مفحوص بعد'
      : info.torchSupported
      ? 'نعم'
      : 'لا';

  const requestedTorchText =
    info.requestedTorch === undefined
      ? 'لم يُطلب بعد'
      : info.requestedTorch
      ? 'تشغيل (ON)'
      : 'إيقاف (OFF)';

  const actualTorchText =
    info.actualTorch === true
      ? 'تشغيل (ON)'
      : info.actualTorch === false
      ? 'إيقاف (OFF)'
      : info.torchSupported !== undefined || info.requestedTorch !== undefined
      ? 'غير متاح في getSettings()'
      : 'غير مفحوص بعد';

  const lastErrorText = info.lastApplyConstraintsError
    ? info.lastApplyConstraintsError
    : 'لا يوجد';

  const lastConstraintsText = info.lastAppliedConstraints
    ? JSON.stringify(info.lastAppliedConstraints)
    : 'لم تُرسل قيود بعد';

  const rows: CameraDiagnosticsDisplayRow[] = [
    { label: 'دقة المعاينة الفعلية', value: previewText },
    { label: 'دقة آخر صورة محفوظة', value: lastPhotoText },
    { label: 'التقاط الحساس (takePhoto)', value: takePhotoText },
    {
      label: 'التركيز والتعريض النشط',
      value: `تركيز: ${focusText} · تعريض: ${exposureText}`,
    },
    { label: 'دعم الفلاش (torch)', value: torchSupportedText },
    { label: 'حالة الفلاش المطلوبة', value: requestedTorchText },
    { label: 'حالة الفلاش الفعلية', value: actualTorchText },
    { label: 'آخر خطأ applyConstraints', value: lastErrorText },
    { label: 'آخر قيود مُرسلة', value: lastConstraintsText },
  ];

  if (Array.isArray(info.candidates) && info.candidates.length > 0) {
    for (const cand of info.candidates) {
      const isInUse = Boolean(
        info.activeCameraDeviceId && cand.deviceId === info.activeCameraDeviceId
      );
      rows.push(formatCameraCandidateSummary(cand, isInUse));
    }
  } else if (info.activeCameraLabel || info.activeCameraDeviceId) {
    rows.push({
      label: 'الكاميرا المستخدمة',
      value: info.activeCameraLabel || info.activeCameraDeviceId || 'الافتراضية',
    });
  }

  return rows;
}

export function formatCameraDiagnosticsClipboardText(
  info: CameraDiagnosticsInfo,
  fallbackLastPhoto?: { width?: number; height?: number } | null
): string {
  const rows = buildCameraDiagnosticsRows(info, fallbackLastPhoto);
  return ['معلومات الكاميرا:', ...rows.map((r) => `- ${r.label}: ${r.value}`)].join(
    '\n'
  );
}
