import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  CheckCircle2,
  MoreHorizontal,
  RotateCcw,
  RotateCw,
  SkipForward,
  Sparkles,
  X,
} from 'lucide-react';
import { ShelfPhoto } from '../../types';

interface PanDragState {
  startClientX: number;
  startClientY: number;
  origPanX: number;
  origPanY: number;
  moved: boolean;
}

interface PhotoDetailViewProps {
  photo: ShelfPhoto | null;
  unfinishedPosition: number | null;
  totalUnfinished: number;
  showAllCompleted: boolean;
  onCompletePhoto: () => Promise<void>;
  onSkipPhoto: () => void;
  onRotatePhoto: () => Promise<void>;
  onReEnhancePhoto?: () => Promise<void>;
  onRestoreOriginalPhoto?: () => Promise<void>;
  onClose: () => void;
}

export const PhotoDetailView: React.FC<PhotoDetailViewProps> = ({
  photo,
  unfinishedPosition,
  totalUnfinished,
  showAllCompleted,
  onCompletePhoto,
  onSkipPhoto,
  onRotatePhoto,
  onReEnhancePhoto,
  onRestoreOriginalPhoto,
  onClose,
}) => {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);
  const singleTapTimerRef = useRef<number | null>(null);
  const emptyPointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const pinchStartDistRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef<number>(1);

  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [showFloatingControls, setShowFloatingControls] = useState(true);
  const [panDrag, setPanDrag] = useState<PanDragState | null>(null);
  const [isCompleting, setIsCompleting] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [isHoldingOriginal, setIsHoldingOriginal] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [isReEnhancing, setIsReEnhancing] = useState(false);
  const [isRestoringOriginal, setIsRestoringOriginal] = useState(false);

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

  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setShowFloatingControls(true);
    setPanDrag(null);
    setIsHoldingOriginal(false);
    setShowMoreMenu(false);
    if (photo?.width && photo?.height) {
      setNaturalSize({ width: photo.width, height: photo.height });
    } else {
      setNaturalSize({ width: 0, height: 0 });
    }
  }, [photo?.id, photo?.width, photo?.height]);

  useEffect(() => {
    return () => {
      if (singleTapTimerRef.current !== null) {
        window.clearTimeout(singleTapTimerRef.current);
      }
    };
  }, []);

  const handleViewportTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      if (singleTapTimerRef.current !== null) {
        window.clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      emptyPointerDownRef.current = null;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStartDistRef.current = Math.hypot(dx, dy);
      pinchStartZoomRef.current = zoom;
      setPanDrag(null);
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
          Math.min(
            4,
            pinchStartZoomRef.current * (dist / pinchStartDistRef.current)
          )
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
    if (pinchStartDistRef.current !== null) return;

    if (zoom > 1.05) {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setPanDrag({
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

  const handlePointerMove = (e: React.PointerEvent) => {
    if (pinchStartDistRef.current !== null) return;
    if (!panDrag) return;
    const dx = e.clientX - panDrag.startClientX;
    const dy = e.clientY - panDrag.startClientY;
    const moved = panDrag.moved || Math.hypot(dx, dy) > 4;
    setPanDrag({ ...panDrag, moved });
    setPan({
      x: panDrag.origPanX + dx,
      y: panDrag.origPanY + dy,
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (panDrag) {
      if (!panDrag.moved) {
        handleEmptyTap(e.clientX, e.clientY);
      }
      setPanDrag(null);
      return;
    }

    if (emptyPointerDownRef.current) {
      const dist = Math.hypot(
        e.clientX - emptyPointerDownRef.current.x,
        e.clientY - emptyPointerDownRef.current.y
      );
      emptyPointerDownRef.current = null;
      if (dist < 10) {
        handleEmptyTap(e.clientX, e.clientY);
      }
    }
  };

  const handleCompleteClick = async () => {
    if (isCompleting) return;
    setIsCompleting(true);
    try {
      await onCompletePhoto();
    } finally {
      setIsCompleting(false);
    }
  };

  const handleRotateClick = async () => {
    if (isRotating || !photo?.dataUrl) return;
    setShowMoreMenu(false);
    setIsRotating(true);
    try {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      await onRotatePhoto();
    } finally {
      setIsRotating(false);
    }
  };

  const handleReEnhanceClick = async () => {
    if (!onReEnhancePhoto || isReEnhancing) return;
    setShowMoreMenu(false);
    setIsReEnhancing(true);
    try {
      await onReEnhancePhoto();
    } finally {
      setIsReEnhancing(false);
    }
  };

  const handleRestoreOriginalClick = async () => {
    if (!onRestoreOriginalPhoto || isRestoringOriginal) return;
    setShowMoreMenu(false);
    setIsRestoringOriginal(true);
    try {
      await onRestoreOriginalPhoto();
    } finally {
      setIsRestoringOriginal(false);
    }
  };

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
      {/* Full-Screen Black Photo Stage */}
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
            style={{
              ...fittedBoxStyle,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: 'center center',
            }}
            className="relative max-w-full max-h-full transition-transform duration-75"
          >
            <img
              data-testid="photo-detail-stage-img"
              src={
                isHoldingOriginal && photo.originalDataUrl
                  ? photo.originalDataUrl
                  : photo.dataUrl
              }
              alt="صورة الرف"
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
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-slate-400 text-xs px-6 text-center">
            <Camera className="w-8 h-8 opacity-60" />
            <span>تم تنظيف صورة الرف لتوفير المساحة</span>
          </div>
        )}

        {/* Active Before/After Hold Badge */}
        {isHoldingOriginal && photo.originalDataUrl && (
          <div
            data-testid="photo-original-badge"
            className="absolute bottom-3 right-3 z-20 px-3 py-1 rounded-full bg-amber-500 text-slate-950 text-xs font-extrabold shadow pointer-events-none"
          >
            الصورة الأصلية
          </div>
        )}

        {/* Top Floating Controls Overlay */}
        {showFloatingControls && (
          <div
            className="absolute top-0 inset-x-0 z-20 px-3 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top,0px))] flex items-start justify-between gap-2 pointer-events-none"
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
          >
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
              </div>
            </div>

            <div className="relative flex items-center gap-1.5 pointer-events-auto">
              {Boolean(photo.originalDataUrl) && Boolean(photo.dataUrl) && (
                <button
                  type="button"
                  data-testid="photo-before-after-btn"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setIsHoldingOriginal(true);
                  }}
                  onPointerUp={() => setIsHoldingOriginal(false)}
                  onPointerLeave={() => setIsHoldingOriginal(false)}
                  onPointerCancel={() => setIsHoldingOriginal(false)}
                  onContextMenu={(e) => e.preventDefault()}
                  className={`h-10 px-3 rounded-full text-xs font-extrabold flex items-center gap-1 transition select-none touch-none ${
                    isHoldingOriginal
                      ? 'bg-amber-500 text-slate-950'
                      : 'bg-black/65 text-white'
                  }`}
                  aria-label="معاينة الأصل قبل وبعد"
                >
                  <span>قبل/بعد</span>
                </button>
              )}

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

              {Boolean(photo.originalDataUrl) && Boolean(photo.dataUrl) && (
                <>
                  <button
                    type="button"
                    data-testid="photo-detail-more-btn"
                    onClick={() => setShowMoreMenu((v) => !v)}
                    className="w-10 h-10 rounded-full bg-black/65 text-white flex items-center justify-center active:scale-95 transition"
                    aria-label="المزيد من الخيارات"
                  >
                    <MoreHorizontal className="w-5 h-5" />
                  </button>

                  {showMoreMenu && (
                    <div
                      data-testid="photo-detail-more-menu"
                      className="absolute top-12 left-0 w-48 rounded-2xl bg-slate-900/95 border border-white/15 shadow-2xl overflow-hidden backdrop-blur-md z-30"
                    >
                      <button
                        type="button"
                        data-testid="photo-re-enhance-btn"
                        disabled={isReEnhancing || isRestoringOriginal}
                        onClick={handleReEnhanceClick}
                        className="w-full px-3.5 py-3 text-right text-xs font-extrabold text-white hover:bg-white/10 flex items-center gap-2 border-b border-white/10 disabled:opacity-50"
                      >
                        <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
                        <span>
                          {isReEnhancing ? 'جاري التحسين...' : 'إعادة التحسين'}
                        </span>
                      </button>

                      <button
                        type="button"
                        data-testid="photo-restore-original-btn"
                        disabled={isReEnhancing || isRestoringOriginal}
                        onClick={handleRestoreOriginalClick}
                        className="w-full px-3.5 py-3 text-right text-xs font-extrabold text-amber-300 hover:bg-white/10 flex items-center gap-2 disabled:opacity-50"
                      >
                        <RotateCcw className="w-4 h-4 shrink-0" />
                        <span>
                          {isRestoringOriginal
                            ? 'جاري الاستعادة...'
                            : 'استعادة الأصل'}
                        </span>
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* Zoom Reset Button when zoomed in */}
        {zoom > 1.05 && showFloatingControls && (
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
    </div>
  );
};
