import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  CheckCircle2,
  List,
  Loader2,
  Minus,
  Plus,
  RotateCcw,
  RotateCw,
  SkipForward,
  Sparkles,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import {
  KnownProduct,
  ManualProductMark,
  NormalizedBox,
  ShelfPhoto,
  ShortageItem,
} from '../../types';
import { getShortageColor } from '../../utils/colors';

type DragMode =
  | {
      type: 'move';
      id: string;
      startX: number;
      startY: number;
      orig: NormalizedBox;
      moved: boolean;
    }
  | {
      type: 'resize';
      id: string;
      corner: 'nw' | 'ne' | 'sw' | 'se';
      startX: number;
      startY: number;
      orig: NormalizedBox;
      moved: boolean;
    }
  | { type: 'draw'; startNormX: number; startNormY: number }
  | { type: 'drawMark'; startNormX: number; startNormY: number }
  | {
      type: 'moveMarkDraft';
      startX: number;
      startY: number;
      orig: NormalizedBox;
    }
  | {
      type: 'resizeMarkDraft';
      corner: 'nw' | 'ne' | 'sw' | 'se';
      startX: number;
      startY: number;
      orig: NormalizedBox;
    }
  | {
      type: 'pan';
      startClientX: number;
      startClientY: number;
      origPanX: number;
      origPanY: number;
      moved: boolean;
    };

interface PhotoDetailViewProps {
  photo: ShelfPhoto | null;
  shelfLabel?: string;
  aiAnalysisEnabled: boolean;
  isOnline?: boolean;
  shortages: ShortageItem[];
  manualMarks: ManualProductMark[];
  pickerProducts: KnownProduct[];
  productLookup: Map<string, KnownProduct>;
  duplicateProductIdsToday: Set<string>;
  unfinishedPosition: number | null; // 1-based index among unfinished photos, null if already done
  totalUnfinished: number;
  showAllCompleted: boolean;
  onCompletePhoto: (quantitiesByShortageId: Record<string, number>) => Promise<void>;
  onSkipPhoto: () => void;
  onRotatePhoto: () => Promise<void>;
  onUpdateQuantity: (shortageId: string, qty: number) => Promise<void>;
  onUpdateGapBox: (shortageId: string, nextGapBox: NormalizedBox) => Promise<void>;
  onDeleteShortage: (shortageId: string) => Promise<void>;
  onAddManualShortage: (gapBox: NormalizedBox) => Promise<string | null>;
  onAddManualMark: (
    box: NormalizedBox,
    existingProductId?: string
  ) => Promise<void>;
  onDeleteManualMark: (markId: string) => Promise<void>;
  onSaveOptionalName: (productId: string, name: string) => Promise<void>;
  onRetryAnalyze?: () => Promise<void>;
  onClose: () => void;
}

export const PhotoDetailView: React.FC<PhotoDetailViewProps> = ({
  photo,
  shelfLabel,
  aiAnalysisEnabled,
  isOnline = true,
  shortages,
  manualMarks,
  pickerProducts,
  productLookup,
  duplicateProductIdsToday,
  unfinishedPosition,
  totalUnfinished,
  showAllCompleted,
  onCompletePhoto,
  onSkipPhoto,
  onRotatePhoto,
  onUpdateQuantity,
  onUpdateGapBox,
  onDeleteShortage,
  onAddManualShortage,
  onAddManualMark,
  onDeleteManualMark,
  onSaveOptionalName,
  onRetryAnalyze,
  onClose,
}) => {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const imageStageRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);
  const singleTapTimerRef = useRef<number | null>(null);
  const emptyPointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressOriginRef = useRef<{ x: number; y: number } | null>(null);
  const pinchStartDistRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef<number>(1);
  const dirtyQtyAtRef = useRef<Record<string, number>>({});

  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });

  const [selectedShortageId, setSelectedShortageId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [showFloatingControls, setShowFloatingControls] = useState(true);
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  // Shortage draw mode (AI mode only)
  const [addMode, setAddMode] = useState(false);
  const [draftBox, setDraftBox] = useState<NormalizedBox | null>(null);

  // Manual product marking mode ("حدد منتجاً" - works in both AI ON & OFF modes)
  const [markMode, setMarkMode] = useState(false);
  const [markDraftBox, setMarkDraftBox] = useState<NormalizedBox | null>(null);
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [isSavingMark, setIsSavingMark] = useState(false);
  const [markToDelete, setMarkToDelete] = useState<ManualProductMark | null>(null);
  const [isDeletingMark, setIsDeletingMark] = useState(false);

  const [liveBox, setLiveBox] = useState<{ id: string; box: NormalizedBox } | null>(
    null
  );
  const [dragState, setDragState] = useState<DragMode | null>(null);
  const [isCompleting, setIsCompleting] = useState(false);
  const [isRotating, setIsRotating] = useState(false);

  // Optimistic per-shortage quantities seeded from AI estimate / saved quantity
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  // Optional naming modal (on tapping product thumbnail)
  const [namingTarget, setNamingTarget] = useState<{
    productId: string;
    thumb?: string;
    currentName: string;
  } | null>(null);
  const [optionalNameValue, setOptionalNameValue] = useState('');

  const clearLongPress = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressOriginRef.current = null;
  };

  // Observe full-screen photo stage container dimensions for exact edge-to-edge contain sizing
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      setViewportSize((prev) =>
        prev.width === Math.round(rect.width) &&
        prev.height === Math.round(rect.height)
          ? prev
          : { width: Math.round(rect.width), height: Math.round(rect.height) }
      );
    };

    updateSize();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(updateSize);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, [showAllCompleted, photo?.id]);

  // Reset state whenever navigating to a different photo
  useEffect(() => {
    clearLongPress();
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setAddMode(false);
    setMarkMode(false);
    setMarkDraftBox(null);
    setShowProductPicker(false);
    setMarkToDelete(null);
    setIsSheetOpen(false);
    setShowFloatingControls(true);
    setDraftBox(null);
    setLiveBox(null);
    setDragState(null);
    setSelectedShortageId(aiAnalysisEnabled ? shortages[0]?.id ?? null : null);
    setNamingTarget(null);
    dirtyQtyAtRef.current = {};
    if (photo?.width && photo?.height) {
      setNaturalSize({ width: photo.width, height: photo.height });
    } else {
      setNaturalSize({ width: 0, height: 0 });
    }
  }, [photo?.id]);

  useEffect(() => {
    if (!aiAnalysisEnabled) {
      setAddMode(false);
      setDraftBox(null);
      setSelectedShortageId(null);
    }
  }, [aiAnalysisEnabled]);

  useEffect(() => {
    return () => {
      clearLongPress();
      if (singleTapTimerRef.current !== null) {
        window.clearTimeout(singleTapTimerRef.current);
      }
    };
  }, []);

  // Keep selected shortage valid as shortages list updates
  useEffect(() => {
    if (!aiAnalysisEnabled || shortages.length === 0) {
      setSelectedShortageId(null);
      return;
    }
    if (!selectedShortageId || !shortages.some((s) => s.id === selectedShortageId)) {
      setSelectedShortageId(shortages[0].id);
    }
  }, [aiAnalysisEnabled, shortages, selectedShortageId]);

  // Seed / sync local quantities from stored shortages without clobbering active rapid taps
  useEffect(() => {
    const now = Date.now();
    setQuantities((prev) => {
      const next: Record<string, number> = {};
      for (const s of shortages) {
        const stored =
          s.quantity > 0 ? s.quantity : Math.max(1, s.estimatedMissing || 1);
        const touchedRecently = now - (dirtyQtyAtRef.current[s.id] || 0) < 1200;
        next[s.id] =
          touchedRecently && prev[s.id] !== undefined ? prev[s.id] : stored;
      }
      return next;
    });
  }, [photo?.id, shortages]);

  const scrollToRow = (shortageId: string) => {
    requestAnimationFrame(() => {
      const el = rowRefs.current.get(shortageId);
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  };

  useEffect(() => {
    if (isSheetOpen && selectedShortageId && aiAnalysisEnabled) {
      scrollToRow(selectedShortageId);
    }
  }, [isSheetOpen, selectedShortageId, aiAnalysisEnabled]);

  const getNormalizedCoords = (clientX: number, clientY: number) => {
    const el = imageStageRef.current;
    if (!el) return { nx: 0.5, ny: 0.5 };
    const rect = el.getBoundingClientRect();
    const nx = Math.max(
      0,
      Math.min(1, (clientX - rect.left) / Math.max(1, rect.width))
    );
    const ny = Math.max(
      0,
      Math.min(1, (clientY - rect.top) / Math.max(1, rect.height))
    );
    return { nx, ny };
  };

  const handleViewportTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      clearLongPress();
      if (singleTapTimerRef.current !== null) {
        window.clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      emptyPointerDownRef.current = null;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStartDistRef.current = Math.hypot(dx, dy);
      pinchStartZoomRef.current = zoom;
      setDragState(null);
      setLiveBox(null);
    }
  };

  const handleViewportTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchStartDistRef.current !== null) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      if (pinchStartDistRef.current > 10) {
        const nextZoom = Math.max(
          1,
          Math.min(4, pinchStartZoomRef.current * (dist / pinchStartDistRef.current))
        );
        setZoom(Math.round(nextZoom * 100) / 100);
        if (nextZoom <= 1.02) {
          setPan({ x: 0, y: 0 });
        }
      }
    }
  };

  const handleViewportTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length < 2) {
      pinchStartDistRef.current = null;
    }
  };

  const handleEmptyTap = (clientX: number, clientY: number) => {
    if (addMode || markMode) return;
    const now = Date.now();
    const prev = lastTapRef.current;

    if (
      prev &&
      now - prev.time < 280 &&
      Math.hypot(clientX - prev.x, clientY - prev.y) < 32
    ) {
      if (singleTapTimerRef.current !== null) {
        window.clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      lastTapRef.current = null;
      setZoom(1);
      setPan({ x: 0, y: 0 });
      return;
    }

    lastTapRef.current = { time: now, x: clientX, y: clientY };
    if (singleTapTimerRef.current !== null) {
      window.clearTimeout(singleTapTimerRef.current);
    }
    singleTapTimerRef.current = window.setTimeout(() => {
      setShowFloatingControls((v) => !v);
      singleTapTimerRef.current = null;
    }, 220);
  };

  const handleViewportPointerDown = (e: React.PointerEvent) => {
    if (
      pinchStartDistRef.current !== null ||
      isSheetOpen ||
      showProductPicker ||
      markToDelete
    ) {
      return;
    }

    if (markMode) {
      if (!imageStageRef.current) return;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      const { nx, ny } = getNormalizedCoords(e.clientX, e.clientY);
      setDragState({ type: 'drawMark', startNormX: nx, startNormY: ny });
      setMarkDraftBox({ x: nx, y: ny, w: 0.04, h: 0.04 });
      return;
    }

    if (addMode && aiAnalysisEnabled) {
      if (!imageStageRef.current) return;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      const { nx, ny } = getNormalizedCoords(e.clientX, e.clientY);
      setDragState({ type: 'draw', startNormX: nx, startNormY: ny });
      setDraftBox({ x: nx, y: ny, w: 0.04, h: 0.04 });
      return;
    }

    if (zoom > 1.05) {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setDragState({
        type: 'pan',
        startClientX: e.clientX,
        startClientY: e.clientY,
        origPanX: pan.x,
        origPanY: pan.y,
        moved: false,
      });
      return;
    }

    emptyPointerDownRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMarkDraftPointerDown = (e: React.PointerEvent) => {
    if (!markMode || !markDraftBox || pinchStartDistRef.current !== null) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const { nx, ny } = getNormalizedCoords(e.clientX, e.clientY);
    setDragState({
      type: 'moveMarkDraft',
      startX: nx,
      startY: ny,
      orig: { ...markDraftBox },
    });
  };

  const handleMarkDraftCornerPointerDown = (
    e: React.PointerEvent,
    corner: 'nw' | 'ne' | 'sw' | 'se'
  ) => {
    if (!markMode || !markDraftBox || pinchStartDistRef.current !== null) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const { nx, ny } = getNormalizedCoords(e.clientX, e.clientY);
    setDragState({
      type: 'resizeMarkDraft',
      corner,
      startX: nx,
      startY: ny,
      orig: { ...markDraftBox },
    });
  };

  const handleManualMarkPointerDown = (
    e: React.PointerEvent,
    mark: ManualProductMark
  ) => {
    if (
      addMode ||
      markMode ||
      pinchStartDistRef.current !== null ||
      isSheetOpen ||
      showProductPicker
    ) {
      return;
    }
    e.stopPropagation();
    clearLongPress();
    longPressOriginRef.current = { x: e.clientX, y: e.clientY };
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      longPressOriginRef.current = null;
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try {
          navigator.vibrate(35);
        } catch {
          // Ignore vibrate block
        }
      }
      setMarkToDelete(mark);
    }, 520);
  };

  const handleBoxPointerDown = (
    e: React.PointerEvent,
    shortage: ShortageItem
  ) => {
    if (
      !aiAnalysisEnabled ||
      addMode ||
      markMode ||
      pinchStartDistRef.current !== null ||
      isSheetOpen ||
      showProductPicker
    ) {
      return;
    }
    e.stopPropagation();
    emptyPointerDownRef.current = null;
    setSelectedShortageId(shortage.id);
    scrollToRow(shortage.id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const { nx, ny } = getNormalizedCoords(e.clientX, e.clientY);
    setDragState({
      type: 'move',
      id: shortage.id,
      startX: nx,
      startY: ny,
      orig: { ...shortage.gapBox },
      moved: false,
    });
    setLiveBox({ id: shortage.id, box: { ...shortage.gapBox } });
  };

  const handleCornerPointerDown = (
    e: React.PointerEvent,
    shortage: ShortageItem,
    corner: 'nw' | 'ne' | 'sw' | 'se'
  ) => {
    if (
      !aiAnalysisEnabled ||
      addMode ||
      markMode ||
      pinchStartDistRef.current !== null ||
      isSheetOpen ||
      showProductPicker
    ) {
      return;
    }
    e.stopPropagation();
    emptyPointerDownRef.current = null;
    setSelectedShortageId(shortage.id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const { nx, ny } = getNormalizedCoords(e.clientX, e.clientY);
    setDragState({
      type: 'resize',
      id: shortage.id,
      corner,
      startX: nx,
      startY: ny,
      orig: { ...shortage.gapBox },
      moved: false,
    });
    setLiveBox({ id: shortage.id, box: { ...shortage.gapBox } });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (longPressOriginRef.current) {
      const dist = Math.hypot(
        e.clientX - longPressOriginRef.current.x,
        e.clientY - longPressOriginRef.current.y
      );
      if (dist > 10) {
        clearLongPress();
      }
    }

    if (!dragState) {
      if (emptyPointerDownRef.current) {
        const dist = Math.hypot(
          e.clientX - emptyPointerDownRef.current.x,
          e.clientY - emptyPointerDownRef.current.y
        );
        if (dist > 10) {
          emptyPointerDownRef.current = null;
        }
      }
      return;
    }

    if (dragState.type === 'pan') {
      const dx = e.clientX - dragState.startClientX;
      const dy = e.clientY - dragState.startClientY;
      const moved = dragState.moved || Math.hypot(dx, dy) > 4;
      if (moved !== dragState.moved) {
        setDragState({ ...dragState, moved });
      }
      setPan({ x: dragState.origPanX + dx, y: dragState.origPanY + dy });
      return;
    }

    const { nx, ny } = getNormalizedCoords(e.clientX, e.clientY);

    if (dragState.type === 'draw' || dragState.type === 'drawMark') {
      const x0 = Math.min(dragState.startNormX, nx);
      const y0 = Math.min(dragState.startNormY, ny);
      const w = Math.max(0.05, Math.abs(nx - dragState.startNormX));
      const h = Math.max(0.05, Math.abs(ny - dragState.startNormY));
      const nextBox: NormalizedBox = {
        x: Math.min(0.95, x0),
        y: Math.min(0.95, y0),
        w: Math.min(1 - x0, w),
        h: Math.min(1 - y0, h),
      };
      if (dragState.type === 'drawMark') {
        setMarkDraftBox(nextBox);
      } else {
        setDraftBox(nextBox);
      }
      return;
    }

    if (dragState.type === 'moveMarkDraft') {
      const dx = nx - dragState.startX;
      const dy = ny - dragState.startY;
      const nextX = Math.max(
        0,
        Math.min(1 - dragState.orig.w, dragState.orig.x + dx)
      );
      const nextY = Math.max(
        0,
        Math.min(1 - dragState.orig.h, dragState.orig.y + dy)
      );
      setMarkDraftBox({ ...dragState.orig, x: nextX, y: nextY });
      return;
    }

    if (dragState.type === 'resizeMarkDraft') {
      const minSize = 0.05;
      let { x, y, w, h } = dragState.orig;
      const x2 = x + w;
      const y2 = y + h;

      if (dragState.corner.includes('w')) {
        const clampedX = Math.max(0, Math.min(x2 - minSize, nx));
        w = x2 - clampedX;
        x = clampedX;
      }
      if (dragState.corner.includes('e')) {
        w = Math.max(minSize, Math.min(1 - x, nx - x));
      }
      if (dragState.corner.includes('n')) {
        const clampedY = Math.max(0, Math.min(y2 - minSize, ny));
        h = y2 - clampedY;
        y = clampedY;
      }
      if (dragState.corner.includes('s')) {
        h = Math.max(minSize, Math.min(1 - y, ny - y));
      }

      setMarkDraftBox({ x, y, w, h });
      return;
    }

    if (dragState.type === 'move') {
      const dx = nx - dragState.startX;
      const dy = ny - dragState.startY;
      const moved = dragState.moved || Math.hypot(dx, dy) > 0.006;
      if (moved !== dragState.moved) {
        setDragState({ ...dragState, moved });
      }
      const nextX = Math.max(
        0,
        Math.min(1 - dragState.orig.w, dragState.orig.x + dx)
      );
      const nextY = Math.max(
        0,
        Math.min(1 - dragState.orig.h, dragState.orig.y + dy)
      );
      setLiveBox({
        id: dragState.id,
        box: { ...dragState.orig, x: nextX, y: nextY },
      });
      return;
    }

    if (dragState.type === 'resize') {
      const minSize = 0.05;
      let { x, y, w, h } = dragState.orig;
      const x2 = x + w;
      const y2 = y + h;

      if (dragState.corner.includes('w')) {
        const clampedX = Math.max(0, Math.min(x2 - minSize, nx));
        w = x2 - clampedX;
        x = clampedX;
      }
      if (dragState.corner.includes('e')) {
        w = Math.max(minSize, Math.min(1 - x, nx - x));
      }
      if (dragState.corner.includes('n')) {
        const clampedY = Math.max(0, Math.min(y2 - minSize, ny));
        h = y2 - clampedY;
        y = clampedY;
      }
      if (dragState.corner.includes('s')) {
        h = Math.max(minSize, Math.min(1 - y, ny - y));
      }

      if (!dragState.moved) {
        setDragState({ ...dragState, moved: true });
      }
      setLiveBox({ id: dragState.id, box: { x, y, w, h } });
    }
  };

  const handlePointerUp = async (e: React.PointerEvent) => {
    clearLongPress();

    if (!dragState) {
      if (emptyPointerDownRef.current) {
        const down = emptyPointerDownRef.current;
        emptyPointerDownRef.current = null;
        if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < 10) {
          handleEmptyTap(e.clientX, e.clientY);
        }
      }
      return;
    }

    const active = dragState;
    setDragState(null);

    if (active.type === 'pan') {
      if (!active.moved) {
        handleEmptyTap(e.clientX, e.clientY);
      }
      return;
    }

    if (active.type === 'drawMark') {
      return;
    }

    if (active.type === 'moveMarkDraft' || active.type === 'resizeMarkDraft') {
      return;
    }

    if (active.type === 'draw' && draftBox) {
      const finalBox = draftBox;
      setDraftBox(null);
      setAddMode(false);
      if (finalBox.w >= 0.04 && finalBox.h >= 0.04) {
        const createdId = await onAddManualShortage(finalBox);
        if (createdId) {
          setSelectedShortageId(createdId);
          scrollToRow(createdId);
        }
      }
      return;
    }

    if (active.type === 'move' || active.type === 'resize') {
      const currentLive = liveBox;
      setLiveBox(null);
      if (active.moved && currentLive) {
        await onUpdateGapBox(currentLive.id, currentLive.box);
      }
    }
  };

  const handlePickManualProduct = async (existingProductId?: string) => {
    if (!markDraftBox || isSavingMark) return;
    setIsSavingMark(true);
    try {
      await onAddManualMark(markDraftBox, existingProductId);
      setShowProductPicker(false);
      setMarkMode(false);
      setMarkDraftBox(null);
    } finally {
      setIsSavingMark(false);
    }
  };

  const handleConfirmDeleteMark = async () => {
    if (!markToDelete || isDeletingMark) return;
    setIsDeletingMark(true);
    try {
      await onDeleteManualMark(markToDelete.id);
      setMarkToDelete(null);
    } finally {
      setIsDeletingMark(false);
    }
  };

  const handleStepQuantity = (shortage: ShortageItem, delta: number) => {
    const current =
      quantities[shortage.id] ??
      (shortage.quantity > 0
        ? shortage.quantity
        : Math.max(1, shortage.estimatedMissing || 1));
    const next = Math.max(1, Math.min(999, current + delta));
    dirtyQtyAtRef.current[shortage.id] = Date.now();
    setQuantities((prev) => ({ ...prev, [shortage.id]: next }));
    onUpdateQuantity(shortage.id, next);
  };

  const handleQtyInputChange = (shortage: ShortageItem, raw: string) => {
    const parsed = parseInt(raw, 10);
    dirtyQtyAtRef.current[shortage.id] = Date.now();
    if (Number.isNaN(parsed)) {
      setQuantities((prev) => ({ ...prev, [shortage.id]: 1 }));
      return;
    }
    const clamped = Math.max(1, Math.min(999, parsed));
    setQuantities((prev) => ({ ...prev, [shortage.id]: clamped }));
    onUpdateQuantity(shortage.id, clamped);
  };

  const handleCompleteClick = async () => {
    if (isCompleting) return;
    setIsCompleting(true);
    try {
      await onCompletePhoto(quantities);
    } finally {
      setIsCompleting(false);
    }
  };

  const handleRotateClick = async () => {
    if (isRotating || !photo?.dataUrl) return;
    setIsRotating(true);
    try {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      await onRotatePhoto();
    } finally {
      setIsRotating(false);
    }
  };

  // All Unfinished Photos Completed Screen
  if (showAllCompleted || !photo) {
    return (
      <div
        className="fixed inset-0 bottom-[calc(68px+env(safe-area-inset-bottom,0px))] z-30 bg-[#F7F8FA] dark:bg-slate-950 flex flex-col justify-between p-5"
        dir="rtl"
      >
        <div className="flex items-center justify-between pt-safe">
          <button
            type="button"
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center active:scale-95 transition"
            aria-label="إغلاق"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center text-center px-4 max-w-sm mx-auto space-y-5">
          <div className="w-20 h-20 rounded-full bg-emerald-500/15 text-emerald-500 flex items-center justify-center">
            <CheckCircle2 className="w-11 h-11" />
          </div>
          <h2 className="text-2xl font-extrabold text-slate-900 dark:text-white">
            اكتملت جميع الصور
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[54px] w-full px-6 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white font-extrabold text-base shadow-sm active:scale-95 transition"
          >
            العودة للسجل
          </button>
        </div>

        <div className="h-4" />
      </div>
    );
  }

  const visibleShortages = aiAnalysisEnabled ? shortages : [];
  const selectedShortage =
    visibleShortages.find((s) => s.id === selectedShortageId) ||
    visibleShortages[0] ||
    null;

  const listCount = visibleShortages.length + manualMarks.length;

  const natW = naturalSize.width || photo.width || 0;
  const natH = naturalSize.height || photo.height || 0;
  let fittedBoxStyle: React.CSSProperties | undefined;
  if (
    viewportSize.width > 0 &&
    viewportSize.height > 0 &&
    natW > 0 &&
    natH > 0
  ) {
    const fitScale = Math.min(
      viewportSize.width / natW,
      viewportSize.height / natH
    );
    fittedBoxStyle = {
      width: `${Math.max(1, Math.round(natW * fitScale))}px`,
      height: `${Math.max(1, Math.round(natH * fitScale))}px`,
    };
  }

  return (
    <div
      className="fixed inset-0 bottom-[calc(68px+env(safe-area-inset-bottom,0px))] z-30 bg-black flex flex-col overflow-hidden select-none"
      dir="rtl"
    >
      {/* Full-Screen Black Photo Stage (edge-to-edge from under status bar down to bottom bar, object-fit: contain, never cropped) */}
      <div
        ref={viewportRef}
        className="flex-1 min-h-0 relative w-full bg-black overflow-hidden flex items-center justify-center touch-none"
        onTouchStart={handleViewportTouchStart}
        onTouchMove={handleViewportTouchMove}
        onTouchEnd={handleViewportTouchEnd}
        onPointerDown={handleViewportPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {photo.dataUrl ? (
          <div
            ref={imageStageRef}
            style={{
              ...fittedBoxStyle,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: 'center center',
            }}
            className="relative max-w-full max-h-full transition-transform duration-75"
          >
            <img
              src={photo.dataUrl}
              alt={shelfLabel || 'صورة الرف'}
              draggable={false}
              onLoad={(e) => {
                const img = e.currentTarget;
                const nw = img.naturalWidth || photo.width || 0;
                const nh = img.naturalHeight || photo.height || 0;
                if (nw > 0 && nh > 0) {
                  setNaturalSize((prev) =>
                    prev.width === nw && prev.height === nh
                      ? prev
                      : { width: nw, height: nh }
                  );
                }
              }}
              className="w-full h-full object-contain block pointer-events-none select-none"
            />

            {/* Colored Shortage Rectangles (ONLY when AI analysis is ON) */}
            {visibleShortages.map((s) => {
              const box = liveBox && liveBox.id === s.id ? liveBox.box : s.gapBox;
              const color = getShortageColor(s.colorIndex);
              const isSelected = selectedShortage?.id === s.id;
              return (
                <div
                  key={s.id}
                  onPointerDown={(e) => handleBoxPointerDown(e, s)}
                  style={{
                    left: `${box.x * 100}%`,
                    top: `${box.y * 100}%`,
                    width: `${box.w * 100}%`,
                    height: `${box.h * 100}%`,
                    borderColor: color.hex,
                    boxShadow: isSelected
                      ? `0 0 0 3px ${color.hex}75, 0 0 22px ${color.hex}`
                      : undefined,
                    backgroundColor: isSelected
                      ? `${color.hex}26`
                      : `${color.hex}12`,
                  }}
                  className={`absolute border-[3px] rounded-xl cursor-move touch-none ${
                    isSelected ? 'z-20' : 'z-10'
                  }`}
                >
                  <span
                    style={{ backgroundColor: color.hex }}
                    className="absolute -top-3 -right-2 min-w-[22px] h-[22px] px-1 rounded-full text-white text-[11px] font-extrabold flex items-center justify-center shadow tabular-nums"
                  >
                    {s.colorIndex + 1}
                  </span>

                  {/* 4 Corner Resize Handles */}
                  {isSelected && !addMode && !markMode && (
                    <>
                      {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
                        <div
                          key={corner}
                          onPointerDown={(e) =>
                            handleCornerPointerDown(e, s, corner)
                          }
                          style={{ borderColor: color.hex }}
                          className={`absolute w-5 h-5 bg-white border-[3px] rounded-full shadow-md touch-none ${
                            corner === 'nw'
                              ? '-top-2.5 -left-2.5 cursor-nwse-resize'
                              : corner === 'ne'
                              ? '-top-2.5 -right-2.5 cursor-nesw-resize'
                              : corner === 'sw'
                              ? '-bottom-2.5 -left-2.5 cursor-nesw-resize'
                              : '-bottom-2.5 -right-2.5 cursor-nwse-resize'
                          }`}
                        />
                      ))}
                    </>
                  )}
                </div>
              );
            })}

            {/* Manually Marked Product Small Numbered Rectangles (shown in BOTH modes; long-press to delete) */}
            {manualMarks.map((mark, idx) => {
              const displayNumber = mark.markNumber || idx + 1;
              return (
                <div
                  key={mark.id}
                  onPointerDown={(e) => handleManualMarkPointerDown(e, mark)}
                  style={{
                    left: `${mark.box.x * 100}%`,
                    top: `${mark.box.y * 100}%`,
                    width: `${mark.box.w * 100}%`,
                    height: `${mark.box.h * 100}%`,
                  }}
                  className="absolute border-[2.5px] border-sky-400 bg-sky-400/15 rounded-lg z-20 touch-none"
                >
                  <span className="absolute -top-2.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-md bg-sky-500 text-white text-[10px] font-extrabold flex items-center justify-center shadow tabular-nums">
                    {displayNumber}
                  </span>
                </div>
              );
            })}

            {/* AI Shortage Draw Draft Box */}
            {draftBox && (
              <div
                style={{
                  left: `${draftBox.x * 100}%`,
                  top: `${draftBox.y * 100}%`,
                  width: `${draftBox.w * 100}%`,
                  height: `${draftBox.h * 100}%`,
                }}
                className="absolute border-[3px] border-dashed border-emerald-400 bg-emerald-400/20 rounded-xl z-30 pointer-events-none"
              />
            )}

            {/* Manual Product Mark Draft Box (drag & resize before confirming) */}
            {markMode && markDraftBox && (
              <div
                onPointerDown={handleMarkDraftPointerDown}
                style={{
                  left: `${markDraftBox.x * 100}%`,
                  top: `${markDraftBox.y * 100}%`,
                  width: `${markDraftBox.w * 100}%`,
                  height: `${markDraftBox.h * 100}%`,
                }}
                className="absolute border-[3px] border-sky-400 bg-sky-400/20 rounded-xl z-30 cursor-move touch-none"
              >
                {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
                  <div
                    key={corner}
                    onPointerDown={(e) =>
                      handleMarkDraftCornerPointerDown(e, corner)
                    }
                    className={`absolute w-5 h-5 bg-white border-[3px] border-sky-500 rounded-full shadow-md touch-none ${
                      corner === 'nw'
                        ? '-top-2.5 -left-2.5 cursor-nwse-resize'
                        : corner === 'ne'
                        ? '-top-2.5 -right-2.5 cursor-nesw-resize'
                        : corner === 'sw'
                        ? '-bottom-2.5 -left-2.5 cursor-nesw-resize'
                        : '-bottom-2.5 -right-2.5 cursor-nwse-resize'
                    }`}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-slate-400 text-xs px-6 text-center">
            <Camera className="w-8 h-8 opacity-60" />
            <span>تم تنظيف صورة الرف لتوفير المساحة</span>
          </div>
        )}

        {/* Top Floating Controls Overlay (small semi-transparent solid buttons, NO blur; hidden when tapped empty area) */}
        {(showFloatingControls || addMode || markMode) && (
          <div
            className="absolute top-0 inset-x-0 z-20 px-3 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top,0px))] flex items-start justify-between gap-2 pointer-events-none"
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
          >
            {/* Right cluster: Close (X) + "photo X of Y" label */}
            <div className="flex items-center gap-1.5 min-w-0 pointer-events-auto">
              <button
                type="button"
                onClick={onClose}
                className="w-10 h-10 rounded-full bg-black/65 text-white flex items-center justify-center active:scale-95 transition shrink-0"
                aria-label="إغلاق"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="h-10 px-3 rounded-full bg-black/65 text-white text-xs font-extrabold flex items-center gap-1.5 min-w-0">
                {unfinishedPosition !== null && totalUnfinished > 0 ? (
                  <span className="tabular-nums whitespace-nowrap">
                    صورة {unfinishedPosition} من {totalUnfinished}
                  </span>
                ) : (
                  <span className="text-emerald-400 whitespace-nowrap">
                    مكتملة
                  </span>
                )}
                {shelfLabel && (
                  <>
                    <span aria-hidden="true" className="text-white/50">
                      ·
                    </span>
                    <span className="text-white/85 font-bold truncate max-w-[100px]">
                      {shelfLabel}
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Left cluster: "حدد منتجاً", "+" (AI mode), "تدوير", delete selected shortage, and List button */}
            <div className="flex items-center gap-1.5 flex-wrap justify-end pointer-events-auto">
              {!addMode && (
                <button
                  type="button"
                  onClick={() => {
                    if (markMode) {
                      setMarkMode(false);
                      setMarkDraftBox(null);
                      setShowProductPicker(false);
                    } else {
                      setMarkMode(true);
                      setAddMode(false);
                      setDraftBox(null);
                      setMarkDraftBox(null);
                      setIsSheetOpen(false);
                    }
                  }}
                  disabled={!photo.dataUrl}
                  className={`h-10 px-2.5 rounded-full text-xs font-extrabold flex items-center gap-1 active:scale-95 transition disabled:opacity-40 whitespace-nowrap ${
                    markMode
                      ? 'bg-sky-500 text-white'
                      : 'bg-black/65 text-white'
                  }`}
                >
                  {markMode ? (
                    <>
                      <X className="w-4 h-4" />
                      <span>إلغاء التحديد</span>
                    </>
                  ) : (
                    <>
                      <Tag className="w-3.5 h-3.5" />
                      <span>حدد منتجاً</span>
                    </>
                  )}
                </button>
              )}

              {aiAnalysisEnabled && !markMode && (
                <button
                  type="button"
                  onClick={() => {
                    setAddMode((prev) => !prev);
                    setDraftBox(null);
                    setIsSheetOpen(false);
                  }}
                  disabled={!photo.dataUrl}
                  className={`h-10 min-w-[40px] px-2.5 rounded-full text-xs font-extrabold flex items-center justify-center gap-1 active:scale-95 transition disabled:opacity-40 ${
                    addMode
                      ? 'bg-amber-400 text-slate-950'
                      : 'bg-black/65 text-white'
                  }`}
                  aria-label={addMode ? 'إلغاء الرسم' : 'إضافة نقص'}
                >
                  {addMode ? (
                    <>
                      <X className="w-4 h-4" />
                      <span>إلغاء</span>
                    </>
                  ) : (
                    <Plus className="w-5 h-5" />
                  )}
                </button>
              )}

              {!addMode && !markMode && (
                <button
                  type="button"
                  onClick={handleRotateClick}
                  disabled={!photo.dataUrl || isRotating}
                  className="h-10 px-2.5 rounded-full bg-black/65 text-white text-xs font-bold flex items-center gap-1 active:scale-95 transition disabled:opacity-40"
                  aria-label="تدوير الصورة 90 درجة"
                >
                  <RotateCw
                    className={`w-4 h-4 ${isRotating ? 'animate-spin' : ''}`}
                  />
                  <span>تدوير</span>
                </button>
              )}

              {aiAnalysisEnabled && selectedShortage && !addMode && !markMode && (
                <button
                  type="button"
                  onClick={() => onDeleteShortage(selectedShortage.id)}
                  className="h-10 px-2.5 rounded-full bg-red-600/85 text-white text-xs font-extrabold flex items-center gap-1 active:scale-95 transition"
                  aria-label="حذف النقص المحدد"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span className="tabular-nums">
                    #{selectedShortage.colorIndex + 1}
                  </span>
                </button>
              )}

              {!addMode && !markMode && (
                <button
                  type="button"
                  onClick={() => setIsSheetOpen((v) => !v)}
                  className={`h-10 px-2.5 rounded-full text-xs font-extrabold flex items-center gap-1.5 active:scale-95 transition ${
                    isSheetOpen
                      ? 'bg-emerald-500 text-white'
                      : 'bg-black/65 text-white'
                  }`}
                  aria-label="قائمة العناصر"
                >
                  <List className="w-4 h-4" />
                  {listCount > 0 && (
                    <span className="tabular-nums">{listCount}</span>
                  )}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Zoom Reset Button when zoomed in */}
        {zoom > 1.05 && showFloatingControls && !addMode && !markMode && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
            className="absolute bottom-3 left-3 z-20 px-3 py-1.5 rounded-full bg-black/65 text-white text-xs font-bold tabular-nums"
          >
            {zoom.toFixed(1)}x · إعادة ضبط
          </button>
        )}

        {/* AI Shortage Draw-mode guidance badge */}
        {addMode && aiAnalysisEnabled && (
          <div className="pointer-events-none absolute bottom-3 inset-x-4 flex justify-center z-20">
            <div className="px-3.5 py-1.5 rounded-full bg-amber-400 text-slate-950 text-xs font-extrabold">
              اسحب على الصورة لرسم مربع النقص
            </div>
          </div>
        )}

        {/* Manual Product Marking Guidance / Confirm Bar */}
        {markMode && !showProductPicker && (
          <div
            className="absolute bottom-3 inset-x-4 flex justify-center z-30"
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
          >
            {!markDraftBox ? (
              <div className="pointer-events-none px-4 py-2 rounded-full bg-sky-500 text-white text-xs font-extrabold">
                اسحب على الصورة لتحديد منتج (يمكن تحريكه وتغيير حجمه)
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowProductPicker(true)}
                  className="min-h-[44px] px-5 rounded-full bg-emerald-500 text-white text-sm font-extrabold flex items-center gap-1.5 shadow-lg active:scale-95 transition"
                >
                  <Check className="w-4 h-4" />
                  <span>تأكيد</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMarkDraftBox(null);
                  }}
                  className="min-h-[44px] px-4 rounded-full bg-black/75 text-white text-xs font-bold active:scale-95 transition"
                >
                  إعادة الرسم
                </button>
              </div>
            )}
          </div>
        )}

        {/* Manual Marking Product Picker Bottom Sheet */}
        {showProductPicker && markDraftBox && (
          <>
            <div
              className="absolute inset-0 z-30 bg-black/50"
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
              onClick={() => setShowProductPicker(false)}
            />
            <div
              className="absolute inset-x-0 bottom-0 z-40 max-h-[65dvh] bg-white dark:bg-slate-900 rounded-t-[24px] border-t border-slate-200 dark:border-slate-800 flex flex-col shadow-2xl"
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
            >
              <div className="shrink-0 pt-2.5 pb-2.5 px-4 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-2">
                <span className="text-sm font-extrabold text-slate-900 dark:text-white">
                  اختر المنتج
                </span>
                <button
                  type="button"
                  onClick={() => setShowProductPicker(false)}
                  className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center active:scale-95 transition"
                  aria-label="إغلاق"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
                <button
                  type="button"
                  disabled={isSavingMark}
                  onClick={() => handlePickManualProduct(undefined)}
                  className="min-h-[54px] w-full rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white font-extrabold text-sm flex items-center justify-center gap-2 active:scale-95 transition disabled:opacity-60"
                >
                  {isSavingMark ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Plus className="w-5 h-5" />
                  )}
                  <span>منتج جديد</span>
                </button>

                {pickerProducts.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-bold text-slate-500 dark:text-slate-400">
                      يُسحب كثيراً
                    </div>
                    <div className="grid grid-cols-4 sm:grid-cols-6 gap-2.5">
                      {pickerProducts.map((kp) => (
                        <button
                          key={kp.id}
                          type="button"
                          disabled={isSavingMark}
                          onClick={() => handlePickManualProduct(kp.id)}
                          className="aspect-square rounded-2xl overflow-hidden bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 active:scale-95 transition disabled:opacity-60"
                          aria-label={kp.productName || 'منتج'}
                        >
                          <img
                            src={kp.thumbnailDataUrl}
                            alt={kp.productName || 'منتج'}
                            className="w-full h-full object-cover"
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* Shortages & Marked Products Bottom Sheet (closed by default) */}
        {isSheetOpen && (
          <>
            <div
              className="absolute inset-0 z-30 bg-black/45"
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
              onClick={() => setIsSheetOpen(false)}
            />
            <div
              className="absolute inset-x-0 bottom-0 z-40 max-h-[60dvh] bg-white dark:bg-slate-900 rounded-t-[24px] border-t border-slate-200 dark:border-slate-800 flex flex-col shadow-2xl"
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
            >
              <div className="shrink-0 pt-2 pb-2.5 px-4 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-extrabold text-slate-900 dark:text-white">
                    {aiAnalysisEnabled ? 'النواقص والمنتجات' : 'المنتجات المحددة'}
                  </span>
                  {listCount > 0 && (
                    <span className="px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-bold tabular-nums">
                      {listCount}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setIsSheetOpen(false)}
                  className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center active:scale-95 transition"
                  aria-label="إغلاق القائمة"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2.5 space-y-2">
                {listCount === 0 ? (
                  <div className="py-6 text-center space-y-3">
                    <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                      {!aiAnalysisEnabled
                        ? 'لا توجد منتجات محددة بعد. استخدم زر "حدد منتجاً" للتحديد اليدوي.'
                        : !isOnline && photo.status === 'pending'
                        ? 'لا يوجد اتصال بالإنترنت حالياً. الصورة محفوظة محلياً ويمكنك استخدام "حدد منتجاً" الآن.'
                        : photo.status === 'pending' ||
                          photo.status === 'analyzing'
                        ? 'جاري تحليل الصورة، أو يمكنك إضافة النواقص يدوياً.'
                        : photo.status === 'error' ||
                          photo.status === 'poor_quality'
                        ? photo.errorMessage || 'تعذر التحليل التلقائي لهذه الصورة.'
                        : 'لا توجد نواقص مسجلة في هذه الصورة.'}
                    </p>
                    {aiAnalysisEnabled &&
                      (photo.status === 'error' ||
                        photo.status === 'poor_quality') &&
                      onRetryAnalyze && (
                        <button
                          type="button"
                          onClick={onRetryAnalyze}
                          className="min-h-[44px] px-4 rounded-xl bg-amber-500/15 text-amber-700 dark:text-amber-300 text-xs font-extrabold inline-flex items-center gap-1.5 active:scale-95 transition"
                        >
                          <RotateCcw className="w-4 h-4" />
                          <span>إعادة التحليل</span>
                        </button>
                      )}
                  </div>
                ) : (
                  <>
                    {visibleShortages.map((s) => {
                      const color = getShortageColor(s.colorIndex);
                      const known = productLookup.get(s.productId);
                      const thumb = known?.thumbnailDataUrl || '';
                      const optionalName = (
                        known?.productName ||
                        s.productName ||
                        ''
                      ).trim();
                      const isDuplicateToday = duplicateProductIdsToday.has(
                        s.productId
                      );
                      const isSelected = selectedShortage?.id === s.id;
                      const qty =
                        quantities[s.id] ??
                        (s.quantity > 0
                          ? s.quantity
                          : Math.max(1, s.estimatedMissing || 1));

                      return (
                        <div
                          key={s.id}
                          ref={(el) => {
                            if (el) rowRefs.current.set(s.id, el);
                            else rowRefs.current.delete(s.id);
                          }}
                          onClick={() => setSelectedShortageId(s.id)}
                          style={
                            isSelected
                              ? {
                                  borderColor: color.hex,
                                  boxShadow: `0 0 0 2px ${color.hex}33`,
                                }
                              : undefined
                          }
                          className={`rounded-2xl p-2 bg-[#F7F8FA] dark:bg-slate-800/60 border flex items-center gap-2.5 transition ${
                            isSelected
                              ? 'bg-emerald-50/40 dark:bg-slate-800'
                              : 'border-slate-200/80 dark:border-slate-700/80'
                          }`}
                        >
                          <span
                            style={{ backgroundColor: color.hex }}
                            className="w-7 h-7 rounded-lg text-white text-xs font-extrabold flex items-center justify-center tabular-nums shrink-0"
                          >
                            {s.colorIndex + 1}
                          </span>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOptionalNameValue(optionalName);
                              setNamingTarget({
                                productId: s.productId,
                                thumb,
                                currentName: optionalName,
                              });
                            }}
                            className="w-16 h-16 rounded-xl overflow-hidden bg-slate-200/70 dark:bg-slate-800 shrink-0 active:scale-95 transition"
                            aria-label="صورة المنتج"
                          >
                            {thumb ? (
                              <img
                                src={thumb}
                                alt={optionalName || 'المنتج'}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-emerald-500">
                                <Sparkles className="w-5 h-5" />
                              </div>
                            )}
                          </button>

                          <div className="flex-1 min-w-0 space-y-1">
                            {optionalName && (
                              <div className="text-xs font-extrabold text-slate-900 dark:text-white truncate">
                                {optionalName}
                              </div>
                            )}
                            {isDuplicateToday && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-orange-500/15 text-orange-700 dark:text-orange-300 text-[11px] font-extrabold whitespace-nowrap">
                                مسجل اليوم
                              </span>
                            )}
                          </div>

                          <div
                            className="flex items-center gap-1 bg-white dark:bg-slate-900 rounded-xl p-1 shrink-0"
                            dir="ltr"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => handleStepQuantity(s, -1)}
                              className="w-9 h-9 rounded-lg bg-[#F7F8FA] dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center active:scale-95 transition"
                              aria-label="إنقاص"
                            >
                              <Minus className="w-4 h-4" />
                            </button>
                            <input
                              type="number"
                              inputMode="numeric"
                              min={1}
                              max={999}
                              value={qty}
                              onChange={(e) =>
                                handleQtyInputChange(s, e.target.value)
                              }
                              aria-label="الكمية"
                              className="w-9 h-9 text-center text-sm font-extrabold text-emerald-600 dark:text-emerald-400 bg-transparent focus:outline-none tabular-nums"
                            />
                            <button
                              type="button"
                              onClick={() => handleStepQuantity(s, 1)}
                              className="w-9 h-9 rounded-lg bg-[#F7F8FA] dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center active:scale-95 transition"
                              aria-label="زيادة"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}

                    {manualMarks.map((m, idx) => {
                      const known = productLookup.get(m.productId);
                      const thumb = known?.thumbnailDataUrl || '';
                      const optionalName = (known?.productName || '').trim();
                      const displayNumber = m.markNumber || idx + 1;
                      return (
                        <div
                          key={m.id}
                          className="rounded-2xl p-2 bg-[#F7F8FA] dark:bg-slate-800/60 border border-sky-300/60 dark:border-sky-800/60 flex items-center gap-2.5"
                        >
                          <span className="w-7 h-7 rounded-lg bg-sky-500 text-white text-xs font-extrabold flex items-center justify-center tabular-nums shrink-0">
                            {displayNumber}
                          </span>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOptionalNameValue(optionalName);
                              setNamingTarget({
                                productId: m.productId,
                                thumb,
                                currentName: optionalName,
                              });
                            }}
                            className="w-16 h-16 rounded-xl overflow-hidden bg-slate-200/70 dark:bg-slate-800 shrink-0 active:scale-95 transition"
                            aria-label="صورة المنتج"
                          >
                            {thumb ? (
                              <img
                                src={thumb}
                                alt={optionalName || 'المنتج'}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-sky-500">
                                <Tag className="w-5 h-5" />
                              </div>
                            )}
                          </button>

                          <div className="flex-1 min-w-0">
                            {optionalName && (
                              <div className="text-xs font-extrabold text-slate-900 dark:text-white truncate">
                                {optionalName}
                              </div>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={() => setMarkToDelete(m)}
                            className="w-10 h-10 rounded-xl bg-red-500/10 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0 active:scale-95 transition"
                            aria-label="حذف العلامة"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Permanently Visible Fixed Bottom Bar Above Tab Bar */}
      <div className="shrink-0 px-4 py-2.5 bg-black/95 border-t border-white/10">
        <div className="max-w-lg mx-auto flex items-center gap-2.5">
          <button
            type="button"
            disabled={isCompleting}
            onClick={handleCompleteClick}
            className="min-h-[52px] flex-1 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white font-extrabold text-base flex items-center justify-center gap-2 active:scale-95 transition disabled:opacity-60"
          >
            <Check className="w-5 h-5" />
            <span>تم الإكمال</span>
          </button>

          <button
            type="button"
            onClick={onSkipPhoto}
            className="min-h-[52px] px-4 rounded-2xl bg-white/15 text-white font-bold text-sm flex items-center justify-center gap-1.5 active:scale-95 transition shrink-0"
          >
            <SkipForward className="w-4 h-4" />
            <span>تخطي</span>
          </button>
        </div>
      </div>

      {/* Long-Press Delete Confirmation Modal for Manual Mark */}
      {markToDelete && (
        <div
          className="fixed inset-0 z-50 bg-black/75 flex items-end sm:items-center justify-center p-4"
          onClick={() => setMarkToDelete(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-[20px] p-5 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4 text-center"
          >
            <div className="text-base font-extrabold text-slate-900 dark:text-white">
              حذف العلامة #{markToDelete.markNumber}؟
            </div>
            {productLookup.get(markToDelete.productId)?.thumbnailDataUrl && (
              <div className="flex justify-center">
                <img
                  src={productLookup.get(markToDelete.productId)!.thumbnailDataUrl}
                  alt="المنتج"
                  className="w-20 h-20 rounded-2xl object-cover bg-slate-100 dark:bg-slate-800"
                />
              </div>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setMarkToDelete(null)}
                className="min-h-[52px] flex-1 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={isDeletingMark}
                onClick={handleConfirmDeleteMark}
                className="min-h-[52px] flex-1 rounded-2xl bg-red-600 text-white font-bold disabled:opacity-60"
              >
                حذف
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Optional Product Naming Modal (never required; triggered by tapping product picture) */}
      {namingTarget && (
        <div
          className="fixed inset-0 z-50 bg-black/75 flex items-end sm:items-center justify-center p-4"
          onClick={() => setNamingTarget(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await onSaveOptionalName(namingTarget.productId, optionalNameValue);
              setNamingTarget(null);
            }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-slate-900 w-full max-w-md rounded-[20px] p-5 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                تسمية المنتج (اختياري)
              </h3>
              <button
                type="button"
                onClick={() => setNamingTarget(null)}
                className="w-10 h-10 rounded-xl bg-[#F7F8FA] dark:bg-slate-800 text-slate-500 flex items-center justify-center"
                aria-label="إغلاق"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {namingTarget.thumb && (
              <div className="flex justify-center">
                <img
                  src={namingTarget.thumb}
                  alt="المنتج"
                  className="w-24 h-24 rounded-2xl object-cover bg-slate-100 dark:bg-slate-800"
                />
              </div>
            )}

            <input
              type="text"
              autoFocus
              value={optionalNameValue}
              onChange={(e) => setOptionalNameValue(e.target.value)}
              placeholder="اسم اختياري..."
              className="w-full min-h-[52px] px-4 rounded-2xl bg-[#F7F8FA] dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setNamingTarget(null)}
                className="min-h-[52px] flex-1 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold"
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="min-h-[52px] flex-1 rounded-2xl bg-emerald-500 text-white font-bold"
              >
                حفظ
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
