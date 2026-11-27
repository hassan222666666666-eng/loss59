import { useEffect, useState } from 'react';
import { isStandaloneDisplayMode } from '../pwa/pwaDiagnostics';
import { recordPwaLastError } from '../pwa/registerOfflineSW';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface PWAInstallStoreState {
  deferredPrompt: BeforeInstallPromptEvent | null;
  isInstalled: boolean;
  isIOS: boolean;
}

function detectIsIOS(): boolean {
  if (typeof window === 'undefined') return false;
  const userAgent = window.navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod/.test(userAgent);
}

let storeState: PWAInstallStoreState = {
  deferredPrompt: null,
  isInstalled: isStandaloneDisplayMode(),
  isIOS: detectIsIOS(),
};

const listeners = new Set<(state: PWAInstallStoreState) => void>();
let globalListenersAttached = false;

function emitStore(partial: Partial<PWAInstallStoreState>) {
  storeState = { ...storeState, ...partial };
  for (const fn of listeners) {
    fn(storeState);
  }
}

function ensureGlobalListeners() {
  if (globalListenersAttached || typeof window === 'undefined') return;
  globalListenersAttached = true;

  const updateStandalone = () => {
    emitStore({ isInstalled: isStandaloneDisplayMode() });
  };

  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    emitStore({
      deferredPrompt: e as BeforeInstallPromptEvent,
      isInstalled: isStandaloneDisplayMode(),
    });
  });

  window.addEventListener('appinstalled', () => {
    emitStore({
      isInstalled: true,
      deferredPrompt: null,
    });
  });

  if (typeof window.matchMedia === 'function') {
    const mq = window.matchMedia('(display-mode: standalone)');
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', updateStandalone);
    }
  }
}

// Attach immediately on browser module load so early beforeinstallprompt events are never missed
ensureGlobalListeners();

export function usePWAInstall() {
  const [state, setState] = useState<PWAInstallStoreState>(() => ({
    ...storeState,
    isInstalled: isStandaloneDisplayMode() || storeState.isInstalled,
  }));

  useEffect(() => {
    ensureGlobalListeners();
    setState({
      ...storeState,
      isInstalled: isStandaloneDisplayMode() || storeState.isInstalled,
    });
    listeners.add(setState);
    return () => {
      listeners.delete(setState);
    };
  }, []);

  const install = async (): Promise<boolean> => {
    const promptEvent = storeState.deferredPrompt;
    if (!promptEvent) return false;
    try {
      await promptEvent.prompt();
      const { outcome } = await promptEvent.userChoice;
      if (outcome === 'accepted') {
        emitStore({ isInstalled: true, deferredPrompt: null });
        return true;
      }
      return false;
    } catch (err) {
      recordPwaLastError(err);
      return false;
    }
  };

  return {
    isInstallable: Boolean(state.deferredPrompt) && !state.isInstalled,
    isInstalled: state.isInstalled,
    isIOS: state.isIOS,
    install,
  };
}
