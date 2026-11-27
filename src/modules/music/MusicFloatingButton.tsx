import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Music, Radio } from 'lucide-react';
import { MusicFabColorId } from '../../types';
import {
  clampFloatingButtonY,
  formatSleepTimerBadge,
  getDefaultFloatingButtonY,
  MUSIC_IDLE_FADE_DELAY_MS,
  MUSIC_IDLE_OPACITY,
  resolveMusicFabColorPreset,
} from './musicLogic';
import { MusicEqualizer } from './MusicEqualizer';
import { MusicTrackRecord } from './types';

const FAB_STORAGE_KEY = 'naqs_music_fab_y_v1';
const LONG_PRESS_MS = 450;
const DRAG_THRESHOLD_PX = 8;

interface MusicFloatingButtonProps {
  visible: boolean;
  isPlaying: boolean;
  isMuted?: boolean;
  currentTrack: MusicTrackRecord | null;
  sleepRemainingSec: number;
  colorPresetId: MusicFabColorId;
  visualEffects: boolean;
  disableEffects?: boolean;
  reactiveLevels?: readonly [number, number, number] | null;
  onTapOpen: () => void;
  onLongPressTogglePlay: () => void;
}

export const MusicFloatingButton: React.FC<MusicFloatingButtonProps> = ({
  visible,
  isPlaying,
  isMuted = false,
  currentTrack,
  sleepRemainingSec,
  colorPresetId,
  visualEffects,
  disableEffects = false,
  reactiveLevels = null,
  onTapOpen,
  onLongPressTogglePlay,
}) => {
  const [yPos, setYPos] = useState<number>(() => {
    const vh = typeof window !== 'undefined' ? window.innerHeight : 844;
    if (typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem(FAB_STORAGE_KEY);
        if (raw !== null) {
          const saved = Number(raw);
          if (Number.isFinite(saved) && saved > 0) {
            return clampFloatingButtonY(saved, vh);
          }
        }
      } catch {
        // Ignore storage errors
      }
    }
    return getDefaultFloatingButtonY(vh);
  });

  const [isDragging, setIsDragging] = useState(false);
  const [isIdle, setIsIdle] = useState(false);
  const [isPageHidden, setIsPageHidden] = useState(() =>
    typeof document !== 'undefined' ? document.visibilityState === 'hidden' : false
  );
  const [flashKey, setFlashKey] = useState(0);

  const yPosRef = useRef(yPos);
  yPosRef.current = yPos;
  const idleTimerRef = useRef<number | null>(null);
  const prevTrackIdRef = useRef<string | null>(currentTrack?.id || null);

  const dragStateRef = useRef<{
    pointerId: number | null;
    startX: number;
    startY: number;
    startTop: number;
    dragging: boolean;
    longPressFired: boolean;
    longPressTimer: number | null;
  }>({
    pointerId: null,
    startX: 0,
    startY: 0,
    startTop: 0,
    dragging: false,
    longPressFired: false,
    longPressTimer: null,
  });

  const resetIdleTimer = useCallback(() => {
    setIsIdle(false);
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
    }
    idleTimerRef.current = window.setTimeout(() => {
      setIsIdle(true);
    }, MUSIC_IDLE_FADE_DELAY_MS);
  }, []);

  // Track idle state: fades to ~35% & shrinks slightly after 4s without touch or scroll; paused when hidden
  useEffect(() => {
    if (!visible || isPageHidden) {
      setIsIdle(false);
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
      return;
    }

    resetIdleTimer();

    const handleActivity = () => {
      resetIdleTimer();
    };

    window.addEventListener('scroll', handleActivity, {
      capture: true,
      passive: true,
    });
    window.addEventListener('touchstart', handleActivity, {
      capture: true,
      passive: true,
    });
    window.addEventListener('pointerdown', handleActivity, {
      capture: true,
      passive: true,
    });

    return () => {
      window.removeEventListener('scroll', handleActivity, { capture: true });
      window.removeEventListener('touchstart', handleActivity, { capture: true });
      window.removeEventListener('pointerdown', handleActivity, { capture: true });
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };
  }, [visible, isPageHidden, resetIdleTimer]);

  // Pause CSS animations when document is hidden (visibilitychange)
  useEffect(() => {
    const onVisChange = () => {
      setIsPageHidden(document.visibilityState === 'hidden');
    };
    document.addEventListener('visibilitychange', onVisChange);
    return () => document.removeEventListener('visibilitychange', onVisChange);
  }, []);

  // Light flash when track changes while active
  useEffect(() => {
    const nextId = currentTrack?.id || null;
    if (
      nextId &&
      prevTrackIdRef.current !== null &&
      nextId !== prevTrackIdRef.current &&
      isPlaying &&
      visualEffects &&
      !disableEffects &&
      !isPageHidden
    ) {
      setFlashKey((k) => k + 1);
    }
    prevTrackIdRef.current = nextId;
  }, [currentTrack?.id, isPlaying, visualEffects, disableEffects, isPageHidden]);

  // Re-clamp vertical position cleanly on viewport resize
  useEffect(() => {
    const handleResize = () => {
      setYPos((prev) => clampFloatingButtonY(prev, window.innerHeight));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    return () => {
      if (dragStateRef.current.longPressTimer !== null) {
        window.clearTimeout(dragStateRef.current.longPressTimer);
      }
    };
  }, []);

  const clearLongPressTimer = () => {
    if (dragStateRef.current.longPressTimer !== null) {
      window.clearTimeout(dragStateRef.current.longPressTimer);
      dragStateRef.current.longPressTimer = null;
    }
  };

  if (!visible) return null;

  const preset = resolveMusicFabColorPreset(colorPresetId);
  const timerText =
    sleepRemainingSec > 0 ? formatSleepTimerBadge(sleepRemainingSec) : '';
  const animationsPaused = disableEffects || isPageHidden || !visualEffects;
  const showPlayingEffects = isPlaying && visualEffects && !disableEffects;

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    resetIdleTimer();
    clearLongPressTimer();
    dragStateRef.current.pointerId = e.pointerId;
    dragStateRef.current.startX = e.clientX;
    dragStateRef.current.startY = e.clientY;
    dragStateRef.current.startTop = yPosRef.current;
    dragStateRef.current.dragging = false;
    dragStateRef.current.longPressFired = false;

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore capture errors
    }

    dragStateRef.current.longPressTimer = window.setTimeout(() => {
      if (
        dragStateRef.current.pointerId !== null &&
        !dragStateRef.current.dragging
      ) {
        dragStateRef.current.longPressFired = true;
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
          try {
            navigator.vibrate(25);
          } catch {
            // Ignore vibration failure
          }
        }
        onLongPressTogglePlay();
      }
    }, LONG_PRESS_MS);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (dragStateRef.current.pointerId !== e.pointerId) return;
    const dx = e.clientX - dragStateRef.current.startX;
    const dy = e.clientY - dragStateRef.current.startY;
    const dist = Math.hypot(dx, dy);

    if (!dragStateRef.current.dragging && dist > DRAG_THRESHOLD_PX) {
      dragStateRef.current.dragging = true;
      setIsDragging(true);
      clearLongPressTimer();
    }

    if (dragStateRef.current.dragging) {
      const nextY = clampFloatingButtonY(
        dragStateRef.current.startTop + dy,
        window.innerHeight
      );
      setYPos(nextY);
    }
  };

  const finishInteraction = (
    e: React.PointerEvent<HTMLButtonElement>,
    allowTap: boolean
  ) => {
    if (dragStateRef.current.pointerId !== e.pointerId) return;
    clearLongPressTimer();

    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore release failure
    }

    const wasDragging = dragStateRef.current.dragging;
    const wasLongPress = dragStateRef.current.longPressFired;

    dragStateRef.current.pointerId = null;
    dragStateRef.current.dragging = false;
    setIsDragging(false);

    if (wasDragging) {
      const finalY = clampFloatingButtonY(yPosRef.current, window.innerHeight);
      setYPos(finalY);
      try {
        window.localStorage.setItem(FAB_STORAGE_KEY, String(finalY));
      } catch {
        // Ignore storage failures
      }
      return;
    }

    if (allowTap && !wasLongPress) {
      onTapOpen();
    }
  };

  return (
    <button
      type="button"
      data-testid="music-floating-button"
      data-idle={isIdle ? 'true' : 'false'}
      data-playing={isPlaying ? 'true' : 'false'}
      data-color={preset.id}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(e) => finishInteraction(e, true)}
      onPointerCancel={(e) => finishInteraction(e, false)}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        top: `${yPos}px`,
        left: '-12px',
        opacity: isDragging ? 1 : isIdle ? MUSIC_IDLE_OPACITY : 1,
        transformOrigin: 'left center',
        transform: isDragging
          ? 'scale(1.06)'
          : isIdle
          ? 'scale(0.88)'
          : 'scale(1)',
      }}
      aria-label="المشغّل الصوتي — اضغط للفتح أو مطولاً للتشغيل والإيقاف"
      className={`fixed z-[25] w-11 h-11 rounded-full touch-none select-none flex items-center justify-center transition-[opacity,transform] duration-300 ${
        animationsPaused ? 'music-animations-paused' : ''
      }`}
    >
      {/* Pulsing Glow Ring (CSS transform + opacity only; faint glow persists while idle & playing) */}
      {showPlayingEffects && (
        <span
          aria-hidden="true"
          data-testid="music-fab-glow-ring"
          className={`pointer-events-none absolute -inset-1.5 rounded-full ${
            preset.ringBgClass
          } ${isIdle ? 'music-fab-pulse-ring-idle' : 'music-fab-pulse-ring'}`}
        />
      )}

      {/* Slowly Rotating Gradient Border (CSS transform rotate only) */}
      {showPlayingEffects && (
        <span
          aria-hidden="true"
          data-testid="music-fab-rotating-border"
          className="pointer-events-none absolute inset-0 rounded-full overflow-hidden"
        >
          <span
            className="block w-full h-full music-fab-spin-border"
            style={{ background: preset.conicColorsCss }}
          />
        </span>
      )}

      {/* Track Change Light Flash */}
      {flashKey > 0 && showPlayingEffects && (
        <span
          key={flashKey}
          aria-hidden="true"
          data-testid="music-fab-flash"
          className="pointer-events-none absolute -inset-0.5 rounded-full bg-white music-fab-track-flash"
        />
      )}

      {/* Inner Pill Core (distinctive gradient when playing, neutral gray when paused/stopped) */}
      <span
        className={`relative rounded-full flex flex-col items-center justify-center pl-2.5 text-white shadow-md ${
          showPlayingEffects
            ? `w-[40px] h-[40px] ${preset.gradientClass}`
            : isPlaying
            ? `w-11 h-11 ${preset.gradientClass} border border-white/30`
            : 'w-11 h-11 bg-slate-600 border border-white/25'
        }`}
      >
        {isPlaying ? (
          <>
            <MusicEqualizer
              active={!animationsPaused}
              reactiveLevels={animationsPaused ? null : reactiveLevels}
              className="h-3 text-white"
            />
            {timerText && (
              <span
                data-testid="music-fab-timer"
                dir="ltr"
                className="text-[8px] leading-none font-extrabold tabular-nums mt-0.5"
              >
                {timerText}
              </span>
            )}
          </>
        ) : timerText ? (
          <>
            <Music className="w-3.5 h-3.5" />
            <span
              data-testid="music-fab-timer"
              dir="ltr"
              className="text-[8px] leading-none font-extrabold tabular-nums mt-0.5"
            >
              {timerText}
            </span>
          </>
        ) : currentTrack?.kind === 'radio' ? (
          <Radio className="w-4 h-4" />
        ) : (
          <Music className="w-4 h-4" />
        )}
      </span>

      {/* Small orange warning chip when playing while muted/zero volume */}
      {isPlaying && isMuted && (
        <span
          data-testid="music-fab-muted-chip"
          className="pointer-events-none absolute left-[14px] top-[46px] whitespace-nowrap px-2 py-0.5 rounded-full bg-amber-500 text-white text-[9px] font-extrabold shadow-md border border-amber-300/70"
        >
          الصوت مكتوم
        </span>
      )}
    </button>
  );
};
