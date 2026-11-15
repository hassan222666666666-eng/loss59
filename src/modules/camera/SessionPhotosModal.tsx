import React, { useState } from 'react';
import {
  X,
  Trash2,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Camera,
  RotateCcw,
  ClipboardList,
} from 'lucide-react';
import { Shelf, ShelfPhoto, ShortageItem } from '../../types';
import { formatTimeArabic } from '../../utils/arabicText';

interface SessionPhotosModalProps {
  photos: ShelfPhoto[];
  shelves: Shelf[];
  shortages: ShortageItem[];
  aiEnabled: boolean;
  onDeletePhoto: (photoId: string) => Promise<void>;
  onRetryPhoto: (photoId: string) => Promise<void>;
  onOpenInLog: (photoId: string) => void;
  onClose: () => void;
}

export const SessionPhotosModal: React.FC<SessionPhotosModalProps> = ({
  photos,
  shelves,
  shortages,
  aiEnabled,
  onDeletePhoto,
  onRetryPhoto,
  onOpenInLog,
  onClose,
}) => {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const shelfMap = new Map<string, string>();
  for (const sh of shelves) {
    shelfMap.set(sh.id, sh.label);
  }

  const shortageSummaryMap = new Map<
    string,
    { total: number; unfinished: number }
  >();
  for (const s of shortages) {
    const cur = shortageSummaryMap.get(s.photoId) || {
      total: 0,
      unfinished: 0,
    };
    cur.total += 1;
    if (s.status !== 'done') {
      cur.unfinished += 1;
    }
    shortageSummaryMap.set(s.photoId, cur);
  }

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await onDeletePhoto(id);
    } finally {
      setDeletingId(null);
    }
  };

  const renderStatus = (photo: ShelfPhoto) => {
    if (!aiEnabled) {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 dark:text-slate-400">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          {photo.done ? 'مكتملة' : 'محفوظة'}
        </span>
      );
    }

    switch (photo.status) {
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-600 dark:text-amber-400">
            <Clock className="w-3.5 h-3.5" />
            في الطابور
          </span>
        );
      case 'analyzing':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            جاري التحليل
          </span>
        );
      case 'completed': {
        const summary = shortageSummaryMap.get(photo.id);
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {summary && summary.total > 0
              ? summary.unfinished > 0
                ? `${summary.unfinished} نواقص`
                : 'تم الكل'
              : 'تم التحليل'}
          </span>
        );
      }
      case 'manual_only':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 dark:text-slate-400">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            غير محللة
          </span>
        );
      case 'poor_quality':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-600 dark:text-amber-400">
            <AlertTriangle className="w-3.5 h-3.5" />
            جودة منخفضة
          </span>
        );
      case 'error':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-red-600 dark:text-red-400">
            <AlertTriangle className="w-3.5 h-3.5" />
            تعذر التحليل
          </span>
        );
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-label="صور هذه الجلسة"
    >
      <div className="bg-[#F7F8FA] dark:bg-slate-900 w-full max-w-2xl max-h-[88vh] rounded-t-[24px] sm:rounded-[20px] flex flex-col overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800">
        <div className="px-5 py-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">
              صور هذه الجلسة
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              {photos.length} {photos.length === 1 ? 'صورة' : 'صور'} · مرتبطة مباشرة بالسجل
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[52px] min-h-[52px] rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center active:scale-95 transition"
            aria-label="إغلاق"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {photos.length === 0 ? (
            <div className="py-16 text-center text-slate-500 dark:text-slate-400 text-sm">
              لم تلتقط أي صور في هذه الجلسة بعد.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {photos.map((photo) => {
                const shelfLabel = photo.shelfId
                  ? shelfMap.get(photo.shelfId) || 'رف'
                  : 'رف';
                return (
                  <div
                    key={photo.id}
                    className="bg-white dark:bg-slate-800 rounded-[20px] overflow-hidden shadow-sm border border-slate-200/80 dark:border-slate-700/70 flex flex-col"
                  >
                    <button
                      type="button"
                      onClick={() => onOpenInLog(photo.id)}
                      className="relative aspect-[4/3] bg-slate-200 dark:bg-slate-700 flex items-center justify-center w-full text-right active:opacity-90 transition"
                      aria-label="فتح الصورة في السجل"
                    >
                      {photo.dataUrl ? (
                        <img
                          src={photo.dataUrl}
                          alt="صورة رف"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Camera className="w-8 h-8 text-slate-400" />
                      )}
                      <span className="absolute bottom-1.5 right-1.5 px-2 py-0.5 rounded-lg bg-black/65 text-white text-[10px] font-bold inline-flex items-center gap-1">
                        <ClipboardList className="w-3 h-3 text-emerald-400" />
                        <span>فتح في السجل</span>
                      </span>
                    </button>

                    <div className="p-2.5 flex items-center justify-between gap-1.5">
                      <button
                        type="button"
                        onClick={() => onOpenInLog(photo.id)}
                        className="min-w-0 flex-1 text-right"
                      >
                        <div className="text-xs font-extrabold text-slate-800 dark:text-slate-100 truncate">
                          {shelfLabel} ·{' '}
                          <span className="font-semibold text-slate-500 dark:text-slate-400 tabular-nums">
                            {formatTimeArabic(photo.timestamp)}
                          </span>
                        </div>
                        <div className="mt-0.5">{renderStatus(photo)}</div>
                      </button>

                      <div className="flex items-center gap-1 shrink-0">
                        {aiEnabled &&
                          (photo.status === 'error' ||
                            photo.status === 'poor_quality') && (
                            <button
                              type="button"
                              onClick={() => onRetryPhoto(photo.id)}
                              className="min-w-[40px] min-h-[44px] rounded-xl bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 flex items-center justify-center active:scale-95 transition"
                              aria-label="إعادة التحليل"
                            >
                              <RotateCcw className="w-4 h-4" />
                            </button>
                          )}
                        <button
                          type="button"
                          onClick={() => handleDelete(photo.id)}
                          disabled={deletingId === photo.id}
                          className="min-w-[44px] min-h-[44px] rounded-xl bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 flex items-center justify-center active:scale-95 transition disabled:opacity-50"
                          aria-label="حذف الصورة"
                        >
                          {deletingId === photo.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
