import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  Copy,
  Database,
  Download,
  FileText,
  HardDrive,
  Image as ImageIcon,
  Music,
  RotateCcw,
  SlidersHorizontal,
  Smartphone,
  Stethoscope,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  AppSettings,
  BatterySaverMode,
  CameraIdleTimeoutSec,
  PhotoEnhanceLevel,
  PreviewFrameRateSetting,
  PreviewResolutionSetting,
} from '../../types';
import {
  buildBatteryMeasurementRows,
  formatBatteryMeasurementClipboardText,
  getEffectiveCameraPowerProfile,
  getSessionCameraActiveMs,
  getSessionCaptureCount,
  resolveBatterySaverMode,
  resolveCameraIdleTimeoutSec,
  resolvePreviewFrameRateSetting,
  subscribeSessionPowerStats,
} from '../power/batterySaver';
import { BatterySaverState } from '../power/useBatterySaver';
import { NoteSettingsSheet } from '../notes/NoteSettingsSheet';
import {
  MusicAddFilesResult,
  MusicImportProgress,
  MusicImportReport,
  MusicPlaybackDiagnostics,
  MusicStorageStats,
} from '../music/types';
import {
  DEFAULT_MUSIC_MAX_STORAGE_MB,
  MUSIC_FAB_COLOR_PRESETS,
} from '../music/musicLogic';
import {
  MusicAudioImporterTrigger,
  MusicImportStatusPanel,
} from '../music/MusicAudioImporter';
import { MusicDiagnosticsModal } from '../music/MusicDiagnosticsModal';
import {
  cleanupExpiredDonePhotos,
  clearAllData,
  exportBackupJson,
  getAllPhotos,
  getStorageBreakdown,
  importBackupJson,
  StorageBreakdown,
} from '../db';
import {
  buildCameraDiagnosticsRows,
  CameraDiagnosticsInfo,
  formatCameraDiagnosticsClipboardText,
  readCameraDiagnostics,
  saveCameraDiagnostics,
} from '../camera/cameraDiagnostics';
import {
  buildCameraPerfReport,
  CameraPerfReport,
  formatPerfReportRows,
  formatPerfReportText,
  getTargetPreviewDims,
  PERF_TEST_DURATION_MS,
  resolvePreviewResolutionSetting,
} from '../camera/cameraPerf';
import { resolveCaptureMode } from '../camera/captureQueue';
import { startCameraWithRetryLadder } from '../camera/cameraStartup';
import { estimateDataUrlBytes } from '../camera/imageCompression';
import { formatBytesArabic } from '../../utils/arabicText';
import { PWAInstallButton } from '../../components/PWAInstallButton';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { useOfflineSWStatus } from '../../pwa/registerOfflineSW';
import {
  buildPwaDiagnosticsRows,
  formatPwaDiagnosticsClipboardText,
  IFRAME_INSTALL_WARNING_TEXT,
  isRunningInIframe,
  PwaDiagnosticsSnapshot,
  runLivePwaDiagnostics,
} from '../../pwa/pwaDiagnostics';

interface SettingsScreenProps {
  settings: AppSettings;
  isOnline?: boolean;
  refreshSignal: number;
  batterySaverState?: BatterySaverState;
  musicStorageStats?: MusicStorageStats;
  musicVolume?: number;
  musicMuted?: boolean;
  musicImportProgress?: MusicImportProgress | null;
  musicImportReport?: MusicImportReport | null;
  audioReactiveWarning?: boolean;
  onAddMusicFiles?: (files: File[]) => Promise<MusicAddFilesResult>;
  onCancelMusicImport?: () => void;
  onDismissMusicImportReport?: () => void;
  onOpenMusicPlayer?: () => void;
  onResetMusicVolume?: () => void;
  onGetMusicDiagnostics?: () => MusicPlaybackDiagnostics;
  onClearMusicLibrary?: () => Promise<void>;
  onUpdateSettings: (partial: Partial<AppSettings>) => Promise<void>;
  onDataChanged: () => void;
}

const KEEP_OPTIONS: Array<{ days: 1 | 3 | 7; label: string }> = [
  { days: 1, label: 'يوم' },
  { days: 3, label: '3 أيام' },
  { days: 7, label: 'أسبوع' },
];

const MUSIC_MAX_OPTIONS_MB = [250, 500, 1000, 2000] as const;

type SettingsSectionKey = 'camera' | 'photos' | 'notes' | 'music' | 'data';

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  settings,
  refreshSignal,
  batterySaverState,
  musicStorageStats,
  musicVolume = 1,
  musicMuted = false,
  musicImportProgress = null,
  musicImportReport = null,
  audioReactiveWarning = false,
  onAddMusicFiles,
  onCancelMusicImport,
  onDismissMusicImportReport,
  onOpenMusicPlayer,
  onResetMusicVolume,
  onGetMusicDiagnostics,
  onClearMusicLibrary,
  onUpdateSettings,
  onDataChanged,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Collapsible card states: ONLY the first card ("التصوير") is expanded by default
  const [openSections, setOpenSections] = useState<
    Record<SettingsSectionKey, boolean>
  >({
    camera: true,
    photos: false,
    notes: false,
    music: false,
    data: false,
  });
  const [cameraAdvancedOpen, setCameraAdvancedOpen] = useState(false);
  const [musicAdvancedOpen, setMusicAdvancedOpen] = useState(false);
  const [dataAdvancedOpen, setDataAdvancedOpen] = useState(false);
  const [pwaDiagnosticsOpen, setPwaDiagnosticsOpen] = useState(false);
  const [pwaDiagnostics, setPwaDiagnostics] =
    useState<PwaDiagnosticsSnapshot | null>(null);
  const [pwaDiagnosticsLoading, setPwaDiagnosticsLoading] = useState(false);
  const [copiedPwaDiagnostics, setCopiedPwaDiagnostics] = useState(false);
  const [showNoteSettingsSheet, setShowNoteSettingsSheet] = useState(false);
  const [showMusicDiagnostics, setShowMusicDiagnostics] = useState(false);
  const [musicDiagnosticsData, setMusicDiagnosticsData] =
    useState<MusicPlaybackDiagnostics | null>(null);

  const { isInstallable, isInstalled, install } = usePWAInstall();
  const swStatus = useOfflineSWStatus();
  const runningInIframe = isRunningInIframe();

  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmClearMusic, setConfirmClearMusic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [storageBreakdown, setStorageBreakdown] = useState<StorageBreakdown>({
    photosBytes: 0,
    notesBytes: 0,
    audioBytes: 0,
    totalBytes: 0,
  });
  const [cameraDiagnostics, setCameraDiagnostics] =
    useState<CameraDiagnosticsInfo>(() => readCameraDiagnostics());
  const [fallbackLastPhotoDims, setFallbackLastPhotoDims] = useState<{
    width?: number;
    height?: number;
    bytes?: number;
  } | null>(null);
  const [copiedCameraInfo, setCopiedCameraInfo] = useState(false);
  const [copiedPerfReport, setCopiedPerfReport] = useState(false);
  const [copiedBatteryReport, setCopiedBatteryReport] = useState(false);
  const [sessionStatsTick, setSessionStatsTick] = useState(0);
  const [perfTestRunning, setPerfTestRunning] = useState(false);
  const [perfTestRemainingSec, setPerfTestRemainingSec] = useState(10);
  const [perfReport, setPerfReport] = useState<CameraPerfReport | null>(null);
  const [probeCameraStatus, setProbeCameraStatus] = useState<
    'idle' | 'starting' | 'active' | 'error'
  >('idle');
  const probeVideoRef = useRef<HTMLVideoElement | null>(null);
  const probeStreamRef = useRef<MediaStream | null>(null);
  const liveFpsDomRef = useRef<HTMLSpanElement | null>(null);
  const perfFramesBufferRef = useRef<number[] | null>(null);
  const perfTestAbortRef = useRef<(() => void) | null>(null);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const loadMeta = useCallback(async () => {
    try {
      setCameraDiagnostics(readCameraDiagnostics());
      const [breakdown, allPhotos] = await Promise.all([
        getStorageBreakdown(),
        getAllPhotos(),
      ]);
      setStorageBreakdown(breakdown);
      const latestPhoto = allPhotos[0];
      if (latestPhoto && latestPhoto.width > 0 && latestPhoto.height > 0) {
        setFallbackLastPhotoDims({
          width: latestPhoto.width,
          height: latestPhoto.height,
          bytes: estimateDataUrlBytes(latestPhoto.dataUrl),
        });
      } else {
        setFallbackLastPhotoDims(null);
      }
    } catch {
      // Ignore read errors
    }
  }, []);

  useEffect(() => {
    loadMeta();
  }, [loadMeta, refreshSignal]);

  const pwaDiagnosticsActive =
    openSections.data && dataAdvancedOpen && pwaDiagnosticsOpen;

  useEffect(() => {
    if (!pwaDiagnosticsActive) return;
    let cancelled = false;
    setPwaDiagnosticsLoading(true);
    runLivePwaDiagnostics(swStatus.lastError)
      .then((snap) => {
        if (!cancelled) {
          setPwaDiagnostics(snap);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPwaDiagnosticsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    pwaDiagnosticsActive,
    swStatus.swActive,
    swStatus.swRegistered,
    swStatus.lastError,
    isInstalled,
    refreshSignal,
  ]);

  const cameraAdvancedActive = openSections.camera && cameraAdvancedOpen;
  const effectivePreviewRes = resolvePreviewResolutionSetting(
    settings.previewResolution,
    settings.cameraHighQuality
  );
  const isBatterySaverOn = Boolean(batterySaverState?.isBatterySaverOn);
  const configuredIdleTimeoutSec = resolveCameraIdleTimeoutSec(
    settings.cameraIdleTimeoutSec
  );
  const configuredFrameRate = resolvePreviewFrameRateSetting(
    settings.previewFrameRate
  );
  const configuredBatterySaverMode = resolveBatterySaverMode(
    settings.batterySaverMode
  );
  const effectivePowerProfile = getEffectiveCameraPowerProfile({
    settings,
    isBatterySaverOn,
  });
  const effectiveFrameRate = effectivePowerProfile.frameRate;

  // Subscribe to session power telemetry only while Camera > Advanced is expanded
  useEffect(() => {
    if (!cameraAdvancedActive) return;
    setSessionStatsTick((v) => v + 1);
    const unsubscribe = subscribeSessionPowerStats(() => {
      setSessionStatsTick((v) => v + 1);
    });
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        setSessionStatsTick((v) => v + 1);
      }
    }, 1000);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [cameraAdvancedActive]);

  // Live FPS probe stream active whenever "التصوير" > "متقدم" is expanded and page is visible
  useEffect(() => {
    if (!cameraAdvancedActive) {
      perfTestAbortRef.current?.();
      if (probeStreamRef.current) {
        for (const t of probeStreamRef.current.getTracks()) {
          try {
            t.stop();
          } catch {
            // Ignore
          }
        }
        probeStreamRef.current = null;
      }
      if (probeVideoRef.current) {
        probeVideoRef.current.srcObject = null;
      }
      setProbeCameraStatus('idle');
      return;
    }

    let cancelled = false;
    let rvfcId: number | null = null;
    let fpsTimerId: number | null = null;
    const recentFrames: number[] = [];

    const stopProbeStream = () => {
      perfTestAbortRef.current?.();
      if (fpsTimerId !== null) {
        window.clearInterval(fpsTimerId);
        fpsTimerId = null;
      }
      const videoEl = probeVideoRef.current;
      const cancelRvfc = videoEl
        ? (
            videoEl as HTMLVideoElement & {
              cancelVideoFrameCallback?: (id: number) => void;
            }
          ).cancelVideoFrameCallback
        : undefined;
      if (videoEl && rvfcId !== null && typeof cancelRvfc === 'function') {
        try {
          cancelRvfc.call(videoEl, rvfcId);
        } catch {
          // Ignore
        }
        rvfcId = null;
      }
      if (probeStreamRef.current) {
        for (const t of probeStreamRef.current.getTracks()) {
          try {
            t.stop();
          } catch {
            // Ignore
          }
        }
        probeStreamRef.current = null;
      }
      if (videoEl) {
        videoEl.srcObject = null;
      }
    };

    const startProbe = async () => {
      if (document.visibilityState === 'hidden') {
        setProbeCameraStatus('idle');
        return;
      }
      if (
        typeof navigator === 'undefined' ||
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
      ) {
        setProbeCameraStatus('error');
        if (liveFpsDomRef.current) {
          liveFpsDomRef.current.textContent = 'غير متاح';
        }
        return;
      }

      setProbeCameraStatus('starting');
      if (liveFpsDomRef.current) {
        liveFpsDomRef.current.textContent = 'جاري القياس…';
      }

      try {
        const isDocHiddenNow = () =>
          typeof document !== 'undefined' &&
          document.visibilityState === 'hidden';
        const stream = await startCameraWithRetryLadder({
          previewResolution: effectivePreviewRes,
          frameRate: effectiveFrameRate,
          targetDeviceId: settings.selectedCameraDeviceId || null,
          getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
          isCancelled: () => cancelled || isDocHiddenNow(),
        });

        if (cancelled || isDocHiddenNow()) {
          for (const t of stream.getTracks()) {
            try {
              t.stop();
            } catch {
              // Ignore
            }
          }
          return;
        }

        probeStreamRef.current = stream;
        const videoEl = probeVideoRef.current;
        if (videoEl) {
          videoEl.srcObject = stream;
          await videoEl.play().catch(() => {});
        }
        if (cancelled) return;

        setProbeCameraStatus('active');

        const rVfc = videoEl
          ? (
              videoEl as HTMLVideoElement & {
                requestVideoFrameCallback?: (cb: (now: number) => void) => number;
              }
            ).requestVideoFrameCallback
          : undefined;

        if (videoEl && typeof rVfc === 'function') {
          const onFrame = (now: number) => {
            if (cancelled) return;
            if (document.visibilityState === 'visible') {
              recentFrames.push(now);
              while (recentFrames.length > 0 && now - recentFrames[0] > 1500) {
                recentFrames.shift();
              }
              if (perfFramesBufferRef.current) {
                perfFramesBufferRef.current.push(now);
              }
            }
            rvfcId = rVfc.call(videoEl, onFrame);
          };
          rvfcId = rVfc.call(videoEl, onFrame);
        }

        fpsTimerId = window.setInterval(() => {
          if (
            cancelled ||
            !liveFpsDomRef.current ||
            document.visibilityState !== 'visible'
          ) {
            return;
          }
          if (recentFrames.length >= 2) {
            const span =
              recentFrames[recentFrames.length - 1] - recentFrames[0];
            const fps =
              span > 0 ? ((recentFrames.length - 1) * 1000) / span : 0;
            liveFpsDomRef.current.textContent = `${Math.round(fps)} إطار/ث`;
          } else if (videoEl && videoEl.readyState >= 2) {
            liveFpsDomRef.current.textContent = '0 إطار/ث';
          }
        }, 400);
      } catch {
        if (!cancelled) {
          setProbeCameraStatus('error');
          if (liveFpsDomRef.current) {
            liveFpsDomRef.current.textContent = 'غير متاح';
          }
        }
      }
    };

    const handleProbeVisibility = () => {
      if (document.visibilityState === 'hidden') {
        stopProbeStream();
        setProbeCameraStatus('idle');
      } else if (!cancelled && !probeStreamRef.current) {
        recentFrames.length = 0;
        void startProbe();
      }
    };

    document.addEventListener('visibilitychange', handleProbeVisibility);
    void startProbe();

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleProbeVisibility);
      stopProbeStream();
    };
  }, [
    cameraAdvancedActive,
    effectivePreviewRes,
    effectiveFrameRate,
    settings.selectedCameraDeviceId,
  ]);

  const toggleSection = (key: SettingsSectionKey) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const showMessage = (type: 'success' | 'error', text: string) => {
    setFeedback({ type, text });
    window.setTimeout(() => {
      setFeedback((prev) => (prev?.text === text ? null : prev));
    }, 4500);
  };

  const handleCleanupNow = async () => {
    setBusy(true);
    try {
      const cleaned = await cleanupExpiredDonePhotos(
        settings.keepPhotosDays,
        true
      );
      await loadMeta();
      onDataChanged();
      showMessage(
        'success',
        cleaned > 0
          ? 'تم تنظيف الصور المكتملة بنجاح مع الحفاظ على السجلات والملاحظات.'
          : 'لا توجد صور مكتملة تحتاج إلى تنظيف حالياً.'
      );
    } catch {
      showMessage('error', 'تعذر تنظيف التخزين.');
    } finally {
      setBusy(false);
    }
  };

  const handleCopyCameraDiagnostics = async () => {
    const text = formatCameraDiagnosticsClipboardText(
      cameraDiagnostics,
      fallbackLastPhotoDims,
      settings.captureMode
    );
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopiedCameraInfo(true);
      window.setTimeout(() => setCopiedCameraInfo(false), 2200);
    } catch {
      showMessage('error', 'تعذر نسخ معلومات الكاميرا.');
    }
  };

  const handleRunPerfTest = () => {
    if (perfTestRunning) return;
    setPerfTestRunning(true);
    setPerfTestRemainingSec(10);

    const frameTimestamps: number[] = [];
    perfFramesBufferRef.current = frameTimestamps;

    const longTaskDurations: number[] = [];
    let longTasksSupported = false;
    let observer: PerformanceObserver | null = null;

    if (typeof PerformanceObserver === 'function') {
      try {
        const supported = PerformanceObserver.supportedEntryTypes;
        if (!Array.isArray(supported) || supported.includes('longtask')) {
          observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              longTaskDurations.push(entry.duration);
            }
          });
          observer.observe({ type: 'longtask', buffered: false });
          longTasksSupported = true;
        }
      } catch {
        longTasksSupported = false;
        observer = null;
      }
    }

    const startPerfAt = performance.now();
    let countdownTimer: number | null = null;
    let finishTimer: number | null = null;

    const cleanup = () => {
      if (countdownTimer !== null) window.clearInterval(countdownTimer);
      if (finishTimer !== null) window.clearTimeout(finishTimer);
      if (observer) {
        try {
          observer.disconnect();
        } catch {
          // Ignore
        }
      }
      perfFramesBufferRef.current = null;
      perfTestAbortRef.current = null;
    };

    perfTestAbortRef.current = () => {
      cleanup();
      setPerfTestRunning(false);
    };

    countdownTimer = window.setInterval(() => {
      const elapsed = performance.now() - startPerfAt;
      const rem = Math.max(
        1,
        Math.ceil((PERF_TEST_DURATION_MS - elapsed) / 1000)
      );
      setPerfTestRemainingSec(rem);
    }, 500);

    finishTimer = window.setTimeout(() => {
      const totalElapsed = Math.max(1, performance.now() - startPerfAt);
      const targetDims = getTargetPreviewDims(
        effectivePreviewRes,
        effectiveFrameRate
      );
      const videoEl = probeVideoRef.current;
      const track = probeStreamRef.current?.getVideoTracks()[0];
      const trackSettings =
        track && typeof track.getSettings === 'function'
          ? track.getSettings()
          : undefined;
      const diag = readCameraDiagnostics();
      const actualWidth =
        videoEl?.videoWidth || trackSettings?.width || diag.previewWidth || 0;
      const actualHeight =
        videoEl?.videoHeight || trackSettings?.height || diag.previewHeight || 0;

      const report = buildCameraPerfReport({
        frameTimestampsMs: frameTimestamps,
        longTaskDurationsMs: longTaskDurations,
        longTasksSupported,
        requestedWidth: diag.requestedPreviewWidth || targetDims.width,
        requestedHeight: diag.requestedPreviewHeight || targetDims.height,
        requestedFps: diag.requestedFrameRate || targetDims.frameRate,
        actualWidth,
        actualHeight,
        captureMode: resolveCaptureMode(settings.captureMode),
        diagnostics: diag,
        durationMs: totalElapsed,
      });

      cleanup();
      setPerfReport(report);
      setPerfTestRunning(false);
    }, PERF_TEST_DURATION_MS);
  };

  const handleCopyPerfReport = async () => {
    if (!perfReport) return;
    const text = formatPerfReportText(perfReport);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopiedPerfReport(true);
      window.setTimeout(() => setCopiedPerfReport(false), 2200);
    } catch {
      showMessage('error', 'تعذر نسخ تقرير الأداء.');
    }
  };

  const sessionPowerTelemetry = (() => {
    void sessionStatsTick;
    return {
      cameraActiveMs: getSessionCameraActiveMs(),
      sessionCaptures: getSessionCaptureCount(),
      batterySupported: Boolean(batterySaverState?.batterySupported),
      initialBatteryLevel: batterySaverState?.initialBatteryLevel ?? null,
      currentBatteryLevel: batterySaverState?.currentBatteryLevel ?? null,
      batteryCharging: batterySaverState?.charging ?? null,
      batterySaverOn: isBatterySaverOn,
      batterySaverMode: configuredBatterySaverMode,
    };
  })();

  const handleCopyBatteryMeasurement = async () => {
    const text = formatBatteryMeasurementClipboardText(sessionPowerTelemetry);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopiedBatteryReport(true);
      window.setTimeout(() => setCopiedBatteryReport(false), 2200);
    } catch {
      showMessage('error', 'تعذر نسخ قياس البطارية.');
    }
  };

  const handleCopyPwaDiagnostics = async () => {
    if (!pwaDiagnostics) return;
    const text = formatPwaDiagnosticsClipboardText(pwaDiagnostics);
    try {
      let copied = false;
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(text);
          copied = true;
        } catch {
          // Fall back to textarea + execCommand when Clipboard API permission is denied
        }
      }
      if (!copied) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        copied = document.execCommand('copy');
        document.body.removeChild(ta);
      }
      if (!copied) {
        throw new Error('copy_failed');
      }
      setCopiedPwaDiagnostics(true);
      window.setTimeout(() => setCopiedPwaDiagnostics(false), 2200);
    } catch {
      showMessage('error', 'تعذر نسخ حالة التثبيت.');
    }
  };

  const handleExport = async () => {
    setBusy(true);
    try {
      const json = await exportBackupJson();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `naqs-alrofoof-backup-${new Date()
        .toISOString()
        .slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showMessage('success', 'تم تصدير النسخة الاحتياطية بنجاح.');
    } catch {
      showMessage('error', 'فشل تصدير النسخة الاحتياطية.');
    } finally {
      setBusy(false);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setBusy(true);
    try {
      const text = await file.text();
      await importBackupJson(text);
      await loadMeta();
      onDataChanged();
      showMessage('success', 'تم استيراد النسخة الاحتياطية بنجاح.');
    } catch {
      showMessage('error', 'ملف النسخة الاحتياطية غير صالح أو تالف.');
    } finally {
      setBusy(false);
    }
  };

  const handleClearAll = async () => {
    setBusy(true);
    try {
      await clearAllData();
      setConfirmClear(false);
      await loadMeta();
      onDataChanged();
      showMessage('success', 'تم مسح جميع البيانات المحلية بنجاح.');
    } catch {
      showMessage('error', 'تعذر مسح البيانات.');
    } finally {
      setBusy(false);
    }
  };

  const handleClearMusicLibrary = async () => {
    if (!onClearMusicLibrary) return;
    setBusy(true);
    try {
      await onClearMusicLibrary();
      setConfirmClearMusic(false);
      await loadMeta();
      onDataChanged();
      showMessage('success', 'تم حذف المكتبة الصوتية بنجاح.');
    } catch {
      showMessage('error', 'تعذر حذف المكتبة الصوتية.');
    } finally {
      setBusy(false);
    }
  };

  const renderToggle = (
    checked: boolean,
    onToggle: () => void,
    label: string
  ) => (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      onClick={onToggle}
      className={`w-14 h-9 rounded-full p-1 transition-colors shrink-0 ${
        checked ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'
      }`}
    >
      <span
        className={`block w-7 h-7 rounded-full bg-white shadow transition-transform ${
          checked ? '-translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );

  const renderCardHeader = (
    sectionKey: SettingsSectionKey,
    title: string,
    icon: React.ReactNode
  ) => {
    const expanded = openSections[sectionKey];
    return (
      <button
        type="button"
        aria-expanded={expanded}
        data-testid={`settings-toggle-${sectionKey}`}
        onClick={() => toggleSection(sectionKey)}
        className="w-full min-h-[60px] px-4 py-3 flex items-center justify-between gap-3 text-right hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
            {icon}
          </div>
          <span className="text-base font-extrabold text-slate-900 dark:text-white">
            {title}
          </span>
        </div>
        <ChevronDown
          className={`w-5 h-5 text-slate-400 transition-transform duration-200 shrink-0 ${
            expanded ? 'rotate-180 text-emerald-500' : ''
          }`}
        />
      </button>
    );
  };

  const volumePercent = Math.round((musicMuted ? 0 : musicVolume) * 100);
  const audioDisplayBytes =
    musicStorageStats?.usedBytes ?? storageBreakdown.audioBytes;

  return (
    <div
      className="min-h-[100dvh] pb-28 bg-[#F7F8FA] dark:bg-slate-950"
      dir="rtl"
    >
      <header className="sticky top-0 z-20 bg-[#F7F8FA]/95 dark:bg-slate-950/95 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800 px-4 pt-[calc(1rem+env(safe-area-inset-top,0px))] pb-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
          <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">
            الإعدادات
          </h1>
          <PWAInstallButton variant="compact" />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 pt-4 space-y-3">
        {feedback && (
          <div
            className={`rounded-[20px] p-4 flex items-center gap-3 text-sm font-bold shadow-sm border ${
              feedback.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                : 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800'
            }`}
          >
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 shrink-0" />
            ) : (
              <AlertTriangle className="w-5 h-5 shrink-0" />
            )}
            <span>{feedback.text}</span>
          </div>
        )}

        {/* 1) التصوير (مفتوح افتراضياً) */}
        <section
          data-testid="settings-section-camera"
          className="bg-white dark:bg-slate-900 rounded-[20px] border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden"
        >
          {renderCardHeader('camera', 'التصوير', <Camera className="w-5 h-5" />)}

          {openSections.camera && (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 border-t border-slate-100 dark:border-slate-800">
              {/* دقة المعاينة */}
              <div
                className="p-4 space-y-2.5"
                data-testid="settings-preview-resolution"
              >
                <div className="text-sm font-bold text-slate-900 dark:text-white">
                  دقة المعاينة
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { value: 'auto', label: 'تلقائي' },
                      { value: '1080p', label: '1080p' },
                      { value: '720p', label: '720p' },
                    ] as const satisfies ReadonlyArray<{
                      value: PreviewResolutionSetting;
                      label: string;
                    }>
                  ).map((opt) => {
                    const active = effectivePreviewRes === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        data-testid={`preview-resolution-${opt.value}`}
                        aria-pressed={active}
                        onClick={() =>
                          onUpdateSettings({
                            previewResolution: opt.value,
                            cameraHighQuality: opt.value !== '720p',
                          })
                        }
                        className={`min-h-[44px] px-3 rounded-2xl text-xs font-extrabold transition ${
                          active
                            ? 'bg-emerald-500 text-white shadow-sm'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* نمط الالتقاط */}
              <div className="p-4 space-y-2.5" data-testid="settings-capture-mode">
                <div className="text-sm font-bold text-slate-900 dark:text-white">
                  نمط الالتقاط
                </div>
                <div className="grid grid-cols-2 gap-2 items-start">
                  <button
                    type="button"
                    data-testid="capture-mode-fast"
                    aria-pressed={resolveCaptureMode(settings.captureMode) === 'fast'}
                    onClick={() => {
                      const updatedDiag = saveCameraDiagnostics({
                        lastCaptureMode: 'fast',
                      });
                      setCameraDiagnostics(updatedDiag);
                      onUpdateSettings({ captureMode: 'fast' });
                    }}
                    className={`min-h-[50px] px-3 py-2 rounded-2xl text-xs font-extrabold transition flex flex-col items-center justify-center gap-0.5 ${
                      resolveCaptureMode(settings.captureMode) === 'fast'
                        ? 'bg-emerald-500 text-white shadow-sm'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    <span>سريع</span>
                    <span
                      className={`text-[10px] font-semibold ${
                        resolveCaptureMode(settings.captureMode) === 'fast'
                          ? 'text-emerald-50'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      فوري من إطار الفيديو
                    </span>
                  </button>

                  <div className="space-y-1">
                    <button
                      type="button"
                      data-testid="capture-mode-high-quality"
                      aria-pressed={
                        resolveCaptureMode(settings.captureMode) === 'high-quality'
                      }
                      onClick={() => {
                        const updatedDiag = saveCameraDiagnostics({
                          lastCaptureMode: 'high-quality',
                        });
                        setCameraDiagnostics(updatedDiag);
                        onUpdateSettings({ captureMode: 'high-quality' });
                      }}
                      className={`w-full min-h-[50px] px-3 py-2 rounded-2xl text-xs font-extrabold transition flex flex-col items-center justify-center gap-0.5 ${
                        resolveCaptureMode(settings.captureMode) === 'high-quality'
                          ? 'bg-emerald-500 text-white shadow-sm'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                      }`}
                    >
                      <span>جودة عالية</span>
                      <span
                        className={`text-[10px] font-semibold ${
                          resolveCaptureMode(settings.captureMode) === 'high-quality'
                            ? 'text-emerald-50'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        أقصى دقة للحساس
                      </span>
                    </button>
                    <p
                      data-testid="capture-mode-hq-hint"
                      className="text-[10px] text-slate-500 dark:text-slate-400 text-center leading-snug px-1"
                    >
                      قد يتجمد العرض لحظة على بعض الهواتف
                    </p>
                  </div>
                </div>
              </div>

              {/* الفلاش التلقائي */}
              <div className="p-4 flex items-center justify-between gap-4 min-h-[60px]">
                <div className="text-sm font-bold text-slate-900 dark:text-white">
                  الفلاش التلقائي
                </div>
                {renderToggle(
                  settings.autoFlash,
                  () => onUpdateSettings({ autoFlash: !settings.autoFlash }),
                  'الفلاش التلقائي'
                )}
              </div>

              {/* الالتقاط المستمر */}
              <div className="p-4 flex items-center justify-between gap-4 min-h-[64px]">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-900 dark:text-white">
                    الالتقاط المستمر
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    حفظ فوري دون معاينة
                  </div>
                </div>
                {renderToggle(
                  settings.continuousMode,
                  () =>
                    onUpdateSettings({
                      continuousMode: !settings.continuousMode,
                    }),
                  'الالتقاط المستمر'
                )}
              </div>

              {/* إيقاف الكاميرا عند الخمول */}
              <div
                className="p-4 space-y-2.5"
                data-testid="settings-camera-idle-timeout"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-bold text-slate-900 dark:text-white">
                    إيقاف الكاميرا عند الخمول
                  </div>
                  {isBatterySaverOn && (
                    <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400">
                      مؤقتاً 30 ثانية (توفير البطارية)
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {(
                    [
                      { value: 30, label: '30 ثانية' },
                      { value: 60, label: '60 ثانية' },
                      { value: 120, label: '2 دقيقة' },
                      { value: 0, label: 'أبداً' },
                    ] as const satisfies ReadonlyArray<{
                      value: CameraIdleTimeoutSec;
                      label: string;
                    }>
                  ).map((opt) => {
                    const active = configuredIdleTimeoutSec === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        data-testid={`idle-timeout-${opt.value}`}
                        aria-pressed={active}
                        onClick={() =>
                          onUpdateSettings({ cameraIdleTimeoutSec: opt.value })
                        }
                        className={`min-h-[42px] px-1.5 rounded-xl text-xs font-extrabold transition ${
                          active
                            ? 'bg-emerald-500 text-white shadow-sm'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* معدل إطارات المعاينة */}
              <div
                className="p-4 space-y-2.5"
                data-testid="settings-preview-framerate"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-bold text-slate-900 dark:text-white">
                    معدل إطارات المعاينة
                  </div>
                  {isBatterySaverOn && (
                    <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400">
                      مقيد إلى 15 مؤقتاً
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { value: 30, label: '30' },
                      { value: 24, label: '24' },
                      { value: 15, label: '15 توفير' },
                    ] as const satisfies ReadonlyArray<{
                      value: PreviewFrameRateSetting;
                      label: string;
                    }>
                  ).map((opt) => {
                    const active = configuredFrameRate === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        data-testid={`preview-fps-${opt.value}`}
                        aria-pressed={active}
                        onClick={() =>
                          onUpdateSettings({ previewFrameRate: opt.value })
                        }
                        className={`min-h-[42px] px-3 rounded-xl text-xs font-extrabold transition ${
                          active
                            ? 'bg-emerald-500 text-white shadow-sm'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* توفير البطارية */}
              <div
                className="p-4 space-y-2.5"
                data-testid="settings-battery-saver"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-bold text-slate-900 dark:text-white">
                    توفير البطارية
                  </div>
                  {isBatterySaverOn && (
                    <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 text-[11px] font-extrabold">
                      مُفعّل الآن
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { value: 'off', label: 'إيقاف' },
                      { value: 'auto', label: 'تلقائي' },
                      { value: 'always', label: 'دائماً' },
                    ] as const satisfies ReadonlyArray<{
                      value: BatterySaverMode;
                      label: string;
                    }>
                  ).map((opt) => {
                    const active = configuredBatterySaverMode === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        data-testid={`battery-saver-${opt.value}`}
                        aria-pressed={active}
                        onClick={() =>
                          onUpdateSettings({ batterySaverMode: opt.value })
                        }
                        className={`min-h-[42px] px-3 rounded-xl text-xs font-extrabold transition ${
                          active
                            ? 'bg-emerald-500 text-white shadow-sm'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
                {configuredBatterySaverMode === 'auto' &&
                !batterySaverState?.batterySupported ? (
                  <p
                    data-testid="battery-saver-unsupported-note"
                    className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed"
                  >
                    حالة البطارية غير مدعومة في هذا المتصفح؛ يعمل تلقائي كإيقاف.
                  </p>
                ) : (
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    يقلل معدل الإطارات إلى 15، يوقف الكاميرا بعد 30 ثانية، ويؤجل التحسينات الثقيلة دون إيقاف الموسيقى.
                  </p>
                )}
              </div>

              {/* تحسين الصور */}
              <div
                className="p-4 space-y-3.5"
                data-testid="settings-photo-enhancement"
              >
                <div className="text-sm font-extrabold text-slate-900 dark:text-white">
                  تحسين الصور
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-bold text-slate-600 dark:text-slate-300">
                    تحسين الصور تلقائياً
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {(
                      [
                        { value: 'off', label: 'إيقاف' },
                        { value: 'light', label: 'خفيف' },
                        { value: 'medium', label: 'متوسط' },
                        { value: 'strong', label: 'قوي' },
                      ] as const satisfies ReadonlyArray<{
                        value: PhotoEnhanceLevel;
                        label: string;
                      }>
                    ).map((opt) => {
                      const active =
                        (settings.photoEnhanceLevel ?? 'medium') === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          data-testid={`enhance-level-${opt.value}`}
                          aria-pressed={active}
                          onClick={() =>
                            onUpdateSettings({ photoEnhanceLevel: opt.value })
                          }
                          className={`min-h-[42px] px-2 rounded-xl text-xs font-extrabold transition ${
                            active
                              ? 'bg-emerald-500 text-white shadow-sm'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-4 min-h-[48px] pt-1">
                  <div className="text-sm font-bold text-slate-900 dark:text-white">
                    تحسين صور المعرض المستوردة
                  </div>
                  {renderToggle(
                    settings.enhanceGalleryImports === true,
                    () =>
                      onUpdateSettings({
                        enhanceGalleryImports: !settings.enhanceGalleryImports,
                      }),
                    'تحسين صور المعرض المستوردة'
                  )}
                </div>

                <div className="flex items-center justify-between gap-4 min-h-[52px]">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-slate-900 dark:text-white">
                      حفظ الصورة الأصلية أيضاً
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      يستخدم مساحة تخزين أكبر ويتبع التنظيف التلقائي للصور
                    </div>
                  </div>
                  {renderToggle(
                    settings.keepOriginalPhoto === true,
                    () =>
                      onUpdateSettings({
                        keepOriginalPhoto: !settings.keepOriginalPhoto,
                      }),
                    'حفظ الصورة الأصلية أيضاً'
                  )}
                </div>
              </div>

              {/* متقدم (مطوي افتراضياً) */}
              <div data-testid="settings-camera-advanced">
                <button
                  type="button"
                  aria-expanded={cameraAdvancedOpen}
                  data-testid="settings-camera-advanced-toggle"
                  onClick={() => setCameraAdvancedOpen((v) => !v)}
                  className="w-full min-h-[52px] px-4 py-3 flex items-center justify-between gap-3 text-right hover:bg-slate-50 dark:hover:bg-slate-800/40 transition"
                >
                  <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
                    متقدم
                  </span>
                  <ChevronDown
                    className={`w-4 h-4 text-slate-400 transition-transform ${
                      cameraAdvancedOpen ? 'rotate-180 text-emerald-500' : ''
                    }`}
                  />
                </button>

                {cameraAdvancedOpen && (
                  <div className="bg-slate-50/70 dark:bg-slate-950/40 divide-y divide-slate-200/60 dark:divide-slate-800 border-t border-slate-100 dark:border-slate-800">
                    {/* اختيار العدسة */}
                    <div className="p-4 space-y-2">
                      <label
                        htmlFor="settings-camera-selector"
                        className="text-sm font-bold text-slate-900 dark:text-white block"
                      >
                        الكاميرا
                      </label>
                      <select
                        id="settings-camera-selector"
                        aria-label="الكاميرا"
                        value={settings.selectedCameraDeviceId || ''}
                        onChange={(e) => {
                          const nextId = e.target.value.trim();
                          const updatedDiag = {
                            ...readCameraDiagnostics(),
                            selectedCameraDeviceId: nextId || null,
                          };
                          try {
                            window.localStorage.setItem(
                              'naqs_camera_diagnostics_v1',
                              JSON.stringify({
                                ...updatedDiag,
                                updatedAt: Date.now(),
                              })
                            );
                          } catch {
                            // Ignore storage errors
                          }
                          setCameraDiagnostics(updatedDiag);
                          onUpdateSettings({
                            selectedCameraDeviceId: nextId || undefined,
                          });
                        }}
                        className="w-full min-h-[44px] px-3 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      >
                        <option value="">
                          تلقائي (اختيار عدسة الفلاش تلقائياً)
                        </option>
                        {(cameraDiagnostics.candidates || []).map((cand) => {
                          const labelText =
                            cand.label?.trim() || `كاميرا #${cand.index + 1}`;
                          const torchTag = cand.probed
                            ? cand.torchSupported
                              ? 'يدعم الفلاش'
                              : 'بدون فلاش'
                            : 'غير مفحوص';
                          const inUseTag =
                            cameraDiagnostics.activeCameraDeviceId ===
                            cand.deviceId
                              ? ' · المستخدمة'
                              : '';
                          return (
                            <option key={cand.deviceId} value={cand.deviceId}>
                              {`${labelText} (${torchTag}${inUseTag})`}
                            </option>
                          );
                        })}
                        {settings.selectedCameraDeviceId &&
                          !(cameraDiagnostics.candidates || []).some(
                            (c) =>
                              c.deviceId === settings.selectedCameraDeviceId
                          ) && (
                            <option value={settings.selectedCameraDeviceId}>
                              {cameraDiagnostics.activeCameraLabel ||
                                `كاميرا محددة (${settings.selectedCameraDeviceId.slice(
                                  0,
                                  8
                                )}…)`}
                            </option>
                          )}
                      </select>
                    </div>

                    {/* أدوات التقريب */}
                    <div className="p-4 flex items-center justify-between gap-4 min-h-[58px]">
                      <div className="text-sm font-bold text-slate-900 dark:text-white">
                        أدوات التقريب
                      </div>
                      {renderToggle(
                        settings.zoomControls,
                        () =>
                          onUpdateSettings({
                            zoomControls: !settings.zoomControls,
                          }),
                        'أدوات التقريب'
                      )}
                    </div>

                    {/* صوت الالتقاط */}
                    <div className="p-4 flex items-center justify-between gap-4 min-h-[58px]">
                      <div className="text-sm font-bold text-slate-900 dark:text-white">
                        صوت الالتقاط
                      </div>
                      {renderToggle(
                        settings.shutterSound,
                        () =>
                          onUpdateSettings({
                            shutterSound: !settings.shutterSound,
                          }),
                        'صوت الالتقاط'
                      )}
                    </div>

                    {/* نقل شريط الكاميرا إلى اليسار */}
                    <div className="p-4 flex items-center justify-between gap-4 min-h-[60px]">
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-slate-900 dark:text-white">
                          نقل شريط الكاميرا إلى اليسار
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          الافتراضي على اليمين
                        </div>
                      </div>
                      {renderToggle(
                        settings.cameraToolbarSide === 'left',
                        () =>
                          onUpdateSettings({
                            cameraToolbarSide:
                              settings.cameraToolbarSide === 'left'
                                ? 'right'
                                : 'left',
                          }),
                        'نقل شريط الكاميرا إلى اليسار'
                      )}
                    </div>

                    {/* معلومات الكاميرا واختبار الأداء */}
                    <div
                      data-testid="settings-camera-diagnostics"
                      className="p-4 space-y-3"
                    >
                      {/* Hidden live camera probe video element for real FPS measurement while Advanced is open */}
                      <video
                        ref={probeVideoRef}
                        playsInline
                        muted
                        autoPlay
                        aria-hidden="true"
                        className="sr-only pointer-events-none"
                      />

                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-extrabold text-slate-700 dark:text-slate-200">
                          معلومات الكاميرا
                        </div>
                        <button
                          type="button"
                          onClick={handleCopyCameraDiagnostics}
                          className={`min-h-[34px] px-3 rounded-xl text-xs font-extrabold flex items-center gap-1.5 transition active:scale-95 ${
                            copiedCameraInfo
                              ? 'bg-emerald-500 text-white'
                              : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                          }`}
                        >
                          {copiedCameraInfo ? (
                            <Check className="w-3.5 h-3.5" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                          <span>{copiedCameraInfo ? 'تم النسخ' : 'نسخ'}</span>
                        </button>
                      </div>

                      {/* Always-visible Live FPS + 10s Performance Test button */}
                      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800 p-3 space-y-2.5">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
                            معدل الإطارات المباشر (FPS)
                          </span>
                          <span
                            ref={liveFpsDomRef}
                            data-testid="camera-advanced-live-fps"
                            dir="auto"
                            className="text-xs font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums"
                          >
                            {probeCameraStatus === 'error'
                              ? 'غير متاح'
                              : 'جاري القياس…'}
                          </span>
                        </div>

                        <button
                          type="button"
                          data-testid="camera-perf-test-btn"
                          onClick={handleRunPerfTest}
                          disabled={perfTestRunning}
                          className={`w-full min-h-[44px] px-4 rounded-xl text-xs font-extrabold flex items-center justify-center gap-2 transition ${
                            perfTestRunning
                              ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-400/40'
                              : 'bg-emerald-500 text-white active:scale-[0.99]'
                          }`}
                        >
                          <Stethoscope className="w-4 h-4 shrink-0" />
                          <span>
                            {perfTestRunning
                              ? `جاري اختبار الأداء… (${perfTestRemainingSec} ث)`
                              : 'اختبار الأداء 10 ثوانٍ'}
                          </span>
                        </button>

                        {perfReport && (
                          <div
                            data-testid="camera-perf-report"
                            className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2 select-text"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-extrabold text-slate-800 dark:text-slate-100">
                                تقرير الأداء
                              </span>
                              <button
                                type="button"
                                data-testid="camera-perf-copy-btn"
                                onClick={handleCopyPerfReport}
                                className={`min-h-[32px] px-2.5 rounded-lg text-[11px] font-extrabold flex items-center gap-1 transition active:scale-95 ${
                                  copiedPerfReport
                                    ? 'bg-emerald-500 text-white'
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                                }`}
                              >
                                {copiedPerfReport ? (
                                  <Check className="w-3 h-3" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                                <span>
                                  {copiedPerfReport ? 'تم النسخ' : 'نسخ'}
                                </span>
                              </button>
                            </div>
                            <div className="space-y-1.5">
                              {formatPerfReportRows(perfReport).map((row) => (
                                <div
                                  key={row.label}
                                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[11px] leading-relaxed"
                                >
                                  <span className="font-bold text-slate-500 dark:text-slate-400 shrink-0">
                                    {row.label}:
                                  </span>
                                  <span
                                    className="font-extrabold text-slate-800 dark:text-slate-100 min-w-0 max-w-full break-words [overflow-wrap:anywhere]"
                                    dir="auto"
                                  >
                                    {row.value}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800 p-3 space-y-2 select-text">
                        {buildCameraDiagnosticsRows(
                          cameraDiagnostics,
                          fallbackLastPhotoDims,
                          settings.captureMode
                        ).map((row) => (
                          <div
                            key={row.label}
                            className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[11px] leading-relaxed"
                          >
                            <span className="font-bold text-slate-500 dark:text-slate-400 shrink-0">
                              {row.label}:
                            </span>
                            <span
                              className="font-extrabold text-slate-800 dark:text-slate-100 min-w-0 max-w-full break-words [overflow-wrap:anywhere]"
                              dir="auto"
                            >
                              {row.value}
                            </span>
                          </div>
                        ))}
                      </div>

                      {/* قياس البطارية والجلسة */}
                      <div
                        data-testid="camera-battery-measurement"
                        className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800 p-3 space-y-2 select-text"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-extrabold text-slate-800 dark:text-slate-100">
                            قياس البطارية والجلسة
                          </span>
                          <button
                            type="button"
                            data-testid="camera-battery-copy-btn"
                            onClick={handleCopyBatteryMeasurement}
                            className={`min-h-[32px] px-2.5 rounded-lg text-[11px] font-extrabold flex items-center gap-1 transition active:scale-95 ${
                              copiedBatteryReport
                                ? 'bg-emerald-500 text-white'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                            }`}
                          >
                            {copiedBatteryReport ? (
                              <Check className="w-3 h-3" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                            <span>{copiedBatteryReport ? 'تم النسخ' : 'نسخ'}</span>
                          </button>
                        </div>

                        <div className="space-y-1.5">
                          {buildBatteryMeasurementRows(sessionPowerTelemetry).map(
                            (row) => (
                              <div
                                key={row.label}
                                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[11px] leading-relaxed"
                              >
                                <span className="font-bold text-slate-500 dark:text-slate-400 shrink-0">
                                  {row.label}:
                                </span>
                                <span
                                  className="font-extrabold text-slate-800 dark:text-slate-100 min-w-0 max-w-full break-words [overflow-wrap:anywhere]"
                                  dir="auto"
                                >
                                  {row.value}
                                </span>
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        {/* 2) الصور (مطوي افتراضياً) */}
        <section
          data-testid="settings-section-photos"
          className="bg-white dark:bg-slate-900 rounded-[20px] border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden"
        >
          {renderCardHeader('photos', 'الصور', <ImageIcon className="w-5 h-5" />)}

          {openSections.photos && (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 border-t border-slate-100 dark:border-slate-800">
              <div className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-4 min-h-[52px]">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                      <CalendarClock className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-slate-900 dark:text-white">
                        حذف الصور القديمة تلقائياً
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        للصور المكتملة فقط
                      </div>
                    </div>
                  </div>
                  {renderToggle(
                    settings.autoDeletePhotos,
                    () =>
                      onUpdateSettings({
                        autoDeletePhotos: !settings.autoDeletePhotos,
                      }),
                    'حذف الصور القديمة تلقائياً'
                  )}
                </div>

                {settings.autoDeletePhotos && (
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    {KEEP_OPTIONS.map((opt) => {
                      const active = settings.keepPhotosDays === opt.days;
                      return (
                        <button
                          key={opt.days}
                          type="button"
                          onClick={() =>
                            onUpdateSettings({ keepPhotosDays: opt.days })
                          }
                          className={`min-h-[46px] rounded-2xl text-xs font-extrabold transition ${
                            active
                              ? 'bg-emerald-500 text-white shadow-sm'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="p-4 flex items-center justify-between gap-3 min-h-[68px]">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-900 dark:text-white">
                    مساحة الصور
                  </div>
                  <div
                    data-testid="settings-photos-size"
                    className="text-xs font-bold text-slate-500 dark:text-slate-400 tabular-nums"
                  >
                    {formatBytesArabic(storageBreakdown.photosBytes)}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  data-testid="settings-clear-photos-btn"
                  onClick={handleCleanupNow}
                  className="min-h-[46px] px-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 font-bold text-xs flex items-center gap-2 border border-emerald-200 dark:border-emerald-800 shrink-0 active:scale-95 transition disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>مسح الصور المكتملة</span>
                </button>
              </div>
            </div>
          )}
        </section>

        {/* 3) الملاحظات (مطوي افتراضياً — صف واحد يفتح نفس نافذة إعدادات الملاحظات) */}
        <section
          data-testid="settings-section-notes"
          className="bg-white dark:bg-slate-900 rounded-[20px] border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden"
        >
          {renderCardHeader('notes', 'الملاحظات', <FileText className="w-5 h-5" />)}

          {openSections.notes && (
            <div className="border-t border-slate-100 dark:border-slate-800 p-3">
              <button
                type="button"
                data-testid="settings-open-notes-settings"
                onClick={() => setShowNoteSettingsSheet(true)}
                className="w-full min-h-[54px] px-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-900 dark:text-white font-bold text-sm flex items-center justify-between gap-3 active:scale-[0.99] transition"
              >
                <span className="flex items-center gap-2.5">
                  <SlidersHorizontal className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span>إعدادات الملاحظات</span>
                </span>
                <ChevronLeft className="w-4 h-4 text-slate-400 shrink-0" />
              </button>
            </div>
          )}
        </section>

        {/* 4) الموسيقى (مطوي افتراضياً) */}
        <section
          data-testid="settings-section-music"
          className="bg-white dark:bg-slate-900 rounded-[20px] border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden"
        >
          {renderCardHeader('music', 'الموسيقى', <Music className="w-5 h-5" />)}

          {openSections.music && (
            <div
              data-testid="settings-music-card"
              className="divide-y divide-slate-100 dark:divide-slate-800 border-t border-slate-100 dark:border-slate-800"
            >
              {/* مفتاح الوحدة */}
              <div className="p-4 flex items-center justify-between gap-4 min-h-[64px]">
                <div className="text-sm font-bold text-slate-900 dark:text-white">
                  تشغيل المشغّل الصوتي
                </div>
                {renderToggle(
                  Boolean(settings.musicPlayerEnabled),
                  () =>
                    onUpdateSettings({
                      musicPlayerEnabled: !settings.musicPlayerEnabled,
                    }),
                  'تشغيل المشغّل الصوتي'
                )}
              </div>

              {settings.musicPlayerEnabled && (
                <>
                  {/* المساحة وحالة التخزين الدائم */}
                  <div className="p-4 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span
                        data-testid="settings-music-persistence-status"
                        className={`font-extrabold ${
                          musicStorageStats?.persisted
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {musicStorageStats?.persisted
                          ? 'التخزين الدائم: مفعّل'
                          : 'التخزين الدائم: غير مفعّل'}
                      </span>
                      <span
                        data-testid="settings-music-storage-used"
                        className="font-bold text-slate-500 dark:text-slate-400 tabular-nums"
                      >
                        المساحة: {formatBytesArabic(audioDisplayBytes)}
                      </span>
                    </div>

                    {musicStorageStats?.isStorageLow &&
                      (musicStorageStats.trackCount || 0) > 0 && (
                        <div className="rounded-xl bg-amber-50 dark:bg-amber-950/35 border border-amber-200 dark:border-amber-800 p-3 text-xs font-bold text-amber-800 dark:text-amber-200 flex items-start gap-2">
                          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
                          <span>
                            مساحة المتصفح منخفضة ({formatBytesArabic(audioDisplayBytes)}). احذف المقاطع غير المرغوبة يدوياً.
                          </span>
                        </div>
                      )}
                  </div>

                  {/* المؤثرات البصرية */}
                  <div className="p-4 flex items-center justify-between gap-4 min-h-[60px]">
                    <div className="text-sm font-bold text-slate-900 dark:text-white">
                      المؤثرات البصرية
                    </div>
                    {renderToggle(
                      settings.musicVisualEffects !== false,
                      () =>
                        onUpdateSettings({
                          musicVisualEffects: !(
                            settings.musicVisualEffects !== false
                          ),
                        }),
                      'المؤثرات البصرية'
                    )}
                  </div>

                  {/* لون الزر */}
                  <div className="p-4 space-y-2.5">
                    <div className="text-sm font-bold text-slate-900 dark:text-white">
                      لون الزر
                    </div>
                    <div
                      data-testid="music-fab-color-picker"
                      className="grid grid-cols-2 sm:grid-cols-3 gap-2"
                    >
                      {MUSIC_FAB_COLOR_PRESETS.map((preset) => {
                        const selected =
                          (settings.musicFabColor || 'violet-pink') === preset.id;
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() =>
                              onUpdateSettings({ musicFabColor: preset.id })
                            }
                            aria-label={`لون الزر: ${preset.label}`}
                            aria-pressed={selected}
                            className={`min-h-[44px] px-2.5 rounded-xl border text-[11px] font-extrabold flex items-center gap-2 transition ${
                              selected
                                ? 'border-slate-900 dark:border-white bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'
                            }`}
                          >
                            <span
                              className={`w-4 h-4 rounded-full shrink-0 ${preset.gradientClass}`}
                            />
                            <span className="truncate">{preset.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* إعادة ضبط الصوت */}
                  {onResetMusicVolume && (
                    <div className="p-4 flex items-center justify-between gap-3 min-h-[64px]">
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-slate-900 dark:text-white">
                          مستوى الصوت
                        </div>
                        <div className="text-xs font-bold text-slate-500 dark:text-slate-400 tabular-nums">
                          {musicMuted || volumePercent <= 0
                            ? 'مكتوم'
                            : `${volumePercent}%`}
                        </div>
                      </div>
                      <button
                        type="button"
                        data-testid="settings-music-reset-volume"
                        onClick={onResetMusicVolume}
                        className="min-h-[42px] px-3.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-white text-xs font-extrabold flex items-center gap-1.5 active:scale-95 transition shrink-0"
                      >
                        <RotateCcw className="w-3.5 h-3.5 text-emerald-500" />
                        <span>إعادة ضبط الصوت</span>
                      </button>
                    </div>
                  )}

                  {/* إضافة ملفات / فتح المشغّل */}
                  <div className="p-4 space-y-2.5">
                    {onAddMusicFiles && (
                      <MusicAudioImporterTrigger
                        variant="settings-button"
                        buttonText="إضافة ملفات صوتية"
                        disabled={Boolean(musicImportProgress)}
                        onSelectFiles={onAddMusicFiles}
                        showSavedNote={false}
                      />
                    )}

                    <MusicImportStatusPanel
                      progress={musicImportProgress}
                      report={musicImportReport}
                      onCancelImport={onCancelMusicImport || (() => {})}
                      onDismissReport={onDismissMusicImportReport || (() => {})}
                    />

                    {onOpenMusicPlayer && (
                      <button
                        type="button"
                        onClick={onOpenMusicPlayer}
                        className="w-full min-h-[46px] px-4 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-white font-extrabold text-sm flex items-center justify-center gap-2 active:scale-95 transition"
                      >
                        <Music className="w-4 h-4 text-emerald-500" />
                        <span>فتح المشغّل</span>
                      </button>
                    )}
                  </div>

                  {/* متقدم — الموسيقى (تشخيص التشغيل + الإعدادات النادرة) */}
                  <div data-testid="settings-music-advanced">
                    <button
                      type="button"
                      aria-expanded={musicAdvancedOpen}
                      data-testid="settings-music-advanced-toggle"
                      onClick={() => setMusicAdvancedOpen((v) => !v)}
                      className="w-full min-h-[52px] px-4 py-3 flex items-center justify-between gap-3 text-right hover:bg-slate-50 dark:hover:bg-slate-800/40 transition"
                    >
                      <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
                        متقدم
                      </span>
                      <ChevronDown
                        className={`w-4 h-4 text-slate-400 transition-transform ${
                          musicAdvancedOpen ? 'rotate-180 text-emerald-500' : ''
                        }`}
                      />
                    </button>

                    {musicAdvancedOpen && (
                      <div className="bg-slate-50/70 dark:bg-slate-950/40 divide-y divide-slate-200/60 dark:divide-slate-800 border-t border-slate-100 dark:border-slate-800">
                        {/* تشخيص التشغيل */}
                        {onGetMusicDiagnostics && (
                          <div className="p-4">
                            <button
                              type="button"
                              data-testid="settings-music-diagnostics-btn"
                              onClick={() => {
                                setMusicDiagnosticsData(onGetMusicDiagnostics());
                                setShowMusicDiagnostics(true);
                              }}
                              className="w-full min-h-[46px] px-4 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-white font-extrabold text-xs flex items-center justify-between gap-2 active:scale-[0.99] transition"
                            >
                              <span className="flex items-center gap-2">
                                <Stethoscope className="w-4 h-4 text-emerald-500" />
                                <span>تشخيص التشغيل</span>
                              </span>
                              <ChevronLeft className="w-4 h-4 text-slate-400" />
                            </button>
                          </div>
                        )}

                        {/* الحد الأقصى للمساحة الصوتية */}
                        <div className="p-4 space-y-2">
                          <div className="text-xs font-bold text-slate-600 dark:text-slate-300">
                            الحد الأقصى للمساحة الصوتية (
                            <span className="tabular-nums">
                              {settings.musicMaxStorageMb ||
                                DEFAULT_MUSIC_MAX_STORAGE_MB}
                            </span>{' '}
                            م.ب)
                          </div>
                          <div className="grid grid-cols-4 gap-2">
                            {MUSIC_MAX_OPTIONS_MB.map((mb) => {
                              const active =
                                (settings.musicMaxStorageMb ||
                                  DEFAULT_MUSIC_MAX_STORAGE_MB) === mb;
                              return (
                                <button
                                  key={mb}
                                  type="button"
                                  onClick={() =>
                                    onUpdateSettings({ musicMaxStorageMb: mb })
                                  }
                                  className={`min-h-[42px] rounded-xl text-xs font-extrabold tabular-nums transition ${
                                    active
                                      ? 'bg-emerald-500 text-white shadow-sm'
                                      : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                                  }`}
                                >
                                  {mb} م.ب
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* إظهار على شاشة التصوير */}
                        <div className="p-4 flex items-center justify-between gap-4 min-h-[58px]">
                          <div className="text-sm font-bold text-slate-900 dark:text-white">
                            إظهار على شاشة التصوير
                          </div>
                          {renderToggle(
                            Boolean(settings.musicShowOnCapture),
                            () =>
                              onUpdateSettings({
                                musicShowOnCapture: !settings.musicShowOnCapture,
                              }),
                            'إظهار على شاشة التصوير'
                          )}
                        </div>

                        {/* تفاعل مع الصوت */}
                        <div className="p-4 space-y-2">
                          <div className="flex items-center justify-between gap-4 min-h-[50px]">
                            <div className="min-w-0">
                              <div className="text-sm font-bold text-slate-900 dark:text-white">
                                تفاعل مع الصوت
                              </div>
                            </div>
                            {renderToggle(
                              Boolean(settings.musicAudioReactive),
                              () =>
                                onUpdateSettings({
                                  musicAudioReactive:
                                    !settings.musicAudioReactive,
                                }),
                              'تفاعل مع الصوت'
                            )}
                          </div>
                          {(settings.musicAudioReactive ||
                            audioReactiveWarning) && (
                            <div
                              data-testid="music-audio-reactive-warning"
                              className="rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs font-bold text-amber-800 dark:text-amber-200 flex items-center gap-2"
                            >
                              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500" />
                              <span>
                                قد يوقف الصوت عند إطفاء الشاشة في بعض الهواتف
                              </span>
                            </div>
                          )}
                        </div>

                        {/* حذف المكتبة الصوتية */}
                        <div className="p-4">
                          {!confirmClearMusic ? (
                            <button
                              type="button"
                              onClick={() => setConfirmClearMusic(true)}
                              className="w-full min-h-[44px] px-4 rounded-2xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 font-bold text-xs flex items-center justify-center gap-2 active:scale-95 transition"
                            >
                              <Trash2 className="w-4 h-4" />
                              <span>حذف المكتبة الصوتية</span>
                            </button>
                          ) : (
                            <div className="space-y-2">
                              <div className="text-xs font-extrabold text-red-600 dark:text-red-400">
                                حذف جميع الملفات الصوتية نهائياً؟
                              </div>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => setConfirmClearMusic(false)}
                                  className="min-h-[42px] flex-1 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs"
                                >
                                  إلغاء
                                </button>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={handleClearMusicLibrary}
                                  className="min-h-[42px] flex-1 rounded-xl bg-red-600 text-white font-bold text-xs disabled:opacity-60"
                                >
                                  نعم، حذف المكتبة
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

              {!settings.musicPlayerEnabled &&
                (musicStorageStats?.trackCount || 0) > 0 && (
                  <div className="p-4 space-y-2.5">
                    <div className="text-xs font-bold text-slate-500 dark:text-slate-400 tabular-nums">
                      مكتبة محفوظة ({musicStorageStats?.trackCount} مقطع •{' '}
                      {formatBytesArabic(audioDisplayBytes)})
                    </div>
                    {!confirmClearMusic ? (
                      <button
                        type="button"
                        onClick={() => setConfirmClearMusic(true)}
                        className="w-full min-h-[44px] px-4 rounded-2xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 font-bold text-xs flex items-center justify-center gap-2 active:scale-95 transition"
                      >
                        <Trash2 className="w-4 h-4" />
                        <span>حذف المكتبة الصوتية</span>
                      </button>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setConfirmClearMusic(false)}
                          className="min-h-[42px] flex-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold text-xs"
                        >
                          إلغاء
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={handleClearMusicLibrary}
                          className="min-h-[42px] flex-1 rounded-xl bg-red-600 text-white font-bold text-xs disabled:opacity-60"
                        >
                          نعم، حذف المكتبة
                        </button>
                      </div>
                    )}
                  </div>
                )}
            </div>
          )}
        </section>

        {/* 5) البيانات (مطوي افتراضياً) */}
        <section
          data-testid="settings-section-data"
          className="bg-white dark:bg-slate-900 rounded-[20px] border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden"
        >
          {renderCardHeader('data', 'البيانات', <Database className="w-5 h-5" />)}

          {openSections.data && (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 border-t border-slate-100 dark:border-slate-800">
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                onChange={handleImportFile}
                className="hidden"
              />

              {/* ملخص التخزين: الصور، الملاحظات، الصوتيات */}
              <div
                data-testid="settings-storage-summary"
                className="p-4 space-y-2.5"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-extrabold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                    <HardDrive className="w-4 h-4 text-emerald-500" />
                    <span>ملخص التخزين</span>
                  </span>
                  <span className="font-extrabold text-slate-500 dark:text-slate-400 tabular-nums">
                    الإجمالي:{' '}
                    {formatBytesArabic(
                      storageBreakdown.photosBytes +
                        storageBreakdown.notesBytes +
                        audioDisplayBytes
                    )}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200/70 dark:border-slate-700/60 p-2.5 text-center">
                    <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                      الصور
                    </div>
                    <div
                      data-testid="storage-summary-photos"
                      className="text-xs font-extrabold text-slate-900 dark:text-white mt-0.5 tabular-nums"
                    >
                      {formatBytesArabic(storageBreakdown.photosBytes)}
                    </div>
                  </div>
                  <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200/70 dark:border-slate-700/60 p-2.5 text-center">
                    <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                      الملاحظات
                    </div>
                    <div
                      data-testid="storage-summary-notes"
                      className="text-xs font-extrabold text-slate-900 dark:text-white mt-0.5 tabular-nums"
                    >
                      {formatBytesArabic(storageBreakdown.notesBytes)}
                    </div>
                  </div>
                  <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200/70 dark:border-slate-700/60 p-2.5 text-center">
                    <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                      الصوتيات
                    </div>
                    <div
                      data-testid="storage-summary-audio"
                      className="text-xs font-extrabold text-slate-900 dark:text-white mt-0.5 tabular-nums"
                    >
                      {formatBytesArabic(audioDisplayBytes)}
                    </div>
                  </div>
                </div>
              </div>

              {/* تصدير نسخة احتياطية */}
              <button
                type="button"
                disabled={busy}
                onClick={handleExport}
                className="w-full min-h-[60px] p-4 flex items-center gap-3 text-right hover:bg-slate-50 dark:hover:bg-slate-800/50 transition disabled:opacity-50"
              >
                <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                  <Download className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-slate-900 dark:text-white">
                    تصدير نسخة احتياطية
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    ملف JSON (بدون ملفات الصوت)
                  </div>
                </div>
              </button>

              {/* استيراد نسخة احتياطية */}
              <button
                type="button"
                disabled={busy}
                onClick={() => fileInputRef.current?.click()}
                className="w-full min-h-[60px] p-4 flex items-center gap-3 text-right hover:bg-slate-50 dark:hover:bg-slate-800/50 transition disabled:opacity-50"
              >
                <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                  <Upload className="w-5 h-5" />
                </div>
                <div className="text-sm font-bold text-slate-900 dark:text-white">
                  استيراد نسخة احتياطية
                </div>
              </button>

              {/* تثبيت التطبيق */}
              <div
                data-testid="settings-pwa-install-card"
                className="p-4 space-y-2.5"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                      <Smartphone className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-slate-900 dark:text-white">
                        تثبيت التطبيق
                      </div>
                      {isInstalled ? (
                        <div
                          data-testid="pwa-installed-status"
                          className="text-xs font-extrabold text-emerald-600 dark:text-emerald-400 mt-0.5"
                        >
                          مثبّت
                        </div>
                      ) : (
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {isInstallable
                            ? 'جاهز للتثبيت كتطبيق مستقل'
                            : 'متاح عبر المتصفح عند دعم التثبيت'}
                        </div>
                      )}
                    </div>
                  </div>

                  {!isInstalled && isInstallable && (
                    <button
                      type="button"
                      data-testid="pwa-install-button"
                      onClick={() => void install()}
                      className="min-h-[44px] px-4 rounded-2xl bg-emerald-500 text-white text-xs font-extrabold inline-flex items-center gap-1.5 shadow-sm active:scale-95 transition shrink-0"
                    >
                      <Download className="w-4 h-4" />
                      <span>تثبيت التطبيق</span>
                    </button>
                  )}
                </div>

                {runningInIframe && !isInstalled && (
                  <div
                    data-testid="pwa-iframe-warning"
                    className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/60 px-3 py-2 text-[11px] font-bold text-amber-800 dark:text-amber-200 leading-relaxed"
                  >
                    {IFRAME_INSTALL_WARNING_TEXT}
                  </div>
                )}
              </div>

              {/* متقدم (البيانات) */}
              <div data-testid="settings-data-advanced">
                <button
                  type="button"
                  aria-expanded={dataAdvancedOpen}
                  data-testid="settings-data-advanced-toggle"
                  onClick={() => setDataAdvancedOpen((prev) => !prev)}
                  className="w-full min-h-[54px] px-4 py-3 flex items-center justify-between gap-3 text-right hover:bg-slate-50 dark:hover:bg-slate-800/50 transition"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <SlidersHorizontal className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" />
                    <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
                      متقدم
                    </span>
                  </div>
                  <ChevronDown
                    className={`w-4 h-4 text-slate-400 transition-transform duration-200 shrink-0 ${
                      dataAdvancedOpen ? 'rotate-180 text-emerald-500' : ''
                    }`}
                  />
                </button>

                {dataAdvancedOpen && (
                  <div className="px-4 pb-4 pt-1 bg-slate-50/70 dark:bg-slate-950/40">
                    <div
                      data-testid="pwa-install-diagnostics"
                      className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 overflow-hidden"
                    >
                      <button
                        type="button"
                        aria-expanded={pwaDiagnosticsOpen}
                        data-testid="pwa-install-diagnostics-toggle"
                        onClick={() => setPwaDiagnosticsOpen((prev) => !prev)}
                        className="w-full min-h-[48px] px-3.5 py-2.5 flex items-center justify-between gap-2 text-right hover:bg-slate-50 dark:hover:bg-slate-800/40 transition"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Stethoscope className="w-4 h-4 text-emerald-500 shrink-0" />
                          <span className="text-xs font-extrabold text-slate-800 dark:text-slate-100">
                            حالة التثبيت
                          </span>
                        </div>
                        <ChevronDown
                          className={`w-4 h-4 text-slate-400 transition-transform duration-200 shrink-0 ${
                            pwaDiagnosticsOpen
                              ? 'rotate-180 text-emerald-500'
                              : ''
                          }`}
                        />
                      </button>

                      {pwaDiagnosticsOpen && (
                        <div className="px-3.5 pb-3.5 pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                              {pwaDiagnosticsLoading
                                ? 'جارٍ الفحص...'
                                : 'نتائج الفحص'}
                            </span>
                            <button
                              type="button"
                              data-testid="pwa-diagnostics-copy-btn"
                              disabled={!pwaDiagnostics}
                              onClick={handleCopyPwaDiagnostics}
                              className="min-h-[34px] px-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold text-[11px] inline-flex items-center gap-1.5 active:scale-95 transition disabled:opacity-50"
                            >
                              {copiedPwaDiagnostics ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                                  <span>تم النسخ</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5" />
                                  <span>نسخ</span>
                                </>
                              )}
                            </button>
                          </div>

                          {pwaDiagnostics && (
                            <>
                              <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200/70 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 px-3">
                                {buildPwaDiagnosticsRows(pwaDiagnostics).map(
                                  (row) => (
                                    <div
                                      key={row.key}
                                      data-testid={`pwa-diag-row-${row.key}`}
                                      className="py-2 flex items-center justify-between gap-3 text-xs"
                                    >
                                      <span className="font-bold text-slate-600 dark:text-slate-300">
                                        {row.label}
                                      </span>
                                      <span
                                        className={`font-extrabold text-left ${
                                          row.ok
                                            ? 'text-emerald-600 dark:text-emerald-400'
                                            : 'text-amber-600 dark:text-amber-400'
                                        }`}
                                      >
                                        {row.value}
                                      </span>
                                    </div>
                                  )
                                )}
                              </div>

                              {pwaDiagnostics.isInIframe && (
                                <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/60 px-3 py-2 text-[11px] font-bold text-amber-800 dark:text-amber-200 leading-relaxed">
                                  {IFRAME_INSTALL_WARNING_TEXT}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* مسح كل البيانات */}
              <div>
                {!confirmClear ? (
                  <button
                    type="button"
                    onClick={() => setConfirmClear(true)}
                    className="w-full min-h-[60px] p-4 flex items-center gap-3 text-right hover:bg-red-50/50 dark:hover:bg-red-950/20 transition"
                  >
                    <div className="w-10 h-10 rounded-2xl bg-red-500/10 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
                      <Trash2 className="w-5 h-5" />
                    </div>
                    <div className="text-sm font-bold text-red-600 dark:text-red-400">
                      مسح كل البيانات
                    </div>
                  </button>
                ) : (
                  <div className="p-4 space-y-3">
                    <div className="text-xs font-extrabold text-red-600 dark:text-red-400">
                      هل أنت متأكد؟ سيتم حذف جميع السجلات والملاحظات نهائياً.
                    </div>
                    <div className="flex gap-2.5">
                      <button
                        type="button"
                        onClick={() => setConfirmClear(false)}
                        className="min-h-[46px] flex-1 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold text-xs"
                      >
                        إلغاء
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={handleClearAll}
                        className="min-h-[46px] flex-1 rounded-2xl bg-red-600 text-white font-bold text-xs disabled:opacity-60"
                      >
                        نعم، مسح الكل
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </main>

      {/* Shared Single Note Settings Panel ("إعدادات الملاحظات") */}
      <NoteSettingsSheet
        open={showNoteSettingsSheet}
        onClose={() => setShowNoteSettingsSheet(false)}
        noteCopySortOrder={settings.noteCopySortOrder || 'as-written'}
        noteCopyDigitStyle={settings.noteCopyDigitStyle || 'western'}
        noteCopyIncludeTotalQuantities={Boolean(
          settings.noteCopyIncludeTotalQuantities
        )}
        includeTotalInWhatsApp={Boolean(settings.includeTotalInWhatsApp)}
        defaultNoteQuantities={settings.defaultNoteQuantities !== false}
        defaultNoteNumbering={Boolean(settings.defaultNoteNumbering)}
        autoTakeNoteNumber={Boolean(settings.autoTakeNoteNumber)}
        noteUnitMode={
          settings.noteUnitMode === 'fixed' ? 'fixed' : 'per-product'
        }
        noteDefaultUnit={settings.noteDefaultUnit || 'none'}
        onUpdateNoteSettings={(partial) => {
          onUpdateSettings(partial).catch(() => {});
        }}
      />

      {/* Shared Playback Diagnostics Modal ("تشخيص التشغيل") */}
      {onGetMusicDiagnostics && (
        <MusicDiagnosticsModal
          open={showMusicDiagnostics}
          diagnostics={musicDiagnosticsData}
          onClose={() => setShowMusicDiagnostics(false)}
          onRefresh={() => {
            const next = onGetMusicDiagnostics();
            setMusicDiagnosticsData(next);
            return next;
          }}
        />
      )}
    </div>
  );
};
