import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Calculator,
  Camera,
  Check,
  CheckCircle2,
  Copy,
  Download,
  HardDrive,
  ListOrdered,
  Music,
  Package,
  PanelLeft,
  SlidersHorizontal,
  Trash2,
  Upload,
  Volume2,
  Wifi,
  WifiOff,
  Zap,
  ZoomIn,
  CalendarClock,
} from 'lucide-react';
import { AppSettings } from '../../types';
import {
  MusicAddFilesResult,
  MusicImportProgress,
  MusicImportReport,
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
import {
  cleanupExpiredDonePhotos,
  clearAllData,
  estimateStorageUsageBytes,
  exportBackupJson,
  getAllPhotos,
  importBackupJson,
} from '../db';
import {
  buildCameraDiagnosticsRows,
  CameraDiagnosticsInfo,
  formatCameraDiagnosticsClipboardText,
  readCameraDiagnostics,
} from '../camera/cameraDiagnostics';
import { formatBytesArabic } from '../../utils/arabicText';
import { PWAInstallButton } from '../../components/PWAInstallButton';
import { useOfflineSWStatus } from '../../pwa/registerOfflineSW';

interface SettingsScreenProps {
  settings: AppSettings;
  isOnline?: boolean;
  refreshSignal: number;
  musicStorageStats?: MusicStorageStats;
  musicImportProgress?: MusicImportProgress | null;
  musicImportReport?: MusicImportReport | null;
  audioReactiveWarning?: boolean;
  onAddMusicFiles?: (files: File[]) => Promise<MusicAddFilesResult>;
  onCancelMusicImport?: () => void;
  onDismissMusicImportReport?: () => void;
  onOpenMusicPlayer?: () => void;
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

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  settings,
  isOnline = true,
  refreshSignal,
  musicStorageStats,
  musicImportProgress = null,
  musicImportReport = null,
  audioReactiveWarning = false,
  onAddMusicFiles,
  onCancelMusicImport,
  onDismissMusicImportReport,
  onOpenMusicPlayer,
  onClearMusicLibrary,
  onUpdateSettings,
  onDataChanged,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmClearMusic, setConfirmClearMusic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [storageBytes, setStorageBytes] = useState<number>(0);
  const [cameraDiagnostics, setCameraDiagnostics] =
    useState<CameraDiagnosticsInfo>(() => readCameraDiagnostics());
  const [fallbackLastPhotoDims, setFallbackLastPhotoDims] = useState<{
    width?: number;
    height?: number;
  } | null>(null);
  const [copiedCameraInfo, setCopiedCameraInfo] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const { offlineReady, swSupported } = useOfflineSWStatus();

  const loadMeta = useCallback(async () => {
    try {
      setCameraDiagnostics(readCameraDiagnostics());
      const [bytes, allPhotos] = await Promise.all([
        estimateStorageUsageBytes(),
        getAllPhotos(),
      ]);
      setStorageBytes(bytes);
      const latestPhoto = allPhotos[0];
      if (latestPhoto && latestPhoto.width > 0 && latestPhoto.height > 0) {
        setFallbackLastPhotoDims({
          width: latestPhoto.width,
          height: latestPhoto.height,
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
      fallbackLastPhotoDims
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

  return (
    <div
      className="min-h-[100dvh] pb-28 bg-[#F7F8FA] dark:bg-slate-950"
      dir="rtl"
    >
      <header className="sticky top-0 z-20 bg-[#F7F8FA]/95 dark:bg-slate-950/95 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800 px-4 pt-[calc(1rem+env(safe-area-inset-top,0px))] pb-4">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">
            الإعدادات
          </h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 pt-4 space-y-4">
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

        {/* Group 1: Capture & Notes Preferences */}
        <section className="bg-white dark:bg-slate-900 rounded-[20px] border border-slate-200/80 dark:border-slate-800 shadow-sm divide-y divide-slate-100 dark:divide-slate-800">

          <div className="p-4 flex items-center justify-between gap-4 min-h-[72px]">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <Camera className="w-5 h-5" />
              </div>
              <div>
                <div className="text-base font-bold text-slate-900 dark:text-white">
                  الالتقاط المستمر
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  حفظ الصورة فوراً وبقاء الكاميرا مفتوحة دون معاينة
                </div>
              </div>
            </div>
            {renderToggle(
              settings.continuousMode,
              () => onUpdateSettings({ continuousMode: !settings.continuousMode }),
              'الالتقاط المستمر'
            )}
          </div>

          <div className="p-4 flex items-center justify-between gap-4 min-h-[72px]">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <Zap className="w-5 h-5" />
              </div>
              <div>
                <div className="text-base font-bold text-slate-900 dark:text-white">
                  الفلاش التلقائي
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  تشغيل فلاش الكاميرا تلقائياً في الإضاءة المنخفضة
                </div>
              </div>
            </div>
            {renderToggle(
              settings.autoFlash,
              () => onUpdateSettings({ autoFlash: !settings.autoFlash }),
              'الفلاش التلقائي'
            )}
          </div>

          <div className="p-4 flex items-center justify-between gap-4 min-h-[72px]">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <ZoomIn className="w-5 h-5" />
              </div>
              <div>
                <div className="text-base font-bold text-slate-900 dark:text-white">
                  أدوات التقريب
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  إظهار شريط التقريب والتكبير باللمس على شاشة الكاميرا
                </div>
              </div>
            </div>
            {renderToggle(
              settings.zoomControls,
              () => onUpdateSettings({ zoomControls: !settings.zoomControls }),
              'أدوات التقريب'
            )}
          </div>

          <div className="p-4 flex items-center justify-between gap-4 min-h-[72px]">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <Volume2 className="w-5 h-5" />
              </div>
              <div>
                <div className="text-base font-bold text-slate-900 dark:text-white">
                  صوت الالتقاط
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  تشغيل صوت الغالق عند التقاط كل صورة
                </div>
              </div>
            </div>
            {renderToggle(
              settings.shutterSound,
              () => onUpdateSettings({ shutterSound: !settings.shutterSound }),
              'صوت الالتقاط'
            )}
          </div>

          <div className="p-4 flex items-center justify-between gap-4 min-h-[72px]">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <PanelLeft className="w-5 h-5" />
              </div>
              <div>
                <div className="text-base font-bold text-slate-900 dark:text-white">
                  نقل شريط الكاميرا إلى اليسار
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  الوضع الافتراضي على الحافة اليمنى — فعّله لنقل الأيقونات إلى اليسار
                </div>
              </div>
            </div>
            {renderToggle(
              settings.cameraToolbarSide === 'left',
              () =>
                onUpdateSettings({
                  cameraToolbarSide:
                    settings.cameraToolbarSide === 'left' ? 'right' : 'left',
                }),
              'نقل شريط الكاميرا إلى اليسار'
            )}
          </div>

          <div className="p-4 flex items-center justify-between gap-4 min-h-[72px]">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <ListOrdered className="w-5 h-5" />
              </div>
              <div>
                <div className="text-base font-bold text-slate-900 dark:text-white">
                  ترقيم الملاحظات الافتراضي
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  تفعيل ترقيم الأسطر تلقائياً عند إنشاء ملاحظة جديدة
                </div>
              </div>
            </div>
            {renderToggle(
              settings.defaultNoteNumbering,
              () =>
                onUpdateSettings({
                  defaultNoteNumbering: !settings.defaultNoteNumbering,
                }),
              'ترقيم الملاحظات الافتراضي'
            )}
          </div>

          <div className="p-4 flex items-center justify-between gap-4 min-h-[72px]">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <Calculator className="w-5 h-5" />
              </div>
              <div>
                <div className="text-base font-bold text-slate-900 dark:text-white">
                  إضافة المجموع للرسالة
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  إدراج المجموع في آخر سطر عند إرسال الملاحظة عبر واتساب
                </div>
              </div>
            </div>
            {renderToggle(
              Boolean(settings.includeTotalInWhatsApp),
              () =>
                onUpdateSettings({
                  includeTotalInWhatsApp: !settings.includeTotalInWhatsApp,
                }),
              'إضافة المجموع للرسالة'
            )}
          </div>

          <div className="p-4 flex items-center justify-between gap-4 min-h-[72px]">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <Package className="w-5 h-5" />
              </div>
              <div>
                <div className="text-base font-bold text-slate-900 dark:text-white">
                  الكميات في الملاحظات الجديدة
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  تفعيل مربعات الكميات تلقائياً عند إنشاء ملاحظة جديدة (تبقى الملاحظات القديمة كما هي)
                </div>
              </div>
            </div>
            {renderToggle(
              settings.defaultNoteQuantities !== false,
              () =>
                onUpdateSettings({
                  defaultNoteQuantities: settings.defaultNoteQuantities === false,
                }),
              'الكميات في الملاحظات الجديدة'
            )}
          </div>

          <div className="p-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <SlidersHorizontal className="w-5 h-5" />
              </div>
              <div>
                <div className="text-base font-bold text-slate-900 dark:text-white">
                  شكل النسخ (عند تفعيل الكميات)
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  تخصيص ترتيب السطور وشكل الأرقام عند نسخ الملاحظة أو إرسالها
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/70 p-2.5 space-y-1.5 border border-slate-200/70 dark:border-slate-700/60">
                <div className="text-[11px] font-extrabold text-slate-500 dark:text-slate-400 px-1">
                  ترتيب السطور
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ noteCopySortOrder: 'as-written' })}
                    className={`min-h-[38px] px-2 rounded-xl text-xs font-extrabold transition ${
                      (settings.noteCopySortOrder || 'as-written') === 'as-written'
                        ? 'bg-emerald-500 text-white shadow-xs'
                        : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    كما كتبتها
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ noteCopySortOrder: 'alphabetical' })}
                    className={`min-h-[38px] px-2 rounded-xl text-xs font-extrabold transition ${
                      settings.noteCopySortOrder === 'alphabetical'
                        ? 'bg-emerald-500 text-white shadow-xs'
                        : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    ترتيب أبجدي
                  </button>
                </div>
              </div>

              <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/70 p-2.5 space-y-1.5 border border-slate-200/70 dark:border-slate-700/60">
                <div className="text-[11px] font-extrabold text-slate-500 dark:text-slate-400 px-1">
                  الأرقام
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ noteCopyDigitStyle: 'western' })}
                    className={`min-h-[38px] px-2 rounded-xl text-xs font-extrabold transition ${
                      (settings.noteCopyDigitStyle || 'western') === 'western'
                        ? 'bg-emerald-500 text-white shadow-xs'
                        : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    إنجليزية
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ noteCopyDigitStyle: 'arabic' })}
                    className={`min-h-[38px] px-2 rounded-xl text-xs font-extrabold transition ${
                      settings.noteCopyDigitStyle === 'arabic'
                        ? 'bg-emerald-500 text-white shadow-xs'
                        : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    عربية
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 dark:bg-slate-800/70 px-3 py-2.5 border border-slate-200/70 dark:border-slate-700/60">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                إضافة إجمالي الأعداد في آخر سطر
              </span>
              {renderToggle(
                Boolean(settings.noteCopyIncludeTotalQuantities),
                () =>
                  onUpdateSettings({
                    noteCopyIncludeTotalQuantities:
                      !settings.noteCopyIncludeTotalQuantities,
                  }),
                'إضافة إجمالي الأعداد في آخر سطر'
              )}
            </div>
          </div>

        </section>

        {/* Group 1A: Camera Quality ("جودة الكاميرا") & Camera Selection */}
        <section className="bg-white dark:bg-slate-900 rounded-[20px] border border-slate-200/80 dark:border-slate-800 shadow-sm divide-y divide-slate-100 dark:divide-slate-800">
          <div className="p-4 flex items-center justify-between gap-4 min-h-[72px]">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <Camera className="w-5 h-5" />
              </div>
              <div>
                <div className="text-base font-bold text-slate-900 dark:text-white">
                  جودة الكاميرا
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {settings.cameraHighQuality !== false
                    ? 'معاينة 1080p وأقصى دقة متاحة'
                    : 'معاينة 720p وحد أقصى 2048px'}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
                جودة عالية
              </span>
              {renderToggle(
                settings.cameraHighQuality !== false,
                () =>
                  onUpdateSettings({
                    cameraHighQuality: settings.cameraHighQuality === false,
                  }),
                'جودة عالية'
              )}
            </div>
          </div>

          <div className="p-4 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label
                htmlFor="settings-camera-selector"
                className="text-base font-bold text-slate-900 dark:text-white"
              >
                الكاميرا
              </label>
              <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                {settings.selectedCameraDeviceId
                  ? 'اختيار يدوي'
                  : 'تلقائي (عدسة الفلاش)'}
              </span>
            </div>
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
                    JSON.stringify({ ...updatedDiag, updatedAt: Date.now() })
                  );
                } catch {
                  // Ignore storage errors
                }
                setCameraDiagnostics(updatedDiag);
                onUpdateSettings({
                  selectedCameraDeviceId: nextId || undefined,
                });
              }}
              className="w-full min-h-[46px] px-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
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
                  cameraDiagnostics.activeCameraDeviceId === cand.deviceId
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
                  (c) => c.deviceId === settings.selectedCameraDeviceId
                ) && (
                  <option value={settings.selectedCameraDeviceId}>
                    {cameraDiagnostics.activeCameraLabel ||
                      `كاميرا محددة (${settings.selectedCameraDeviceId.slice(0, 8)}…)`}
                  </option>
                )}
            </select>
          </div>

          <div className="p-4 space-y-2.5">
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
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200'
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
            <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/70 dark:border-slate-700/70 p-3 space-y-2 select-text">
              {buildCameraDiagnosticsRows(
                cameraDiagnostics,
                fallbackLastPhotoDims
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
          </div>
        </section>

        {/* Group 1.5: Music Player Module ("المشغّل الصوتي") */}
        <section
          data-testid="settings-music-card"
          className="bg-white dark:bg-slate-900 rounded-[20px] border border-slate-200/80 dark:border-slate-800 shadow-sm divide-y divide-slate-100 dark:divide-slate-800"
        >
          <div className="p-4 flex items-center justify-between gap-4 min-h-[72px]">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <Music className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="text-base font-bold text-slate-900 dark:text-white">
                  المشغّل الصوتي
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  تشغيل الملفات الصوتية والإذاعات في الخلفية بشكل دائم
                </div>
              </div>
            </div>
            {renderToggle(
              Boolean(settings.musicPlayerEnabled),
              () =>
                onUpdateSettings({
                  musicPlayerEnabled: !settings.musicPlayerEnabled,
                }),
              'تفعيل المشغّل الصوتي'
            )}
          </div>

          {settings.musicPlayerEnabled && (
            <>
              <div className="p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span
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
                  <span className="font-bold text-slate-500 dark:text-slate-400 tabular-nums">
                    المساحة الصوتية:{' '}
                    {formatBytesArabic(musicStorageStats?.usedBytes || 0)}
                  </span>
                </div>

                {musicStorageStats?.isStorageLow &&
                  (musicStorageStats.trackCount || 0) > 0 && (
                    <div className="rounded-xl bg-amber-50 dark:bg-amber-950/35 border border-amber-200 dark:border-amber-800 p-3 text-xs font-bold text-amber-800 dark:text-amber-200 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
                      <span>
                        مساحة المتصفح منخفضة ({formatBytesArabic(musicStorageStats.usedBytes)} مستخدمة للصوتيات). لن تُحذف الصوتيات تلقائياً؛ احذف المقاطع غير المرغوبة يدوياً.
                      </span>
                    </div>
                  )}

                <div className="space-y-2 pt-1">
                  <div className="text-xs font-bold text-slate-500 dark:text-slate-400">
                    الحد الأقصى للمساحة الصوتية (الحالي:{' '}
                    <span className="tabular-nums">
                      {settings.musicMaxStorageMb || DEFAULT_MUSIC_MAX_STORAGE_MB}
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
                          className={`min-h-[44px] rounded-xl text-xs font-extrabold tabular-nums transition ${
                            active
                              ? 'bg-emerald-500 text-white shadow-sm'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {mb} م.ب
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Floating Button Color (6 choices, default violet-pink) */}
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

              {/* Visual Effects Toggle */}
              <div className="p-4 flex items-center justify-between gap-4 min-h-[64px]">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-900 dark:text-white">
                    المؤثرات البصرية
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    الحلقة المضيئة والحد المتحرك ومؤشّر الصوت عند التشغيل
                  </div>
                </div>
                {renderToggle(
                  settings.musicVisualEffects !== false,
                  () =>
                    onUpdateSettings({
                      musicVisualEffects: !(settings.musicVisualEffects !== false),
                    }),
                  'المؤثرات البصرية'
                )}
              </div>

              {/* Audio Reactive Toggle (default OFF; warns about screen-off pause) */}
              <div className="p-4 space-y-2">
                <div className="flex items-center justify-between gap-4 min-h-[52px]">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-slate-900 dark:text-white">
                      تفاعل مع الصوت
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      تحريك الأعمدة على مستوى الصوت الحقيقي أثناء التشغيل
                    </div>
                  </div>
                  {renderToggle(
                    Boolean(settings.musicAudioReactive),
                    () =>
                      onUpdateSettings({
                        musicAudioReactive: !settings.musicAudioReactive,
                      }),
                    'تفاعل مع الصوت'
                  )}
                </div>
                {(settings.musicAudioReactive || audioReactiveWarning) && (
                  <div
                    data-testid="music-audio-reactive-warning"
                    className="rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs font-bold text-amber-800 dark:text-amber-200 flex items-center gap-2"
                  >
                    <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500" />
                    <span>قد يوقف الصوت عند إطفاء الشاشة في بعض الهواتف</span>
                  </div>
                )}
              </div>

              <div className="p-4 flex items-center justify-between gap-4 min-h-[64px]">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-900 dark:text-white">
                    إظهار على شاشة التصوير
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    الوضع الافتراضي متوقف — فعّله لإظهار زر المشغّل العائم أثناء التصوير
                  </div>
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

              {/* Add Audio Files Button + Open Music Player */}
              <div className="p-4 space-y-3">
                {onAddMusicFiles && (
                  <MusicAudioImporterTrigger
                    variant="settings-button"
                    buttonText="إضافة ملفات صوتية"
                    disabled={Boolean(musicImportProgress)}
                    onSelectFiles={onAddMusicFiles}
                    showSavedNote
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
                    className="w-full min-h-[48px] px-4 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-white font-extrabold text-sm flex items-center justify-center gap-2 active:scale-95 transition"
                  >
                    <Music className="w-4 h-4 text-emerald-500" />
                    <span>فتح المكتبة والمشغّل</span>
                  </button>
                )}
              </div>
            </>
          )}

          {(settings.musicPlayerEnabled ||
            (musicStorageStats?.trackCount || 0) > 0) && (
            <div className="p-4">
              {!settings.musicPlayerEnabled &&
                (musicStorageStats?.trackCount || 0) > 0 && (
                  <div className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-3 tabular-nums">
                    المكتبة محفوظة في الجهاز ({musicStorageStats?.trackCount} مقطع •{' '}
                    {formatBytesArabic(musicStorageStats?.usedBytes || 0)})
                  </div>
                )}

              {!confirmClearMusic ? (
                <button
                  type="button"
                  onClick={() => setConfirmClearMusic(true)}
                  className="w-full min-h-[48px] px-4 rounded-2xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>حذف المكتبة الصوتية</span>
                </button>
              ) : (
                <div className="space-y-2.5">
                  <div className="text-xs font-extrabold text-red-600 dark:text-red-400">
                    هل أنت متأكد من حذف جميع الملفات الصوتية وقائمة التشغيل نهائياً؟
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmClearMusic(false)}
                      className="min-h-[44px] flex-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold text-xs"
                    >
                      إلغاء
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleClearMusicLibrary}
                      className="min-h-[44px] flex-1 rounded-xl bg-red-600 text-white font-bold text-xs disabled:opacity-60"
                    >
                      نعم، حذف المكتبة
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Group 2: Auto-Delete Old Photos & Storage Cleanup */}
        <section className="bg-white dark:bg-slate-900 rounded-[20px] border border-slate-200/80 dark:border-slate-800 shadow-sm divide-y divide-slate-100 dark:divide-slate-800">
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-4 min-h-[52px]">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                  <CalendarClock className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-base font-bold text-slate-900 dark:text-white">
                    حذف الصور القديمة تلقائياً
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    يحذف الصور المكتملة فقط وتبقى الصور غير المكتملة
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
              <div className="pt-1">
                <div className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-2">
                  الاحتفاظ بالصور المكتملة لمدة:
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {KEEP_OPTIONS.map((opt) => {
                    const active = settings.keepPhotosDays === opt.days;
                    return (
                      <button
                        key={opt.days}
                        type="button"
                        onClick={() =>
                          onUpdateSettings({ keepPhotosDays: opt.days })
                        }
                        className={`min-h-[52px] rounded-2xl text-sm font-bold transition ${
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
              </div>
            )}
          </div>

          <div className="p-4 flex items-center justify-between gap-3 min-h-[72px]">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <HardDrive className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="text-base font-bold text-slate-900 dark:text-white">
                  المساحة المستخدمة
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {formatBytesArabic(storageBytes)}
                </div>
              </div>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={handleCleanupNow}
              className="min-h-[52px] px-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 font-bold text-sm flex items-center gap-2 border border-emerald-200 dark:border-emerald-800 shrink-0 active:scale-95 transition disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4" />
              <span>تنظيف الآن</span>
            </button>
          </div>
        </section>

        {/* Group 3: Backup Export & Import */}
        <section className="bg-white dark:bg-slate-900 rounded-[20px] border border-slate-200/80 dark:border-slate-800 shadow-sm divide-y divide-slate-100 dark:divide-slate-800">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleImportFile}
            className="hidden"
          />

          <button
            type="button"
            disabled={busy}
            onClick={handleExport}
            className="w-full min-h-[64px] p-4 flex items-center gap-3 text-right hover:bg-slate-50 dark:hover:bg-slate-800/50 transition rounded-t-[20px] disabled:opacity-50"
          >
            <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <Download className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <div className="text-base font-bold text-slate-900 dark:text-white">
                تصدير نسخة احتياطية
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                حفظ السجل والملاحظات وإعدادات التطبيق وترتيب قائمة التشغيل وإعدادات الصوتيات وروابط الإذاعة في ملف JSON (ملفات الصوت نفسها لا تُدرج؛ أعد إضافتها بعد إعادة التثبيت)
              </div>
            </div>
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
            className="w-full min-h-[64px] p-4 flex items-center gap-3 text-right hover:bg-slate-50 dark:hover:bg-slate-800/50 transition rounded-b-[20px] disabled:opacity-50"
          >
            <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <Upload className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <div className="text-base font-bold text-slate-900 dark:text-white">
                استيراد نسخة احتياطية
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                استعادة البيانات المحفوظة من ملف JSON (تظهر الملفات الصوتية المفقودة لإعادة إضافتها)
              </div>
            </div>
          </button>
        </section>

        {/* Group 5: Offline Mode Status & PWA Install */}
        <section className="bg-white dark:bg-slate-900 rounded-[20px] p-4 border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${
                isOnline
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
              }`}
            >
              {isOnline ? (
                <Wifi className="w-5 h-5" />
              ) : (
                <WifiOff className="w-5 h-5" />
              )}
            </div>
            <div className="min-w-0">
              <div className="text-base font-bold text-slate-900 dark:text-white">
                {offlineReady
                  ? 'جاهز للعمل بدون إنترنت'
                  : 'التخزين المحلي والتشغيل دون إنترنت'}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {!isOnline
                  ? 'أنت الآن في وضع عدم الاتصال — التصوير والسجل والملاحظات تعمل محلياً'
                  : offlineReady
                  ? 'تم حفظ ملفات التطبيق للفتح والعمل محلياً حتى عند انقطاع الإنترنت'
                  : swSupported
                  ? 'جاري تجهيز ملفات العمل بدون إنترنت تلقائياً'
                  : 'يتم حفظ جميع الصور والملاحظات محلياً على جهازك'}
              </div>
            </div>
          </div>
          <span
            className={`px-2.5 py-1 rounded-xl text-xs font-extrabold shrink-0 ${
              isOnline
                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
            }`}
          >
            {isOnline ? 'متصل' : 'بلا إنترنت'}
          </span>
        </section>

        <PWAInstallButton variant="card" />

        {/* Group 6: Clear All Data */}
        <section className="bg-white dark:bg-slate-900 rounded-[20px] border border-red-200/70 dark:border-red-900/40 shadow-sm overflow-hidden">
          {!confirmClear ? (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              className="w-full min-h-[64px] p-4 flex items-center gap-3 text-right hover:bg-red-50/50 dark:hover:bg-red-950/20 transition"
            >
              <div className="w-11 h-11 rounded-2xl bg-red-500/10 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <div className="text-base font-bold text-red-600 dark:text-red-400">
                  مسح كل البيانات
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  حذف جميع السجلات والملاحظات والإعدادات نهائياً
                </div>
              </div>
            </button>
          ) : (
            <div className="p-4 space-y-3">
              <div className="text-sm font-extrabold text-red-600 dark:text-red-400">
                هل أنت متأكد؟ سيتم حذف جميع البيانات المحلية نهائياً.
              </div>
              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="min-h-[52px] flex-1 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleClearAll}
                  className="min-h-[52px] flex-1 rounded-2xl bg-red-600 text-white font-bold disabled:opacity-60"
                >
                  نعم، مسح الكل
                </button>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
};
