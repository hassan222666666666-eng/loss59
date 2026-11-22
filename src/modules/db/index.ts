import {
  AppSettings,
  NoteItem,
  ShelfPhoto,
  WhatsAppRecipient,
} from '../../types';
import {
  clearSavedWhatsAppRecipients,
  getSavedWhatsAppRecipients,
  saveWhatsAppRecipients,
} from '../notes/whatsapp';
import { getCutoffDateKey } from '../../utils/arabicText';
import { buildMusicBackupTracks } from '../music/musicLogic';
import {
  getAllMusicLists,
  getAllMusicTracks,
  getMusicPlaybackState,
  restoreMusicBackupSection,
} from '../music/musicDb';
import { MusicBackupSection } from '../music/types';
import {
  CleanBackupPayload,
  LEGACY_LOCAL_STORAGE_PREFIXES,
  hasLegacyPhotoAiFields,
  hasLegacySettingsAiFields,
  isLegacyAiCleanupDone,
  markLegacyAiCleanupDone,
  normalizeImportedBackup,
  sanitizePhotoRecord,
  sanitizeSettingsRecord,
} from './backupSanitizer';

const DB_NAME = 'naqs_alrofoof_db';
const DB_VERSION = 11;

const LEGACY_STORES_TO_DELETE = [
  'ai_photos',
  'ai_gaps',
  'ai_products',
  'ai_product_history',
  'ai_bring_list',
  'ai_shelves',
  'ai_feedback',
  'ai_examples',
  'ai_spots',
  'ai_meta',
  'framing_references',
  'shelves',
  'shortages',
  'known_products',
  'pull_history',
  'manual_marks',
] as const;

let dbInstance: IDBDatabase | null = null;

export async function initDB(): Promise<IDBDatabase> {
  if (dbInstance) return dbInstance;

  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB غير مدعوم في هذا المتصفح'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const tx = (event.target as IDBOpenDBRequest).transaction;

      if (!db.objectStoreNames.contains('photos')) {
        const photoStore = db.createObjectStore('photos', { keyPath: 'id' });
        photoStore.createIndex('sessionId', 'sessionId', { unique: false });
        photoStore.createIndex('dateKey', 'dateKey', { unique: false });
        photoStore.createIndex('timestamp', 'timestamp', { unique: false });
      } else if (tx) {
        const photoStore = tx.objectStore('photos');
        if (photoStore.indexNames.contains('shelfId')) {
          photoStore.deleteIndex('shelfId');
        }
      }

      if (!db.objectStoreNames.contains('notes')) {
        const noteStore = db.createObjectStore('notes', { keyPath: 'id' });
        noteStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }

      for (const storeName of LEGACY_STORES_TO_DELETE) {
        if (db.objectStoreNames.contains(storeName)) {
          db.deleteObjectStore(storeName);
        }
      }
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      dbInstance.onclose = () => {
        dbInstance = null;
      };
      resolve(dbInstance);
    };

    request.onerror = () => {
      reject(request.error || new Error('فشل فتح قاعدة البيانات المحلية'));
    };
  });
}

export async function requestStoragePersistence(): Promise<boolean> {
  if (
    typeof navigator !== 'undefined' &&
    navigator.storage &&
    navigator.storage.persist
  ) {
    try {
      const persisted = await navigator.storage.persisted();
      if (persisted) return true;
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * One-time cleanup on first launch after removing the AI analysis module:
 * - Object stores for AI/shortages/shelves/products/pull_history are dropped via DB_VERSION=11 upgrade.
 * - Any legacy AI fields on existing `photos` records or `app_settings` are stripped cleanly.
 * - Photos, notes, music library, and remaining settings are never deleted.
 */
export async function cleanupLegacyAnalysisDataOnce(): Promise<{
  cleaned: boolean;
}> {
  const storage =
    typeof window !== 'undefined' ? window.localStorage : undefined;
  if (isLegacyAiCleanupDone(storage)) {
    return { cleaned: false };
  }

  try {
    const db = await initDB();

    // Strip legacy AI fields from existing photos without deleting any photo
    await new Promise<void>((resolve) => {
      const tx = db.transaction('photos', 'readwrite');
      const store = tx.objectStore('photos');
      const req = store.getAll();
      req.onsuccess = () => {
        const rows = (req.result as unknown[]) || [];
        for (const row of rows) {
          if (hasLegacyPhotoAiFields(row)) {
            const clean = sanitizePhotoRecord(row);
            if (clean) store.put(clean);
          }
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });

    // Strip legacy AI keys from stored settings without losing user preferences
    await new Promise<void>((resolve) => {
      const tx = db.transaction('settings', 'readwrite');
      const store = tx.objectStore('settings');
      const req = store.get('app_settings');
      req.onsuccess = () => {
        const res = req.result as { key: string; value?: unknown } | undefined;
        if (res?.value && hasLegacySettingsAiFields(res.value)) {
          store.put({
            key: 'app_settings',
            value: sanitizeSettingsRecord(
              res.value as Record<string, unknown>
            ),
          });
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });

    if (storage) {
      const keysToRemove: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (!key) continue;
        if (
          LEGACY_LOCAL_STORAGE_PREFIXES.some((prefix) =>
            key.startsWith(prefix)
          )
        ) {
          keysToRemove.push(key);
        }
      }
      for (const k of keysToRemove) {
        storage.removeItem(k);
      }
    }
  } finally {
    markLegacyAiCleanupDone(storage);
  }

  return { cleaned: true };
}

// ----------------- PHOTOS -----------------

export async function savePhoto(photo: ShelfPhoto): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite');
    tx.objectStore('photos').put(photo);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllPhotos(): Promise<ShelfPhoto[]> {
  const db = await initDB();
  return new Promise((resolve) => {
    const tx = db.transaction('photos', 'readonly');
    const req = tx.objectStore('photos').getAll();
    req.onsuccess = () => {
      const list = ((req.result as unknown[]) || [])
        .map((item) => sanitizePhotoRecord(item))
        .filter((item): item is ShelfPhoto => item !== null);
      list.sort((a, b) => b.timestamp - a.timestamp);
      resolve(list);
    };
    req.onerror = () => resolve([]);
  });
}

export async function deletePhotoById(photoId: string): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite');
    tx.objectStore('photos').delete(photoId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deletePhotosBulk(photoIds: string[]): Promise<void> {
  if (photoIds.length === 0) return;
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite');
    const store = tx.objectStore('photos');
    for (const id of photoIds) {
      store.delete(id);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function markPhotosDoneBulk(photos: ShelfPhoto[]): Promise<void> {
  if (photos.length === 0) return;
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite');
    const store = tx.objectStore('photos');
    for (const p of photos) {
      store.put({ ...p, done: true });
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Strips heavy image blobs (dataUrl) from expired completed photos while
 * NEVER deleting photos not marked done or notes.
 */
export async function cleanupExpiredDonePhotos(
  keepDays: number,
  ignoreAgeCutoff: boolean = false
): Promise<number> {
  const db = await initDB();
  const allPhotos = await getAllPhotos();
  const cutoffDateKey = getCutoffDateKey(keepDays, Date.now());

  const eligible = allPhotos.filter((p) => {
    if (!p.dataUrl || p.imageCleaned) return false;
    if (p.done !== true) return false;
    if (!ignoreAgeCutoff && p.dateKey >= cutoffDateKey) return false;
    return true;
  });

  if (eligible.length === 0) return 0;

  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite');
    const store = tx.objectStore('photos');
    for (const p of eligible) {
      store.put({
        ...p,
        dataUrl: '',
        imageCleaned: true,
      });
    }
    tx.oncomplete = () => resolve(eligible.length);
    tx.onerror = () => reject(tx.error);
  });
}

// ----------------- NOTES -----------------

export async function getAllNotes(): Promise<NoteItem[]> {
  const db = await initDB();
  return new Promise((resolve) => {
    const tx = db.transaction('notes', 'readonly');
    const req = tx.objectStore('notes').getAll();
    req.onsuccess = () => {
      const list = (req.result as NoteItem[]) || [];
      list.sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(list);
    };
    req.onerror = () => resolve([]);
  });
}

export async function saveNote(note: NoteItem): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('notes', 'readwrite');
    tx.objectStore('notes').put(note);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteNoteById(noteId: string): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('notes', 'readwrite');
    tx.objectStore('notes').delete(noteId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteNotesBulk(noteIds: string[]): Promise<void> {
  if (noteIds.length === 0) return;
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('notes', 'readwrite');
    const store = tx.objectStore('notes');
    for (const id of noteIds) {
      store.delete(id);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveNotesBulk(notes: NoteItem[]): Promise<void> {
  if (notes.length === 0) return;
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('notes', 'readwrite');
    const store = tx.objectStore('notes');
    for (const n of notes) {
      store.put(n);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ----------------- SETTINGS -----------------

export async function getSettings(): Promise<AppSettings> {
  const db = await initDB();
  return new Promise((resolve) => {
    const tx = db.transaction('settings', 'readonly');
    const req = tx.objectStore('settings').get('app_settings');
    req.onsuccess = () => {
      if (req.result && req.result.value) {
        resolve(
          sanitizeSettingsRecord(req.result.value as Partial<AppSettings>)
        );
      } else {
        resolve(sanitizeSettingsRecord());
      }
    };
    req.onerror = () => resolve(sanitizeSettingsRecord());
  });
}

export async function saveSettings(
  partial: Partial<AppSettings>
): Promise<AppSettings> {
  const current = await getSettings();
  const updated: AppSettings = sanitizeSettingsRecord({
    ...current,
    ...partial,
  });
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readwrite');
    tx.objectStore('settings').put({ key: 'app_settings', value: updated });
    tx.oncomplete = () => resolve(updated);
    tx.onerror = () => reject(tx.error);
  });
}

// ----------------- STORAGE ESTIMATE -----------------

export async function estimateStorageUsageBytes(): Promise<number> {
  const [photos, notes] = await Promise.all([getAllPhotos(), getAllNotes()]);

  let localBytes = 0;
  for (const p of photos) localBytes += (p.dataUrl?.length || 0) + 256;
  for (const n of notes) {
    localBytes += (n.title?.length || 0) * 2 + (n.body?.length || 0) * 2 + 256;
    for (const np of n.photos || []) {
      localBytes += np.dataUrl?.length || 0;
    }
    for (const lp of n.linePhotos || []) {
      localBytes += lp.dataUrl?.length || 0;
    }
  }

  if (
    typeof navigator !== 'undefined' &&
    navigator.storage &&
    navigator.storage.estimate
  ) {
    try {
      const est = await navigator.storage.estimate();
      if (typeof est.usage === 'number' && est.usage > 0) {
        return Math.max(est.usage, localBytes);
      }
    } catch {
      // Fallback to computed localBytes
    }
  }
  return localBytes;
}

// ----------------- BACKUP EXPORT / IMPORT / CLEAR -----------------

export type BackupPayload = CleanBackupPayload;

export async function exportBackupJson(): Promise<string> {
  const [settings, notes, photos, musicTracks, musicLists, musicState] =
    await Promise.all([
      getSettings(),
      getAllNotes(),
      getAllPhotos(),
      getAllMusicTracks().catch(() => []),
      getAllMusicLists().catch(() => []),
      getMusicPlaybackState().catch(() => null),
    ]);

  const whatsappRecipients = getSavedWhatsAppRecipients();

  const payload: CleanBackupPayload = {
    app: 'نقص الرفوف',
    version: 15,
    exportedAt: new Date().toISOString(),
    settings: sanitizeSettingsRecord(settings),
    notes,
    photos: photos
      .map((p) => sanitizePhotoRecord(p))
      .filter((p): p is ShelfPhoto => p !== null),
    whatsappRecipients,
    musicModule: {
      tracks: buildMusicBackupTracks(musicTracks),
      lists: musicLists,
      playback: musicState
        ? {
            currentTrackId: musicState.currentTrackId,
            volume: musicState.volume,
            muted: musicState.muted,
            lastNonZeroVolume: musicState.lastNonZeroVolume,
            shuffle: musicState.shuffle,
            repeat: musicState.repeat,
          }
        : undefined,
    },
  };
  return JSON.stringify(payload, null, 2);
}

export async function importBackupJson(jsonText: string): Promise<{
  photosCount: number;
  notesCount: number;
}> {
  const normalized = normalizeImportedBackup(jsonText);

  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['notes', 'photos', 'settings'], 'readwrite');

    if (normalized.settings) {
      tx.objectStore('settings').put({
        key: 'app_settings',
        value: normalized.settings,
      });
    }

    const noteStore = tx.objectStore('notes');
    for (const n of normalized.notes) {
      noteStore.put(n);
    }

    const photoStore = tx.objectStore('photos');
    for (const p of normalized.photos) {
      photoStore.put(p);
    }

    tx.oncomplete = async () => {
      if (normalized.whatsappRecipients) {
        saveWhatsAppRecipients(normalized.whatsappRecipients);
      }
      if (normalized.musicModule) {
        try {
          await restoreMusicBackupSection(
            normalized.musicModule.tracks,
            normalized.musicModule.playback,
            normalized.musicModule.lists
          );
        } catch {
          // Non-fatal if music DB restore fails
        }
      }
      resolve({
        photosCount: normalized.photos.length,
        notesCount: normalized.notes.length,
      });
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAllData(): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const stores = ['photos', 'notes', 'settings'];
    const tx = db.transaction(stores, 'readwrite');
    for (const name of stores) {
      tx.objectStore(name).clear();
    }
    tx.oncomplete = () => {
      clearSavedWhatsAppRecipients();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

export type { WhatsAppRecipient };
