import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

export interface OfflineSWState {
  swSupported: boolean;
  offlineReady: boolean;
  updateAvailable: boolean;
}

let currentState: OfflineSWState = {
  swSupported:
    typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
  offlineReady:
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    Boolean(navigator.serviceWorker.controller),
  updateAvailable: false,
};

let initialized = false;
let updateSWFn: ((reloadPage?: boolean) => Promise<void>) | null = null;
const listeners = new Set<(state: OfflineSWState) => void>();

function emit(partial: Partial<OfflineSWState>) {
  currentState = { ...currentState, ...partial };
  for (const fn of listeners) {
    fn(currentState);
  }
}

export function initOfflineServiceWorker(): void {
  if (initialized) return;
  initialized = true;

  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    emit({ swSupported: false, offlineReady: false });
    return;
  }

  try {
    updateSWFn = registerSW({
      immediate: true,
      onOfflineReady() {
        emit({ offlineReady: true });
      },
      onNeedRefresh() {
        emit({ updateAvailable: true });
        if (updateSWFn) {
          updateSWFn(true).catch(() => {});
        }
      },
      onRegisteredSW(_swUrl, registration) {
        if (registration?.active || navigator.serviceWorker.controller) {
          emit({ offlineReady: true });
        }
        registration?.addEventListener('updatefound', () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'activated') {
              emit({ offlineReady: true });
            }
          });
        });
      },
      onRegisterError() {
        // Keep silent; app still falls back to browser HTTP/IndexedDB storage
      },
    });

    navigator.serviceWorker.ready
      .then((reg) => {
        if (reg.active) {
          emit({ offlineReady: true });
        }
      })
      .catch(() => {});
  } catch {
    // Ignore SW registration errors on restricted origins
  }
}

export function useOfflineSWStatus(): OfflineSWState {
  const [state, setState] = useState<OfflineSWState>(currentState);

  useEffect(() => {
    setState(currentState);
    listeners.add(setState);
    return () => {
      listeners.delete(setState);
    };
  }, []);

  return state;
}
