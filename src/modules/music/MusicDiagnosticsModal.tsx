import React, { useState } from 'react';
import { Check, Copy, Volume2, X } from 'lucide-react';
import { formatBytesArabic } from '../../utils/arabicText';
import { formatAudioTime } from './musicLogic';
import {
  describeNetworkState,
  describeReadyState,
  formatPlaybackDiagnosticsText,
} from './musicPlaybackHelpers';
import { MusicPlaybackDiagnostics } from './types';

interface MusicDiagnosticsModalProps {
  open: boolean;
  diagnostics: MusicPlaybackDiagnostics | null;
  onClose: () => void;
  onRefresh: () => MusicPlaybackDiagnostics;
}

export const MusicDiagnosticsModal: React.FC<MusicDiagnosticsModalProps> = ({
  open,
  diagnostics,
  onClose,
  onRefresh,
}) => {
  const [copied, setCopied] = useState(false);
  const [liveDiag, setLiveDiag] = useState<MusicPlaybackDiagnostics | null>(null);

  if (!open) return null;

  const data = liveDiag || diagnostics;
  if (!data) return null;

  const handleCopy = async () => {
    const fresh = onRefresh();
    setLiveDiag(fresh);
    const text = formatPlaybackDiagnosticsText(fresh);
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // Ignore clipboard failure
    }
  };

  const rows: { label: string; value: string; dir?: 'ltr' | 'rtl' }[] = [
    { label: 'المقطع الحالي', value: data.trackTitle || 'لا يوجد' },
    { label: 'اسم الملف', value: data.fileName || 'غير متوفر', dir: 'ltr' },
    {
      label: 'نوع الملف (MIME)',
      value: `${data.mimeType || 'غير محدد'} → ${data.resolvedMimeType}`,
      dir: 'ltr',
    },
    { label: 'حجم الملف', value: formatBytesArabic(data.sizeBytes) },
    {
      label: 'المدة',
      value: data.durationSec > 0 ? formatAudioTime(data.durationSec) : '--:--',
      dir: 'ltr',
    },
    { label: 'readyState', value: describeReadyState(data.readyState), dir: 'ltr' },
    {
      label: 'networkState',
      value: describeNetworkState(data.networkState),
      dir: 'ltr',
    },
    {
      label: 'audio.volume',
      value: `${Math.round(data.volume * 100)}%`,
      dir: 'ltr',
    },
    {
      label: 'audio.muted',
      value: data.muted ? 'نعم (مكتوم)' : 'لا',
    },
    {
      label: 'آخر خطأ',
      value: data.lastError || 'لا يوجد',
    },
  ];

  return (
    <div
      data-testid="music-diagnostics-modal"
      className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-label="تشخيص التشغيل"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[85dvh]"
      >
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
          <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">
            تشخيص التشغيل
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق التشخيص"
            className="min-w-[40px] min-h-[40px] rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/70 dark:border-slate-700/70 divide-y divide-slate-200/70 dark:divide-slate-700/60">
            {rows.map((row) => (
              <div
                key={row.label}
                className="px-3 py-2 flex items-start justify-between gap-3 text-xs"
              >
                <span className="font-bold text-slate-500 dark:text-slate-400 shrink-0">
                  {row.label}
                </span>
                <span
                  dir={row.dir || 'auto'}
                  className="font-extrabold text-slate-900 dark:text-white text-left break-words tabular-nums"
                >
                  {row.value}
                </span>
              </div>
            ))}
          </div>

          <div className="rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 p-3 flex items-start gap-2.5 text-amber-900 dark:text-amber-200 text-xs font-bold leading-relaxed">
            <Volume2 className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <span>
              إذا بدا كل شيء طبيعياً ولا يزال بدون صوت، تأكد من رفع مستوى صوت
              الوسائط من أزرار الصوت في الهاتف.
            </span>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setLiveDiag(onRefresh())}
            className="min-h-[44px] px-4 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-extrabold"
          >
            تحديث
          </button>
          <button
            type="button"
            data-testid="music-diagnostics-copy-btn"
            onClick={() => void handleCopy()}
            className="min-h-[44px] flex-1 rounded-xl bg-emerald-500 text-white text-xs font-extrabold flex items-center justify-center gap-2 active:scale-95 transition"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4" />
                <span>تم النسخ</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                <span>نسخ</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
