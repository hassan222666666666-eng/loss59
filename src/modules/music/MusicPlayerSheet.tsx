import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  FilePlus2,
  FolderPlus,
  ImagePlus,
  ListMusic,
  Loader2,
  Moon,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  Radio,
  Repeat,
  Repeat1,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  Star,
  Stethoscope,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { formatBytesArabic } from '../../utils/arabicText';
import { TRACK_TILE_COLORS } from './coverArt';
import {
  AUDIO_PICKER_ACCEPT,
  MusicAudioImporterTrigger,
  MusicImportStatusPanel,
} from './MusicAudioImporter';
import { MusicDiagnosticsModal } from './MusicDiagnosticsModal';
import { MusicEqualizer } from './MusicEqualizer';
import {
  filterTracksByTabAndQuery,
  formatAudioTime,
  formatSleepTimerBadge,
  generateMusicArtworkDataUrl,
  getRecentPlayedTracks,
  isValidRadioUrl,
  MISSING_FILE_LABEL,
  SEARCH_BAR_TRACK_THRESHOLD,
  SLEEP_TIMER_PRESETS_MIN,
  SleepTimerMinutes,
} from './musicLogic';
import { TrackCoverTile } from './TrackCoverTile';
import {
  MusicAddFilesResult,
  MusicCustomList,
  MusicImportProgress,
  MusicImportReport,
  MusicLibraryTab,
  MusicPlaybackDiagnostics,
  MusicRepeatMode,
  MusicStorageStats,
  MusicTrackRecord,
} from './types';

interface MusicPlayerSheetProps {
  open: boolean;
  onClose: () => void;
  tracks: MusicTrackRecord[];
  lists: MusicCustomList[];
  storageStats: MusicStorageStats;
  maxStorageMb: number;
  currentTrack: MusicTrackRecord | null;
  currentTrackId: string | null;
  isPlaying: boolean;
  isBuffering: boolean;
  lastError: string | null;
  positionSec: number;
  durationSec: number;
  volume: number;
  isMuted: boolean;
  shuffle: boolean;
  repeat: MusicRepeatMode;
  sleepTimerMinutes: SleepTimerMinutes | null;
  sleepRemainingSec: number;
  importProgress: MusicImportProgress | null;
  importReport: MusicImportReport | null;
  onCancelImport: () => void;
  onDismissImportReport: () => void;
  onPlayTrack: (trackId: string) => void;
  onTogglePlayPause: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSeek: (sec: number) => void;
  onVolumeChange: (vol: number) => void;
  onToggleMute: () => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onStartSleepTimer: (minutes: SleepTimerMinutes) => void;
  onCancelSleepTimer: () => void;
  onAddFiles: (files: File[]) => Promise<MusicAddFilesResult>;
  onReattachFile: (
    trackId: string,
    file: File
  ) => Promise<{ ok: boolean; error?: string }>;
  onAddRadio: (title: string, streamUrl: string) => Promise<MusicTrackRecord>;
  onRenameTrack: (trackId: string, title: string) => Promise<void>;
  onToggleFavorite: (trackId: string) => Promise<void>;
  onUpdateTrackCover: (trackId: string, file: File | null) => Promise<void>;
  onSetTrackTileColor: (
    trackId: string,
    colorId: string | undefined
  ) => Promise<void>;
  onToggleTrackInList: (trackId: string, listId: string) => Promise<void>;
  onAddTracksToList?: (listId: string, trackIds: string[]) => Promise<number>;
  onCreateList: (name: string) => Promise<MusicCustomList>;
  onDeleteList: (listId: string) => Promise<void>;
  onReorderTrack: (trackId: string, dir: 'up' | 'down') => Promise<void>;
  onDeleteTrack: (trackId: string) => Promise<void>;
  onGetDiagnostics: () => MusicPlaybackDiagnostics;
  batterySaverOn?: boolean;
}

export const MusicPlayerSheet: React.FC<MusicPlayerSheetProps> = ({
  open,
  onClose,
  tracks,
  lists,
  storageStats,
  maxStorageMb,
  currentTrack,
  currentTrackId,
  isPlaying,
  isBuffering,
  lastError,
  positionSec,
  durationSec,
  volume,
  isMuted,
  shuffle,
  repeat,
  sleepTimerMinutes,
  sleepRemainingSec,
  importProgress,
  importReport,
  onCancelImport,
  onDismissImportReport,
  onPlayTrack,
  onTogglePlayPause,
  onNext,
  onPrev,
  onSeek,
  onVolumeChange,
  onToggleMute,
  onToggleShuffle,
  onCycleRepeat,
  onStartSleepTimer,
  onCancelSleepTimer,
  onAddFiles,
  onReattachFile,
  onAddRadio,
  onRenameTrack,
  onToggleFavorite,
  onUpdateTrackCover,
  onSetTrackTileColor,
  onToggleTrackInList,
  onAddTracksToList,
  onCreateList,
  onDeleteList,
  onReorderTrack,
  onDeleteTrack,
  onGetDiagnostics,
  batterySaverOn = false,
}) => {
  const reattachInputRef = useRef<HTMLInputElement | null>(null);
  const reattachTargetIdRef = useRef<string | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const coverTargetIdRef = useRef<string | null>(null);
  const bodyScrollRef = useRef<HTMLDivElement | null>(null);
  const sleepSectionRef = useRef<HTMLElement | null>(null);

  const [activeTab, setActiveTab] = useState<MusicLibraryTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showRadioForm, setShowRadioForm] = useState(false);
  const [radioTitle, setRadioTitle] = useState('');
  const [radioUrl, setRadioUrl] = useState('');
  const [radioError, setRadioError] = useState<string | null>(null);

  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const [diagnosticsData, setDiagnosticsData] =
    useState<MusicPlaybackDiagnostics | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const [showNewListForm, setShowNewListForm] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [multiAddListId, setMultiAddListId] = useState<string | null>(null);
  const [multiAddSelectedIds, setMultiAddSelectedIds] = useState<string[]>([]);
  const [multiAddQuery, setMultiAddQuery] = useState('');
  const [multiAddBusy, setMultiAddBusy] = useState(false);

  const [openMenuTrackId, setOpenMenuTrackId] = useState<string | null>(null);
  const [renamingTrackId, setRenamingTrackId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [busyImport, setBusyImport] = useState(false);
  const [isDraggingVolume, setIsDraggingVolume] = useState(false);
  const [isCompactSticky, setIsCompactSticky] = useState(false);
  const [isPageHidden, setIsPageHidden] = useState(() =>
    typeof document !== 'undefined' ? document.visibilityState === 'hidden' : false
  );

  useEffect(() => {
    if (!open) return;
    const onVis = () => setIsPageHidden(document.visibilityState === 'hidden');
    onVis();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [open]);

  // Swipe-down to dismiss sheet from header handle
  const swipeStartYRef = useRef<number | null>(null);
  const [swipeOffsetY, setSwipeOffsetY] = useState(0);

  const recentTracks = useMemo(() => getRecentPlayedTracks(tracks, 8), [tracks]);
  const showSearchBox = tracks.length >= SEARCH_BAR_TRACK_THRESHOLD;
  const filteredTracks = useMemo(
    () => filterTracksByTabAndQuery(tracks, { tab: activeTab, query: searchQuery }),
    [tracks, activeTab, searchQuery]
  );

  // Reset tab cleanly if active custom list was deleted
  useEffect(() => {
    if (activeTab.startsWith('list:')) {
      const listId = activeTab.slice(5);
      if (!lists.some((l) => l.id === listId)) {
        setActiveTab('all');
      }
    }
  }, [activeTab, lists]);

  useEffect(() => {
    setMultiAddListId(null);
    setMultiAddSelectedIds([]);
    setMultiAddQuery('');
  }, [activeTab]);

  useEffect(() => {
    if (!open) {
      setSwipeOffsetY(0);
      swipeStartYRef.current = null;
      setShowHeaderMenu(false);
      setOpenMenuTrackId(null);
      setIsCompactSticky(false);
      setMultiAddListId(null);
      setMultiAddSelectedIds([]);
      setMultiAddQuery('');
    }
  }, [open]);

  const artworkUrl = useMemo(() => generateMusicArtworkDataUrl(), []);

  if (!open) return null;

  const isRadioCurrent = currentTrack?.kind === 'radio';
  const currentIdx = currentTrackId
    ? tracks.findIndex((t) => t.id === currentTrackId)
    : -1;
  const trackPositionText =
    tracks.length === 0
      ? 'القائمة فارغة'
      : currentIdx >= 0
      ? `${currentIdx + 1} من ${tracks.length}`
      : `0 من ${tracks.length}`;

  const displayTitle = currentTrack ? currentTrack.title : 'لم يتم اختيار مقطع';

  const effectiveDuration =
    !isRadioCurrent && Number.isFinite(durationSec) && durationSec > 0
      ? durationSec
      : !isRadioCurrent && currentTrack?.duration
      ? currentTrack.duration
      : 0;
  const clampedPos =
    effectiveDuration > 0
      ? Math.min(effectiveDuration, Math.max(0, positionSec))
      : 0;

  const volumePercent = Math.round((isMuted ? 0 : volume) * 100);
  const showMutedChip = isPlaying && isMuted;

  const handleBodyScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.scrollTop;
    setIsCompactSticky((prev) => {
      if (!prev && top > 250) return true;
      if (prev && top < 180) return false;
      return prev;
    });
  };

  const handleHeaderTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    if ((e.target as HTMLElement).closest('button, input, [data-no-sheet-drag="true"]')) return;
    swipeStartYRef.current = e.touches[0].clientY;
  };

  const handleHeaderTouchMove = (e: React.TouchEvent) => {
    if (swipeStartYRef.current === null || e.touches.length !== 1) return;
    const dy = e.touches[0].clientY - swipeStartYRef.current;
    if (dy > 0) {
      setSwipeOffsetY(dy);
    }
  };

  const handleHeaderTouchEnd = () => {
    if (swipeOffsetY > 75) {
      setSwipeOffsetY(0);
      swipeStartYRef.current = null;
      onClose();
      return;
    }
    setSwipeOffsetY(0);
    swipeStartYRef.current = null;
  };

  const handleHeaderPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') return;
    if ((e.target as HTMLElement).closest('button, input, [data-no-sheet-drag="true"]')) return;
    swipeStartYRef.current = e.clientY;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore capture errors
    }
  };

  const handleHeaderPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' || swipeStartYRef.current === null) return;
    const dy = e.clientY - swipeStartYRef.current;
    if (dy > 0) {
      setSwipeOffsetY(dy);
    }
  };

  const handleHeaderPointerUp = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') return;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore release errors
    }
    handleHeaderTouchEnd();
  };

  const handleReattachSelected = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const targetId = reattachTargetIdRef.current;
    reattachTargetIdRef.current = null;
    if (!file || !targetId) return;
    setBusyImport(true);
    try {
      await onReattachFile(targetId, file);
    } finally {
      setBusyImport(false);
    }
  };

  const handleCoverSelected = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const targetId = coverTargetIdRef.current;
    coverTargetIdRef.current = null;
    if (!file || !targetId) return;
    await onUpdateTrackCover(targetId, file);
  };

  const handleAddRadioSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidRadioUrl(radioUrl)) {
      setRadioError('أدخل رابط بث مباشر يبدأ بـ http:// أو https://');
      return;
    }
    setRadioError(null);
    try {
      await onAddRadio(radioTitle.trim() || 'إذاعة مباشرة', radioUrl.trim());
      setRadioTitle('');
      setRadioUrl('');
      setShowRadioForm(false);
    } catch (err) {
      setRadioError(
        err instanceof Error && err.message ? err.message : 'تعذر إضافة الإذاعة'
      );
    }
  };

  const handleStartRename = (track: MusicTrackRecord) => {
    setOpenMenuTrackId(null);
    setRenamingTrackId(track.id);
    setRenameDraft(track.title);
  };

  const handleCommitRename = async (trackId: string) => {
    const trimmed = renameDraft.trim();
    if (trimmed) {
      await onRenameTrack(trackId, trimmed);
    }
    setRenamingTrackId(null);
    setRenameDraft('');
  };

  const handleCreateListSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newListName.trim();
    if (!trimmed) return;
    const created = await onCreateList(trimmed);
    setNewListName('');
    setShowNewListForm(false);
    setActiveTab(`list:${created.id}`);
  };

  const activeListObj = activeTab.startsWith('list:')
    ? lists.find((l) => l.id === activeTab.slice(5)) || null
    : null;

  return (
    <div
      data-testid="music-player-backdrop"
      className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm flex items-end justify-center"
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-label="المشغّل"
      onClick={onClose}
    >
      <div
        data-testid="music-player-sheet"
        onClick={(e) => e.stopPropagation()}
        style={
          swipeOffsetY > 0
            ? { transform: `translateY(${swipeOffsetY}px)` }
            : undefined
        }
        className={`w-full max-w-2xl h-[78dvh] min-h-[360px] max-h-[90dvh] bg-[#F7F8FA] dark:bg-slate-950 rounded-t-3xl border-t border-slate-200/80 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden pb-[env(safe-area-inset-bottom,0px)] transition-transform duration-150 ${
          batterySaverOn || isPageHidden ? 'music-animations-paused' : ''
        }`}
      >
        {/* Hidden inputs for reattach audio & custom cover */}
        <input
          ref={reattachInputRef}
          type="file"
          accept={AUDIO_PICKER_ACCEPT}
          onChange={handleReattachSelected}
          className="hidden"
        />
        <input
          ref={coverInputRef}
          data-testid="music-cover-file-input"
          type="file"
          accept="image/*"
          onChange={handleCoverSelected}
          className="hidden"
        />

        {/* Drag Handle & Sheet Header */}
        <div
          data-testid="music-sheet-header"
          onTouchStart={handleHeaderTouchStart}
          onTouchMove={handleHeaderTouchMove}
          onTouchEnd={handleHeaderTouchEnd}
          onPointerDown={handleHeaderPointerDown}
          onPointerMove={handleHeaderPointerMove}
          onPointerUp={handleHeaderPointerUp}
          onPointerCancel={handleHeaderPointerUp}
          className="pt-2.5 px-4 pb-2.5 bg-white dark:bg-slate-900 border-b border-slate-200/80 dark:border-slate-800 shrink-0 select-none touch-none"
        >
          <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700 mx-auto mb-2" />
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-extrabold text-slate-900 dark:text-white">
              المشغّل
            </h2>

            <div className="flex items-center gap-1.5">
              {/* "+ إضافة" */}
              <MusicAudioImporterTrigger
                variant="header-plus"
                disabled={busyImport || Boolean(importProgress)}
                onSelectFiles={onAddFiles}
                showSavedNote={false}
              />

              {/* Header "⋯" Menu */}
              <div className="relative" data-no-sheet-drag="true">
                <button
                  type="button"
                  data-testid="music-header-more-btn"
                  aria-label="خيارات المشغّل"
                  onClick={() => setShowHeaderMenu((v) => !v)}
                  className="min-w-[44px] min-h-[44px] rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center active:scale-95 transition"
                >
                  <MoreHorizontal className="w-5 h-5" />
                </button>

                {showHeaderMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-30"
                      onClick={() => setShowHeaderMenu(false)}
                    />
                    <div
                      data-testid="music-header-more-menu"
                      className="absolute left-0 top-12 z-40 w-56 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-1.5 space-y-1 text-xs font-extrabold"
                    >
                      <button
                        type="button"
                        data-testid="music-open-diagnostics-btn"
                        onClick={() => {
                          setShowHeaderMenu(false);
                          setDiagnosticsData(onGetDiagnostics());
                          setShowDiagnostics(true);
                        }}
                        className="w-full min-h-[44px] px-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 flex items-center gap-2.5"
                      >
                        <Stethoscope className="w-4 h-4 text-emerald-500 shrink-0" />
                        <span>تشخيص التشغيل</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setShowHeaderMenu(false);
                          sleepSectionRef.current?.scrollIntoView({
                            behavior: 'smooth',
                            block: 'nearest',
                          });
                        }}
                        className="w-full min-h-[44px] px-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 flex items-center justify-between gap-2"
                      >
                        <span className="flex items-center gap-2.5">
                          <Moon className="w-4 h-4 text-emerald-500 shrink-0" />
                          <span>مؤقّت النوم</span>
                        </span>
                        {sleepRemainingSec > 0 && (
                          <span
                            dir="ltr"
                            className="text-[11px] font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums"
                          >
                            {formatSleepTimerBadge(sleepRemainingSec)}
                          </span>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setShowHeaderMenu(false);
                          setShowRadioForm((prev) => !prev);
                        }}
                        className="w-full min-h-[44px] px-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 flex items-center gap-2.5"
                      >
                        <Radio className="w-4 h-4 text-emerald-500 shrink-0" />
                        <span>إضافة رابط إذاعة</span>
                      </button>
                    </div>
                  </>
                )}
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="إغلاق المشغّل"
                className="min-w-[44px] min-h-[44px] rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center active:scale-95 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        {/* Sticky Collapsed Now-Playing Mini Bar when scrolled down */}
        {tracks.length > 0 && isCompactSticky && (
          <div
            data-testid="music-sticky-mini-bar"
            className="px-4 py-2 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 flex items-center gap-2.5 shrink-0 shadow-sm"
          >
            <TrackCoverTile
              track={currentTrack}
              sizeClass="w-10 h-10"
              textClass="text-sm"
              roundedClass="rounded-xl"
              showMissingBadge={false}
            />
            <div className="flex-1 min-w-0">
              <div
                dir="auto"
                className="text-xs font-extrabold text-slate-900 dark:text-white truncate"
              >
                {displayTitle}
              </div>
              <div className="flex items-center gap-2 text-[11px] font-bold text-slate-500 dark:text-slate-400">
                <span className="tabular-nums">{trackPositionText}</span>
                {showMutedChip && (
                  <span className="px-1.5 py-0.5 rounded-md bg-amber-500 text-white text-[10px] font-extrabold">
                    الصوت مكتوم
                  </span>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={onTogglePlayPause}
              aria-label={isPlaying ? 'إيقاف مؤقت' : 'تشغيل'}
              className="w-11 h-11 rounded-full bg-emerald-500 text-white shadow-sm flex items-center justify-center active:scale-95 transition shrink-0"
            >
              {isBuffering ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : isPlaying ? (
                <Pause className="w-5 h-5" />
              ) : (
                <Play className="w-5 h-5 translate-x-[1px]" />
              )}
            </button>
          </div>
        )}

        {/* Scrollable Body */}
        <div
          ref={bodyScrollRef}
          onScroll={handleBodyScroll}
          className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
        >
          <MusicImportStatusPanel
            progress={importProgress}
            report={importReport}
            onCancelImport={onCancelImport}
            onDismissReport={onDismissImportReport}
          />

          {tracks.length === 0 ? (
            <section
              data-testid="music-empty-state"
              className="bg-white dark:bg-slate-900 rounded-[24px] p-6 border border-slate-200/80 dark:border-slate-800 shadow-sm text-center space-y-4"
            >
              <div className="w-24 h-24 rounded-3xl mx-auto overflow-hidden shadow-sm border border-slate-200/70 dark:border-slate-700">
                <img
                  src={artworkUrl}
                  alt="غلاف المشغّل الصوتي"
                  className="w-full h-full object-cover"
                />
              </div>

              <div className="space-y-1">
                <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                  مكتبتك الصوتية فارغة
                </h3>
                <p className="text-xs font-bold text-slate-500 dark:text-slate-400 leading-relaxed">
                  تبقى الملفات الصوتية محفوظة داخل التطبيق حتى تحذفها بنفسك.
                </p>
              </div>

              <MusicAudioImporterTrigger
                variant="empty-primary"
                buttonText="أضف أول ملفاتك الصوتية"
                disabled={busyImport || Boolean(importProgress)}
                onSelectFiles={onAddFiles}
                showSavedNote
              />

              <button
                type="button"
                onClick={() => setShowRadioForm((prev) => !prev)}
                className="w-full min-h-[44px] px-3 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-extrabold text-xs flex items-center justify-center gap-2 active:scale-95 transition"
              >
                <Radio className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>أو إضافة رابط إذاعة</span>
              </button>
            </section>
          ) : (
            <>
              {/* Now-Playing Card */}
              <section
                data-testid="music-now-playing-card"
                className="bg-white dark:bg-slate-900 rounded-[22px] p-4 border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-3.5"
              >
                {/* Cover (96px) + 2-line dir="auto" Title + Metadata + Muted Chip + Error */}
                <div className="flex items-start gap-3.5 min-w-0">
                  <TrackCoverTile
                    track={currentTrack}
                    sizeClass="w-24 h-24"
                    textClass="text-3xl"
                    roundedClass="rounded-2xl"
                  />

                  <div className="flex-1 min-w-0 space-y-1 pt-0.5">
                    <h3
                      dir="auto"
                      data-testid="music-now-playing-title"
                      className="text-base font-extrabold text-slate-900 dark:text-white line-clamp-2 leading-snug break-words"
                    >
                      {displayTitle}
                    </h3>

                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        data-testid="music-track-counter"
                        className="text-xs font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums"
                      >
                        {trackPositionText}
                      </span>

                      {showMutedChip && (
                        <span
                          data-testid="music-player-muted-chip"
                          className="px-2 py-0.5 rounded-full bg-amber-500 text-white text-[11px] font-extrabold shadow-xs"
                        >
                          الصوت مكتوم
                        </span>
                      )}
                    </div>

                    {currentTrack ? (
                      currentTrack.missingFile ? (
                        <div className="text-[11px] font-bold text-amber-600 dark:text-amber-400">
                          {MISSING_FILE_LABEL}
                        </div>
                      ) : isRadioCurrent ? (
                        <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                          بث مباشر (إذاعة)
                        </div>
                      ) : currentTrack.fileName ? (
                        <div
                          dir="auto"
                          className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 truncate"
                        >
                          {currentTrack.fileName}
                        </div>
                      ) : null
                    ) : (
                      <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                        اختر مقطعاً للتشغيل
                      </div>
                    )}

                    {lastError && (
                      <div
                        data-testid="music-playback-error"
                        className="mt-1 px-2.5 py-1.5 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-[11px] font-extrabold text-red-700 dark:text-red-300 leading-snug"
                      >
                        {lastError}
                      </div>
                    )}

                    {currentTrack?.missingFile && (
                      <button
                        type="button"
                        onClick={() => {
                          reattachTargetIdRef.current = currentTrack.id;
                          reattachInputRef.current?.click();
                        }}
                        className="mt-1 min-h-[36px] px-3 rounded-xl bg-amber-500 text-white text-xs font-extrabold"
                      >
                        أعد إضافته
                      </button>
                    )}
                  </div>
                </div>

                {/* Seek Bar + Times */}
                <div className="space-y-1">
                  <input
                    type="range"
                    dir="ltr"
                    data-testid="music-seek-slider"
                    min={0}
                    max={effectiveDuration > 0 ? effectiveDuration : 100}
                    step={0.5}
                    disabled={isRadioCurrent || effectiveDuration <= 0}
                    value={effectiveDuration > 0 ? clampedPos : 0}
                    onChange={(e) => onSeek(Number(e.target.value))}
                    aria-label="شريط التقديم والتأخير"
                    className="w-full accent-emerald-500 h-2.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer disabled:opacity-40"
                  />
                  <div
                    dir="ltr"
                    className="flex items-center justify-between text-[11px] font-bold text-slate-500 dark:text-slate-400 tabular-nums"
                  >
                    <span>
                      {isRadioCurrent ? 'LIVE' : formatAudioTime(clampedPos)}
                    </span>
                    <span>
                      {isRadioCurrent
                        ? 'بث مستمر'
                        : effectiveDuration > 0
                        ? formatAudioTime(effectiveDuration)
                        : '--:--'}
                    </span>
                  </div>
                </div>

                {/* 5 Transport Controls in One Row */}
                <div
                  dir="ltr"
                  className="flex items-center justify-between gap-2 pt-0.5"
                >
                  <button
                    type="button"
                    onClick={onToggleShuffle}
                    aria-label="تبديل التشغيل العشوائي"
                    aria-pressed={shuffle}
                    className={`min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center shrink-0 transition ${
                      shuffle
                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                        : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <Shuffle className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={onPrev}
                    aria-label="المقطع السابق"
                    className="min-w-[46px] min-h-[46px] rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-white flex items-center justify-center active:scale-95 transition"
                  >
                    <SkipBack className="w-5 h-5" />
                  </button>

                  <button
                    type="button"
                    data-testid="music-sheet-play-pause"
                    onClick={onTogglePlayPause}
                    aria-label={
                      isBuffering
                        ? 'جاري التحميل'
                        : isPlaying
                        ? 'إيقاف مؤقت'
                        : 'تشغيل'
                    }
                    className="w-16 h-16 rounded-full bg-emerald-500 text-white shadow-md flex items-center justify-center active:scale-95 transition relative"
                  >
                    {isBuffering ? (
                      <Loader2
                        data-testid="music-play-spinner"
                        className="w-7 h-7 animate-spin"
                      />
                    ) : isPlaying ? (
                      <Pause className="w-7 h-7" />
                    ) : (
                      <Play className="w-7 h-7 translate-x-[1px]" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={onNext}
                    aria-label="المقطع التالي"
                    className="min-w-[46px] min-h-[46px] rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-white flex items-center justify-center active:scale-95 transition"
                  >
                    <SkipForward className="w-5 h-5" />
                  </button>

                  <button
                    type="button"
                    onClick={onCycleRepeat}
                    aria-label={`التكرار: ${repeat}`}
                    className={`min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center shrink-0 transition ${
                      repeat !== 'off'
                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                        : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {repeat === 'one' ? (
                      <Repeat1 className="w-4 h-4" />
                    ) : (
                      <Repeat className="w-4 h-4" />
                    )}
                  </button>
                </div>

                {/* Single Mute Toggle Button + Thick Volume Slider + Live % */}
                <div className="flex items-center gap-3 pt-2.5 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    data-testid="music-mute-btn"
                    onClick={onToggleMute}
                    aria-label={isMuted ? 'إلغاء كتم الصوت' : 'كتم الصوت'}
                    aria-pressed={isMuted}
                    className={`min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center shrink-0 transition border ${
                      isMuted
                        ? 'bg-amber-500/15 border-amber-400/70 text-amber-600 dark:text-amber-400'
                        : 'bg-slate-100 dark:bg-slate-800 border-transparent text-slate-700 dark:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-700'
                    }`}
                  >
                    {isMuted ? (
                      <VolumeX className="w-5 h-5" />
                    ) : (
                      <Volume2 className="w-5 h-5" />
                    )}
                  </button>

                  <div className="relative flex-1 min-w-0 flex items-center">
                    {isDraggingVolume && (
                      <span
                        data-testid="music-volume-drag-pct"
                        dir="ltr"
                        className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-extrabold tabular-nums shadow-md pointer-events-none"
                      >
                        {volumePercent}%
                      </span>
                    )}
                    <input
                      type="range"
                      dir="ltr"
                      data-testid="music-volume-slider"
                      min={0}
                      max={1}
                      step={0.02}
                      value={isMuted ? 0 : volume}
                      onPointerDown={() => setIsDraggingVolume(true)}
                      onPointerUp={() => setIsDraggingVolume(false)}
                      onPointerCancel={() => setIsDraggingVolume(false)}
                      onTouchStart={() => setIsDraggingVolume(true)}
                      onTouchEnd={() => setIsDraggingVolume(false)}
                      onBlur={() => setIsDraggingVolume(false)}
                      onChange={(e) => onVolumeChange(Number(e.target.value))}
                      aria-label="مستوى الصوت"
                      className="w-full accent-emerald-500 h-3.5 bg-slate-200 dark:bg-slate-800 rounded-full cursor-pointer"
                    />
                  </div>

                  <span
                    dir="ltr"
                    data-testid="music-volume-pct"
                    className={`w-11 text-left text-xs font-extrabold tabular-nums shrink-0 ${
                      isMuted
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {volumePercent}%
                  </span>
                </div>
              </section>

              {/* Quick Strip: "شغّلت مؤخراً" */}
              {recentTracks.length > 0 && (
                <section
                  data-testid="music-recent-strip"
                  className="space-y-2"
                >
                  <h3 className="text-xs font-extrabold text-slate-700 dark:text-slate-300 px-1">
                    شغّلت مؤخراً
                  </h3>
                  <div className="flex items-start gap-2.5 overflow-x-auto pb-1 no-scrollbar">
                    {recentTracks.map((tr) => {
                      const active = tr.id === currentTrackId;
                      return (
                        <button
                          key={tr.id}
                          type="button"
                          onClick={() => onPlayTrack(tr.id)}
                          className={`w-[76px] shrink-0 text-center space-y-1.5 group active:scale-95 transition ${
                            active ? 'opacity-100' : 'opacity-95 hover:opacity-100'
                          }`}
                        >
                          <div
                            className={`mx-auto w-[68px] h-[68px] rounded-2xl p-0.5 ${
                              active
                                ? 'ring-2 ring-emerald-500 ring-offset-2 ring-offset-[#F7F8FA] dark:ring-offset-slate-950'
                                : ''
                            }`}
                          >
                            <TrackCoverTile
                              track={tr}
                              sizeClass="w-full h-full"
                              textClass="text-xl"
                              roundedClass="rounded-[14px]"
                            />
                          </div>
                          <div
                            dir="auto"
                            className={`text-[11px] font-bold line-clamp-2 leading-tight px-0.5 ${
                              active
                                ? 'text-emerald-700 dark:text-emerald-300'
                                : 'text-slate-700 dark:text-slate-200'
                            }`}
                          >
                            {tr.title}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* Low Storage Warning */}
              {storageStats.isStorageLow && tracks.length > 0 && (
                <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-2xl p-3.5 flex items-start gap-2.5 text-amber-900 dark:text-amber-200">
                  <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div className="text-xs font-bold leading-relaxed">
                    مساحة التخزين في المتصفح منخفضة. حجم المكتبة الصوتية:{' '}
                    <span className="tabular-nums">
                      {formatBytesArabic(storageStats.usedBytes)}
                    </span>
                    . لن يتم حذف الصوتيات تلقائياً؛ يمكنك حذف المقاطع غير المطلوبة
                    من القائمة.
                  </div>
                </div>
              )}

              {/* Library Section: Tabs + Search + Tracks */}
              <section className="bg-white dark:bg-slate-900 rounded-[22px] border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-visible">
                {/* Tabs Row */}
                <div
                  role="tablist"
                  data-testid="music-library-tabs"
                  className="px-3 pt-3 pb-2 border-b border-slate-100 dark:border-slate-800 flex items-center gap-1.5 overflow-x-auto no-scrollbar"
                >
                  {(
                    [
                      { id: 'all', label: `الكل (${tracks.length})` },
                      {
                        id: 'favorites',
                        label: `المفضلة (${tracks.filter((t) => t.favorite).length})`,
                      },
                      { id: 'recent', label: 'الأخيرة' },
                    ] as const
                  ).map((tab) => {
                    const selected = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        onClick={() => setActiveTab(tab.id)}
                        className={`min-h-[38px] px-3.5 rounded-xl text-xs font-extrabold whitespace-nowrap shrink-0 transition ${
                          selected
                            ? 'bg-emerald-500 text-white shadow-xs'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-700'
                        }`}
                      >
                        {tab.label}
                      </button>
                    );
                  })}

                  {lists.map((lst) => {
                    const tabId: MusicLibraryTab = `list:${lst.id}`;
                    const selected = activeTab === tabId;
                    return (
                      <button
                        key={lst.id}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        onClick={() => setActiveTab(tabId)}
                        className={`min-h-[38px] px-3.5 rounded-xl text-xs font-extrabold whitespace-nowrap shrink-0 flex items-center gap-1.5 transition ${
                          selected
                            ? 'bg-emerald-500 text-white shadow-xs'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-700'
                        }`}
                      >
                        <ListMusic className="w-3.5 h-3.5 shrink-0" />
                        <span>{lst.name}</span>
                      </button>
                    );
                  })}

                  <button
                    type="button"
                    data-testid="music-new-list-btn"
                    onClick={() => setShowNewListForm((v) => !v)}
                    className="min-h-[38px] px-3 rounded-xl border border-dashed border-emerald-400 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 text-xs font-extrabold whitespace-nowrap shrink-0 flex items-center gap-1 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>قائمة</span>
                  </button>
                </div>

                {/* New Custom List Form */}
                {showNewListForm && (
                  <form
                    onSubmit={handleCreateListSubmit}
                    data-testid="music-new-list-form"
                    className="p-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40 flex items-center gap-2"
                  >
                    <input
                      type="text"
                      autoFocus
                      value={newListName}
                      onChange={(e) => setNewListName(e.target.value)}
                      placeholder="اسم القائمة الجديدة…"
                      className="flex-1 min-h-[42px] px-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <button
                      type="submit"
                      className="min-h-[42px] px-3.5 rounded-xl bg-emerald-500 text-white text-xs font-extrabold shrink-0"
                    >
                      إنشاء
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowNewListForm(false);
                        setNewListName('');
                      }}
                      aria-label="إلغاء إنشاء قائمة"
                      className="min-w-[42px] min-h-[42px] rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </form>
                )}

                {/* Active Custom List Header Banner (multi-add tracks + delete list) */}
                {activeListObj && (
                  <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 bg-emerald-50/50 dark:bg-emerald-950/20 text-xs">
                    <span className="font-extrabold text-emerald-800 dark:text-emerald-300 truncate">
                      قائمة: {activeListObj.name} ({filteredTracks.length})
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        data-testid="music-list-multi-add-btn"
                        onClick={() => {
                          setMultiAddListId(activeListObj.id);
                          setMultiAddSelectedIds([]);
                          setMultiAddQuery('');
                        }}
                        className="min-h-[34px] px-2.5 py-1 rounded-lg bg-emerald-500 text-white font-extrabold flex items-center gap-1 active:scale-95 transition"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>إضافة مقاطع</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void onDeleteList(activeListObj.id)}
                        className="min-h-[34px] px-2.5 py-1 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 font-bold flex items-center gap-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>حذف القائمة</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Search Bar Below Tabs */}
                {showSearchBox && (
                  <div className="p-3 border-b border-slate-100 dark:border-slate-800">
                    <div className="relative">
                      <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        data-testid="music-search-input"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="ابحث بالاسم المختصر أو اسم الملف…"
                        className="w-full min-h-[42px] pr-9 pl-8 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                      {searchQuery && (
                        <button
                          type="button"
                          onClick={() => setSearchQuery('')}
                          aria-label="مسح البحث"
                          className="w-8 h-8 flex items-center justify-center text-slate-400 absolute left-1 top-1/2 -translate-y-1/2"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Track Rows */}
                {filteredTracks.length === 0 ? (
                  <div className="p-6 text-center text-xs font-bold text-slate-400 dark:text-slate-500 space-y-3">
                    <div>
                      {searchQuery
                        ? 'لا توجد مقاطع مطابقة للبحث.'
                        : activeTab === 'favorites'
                        ? 'لا توجد مقاطع في المفضلة بعد. اضغط على النجمة بجانب أي مقطع.'
                        : activeTab === 'recent'
                        ? 'لم يتم تشغيل أي مقطع مؤخراً.'
                        : activeListObj
                        ? 'هذه القائمة فارغة. يمكنك تحديد عدة مقاطع لإضافتها دفعة واحدة.'
                        : 'القائمة فارغة.'}
                    </div>
                    {activeListObj && !searchQuery && tracks.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setMultiAddListId(activeListObj.id);
                          setMultiAddSelectedIds([]);
                          setMultiAddQuery('');
                        }}
                        className="min-h-[40px] px-4 rounded-xl bg-emerald-500 text-white text-xs font-extrabold inline-flex items-center gap-1.5 shadow-sm active:scale-95 transition"
                      >
                        <Plus className="w-4 h-4" />
                        <span>إضافة مقاطع إلى القائمة</span>
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filteredTracks.map((track, idx) => {
                      const isCurrent = track.id === currentTrackId;
                      const isRenaming = renamingTrackId === track.id;
                      const fullIdx = tracks.findIndex((t) => t.id === track.id);
                      const canMoveUp = fullIdx > 0;
                      const canMoveDown =
                        fullIdx >= 0 && fullIdx < tracks.length - 1;
                      const showRawFileName =
                        Boolean(track.fileName) &&
                        track.fileName !== track.title;

                      return (
                        <div
                          key={track.id}
                          data-testid={`music-track-row-${idx}`}
                          className={`relative px-3 py-2 flex items-center gap-2 transition-colors ${
                            isCurrent
                              ? 'bg-emerald-50/90 dark:bg-emerald-950/35 ring-1 ring-inset ring-emerald-500/30'
                              : ''
                          }`}
                        >
                          {isRenaming ? (
                            <div className="flex-1 flex items-center gap-2 py-1">
                              <input
                                type="text"
                                autoFocus
                                data-testid="music-rename-input"
                                value={renameDraft}
                                onChange={(e) => setRenameDraft(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    void handleCommitRename(track.id);
                                  } else if (e.key === 'Escape') {
                                    setRenamingTrackId(null);
                                  }
                                }}
                                placeholder="اسم مختصر للمقطع"
                                className="flex-1 min-h-[42px] px-3 rounded-xl bg-white dark:bg-slate-800 border border-emerald-400 text-sm font-bold text-slate-900 dark:text-white focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => handleCommitRename(track.id)}
                                aria-label="حفظ الاسم المختصر"
                                className="min-w-[42px] min-h-[42px] rounded-xl bg-emerald-500 text-white flex items-center justify-center"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setRenamingTrackId(null)}
                                aria-label="إلغاء التسمية"
                                className="min-w-[42px] min-h-[42px] rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  if (track.missingFile) {
                                    reattachTargetIdRef.current = track.id;
                                    reattachInputRef.current?.click();
                                  } else {
                                    onPlayTrack(track.id);
                                  }
                                }}
                                className="flex-1 min-w-0 min-h-[48px] flex items-center gap-2.5 text-right"
                              >
                                <TrackCoverTile
                                  track={track}
                                  sizeClass="w-12 h-12"
                                  textClass="text-lg"
                                  roundedClass="rounded-xl"
                                />

                                <div className="flex-1 min-w-0">
                                  <div
                                    dir="auto"
                                    className={`text-sm font-bold line-clamp-2 leading-snug break-words ${
                                      isCurrent
                                        ? 'text-emerald-700 dark:text-emerald-300'
                                        : 'text-slate-900 dark:text-white'
                                    }`}
                                  >
                                    {track.title}
                                  </div>
                                  <div className="text-[11px] font-semibold mt-0.5 flex items-center gap-2 min-w-0">
                                    {track.missingFile ? (
                                      <span className="text-amber-600 dark:text-amber-400 font-bold shrink-0">
                                        {MISSING_FILE_LABEL}
                                      </span>
                                    ) : track.kind === 'radio' ? (
                                      <span className="text-emerald-600 dark:text-emerald-400 shrink-0">
                                        بث مباشر
                                      </span>
                                    ) : (
                                      <span className="text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
                                        {track.duration > 0
                                          ? formatAudioTime(track.duration)
                                          : '--:--'}
                                      </span>
                                    )}
                                    {showRawFileName && (
                                      <span
                                        dir="auto"
                                        className="text-slate-400 dark:text-slate-500 truncate min-w-0"
                                      >
                                        {track.fileName}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </button>

                              {/* Favorite Star Button */}
                              <button
                                type="button"
                                data-testid={`music-track-fav-${idx}`}
                                aria-label={
                                  track.favorite
                                    ? `إزالة ${track.title} من المفضلة`
                                    : `إضافة ${track.title} للمفضلة`
                                }
                                aria-pressed={Boolean(track.favorite)}
                                onClick={() => void onToggleFavorite(track.id)}
                                className="min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center shrink-0 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                              >
                                <Star
                                  className={`w-4 h-4 ${
                                    track.favorite
                                      ? 'fill-amber-400 text-amber-500'
                                      : 'text-slate-400 dark:text-slate-500'
                                  }`}
                                />
                              </button>

                              {/* Play / Active Equalizer Indicator */}
                              <button
                                type="button"
                                aria-label={
                                  isCurrent && isPlaying
                                    ? `إيقاف ${track.title}`
                                    : `تشغيل ${track.title}`
                                }
                                onClick={() => {
                                  if (track.missingFile) {
                                    reattachTargetIdRef.current = track.id;
                                    reattachInputRef.current?.click();
                                  } else if (isCurrent) {
                                    onTogglePlayPause();
                                  } else {
                                    onPlayTrack(track.id);
                                  }
                                }}
                                className={`min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center shrink-0 transition ${
                                  isCurrent
                                    ? 'bg-emerald-500 text-white'
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                                }`}
                              >
                                {isCurrent ? (
                                  <MusicEqualizer
                                    active={isPlaying && !batterySaverOn && !isPageHidden}
                                    className="text-white"
                                  />
                                ) : (
                                  <Play className="w-4 h-4 translate-x-[-1px]" />
                                )}
                              </button>

                              {/* Per-track ⋯ Menu */}
                              <div className="relative shrink-0">
                                <button
                                  type="button"
                                  data-testid={`music-track-menu-btn-${idx}`}
                                  aria-label={`خيارات ${track.title}`}
                                  onClick={() =>
                                    setOpenMenuTrackId((prev) =>
                                      prev === track.id ? null : track.id
                                    )
                                  }
                                  className="min-w-[44px] min-h-[44px] rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center"
                                >
                                  <MoreHorizontal className="w-5 h-5" />
                                </button>

                                {openMenuTrackId === track.id && (
                                  <>
                                    <div
                                      className="fixed inset-0 z-10"
                                      onClick={() => setOpenMenuTrackId(null)}
                                    />
                                    <div
                                      data-testid={`music-track-menu-${idx}`}
                                      className="absolute left-0 top-11 z-20 w-60 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-2 space-y-1 text-xs font-bold"
                                    >
                                      {track.missingFile && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setOpenMenuTrackId(null);
                                            reattachTargetIdRef.current = track.id;
                                            reattachInputRef.current?.click();
                                          }}
                                          className="w-full min-h-[40px] px-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-amber-600 dark:text-amber-400 flex items-center gap-2"
                                        >
                                          <FilePlus2 className="w-4 h-4 shrink-0" />
                                          <span>إعادة إضافة الملف</span>
                                        </button>
                                      )}

                                      <button
                                        type="button"
                                        onClick={() => handleStartRename(track)}
                                        className="w-full min-h-[40px] px-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 flex items-center gap-2"
                                      >
                                        <Pencil className="w-4 h-4 shrink-0" />
                                        <span>اسم مختصر</span>
                                      </button>

                                      <button
                                        type="button"
                                        onClick={() => {
                                          setOpenMenuTrackId(null);
                                          coverTargetIdRef.current = track.id;
                                          coverInputRef.current?.click();
                                        }}
                                        className="w-full min-h-[40px] px-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 flex items-center gap-2"
                                      >
                                        <ImagePlus className="w-4 h-4 shrink-0" />
                                        <span>صورة غلاف من المعرض</span>
                                      </button>

                                      {track.coverDataUrl && (
                                        <button
                                          type="button"
                                          onClick={async () => {
                                            setOpenMenuTrackId(null);
                                            await onUpdateTrackCover(
                                              track.id,
                                              null
                                            );
                                          }}
                                          className="w-full min-h-[38px] px-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 flex items-center gap-2"
                                        >
                                          <X className="w-4 h-4 shrink-0" />
                                          <span>إزالة صورة الغلاف</span>
                                        </button>
                                      )}

                                      {/* 8 Curated Colors */}
                                      <div className="px-2 py-1.5 space-y-1.5 border-y border-slate-100 dark:border-slate-800">
                                        <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                                          لون المربع
                                        </div>
                                        <div className="grid grid-cols-4 gap-1.5">
                                          {TRACK_TILE_COLORS.map((c) => {
                                            const selected =
                                              !track.coverDataUrl &&
                                              track.tileColor === c.id;
                                            return (
                                              <button
                                                key={c.id}
                                                type="button"
                                                aria-label={`لون ${c.label}`}
                                                onClick={async () => {
                                                  setOpenMenuTrackId(null);
                                                  if (track.coverDataUrl) {
                                                    await onUpdateTrackCover(
                                                      track.id,
                                                      null
                                                    );
                                                  }
                                                  await onSetTrackTileColor(
                                                    track.id,
                                                    c.id
                                                  );
                                                }}
                                                style={{
                                                  background: c.gradientCss,
                                                }}
                                                className={`h-7 rounded-lg flex items-center justify-center transition active:scale-95 ${
                                                  selected
                                                    ? 'ring-2 ring-slate-900 dark:ring-white ring-offset-1'
                                                    : ''
                                                }`}
                                              >
                                                {selected && (
                                                  <Check className="w-3.5 h-3.5 text-white" />
                                                )}
                                              </button>
                                            );
                                          })}
                                        </div>
                                      </div>

                                      {/* Add to Multiple Custom Lists */}
                                      <div className="px-2 py-1 space-y-1 border-b border-slate-100 dark:border-slate-800">
                                        <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 dark:text-slate-400">
                                          <span>إضافة إلى قائمة</span>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setOpenMenuTrackId(null);
                                              setShowNewListForm(true);
                                            }}
                                            className="text-emerald-600 dark:text-emerald-400 font-extrabold flex items-center gap-0.5"
                                          >
                                            <FolderPlus className="w-3.5 h-3.5" />
                                            <span>جديدة</span>
                                          </button>
                                        </div>

                                        {lists.length === 0 ? (
                                          <div className="text-[11px] text-slate-400 py-1">
                                            لا توجد قوائم مخصصة بعد
                                          </div>
                                        ) : (
                                          <div className="max-h-28 overflow-y-auto space-y-0.5">
                                            {lists.map((lst) => {
                                              const inList =
                                                Array.isArray(track.listIds) &&
                                                track.listIds.includes(lst.id);
                                              return (
                                                <button
                                                  key={lst.id}
                                                  type="button"
                                                  onClick={() =>
                                                    void onToggleTrackInList(
                                                      track.id,
                                                      lst.id
                                                    )
                                                  }
                                                  className="w-full min-h-[34px] px-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between gap-2 text-slate-800 dark:text-slate-200"
                                                >
                                                  <span className="truncate">
                                                    {lst.name}
                                                  </span>
                                                  <span
                                                    className={`w-4 h-4 rounded flex items-center justify-center border ${
                                                      inList
                                                        ? 'bg-emerald-500 border-emerald-500 text-white'
                                                        : 'border-slate-300 dark:border-slate-600'
                                                    }`}
                                                  >
                                                    {inList && (
                                                      <Check className="w-3 h-3" />
                                                    )}
                                                  </span>
                                                </button>
                                              );
                                            })}
                                          </div>
                                        )}
                                      </div>

                                      <button
                                        type="button"
                                        disabled={!canMoveUp}
                                        onClick={async () => {
                                          setOpenMenuTrackId(null);
                                          await onReorderTrack(track.id, 'up');
                                        }}
                                        className="w-full min-h-[38px] px-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 flex items-center gap-2 disabled:opacity-35"
                                      >
                                        <ArrowUp className="w-4 h-4 shrink-0" />
                                        <span>تحريك لأعلى</span>
                                      </button>
                                      <button
                                        type="button"
                                        disabled={!canMoveDown}
                                        onClick={async () => {
                                          setOpenMenuTrackId(null);
                                          await onReorderTrack(track.id, 'down');
                                        }}
                                        className="w-full min-h-[38px] px-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 flex items-center gap-2 disabled:opacity-35"
                                      >
                                        <ArrowDown className="w-4 h-4 shrink-0" />
                                        <span>تحريك لأسفل</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={async () => {
                                          setOpenMenuTrackId(null);
                                          await onDeleteTrack(track.id);
                                        }}
                                        className="w-full min-h-[38px] px-3 rounded-xl hover:bg-red-50 dark:hover:bg-red-950/40 text-red-600 dark:text-red-400 flex items-center gap-2"
                                      >
                                        <Trash2 className="w-4 h-4 shrink-0" />
                                        <span>حذف</span>
                                      </button>
                                    </div>
                                  </>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </>
          )}

          {/* Inline Radio Form */}
          {showRadioForm && (
            <form
              onSubmit={handleAddRadioSubmit}
              className="bg-white dark:bg-slate-900 rounded-[20px] p-4 border border-slate-200/80 dark:border-slate-800 space-y-3"
            >
              <div className="text-xs font-extrabold text-slate-700 dark:text-slate-200">
                إضافة محطة إذاعية عبر الإنترنت
              </div>
              <input
                type="text"
                value={radioTitle}
                onChange={(e) => setRadioTitle(e.target.value)}
                placeholder="اسم الإذاعة (مثلاً: إذاعة القرآن الكريم)"
                className="w-full min-h-[44px] px-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <input
                type="url"
                dir="ltr"
                value={radioUrl}
                onChange={(e) => setRadioUrl(e.target.value)}
                placeholder="https://example.com/stream.mp3"
                className="w-full min-h-[44px] px-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              {radioError && (
                <div className="text-xs font-bold text-red-600 dark:text-red-400">
                  {radioError}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowRadioForm(false);
                    setRadioError(null);
                  }}
                  className="min-h-[44px] flex-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-extrabold"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="min-h-[44px] flex-1 rounded-xl bg-emerald-500 text-white text-xs font-extrabold flex items-center justify-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>إضافة الإذاعة</span>
                </button>
              </div>
            </form>
          )}

          {/* Sleep Timer ("مؤقّت النوم") */}
          <section
            ref={sleepSectionRef}
            data-testid="music-sleep-timer"
            className="bg-white dark:bg-slate-900 rounded-[20px] p-4 border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-2.5"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Moon className="w-4 h-4 text-emerald-500 shrink-0" />
                <span className="text-xs font-extrabold text-slate-800 dark:text-white">
                  مؤقّت النوم
                </span>
              </div>

              {sleepRemainingSec > 0 ? (
                <div className="flex items-center gap-2">
                  <span
                    dir="ltr"
                    className="text-xs font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums"
                  >
                    {formatSleepTimerBadge(sleepRemainingSec)}
                  </span>
                  <button
                    type="button"
                    onClick={onCancelSleepTimer}
                    className="min-h-[32px] px-2.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-[11px] font-extrabold"
                  >
                    إيقاف المؤقّت
                  </button>
                </div>
              ) : (
                <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                  إيقاف بعد:
                </span>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2">
              {SLEEP_TIMER_PRESETS_MIN.map((mins) => {
                const active =
                  sleepTimerMinutes === mins && sleepRemainingSec > 0;
                return (
                  <button
                    key={mins}
                    type="button"
                    aria-label={`إيقاف بعد ${mins} دقيقة`}
                    onClick={() => onStartSleepTimer(mins)}
                    className={`min-h-[44px] px-2 rounded-xl text-xs font-extrabold tabular-nums flex items-center justify-center whitespace-nowrap transition ${
                      active
                        ? 'bg-emerald-500 text-white shadow-sm'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    {mins} دقيقة
                  </button>
                );
              })}
            </div>
          </section>

          {/* Bottom Storage & Persistence Summary */}
          <div className="px-1 pb-1 flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold text-slate-500 dark:text-slate-400">
            <span className="tabular-nums">
              المساحة المستخدمة:{' '}
              {formatBytesArabic(storageStats.usedBytes)} / {maxStorageMb} م.ب
            </span>
            <span>
              {storageStats.persisted ? 'التخزين الدائم: نشط' : 'التخزين: قياسي'}
            </span>
          </div>
        </div>
      </div>

      {/* Custom List Multi-Add Modal */}
      {multiAddListId && (() => {
        const targetList = lists.find((l) => l.id === multiAddListId);
        const qNorm = multiAddQuery.trim().toLowerCase();
        const modalTracks = qNorm
          ? tracks.filter(
              (t) =>
                t.title.toLowerCase().includes(qNorm) ||
                (t.fileName || '').toLowerCase().includes(qNorm)
            )
          : tracks;
        const availableIds = modalTracks
          .filter((t) => !(Array.isArray(t.listIds) && t.listIds.includes(multiAddListId)))
          .map((t) => t.id);

        const handleToggleCandidate = (trackId: string) => {
          setMultiAddSelectedIds((prev) =>
            prev.includes(trackId)
              ? prev.filter((id) => id !== trackId)
              : [...prev, trackId]
          );
        };

        const handleConfirmMultiAdd = async () => {
          if (multiAddSelectedIds.length === 0 || multiAddBusy) return;
          setMultiAddBusy(true);
          try {
            if (onAddTracksToList) {
              await onAddTracksToList(multiAddListId, multiAddSelectedIds);
            } else {
              for (const id of multiAddSelectedIds) {
                const tr = tracks.find((t) => t.id === id);
                if (!tr?.listIds?.includes(multiAddListId)) {
                  await onToggleTrackInList(id, multiAddListId);
                }
              }
            }
            setMultiAddListId(null);
            setMultiAddSelectedIds([]);
            setMultiAddQuery('');
          } finally {
            setMultiAddBusy(false);
          }
        };

        return (
          <div
            data-testid="music-list-multi-add-modal"
            className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
            onClick={(e) => {
              e.stopPropagation();
              setMultiAddListId(null);
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg max-h-[82dvh] bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl border border-slate-200 dark:border-slate-700 shadow-2xl flex flex-col overflow-hidden"
            >
              <div className="px-4 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-sm font-extrabold text-slate-900 dark:text-white truncate">
                    إضافة مقاطع إلى: {targetList?.name || 'القائمة'}
                  </h3>
                  <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                    حدد المقاطع من مكتبتك (المقاطع المضافة مسبقاً محمية من التكرار)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setMultiAddListId(null)}
                  aria-label="إغلاق نافذة إضافة المقاطع"
                  className="min-w-[40px] min-h-[40px] rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {tracks.length > 0 && (
                <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
                  <div className="relative flex-1 min-w-0">
                    <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={multiAddQuery}
                      onChange={(e) => setMultiAddQuery(e.target.value)}
                      placeholder="ابحث عن مقطع…"
                      className="w-full min-h-[40px] pr-9 pl-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  {availableIds.length > 0 && (
                    <button
                      type="button"
                      data-testid="music-multi-add-select-all"
                      onClick={() =>
                        setMultiAddSelectedIds((prev) =>
                          prev.length === availableIds.length ? [] : availableIds
                        )
                      }
                      className="min-h-[40px] px-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-[11px] font-extrabold shrink-0"
                    >
                      {multiAddSelectedIds.length === availableIds.length
                        ? 'إلغاء التحديد'
                        : 'تحديد المتاح'}
                    </button>
                  )}
                </div>
              )}

              <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                {tracks.length === 0 ? (
                  <div className="p-6 text-center space-y-3">
                    <div className="text-xs font-bold text-slate-500 dark:text-slate-400">
                      لا توجد مقاطع في المكتبة الصوتية بعد.
                    </div>
                    <MusicAudioImporterTrigger
                      variant="empty-primary"
                      buttonText="إضافة ملفات صوتية"
                      disabled={busyImport || Boolean(importProgress)}
                      onSelectFiles={onAddFiles}
                      showSavedNote={false}
                    />
                  </div>
                ) : modalTracks.length === 0 ? (
                  <div className="p-6 text-center text-xs font-bold text-slate-400">
                    لا توجد مقاطع مطابقة للبحث.
                  </div>
                ) : (
                  modalTracks.map((tr, idx) => {
                    const alreadyAdded =
                      Array.isArray(tr.listIds) &&
                      tr.listIds.includes(multiAddListId);
                    const checked =
                      alreadyAdded || multiAddSelectedIds.includes(tr.id);

                    return (
                      <button
                        key={tr.id}
                        type="button"
                        disabled={alreadyAdded}
                        data-testid={`music-multi-add-row-${idx}`}
                        onClick={() => handleToggleCandidate(tr.id)}
                        className={`w-full px-4 py-2.5 flex items-center gap-3 text-right transition ${
                          alreadyAdded
                            ? 'opacity-65 cursor-not-allowed bg-slate-50/70 dark:bg-slate-800/30'
                            : checked
                            ? 'bg-emerald-50/70 dark:bg-emerald-950/30'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                        }`}
                      >
                        <span
                          className={`w-5 h-5 rounded-md flex items-center justify-center border shrink-0 ${
                            checked
                              ? 'bg-emerald-500 border-emerald-500 text-white'
                              : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900'
                          }`}
                        >
                          {checked && <Check className="w-3.5 h-3.5" />}
                        </span>
                        <TrackCoverTile
                          track={tr}
                          sizeClass="w-10 h-10"
                          textClass="text-sm"
                          roundedClass="rounded-xl"
                        />
                        <div className="flex-1 min-w-0">
                          <div
                            dir="auto"
                            className="text-xs font-extrabold text-slate-900 dark:text-white truncate"
                          >
                            {tr.title}
                          </div>
                          {tr.fileName && tr.fileName !== tr.title && (
                            <div
                              dir="auto"
                              className="text-[11px] font-semibold text-slate-400 truncate"
                            >
                              {tr.fileName}
                            </div>
                          )}
                        </div>
                        {alreadyAdded && (
                          <span className="px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-[10px] font-extrabold shrink-0">
                            مضاف مسبقاً
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>

              {tracks.length > 0 && (
                <div className="p-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setMultiAddListId(null)}
                    className="min-h-[44px] flex-1 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-extrabold"
                  >
                    إلغاء
                  </button>
                  <button
                    type="button"
                    data-testid="music-list-multi-add-submit"
                    disabled={multiAddSelectedIds.length === 0 || multiAddBusy}
                    onClick={() => void handleConfirmMultiAdd()}
                    className="min-h-[44px] flex-1 rounded-xl bg-emerald-500 text-white text-xs font-extrabold disabled:opacity-45"
                  >
                    إضافة المحدد ({multiAddSelectedIds.length})
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Diagnostics Modal */}
      <MusicDiagnosticsModal
        open={showDiagnostics}
        diagnostics={diagnosticsData}
        onClose={() => setShowDiagnostics(false)}
        onRefresh={onGetDiagnostics}
      />
    </div>
  );
};
