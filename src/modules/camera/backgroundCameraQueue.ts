import { ShelfPhoto } from '../../types';
import { savePhotosBatch } from '../db';
import { saveCameraDiagnostics } from './cameraDiagnostics';

export const SHUTTER_BACKGROUND_PAUSE_MS = 1500;
export const ENHANCEMENT_IDLE_PAUSE_MS = 10000;
export const PHOTO_BATCH_FLUSH_SIZE = 4;

interface PendingWriteEntry {
  photo: ShelfPhoto;
  enqueuedAt: number;
  onFlushed?: (savingMsPerBatch: number) => void;
}

type IdleCallbackFn = (cb: () => void, options?: { timeout?: number }) => number;
type CancelIdleCallbackFn = (id: number) => void;

let captureTabActive = false;
let batterySaverActive = false;
let pageHidden =
  typeof document !== 'undefined' ? document.visibilityState === 'hidden' : false;
let lastShutterPressedAt = 0;
let lastCameraActivityAt = 0;
let capturesInFlight = 0;
let nowFn: () => number = () => Date.now();
let batchWriterFn: (photos: ShelfPhoto[]) => Promise<void> = savePhotosBatch;

const wakeListeners = new Set<() => void>();
let workerMutexChain: Promise<void> = Promise.resolve();
let pendingWriteQueue: PendingWriteEntry[] = [];
let writeFlushScheduled = false;
let writeFlushChain: Promise<void> = Promise.resolve();
const batchFlushedSubscribers = new Set<() => void>();

function notifyWakeListeners(): void {
  const snapshot = Array.from(wakeListeners);
  for (const fn of snapshot) {
    try {
      fn();
    } catch {
      // Ignore wake errors
    }
  }
}

export function setPageHidden(hidden: boolean): void {
  const prev = pageHidden;
  pageHidden = hidden;
  if (prev && !hidden) {
    notifyWakeListeners();
  }
}

export function isPageHiddenState(): boolean {
  return pageHidden;
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    setPageHidden(document.visibilityState === 'hidden');
  });
}

export function subscribeBatchPhotoFlushed(listener: () => void): () => void {
  batchFlushedSubscribers.add(listener);
  return () => {
    batchFlushedSubscribers.delete(listener);
  };
}

function notifyBatchFlushed(): void {
  for (const fn of batchFlushedSubscribers) {
    try {
      fn();
    } catch {
      // Ignore subscriber errors
    }
  }
}

export function setCaptureTabActive(active: boolean): void {
  const prev = captureTabActive;
  captureTabActive = active;
  if (active && !prev) {
    lastCameraActivityAt = nowFn();
  }
  if (prev && !active) {
    notifyWakeListeners();
    void flushPendingPhotoWritesNow();
  }
}

export function isCaptureTabActive(): boolean {
  return captureTabActive;
}

export function setBatterySaverActive(active: boolean): void {
  const prev = batterySaverActive;
  batterySaverActive = active;
  if (prev && !active) {
    notifyWakeListeners();
  }
}

export function isBatterySaverQueuePaused(): boolean {
  return pageHidden || (captureTabActive && batterySaverActive);
}

export function notifyShutterPressed(atMs: number = nowFn()): void {
  lastShutterPressedAt = atMs;
  lastCameraActivityAt = Math.max(lastCameraActivityAt, atMs);
}

export function notifyCameraActivity(atMs: number = nowFn()): void {
  lastCameraActivityAt = Math.max(lastCameraActivityAt, atMs);
}

export function setCapturesInFlight(count: number): void {
  capturesInFlight = Math.max(0, count);
  if (capturesInFlight === 0) {
    notifyWakeListeners();
  }
}

export function getRemainingShutterPauseMs(atMs: number = nowFn()): number {
  if (!captureTabActive || lastShutterPressedAt <= 0) {
    return 0;
  }
  const elapsed = Math.max(0, atMs - lastShutterPressedAt);
  return Math.max(0, SHUTTER_BACKGROUND_PAUSE_MS - elapsed);
}

export function getRemainingEnhancementIdleMs(atMs: number = nowFn()): number {
  if (!captureTabActive) return 0;
  const latestActivity = Math.max(lastShutterPressedAt, lastCameraActivityAt);
  if (latestActivity <= 0) return ENHANCEMENT_IDLE_PAUSE_MS;
  const elapsed = Math.max(0, atMs - latestActivity);
  return Math.max(0, ENHANCEMENT_IDLE_PAUSE_MS - elapsed);
}

function waitForIdleSlice(): Promise<void> {
  if (!captureTabActive) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const win =
      typeof window !== 'undefined'
        ? (window as unknown as {
            requestIdleCallback?: IdleCallbackFn;
            cancelIdleCallback?: CancelIdleCallbackFn;
          })
        : null;

    let done = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let idleId: number | null = null;

    const finish = () => {
      if (done) return;
      done = true;
      wakeListeners.delete(finish);
      if (timerId !== null) clearTimeout(timerId);
      if (idleId !== null && win?.cancelIdleCallback) {
        try {
          win.cancelIdleCallback(idleId);
        } catch {
          // Ignore
        }
      }
      resolve();
    };

    wakeListeners.add(finish);

    if (win && typeof win.requestIdleCallback === 'function') {
      idleId = win.requestIdleCallback(() => finish(), { timeout: 300 });
    } else {
      timerId = setTimeout(finish, 32);
    }
  });
}

function waitUntilWokenOrTimeout(waitMs: number | null): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (done) return;
      done = true;
      wakeListeners.delete(finish);
      if (timerId !== null) clearTimeout(timerId);
      resolve();
    };
    wakeListeners.add(finish);
    if (waitMs !== null && waitMs > 0) {
      timerId = setTimeout(finish, waitMs);
    }
  });
}

/**
 * Waits while the Capture tab is open until:
 * 1) No active shutter job is grabbing frames/taking photos
 * 2) At least 1.5s has passed since the last shutter press
 * 3) An idle slice is available (skipped immediately if user leaves Capture tab)
 */
export async function waitForBackgroundSlot(options?: {
  requireIdle?: boolean;
}): Promise<void> {
  const requireIdle = options?.requireIdle !== false;

  while (captureTabActive) {
    const remainingMs = getRemainingShutterPauseMs(nowFn());
    if (capturesInFlight > 0 || remainingMs > 0) {
      const waitMs = capturesInFlight > 0 ? Math.max(remainingMs, 80) : remainingMs;
      await waitUntilWokenOrTimeout(waitMs);
      continue;
    }

    if (requireIdle) {
      await waitForIdleSlice();
      if (
        captureTabActive &&
        (capturesInFlight > 0 || getRemainingShutterPauseMs(nowFn()) > 0)
      ) {
        continue;
      }
    }
    break;
  }
}

/**
 * Gate for background photo enhancement & heavy Web Worker queue:
 * - Processes only 1 photo at a time (combined with runExclusiveWorkerTask)
 * - When page is hidden: waits until visible again (currently running photo finishes first)
 * - When Battery Saver is ON on Capture tab: pauses until leaving Capture tab (or Battery Saver OFF)
 * - While on Capture tab: waits until 10 seconds of idle/no capture, or runs immediately when leaving tab
 */
export async function waitForEnhancementSlot(): Promise<void> {
  while (true) {
    if (pageHidden) {
      await waitUntilWokenOrTimeout(null);
      continue;
    }

    if (captureTabActive) {
      if (batterySaverActive) {
        await waitUntilWokenOrTimeout(null);
        continue;
      }
      const remainingIdleMs = getRemainingEnhancementIdleMs(nowFn());
      if (capturesInFlight > 0 || remainingIdleMs > 0) {
        const waitMs =
          capturesInFlight > 0 ? Math.max(remainingIdleMs, 200) : remainingIdleMs;
        await waitUntilWokenOrTimeout(waitMs);
        continue;
      }

      await waitForIdleSlice();
      if (
        pageHidden ||
        (captureTabActive &&
          (batterySaverActive ||
            capturesInFlight > 0 ||
            getRemainingEnhancementIdleMs(nowFn()) > 0))
      ) {
        continue;
      }
    }

    break;
  }
}

/**
 * Enforces strictly one Web Worker task executing at a time across
 * both capture processing (imageWorker) and photo enhancement (enhanceWorker).
 */
export function runExclusiveWorkerTask<T>(task: () => Promise<T>): Promise<T> {
  const next = workerMutexChain.then(
    () => task(),
    () => task()
  );
  workerMutexChain = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

async function drainPhotoWriteBatches(): Promise<void> {
  while (pendingWriteQueue.length > 0) {
    if (captureTabActive) {
      await waitForBackgroundSlot({ requireIdle: true });
    }
    if (pendingWriteQueue.length === 0) break;

    const batch = pendingWriteQueue.splice(0, PHOTO_BATCH_FLUSH_SIZE);
    const startMs =
      typeof performance !== 'undefined' ? performance.now() : nowFn();
    await batchWriterFn(batch.map((b) => b.photo));
    const endMs =
      typeof performance !== 'undefined' ? performance.now() : nowFn();
    const totalBatchMs = Math.max(1, Math.round(endMs - startMs));
    const perPhotoMs = Math.max(1, Math.round(totalBatchMs / batch.length));

    saveCameraDiagnostics({
      lastSavingMs: perPhotoMs,
    });

    for (const entry of batch) {
      try {
        entry.onFlushed?.(perPhotoMs);
      } catch {
        // Ignore callback errors
      }
    }
    notifyBatchFlushed();
  }
}

export function flushPendingPhotoWritesNow(): Promise<void> {
  writeFlushScheduled = true;
  const run = () =>
    drainPhotoWriteBatches().finally(() => {
      if (pendingWriteQueue.length === 0) {
        writeFlushScheduled = false;
      }
    });
  writeFlushChain = writeFlushChain.then(run, run);
  return writeFlushChain;
}

/**
 * Schedules a processed photo to be persisted to IndexedDB in a small batch,
 * never inside the shutter handler and respecting the post-shutter pause.
 */
export function enqueueBatchedPhotoWrite(
  photo: ShelfPhoto,
  onFlushed?: (savingMs: number) => void
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    pendingWriteQueue.push({
      photo,
      enqueuedAt: nowFn(),
      onFlushed: (savingMs) => {
        onFlushed?.(savingMs);
        resolve();
      },
    });

    if (!writeFlushScheduled) {
      writeFlushScheduled = true;
      const run = () =>
        drainPhotoWriteBatches()
          .catch((err) => {
            reject(err);
          })
          .finally(() => {
            if (pendingWriteQueue.length > 0) {
              void flushPendingPhotoWritesNow();
            } else {
              writeFlushScheduled = false;
            }
          });
      writeFlushChain = writeFlushChain.then(run, run);
    }
  });
}

export function getPendingBatchWriteCount(): number {
  return pendingWriteQueue.length;
}

/**
 * Test-only hook for deterministic timing and IDB batching tests.
 */
export function __configureBackgroundQueueForTest(opts: {
  now?: () => number;
  batchWriter?: (photos: ShelfPhoto[]) => Promise<void>;
  pageHidden?: boolean;
  reset?: boolean;
}): void {
  if (opts.now) nowFn = opts.now;
  if (opts.batchWriter) batchWriterFn = opts.batchWriter;
  if (typeof opts.pageHidden === 'boolean') {
    setPageHidden(opts.pageHidden);
  }
  if (opts.reset) {
    captureTabActive = false;
    batterySaverActive = false;
    pageHidden = false;
    lastShutterPressedAt = 0;
    lastCameraActivityAt = 0;
    capturesInFlight = 0;
    pendingWriteQueue = [];
    writeFlushScheduled = false;
    workerMutexChain = Promise.resolve();
    writeFlushChain = Promise.resolve();
    wakeListeners.clear();
  }
}
