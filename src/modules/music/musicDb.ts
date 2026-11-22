import {
  compressCoverBlobToDataUrl,
  extractEmbeddedCoverArtBytes,
} from './coverArt';
import {
  canAddAudioBytes,
  DEFAULT_MUSIC_MAX_STORAGE_MB,
  deriveShortTrackName,
  findMatchingMissingTrack,
  formatMusicImportSummary,
  isBrowserStorageLow,
  isDuplicateAudioFile,
  isValidRadioUrl,
  makeAudioDuplicateKey,
  mergeImportedMusicTracks,
  normalizeTrackOrder,
  reorderTrackList,
} from './musicLogic';
import { resolveAudioMimeType } from './musicPlaybackHelpers';
import {
  MusicAddFilesResult,
  MusicBackupSection,
  MusicBackupTrackMeta,
  MusicBlobRecord,
  MusicCustomList,
  MusicImportFailedItem,
  MusicImportProgress,
  MusicPlaybackState,
  MusicRepeatMode,
  MusicStorageStats,
  MusicTrackRecord,
} from './types';

const MUSIC_DB_NAME = 'naqs_music_library_db';
const MUSIC_DB_VERSION = 1;

const STORE_TRACKS = 'music_tracks';
const STORE_BLOBS = 'music_blobs';
const STORE_STATE = 'music_state';

const STATE_KEY_PLAYBACK = 'playback';
const STATE_KEY_CUSTOM_LISTS = 'custom_lists';

let musicDbInstance: IDBDatabase | null = null;

export const DEFAULT_PLAYBACK_STATE: MusicPlaybackState = {
  key: 'playback',
  currentTrackId: null,
  positionSec: 0,
  trackPositions: {},
  volume: 1,
  muted: false,
  lastNonZeroVolume: 1,
  shuffle: false,
  repeat: 'off',
  updatedAt: 0,
};

export async function initMusicDB(): Promise<IDBDatabase> {
  if (musicDbInstance) return musicDbInstance;

  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB غير مدعوم في هذا المتصفح'));
      return;
    }

    const req = indexedDB.open(MUSIC_DB_NAME, MUSIC_DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_TRACKS)) {
        const trackStore = db.createObjectStore(STORE_TRACKS, { keyPath: 'id' });
        trackStore.createIndex('order', 'order', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_STATE)) {
        db.createObjectStore(STORE_STATE, { keyPath: 'key' });
      }
    };

    req.onsuccess = () => {
      musicDbInstance = req.result;
      musicDbInstance.onclose = () => {
        musicDbInstance = null;
      };
      resolve(musicDbInstance);
    };

    req.onerror = () => {
      reject(req.error || new Error('تعذر فتح قاعدة بيانات الصوتيات'));
    };
  });
}

export async function requestMusicStoragePersistence(): Promise<boolean> {
  if (
    typeof navigator !== 'undefined' &&
    navigator.storage &&
    typeof navigator.storage.persist === 'function'
  ) {
    try {
      const already =
        typeof navigator.storage.persisted === 'function'
          ? await navigator.storage.persisted()
          : false;
      if (already) return true;
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  }
  return false;
}

export async function isMusicStoragePersisted(): Promise<boolean> {
  if (
    typeof navigator !== 'undefined' &&
    navigator.storage &&
    typeof navigator.storage.persisted === 'function'
  ) {
    try {
      return await navigator.storage.persisted();
    } catch {
      return false;
    }
  }
  return false;
}

export async function getAllMusicTracks(): Promise<MusicTrackRecord[]> {
  const db = await initMusicDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_TRACKS, 'readonly');
    const req = tx.objectStore(STORE_TRACKS).getAll();
    req.onsuccess = () => {
      const raw = (req.result as MusicTrackRecord[]) || [];
      resolve(normalizeTrackOrder(raw));
    };
    req.onerror = () => resolve([]);
  });
}

export async function getMusicBlob(trackId: string): Promise<Blob | null> {
  const db = await initMusicDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_BLOBS, 'readonly');
    const req = tx.objectStore(STORE_BLOBS).get(trackId);
    req.onsuccess = () => {
      const rec = req.result as MusicBlobRecord | undefined;
      resolve(rec?.blob instanceof Blob ? rec.blob : null);
    };
    req.onerror = () => resolve(null);
  });
}

export async function getExistingMusicBlobIds(): Promise<Set<string>> {
  const db = await initMusicDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_BLOBS, 'readonly');
    const req = tx.objectStore(STORE_BLOBS).getAllKeys();
    req.onsuccess = () => {
      const keys = (req.result as IDBValidKey[]) || [];
      resolve(new Set(keys.map((k) => String(k))));
    };
    req.onerror = () => resolve(new Set());
  });
}

async function getAllMusicBlobSizes(): Promise<{ count: number; totalBytes: number }> {
  const db = await initMusicDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_BLOBS, 'readonly');
    const req = tx.objectStore(STORE_BLOBS).getAll();
    req.onsuccess = () => {
      const list = (req.result as MusicBlobRecord[]) || [];
      let totalBytes = 0;
      for (const item of list) {
        totalBytes += item?.blob?.size || item?.size || 0;
      }
      resolve({ count: list.length, totalBytes });
    };
    req.onerror = () => resolve({ count: 0, totalBytes: 0 });
  });
}

export async function getMusicStorageStats(): Promise<MusicStorageStats> {
  const [tracks, blobInfo, persisted] = await Promise.all([
    getAllMusicTracks(),
    getAllMusicBlobSizes(),
    isMusicStoragePersisted(),
  ]);

  let browserUsageBytes = 0;
  let browserQuotaBytes = 0;
  if (
    typeof navigator !== 'undefined' &&
    navigator.storage &&
    typeof navigator.storage.estimate === 'function'
  ) {
    try {
      const est = await navigator.storage.estimate();
      browserUsageBytes = typeof est.usage === 'number' ? est.usage : 0;
      browserQuotaBytes = typeof est.quota === 'number' ? est.quota : 0;
    } catch {
      // Ignore storage estimate failure
    }
  }

  return {
    trackCount: tracks.length,
    fileTrackCount: tracks.filter((t) => t.kind === 'file').length,
    radioCount: tracks.filter((t) => t.kind === 'radio').length,
    usedBytes: blobInfo.totalBytes,
    persisted,
    isStorageLow: isBrowserStorageLow(browserUsageBytes, browserQuotaBytes),
    browserUsageBytes,
    browserQuotaBytes,
  };
}

export function extractAudioDuration(
  blob: Blob,
  timeoutMs: number = 1500
): Promise<number> {
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    return Promise.resolve(0);
  }
  return new Promise((resolve) => {
    let settled = false;
    let objectUrl = '';
    const tempAudio = document.createElement('audio');
    tempAudio.preload = 'metadata';

    const finish = (dur: number) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      tempAudio.onloadedmetadata = null;
      tempAudio.ondurationchange = null;
      tempAudio.onerror = null;
      tempAudio.src = '';
      if (objectUrl) {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch {
          // Ignore revoke failure
        }
      }
      resolve(Number.isFinite(dur) && dur > 0 ? dur : 0);
    };

    const timer = window.setTimeout(() => finish(0), timeoutMs);

    tempAudio.onloadedmetadata = () => {
      if (Number.isFinite(tempAudio.duration) && tempAudio.duration > 0) {
        finish(tempAudio.duration);
      }
    };
    tempAudio.ondurationchange = () => {
      if (Number.isFinite(tempAudio.duration) && tempAudio.duration > 0) {
        finish(tempAudio.duration);
      }
    };
    tempAudio.onerror = () => finish(0);

    try {
      objectUrl = URL.createObjectURL(blob);
      tempAudio.src = objectUrl;
    } catch {
      finish(0);
    }
  });
}

async function extractAndCompressCoverFromBuffer(
  buffer: ArrayBuffer
): Promise<string | undefined> {
  try {
    const embedded = extractEmbeddedCoverArtBytes(buffer);
    if (!embedded) return undefined;
    const rawCopy = new Uint8Array(embedded.bytes.length);
    rawCopy.set(embedded.bytes);
    const coverBlob = new Blob([rawCopy.buffer], { type: embedded.mimeType });
    return await compressCoverBlobToDataUrl(coverBlob, 160);
  } catch {
    return undefined;
  }
}

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

export async function addAudioFilesToLibrary(
  files: File[],
  maxStorageMb: number = DEFAULT_MUSIC_MAX_STORAGE_MB,
  options?: {
    onProgress?: (progress: MusicImportProgress) => void;
    shouldCancel?: () => boolean;
    onTrackWritten?: () => void;
  }
): Promise<MusicAddFilesResult> {
  const [existingTracks, blobInfo] = await Promise.all([
    getAllMusicTracks(),
    getAllMusicBlobSizes(),
  ]);

  let currentUsed = blobInfo.totalBytes;

  const isFirstFile = blobInfo.count === 0;
  let persisted = await isMusicStoragePersisted();
  if ((isFirstFile || !persisted) && files.length > 0) {
    persisted = await requestMusicStoragePersistence();
  }

  const workingTracks = [...existingTracks];
  let nextOrder =
    workingTracks.length > 0
      ? Math.max(...workingTracks.map((t) => t.order)) + 1
      : 0;

  const seenBatchKeys = new Set<string>();
  const addedTracks: MusicTrackRecord[] = [];
  const reattachedTracks: MusicTrackRecord[] = [];
  const failedFiles: MusicImportFailedItem[] = [];
  let skippedInvalid = 0;
  let skippedDuplicatesCount = 0;
  let cancelled = false;

  const db = await initMusicDB();

  for (let i = 0; i < files.length; i++) {
    if (options?.shouldCancel?.()) {
      cancelled = true;
      break;
    }

    const file = files[i];
    const fileName = file?.name || `ملف_${i + 1}`;
    options?.onProgress?.({
      active: true,
      currentIndex: i + 1,
      total: files.length,
      currentFileName: fileName,
      addedCount: addedTracks.length + reattachedTracks.length,
      skippedDuplicatesCount,
      failedCount: failedFiles.length,
    });

    if (!file || file.size <= 0) {
      skippedInvalid += 1;
      failedFiles.push({
        fileName,
        reason: 'ملف فارغ أو غير صالح',
      });
      await yieldToMainThread();
      continue;
    }

    if (isDuplicateAudioFile(workingTracks, seenBatchKeys, file.name, file.size)) {
      skippedDuplicatesCount += 1;
      await yieldToMainThread();
      continue;
    }

    const capCheck = canAddAudioBytes(currentUsed, file.size, maxStorageMb);
    if (!capCheck.ok) {
      failedFiles.push({
        fileName,
        reason: `يتجاوز الحد الأقصى للمساحة (${maxStorageMb} م.ب)`,
      });
      await yieldToMainThread();
      continue;
    }

    let buffer: ArrayBuffer;
    let copiedBlob: Blob;
    const mimeType = resolveAudioMimeType(file.type, file.name);
    try {
      buffer = await file.arrayBuffer();
      copiedBlob = new Blob([buffer], { type: mimeType });
    } catch {
      failedFiles.push({
        fileName,
        reason: 'تعذر قراءة الملف الصوتي',
      });
      await yieldToMainThread();
      continue;
    }

    if (options?.shouldCancel?.()) {
      cancelled = true;
      break;
    }

    const [duration, coverDataUrl] = await Promise.all([
      extractAudioDuration(copiedBlob, 1200),
      extractAndCompressCoverFromBuffer(buffer),
    ]);

    const now = Date.now();
    const matchingMissing = findMatchingMissingTrack(
      workingTracks,
      file.name,
      file.size
    );

    let savedTrack: MusicTrackRecord;
    let blobRecord: MusicBlobRecord;

    if (matchingMissing) {
      savedTrack = {
        ...matchingMissing,
        fileName: file.name,
        mimeType,
        duration: duration > 0 ? duration : matchingMissing.duration,
        size: copiedBlob.size,
        coverDataUrl: matchingMissing.coverDataUrl || coverDataUrl,
        missingFile: false,
        updatedAt: now,
      };
      const idx = workingTracks.findIndex((t) => t.id === matchingMissing.id);
      if (idx >= 0) workingTracks[idx] = savedTrack;
      reattachedTracks.push(savedTrack);
      blobRecord = {
        id: savedTrack.id,
        blob: copiedBlob,
        mimeType,
        size: copiedBlob.size,
        updatedAt: now,
      };
    } else {
      const id = `trk_${now}_${Math.random().toString(36).slice(2, 7)}`;
      savedTrack = {
        id,
        kind: 'file',
        title: deriveShortTrackName(file.name),
        fileName: file.name,
        mimeType,
        duration,
        size: copiedBlob.size,
        order: nextOrder++,
        missingFile: false,
        coverDataUrl,
        createdAt: now,
        updatedAt: now,
      };
      workingTracks.push(savedTrack);
      addedTracks.push(savedTrack);
      blobRecord = {
        id,
        blob: copiedBlob,
        mimeType,
        size: copiedBlob.size,
        updatedAt: now,
      };
    }

    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([STORE_TRACKS, STORE_BLOBS], 'readwrite');
        tx.objectStore(STORE_TRACKS).put(savedTrack);
        tx.objectStore(STORE_BLOBS).put(blobRecord);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      seenBatchKeys.add(makeAudioDuplicateKey(file.name, file.size));
      currentUsed += copiedBlob.size;
      options?.onTrackWritten?.();
    } catch {
      if (addedTracks[addedTracks.length - 1]?.id === savedTrack.id) {
        addedTracks.pop();
        workingTracks.pop();
      }
      failedFiles.push({
        fileName,
        reason: 'تعذر حفظ الملف داخل التطبيق',
      });
    }

    await yieldToMainThread();
  }

  const totalAdded = addedTracks.length + reattachedTracks.length;
  const summaryText = formatMusicImportSummary({
    addedCount: totalAdded,
    skippedDuplicatesCount,
    failedCount: failedFiles.length,
  });

  return {
    addedTracks,
    reattachedTracks,
    rejectedOverLimit:
      totalAdded === 0 &&
      failedFiles.length > 0 &&
      failedFiles.every((f) => f.reason.includes('الحد الأقصى')),
    rejectedReason:
      totalAdded === 0 && failedFiles.length > 0
        ? failedFiles[0].reason
        : undefined,
    skippedInvalid,
    skippedDuplicatesCount,
    failedCount: failedFiles.length,
    failedFiles,
    cancelled,
    summaryText,
    usedBytes: currentUsed,
    persisted,
  };
}

export async function reattachMissingAudioFile(
  trackId: string,
  file: File,
  maxStorageMb: number = DEFAULT_MUSIC_MAX_STORAGE_MB
): Promise<{
  ok: boolean;
  track?: MusicTrackRecord;
  error?: string;
}> {
  const [tracks, blobInfo] = await Promise.all([
    getAllMusicTracks(),
    getAllMusicBlobSizes(),
  ]);
  const target = tracks.find((t) => t.id === trackId);
  if (!target) {
    return { ok: false, error: 'المقطع غير موجود في القائمة.' };
  }

  const capCheck = canAddAudioBytes(blobInfo.totalBytes, file.size, maxStorageMb);
  if (!capCheck.ok) {
    return {
      ok: false,
      error: `تجاوزت الحد الأقصى للمساحة الصوتية (${maxStorageMb} م.ب). احذف بعض المقاطع أو زِد الحد من الإعدادات.`,
    };
  }

  await requestMusicStoragePersistence();
  const mimeType = resolveAudioMimeType(file.type, file.name);
  let buffer: ArrayBuffer;
  let copiedBlob: Blob;
  try {
    buffer = await file.arrayBuffer();
    copiedBlob = new Blob([buffer], { type: mimeType });
  } catch {
    return { ok: false, error: 'تعذر قراءة الملف الصوتي.' };
  }

  const [duration, extractedCover] = await Promise.all([
    extractAudioDuration(copiedBlob),
    target.coverDataUrl
      ? Promise.resolve(undefined)
      : extractAndCompressCoverFromBuffer(buffer),
  ]);
  const now = Date.now();
  const updated: MusicTrackRecord = {
    ...target,
    fileName: file.name,
    mimeType,
    duration: duration > 0 ? duration : target.duration,
    size: copiedBlob.size,
    coverDataUrl: target.coverDataUrl || extractedCover,
    missingFile: false,
    updatedAt: now,
  };

  const db = await initMusicDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_TRACKS, STORE_BLOBS], 'readwrite');
    tx.objectStore(STORE_TRACKS).put(updated);
    tx.objectStore(STORE_BLOBS).put({
      id: target.id,
      blob: copiedBlob,
      mimeType,
      size: copiedBlob.size,
      updatedAt: now,
    } satisfies MusicBlobRecord);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return { ok: true, track: updated };
}

export async function addRadioStationToLibrary(
  title: string,
  streamUrl: string
): Promise<MusicTrackRecord> {
  const cleanUrl = streamUrl.trim();
  if (!isValidRadioUrl(cleanUrl)) {
    throw new Error('رابط الإذاعة غير صالح');
  }
  const cleanTitle = title.trim() || 'إذاعة مباشرة';
  const existing = await getAllMusicTracks();
  const nextOrder =
    existing.length > 0 ? Math.max(...existing.map((t) => t.order)) + 1 : 0;
  const now = Date.now();

  const station: MusicTrackRecord = {
    id: `rad_${now}_${Math.random().toString(36).slice(2, 7)}`,
    kind: 'radio',
    title: cleanTitle,
    streamUrl: cleanUrl,
    duration: 0,
    size: 0,
    order: nextOrder,
    missingFile: false,
    createdAt: now,
    updatedAt: now,
  };

  const db = await initMusicDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_TRACKS, 'readwrite');
    tx.objectStore(STORE_TRACKS).put(station);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return station;
}

async function updateTrackRecord(
  trackId: string,
  updater: (track: MusicTrackRecord) => MusicTrackRecord
): Promise<MusicTrackRecord | null> {
  const tracks = await getAllMusicTracks();
  const target = tracks.find((t) => t.id === trackId);
  if (!target) return null;

  const updated = updater(target);
  const db = await initMusicDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_TRACKS, 'readwrite');
    tx.objectStore(STORE_TRACKS).put(updated);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return updated;
}

export async function renameMusicTrack(
  trackId: string,
  newTitle: string
): Promise<MusicTrackRecord | null> {
  const trimmed = newTitle.trim();
  if (!trimmed) return null;
  return updateTrackRecord(trackId, (target) => ({
    ...target,
    title: trimmed,
    updatedAt: Date.now(),
  }));
}

export async function toggleTrackFavorite(
  trackId: string
): Promise<MusicTrackRecord | null> {
  return updateTrackRecord(trackId, (target) => ({
    ...target,
    favorite: !target.favorite,
    updatedAt: Date.now(),
  }));
}

export async function updateTrackCoverDataUrl(
  trackId: string,
  coverDataUrl: string | undefined
): Promise<MusicTrackRecord | null> {
  return updateTrackRecord(trackId, (target) => ({
    ...target,
    coverDataUrl,
    updatedAt: Date.now(),
  }));
}

export async function updateTrackTileColor(
  trackId: string,
  tileColor: string | undefined
): Promise<MusicTrackRecord | null> {
  return updateTrackRecord(trackId, (target) => ({
    ...target,
    tileColor,
    updatedAt: Date.now(),
  }));
}

export async function toggleTrackListMembership(
  trackId: string,
  listId: string
): Promise<MusicTrackRecord | null> {
  return updateTrackRecord(trackId, (target) => {
    const existing = Array.isArray(target.listIds) ? target.listIds : [];
    const exists = existing.includes(listId);
    const nextListIds = exists
      ? existing.filter((id) => id !== listId)
      : [...existing, listId];
    return {
      ...target,
      listIds: nextListIds,
      updatedAt: Date.now(),
    };
  });
}

export async function markTrackPlayed(
  trackId: string,
  playedAt: number = Date.now()
): Promise<MusicTrackRecord | null> {
  return updateTrackRecord(trackId, (target) => ({
    ...target,
    lastPlayedAt: playedAt,
  }));
}

export async function reorderMusicTrack(
  trackId: string,
  direction: 'up' | 'down'
): Promise<MusicTrackRecord[]> {
  const tracks = await getAllMusicTracks();
  const next = reorderTrackList(tracks, trackId, direction);

  const db = await initMusicDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_TRACKS, 'readwrite');
    const store = tx.objectStore(STORE_TRACKS);
    for (const item of next) {
      store.put(item);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return next;
}

export async function deleteMusicTrack(trackId: string): Promise<MusicTrackRecord[]> {
  const remaining = (await getAllMusicTracks()).filter((t) => t.id !== trackId);
  const normalized = normalizeTrackOrder(remaining);
  const currentState = await getMusicPlaybackState();

  const db = await initMusicDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_TRACKS, STORE_BLOBS, STORE_STATE], 'readwrite');
    tx.objectStore(STORE_TRACKS).clear();
    const tStore = tx.objectStore(STORE_TRACKS);
    for (const item of normalized) {
      tStore.put(item);
    }
    tx.objectStore(STORE_BLOBS).delete(trackId);
    if (currentState.currentTrackId === trackId) {
      tx.objectStore(STORE_STATE).put({
        ...currentState,
        currentTrackId: null,
        positionSec: 0,
        updatedAt: Date.now(),
      } satisfies MusicPlaybackState);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return normalized;
}

export async function clearMusicLibrary(): Promise<void> {
  const db = await initMusicDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_TRACKS, STORE_BLOBS, STORE_STATE], 'readwrite');
    tx.objectStore(STORE_TRACKS).clear();
    tx.objectStore(STORE_BLOBS).clear();
    tx.objectStore(STORE_STATE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Custom Playlists ("قوائم") stored cleanly inside STORE_STATE under key 'custom_lists'
export async function getAllMusicLists(): Promise<MusicCustomList[]> {
  const db = await initMusicDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_STATE, 'readonly');
    const req = tx.objectStore(STORE_STATE).get(STATE_KEY_CUSTOM_LISTS);
    req.onsuccess = () => {
      const rec = req.result as
        | { key: string; lists?: MusicCustomList[] }
        | undefined;
      const raw = Array.isArray(rec?.lists) ? rec.lists : [];
      const clean = raw.filter(
        (item): item is MusicCustomList =>
          Boolean(
            item &&
              typeof item === 'object' &&
              typeof item.id === 'string' &&
              typeof item.name === 'string'
          )
      );
      resolve(clean);
    };
    req.onerror = () => resolve([]);
  });
}

async function saveAllMusicLists(lists: MusicCustomList[]): Promise<void> {
  const db = await initMusicDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_STATE, 'readwrite');
    tx.objectStore(STORE_STATE).put({
      key: STATE_KEY_CUSTOM_LISTS,
      lists,
      updatedAt: Date.now(),
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function createMusicList(name: string): Promise<MusicCustomList> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('أدخل اسم القائمة');
  }
  const existing = await getAllMusicLists();
  const created: MusicCustomList = {
    id: `lst_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: trimmed,
    createdAt: Date.now(),
  };
  await saveAllMusicLists([...existing, created]);
  return created;
}

export async function renameMusicList(
  listId: string,
  newName: string
): Promise<MusicCustomList | null> {
  const trimmed = newName.trim();
  if (!trimmed) return null;
  const existing = await getAllMusicLists();
  let updatedItem: MusicCustomList | null = null;
  const next = existing.map((item) => {
    if (item.id === listId) {
      updatedItem = { ...item, name: trimmed };
      return updatedItem;
    }
    return item;
  });
  if (!updatedItem) return null;
  await saveAllMusicLists(next);
  return updatedItem;
}

export async function deleteMusicList(listId: string): Promise<MusicCustomList[]> {
  const [existingLists, tracks] = await Promise.all([
    getAllMusicLists(),
    getAllMusicTracks(),
  ]);
  const nextLists = existingLists.filter((l) => l.id !== listId);
  const updatedTracks = tracks
    .filter((t) => Array.isArray(t.listIds) && t.listIds.includes(listId))
    .map((t) => ({
      ...t,
      listIds: (t.listIds || []).filter((id) => id !== listId),
      updatedAt: Date.now(),
    }));

  const db = await initMusicDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_STATE, STORE_TRACKS], 'readwrite');
    tx.objectStore(STORE_STATE).put({
      key: STATE_KEY_CUSTOM_LISTS,
      lists: nextLists,
      updatedAt: Date.now(),
    });
    const tStore = tx.objectStore(STORE_TRACKS);
    for (const tr of updatedTracks) {
      tStore.put(tr);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return nextLists;
}

export async function getMusicPlaybackState(): Promise<MusicPlaybackState> {
  const db = await initMusicDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_STATE, 'readonly');
    const req = tx.objectStore(STORE_STATE).get(STATE_KEY_PLAYBACK);
    req.onsuccess = () => {
      const raw = req.result as Partial<MusicPlaybackState> | undefined;
      if (!raw) {
        resolve({ ...DEFAULT_PLAYBACK_STATE });
        return;
      }
      const repeat: MusicRepeatMode =
        raw.repeat === 'all' || raw.repeat === 'one' ? raw.repeat : 'off';
      const volume =
        typeof raw.volume === 'number' && Number.isFinite(raw.volume)
          ? Math.max(0, Math.min(1, raw.volume))
          : 1;
      const lastNonZeroVolume =
        typeof raw.lastNonZeroVolume === 'number' &&
        Number.isFinite(raw.lastNonZeroVolume) &&
        raw.lastNonZeroVolume > 0
          ? Math.max(0.05, Math.min(1, raw.lastNonZeroVolume))
          : volume > 0
          ? volume
          : 1;
      const rawPositions =
        raw.trackPositions && typeof raw.trackPositions === 'object'
          ? raw.trackPositions
          : {};
      const trackPositions: Record<string, number> = {};
      for (const [k, v] of Object.entries(rawPositions)) {
        if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
          trackPositions[k] = v;
        }
      }

      resolve({
        key: 'playback',
        currentTrackId:
          typeof raw.currentTrackId === 'string' && raw.currentTrackId
            ? raw.currentTrackId
            : null,
        positionSec:
          typeof raw.positionSec === 'number' &&
          Number.isFinite(raw.positionSec) &&
          raw.positionSec >= 0
            ? raw.positionSec
            : 0,
        trackPositions,
        volume,
        muted: Boolean(raw.muted),
        lastNonZeroVolume,
        shuffle: Boolean(raw.shuffle),
        repeat,
        updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
      });
    };
    req.onerror = () => resolve({ ...DEFAULT_PLAYBACK_STATE });
  });
}

export async function saveMusicPlaybackState(
  partial: Partial<Omit<MusicPlaybackState, 'key'>>
): Promise<MusicPlaybackState> {
  const current = await getMusicPlaybackState();
  const next: MusicPlaybackState = {
    ...current,
    ...partial,
    key: 'playback',
    updatedAt: Date.now(),
  };
  const db = await initMusicDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_STATE, 'readwrite');
    tx.objectStore(STORE_STATE).put(next);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return next;
}

export async function restoreMusicBackupSection(
  importedTracks: MusicBackupTrackMeta[],
  playback?: MusicBackupSection['playback'],
  importedLists?: MusicCustomList[]
): Promise<MusicTrackRecord[]> {
  const [existingTracks, existingBlobIds, existingLists] = await Promise.all([
    getAllMusicTracks(),
    getExistingMusicBlobIds(),
    getAllMusicLists(),
  ]);

  const merged = mergeImportedMusicTracks(
    existingTracks,
    existingBlobIds,
    importedTracks
  );

  // Merge custom lists by id without dropping any local-only lists
  let mergedLists: MusicCustomList[] | null = null;
  if (Array.isArray(importedLists)) {
    const byId = new Map<string, MusicCustomList>();
    for (const l of existingLists) {
      byId.set(l.id, l);
    }
    for (const imp of importedLists) {
      if (imp && typeof imp.id === 'string' && typeof imp.name === 'string') {
        byId.set(imp.id, imp);
      }
    }
    mergedLists = Array.from(byId.values());
  }

  const db = await initMusicDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_TRACKS, STORE_STATE], 'readwrite');
    const tStore = tx.objectStore(STORE_TRACKS);
    tStore.clear();
    for (const item of merged) {
      tStore.put(item);
    }
    const stateStore = tx.objectStore(STORE_STATE);
    if (mergedLists) {
      stateStore.put({
        key: STATE_KEY_CUSTOM_LISTS,
        lists: mergedLists,
        updatedAt: Date.now(),
      });
    }
    if (playback && typeof playback === 'object') {
      const validRepeat: MusicRepeatMode =
        playback.repeat === 'all' || playback.repeat === 'one'
          ? playback.repeat
          : 'off';
      const vol =
        typeof playback.volume === 'number' && Number.isFinite(playback.volume)
          ? Math.max(0, Math.min(1, playback.volume))
          : 1;
      const lastNonZero =
        typeof playback.lastNonZeroVolume === 'number' &&
        Number.isFinite(playback.lastNonZeroVolume) &&
        playback.lastNonZeroVolume > 0
          ? Math.max(0.05, Math.min(1, playback.lastNonZeroVolume))
          : vol > 0
          ? vol
          : 1;
      stateStore.put({
        key: 'playback',
        currentTrackId:
          typeof playback.currentTrackId === 'string'
            ? playback.currentTrackId
            : null,
        positionSec: 0,
        trackPositions: {},
        volume: vol,
        muted: Boolean(playback.muted),
        lastNonZeroVolume: lastNonZero,
        shuffle: Boolean(playback.shuffle),
        repeat: validRepeat,
        updatedAt: Date.now(),
      } satisfies MusicPlaybackState);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return merged;
}
