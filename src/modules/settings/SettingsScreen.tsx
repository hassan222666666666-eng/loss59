import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Download,
  Eye,
  HardDrive,
  ListOrdered,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  Wifi,
  WifiOff,
  Zap,
  ZoomIn,
  CalendarClock,
  Image as ImageIcon,
} from 'lucide-react';
import { AppSettings, KnownProduct } from '../../types';
import {
  cleanupExpiredDonePhotos,
  clearAllData,
  estimateStorageUsageBytes,
  exportBackupJson,
  getAllKnownProducts,
  getUnanalyzedPhotosCount,
  importBackupJson,
  queueUnanalyzedPhotos,
  setProductHiddenFromTopStrip,
} from '../db';
import { analysisQueue } from '../analysis/analysisQueue';
import { formatBytesArabic } from '../../utils/arabicText';
import { PWAInstallButton } from '../../components/PWAInstallButton';
import { useOfflineSWStatus } from '../../pwa/registerOfflineSW';

interface SettingsScreenProps {
  settings: AppSettings;
  isOnline?: boolean;
  refreshSignal: number;
  onUpdateSettings: (partial: Partial<AppSettings>) => Promise<void>;
  onDataChanged: () => void;
}

const KEEP_OPTIONS: Array<{ days: 1 | 3 | 7; label: string }> = [
  { days: 1, label: 'يوم' },
  { days: 3, label: '3 أيام' },
  { days: 7, label: 'أسبوع' },
];

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  settings,
  isOnline = true,
  refreshSignal,
  onUpdateSettings,
  onDataChanged,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);
  const [storageBytes, setStorageBytes] = useState<number>(0);
  const [hiddenProducts, setHiddenProducts] = useState<KnownProduct[]>([]);
  const [unanalyzedCount, setUnanalyzedCount] = useState<number>(0);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const { offlineReady, swSupported } = useOfflineSWStatus();

  const loadMeta = useCallback(async () => {
    try {
      const [bytes, allProducts, pendingManual] = await Promise.all([
        estimateStorageUsageBytes(),
        getAllKnownProducts(),
        getUnanalyzedPhotosCount(),
      ]);
      setStorageBytes(bytes);
      setHiddenProducts(allProducts.filter((p) => Boolean(p.hiddenFromTopStrip)));
      setUnanalyzedCount(pendingManual);
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
          ? 'تم تنظيف الصور المكتملة بنجاح مع الحفاظ على السجلات والمنتجات.'
          : 'لا توجد صور مكتملة تحتاج إلى تنظيف حالياً.'
      );
    } catch {
      showMessage('error', 'تعذر تنظيف التخزين.');
    } finally {
      setBusy(false);
    }
  };

  const handleAnalyzeUnanalyzed = async () => {
    if (!settings.aiAnalysisEnabled) return;
    setBusy(true);
    try {
      const queued = await queueUnanalyzedPhotos();
      if (queued > 0) {
        analysisQueue.notify();
        analysisQueue.processQueue();
      }
      await loadMeta();
      onDataChanged();
      showMessage(
        'success',
        queued > 0
          ? `تمت إضافة ${queued} ${queued === 1 ? 'صورة' : 'صور'} إلى طابور التحليل.`
          : 'لا توجد صور غير محللة حالياً.'
      );
    } catch {
      showMessage('error', 'تعذر بدء تحليل الصور.');
    } finally {
      setBusy(false);
    }
  };

  const handleUnhideProduct = async (productId: string) => {
    try {
      await setProductHiddenFromTopStrip(productId, false);
      await loadMeta();
      onDataChanged();
      showMessage('success', 'تمت إعادة إظهار المنتج في شريط الملاحظات.');
    } catch {
      showMessage('error', 'تعذر تحديث حالة المنتج.');
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

        {/* Group 1: AI, Capture & Notes Preferences */}
        <section className="bg-white dark:bg-slate-900 rounded-[20px] border border-slate-200/80 dark:border-slate-800 shadow-sm divide-y divide-slate-100 dark:divide-slate-800">
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-4 min-h-[52px]">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-base font-bold text-slate-900 dark:text-white">
                    التحليل بالذكاء الاصطناعي
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {settings.aiAnalysisEnabled
                      ? 'تحديد أماكن النقص تلقائياً عند توفر الاتصال'
                      : 'متوقف — التصوير والسجل يعملان بالكامل بدون إنترنت'}
                  </div>
                </div>
              </div>
              {renderToggle(
                settings.aiAnalysisEnabled,
                () =>
                  onUpdateSettings({
                    aiAnalysisEnabled: !settings.aiAnalysisEnabled,
                  }),
                'التحليل بالذكاء الاصطناعي'
              )}
            </div>

            {settings.aiAnalysisEnabled && (
              <button
                type="button"
                disabled={busy || unanalyzedCount === 0 || !isOnline}
                onClick={handleAnalyzeUnanalyzed}
                className="min-h-[48px] w-full px-4 rounded-2xl bg-emerald-500 text-white font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition disabled:opacity-50 disabled:bg-slate-100 disabled:text-slate-500 dark:disabled:bg-slate-800 dark:disabled:text-slate-400"
              >
                <Sparkles className="w-4 h-4 shrink-0" />
                <span>
                  تحليل الصور غير المحللة
                  {unanalyzedCount > 0 ? ` (${unanalyzedCount})` : ''}
                  {!isOnline && unanalyzedCount > 0 ? ' — يحتاج إنترنت' : ''}
                </span>
              </button>
            )}
          </div>

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
                    يحذف الصور المكتملة فقط وتبقى السجلات وصور المنتجات والرفوف
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
              <Sparkles className="w-4 h-4" />
              <span>تنظيف الآن</span>
            </button>
          </div>
        </section>

        {/* Group 3: Hidden Products from Top Strip */}
        <section className="bg-white dark:bg-slate-900 rounded-[20px] border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="px-4 pt-4 pb-2">
            <h2 className="text-base font-extrabold text-slate-900 dark:text-white">
              المنتجات المخفية
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              المنتجات التي أخفيتها من شريط &quot;يُسحب كثيراً&quot; في الملاحظات
            </p>
          </div>

          {hiddenProducts.length === 0 ? (
            <div className="px-4 pb-4 pt-1 text-xs font-semibold text-slate-400 dark:text-slate-500">
              لا توجد منتجات مخفية حالياً.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {hiddenProducts.map((prod) => (
                <div
                  key={prod.id}
                  className="p-4 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {prod.thumbnailDataUrl ? (
                      <img
                        src={prod.thumbnailDataUrl}
                        alt="صورة المنتج"
                        className="w-14 h-14 rounded-2xl object-cover bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shrink-0"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                        <ImageIcon className="w-5 h-5 text-slate-400" />
                      </div>
                    )}
                    {prod.productName ? (
                      <span className="text-sm font-bold text-slate-900 dark:text-white truncate">
                        {prod.productName}
                      </span>
                    ) : (
                      <span className="text-xs font-semibold text-slate-400 dark:text-slate-500">
                        منتج مخفي
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleUnhideProduct(prod.id)}
                    className="min-h-[52px] px-4 rounded-2xl bg-emerald-500 text-white text-sm font-bold flex items-center gap-1.5 shrink-0 active:scale-95 transition"
                  >
                    <Eye className="w-4 h-4" />
                    <span>إظهار</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Group 4: Backup Export & Import */}
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
              <div className="text-xs text-slate-500 dark:text-slate-400">
                حفظ السجل والملاحظات والعلامات اليدوية والإعدادات في ملف JSON
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
                استعادة البيانات المحفوظة من ملف JSON
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
                  حذف جميع السجلات والرفوف والملاحظات والمنتجات نهائياً
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
