import { useCallback, useEffect, useState } from 'react';
import { AppSettings, DEFAULT_SETTINGS } from './types';
import {
  cleanupExpiredDonePhotos,
  cleanupLegacyAnalysisDataOnce,
  getSettings,
  requestStoragePersistence,
  saveSettings,
} from './modules/db';
import { CameraScreen } from './modules/camera/CameraScreen';
import { LogScreen } from './modules/log/LogScreen';
import { NotesScreen } from './modules/notes/NotesScreen';
import { SettingsScreen } from './modules/settings/SettingsScreen';
import { BottomNav, TabKey } from './components/BottomNav';
import { OfflineIndicator } from './components/OfflineIndicator';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { useMusicPlayer } from './modules/music/useMusicPlayer';
import { MusicFloatingButton } from './modules/music/MusicFloatingButton';
import { MusicPlayerSheet } from './modules/music/MusicPlayerSheet';
import { CheckCircle2, X } from 'lucide-react';

function hasActiveBlockingOverlay(): boolean {
  if (typeof document === 'undefined') return false;
  const candidates = document.querySelectorAll(
    '[role="dialog"], .fixed.inset-0.z-30, .fixed.inset-0.z-40, .fixed.inset-0.z-50'
  );
  for (let i = 0; i < candidates.length; i++) {
    const el = candidates[i] as HTMLElement;
    if (
      el.dataset.testid === 'music-player-backdrop' ||
      el.dataset.testid === 'music-player-sheet' ||
      el.closest('[data-testid="music-player-backdrop"]')
    ) {
      continue;
    }
    return true;
  }
  return false;
}

export function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('capture');
  const [sessionId] = useState(() => `sess_${Date.now()}`);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const isOnline = useOnlineStatus();
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [focusLogPhotoId, setFocusLogPhotoId] = useState<string | null>(null);
  const [isNotesKeyboardOpen, setIsNotesKeyboardOpen] = useState(false);
  const [hasBlockingOverlay, setHasBlockingOverlay] = useState(false);
  const [showLegacyCleanupBanner, setShowLegacyCleanupBanner] = useState(false);

  const music = useMusicPlayer({
    enabled: settings.musicPlayerEnabled,
    maxStorageMb: settings.musicMaxStorageMb,
    refreshSignal,
    visualEffects: settings.musicVisualEffects,
    audioReactive: settings.musicAudioReactive,
  });

  // Track any fullscreen viewer, modal, or bottom sheet to hide the floating button automatically
  useEffect(() => {
    const checkOverlays = () => {
      setHasBlockingOverlay(hasActiveBlockingOverlay());
    };
    checkOverlays();
    const observer = new MutationObserver(checkOverlays);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'role'],
    });
    return () => observer.disconnect();
  }, []);

  // If the music window is open and the user navigates, close it first cleanly
  const handleTabChange = useCallback(
    (nextTab: TabKey) => {
      music.setIsSheetOpen(false);
      if (nextTab !== 'notes') setIsNotesKeyboardOpen(false);
      setActiveTab(nextTab);
    },
    [music]
  );

  useEffect(() => {
    if (!music.isSheetOpen) return;
    const onPopState = () => {
      music.setIsSheetOpen(false);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [music]);

  const { isSheetOpen, setIsSheetOpen } = music;
  useEffect(() => {
    if (hasBlockingOverlay && isSheetOpen) {
      setIsSheetOpen(false);
    }
  }, [hasBlockingOverlay, isSheetOpen, setIsSheetOpen]);

  const showFloatingButton =
    settings.musicPlayerEnabled &&
    !music.isSheetOpen &&
    !hasBlockingOverlay &&
    !(activeTab === 'capture' && !settings.musicShowOnCapture) &&
    !(activeTab === 'notes' && isNotesKeyboardOpen);

  // Follow system dark mode automatically & sync system bar theme-color
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = (isDark: boolean) => {
      document.documentElement.classList.toggle('dark', isDark);
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) {
        meta.setAttribute(
          'content',
          activeTab === 'capture' || isDark ? '#020617' : '#F7F8FA'
        );
      }
    };
    applyTheme(mq.matches);
    const handler = (e: MediaQueryListEvent) => applyTheme(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [activeTab]);

  useEffect(() => {
    let bannerTimer: number | null = null;
    requestStoragePersistence().catch(() => {});

    (async () => {
      try {
        const res = await cleanupLegacyAnalysisDataOnce();
        if (res.cleaned) {
          setShowLegacyCleanupBanner(true);
          bannerTimer = window.setTimeout(() => {
            setShowLegacyCleanupBanner(false);
          }, 8000);
        }
      } catch {
        // Non-fatal
      }

      try {
        const s = await getSettings();
        setSettings(s);
        if (s.autoDeletePhotos) {
          cleanupExpiredDonePhotos(s.keepPhotosDays).catch(() => {});
        }
      } catch {
        // Keep defaults
      }
    })();

    return () => {
      if (bannerTimer !== null) {
        window.clearTimeout(bannerTimer);
      }
    };
  }, []);

  const handlePhotoSaved = useCallback(() => {
    setRefreshSignal((v) => v + 1);
  }, []);

  const handleUpdateSettings = useCallback(
    async (partial: Partial<AppSettings>) => {
      const next = await saveSettings(partial);
      setSettings(next);

      if (next.autoDeletePhotos) {
        await cleanupExpiredDonePhotos(next.keepPhotosDays).catch(() => {});
      }
      setRefreshSignal((v) => v + 1);
    },
    []
  );

  const handleDataChanged = useCallback(() => {
    setRefreshSignal((v) => v + 1);
    getSettings()
      .then((s) => {
        setSettings(s);
      })
      .catch(() => {});
  }, []);

  const handleOpenPhotoInLog = useCallback(
    (photoId: string) => {
      music.setIsSheetOpen(false);
      setFocusLogPhotoId(photoId);
      setActiveTab('log');
    },
    [music]
  );

  return (
    <div
      className="min-h-[100dvh] bg-[#F7F8FA] dark:bg-slate-950 text-slate-900 dark:text-slate-100"
      dir="rtl"
    >
      {/* Single <audio> element lives at app root ONLY when the Music Player module is ON */}
      {settings.musicPlayerEnabled && (
        <audio
          ref={music.audioRef}
          preload="metadata"
          data-testid="global-music-audio"
          onLoadedMetadata={music.audioEvents.onLoadedMetadata}
          onTimeUpdate={music.audioEvents.onTimeUpdate}
          onPlay={music.audioEvents.onPlay}
          onPlaying={music.audioEvents.onPlaying}
          onCanPlay={music.audioEvents.onCanPlay}
          onWaiting={music.audioEvents.onWaiting}
          onStalled={music.audioEvents.onStalled}
          onPause={music.audioEvents.onPause}
          onEnded={music.audioEvents.onEnded}
          onError={music.audioEvents.onError}
          className="hidden"
        />
      )}

      {/* One-time notice after first-launch legacy AI cleanup */}
      {showLegacyCleanupBanner && (
        <div
          data-testid="legacy-ai-cleanup-banner"
          role="status"
          className="fixed top-[max(12px,env(safe-area-inset-top,0px))] inset-x-4 z-[60] flex justify-center pointer-events-none"
        >
          <div className="pointer-events-auto max-w-md w-full px-3.5 py-2.5 rounded-2xl shadow-xl bg-slate-900/95 text-white border border-slate-700 text-xs font-extrabold flex items-center justify-between gap-2 backdrop-blur-md">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>تم حذف بيانات التحليل القديمة</span>
            </div>
            <button
              type="button"
              onClick={() => setShowLegacyCleanupBanner(false)}
              aria-label="إغلاق إشعار حذف بيانات التحليل"
              className="w-7 h-7 rounded-lg bg-white/15 flex items-center justify-center shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {activeTab === 'capture' && (
        <CameraScreen
          sessionId={sessionId}
          settings={settings}
          isOnline={isOnline}
          onPhotoQueued={handlePhotoSaved}
          onOpenPhotoInLog={handleOpenPhotoInLog}
          onUpdateSettings={handleUpdateSettings}
        />
      )}

      {activeTab === 'log' && (
        <LogScreen
          refreshSignal={refreshSignal}
          focusPhotoId={focusLogPhotoId}
          onClearFocusPhoto={() => setFocusLogPhotoId(null)}
        />
      )}

      {activeTab === 'notes' && (
        <NotesScreen
          settings={settings}
          refreshSignal={refreshSignal}
          onUpdateSettings={handleUpdateSettings}
          onKeyboardOpenChange={setIsNotesKeyboardOpen}
        />
      )}

      {activeTab === 'settings' && (
        <SettingsScreen
          settings={settings}
          isOnline={isOnline}
          refreshSignal={refreshSignal}
          musicStorageStats={music.storageStats}
          musicImportProgress={music.importProgress}
          musicImportReport={music.importReport}
          audioReactiveWarning={music.audioReactiveWarning}
          onAddMusicFiles={music.addFiles}
          onCancelMusicImport={music.cancelImport}
          onDismissMusicImportReport={music.dismissImportReport}
          onOpenMusicPlayer={() => music.setIsSheetOpen(true)}
          onClearMusicLibrary={music.clearLibrary}
          onUpdateSettings={handleUpdateSettings}
          onDataChanged={handleDataChanged}
        />
      )}

      {/* Draggable Floating Side Button */}
      {settings.musicPlayerEnabled && (
        <MusicFloatingButton
          visible={showFloatingButton}
          isPlaying={music.isPlaying}
          isMuted={music.isMuted}
          currentTrack={music.currentTrack}
          sleepRemainingSec={music.sleepRemainingSec}
          colorPresetId={settings.musicFabColor}
          visualEffects={settings.musicVisualEffects}
          reactiveLevels={music.reactiveLevels}
          onTapOpen={() => music.setIsSheetOpen(true)}
          onLongPressTogglePlay={() => void music.togglePlayPause()}
        />
      )}

      {/* Music Window Bottom Sheet */}
      {settings.musicPlayerEnabled && (
        <MusicPlayerSheet
          open={music.isSheetOpen}
          onClose={() => music.setIsSheetOpen(false)}
          tracks={music.tracks}
          lists={music.lists}
          storageStats={music.storageStats}
          maxStorageMb={settings.musicMaxStorageMb}
          currentTrack={music.currentTrack}
          currentTrackId={music.currentTrackId}
          isPlaying={music.isPlaying}
          isBuffering={music.isBuffering}
          lastError={music.lastError}
          positionSec={music.positionSec}
          durationSec={music.durationSec}
          volume={music.volume}
          isMuted={music.isMuted}
          shuffle={music.shuffle}
          repeat={music.repeat}
          sleepTimerMinutes={music.sleepTimerMinutes}
          sleepRemainingSec={music.sleepRemainingSec}
          importProgress={music.importProgress}
          importReport={music.importReport}
          onCancelImport={music.cancelImport}
          onDismissImportReport={music.dismissImportReport}
          onPlayTrack={(id) => void music.playTrackById(id)}
          onTogglePlayPause={() => void music.togglePlayPause()}
          onNext={() => void music.playNext()}
          onPrev={() => void music.playPrev()}
          onSeek={music.seekTo}
          onVolumeChange={music.setVolume}
          onToggleMute={music.toggleMute}
          onToggleShuffle={music.toggleShuffle}
          onCycleRepeat={music.cycleRepeat}
          onStartSleepTimer={music.startSleepTimer}
          onCancelSleepTimer={music.cancelSleepTimer}
          onAddFiles={music.addFiles}
          onReattachFile={music.reattachFile}
          onAddRadio={music.addRadio}
          onRenameTrack={music.renameTrack}
          onToggleFavorite={music.toggleFavorite}
          onUpdateTrackCover={music.updateTrackCover}
          onSetTrackTileColor={music.setTrackTileColor}
          onToggleTrackInList={music.toggleTrackInList}
          onCreateList={music.createList}
          onDeleteList={music.deleteList}
          onReorderTrack={music.reorderTrack}
          onDeleteTrack={music.deleteTrack}
          onGetDiagnostics={music.getDiagnosticsSnapshot}
        />
      )}

      {/* Music Error / Status Toast */}
      {settings.musicPlayerEnabled && music.toast && (
        <div
          data-testid="music-toast"
          className={`fixed inset-x-4 z-[60] flex justify-center pointer-events-none ${
            music.isSheetOpen
              ? 'top-[max(12px,env(safe-area-inset-top,0px))]'
              : 'bottom-[calc(80px+env(safe-area-inset-bottom,0px))]'
          }`}
        >
          <div
            className={`pointer-events-auto max-w-md w-full px-3.5 py-2.5 rounded-2xl shadow-lg border text-xs font-extrabold flex items-center justify-between gap-2 ${
              music.toast.type === 'error'
                ? 'bg-red-600 text-white border-red-500'
                : 'bg-slate-900 text-white border-slate-700'
            }`}
          >
            <span>{music.toast.text}</span>
            <button
              type="button"
              onClick={music.dismissToast}
              aria-label="إغلاق الإشعار"
              className="w-7 h-7 rounded-lg bg-white/15 flex items-center justify-center shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      <OfflineIndicator />

      {!(activeTab === 'notes' && isNotesKeyboardOpen) && (
        <BottomNav activeTab={activeTab} onTabChange={handleTabChange} />
      )}
    </div>
  );
}

export default App;
