import { useEffect, useState } from 'react';
import { shouldRegisterServiceWorker } from './pwaDiagnostics';

export interface OfflineSWState {
  swSupported: boolean;
  swRegistered: boolean;
  swActive: boolean;
  offlineReady: boolean;
  updateAvailable: boolean;
  lastError: string | null;
}

const hasSWApi =
  typeof navigator !== 'undefined' && 'serviceWorker' in navigator;

let currentState: OfflineSWState = {
  swSupported: hasSWApi,
  swRegistered: false,
  swActive: Boolean(hasSWApi && navigator.serviceWorker.controller),
  offlineReady: Boolean(hasSWApi && navigator.serviceWorker.controller),
  updateAvailable: false,
  lastError: null,
};

let initialized = false;
let waitingWorkerRef: ServiceWorker | null = null;
const listeners = new Set<(state: OfflineSWState) => void>();

function formatError(err: unknown): string {
  if (err instanceof Error) {
    return `${err.name}: ${err.message}`.trim();
  }
  if (typeof err === 'string') return err;
  return 'خطأ غير معروف';
}

function emit(partial: Partial<OfflineSWState>) {
  currentState = { ...currentState, ...partial };
  for (const fn of listeners) {
    fn(currentState);
  }
}

export function recordPwaLastError(err: unknown): void {
  const msg = formatError(err);
  emit({ lastError: msg });
}

export function getLastPwaError(): string | null {
  return currentState.lastError;
}

export function triggerWaitingServiceWorkerReload(): void {
  if (waitingWorkerRef) {
    try {
      waitingWorkerRef.postMessage({ type: 'SKIP_WAITING' });
    } catch {
      // Fallback to regular reload
    }
  }
  if (typeof window !== 'undefined') {
    window.location.reload();
  }
}

function attachRegistrationListeners(reg: ServiceWorkerRegistration): void {
  const syncFromReg = () => {
    const active = Boolean(
      (reg.active && reg.active.state === 'activated') ||
        (hasSWApi && navigator.serviceWorker.controller)
    );
    const waiting = Boolean(
      reg.waiting && hasSWApi && navigator.serviceWorker.controller
    );
    if (reg.waiting) {
      waitingWorkerRef = reg.waiting;
    }
    emit({
      swRegistered: true,
      swActive: active,
      offlineReady: active,
      updateAvailable: waiting || Boolean(reg.waiting && reg.active),
    });
  };

  syncFromReg();

  const watchWorker = (worker: ServiceWorker | null) => {
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && hasSWApi && navigator.serviceWorker.controller) {
        waitingWorkerRef = worker;
        emit({ updateAvailable: true });
      }
      if (worker.state === 'activated') {
        emit({
          swRegistered: true,
          swActive: true,
          offlineReady: true,
        });
      }
    });
  };

  watchWorker(reg.installing);
  watchWorker(reg.waiting);

  reg.addEventListener('updatefound', () => {
    watchWorker(reg.installing);
  });
}

export function initOfflineServiceWorker(): void {
  if (initialized) return;
  initialized = true;

  if (!hasSWApi) {
    emit({ swSupported: false, swRegistered: false, swActive: false, offlineReady: false });
    return;
  }

  if (typeof window === 'undefined') return;
  const { protocol, hostname } = window.location;
  if (!shouldRegisterServiceWorker(protocol, hostname)) {
    emit({
      swSupported: true,
      swRegistered: false,
      swActive: false,
      offlineReady: false,
      lastError: `التسجيل يتطلب HTTPS أو localhost (${protocol})`,
    });
    return;
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    emit({ swRegistered: true, swActive: true, offlineReady: true });
  });

  navigator.serviceWorker
    .register('/sw.js', { scope: '/' })
    .then((reg) => {
      attachRegistrationListeners(reg);
    })
    .catch((err) => {
      // Fail silently on restricted contexts; keep error for diagnostics only
      recordPwaLastError(err);
    });
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
