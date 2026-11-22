import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { compressCoverBlobToDataUrl } from './coverArt';
import {
  addAudioFilesToLibrary,
  addRadioStationToLibrary,
  clearMusicLibrary,
  createMusicList,
  DEFAULT_PLAYBACK_STATE,
  deleteMusicList,
  deleteMusicTrack,
  getAllMusicLists,
  getAllMusicTracks,
  getMusicBlob,
  getMusicPlaybackState,
  getMusicStorageStats,
  markTrackPlayed,
  reattachMissingAudioFile,
  renameMusicList,
  renameMusicTrack,
  reorderMusicTrack,
  saveMusicPlaybackState,
  toggleTrackFavorite,
  toggleTrackListMembership,
  updateTrackCoverDataUrl,
  updateTrackTileColor,
} from './musicDb';
import {
  computeSleepTimerRemainingSec,
  DEFAULT_MUSIC_MAX_STORAGE_MB,
  generateMusicArtworkDataUrl,
  isTrackPlayable,
  MISSING_FILE_LABEL,
  pickNextTrackIndex,
  SleepTimerMinutes,
} from './musicLogic';
import {
  formatMediaErrorReason,
  resolveAudioMimeType,
  resolveInitialVolumeReset,
  resolvePlayVolumeState,
} from './musicPlaybackHelpers';
import { setMusicPlayingActive } from './musicPlaybackFlag';
import {
  MusicCustomList,
  MusicImportProgress,
  MusicImportReport,
  MusicPlaybackDiagnostics,
  MusicRepeatMode,
  MusicStorageStats,
  MusicTrackRecord,
} from './types';

export interface MusicToastMessage {
  type: 'info' | 'error';
  text: string;
}

interface UseMusicPlayerParams {
  enabled: boolean;
  maxStorageMb: number;
  refreshSignal: number;
  visualEffects?: boolean;
  audioReactive?: boolean;
}

const VOLUME_RESET_STORAGE_KEY = 'naqs_music_volume_reset_v1';

const EMPTY_STATS: MusicStorageStats = {
  trackCount: 0,
  fileTrackCount: 0,
  radioCount: 0,
  usedBytes: 0,
  persisted: false,
  isStorageLow: false,
  browserUsageBytes: 0,
  browserQuotaBytes: 0,
};

function readVolumeResetFlag(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(VOLUME_RESET_STORAGE_KEY) === '1';
  } catch {
    return true;
  }
}

function writeVolumeResetFlag(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(VOLUME_RESET_STORAGE_KEY, '1');
  } catch {
    // Ignore storage errors
  }
}

export function useMusicPlayer({
  enabled,
  maxStorageMb,
  refreshSignal,
  visualEffects = true,
  audioReactive = false,
}: UseMusicPlayerParams) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const pendingRevokeUrlRef = useRef<string | null>(null);
  const loadedTrackIdRef = useRef<string | null>(null);
  const pendingResumePosRef = useRef<number | null>(null);
  const expectedPauseRef = useRef(false);
  const failedChainRef = useRef<Set<string>>(new Set());
  const skipErrorTimerRef = useRef<number | null>(null);
  const lastSavedPosAtRef = useRef(0);
  const toastTimerRef = useRef<number | null>(null);
  const importCancelRef = useRef(false);
  const importBusyRef = useRef(false);
  const trackPositionsRef = useRef<Record<string, number>>({});

  // Opt-in Web Audio graph (never created unless audioReactive === true)
  const webAudioGraphRef = useRef<{
    element: HTMLAudioElement;
    ctx: AudioContext;
    source: MediaElementAudioSourceNode;
    analyser: AnalyserNode;
  } | null>(null);
  const reactiveRafRef = useRef<number | null>(null);

  const [tracks, setTracks] = useState<MusicTrackRecord[]>([]);
  const [lists, setLists] = useState<MusicCustomList[]>([]);
  const [storageStats, setStorageStats] = useState<MusicStorageStats>(EMPTY_STATS);
  const [currentTrackId, setCurrentTrackId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [positionSec, setPositionSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [volume, setVolumeState] = useState(DEFAULT_PLAYBACK_STATE.volume);
  const [isMuted, setIsMutedState] = useState(DEFAULT_PLAYBACK_STATE.muted);
  const [lastNonZeroVolume, setLastNonZeroVolume] = useState(
    DEFAULT_PLAYBACK_STATE.lastNonZeroVolume
  );
  const [shuffle, setShuffleState] = useState(DEFAULT_PLAYBACK_STATE.shuffle);
  const [repeat, setRepeatState] = useState<MusicRepeatMode>(
    DEFAULT_PLAYBACK_STATE.repeat
  );
  const [toast, setToast] = useState<MusicToastMessage | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [sleepTimerMinutes, setSleepTimerMinutes] =
    useState<SleepTimerMinutes | null>(null);
  const [sleepTimerEndsAt, setSleepTimerEndsAt] = useState<number | null>(null);
  const [sleepRemainingSec, setSleepRemainingSec] = useState(0);
  const [importProgress, setImportProgress] =
    useState<MusicImportProgress | null>(null);
  const [importReport, setImportReport] =
    useState<MusicImportReport | null>(null);
  const [reactiveLevels, setReactiveLevels] = useState<
    readonly [number, number, number] | null
  >(null);
  const [audioReactiveWarning, setAudioReactiveWarning] = useState(false);

  const tracksRef = useRef<MusicTrackRecord[]>(tracks);
  tracksRef.current = tracks;
  const currentTrackIdRef = useRef<string | null>(currentTrackId);
  currentTrackIdRef.current = currentTrackId;
  const shuffleRef = useRef(shuffle);
  shuffleRef.current = shuffle;
  const repeatRef = useRef(repeat);
  repeatRef.current = repeat;
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const isMutedRef = useRef(isMuted);
  isMutedRef.current = isMuted;
  const lastNonZeroVolumeRef = useRef(lastNonZeroVolume);
  lastNonZeroVolumeRef.current = lastNonZeroVolume;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const lastErrorRef = useRef(lastError);
  lastErrorRef.current = lastError;
  const audioReactiveRef = useRef(audioReactive);
  audioReactiveRef.current = audioReactive;

  const showToast = useCallback((type: 'info' | 'error', text: string) => {
    setToast({ type, text });
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToast((prev) => (prev?.text === text ? null : prev));
    }, 3600);
  }, []);

  const clearSkipTimer = useCallback(() => {
    if (skipErrorTimerRef.current !== null) {
      window.clearTimeout(skipErrorTimerRef.current);
      skipErrorTimerRef.current = null;
    }
  }, []);

  const revokeUrlSafely = useCallback((url: string | null) => {
    if (!url) return;
    try {
      URL.revokeObjectURL(url);
    } catch {
      // Ignore revoke failure
    }
  }, []);

  // Only revokes pending old URL (called once new one starts playing)
  const flushPendingRevokeUrl = useCallback(() => {
    if (pendingRevokeUrlRef.current) {
      revokeUrlSafely(pendingRevokeUrlRef.current);
      pendingRevokeUrlRef.current = null;
    }
  }, [revokeUrlSafely]);

  // Revokes BOTH active & pending URLs (only when stopping completely or closing/disabling)
  const revokeAllObjectUrls = useCallback(() => {
    flushPendingRevokeUrl();
    if (objectUrlRef.current) {
      revokeUrlSafely(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, [flushPendingRevokeUrl, revokeUrlSafely]);

  const clearMediaSession = useCallback(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = 'none';
      const actions: MediaSessionAction[] = [
        'play',
        'pause',
        'previoustrack',
        'nexttrack',
        'seekto',
      ];
      for (const action of actions) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {
          // Ignore unsupported action
        }
      }
    } catch {
      // Ignore Media Session cleanup error
    }
  }, []);

  const refreshLibrary = useCallback(async () => {
    try {
      const [allTracks, allLists, stats] = await Promise.all([
        getAllMusicTracks(),
        getAllMusicLists(),
        getMusicStorageStats(),
      ]);
      setTracks(allTracks);
      setLists(allLists);
      setStorageStats(stats);

      const curId = currentTrackIdRef.current;
      if (curId && !allTracks.some((t) => t.id === curId)) {
        setCurrentTrackId(null);
        setPositionSec(0);
        setDurationSec(0);
      }
    } catch {
      // Ignore transient read error
    }
  }, []);

  // Load saved library stats, custom lists & playback state cleanly
  useEffect(() => {
    let active = true;
    Promise.all([
      getAllMusicTracks(),
      getAllMusicLists(),
      getMusicStorageStats(),
      getMusicPlaybackState(),
    ])
      .then(([allTracks, allLists, stats, state]) => {
        if (!active) return;
        setTracks(allTracks);
        setLists(allLists);
        setStorageStats(stats);
        trackPositionsRef.current = { ...(state.trackPositions || {}) };

        // Launch volume safety: never start muted or at 0 from an old session
        const alreadyReset = readVolumeResetFlag();
        const volReset = resolveInitialVolumeReset({
          volume: state.volume,
          muted: state.muted,
          lastNonZeroVolume: state.lastNonZeroVolume,
          alreadyReset,
        });

        setVolumeState(volReset.volume);
        volumeRef.current = volReset.volume;
        setIsMutedState(volReset.muted);
        isMutedRef.current = volReset.muted;
        setLastNonZeroVolume(volReset.lastNonZeroVolume);
        lastNonZeroVolumeRef.current = volReset.lastNonZeroVolume;

        if (volReset.didReset) {
          writeVolumeResetFlag();
          saveMusicPlaybackState({
            volume: volReset.volume,
            muted: volReset.muted,
            lastNonZeroVolume: volReset.lastNonZeroVolume,
          }).catch(() => {});
          if (volReset.toastText) {
            showToast('info', volReset.toastText);
          }
        } else if (!alreadyReset) {
          writeVolumeResetFlag();
        }

        setShuffleState(state.shuffle);
        setRepeatState(state.repeat);

        const validCurrent =
          state.currentTrackId &&
          allTracks.some((t) => t.id === state.currentTrackId)
            ? state.currentTrackId
            : null;
        setCurrentTrackId(validCurrent);
        const restoredTrack = validCurrent
          ? allTracks.find((t) => t.id === validCurrent)
          : null;
        if (restoredTrack) {
          const savedPerTrack =
            typeof trackPositionsRef.current[restoredTrack.id] === 'number'
              ? trackPositionsRef.current[restoredTrack.id]
              : state.positionSec;
          const safePos =
            restoredTrack.kind === 'file' ? Math.max(0, savedPerTrack) : 0;
          setPositionSec(safePos);
          setDurationSec(restoredTrack.duration || 0);
          pendingResumePosRef.current = safePos;
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [refreshSignal, showToast]);

  // Keep master OFF rule airtight: immediately stop playback, clear object URL & mediaSession when disabled
  useEffect(() => {
    if (!enabled) {
      expectedPauseRef.current = true;
      importCancelRef.current = true;
      clearSkipTimer();
      if (reactiveRafRef.current !== null) {
        window.cancelAnimationFrame(reactiveRafRef.current);
        reactiveRafRef.current = null;
      }
      setReactiveLevels(null);
      if (webAudioGraphRef.current) {
        try {
          webAudioGraphRef.current.ctx.close().catch(() => {});
        } catch {
          // Ignore AudioContext close error
        }
        webAudioGraphRef.current = null;
      }
      if (audioRef.current) {
        try {
          audioRef.current.pause();
          audioRef.current.removeAttribute('src');
          audioRef.current.load();
        } catch {
          // Ignore stop errors
        }
      }
      revokeAllObjectUrls();
      loadedTrackIdRef.current = null;
      setIsPlaying(false);
      setIsBuffering(false);
      setLastError(null);
      setMusicPlayingActive(false);
      setIsSheetOpen(false);
      setSleepTimerMinutes(null);
      setSleepTimerEndsAt(null);
      setSleepRemainingSec(0);
      setImportProgress(null);
      clearMediaSession();
    }
  }, [enabled, clearMediaSession, clearSkipTimer, revokeAllObjectUrls]);

  // Opt-in AnalyserNode loop: NEVER created unless audioReactive === true AND playing
  useEffect(() => {
    if (!enabled || !audioReactive || !visualEffects || !isPlaying) {
      if (reactiveRafRef.current !== null) {
        window.cancelAnimationFrame(reactiveRafRef.current);
        reactiveRafRef.current = null;
      }
      setReactiveLevels(null);
      return;
    }

    const audio = audioRef.current;
    if (!audio) return;

    const AudioCtx =
      typeof window !== 'undefined'
        ? (window.AudioContext ||
            (window as unknown as { webkitAudioContext?: typeof AudioContext })
              .webkitAudioContext)
        : undefined;
    if (!AudioCtx) return;

    const reducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion || document.visibilityState === 'hidden') {
      setReactiveLevels(null);
      return;
    }

    let graph = webAudioGraphRef.current;
    if (!graph || graph.element !== audio) {
      try {
        const ctx = new AudioCtx();
        const source = ctx.createMediaElementSource(audio);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        analyser.smoothingTimeConstant = 0.72;
        source.connect(analyser);
        analyser.connect(ctx.destination);
        graph = { element: audio, ctx, source, analyser };
        webAudioGraphRef.current = graph;
      } catch {
        setAudioReactiveWarning(true);
        return;
      }
    }

    if (graph.ctx.state === 'suspended') {
      graph.ctx.resume().catch(() => {
        setAudioReactiveWarning(true);
      });
    }

    const bins = new Uint8Array(graph.analyser.frequencyBinCount);
    let lastSampleAt = 0;

    const sample = (now: number) => {
      if (document.visibilityState === 'hidden') {
        reactiveRafRef.current = null;
        return;
      }
      if (now - lastSampleAt >= 65 && graph) {
        lastSampleAt = now;
        try {
          graph.analyser.getByteFrequencyData(bins);
          const avgRange = (start: number, end: number) => {
            let sum = 0;
            let cnt = 0;
            for (let i = start; i < end && i < bins.length; i++) {
              sum += bins[i];
              cnt++;
            }
            return cnt > 0 ? sum / (cnt * 255) : 0;
          };
          const low = Math.max(0.25, Math.min(1, 0.25 + avgRange(0, 4) * 1.1));
          const mid = Math.max(0.25, Math.min(1, 0.25 + avgRange(4, 12) * 1.15));
          const high = Math.max(0.25, Math.min(1, 0.25 + avgRange(12, 24) * 1.25));
          setReactiveLevels([low, mid, high]);
        } catch {
          // Ignore sampling errors
        }
      }
      reactiveRafRef.current = window.requestAnimationFrame(sample);
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (reactiveRafRef.current !== null) {
          window.cancelAnimationFrame(reactiveRafRef.current);
          reactiveRafRef.current = null;
        }
        if (graph && graph.ctx.state !== 'running') {
          setAudioReactiveWarning(true);
        }
      } else if (isPlayingRef.current && audioReactiveRef.current) {
        if (graph && graph.ctx.state === 'suspended') {
          graph.ctx.resume().catch(() => {});
        }
        if (reactiveRafRef.current === null) {
          reactiveRafRef.current = window.requestAnimationFrame(sample);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    reactiveRafRef.current = window.requestAnimationFrame(sample);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      if (reactiveRafRef.current !== null) {
        window.cancelAnimationFrame(reactiveRafRef.current);
        reactiveRafRef.current = null;
      }
    };
  }, [enabled, audioReactive, visualEffects, isPlaying]);

  // Detect background playback interruption while audioReactive is enabled
  useEffect(() => {
    if (!enabled || !audioReactive) {
      setAudioReactiveWarning(false);
      return;
    }
    const checkHiddenInterruption = () => {
      if (document.visibilityState === 'hidden' && isPlayingRef.current) {
        window.setTimeout(() => {
          if (
            document.visibilityState === 'hidden' &&
            audioReactiveRef.current &&
            audioRef.current?.paused &&
            !expectedPauseRef.current
          ) {
            setAudioReactiveWarning(true);
            showToast('info', 'قد يوقف الصوت عند إطفاء الشاشة في بعض الهواتف');
          }
        }, 500);
      }
    };
    document.addEventListener('visibilitychange', checkHiddenInterruption);
    return () =>
      document.removeEventListener('visibilitychange', checkHiddenInterruption);
  }, [enabled, audioReactive, showToast]);

  const cancelSleepTimer = useCallback(() => {
    setSleepTimerMinutes(null);
    setSleepTimerEndsAt(null);
    setSleepRemainingSec(0);
  }, []);

  const startSleepTimer = useCallback(
    (minutes: SleepTimerMinutes) => {
      if (!enabled) return;
      const endsAt = Date.now() + minutes * 60 * 1000;
      setSleepTimerMinutes(minutes);
      setSleepTimerEndsAt(endsAt);
      setSleepRemainingSec(minutes * 60);
      showToast('info', `تم ضبط مؤقّت النوم: إيقاف بعد ${minutes} دقيقة`);
    },
    [enabled, showToast]
  );

  useEffect(() => {
    if (!enabled || !sleepTimerEndsAt) {
      setSleepRemainingSec(0);
      return;
    }

    const tick = () => {
      const remaining = computeSleepTimerRemainingSec(sleepTimerEndsAt, Date.now());
      setSleepRemainingSec(remaining);
      if (remaining <= 0) {
        setSleepTimerMinutes(null);
        setSleepTimerEndsAt(null);
        setSleepRemainingSec(0);
        if (audioRef.current && !audioRef.current.paused) {
          expectedPauseRef.current = true;
          audioRef.current.pause();
          setIsPlaying(false);
          setIsBuffering(false);
          setMusicPlayingActive(false);
          const pos = Number.isFinite(audioRef.current.currentTime)
            ? audioRef.current.currentTime
            : 0;
          const curId = currentTrackIdRef.current;
          if (curId) {
            trackPositionsRef.current[curId] = pos;
          }
          saveMusicPlaybackState({
            positionSec: pos,
            trackPositions: { ...trackPositionsRef.current },
          }).catch(() => {});
        }
        showToast('info', 'انتهى مؤقّت النوم وتم إيقاف التشغيل');
      }
    };

    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [enabled, sleepTimerEndsAt, showToast]);

  useEffect(() => {
    return () => {
      setMusicPlayingActive(false);
      clearSkipTimer();
      revokeAllObjectUrls();
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, [clearSkipTimer, revokeAllObjectUrls]);

  const currentTrack = useMemo(
    () => tracks.find((t) => t.id === currentTrackId) || null,
    [tracks, currentTrackId]
  );

  // Apply volume & muted cleanly whenever state changes
  useEffect(() => {
    if (enabled && audioRef.current) {
      audioRef.current.volume = Math.max(0, Math.min(1, volume));
      audioRef.current.muted = Boolean(isMuted);
    }
  }, [enabled, volume, isMuted]);

  // Helper to record lastPlayedAt timestamp cleanly
  const recordTrackPlayed = useCallback((trackId: string) => {
    const now = Date.now();
    setTracks((prev) =>
      prev.map((t) => (t.id === trackId ? { ...t, lastPlayedAt: now } : t))
    );
    markTrackPlayed(trackId, now).catch(() => {});
  }, []);

  // Ensure volume is never silent when the user explicitly initiates play
  const ensurePlayableVolume = useCallback(() => {
    const res = resolvePlayVolumeState({
      volume: volumeRef.current,
      muted: isMutedRef.current,
      lastNonZeroVolume: lastNonZeroVolumeRef.current,
    });
    if (res.didAutoUnmute) {
      setVolumeState(res.volume);
      volumeRef.current = res.volume;
      setIsMutedState(false);
      isMutedRef.current = false;
      setLastNonZeroVolume(res.lastNonZeroVolume);
      lastNonZeroVolumeRef.current = res.lastNonZeroVolume;
      if (audioRef.current) {
        audioRef.current.volume = res.volume;
        audioRef.current.muted = false;
      }
      saveMusicPlaybackState({
        volume: res.volume,
        muted: false,
        lastNonZeroVolume: res.lastNonZeroVolume,
      }).catch(() => {});
      if (res.toastText) {
        showToast('info', res.toastText);
      }
    }
  }, [showToast]);

  const loadAndPlayTrack = useCallback(
    async (
      track: MusicTrackRecord,
      startSec?: number,
      options?: { preserveMute?: boolean }
    ) => {
      if (!enabled) return;
      const audio = audioRef.current;
      if (!audio) return;

      clearSkipTimer();
      setLastError(null);

      if (!isTrackPlayable(track)) {
        setIsBuffering(false);
        const msg = track.missingFile ? MISSING_FILE_LABEL : 'تعذر التشغيل';
        setLastError(msg);
        showToast('error', msg);
        return;
      }

      if (!options?.preserveMute) {
        ensurePlayableVolume();
      }

      // Save current track position before switching
      const prevId = currentTrackIdRef.current;
      if (prevId && prevId !== track.id && audioRef.current) {
        const prevTrack = tracksRef.current.find((t) => t.id === prevId);
        if (
          prevTrack?.kind === 'file' &&
          Number.isFinite(audioRef.current.currentTime)
        ) {
          trackPositionsRef.current[prevId] = audioRef.current.currentTime;
        }
      }

      setCurrentTrackId(track.id);
      currentTrackIdRef.current = track.id;
      setIsBuffering(true);

      // Keep old Blob URL alive until the new one is playing (flush old pending if any)
      flushPendingRevokeUrl();
      const previousActiveUrl = objectUrlRef.current;

      let sourceUrl = '';
      if (track.kind === 'radio') {
        if (previousActiveUrl) {
          pendingRevokeUrlRef.current = previousActiveUrl;
          objectUrlRef.current = null;
        }
        sourceUrl = track.streamUrl || '';
        setDurationSec(0);
        setPositionSec(0);
      } else {
        const blob = await getMusicBlob(track.id);
        if (!blob) {
          setIsBuffering(false);
          setLastError(MISSING_FILE_LABEL);
          showToast('error', MISSING_FILE_LABEL);
          await refreshLibrary();
          return;
        }
        const resolvedMime = resolveAudioMimeType(
          track.mimeType || blob.type,
          track.fileName || track.title
        );
        const typedBlob =
          blob.type && blob.type.toLowerCase() === resolvedMime
            ? blob
            : new Blob([blob], { type: resolvedMime });

        if (previousActiveUrl) {
          pendingRevokeUrlRef.current = previousActiveUrl;
        }
        sourceUrl = URL.createObjectURL(typedBlob);
        objectUrlRef.current = sourceUrl;
        setDurationSec(track.duration || 0);
      }

      loadedTrackIdRef.current = track.id;
      const savedPos =
        typeof startSec === 'number'
          ? startSec
          : typeof trackPositionsRef.current[track.id] === 'number'
          ? trackPositionsRef.current[track.id]
          : 0;
      const clampedStart =
        track.kind === 'file' &&
        savedPos > 0 &&
        (!track.duration || savedPos < Math.max(0, track.duration - 1.5))
          ? savedPos
          : 0;
      pendingResumePosRef.current = clampedStart;

      expectedPauseRef.current = true;
      audio.src = sourceUrl;
      audio.volume = Math.max(0, Math.min(1, volumeRef.current));
      audio.muted = Boolean(isMutedRef.current);
      setPositionSec(clampedStart);

      saveMusicPlaybackState({
        currentTrackId: track.id,
        positionSec: clampedStart,
        trackPositions: { ...trackPositionsRef.current },
      }).catch(() => {});

      try {
        await audio.play();
        failedChainRef.current.clear();
        expectedPauseRef.current = false;
        setLastError(null);
        recordTrackPlayed(track.id);
      } catch (err) {
        expectedPauseRef.current = false;
        setIsBuffering(false);
        const formatted = formatMediaErrorReason({
          mediaErrorCode: audio.error?.code ?? null,
          mediaErrorMessage: audio.error?.message,
          playError: err,
          mimeType: track.mimeType,
          sizeBytes: track.size,
          fileName: track.fileName,
          isRadio: track.kind === 'radio',
        });
        if (!formatted.isAbort) {
          setIsPlaying(false);
          setMusicPlayingActive(false);
          setLastError(formatted.message);
          showToast('error', formatted.message);
        }
      }
    },
    [
      clearSkipTimer,
      enabled,
      ensurePlayableVolume,
      flushPendingRevokeUrl,
      recordTrackPlayed,
      refreshLibrary,
      showToast,
    ]
  );

  const advanceTrack = useCallback(
    async (direction: 'next' | 'prev', fromAutoErrorOrEnd: boolean = false) => {
      const list = tracksRef.current;
      if (list.length === 0) return;

      const curIdx = list.findIndex((t) => t.id === currentTrackIdRef.current);
      const effectiveRepeat: MusicRepeatMode = fromAutoErrorOrEnd
        ? repeatRef.current
        : repeatRef.current === 'one'
        ? 'all'
        : repeatRef.current;

      const nextIdx = pickNextTrackIndex(
        list,
        curIdx,
        shuffleRef.current,
        effectiveRepeat,
        direction,
        fromAutoErrorOrEnd ? failedChainRef.current : undefined
      );

      if (nextIdx === -1) {
        expectedPauseRef.current = true;
        if (audioRef.current) {
          audioRef.current.pause();
        }
        expectedPauseRef.current = false;
        setIsPlaying(false);
        setIsBuffering(false);
        setMusicPlayingActive(false);
        setPositionSec(0);
        const curId = currentTrackIdRef.current;
        if (curId) trackPositionsRef.current[curId] = 0;
        saveMusicPlaybackState({
          positionSec: 0,
          trackPositions: { ...trackPositionsRef.current },
        }).catch(() => {});
        return;
      }

      if (!fromAutoErrorOrEnd) {
        failedChainRef.current.clear();
      }
      const nextTrack = list[nextIdx];
      await loadAndPlayTrack(nextTrack, fromAutoErrorOrEnd ? 0 : undefined, {
        preserveMute: fromAutoErrorOrEnd,
      });
    },
    [loadAndPlayTrack]
  );

  const playTrackById = useCallback(
    async (trackId: string) => {
      const target = tracksRef.current.find((t) => t.id === trackId);
      if (!target) return;
      failedChainRef.current.clear();
      await loadAndPlayTrack(target);
    },
    [loadAndPlayTrack]
  );

  const togglePlayPause = useCallback(async () => {
    if (!enabled) return;
    const audio = audioRef.current;
    const list = tracksRef.current;
    if (!audio || list.length === 0) {
      showToast('info', 'أضف مقاطع صوتية أو رابط إذاعة أولاً');
      setIsSheetOpen(true);
      return;
    }

    if (isPlayingRef.current || !audio.paused) {
      clearSkipTimer();
      expectedPauseRef.current = true;
      audio.pause();
      setIsPlaying(false);
      setIsBuffering(false);
      setMusicPlayingActive(false);
      const pos = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      const curId = currentTrackIdRef.current;
      if (curId) trackPositionsRef.current[curId] = pos;
      saveMusicPlaybackState({
        positionSec: pos,
        trackPositions: { ...trackPositionsRef.current },
      }).catch(() => {});
      return;
    }

    // Never stay silent when user explicitly taps Play
    ensurePlayableVolume();
    clearSkipTimer();
    setLastError(null);

    const selected = list.find((t) => t.id === currentTrackIdRef.current);
    if (
      selected &&
      loadedTrackIdRef.current === selected.id &&
      audio.src &&
      !audio.error
    ) {
      setIsBuffering(audio.readyState < 3);
      try {
        await audio.play();
        recordTrackPlayed(selected.id);
      } catch (err) {
        setIsBuffering(false);
        const formatted = formatMediaErrorReason({
          mediaErrorCode: audioRef.current?.error?.code ?? null,
          mediaErrorMessage: audioRef.current?.error?.message,
          playError: err,
          mimeType: selected.mimeType,
          sizeBytes: selected.size,
          fileName: selected.fileName,
          isRadio: selected.kind === 'radio',
        });
        if (!formatted.isAbort) {
          setIsPlaying(false);
          setMusicPlayingActive(false);
          setLastError(formatted.message);
          showToast('error', formatted.message);
        }
      }
      return;
    }

    if (selected && isTrackPlayable(selected)) {
      await loadAndPlayTrack(
        selected,
        pendingResumePosRef.current ?? trackPositionsRef.current[selected.id] ?? positionSec
      );
      return;
    }

    const firstPlayable = list.find((t) => isTrackPlayable(t));
    if (!firstPlayable) {
      showToast('error', 'لا توجد مقاطع قابلة للتشغيل');
      setIsSheetOpen(true);
      return;
    }
    await loadAndPlayTrack(firstPlayable, 0);
  }, [
    clearSkipTimer,
    enabled,
    ensurePlayableVolume,
    loadAndPlayTrack,
    positionSec,
    recordTrackPlayed,
    showToast,
  ]);

  const seekTo = useCallback(
    (nextSeconds: number) => {
      const audio = audioRef.current;
      if (!enabled || !audio) return;
      const track = tracksRef.current.find((t) => t.id === currentTrackIdRef.current);
      if (!track || track.kind === 'radio') return;

      const maxDur =
        Number.isFinite(audio.duration) && audio.duration > 0
          ? audio.duration
          : track.duration || durationSec;
      const clamped = Math.max(
        0,
        maxDur > 0 ? Math.min(maxDur, nextSeconds) : nextSeconds
      );

      // Only set currentTime once metadata is loaded (readyState >= 1)
      if (audio.readyState >= 1 && Number.isFinite(audio.duration)) {
        try {
          audio.currentTime = clamped;
          pendingResumePosRef.current = null;
        } catch {
          pendingResumePosRef.current = clamped;
        }
      } else {
        pendingResumePosRef.current = clamped;
      }

      setPositionSec(clamped);
      trackPositionsRef.current[track.id] = clamped;
      saveMusicPlaybackState({
        positionSec: clamped,
        trackPositions: { ...trackPositionsRef.current },
      }).catch(() => {});
    },
    [durationSec, enabled]
  );

  const toggleMute = useCallback(() => {
    const nextMuted = !isMutedRef.current;
    let nextVol = volumeRef.current;
    if (!nextMuted && nextVol <= 0) {
      nextVol =
        lastNonZeroVolumeRef.current > 0 ? lastNonZeroVolumeRef.current : 0.8;
      setVolumeState(nextVol);
      volumeRef.current = nextVol;
    }
    setIsMutedState(nextMuted);
    isMutedRef.current = nextMuted;

    if (audioRef.current) {
      audioRef.current.volume = nextVol;
      audioRef.current.muted = nextMuted;
    }

    saveMusicPlaybackState({
      volume: nextVol,
      muted: nextMuted,
      lastNonZeroVolume: lastNonZeroVolumeRef.current,
    }).catch(() => {});
  }, []);

  const setVolume = useCallback((nextVolume: number) => {
    const clamped = Math.max(0, Math.min(1, nextVolume));
    setVolumeState(clamped);
    volumeRef.current = clamped;

    // Moving slider > 0 unmutes automatically; keep lastNonZeroVolume when > 0
    const nextMuted = clamped > 0 ? false : isMutedRef.current;
    if (clamped > 0) {
      setIsMutedState(false);
      isMutedRef.current = false;
      setLastNonZeroVolume(clamped);
      lastNonZeroVolumeRef.current = clamped;
    }

    if (audioRef.current) {
      audioRef.current.volume = clamped;
      audioRef.current.muted = nextMuted;
    }

    saveMusicPlaybackState({
      volume: clamped,
      muted: nextMuted,
      lastNonZeroVolume: lastNonZeroVolumeRef.current,
    }).catch(() => {});
  }, []);

  const toggleShuffle = useCallback(() => {
    const next = !shuffleRef.current;
    setShuffleState(next);
    shuffleRef.current = next;
    saveMusicPlaybackState({ shuffle: next }).catch(() => {});
  }, []);

  const cycleRepeat = useCallback(() => {
    const cur = repeatRef.current;
    const next: MusicRepeatMode =
      cur === 'off' ? 'all' : cur === 'all' ? 'one' : 'off';
    setRepeatState(next);
    repeatRef.current = next;
    saveMusicPlaybackState({ repeat: next }).catch(() => {});
  }, []);

  // Media Session integration (ONLY when enabled === true)
  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

    try {
      if (currentTrack && typeof MediaMetadata === 'function') {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: currentTrack.title,
          artist:
            currentTrack.kind === 'radio' ? 'بث مباشر' : 'المكتبة الصوتية',
          album: 'نقص الرفوف',
          artwork: [
            {
              src: currentTrack.coverDataUrl || generateMusicArtworkDataUrl(),
              sizes: currentTrack.coverDataUrl ? '160x160' : '256x256',
              type: currentTrack.coverDataUrl ? 'image/jpeg' : 'image/png',
            },
          ],
        });
      } else {
        navigator.mediaSession.metadata = null;
      }
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    } catch {
      // Ignore MediaMetadata failures
    }
  }, [enabled, currentTrack, isPlaying]);

  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

    const ms = navigator.mediaSession;
    const safeHandle = (action: MediaSessionAction, fn: MediaSessionActionHandler) => {
      try {
        ms.setActionHandler(action, fn);
      } catch {
        // Unsupported action on this browser
      }
    };

    safeHandle('play', () => {
      if (!isPlayingRef.current) {
        void togglePlayPause();
      }
    });
    safeHandle('pause', () => {
      if (isPlayingRef.current && audioRef.current) {
        expectedPauseRef.current = true;
        audioRef.current.pause();
        setIsPlaying(false);
        setMusicPlayingActive(false);
      }
    });
    safeHandle('previoustrack', () => {
      void advanceTrack('prev', false);
    });
    safeHandle('nexttrack', () => {
      void advanceTrack('next', false);
    });
    safeHandle('seekto', (details) => {
      if (typeof details.seekTime === 'number') {
        seekTo(details.seekTime);
      }
    });

    return () => {
      clearMediaSession();
    };
  }, [enabled, advanceTrack, clearMediaSession, seekTo, togglePlayPause]);

  // Sync MediaSession position state cleanly
  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    if (typeof ms.setPositionState !== 'function') return;
    if (!currentTrack || currentTrack.kind === 'radio') return;
    if (!Number.isFinite(durationSec) || durationSec <= 0) return;

    try {
      ms.setPositionState({
        duration: durationSec,
        playbackRate: 1,
        position: Math.min(durationSec, Math.max(0, positionSec)),
      });
    } catch {
      // Ignore position state constraint issues
    }
  }, [enabled, currentTrack, durationSec, positionSec]);

  // Audio element DOM event handlers (source of truth for real playback & buffering states)
  const handleAudioLoadedMetadata = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      setDurationSec(audio.duration);
    }
    const resumeAt = pendingResumePosRef.current;
    if (
      typeof resumeAt === 'number' &&
      resumeAt > 0 &&
      Number.isFinite(audio.duration) &&
      resumeAt < audio.duration - 0.5
    ) {
      try {
        audio.currentTime = resumeAt;
        setPositionSec(resumeAt);
      } catch {
        // Ignore seek error
      }
    }
    pendingResumePosRef.current = null;
  }, []);

  const handleAudioTimeUpdate = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const cur = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    setPositionSec(cur);
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      setDurationSec(audio.duration);
    }

    const curId = currentTrackIdRef.current;
    if (curId) {
      trackPositionsRef.current[curId] = cur;
    }

    const now = Date.now();
    if (now - lastSavedPosAtRef.current >= 1500) {
      lastSavedPosAtRef.current = now;
      saveMusicPlaybackState({
        positionSec: cur,
        trackPositions: { ...trackPositionsRef.current },
      }).catch(() => {});
    }
  }, []);

  const handleAudioPlay = useCallback(() => {
    expectedPauseRef.current = false;
    setIsPlaying(true);
    setMusicPlayingActive(true);
  }, []);

  const handleAudioPlaying = useCallback(() => {
    expectedPauseRef.current = false;
    setIsPlaying(true);
    setIsBuffering(false);
    setLastError(null);
    setMusicPlayingActive(true);
    // Revoke any previous Blob URL ONLY AFTER the new source is playing
    flushPendingRevokeUrl();
  }, [flushPendingRevokeUrl]);

  const handleAudioCanPlay = useCallback(() => {
    setIsBuffering(false);
  }, []);

  const handleAudioWaitingOrStalled = useCallback(() => {
    const audio = audioRef.current;
    if (audio && !audio.ended) {
      setIsBuffering(true);
    }
  }, []);

  const handleAudioPause = useCallback(() => {
    expectedPauseRef.current = false;
    setIsPlaying(false);
    setIsBuffering(false);
    setMusicPlayingActive(false);
    const cur =
      audioRef.current && Number.isFinite(audioRef.current.currentTime)
        ? audioRef.current.currentTime
        : 0;
    const curId = currentTrackIdRef.current;
    if (curId) {
      trackPositionsRef.current[curId] = cur;
    }
    saveMusicPlaybackState({
      positionSec: cur,
      trackPositions: { ...trackPositionsRef.current },
    }).catch(() => {});
  }, []);

  const handleAudioEnded = useCallback(() => {
    setIsBuffering(false);
    const curTrack = tracksRef.current.find(
      (t) => t.id === currentTrackIdRef.current
    );
    if (curTrack) {
      trackPositionsRef.current[curTrack.id] = 0;
    }
    if (repeatRef.current === 'one' && curTrack && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch((err) => {
        setIsPlaying(false);
        setMusicPlayingActive(false);
        const formatted = formatMediaErrorReason({
          mediaErrorCode: audioRef.current?.error?.code ?? null,
          mediaErrorMessage: audioRef.current?.error?.message,
          playError: err,
          mimeType: curTrack.mimeType,
          sizeBytes: curTrack.size,
          fileName: curTrack.fileName,
          isRadio: curTrack.kind === 'radio',
        });
        if (!formatted.isAbort) {
          setLastError(formatted.message);
        }
      });
      return;
    }
    setIsPlaying(false);
    setMusicPlayingActive(false);
    void advanceTrack('next', true);
  }, [advanceTrack]);

  const handleAudioError = useCallback(() => {
    const audio = audioRef.current;
    const curTrack = tracksRef.current.find(
      (t) => t.id === currentTrackIdRef.current
    );
    if (!curTrack || !audio) return;

    setIsPlaying(false);
    setIsBuffering(false);
    setMusicPlayingActive(false);

    const formatted = formatMediaErrorReason({
      mediaErrorCode: audio.error?.code ?? null,
      mediaErrorMessage: audio.error?.message,
      mimeType: curTrack.mimeType,
      sizeBytes: curTrack.size,
      fileName: curTrack.fileName,
      isRadio: curTrack.kind === 'radio',
    });
    const errorText = formatted.message || 'تعذر التشغيل';
    setLastError(errorText);
    showToast('error', errorText);

    if (curTrack.kind === 'radio' || !formatted.isDecodeOrSourceError) {
      return;
    }

    // Decode or source not supported error on file -> skip to next track after 2 seconds
    clearSkipTimer();
    failedChainRef.current.add(curTrack.id);
    const curIdx = tracksRef.current.findIndex((t) => t.id === curTrack.id);
    const nextPlayable = pickNextTrackIndex(
      tracksRef.current,
      curIdx,
      shuffleRef.current,
      repeatRef.current === 'off' ? 'all' : repeatRef.current,
      'next',
      failedChainRef.current
    );

    if (nextPlayable !== -1) {
      const nextTrack = tracksRef.current[nextPlayable];
      skipErrorTimerRef.current = window.setTimeout(() => {
        skipErrorTimerRef.current = null;
        if (currentTrackIdRef.current === curTrack.id) {
          void loadAndPlayTrack(nextTrack, 0, { preserveMute: true });
        }
      }, 2000);
    } else {
      failedChainRef.current.clear();
    }
  }, [clearSkipTimer, loadAndPlayTrack, showToast]);

  const getDiagnosticsSnapshot = useCallback((): MusicPlaybackDiagnostics => {
    const audio = audioRef.current;
    const tr = tracksRef.current.find((t) => t.id === currentTrackIdRef.current);
    return {
      trackTitle: tr?.title || 'لا يوجد',
      fileName: tr?.fileName || (tr?.kind === 'radio' ? tr.streamUrl || '' : ''),
      mimeType: tr?.mimeType || '',
      resolvedMimeType: tr
        ? tr.kind === 'radio'
          ? 'بث مباشر'
          : resolveAudioMimeType(tr.mimeType, tr.fileName || tr.title)
        : 'غير محدد',
      sizeBytes: tr?.size || 0,
      durationSec:
        audio && Number.isFinite(audio.duration) && audio.duration > 0
          ? audio.duration
          : tr?.duration || 0,
      readyState: audio ? audio.readyState : 0,
      networkState: audio ? audio.networkState : 0,
      volume: audio ? audio.volume : volumeRef.current,
      muted: audio ? audio.muted : isMutedRef.current,
      paused: audio ? audio.paused : true,
      ended: audio ? audio.ended : false,
      lastError: lastErrorRef.current,
    };
  }, []);

  // Library mutations (sequential non-blocking import with duplicate check & progress)
  const addFiles = useCallback(
    async (files: File[]) => {
      const capMb = maxStorageMb > 0 ? maxStorageMb : DEFAULT_MUSIC_MAX_STORAGE_MB;
      const wasPlayingBeforeImport = isPlayingRef.current;

      importCancelRef.current = false;
      importBusyRef.current = true;
      setImportReport(null);

      let lastRefreshAt = 0;
      const result = await addAudioFilesToLibrary(files, capMb, {
        onProgress: (prog) => setImportProgress(prog),
        shouldCancel: () => importCancelRef.current,
        onTrackWritten: () => {
          const now = Date.now();
          if (now - lastRefreshAt >= 280) {
            lastRefreshAt = now;
            void refreshLibrary();
          }
        },
      });

      importBusyRef.current = false;
      setImportProgress(null);
      await refreshLibrary();

      const countAdded =
        result.addedTracks.length + result.reattachedTracks.length;

      setImportReport({
        addedCount: countAdded,
        skippedDuplicatesCount: result.skippedDuplicatesCount,
        failedCount: result.failedCount,
        cancelled: result.cancelled,
        failedFiles: result.failedFiles,
        summaryText: result.summaryText,
      });

      if (countAdded > 0) {
        showToast('info', `تمت إضافة ${countAdded} ملف صوتي للمكتبة`);
        const firstNewTrack =
          result.addedTracks[0] || result.reattachedTracks[0] || null;
        if (firstNewTrack && !wasPlayingBeforeImport && !isPlayingRef.current) {
          await loadAndPlayTrack(firstNewTrack, 0);
        }
      } else if (result.rejectedOverLimit && result.rejectedReason) {
        showToast('error', result.rejectedReason);
      } else if (result.skippedDuplicatesCount > 0 || result.failedCount > 0) {
        showToast('info', result.summaryText);
      }
      return result;
    },
    [loadAndPlayTrack, maxStorageMb, refreshLibrary, showToast]
  );

  const cancelImport = useCallback(() => {
    if (importBusyRef.current) {
      importCancelRef.current = true;
    }
  }, []);

  const dismissImportReport = useCallback(() => {
    setImportReport(null);
  }, []);

  const reattachFile = useCallback(
    async (trackId: string, file: File) => {
      const capMb = maxStorageMb > 0 ? maxStorageMb : DEFAULT_MUSIC_MAX_STORAGE_MB;
      const res = await reattachMissingAudioFile(trackId, file, capMb);
      await refreshLibrary();
      if (!res.ok && res.error) {
        showToast('error', res.error);
      } else if (res.ok) {
        showToast('info', 'تمت استعادة الملف الصوتي بنجاح');
      }
      return res;
    },
    [maxStorageMb, refreshLibrary, showToast]
  );

  const addRadio = useCallback(
    async (title: string, streamUrl: string) => {
      const station = await addRadioStationToLibrary(title, streamUrl);
      await refreshLibrary();
      showToast('info', `تمت إضافة الإذاعة: ${station.title}`);
      return station;
    },
    [refreshLibrary, showToast]
  );

  const renameTrack = useCallback(
    async (trackId: string, newTitle: string) => {
      await renameMusicTrack(trackId, newTitle);
      await refreshLibrary();
    },
    [refreshLibrary]
  );

  const toggleFavorite = useCallback(
    async (trackId: string) => {
      await toggleTrackFavorite(trackId);
      await refreshLibrary();
    },
    [refreshLibrary]
  );

  const updateTrackCover = useCallback(
    async (trackId: string, file: File | null) => {
      if (!file) {
        await updateTrackCoverDataUrl(trackId, undefined);
        await refreshLibrary();
        return;
      }
      const compressed = await compressCoverBlobToDataUrl(file, 160);
      if (!compressed) {
        showToast('error', 'تعذر قراءة صورة الغلاف');
        return;
      }
      await updateTrackCoverDataUrl(trackId, compressed);
      await refreshLibrary();
    },
    [refreshLibrary, showToast]
  );

  const setTrackTileColor = useCallback(
    async (trackId: string, colorId: string | undefined) => {
      await updateTrackTileColor(trackId, colorId);
      await refreshLibrary();
    },
    [refreshLibrary]
  );

  const toggleTrackInList = useCallback(
    async (trackId: string, listId: string) => {
      await toggleTrackListMembership(trackId, listId);
      await refreshLibrary();
    },
    [refreshLibrary]
  );

  const createList = useCallback(
    async (name: string) => {
      const created = await createMusicList(name);
      await refreshLibrary();
      return created;
    },
    [refreshLibrary]
  );

  const renameList = useCallback(
    async (listId: string, newName: string) => {
      await renameMusicList(listId, newName);
      await refreshLibrary();
    },
    [refreshLibrary]
  );

  const deleteList = useCallback(
    async (listId: string) => {
      await deleteMusicList(listId);
      await refreshLibrary();
    },
    [refreshLibrary]
  );

  const reorderTrack = useCallback(
    async (trackId: string, direction: 'up' | 'down') => {
      await reorderMusicTrack(trackId, direction);
      await refreshLibrary();
    },
    [refreshLibrary]
  );

  const deleteTrack = useCallback(
    async (trackId: string) => {
      if (currentTrackIdRef.current === trackId && audioRef.current) {
        clearSkipTimer();
        expectedPauseRef.current = true;
        audioRef.current.pause();
        audioRef.current.removeAttribute('src');
        audioRef.current.load();
        expectedPauseRef.current = false;
        revokeAllObjectUrls();
        loadedTrackIdRef.current = null;
        setIsPlaying(false);
        setIsBuffering(false);
        setLastError(null);
        setMusicPlayingActive(false);
        setPositionSec(0);
        setDurationSec(0);
      }
      delete trackPositionsRef.current[trackId];
      await deleteMusicTrack(trackId);
      await refreshLibrary();
    },
    [clearSkipTimer, refreshLibrary, revokeAllObjectUrls]
  );

  const clearLibrary = useCallback(async () => {
    clearSkipTimer();
    if (audioRef.current) {
      expectedPauseRef.current = true;
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      audioRef.current.load();
      expectedPauseRef.current = false;
    }
    revokeAllObjectUrls();
    loadedTrackIdRef.current = null;
    trackPositionsRef.current = {};
    setCurrentTrackId(null);
    setIsPlaying(false);
    setIsBuffering(false);
    setLastError(null);
    setMusicPlayingActive(false);
    setPositionSec(0);
    setDurationSec(0);
    await clearMusicLibrary();
    await refreshLibrary();
    showToast('info', 'تم حذف المكتبة الصوتية بالكامل');
  }, [clearSkipTimer, refreshLibrary, revokeAllObjectUrls, showToast]);

  const effectivelyMuted = isMuted || volume <= 0;

  return {
    audioRef,
    tracks,
    lists,
    storageStats,
    currentTrack,
    currentTrackId,
    isPlaying,
    isBuffering,
    lastError,
    positionSec,
    durationSec,
    volume,
    isMuted: effectivelyMuted,
    shuffle,
    repeat,
    toast,
    isSheetOpen,
    setIsSheetOpen,
    sleepTimerMinutes,
    sleepRemainingSec,
    startSleepTimer,
    cancelSleepTimer,
    importProgress,
    importReport,
    cancelImport,
    dismissImportReport,
    reactiveLevels,
    audioReactiveWarning,
    dismissToast: () => setToast(null),
    playTrackById,
    togglePlayPause,
    playNext: () => advanceTrack('next', false),
    playPrev: () => advanceTrack('prev', false),
    seekTo,
    setVolume,
    toggleMute,
    toggleShuffle,
    cycleRepeat,
    addFiles,
    reattachFile,
    addRadio,
    renameTrack,
    toggleFavorite,
    updateTrackCover,
    setTrackTileColor,
    toggleTrackInList,
    createList,
    renameList,
    deleteList,
    reorderTrack,
    deleteTrack,
    clearLibrary,
    refreshLibrary,
    getDiagnosticsSnapshot,
    audioEvents: {
      onLoadedMetadata: handleAudioLoadedMetadata,
      onTimeUpdate: handleAudioTimeUpdate,
      onPlay: handleAudioPlay,
      onPlaying: handleAudioPlaying,
      onCanPlay: handleAudioCanPlay,
      onWaiting: handleAudioWaitingOrStalled,
      onStalled: handleAudioWaitingOrStalled,
      onPause: handleAudioPause,
      onEnded: handleAudioEnded,
      onError: handleAudioError,
    },
  };
}
