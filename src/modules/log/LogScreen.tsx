import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  Check,
  CheckCircle2,
  CheckSquare,
  Clock,
  Loader2,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import {
  KnownProduct,
  ManualProductMark,
  NormalizedBox,
  Shelf,
  ShelfPhoto,
  ShortageItem,
} from '../../types';
import {
  createOrUpdateKnownProduct,
  deleteManualMarkAndReconcile,
  deletePhotoAndShortages,
  deleteShortageById,
  deleteShortagesAndPhotosBulk,
  getAllKnownProducts,
  getAllManualMarks,
  getAllPhotos,
  getAllShelves,
  getAllShortages,
  getProductsForManualPicker,
  markPhotoDoneWithShortages,
  markPhotosAndShortagesDoneBulk,
  recordPullEventsForDate,
  replacePhotoManualMarks,
  replacePhotoShortages,
  restorePhotoAndShortages,
  saveManualMark,
  savePhoto,
  saveShortage,
  setOptionalProductName,
  updateKnownProductLastQuantity,
} from '../db';
import { analysisQueue } from '../analysis/analysisQueue';
import {
  rotateBox90CW,
  sortShortagesRTLTopToBottom,
} from '../analysis/boxMerge';
import {
  cropProductBoxFromDataUrl,
  rotateDataUrl90CW,
} from '../camera/imageCompression';
import {
  formatDayHeading,
  formatTimeArabic,
  getLocalDateKey,
} from '../../utils/arabicText';
import { getShortageColor } from '../../utils/colors';
import { PWAInstallButton } from '../../components/PWAInstallButton';
import { PhotoDetailView } from './PhotoDetailView';

type LogFilter = 'all' | 'unfinished' | 'done';

const ROTATE_HINT_DISMISSED_KEY = 'naqs_alrofoof_rotate_hint_dismissed';

interface LogScreenProps {
  refreshSignal: number;
  aiAnalysisEnabled: boolean;
  isOnline?: boolean;
  focusPhotoId?: string | null;
  onClearFocusPhoto?: () => void;
}

export function isPhotoDone(
  photo: ShelfPhoto,
  photoShortages: ShortageItem[]
): boolean {
  if (photo.done === true) return true;
  if (photo.done === false) return false;
  return (
    photoShortages.length > 0 &&
    photoShortages.every((s) => s.status === 'done')
  );
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
          offsetX !== 0
            ? { transform: `translateX(${offsetX}px)` }
            : undefined
        }
        className="relative transition-transform duration-150"
      >
        {children}
      </div>
    </div>
  );
};

export const LogScreen: React.FC<LogScreenProps> = ({
  refreshSignal,
  aiAnalysisEnabled,
  isOnline = true,
  focusPhotoId,
  onClearFocusPhoto,
}) => {
  const [photos, setPhotos] = useState<ShelfPhoto[]>([]);
  const [shortages, setShortages] = useState<ShortageItem[]>([]);
  const [manualMarks, setManualMarks] = useState<ManualProductMark[]>([]);
  const [knownProducts, setKnownProducts] = useState<KnownProduct[]>([]);
  const [pickerProducts, setPickerProducts] = useState<KnownProduct[]>([]);
  const [shelves, setShelves] = useState<Shelf[]>([]);
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
  const [undoDeleted, setUndoDeleted] = useState<{
    photo: ShelfPhoto;
    shortages: ShortageItem[];
    manualMarks: ManualProductMark[];
  } | null>(null);
  const undoTimerRef = useRef<number | null>(null);

  // Bulk selection state
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
    const [
      allPhotos,
      allShortages,
      allManualMarks,
      allProducts,
      allPickerProducts,
      allShelves,
    ] = await Promise.all([
      getAllPhotos(),
      getAllShortages(),
      getAllManualMarks(),
      getAllKnownProducts(),
      getProductsForManualPicker(30),
      getAllShelves(),
    ]);
    setPhotos(allPhotos);
    setShortages(allShortages);
    setManualMarks(allManualMarks);
    setKnownProducts(allProducts);
    setPickerProducts(allPickerProducts);
    setShelves(allShelves);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
    const unsub = analysisQueue.subscribe(() => {
      loadData();
    });
    return unsub;
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
    setShowAllCompletedScreen(false);
    setActivePhotoId(focusPhotoId);
    onClearFocusPhoto?.();
  }, [focusPhotoId, loading, onClearFocusPhoto]);

  const productLookup = useMemo(() => {
    const map = new Map<string, KnownProduct>();
    for (const kp of knownProducts) {
      map.set(kp.id, kp);
    }
    return map;
  }, [knownProducts]);

  const shelfLookup = useMemo(() => {
    const map = new Map<string, Shelf>();
    for (const sh of shelves) {
      map.set(sh.id, sh);
    }
    return map;
  }, [shelves]);

  const shortagesByPhoto = useMemo(() => {
    const map = new Map<string, ShortageItem[]>();
    for (const s of shortages) {
      const list = map.get(s.photoId) || [];
      list.push(s);
      map.set(s.photoId, list);
    }
    for (const [, list] of map) {
      list.sort((a, b) => a.colorIndex - b.colorIndex);
    }
    return map;
  }, [shortages]);

  const manualMarksByPhoto = useMemo(() => {
    const map = new Map<string, ManualProductMark[]>();
    for (const m of manualMarks) {
      const list = map.get(m.photoId) || [];
      list.push(m);
      map.set(m.photoId, list);
    }
    for (const [, list] of map) {
      list.sort((a, b) => a.markNumber - b.markNumber || a.timestamp - b.timestamp);
    }
    return map;
  }, [manualMarks]);

  // Group photos by day (newest first). Within each day: unfinished first (newest first), done at the bottom (newest first).
  const groupedDays = useMemo(() => {
    const dayMap = new Map<
      string,
      Array<{
        photo: ShelfPhoto;
        shelfLabel: string;
        photoShortages: ShortageItem[];
        photoManualMarks: ManualProductMark[];
        isDone: boolean;
      }>
    >();

    for (const photo of photos) {
      const photoShortages = shortagesByPhoto.get(photo.id) || [];
      const photoManualMarks = manualMarksByPhoto.get(photo.id) || [];
      const done = isPhotoDone(photo, photoShortages);

      if (filter === 'unfinished' && done) continue;
      if (filter === 'done' && !done) continue;

      const shelfLabel = photo.shelfId
        ? shelfLookup.get(photo.shelfId)?.label || ''
        : '';

      const dayEntries = dayMap.get(photo.dateKey) || [];
      dayEntries.push({
        photo,
        shelfLabel,
        photoShortages,
        photoManualMarks,
        isDone: done,
      });
      dayMap.set(photo.dateKey, dayEntries);
    }

    return Array.from(dayMap.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([dateKey, entries]) => ({
        dateKey,
        entries: entries.sort((a, b) => {
          if (a.isDone !== b.isDone) {
            return a.isDone ? 1 : -1;
          }
          return b.photo.timestamp - a.photo.timestamp;
        }),
      }));
  }, [photos, shortagesByPhoto, manualMarksByPhoto, filter, shelfLookup]);

  // Ordered queue of unfinished photos matching the Log list order (days newest first, photos newest first)
  const unfinishedPhotoQueue = useMemo(() => {
    return photos
      .filter((p) => !isPhotoDone(p, shortagesByPhoto.get(p.id) || []))
      .sort(
        (a, b) =>
          b.dateKey.localeCompare(a.dateKey) || b.timestamp - a.timestamp
      );
  }, [photos, shortagesByPhoto]);

  const visiblePhotoIds = useMemo(() => {
    const ids: string[] = [];
    for (const day of groupedDays) {
      for (const entry of day.entries) {
        ids.push(entry.photo.id);
      }
    }
    return ids;
  }, [groupedDays]);

  const hasVisiblePhotos = visiblePhotoIds.length > 0;
  const isAllVisibleSelected =
    hasVisiblePhotos && visiblePhotoIds.every((id) => selectedPhotoIds.has(id));

  const handleToggleSelectAll = () => {
    if (!hasVisiblePhotos) return;
    if (selectionMode && isAllVisibleSelected) {
      setSelectionMode(false);
      setSelectedPhotoIds(new Set());
    } else {
      setSelectionMode(true);
      setSelectedPhotoIds(new Set(visiblePhotoIds));
    }
  };

  const handleCancelSelection = () => {
    setSelectionMode(false);
    setSelectedPhotoIds(new Set());
  };

  const togglePhotoSelection = (photoId: string) => {
    setSelectedPhotoIds((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  };

  const handleBulkComplete = async () => {
    const selectedPhotos = photos.filter((p) => selectedPhotoIds.has(p.id));
    const shortagesToDone = shortages.filter(
      (s) => selectedPhotoIds.has(s.photoId) && s.status !== 'done'
    );
    await markPhotosAndShortagesDoneBulk(selectedPhotos, shortagesToDone);
    handleCancelSelection();
    analysisQueue.notify();
    await loadData();
  };

  const handleBulkDelete = async () => {
    await deleteShortagesAndPhotosBulk([], Array.from(selectedPhotoIds));
    handleCancelSelection();
    analysisQueue.notify();
    await loadData();
  };

  const handleDeletePhotoWithUndo = async (
    photo: ShelfPhoto,
    photoShortages: ShortageItem[],
    photoManualMarks: ManualProductMark[]
  ) => {
    await deletePhotoAndShortages(photo.id);
    setUndoDeleted({
      photo,
      shortages: photoShortages,
      manualMarks: photoManualMarks,
    });
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
    }
    undoTimerRef.current = window.setTimeout(() => {
      setUndoDeleted(null);
    }, 5500);
    analysisQueue.notify();
    await loadData();
  };

  const handleUndoDelete = async () => {
    if (!undoDeleted) return;
    const snapshot = undoDeleted;
    setUndoDeleted(null);
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
    }
    await restorePhotoAndShortages(
      snapshot.photo,
      snapshot.shortages,
      snapshot.manualMarks
    );
    analysisQueue.notify();
    await loadData();
  };

  // Active Photo View data
  const activePhoto = activePhotoId
    ? photos.find((p) => p.id === activePhotoId) || null
    : null;
  const activePhotoShortages = activePhoto
    ? shortagesByPhoto.get(activePhoto.id) || []
    : [];
  const activePhotoManualMarks = activePhoto
    ? manualMarksByPhoto.get(activePhoto.id) || []
    : [];
  const activeShelfLabel = activePhoto?.shelfId
    ? shelfLookup.get(activePhoto.shelfId)?.label || ''
    : '';

  const unfinishedPosition = useMemo(() => {
    if (!activePhoto) return null;
    const idx = unfinishedPhotoQueue.findIndex((p) => p.id === activePhoto.id);
    return idx >= 0 ? idx + 1 : null;
  }, [activePhoto, unfinishedPhotoQueue]);

  // Same-day duplicates logged earlier today in OTHER photos
  const duplicateProductIdsToday = useMemo(() => {
    const set = new Set<string>();
    if (!activePhoto) return set;
    for (const s of shortages) {
      if (
        s.photoId !== activePhoto.id &&
        s.dateKey === activePhoto.dateKey &&
        (s.timestamp < activePhoto.timestamp || s.status === 'done')
      ) {
        set.add(s.productId);
      }
    }
    for (const m of manualMarks) {
      if (
        m.photoId !== activePhoto.id &&
        m.dateKey === activePhoto.dateKey &&
        m.timestamp < activePhoto.timestamp
      ) {
        set.add(m.productId);
      }
    }
    return set;
  }, [activePhoto, shortages, manualMarks]);

  const handleCompleteActivePhoto = async (
    quantitiesByShortageId: Record<string, number>
  ) => {
    if (!activePhoto) return;

    // Immediately advance to the next unfinished photo in list order (newest first), or show completion screen
    const curIdx = unfinishedPhotoQueue.findIndex(
      (p) => p.id === activePhoto.id
    );
    const remaining = unfinishedPhotoQueue.filter(
      (p) => p.id !== activePhoto.id
    );

    if (remaining.length === 0) {
      setActivePhotoId(null);
      setShowAllCompletedScreen(true);
    } else {
      const next =
        curIdx >= 0 && curIdx < remaining.length
          ? remaining[curIdx]
          : remaining[0];
      setActivePhotoId(next.id);
    }

    const updatedShortages = activePhotoShortages.map((s) => ({
      ...s,
      quantity: Math.max(
        1,
        quantitiesByShortageId[s.id] ?? s.quantity ?? s.estimatedMissing ?? 1
      ),
    }));

    await markPhotoDoneWithShortages(activePhoto, updatedShortages);
    analysisQueue.notify();
    await loadData();
  };

  const handleSkipActivePhoto = () => {
    if (!activePhoto) {
      setActivePhotoId(null);
      setShowAllCompletedScreen(false);
      return;
    }
    if (unfinishedPhotoQueue.length <= 1) {
      if (
        unfinishedPhotoQueue.length === 1 &&
        unfinishedPhotoQueue[0].id !== activePhoto.id
      ) {
        setActivePhotoId(unfinishedPhotoQueue[0].id);
        return;
      }
      setActivePhotoId(null);
      setShowAllCompletedScreen(false);
      return;
    }
    const curIdx = unfinishedPhotoQueue.findIndex(
      (p) => p.id === activePhoto.id
    );
    const nextIdx =
      curIdx >= 0 ? (curIdx + 1) % unfinishedPhotoQueue.length : 0;
    setActivePhotoId(unfinishedPhotoQueue[nextIdx].id);
  };

  const handleUpdateShortageQuantity = async (
    shortageId: string,
    qty: number
  ) => {
    const target = shortages.find((s) => s.id === shortageId);
    if (!target) return;
    const clamped = Math.max(1, Math.min(999, qty));
    await saveShortage({
      ...target,
      quantity: clamped,
      updatedAt: Date.now(),
    });
    if (target.productId) {
      await updateKnownProductLastQuantity(target.productId, clamped);
    }
    analysisQueue.notify();
    await loadData();
  };

  const handleUpdateGapBox = async (
    shortageId: string,
    nextGapBox: NormalizedBox
  ) => {
    const target = shortages.find((s) => s.id === shortageId);
    if (!target) return;
    await saveShortage({
      ...target,
      gapBox: nextGapBox,
      updatedAt: Date.now(),
    });
    analysisQueue.notify();
    await loadData();
  };

  const handleDeleteShortageInPhoto = async (shortageId: string) => {
    await deleteShortageById(shortageId);
    const remaining = activePhotoShortages
      .filter((s) => s.id !== shortageId)
      .sort((a, b) => a.colorIndex - b.colorIndex);
    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i].colorIndex !== i) {
        await saveShortage({ ...remaining[i], colorIndex: i });
      }
    }
    analysisQueue.notify();
    await loadData();
  };

  const handleAddManualShortageInPhoto = async (
    gapBox: NormalizedBox
  ): Promise<string | null> => {
    if (!activePhoto) return null;
    const thumb = activePhoto.dataUrl
      ? await cropProductBoxFromDataUrl(activePhoto.dataUrl, gapBox, gapBox, 256)
      : '';

    const product = await createOrUpdateKnownProduct({
      productDescription: 'Manual shelf shortage area',
      thumbnailDataUrl: thumb,
    });

    const newItem: ShortageItem = {
      id: `sh_m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      photoId: activePhoto.id,
      shelfId: activePhoto.shelfId,
      dateKey: activePhoto.dateKey,
      timestamp: Date.now(),
      productId: product.id,
      productName: '',
      productDescription: 'Manual shelf shortage area',
      gapBox,
      productBox: gapBox,
      estimatedMissing: 1,
      quantity: 1,
      status: 'new',
      colorIndex: activePhotoShortages.length,
      confidence: 1,
      source: 'manual',
      updatedAt: Date.now(),
    };

    const reordered = sortShortagesRTLTopToBottom([
      ...activePhotoShortages,
      newItem,
    ]);
    for (let i = 0; i < reordered.length; i++) {
      await saveShortage({ ...reordered[i], colorIndex: i });
    }
    if (activePhoto.done) {
      await savePhoto({ ...activePhoto, done: false });
    }
    analysisQueue.notify();
    await loadData();
    return newItem.id;
  };

  const handleRotateActivePhoto = async () => {
    if (!activePhoto || !activePhoto.dataUrl) return;
    const rotated = await rotateDataUrl90CW(activePhoto.dataUrl, 2048, 0.9);
    await savePhoto({
      ...activePhoto,
      dataUrl: rotated.dataUrl,
      width: rotated.width,
      height: rotated.height,
    });

    if (activePhotoShortages.length > 0) {
      const now = Date.now();
      const rotatedItems = sortShortagesRTLTopToBottom(
        activePhotoShortages.map((s) => ({
          ...s,
          gapBox: rotateBox90CW(s.gapBox),
          productBox: s.productBox ? rotateBox90CW(s.productBox) : s.productBox,
          updatedAt: now,
        }))
      ).map((s, idx) => ({
        ...s,
        colorIndex: idx,
      }));
      await replacePhotoShortages(activePhoto.id, rotatedItems);
    }

    if (activePhotoManualMarks.length > 0) {
      const now = Date.now();
      const rotatedMarks = activePhotoManualMarks.map((m) => ({
        ...m,
        box: rotateBox90CW(m.box),
        updatedAt: now,
      }));
      await replacePhotoManualMarks(activePhoto.id, rotatedMarks);
    }

    analysisQueue.notify();
    await loadData();
  };

  const handleAddManualMark = async (
    box: NormalizedBox,
    existingProductId?: string
  ) => {
    if (!activePhoto) return;
    const todayKey = getLocalDateKey(Date.now());
    let productId = existingProductId || '';

    if (!productId) {
      const thumb = activePhoto.dataUrl
        ? await cropProductBoxFromDataUrl(activePhoto.dataUrl, box, box, 256)
        : '';
      const product = await createOrUpdateKnownProduct({
        productDescription: 'Manual marked product',
        thumbnailDataUrl: thumb,
      });
      productId = product.id;
    }

    await recordPullEventsForDate(todayKey, [productId]);

    const mark: ManualProductMark = {
      id: `mm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      photoId: activePhoto.id,
      dateKey: todayKey,
      timestamp: Date.now(),
      productId,
      box,
      markNumber: activePhotoManualMarks.length + 1,
      updatedAt: Date.now(),
    };

    await saveManualMark(mark);
    analysisQueue.notify();
    await loadData();
  };

  const handleDeleteManualMark = async (markId: string) => {
    await deleteManualMarkAndReconcile(markId);
    analysisQueue.notify();
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
              {aiAnalysisEnabled
                ? 'التقط صوراً للأرفف من تبويب التصوير ليتم تحديد أماكن النقص تلقائياً.'
                : 'التقط صوراً للأرفف من تبويب التصوير لتسجيلها وتحديد المنتجات يدوياً.'}
            </p>
          </div>
        ) : (
          groupedDays.map((day) => (
            <section key={day.dateKey} className="space-y-3">
              <h2 className="text-base font-extrabold text-slate-800 dark:text-slate-100 px-1">
                {formatDayHeading(day.dateKey)}
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {day.entries.map(
                  ({
                    photo,
                    shelfLabel,
                    photoShortages,
                    photoManualMarks,
                    isDone,
                  }) => {
                    const isSelected = selectedPhotoIds.has(photo.id);
                    const showAiShortages = aiAnalysisEnabled && photoShortages.length > 0;
                    const showManualMarks = photoManualMarks.length > 0;
                    return (
                      <SwipeablePhotoCard
                        key={photo.id}
                        disabled={selectionMode}
                        onSwipeDelete={() =>
                          handleDeletePhotoWithUndo(
                            photo,
                            photoShortages,
                            photoManualMarks
                          )
                        }
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
                          {/* Full-width Photo Thumbnail (aspect ratio preserved) */}
                          <div
                            className={`relative w-full bg-slate-950/5 dark:bg-slate-950 ${
                              isDone ? 'grayscale' : ''
                            }`}
                          >
                            {photo.dataUrl ? (
                              <img
                                src={photo.dataUrl}
                                alt={shelfLabel || 'صورة الرف'}
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

                          {/* Card Info: Shelf Name (if any) + Chip (جديد / تم) + Small Product Pictures */}
                          <div className="p-3 space-y-2.5">
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0 flex items-center flex-wrap gap-x-2 gap-y-1">
                                {shelfLabel && (
                                  <span
                                    className={`text-sm font-extrabold truncate ${
                                      isDone
                                        ? 'text-slate-500 dark:text-slate-400'
                                        : 'text-slate-900 dark:text-white'
                                    }`}
                                  >
                                    {shelfLabel}
                                  </span>
                                )}
                                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 tabular-nums">
                                  {formatTimeArabic(photo.timestamp)}
                                </span>

                                {aiAnalysisEnabled && photo.status === 'pending' && (
                                  <span className="text-amber-600 dark:text-amber-400 inline-flex items-center gap-1 text-xs font-bold">
                                    <Clock className="w-3.5 h-3.5" />
                                    {isOnline ? 'في الانتظار' : 'محفوظة محلياً'}
                                  </span>
                                )}
                                {aiAnalysisEnabled && photo.status === 'analyzing' && (
                                  <span className="text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1 text-xs font-bold">
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    جاري التحليل
                                  </span>
                                )}
                                {aiAnalysisEnabled &&
                                  (photo.status === 'error' ||
                                    photo.status === 'poor_quality') && (
                                    <span className="text-red-600 dark:text-red-400 inline-flex items-center gap-1 text-xs font-bold">
                                      <AlertTriangle className="w-3.5 h-3.5" />
                                      تعذر التحليل
                                    </span>
                                  )}
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                {!selectionMode &&
                                  aiAnalysisEnabled &&
                                  (photo.status === 'error' ||
                                    photo.status === 'poor_quality') && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        analysisQueue.retryPhoto(photo.id);
                                      }}
                                      className="min-w-[40px] min-h-[40px] rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 flex items-center justify-center"
                                      aria-label="إعادة التحليل"
                                    >
                                      <RotateCcw className="w-4 h-4" />
                                    </button>
                                  )}

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
                                      handleDeletePhotoWithUndo(
                                        photo,
                                        photoShortages,
                                        photoManualMarks
                                      );
                                    }}
                                    className="min-w-[40px] min-h-[40px] rounded-xl text-slate-400 hover:text-red-500 flex items-center justify-center"
                                    aria-label="حذف الصورة"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Small Product Pictures of This Photo's Shortages and Manual Marks */}
                            {(showAiShortages || showManualMarks) && (
                              <div
                                className={`flex flex-wrap items-center gap-1.5 ${
                                  isDone ? 'grayscale' : ''
                                }`}
                              >
                                {showAiShortages &&
                                  photoShortages.map((s) => {
                                    const known = productLookup.get(s.productId);
                                    const thumb = known?.thumbnailDataUrl || '';
                                    const color = getShortageColor(s.colorIndex);
                                    return (
                                      <div
                                        key={s.id}
                                        className="relative w-11 h-11 rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800 border border-slate-200/70 dark:border-slate-700/70 shrink-0"
                                      >
                                        {thumb ? (
                                          <img
                                            src={thumb}
                                            alt={
                                              known?.productName ||
                                              s.productName ||
                                              'المنتج'
                                            }
                                            className="w-full h-full object-cover"
                                          />
                                        ) : (
                                          <div className="w-full h-full flex items-center justify-center text-emerald-500">
                                            <Sparkles className="w-4 h-4" />
                                          </div>
                                        )}
                                        <span
                                          style={{
                                            backgroundColor: isDone
                                              ? '#94A3B8'
                                              : color.hex,
                                          }}
                                          className="absolute top-0.5 right-0.5 min-w-[16px] h-[16px] px-0.5 rounded-full text-white text-[10px] font-extrabold flex items-center justify-center tabular-nums"
                                        >
                                          {s.colorIndex + 1}
                                        </span>
                                      </div>
                                    );
                                  })}

                                {showManualMarks &&
                                  photoManualMarks.map((m) => {
                                    const known = productLookup.get(m.productId);
                                    const thumb = known?.thumbnailDataUrl || '';
                                    return (
                                      <div
                                        key={m.id}
                                        className="relative w-11 h-11 rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800 border border-sky-400/70 dark:border-sky-500/60 shrink-0"
                                      >
                                        {thumb ? (
                                          <img
                                            src={thumb}
                                            alt={known?.productName || 'منتج محدد'}
                                            className="w-full h-full object-cover"
                                          />
                                        ) : (
                                          <div className="w-full h-full flex items-center justify-center text-sky-500">
                                            <Camera className="w-4 h-4" />
                                          </div>
                                        )}
                                        <span
                                          className={`absolute top-0.5 right-0.5 min-w-[16px] h-[16px] px-0.5 rounded-full text-white text-[10px] font-extrabold flex items-center justify-center tabular-nums ${
                                            isDone ? 'bg-slate-400' : 'bg-sky-500'
                                          }`}
                                        >
                                          {m.markNumber}
                                        </span>
                                      </div>
                                    );
                                  })}
                              </div>
                            )}
                          </div>
                        </div>
                      </SwipeablePhotoCard>
                    );
                  }
                )}
              </div>
            </section>
          ))
        )}
      </main>

      {/* Bulk Selection Action Bar (fixed above BottomNav) */}
      {selectionMode && selectedPhotoIds.size > 0 && (
        <div className="fixed bottom-[68px] inset-x-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200/80 dark:border-slate-800 px-4 py-2.5 shadow-lg">
          <div className="max-w-3xl mx-auto flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleBulkComplete}
              className="min-h-[52px] flex-1 rounded-2xl bg-emerald-500 text-white font-extrabold text-sm flex items-center justify-center gap-2 active:scale-95 transition"
            >
              <Check className="w-5 h-5" />
              <span>تم الإكمال</span>
            </button>
            <button
              type="button"
              onClick={handleBulkDelete}
              className="min-h-[52px] flex-1 rounded-2xl bg-red-500/15 text-red-600 dark:text-red-400 font-extrabold text-sm flex items-center justify-center gap-2 active:scale-95 transition"
            >
              <Trash2 className="w-5 h-5" />
              <span>حذف المحدد</span>
            </button>
          </div>
        </div>
      )}

      {/* Undo Swipe Delete Toast */}
      {undoDeleted && (
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
          shelfLabel={activeShelfLabel}
          aiAnalysisEnabled={aiAnalysisEnabled}
          isOnline={isOnline}
          shortages={activePhotoShortages}
          manualMarks={activePhotoManualMarks}
          pickerProducts={pickerProducts}
          productLookup={productLookup}
          duplicateProductIdsToday={duplicateProductIdsToday}
          unfinishedPosition={unfinishedPosition}
          totalUnfinished={unfinishedPhotoQueue.length}
          showAllCompleted={showAllCompletedScreen}
          onCompletePhoto={handleCompleteActivePhoto}
          onSkipPhoto={handleSkipActivePhoto}
          onRotatePhoto={handleRotateActivePhoto}
          onUpdateQuantity={handleUpdateShortageQuantity}
          onUpdateGapBox={handleUpdateGapBox}
          onDeleteShortage={handleDeleteShortageInPhoto}
          onAddManualShortage={handleAddManualShortageInPhoto}
          onAddManualMark={handleAddManualMark}
          onDeleteManualMark={handleDeleteManualMark}
          onSaveOptionalName={async (productId, name) => {
            await setOptionalProductName(productId, name);
            analysisQueue.notify();
            await loadData();
          }}
          onRetryAnalyze={
            activePhoto && aiAnalysisEnabled
              ? async () => {
                  await analysisQueue.retryPhoto(activePhoto.id);
                  await loadData();
                }
              : undefined
          }
          onClose={() => {
            setActivePhotoId(null);
            setShowAllCompletedScreen(false);
          }}
        />
      )}
    </div>
  );
};
