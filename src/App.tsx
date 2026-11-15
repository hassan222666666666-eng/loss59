import { useCallback, useEffect, useState } from 'react';
import { AppSettings, DEFAULT_SETTINGS } from './types';
import {
  getSettings,
  pausePendingPhotosToManual,
  requestStoragePersistence,
  saveSettings,
} from './modules/db';
import { analysisQueue } from './modules/analysis/analysisQueue';
import { CameraScreen } from './modules/camera/CameraScreen';
import { LogScreen } from './modules/log/LogScreen';
import { NotesScreen } from './modules/notes/NotesScreen';
import { SettingsScreen } from './modules/settings/SettingsScreen';
import { BottomNav, TabKey } from './components/BottomNav';
import { OfflineIndicator } from './components/OfflineIndicator';
import { useOnlineStatus } from './hooks/useOnlineStatus';

export function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('capture');
  const [sessionId] = useState(() => `sess_${Date.now()}`);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const isOnline = useOnlineStatus();
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [focusLogPhotoId, setFocusLogPhotoId] = useState<string | null>(null);

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

  // Pause heavy AI queue processing while Capture tab is open; resume when leaving it (only if AI enabled)
  useEffect(() => {
    analysisQueue.setPaused(activeTab === 'capture');
  }, [activeTab]);

  useEffect(() => {
    requestStoragePersistence().catch(() => {});
    getSettings()
      .then((s) => {
        setSettings(s);
        analysisQueue.setAiEnabled(s.aiAnalysisEnabled);
      })
      .catch(() => {});
    analysisQueue.setPaused(true);
    analysisQueue.init();

    const unsub = analysisQueue.subscribe(() => {
      setRefreshSignal((v) => v + 1);
    });
    return () => {
      unsub();
      analysisQueue.dispose();
    };
  }, []);

  const handlePhotoQueued = useCallback(() => {
    setRefreshSignal((v) => v + 1);
    if (settings.aiAnalysisEnabled) {
      analysisQueue.processQueue();
    }
  }, [settings.aiAnalysisEnabled]);

  const handleUpdateSettings = useCallback(
    async (partial: Partial<AppSettings>) => {
      if (partial.aiAnalysisEnabled === false) {
        analysisQueue.setAiEnabled(false);
        await pausePendingPhotosToManual();
      } else if (partial.aiAnalysisEnabled === true) {
        analysisQueue.setAiEnabled(true);
      }

      const next = await saveSettings(partial);
      setSettings(next);
      analysisQueue.setAiEnabled(next.aiAnalysisEnabled);

      if (next.autoDeletePhotos) {
        await analysisQueue.runAutoCleanupIfEnabled();
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
        analysisQueue.setAiEnabled(s.aiAnalysisEnabled);
      })
      .catch(() => {});
  }, []);

  const handleOpenPhotoInLog = useCallback((photoId: string) => {
    setFocusLogPhotoId(photoId);
    setActiveTab('log');
  }, []);

  return (
    <div
      className="min-h-[100dvh] bg-[#F7F8FA] dark:bg-slate-950 text-slate-900 dark:text-slate-100"
      dir="rtl"
    >
      {activeTab === 'capture' && (
        <CameraScreen
          sessionId={sessionId}
          settings={settings}
          isOnline={isOnline}
          onPhotoQueued={handlePhotoQueued}
          onOpenPhotoInLog={handleOpenPhotoInLog}
        />
      )}

      {activeTab === 'log' && (
        <LogScreen
          refreshSignal={refreshSignal}
          aiAnalysisEnabled={settings.aiAnalysisEnabled}
          isOnline={isOnline}
          focusPhotoId={focusLogPhotoId}
          onClearFocusPhoto={() => setFocusLogPhotoId(null)}
        />
      )}

      {activeTab === 'notes' && (
        <NotesScreen settings={settings} refreshSignal={refreshSignal} />
      )}

      {activeTab === 'settings' && (
        <SettingsScreen
          settings={settings}
          isOnline={isOnline}
          refreshSignal={refreshSignal}
          onUpdateSettings={handleUpdateSettings}
          onDataChanged={handleDataChanged}
        />
      )}

      <OfflineIndicator />

      <BottomNav
        activeTab={activeTab}
        onTabChange={(tab) => setActiveTab(tab)}
      />
    </div>
  );
}

export default App;
