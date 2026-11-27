import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Check,
  CheckSquare,
  Loader2,
  Square,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { AppSettings, ShelfPhoto } from '../../types';
import {
  deletePhotoById,
  deletePhotosBulk,
  getAllPhotos,
  markPhotosDoneBulk,
  savePhoto,
} from '../db';
import { rotateDataUrl90CW } from '../camera/imageCompression';
import {
  MAX_SAVED_PHOTO_LONG_SIDE,
  SAVED_PHOTO_JPEG_QUALITY,
} from '../camera/captureQueue';
import {
  reEnhancePhotoNow,
  restoreOriginalPhotoRecord,
} from '../camera/photoEnhancementQueue';
import { resolveEnhanceLevel } from '../camera/photoEnhancement';
import { formatDayHeading, formatTimeArabic } from '../../utils/arabicText';
import { PWAInstallButton } from '../../components/PWAInstallButton';
import { PhotoDetailView } from './PhotoDetailView';

type LogFilter = 'all' | 'unfinished' | 'done';

const ROTATE_HINT_DISMISSED_KEY = 'naqs_alrofoof_rotate_hint_dismissed';

interface LogScreenProps {
  settings?: AppSettings;
  refreshSignal: number;
  focusPhotoId?: string | null;
  onClearFocusPhoto?: () => void;
}

export function isPhotoDone(photo: ShelfPhoto): boolean {
  return photo.done === true;
}

interface SwipeableCardProps {
  onSwipeDelete: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}

const SwipeablePhotoCard: React.FC<SwipeableCardProps> = ({
  onSwipeDelete,
  disabled,
  children,
}) => {
  const startXRef = useRef<number | null>(null);
  const startYRef = useRef<number | null>(null);
  const [offsetX, setOffsetX] = useState(0);
  const [swiping, setSwiping] = useState(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (disabled || e.touches.length !== 1) return;
    startXRef.current = e.touches[0].clientX;
    startYRef.current = e.touches[0].clientY;
    setSwiping(false);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (disabled || startXRef.current === null || startYRef.current === null) {
      return;
    }
    const dx = e.touches[0].clientX - startXRef.current;
    const dy = e.touches[0].clientY - startYRef.current;
    if (!swiping && Math.abs(dx) > 16 && Math.abs(dx) > Math.abs(dy) * 1.45) {
      setSwiping(true);
    }
    if (swiping) {
      setOffsetX(dx);
    }
  };

  const handleTouchEnd = () => {
    if (swiping && Math.abs(offsetX) > 95) {
      setOffsetX(offsetX > 0 ? 320 : -320);
      setTimeout(() => {
        onSwipeDelete();
      }, 120);
    } else {
      setOffsetX(0);
    }
    startXRef.current = null;
    startYRef.current = null;
    setSwiping(false);
  };

  return (
    <div className="relative overflow-hidden rounded-[20px]">
      {Math.abs(offsetX) > 18 && (
        <div className="absolute inset-0 bg-red-500 text-white flex items-center justify-between px-6 font-extrabold text-sm rounded-[20px]">
          <span>حذف</span>
          <Trash2 className="w-5 h-5" />
        </div>
      )}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={
          offsetX !== 0 ? { transform: `translateX(${offsetX}px)` } : undefined
        }
        className="relative transition-transform duration-150"
      >
        {children}
      </div>
    </div>
  );
};

export const LogScreen: React.FC<LogScreenProps> = ({
  settings,
  refreshSignal,
  focusPhotoId,
  onClearFocusPhoto,
}) => {
  const [photos, setPhotos] = useState<ShelfPhoto[]>([]);
  const [filter, setFilter] = useState<LogFilter>('all');
  const [loading, setLoading] = useState(true);
  const [showRotateHint, setShowRotateHint] = useState<boolean>(() => {
    try {
      return localStorage.getItem(ROTATE_HINT_DISMISSED_KEY) !== '1';
    } catch {
      return true;
    }
  });

  // Per-photo full-screen view state
  const [activePhotoId, setActivePhotoId] = useState<string | null>(null);
  const [showAllCompletedScreen, setShowAllCompletedScreen] = useState(false);

  // Swipe-to-delete Undo toast
  const [undoDeletedPhoto, setUndoDeletedPhoto] = useState<ShelfPhoto | null>(
    null
  );
  const undoTimerRef = useRef<number | null>(null);

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(
    () => new Set()
  );

  const dismissRotateHint = () => {
    setShowRotateHint(false);
    try {
      localStorage.setItem(ROTATE_HINT_DISMISSED_KEY, '1');
    } catch {
      // Ignore storage errors
    }
  };

  const loadData = useCallback(async () => {
    const allPhotos = await getAllPhotos();
    setPhotos(allPhotos);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData, refreshSignal]);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current !== null) {
        window.clearTimeout(undoTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!focusPhotoId || loading) return;
    setFilter('all');
    setSelectionMode(false);
    setSelectedPhotoIds(new Set());
    if (photos.some((p) => p.id === focusPhotoId)) {
      setShowAllCompletedScreen(false);
      setActivePhotoId(focusPhotoId);
      setTimeout(() => {
        const el = document.getElementById(`log-photo-${focusPhotoId}`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 80);
    }
    onClearFocusPhoto?.();
  }, [focusPhotoId, loading, photos, onClearFocusPhoto]);

  const photoRecords = useMemo(() => {
    return photos.map((photo) => ({
      photo,
      isDone: isPhotoDone(photo),
    }));
  }, [photos]);

  const unfinishedPhotoQueue = useMemo(() => {
    return photoRecords
      .filter((r) => !r.isDone)
      .map((r) => r.photo)
      .sort((a, b) => a.timestamp - b.timestamp);
  }, [photoRecords]);

  const filteredRecords = useMemo(() => {
    if (filter === 'all') return photoRecords;
    if (filter === 'unfinished') return photoRecords.filter((r) => !r.isDone);
    return photoRecords.filter((r) => r.isDone);
  }, [photoRecords, filter]);

  const groupedDays = useMemo(() => {
    const map = new Map<string, typeof filteredRecords>();
    for (const rec of filteredRecords) {
      const list = map.get(rec.photo.dateKey) || [];
      list.push(rec);
      map.set(rec.photo.dateKey, list);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([dateKey, entries]) => ({ dateKey, entries }));
  }, [filteredRecords]);

  const hasVisiblePhotos = filteredRecords.length > 0;
  const isAllVisibleSelected = useMemo(() => {
    if (!hasVisiblePhotos) return false;
    return filteredRecords.every((r) => selectedPhotoIds.has(r.photo.id));
  }, [hasVisiblePhotos, filteredRecords, selectedPhotoIds]);

  const handleToggleSelectAll = () => {
    if (!hasVisiblePhotos) return;
    if (selectionMode && isAllVisibleSelected) {
      setSelectionMode(false);
      setSelectedPhotoIds(new Set());
    } else {
      setSelectionMode(true);
      setSelectedPhotoIds(new Set(filteredRecords.map((r) => r.photo.id)));
    }
  };

  const handleCancelSelection = () => {
    setSelectionMode(false);
    setSelectedPhotoIds(new Set());
  };

  const togglePhotoSelection = (id: string) => {
    setSelectedPhotoIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDeletePhotoWithUndo = async (photo: ShelfPhoto) => {
    await deletePhotoById(photo.id);
    if (activePhotoId === photo.id) {
      setActivePhotoId(null);
    }
    setUndoDeletedPhoto(photo);
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
    }
    undoTimerRef.current = window.setTimeout(() => {
      setUndoDeletedPhoto(null);
    }, 5500);
    await loadData();
  };

  const handleUndoDelete = async () => {
    if (!undoDeletedPhoto) return;
    const restored = undoDeletedPhoto;
    setUndoDeletedPhoto(null);
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
    }
    await savePhoto(restored);
    await loadData();
  };

  const handleBulkComplete = async () => {
    const selectedPhotos = photos.filter((p) => selectedPhotoIds.has(p.id));
    if (selectedPhotos.length === 0) return;
    await markPhotosDoneBulk(selectedPhotos);
    handleCancelSelection();
    await loadData();
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedPhotoIds) as string[];
    if (ids.length === 0) return;
    await deletePhotosBulk(ids);
    handleCancelSelection();
    await loadData();
  };

  const activePhoto = useMemo(
    () =>
      activePhotoId ? photos.find((p) => p.id === activePhotoId) || null : null,
    [photos, activePhotoId]
  );

  const unfinishedPosition = useMemo(() => {
    if (!activePhoto) return null;
    const idx = unfinishedPhotoQueue.findIndex((p) => p.id === activePhoto.id);
    return idx >= 0 ? idx + 1 : null;
  }, [activePhoto, unfinishedPhotoQueue]);

  const handleCompleteActivePhoto = async () => {
    if (!activePhoto) return;
    const remainingUnfinished = unfinishedPhotoQueue.filter(
      (p) => p.id !== activePhoto.id
    );
    const currentUnfinishedIdx = unfinishedPhotoQueue.findIndex(
      (p) => p.id === activePhoto.id
    );
    const nextUnfinished =
      remainingUnfinished.length > 0
        ? remainingUnfinished[
            Math.min(
              Math.max(0, currentUnfinishedIdx),
              remainingUnfinished.length - 1
            )
          ]
        : null;

    await savePhoto({ ...activePhoto, done: true });
    await loadData();

    if (nextUnfinished) {
      setShowAllCompletedScreen(false);
      setActivePhotoId(nextUnfinished.id);
    } else {
      setActivePhotoId(null);
      setShowAllCompletedScreen(true);
    }
  };

  const handleSkipActivePhoto = () => {
    if (!activePhoto) return;
    if (unfinishedPhotoQueue.length <= 1) {
      setActivePhotoId(null);
      setShowAllCompletedScreen(false);
      return;
    }
    const idx = unfinishedPhotoQueue.findIndex((p) => p.id === activePhoto.id);
    const nextIdx =
      idx >= 0 ? (idx + 1) % unfinishedPhotoQueue.length : 0;
    const nextPhoto = unfinishedPhotoQueue[nextIdx];
    if (nextPhoto && nextPhoto.id !== activePhoto.id) {
      setActivePhotoId(nextPhoto.id);
    } else {
      setActivePhotoId(null);
    }
  };

  const handleRotateActivePhoto = async () => {
    if (!activePhoto || !activePhoto.dataUrl) return;
    const rotated = await rotateDataUrl90CW(
      activePhoto.dataUrl,
      MAX_SAVED_PHOTO_LONG_SIDE,
      SAVED_PHOTO_JPEG_QUALITY
    );
    let nextOriginalDataUrl = activePhoto.originalDataUrl;
    if (activePhoto.originalDataUrl) {
      try {
        const rotatedOriginal = await rotateDataUrl90CW(
          activePhoto.originalDataUrl,
          MAX_SAVED_PHOTO_LONG_SIDE,
          SAVED_PHOTO_JPEG_QUALITY
        );
        nextOriginalDataUrl = rotatedOriginal.dataUrl;
      } catch {
        // Keep existing original if rotation fails
      }
    }
    await savePhoto({
      ...activePhoto,
      dataUrl: rotated.dataUrl,
      thumbnailDataUrl: rotated.thumbnailDataUrl,
      ...(nextOriginalDataUrl ? { originalDataUrl: nextOriginalDataUrl } : {}),
      width: rotated.width,
      height: rotated.height,
    });
    await loadData();
  };

  const handleReEnhanceActivePhoto = async () => {
    if (!activePhoto) return;
    const level =
      resolveEnhanceLevel(settings?.photoEnhanceLevel) ?? 'medium';
    await reEnhancePhotoNow(activePhoto, level);
    await loadData();
  };

  const handleRestoreOriginalActivePhoto = async () => {
    if (!activePhoto || !activePhoto.originalDataUrl) return;
    await restoreOriginalPhotoRecord(activePhoto);
    await loadData();
  };

  return (
    <div
      className="min-h-[100dvh] pb-28 bg-[#F7F8FA] dark:bg-slate-950"
      dir="rtl"
    >
      <header className="sticky top-0 z-20 bg-[#F7F8FA]/95 dark:bg-slate-950/95 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800 px-4 pt-[calc(1rem+env(safe-area-inset-top,0px))] pb-3">
        <div className="max-w-5xl mx-auto space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">
              السجل
            </h1>

            <div className="flex items-center gap-2">
              {!selectionMode && <PWAInstallButton variant="compact" />}
              {hasVisiblePhotos && (
                <>
                  {selectionMode && (
                    <button
                      type="button"
                      onClick={handleCancelSelection}
                      className="min-h-[44px] px-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-slate-600 dark:text-slate-300 text-xs font-bold flex items-center gap-1.5 active:scale-95 transition"
                    >
                      <X className="w-4 h-4" />
                      <span>إلغاء</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleToggleSelectAll}
                    className={`min-h-[44px] px-3.5 rounded-2xl text-xs font-extrabold flex items-center gap-1.5 active:scale-95 transition ${
                      selectionMode && isAllVisibleSelected
                        ? 'bg-emerald-500 text-white shadow-sm'
                        : 'bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-emerald-600 dark:text-emerald-400'
                    }`}
                  >
                    {selectionMode && isAllVisibleSelected ? (
                      <CheckSquare className="w-4 h-4" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                    <span>
                      {selectionMode && isAllVisibleSelected
                        ? 'إلغاء التحديد'
                        : 'تحديد الكل'}
                    </span>
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Filter Tabs */}
          <div className="grid grid-cols-3 gap-1 p-1 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800">
            {(
              [
                { key: 'all', label: 'الكل' },
                { key: 'unfinished', label: 'غير مكتمل' },
                { key: 'done', label: 'تم' },
              ] as const
            ).map((item) => {
              const active = filter === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    setFilter(item.key);
                    handleCancelSelection();
                  }}
                  className={`min-h-[44px] rounded-xl text-sm font-bold transition ${
                    active
                      ? 'bg-emerald-500 text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 pt-4 space-y-6">
        {!loading && showRotateHint && photos.length > 0 && (
          <div className="bg-amber-50 dark:bg-amber-950/35 border border-amber-200 dark:border-amber-800/70 rounded-2xl px-3.5 py-2.5 flex items-center justify-between gap-3">
            <span className="text-xs font-bold text-amber-900 dark:text-amber-200 leading-relaxed">
              هل صورك قديمة مقلوبة؟ استخدم زر التدوير داخل الصورة.
            </span>
            <button
              type="button"
              onClick={dismissRotateHint}
              className="w-8 h-8 rounded-xl bg-amber-500/15 text-amber-800 dark:text-amber-200 flex items-center justify-center shrink-0 active:scale-95 transition"
              aria-label="إغلاق التنبيه"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {loading ? (
          <div className="py-20 flex flex-col items-center gap-3 text-slate-500">
            <Loader2 className="w-7 h-7 animate-spin text-emerald-500" />
            <span className="text-sm font-semibold">جاري تحميل السجل...</span>
          </div>
        ) : groupedDays.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 rounded-[20px] p-8 text-center border border-slate-200/80 dark:border-slate-800 shadow-sm mt-4">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center mx-auto mb-3">
              <Camera className="w-8 h-8" />
            </div>
            <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">
              {filter === 'all' ? 'لا توجد صور مسجلة بعد' : 'لا توجد صور مطابقة'}
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              التقط صوراً للأرفف من تبويب التصوير لحفظها ومتابعتها هنا.
            </p>
          </div>
        ) : (
          groupedDays.map((day) => (
            <section key={day.dateKey} className="space-y-3">
              <h2 className="text-base font-extrabold text-slate-800 dark:text-slate-100 px-1">
                {formatDayHeading(day.dateKey)}
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {day.entries.map(({ photo, isDone }) => {
                  const isSelected = selectedPhotoIds.has(photo.id);
                  return (
                    <SwipeablePhotoCard
                      key={photo.id}
                      disabled={selectionMode}
                      onSwipeDelete={() => handleDeletePhotoWithUndo(photo)}
                    >
                      <div
                        id={`log-photo-${photo.id}`}
                        onClick={() => {
                          if (selectionMode) {
                            togglePhotoSelection(photo.id);
                          } else {
                            setShowAllCompletedScreen(false);
                            setActivePhotoId(photo.id);
                          }
                        }}
                        className={`rounded-[20px] overflow-hidden border shadow-sm cursor-pointer transition flex flex-col ${
                          selectionMode && isSelected
                            ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-500 ring-2 ring-emerald-500/20'
                            : isDone
                            ? 'bg-slate-100 dark:bg-slate-900/60 border-slate-200/70 dark:border-slate-800/70 opacity-70'
                            : 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800'
                        }`}
                      >
                        {/* Full-width Photo Thumbnail */}
                        <div
                          className={`relative w-full bg-slate-950/5 dark:bg-slate-950 ${
                            isDone ? 'grayscale' : ''
                          }`}
                        >
                          {photo.dataUrl ? (
                            <img
                              src={photo.thumbnailDataUrl || photo.dataUrl}
                              alt="صورة الرف"
                              decoding="async"
                              loading="lazy"
                              className="w-full h-auto max-h-[56vh] object-contain block"
                            />
                          ) : (
                            <div className="w-full py-12 flex flex-col items-center justify-center gap-2 text-slate-400">
                              <Camera className="w-8 h-8 opacity-60" />
                              <span className="text-xs font-semibold">
                                تم تنظيف الصورة لتوفير المساحة
                              </span>
                            </div>
                          )}

                          {photo.enhancementStatus === 'pending' && photo.dataUrl && (
                            <div
                              data-testid="photo-enhancing-chip"
                              className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded-lg bg-slate-950/75 text-white text-[10px] font-extrabold flex items-center gap-1 backdrop-blur-sm"
                            >
                              <Loader2 className="w-3 h-3 animate-spin text-emerald-400" />
                              <span>جاري التحسين</span>
                            </div>
                          )}

                          {photo.enhancementStatus === 'unenhanced' && photo.dataUrl && (
                            <div
                              data-testid="photo-unenhanced-chip"
                              className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded-lg bg-amber-950/80 text-amber-200 text-[10px] font-bold backdrop-blur-sm"
                            >
                              بدون تحسين
                            </div>
                          )}

                          {selectionMode && (
                            <div className="absolute top-3 right-3 w-8 h-8 rounded-xl bg-white/95 dark:bg-slate-900/95 shadow flex items-center justify-center">
                              {isSelected ? (
                                <CheckSquare className="w-6 h-6 text-emerald-500" />
                              ) : (
                                <Square className="w-6 h-6 text-slate-400" />
                              )}
                            </div>
                          )}
                        </div>

                        {/* Card Info: Time + Chip (جديد / تم) + Delete */}
                        <div className="p-3 flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 tabular-nums">
                            {formatTimeArabic(photo.timestamp)}
                          </span>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <span
                              className={`inline-flex items-center px-2.5 py-1 rounded-xl text-xs font-extrabold ${
                                isDone
                                  ? 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                                  : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                              }`}
                            >
                              {isDone ? 'تم' : 'جديد'}
                            </span>

                            {!selectionMode && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeletePhotoWithUndo(photo);
                                }}
                                className="min-w-[40px] min-h-[40px] rounded-xl text-slate-400 hover:text-red-500 flex items-center justify-center"
                                aria-label="حذف الصورة"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </SwipeablePhotoCard>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </main>

      {/* Bulk Selection Action Bar */}
      {selectionMode && selectedPhotoIds.size > 0 && (
        <div className="fixed bottom-[68px] inset-x-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200/80 dark:border-slate-800 px-4 py-2.5 shadow-lg">
          <div className="max-w-3xl mx-auto flex items-center gap-2">
            <button
              type="button"
              onClick={handleBulkComplete}
              className="min-h-[52px] flex-1 rounded-2xl bg-emerald-500 text-white font-extrabold text-sm flex items-center justify-center gap-1.5 active:scale-95 transition"
            >
              <Check className="w-5 h-5" />
              <span>تم الإكمال</span>
            </button>
            <button
              type="button"
              onClick={handleBulkDelete}
              className="min-h-[52px] flex-1 rounded-2xl bg-red-500/15 text-red-600 dark:text-red-400 font-extrabold text-sm flex items-center justify-center gap-1.5 active:scale-95 transition"
            >
              <Trash2 className="w-5 h-5" />
              <span>حذف المحدد</span>
            </button>
          </div>
        </div>
      )}

      {/* Undo Swipe Delete Toast */}
      {undoDeletedPhoto && (
        <div className="fixed bottom-20 inset-x-4 z-40 flex justify-center pointer-events-none">
          <div className="pointer-events-auto bg-slate-900 dark:bg-slate-800 text-white rounded-2xl px-4 py-3 shadow-2xl flex items-center gap-4 border border-slate-700">
            <span className="text-sm font-bold">تم حذف الصورة</span>
            <button
              type="button"
              onClick={handleUndoDelete}
              className="min-h-[40px] px-3 rounded-xl bg-emerald-500 text-white text-xs font-extrabold flex items-center gap-1 active:scale-95 transition"
            >
              <Undo2 className="w-4 h-4" />
              <span>تراجع</span>
            </button>
          </div>
        </div>
      )}

      {/* Per-Photo Full-Screen Detail View */}
      {(activePhoto || showAllCompletedScreen) && (
        <PhotoDetailView
          photo={activePhoto}
          unfinishedPosition={unfinishedPosition}
          totalUnfinished={unfinishedPhotoQueue.length}
          showAllCompleted={showAllCompletedScreen}
          onCompletePhoto={handleCompleteActivePhoto}
          onSkipPhoto={handleSkipActivePhoto}
          onRotatePhoto={handleRotateActivePhoto}
          onReEnhancePhoto={handleReEnhanceActivePhoto}
          onRestoreOriginalPhoto={handleRestoreOriginalActivePhoto}
          onClose={() => {
            setActivePhotoId(null);
            setShowAllCompletedScreen(false);
          }}
        />
      )}
    </div>
  );
};
