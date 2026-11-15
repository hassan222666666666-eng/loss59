import {
  AppSettings,
  DEFAULT_SETTINGS,
  KnownProduct,
  ManualProductMark,
  NoteItem,
  PullHistoryEntry,
  Shelf,
  ShelfPhoto,
  ShortageItem,
} from '../../types';
import {
  getCutoffDateKey,
  getLocalDateKey,
  isWithinLastDays,
  normalizeProductName,
} from '../../utils/arabicText';

const DB_NAME = 'naqs_alrofoof_db';
const DB_VERSION = 4;

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
        photoStore.createIndex('shelfId', 'shelfId', { unique: false });
      } else if (tx) {
        const photoStore = tx.objectStore('photos');
        if (!photoStore.indexNames.contains('shelfId')) {
          photoStore.createIndex('shelfId', 'shelfId', { unique: false });
        }
      }

      if (!db.objectStoreNames.contains('shelves')) {
        const shelfStore = db.createObjectStore('shelves', { keyPath: 'id' });
        shelfStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      if (!db.objectStoreNames.contains('shortages')) {
        const shortageStore = db.createObjectStore('shortages', { keyPath: 'id' });
        shortageStore.createIndex('photoId', 'photoId', { unique: false });
        shortageStore.createIndex('dateKey', 'dateKey', { unique: false });
        shortageStore.createIndex('status', 'status', { unique: false });
        shortageStore.createIndex('productId', 'productId', { unique: false });
      } else if (tx) {
        const shortageStore = tx.objectStore('shortages');
        if (!shortageStore.indexNames.contains('productId')) {
          shortageStore.createIndex('productId', 'productId', { unique: false });
        }
      }

      if (!db.objectStoreNames.contains('known_products')) {
        const prodStore = db.createObjectStore('known_products', { keyPath: 'id' });
        prodStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      if (!db.objectStoreNames.contains('pull_history')) {
        const pullStore = db.createObjectStore('pull_history', { keyPath: 'id' });
        pullStore.createIndex('productId', 'productId', { unique: false });
        pullStore.createIndex('dateKey', 'dateKey', { unique: false });
      }

      if (!db.objectStoreNames.contains('notes')) {
        const noteStore = db.createObjectStore('notes', { keyPath: 'id' });
        noteStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }

      if (!db.objectStoreNames.contains('manual_marks')) {
        const markStore = db.createObjectStore('manual_marks', { keyPath: 'id' });
        markStore.createIndex('photoId', 'photoId', { unique: false });
        markStore.createIndex('productId', 'productId', { unique: false });
        markStore.createIndex('dateKey', 'dateKey', { unique: false });
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

// ----------------- SHELVES & REFERENCE PHOTOS -----------------

export async function getAllShelves(): Promise<Shelf[]> {
  const db = await initDB();
  return new Promise((resolve) => {
    const tx = db.transaction('shelves', 'readonly');
    const req = tx.objectStore('shelves').getAll();
    req.onsuccess = () => {
      const list = (req.result as Shelf[]) || [];
      list.sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(list);
    };
    req.onerror = () => resolve([]);
  });
}

export async function getShelfById(id: string): Promise<Shelf | null> {
  const db = await initDB();
  return new Promise((resolve) => {
    const tx = db.transaction('shelves', 'readonly');
    const req = tx.objectStore('shelves').get(id);
    req.onsuccess = () => resolve((req.result as Shelf) || null);
    req.onerror = () => resolve(null);
  });
}

export async function saveShelf(shelf: Shelf): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('shelves', 'readwrite');
    tx.objectStore('shelves').put(shelf);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
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

export async function getPhotoById(id: string): Promise<ShelfPhoto | null> {
  const db = await initDB();
  return new Promise((resolve) => {
    const tx = db.transaction('photos', 'readonly');
    const req = tx.objectStore('photos').get(id);
    req.onsuccess = () => resolve((req.result as ShelfPhoto) || null);
    req.onerror = () => resolve(null);
  });
}

export async function getAllPhotos(): Promise<ShelfPhoto[]> {
  const db = await initDB();
  return new Promise((resolve) => {
    const tx = db.transaction('photos', 'readonly');
    const req = tx.objectStore('photos').getAll();
    req.onsuccess = () => {
      const list = (req.result as ShelfPhoto[]) || [];
      list.sort((a, b) => b.timestamp - a.timestamp);
      resolve(list);
    };
    req.onerror = () => resolve([]);
  });
}

export async function getPhotosBySession(sessionId: string): Promise<ShelfPhoto[]> {
  const db = await initDB();
  return new Promise((resolve) => {
    const tx = db.transaction('photos', 'readonly');
    const index = tx.objectStore('photos').index('sessionId');
    const req = index.getAll(sessionId);
    req.onsuccess = () => {
      const list = (req.result as ShelfPhoto[]) || [];
      list.sort((a, b) => b.timestamp - a.timestamp);
      resolve(list);
    };
    req.onerror = () => resolve([]);
  });
}

export async function getPendingPhotos(): Promise<ShelfPhoto[]> {
  const all = await getAllPhotos();
  return all
    .filter((p) => p.status === 'pending' && Boolean(p.dataUrl))
    .sort((a, b) => a.timestamp - b.timestamp);
}

export async function recoverStuckAnalyzingPhotos(): Promise<void> {
  const [all, settings] = await Promise.all([getAllPhotos(), getSettings()]);
  const stuck = all.filter((p) => p.status === 'analyzing');
  const targetStatus = settings.aiAnalysisEnabled ? 'pending' : 'manual_only';
  for (const p of stuck) {
    await savePhoto({ ...p, status: targetStatus, errorMessage: undefined });
  }
}

export async function pausePendingPhotosToManual(): Promise<number> {
  const all = await getAllPhotos();
  const pendingOrAnalyzing = all.filter(
    (p) => p.status === 'pending' || p.status === 'analyzing'
  );
  if (pendingOrAnalyzing.length === 0) return 0;

  const db = await initDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite');
    const store = tx.objectStore('photos');
    for (const p of pendingOrAnalyzing) {
      store.put({
        ...p,
        status: 'manual_only',
        errorMessage: undefined,
      });
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return pendingOrAnalyzing.length;
}

export async function getUnanalyzedPhotosCount(): Promise<number> {
  const all = await getAllPhotos();
  return all.filter(
    (p) =>
      Boolean(p.dataUrl) &&
      !p.analyzedAt &&
      (p.status === 'manual_only' || p.status === 'error')
  ).length;
}

export async function queueUnanalyzedPhotos(): Promise<number> {
  const all = await getAllPhotos();
  const toQueue = all.filter(
    (p) =>
      Boolean(p.dataUrl) &&
      !p.analyzedAt &&
      (p.status === 'manual_only' || p.status === 'error')
  );
  if (toQueue.length === 0) return 0;

  const db = await initDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite');
    const store = tx.objectStore('photos');
    for (const p of toQueue) {
      store.put({
        ...p,
        status: 'pending',
        errorMessage: undefined,
      });
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return toQueue.length;
}

export async function deletePhotoAndShortages(photoId: string): Promise<void> {
  const [shortages, marks] = await Promise.all([
    getShortagesByPhoto(photoId),
    getManualMarksByPhoto(photoId),
  ]);
  const affectedPairs = [
    ...shortages.map((s) => ({ productId: s.productId, dateKey: s.dateKey })),
    ...marks.map((m) => ({ productId: m.productId, dateKey: m.dateKey })),
  ];

  const db = await initDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['photos', 'shortages', 'manual_marks'], 'readwrite');
    tx.objectStore('photos').delete(photoId);
    const sStore = tx.objectStore('shortages');
    for (const s of shortages) {
      sStore.delete(s.id);
    }
    const mStore = tx.objectStore('manual_marks');
    for (const m of marks) {
      mStore.delete(m.id);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  if (affectedPairs.length > 0) {
    await reconcilePullHistoryPairs(affectedPairs);
  }
}

/**
 * Strips heavy image blobs (dataUrl) from expired completed photos while:
 * - NEVER deleting any photo not marked done (pending/analyzing/error/poor or having unfinished shortages)
 * - NEVER deleting product thumbnails, log numbers (shortages), pull history, or notes.
 */
export async function cleanupExpiredDonePhotos(
  keepDays: number,
  ignoreAgeCutoff: boolean = false
): Promise<number> {
  const [allPhotos, allShortages] = await Promise.all([
    getAllPhotos(),
    getAllShortages(),
  ]);

  const cutoffDateKey = getCutoffDateKey(keepDays, Date.now());
  const unfinishedPhotoIds = new Set<string>();
  const photosWithAnyShortage = new Set<string>();
  for (const s of allShortages) {
    photosWithAnyShortage.add(s.photoId);
    if (s.status !== 'done') {
      unfinishedPhotoIds.add(s.photoId);
    }
  }

  const eligible = allPhotos.filter((p) => {
    if (!p.dataUrl || p.imageCleaned) return false;
    if (p.status !== 'completed') return false;
    const isCompleted =
      p.done === true ||
      (p.done !== false &&
        photosWithAnyShortage.has(p.id) &&
        !unfinishedPhotoIds.has(p.id));
    if (!isCompleted) return false;
    if (!ignoreAgeCutoff && p.dateKey >= cutoffDateKey) return false;
    return true;
  });

  if (eligible.length === 0) return 0;

  const db = await initDB();
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

// ----------------- SHORTAGES -----------------

export async function getAllShortages(): Promise<ShortageItem[]> {
  const db = await initDB();
  return new Promise((resolve) => {
    const tx = db.transaction('shortages', 'readonly');
    const req = tx.objectStore('shortages').getAll();
    req.onsuccess = () => {
      const list = (req.result as ShortageItem[]) || [];
      list.sort((a, b) => a.colorIndex - b.colorIndex || b.timestamp - a.timestamp);
      resolve(list);
    };
    req.onerror = () => resolve([]);
  });
}

export async function getShortagesByPhoto(photoId: string): Promise<ShortageItem[]> {
  const db = await initDB();
  return new Promise((resolve) => {
    const tx = db.transaction('shortages', 'readonly');
    const idx = tx.objectStore('shortages').index('photoId');
    const req = idx.getAll(photoId);
    req.onsuccess = () => {
      const list = (req.result as ShortageItem[]) || [];
      list.sort((a, b) => a.colorIndex - b.colorIndex);
      resolve(list);
    };
    req.onerror = () => resolve([]);
  });
}

export async function saveShortage(shortage: ShortageItem): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('shortages', 'readwrite');
    tx.objectStore('shortages').put(shortage);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function replacePhotoShortages(
  photoId: string,
  shortages: ShortageItem[]
): Promise<void> {
  const existing = await getShortagesByPhoto(photoId);
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('shortages', 'readwrite');
    const store = tx.objectStore('shortages');
    for (const old of existing) {
      store.delete(old.id);
    }
    for (const s of shortages) {
      store.put(s);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteShortageById(id: string): Promise<void> {
  const all = await getAllShortages();
  const target = all.find((s) => s.id === id);
  const db = await initDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('shortages', 'readwrite');
    tx.objectStore('shortages').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  if (target) {
    await reconcilePullHistoryPairs([
      { productId: target.productId, dateKey: target.dateKey },
    ]);
  }
}

export async function markShortagesDoneBulk(items: ShortageItem[]): Promise<void> {
  if (items.length === 0) return;
  const now = Date.now();
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('shortages', 'readwrite');
    const store = tx.objectStore('shortages');
    for (const s of items) {
      store.put({
        ...s,
        status: 'done',
        updatedAt: now,
      });
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function markPhotoDoneWithShortages(
  photo: ShelfPhoto,
  photoShortages: ShortageItem[]
): Promise<void> {
  const now = Date.now();
  const db = await initDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['photos', 'shortages'], 'readwrite');
    tx.objectStore('photos').put({ ...photo, done: true });
    const sStore = tx.objectStore('shortages');
    for (const s of photoShortages) {
      sStore.put({
        ...s,
        status: 'done',
        updatedAt: now,
      });
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  for (const s of photoShortages) {
    if (s.productId && s.quantity > 0) {
      await updateKnownProductLastQuantity(s.productId, s.quantity);
    }
  }
}

export async function markPhotosAndShortagesDoneBulk(
  photos: ShelfPhoto[],
  shortagesToDone: ShortageItem[]
): Promise<void> {
  if (photos.length === 0 && shortagesToDone.length === 0) return;
  const now = Date.now();
  const db = await initDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['photos', 'shortages'], 'readwrite');
    const pStore = tx.objectStore('photos');
    const sStore = tx.objectStore('shortages');
    for (const p of photos) {
      pStore.put({ ...p, done: true });
    }
    for (const s of shortagesToDone) {
      sStore.put({
        ...s,
        status: 'done',
        updatedAt: now,
      });
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  for (const s of shortagesToDone) {
    if (s.productId && s.quantity > 0) {
      await updateKnownProductLastQuantity(s.productId, s.quantity);
    }
  }
}

export async function restorePhotoAndShortages(
  photo: ShelfPhoto,
  photoShortages: ShortageItem[],
  photoManualMarks: ManualProductMark[] = []
): Promise<void> {
  const db = await initDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['photos', 'shortages', 'manual_marks'], 'readwrite');
    tx.objectStore('photos').put(photo);
    const sStore = tx.objectStore('shortages');
    for (const s of photoShortages) {
      sStore.put(s);
    }
    const mStore = tx.objectStore('manual_marks');
    for (const m of photoManualMarks) {
      mStore.put(m);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  const pairs = [
    ...photoShortages.map((s) => ({ productId: s.productId, dateKey: s.dateKey })),
    ...photoManualMarks.map((m) => ({ productId: m.productId, dateKey: m.dateKey })),
  ];
  if (pairs.length > 0) {
    await reconcilePullHistoryPairs(pairs);
  }
}

export async function deleteShortagesAndPhotosBulk(
  shortageIds: string[],
  photoIds: string[]
): Promise<void> {
  if (shortageIds.length === 0 && photoIds.length === 0) return;
  const [allShortages, allMarks] = await Promise.all([
    getAllShortages(),
    photoIds.length > 0 ? getAllManualMarks() : Promise.resolve([]),
  ]);
  const photoIdSet = new Set(photoIds);
  const idsToDelete = new Set(shortageIds);
  const markIdsToDelete: string[] = [];
  const affectedPairs: Array<{ productId: string; dateKey: string }> = [];

  for (const s of allShortages) {
    if (photoIdSet.has(s.photoId) || idsToDelete.has(s.id)) {
      idsToDelete.add(s.id);
      affectedPairs.push({ productId: s.productId, dateKey: s.dateKey });
    }
  }
  for (const m of allMarks) {
    if (photoIdSet.has(m.photoId)) {
      markIdsToDelete.push(m.id);
      affectedPairs.push({ productId: m.productId, dateKey: m.dateKey });
    }
  }

  const db = await initDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['shortages', 'photos', 'manual_marks'], 'readwrite');
    const sStore = tx.objectStore('shortages');
    const pStore = tx.objectStore('photos');
    const mStore = tx.objectStore('manual_marks');
    for (const sid of idsToDelete) {
      sStore.delete(sid);
    }
    for (const pid of photoIds) {
      pStore.delete(pid);
    }
    for (const mid of markIdsToDelete) {
      mStore.delete(mid);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  if (affectedPairs.length > 0) {
    await reconcilePullHistoryPairs(affectedPairs);
  }
}

// ----------------- KNOWN PRODUCTS (VISUAL IDENTITY + 256px THUMBNAIL) -----------------

export async function getAllKnownProducts(): Promise<KnownProduct[]> {
  const db = await initDB();
  return new Promise((resolve) => {
    const tx = db.transaction('known_products', 'readonly');
    const req = tx.objectStore('known_products').getAll();
    req.onsuccess = () => {
      const list = ((req.result as Array<KnownProduct & { cropDataUrl?: string }>) || []).map(
        (kp) => ({
          ...kp,
          thumbnailDataUrl: kp.thumbnailDataUrl || kp.cropDataUrl || '',
        })
      );
      list.sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(list);
    };
    req.onerror = () => resolve([]);
  });
}

export async function getKnownProductById(id: string): Promise<KnownProduct | null> {
  const db = await initDB();
  return new Promise((resolve) => {
    const tx = db.transaction('known_products', 'readonly');
    const req = tx.objectStore('known_products').get(id);
    req.onsuccess = () => {
      const kp = req.result as (KnownProduct & { cropDataUrl?: string }) | undefined;
      if (!kp) {
        resolve(null);
        return;
      }
      resolve({
        ...kp,
        thumbnailDataUrl: kp.thumbnailDataUrl || kp.cropDataUrl || '',
      });
    };
    req.onerror = () => resolve(null);
  });
}

export async function saveKnownProduct(product: KnownProduct): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('known_products', 'readwrite');
    tx.objectStore('known_products').put(product);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function createOrUpdateKnownProduct(data: {
  id?: string;
  productName?: string;
  productDescription: string;
  thumbnailDataUrl: string;
  lastQuantity?: number;
}): Promise<KnownProduct> {
  const existing = data.id ? await getKnownProductById(data.id) : null;
  const now = Date.now();

  const optionalName = (
    data.productName !== undefined ? data.productName : existing?.productName || ''
  ).trim();

  const record: KnownProduct = existing
    ? {
        ...existing,
        productName: optionalName,
        normalizedName: optionalName ? normalizeProductName(optionalName) : '',
        productDescription: existing.productDescription || data.productDescription,
        thumbnailDataUrl: existing.thumbnailDataUrl || data.thumbnailDataUrl,
        lastQuantity:
          typeof data.lastQuantity === 'number' && data.lastQuantity > 0
            ? data.lastQuantity
            : existing.lastQuantity,
        updatedAt: now,
      }
    : {
        id: data.id || `kp_${now}_${Math.random().toString(36).slice(2, 7)}`,
        productName: optionalName,
        normalizedName: optionalName ? normalizeProductName(optionalName) : '',
        productDescription: data.productDescription,
        thumbnailDataUrl: data.thumbnailDataUrl,
        lastQuantity:
          typeof data.lastQuantity === 'number' && data.lastQuantity > 0
            ? data.lastQuantity
            : undefined,
        hiddenFromTopStrip: false,
        updatedAt: now,
      };

  await saveKnownProduct(record);
  return record;
}

export async function setOptionalProductName(
  productId: string,
  name: string
): Promise<void> {
  const trimmed = name.trim();
  const norm = trimmed ? normalizeProductName(trimmed) : '';
  const [product, shortages] = await Promise.all([
    getKnownProductById(productId),
    getAllShortages(),
  ]);
  const matchingShortages = shortages.filter((s) => s.productId === productId);

  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['known_products', 'shortages'], 'readwrite');
    if (product) {
      tx.objectStore('known_products').put({
        ...product,
        productName: trimmed,
        normalizedName: norm,
        updatedAt: Date.now(),
      });
    }
    const sStore = tx.objectStore('shortages');
    for (const s of matchingShortages) {
      sStore.put({
        ...s,
        productName: trimmed,
      });
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function updateKnownProductLastQuantity(
  productId: string,
  qty: number
): Promise<void> {
  if (!productId || qty <= 0) return;
  const product = await getKnownProductById(productId);
  if (!product) return;
  await saveKnownProduct({
    ...product,
    lastQuantity: qty,
    updatedAt: Date.now(),
  });
}

export async function setProductHiddenFromTopStrip(
  productId: string,
  hidden: boolean
): Promise<void> {
  const product = await getKnownProductById(productId);
  if (!product) return;
  await saveKnownProduct({
    ...product,
    hiddenFromTopStrip: hidden,
    updatedAt: Date.now(),
  });
}

// ----------------- PULL HISTORY (LAST 30 DAYS DISTINCT DAYS SCORE) -----------------

export async function getAllPullHistory(): Promise<PullHistoryEntry[]> {
  const db = await initDB();
  return new Promise((resolve) => {
    const tx = db.transaction('pull_history', 'readonly');
    const req = tx.objectStore('pull_history').getAll();
    req.onsuccess = () => resolve((req.result as PullHistoryEntry[]) || []);
    req.onerror = () => resolve([]);
  });
}

export async function recordPullEventsForDate(
  dateKey: string,
  productIds: string[]
): Promise<void> {
  const uniqueIds = Array.from(new Set(productIds.filter(Boolean)));
  if (uniqueIds.length === 0) return;

  const existing = await getAllPullHistory();
  const existingKeys = new Set(
    existing.map((e) => `${e.productId}::${e.dateKey}`)
  );

  const toAdd: PullHistoryEntry[] = [];
  const now = Date.now();
  for (const productId of uniqueIds) {
    const composite = `${productId}::${dateKey}`;
    if (!existingKeys.has(composite)) {
      existingKeys.add(composite);
      toAdd.push({
        id: `pull_${dateKey}_${productId}`,
        productId,
        dateKey,
        timestamp: now,
      });
    }
  }

  if (toAdd.length === 0) return;

  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pull_history', 'readwrite');
    const store = tx.objectStore('pull_history');
    for (const entry of toAdd) {
      store.put(entry);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Returns top 12 non-hidden products ordered by pull score = distinct days appeared
 * as a shortage in the last 30 days. Never exposes numeric counts to the UI.
 */
export async function getTopPulledProducts(limit: number = 12): Promise<{
  hasEnoughDays: boolean;
  products: KnownProduct[];
}> {
  const [pullHistory, knownProducts] = await Promise.all([
    getAllPullHistory(),
    getAllKnownProducts(),
  ]);

  const now = Date.now();
  const distinctAppDays = new Set<string>();
  const productDaysMap = new Map<string, Set<string>>();

  for (const entry of pullHistory) {
    distinctAppDays.add(entry.dateKey);
    if (!isWithinLastDays(entry.dateKey, 30, now)) continue;
    const set = productDaysMap.get(entry.productId) || new Set<string>();
    set.add(entry.dateKey);
    productDaysMap.set(entry.productId, set);
  }

  const hasEnoughDays = distinctAppDays.size >= 3;
  if (!hasEnoughDays) {
    return { hasEnoughDays: false, products: [] };
  }

  const scored: Array<{ product: KnownProduct; score: number }> = [];
  for (const kp of knownProducts) {
    if (kp.hiddenFromTopStrip) continue;
    if (!kp.thumbnailDataUrl) continue;
    const daysSet = productDaysMap.get(kp.id);
    if (!daysSet || daysSet.size === 0) continue;
    scored.push({ product: kp, score: daysSet.size });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score || b.product.updatedAt - a.product.updatedAt
  );

  return {
    hasEnoughDays: true,
    products: scored.slice(0, limit).map((s) => s.product),
  };
}

/**
 * Returns saved products ordered by distinct pull days in the last 30 days (then recency)
 * for the manual product marking picker bottom sheet.
 */
export async function getProductsForManualPicker(
  limit: number = 30
): Promise<KnownProduct[]> {
  const [pullHistory, knownProducts] = await Promise.all([
    getAllPullHistory(),
    getAllKnownProducts(),
  ]);

  const now = Date.now();
  const productDaysMap = new Map<string, Set<string>>();
  for (const entry of pullHistory) {
    if (!isWithinLastDays(entry.dateKey, 30, now)) continue;
    const set = productDaysMap.get(entry.productId) || new Set<string>();
    set.add(entry.dateKey);
    productDaysMap.set(entry.productId, set);
  }

  const candidates = knownProducts
    .filter((kp) => !kp.hiddenFromTopStrip && Boolean(kp.thumbnailDataUrl))
    .map((kp) => ({
      product: kp,
      score: productDaysMap.get(kp.id)?.size || 0,
    }));

  candidates.sort(
    (a, b) =>
      b.score - a.score || b.product.updatedAt - a.product.updatedAt
  );

  return candidates.slice(0, limit).map((c) => c.product);
}

// ----------------- MANUAL PRODUCT MARKS -----------------

export async function getAllManualMarks(): Promise<ManualProductMark[]> {
  const db = await initDB();
  return new Promise((resolve) => {
    const tx = db.transaction('manual_marks', 'readonly');
    const req = tx.objectStore('manual_marks').getAll();
    req.onsuccess = () => {
      const list = (req.result as ManualProductMark[]) || [];
      list.sort((a, b) => a.markNumber - b.markNumber || a.timestamp - b.timestamp);
      resolve(list);
    };
    req.onerror = () => resolve([]);
  });
}

export async function getManualMarksByPhoto(
  photoId: string
): Promise<ManualProductMark[]> {
  const db = await initDB();
  return new Promise((resolve) => {
    const tx = db.transaction('manual_marks', 'readonly');
    const idx = tx.objectStore('manual_marks').index('photoId');
    const req = idx.getAll(photoId);
    req.onsuccess = () => {
      const list = (req.result as ManualProductMark[]) || [];
      list.sort((a, b) => a.markNumber - b.markNumber || a.timestamp - b.timestamp);
      resolve(list);
    };
    req.onerror = () => resolve([]);
  });
}

export async function saveManualMark(mark: ManualProductMark): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('manual_marks', 'readwrite');
    tx.objectStore('manual_marks').put(mark);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function replacePhotoManualMarks(
  photoId: string,
  marks: ManualProductMark[]
): Promise<void> {
  const existing = await getManualMarksByPhoto(photoId);
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('manual_marks', 'readwrite');
    const store = tx.objectStore('manual_marks');
    for (const old of existing) {
      store.delete(old.id);
    }
    for (const m of marks) {
      store.put(m);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function reconcilePullHistoryPairs(
  pairs: Array<{ productId: string; dateKey: string }>
): Promise<void> {
  const uniqueMap = new Map<string, { productId: string; dateKey: string }>();
  for (const p of pairs) {
    if (!p.productId || !p.dateKey) continue;
    uniqueMap.set(`${p.productId}::${p.dateKey}`, p);
  }
  if (uniqueMap.size === 0) return;

  const [allShortages, allMarks, allPullHistory] = await Promise.all([
    getAllShortages(),
    getAllManualMarks(),
    getAllPullHistory(),
  ]);

  const activePairKeys = new Set<string>();
  for (const s of allShortages) {
    activePairKeys.add(`${s.productId}::${s.dateKey}`);
  }
  for (const m of allMarks) {
    activePairKeys.add(`${m.productId}::${m.dateKey}`);
  }

  const existingEntriesByPair = new Map<string, PullHistoryEntry[]>();
  for (const e of allPullHistory) {
    const key = `${e.productId}::${e.dateKey}`;
    const list = existingEntriesByPair.get(key) || [];
    list.push(e);
    existingEntriesByPair.set(key, list);
  }

  const toAdd: PullHistoryEntry[] = [];
  const toDeleteIds: string[] = [];
  const now = Date.now();

  for (const [key, pair] of uniqueMap) {
    const shouldExist = activePairKeys.has(key);
    const existingList = existingEntriesByPair.get(key) || [];
    if (shouldExist && existingList.length === 0) {
      toAdd.push({
        id: `pull_${pair.dateKey}_${pair.productId}`,
        productId: pair.productId,
        dateKey: pair.dateKey,
        timestamp: now,
      });
    } else if (!shouldExist && existingList.length > 0) {
      for (const e of existingList) {
        toDeleteIds.push(e.id);
      }
    }
  }

  if (toAdd.length === 0 && toDeleteIds.length === 0) return;

  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pull_history', 'readwrite');
    const store = tx.objectStore('pull_history');
    for (const id of toDeleteIds) {
      store.delete(id);
    }
    for (const entry of toAdd) {
      store.put(entry);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteManualMarkAndReconcile(markId: string): Promise<void> {
  const allMarks = await getAllManualMarks();
  const target = allMarks.find((m) => m.id === markId);
  if (!target) return;

  const remainingForPhoto = allMarks
    .filter((m) => m.photoId === target.photoId && m.id !== markId)
    .sort((a, b) => a.markNumber - b.markNumber || a.timestamp - b.timestamp);

  const db = await initDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('manual_marks', 'readwrite');
    const store = tx.objectStore('manual_marks');
    store.delete(markId);
    for (let i = 0; i < remainingForPhoto.length; i++) {
      const m = remainingForPhoto[i];
      if (m.markNumber !== i + 1) {
        store.put({ ...m, markNumber: i + 1, updatedAt: Date.now() });
      }
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  await reconcilePullHistoryPairs([
    { productId: target.productId, dateKey: target.dateKey },
  ]);
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
        resolve({ ...DEFAULT_SETTINGS, ...req.result.value });
      } else {
        resolve({ ...DEFAULT_SETTINGS });
      }
    };
    req.onerror = () => resolve({ ...DEFAULT_SETTINGS });
  });
}

export async function saveSettings(
  partial: Partial<AppSettings>
): Promise<AppSettings> {
  const current = await getSettings();
  const updated: AppSettings = { ...current, ...partial };
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
  const [photos, shelves, products, notes, shortages, manualMarks] =
    await Promise.all([
      getAllPhotos(),
      getAllShelves(),
      getAllKnownProducts(),
      getAllNotes(),
      getAllShortages(),
      getAllManualMarks(),
    ]);

  let localBytes = 0;
  for (const p of photos) localBytes += (p.dataUrl?.length || 0) + 256;
  for (const sh of shelves) {
    localBytes += (sh.thumbnailDataUrl?.length || 0) + 256;
  }
  for (const kp of products) {
    localBytes += (kp.thumbnailDataUrl?.length || 0) + 256;
  }
  for (const n of notes) {
    localBytes += (n.title?.length || 0) * 2 + (n.body?.length || 0) * 2 + 256;
    for (const np of n.photos || []) {
      localBytes += np.dataUrl?.length || 0;
    }
  }
  localBytes += shortages.length * 400;
  localBytes += manualMarks.length * 256;

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

export interface BackupPayload {
  app: string;
  version: number;
  exportedAt: string;
  settings: AppSettings;
  shelves: Shelf[];
  products: KnownProduct[];
  pullHistory: PullHistoryEntry[];
  notes: NoteItem[];
  shortages: ShortageItem[];
  manualMarks?: ManualProductMark[];
  photos: ShelfPhoto[];
}

export async function exportBackupJson(): Promise<string> {
  const [
    settings,
    shelves,
    products,
    pullHistory,
    notes,
    shortages,
    manualMarks,
    photos,
  ] = await Promise.all([
    getSettings(),
    getAllShelves(),
    getAllKnownProducts(),
    getAllPullHistory(),
    getAllNotes(),
    getAllShortages(),
    getAllManualMarks(),
    getAllPhotos(),
  ]);

  const payload: BackupPayload = {
    app: 'نقص الرفوف',
    version: 5,
    exportedAt: new Date().toISOString(),
    settings,
    shelves,
    products,
    pullHistory,
    notes,
    shortages,
    manualMarks,
    photos,
  };
  return JSON.stringify(payload, null, 2);
}

export async function importBackupJson(jsonText: string): Promise<{
  shelvesCount: number;
  productsCount: number;
  notesCount: number;
}> {
  const parsed = JSON.parse(jsonText) as Partial<BackupPayload>;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('ملف النسخة الاحتياطية غير صالح');
  }

  const shelves = Array.isArray(parsed.shelves) ? parsed.shelves : [];
  const products = Array.isArray(parsed.products) ? parsed.products : [];
  const pullHistory = Array.isArray(parsed.pullHistory)
    ? parsed.pullHistory
    : [];
  const notes = Array.isArray(parsed.notes) ? parsed.notes : [];
  const shortages = Array.isArray(parsed.shortages) ? parsed.shortages : [];
  const manualMarks = Array.isArray(parsed.manualMarks)
    ? parsed.manualMarks
    : [];
  const photos = Array.isArray(parsed.photos) ? parsed.photos : [];

  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      [
        'shelves',
        'known_products',
        'pull_history',
        'notes',
        'shortages',
        'manual_marks',
        'photos',
        'settings',
      ],
      'readwrite'
    );

    if (parsed.settings) {
      tx.objectStore('settings').put({
        key: 'app_settings',
        value: { ...DEFAULT_SETTINGS, ...parsed.settings },
      });
    }

    const shelfStore = tx.objectStore('shelves');
    for (const sh of shelves) {
      if (sh && sh.id) shelfStore.put(sh);
    }

    const prodStore = tx.objectStore('known_products');
    for (const kp of products) {
      if (kp && kp.id) prodStore.put(kp);
    }

    const pullStore = tx.objectStore('pull_history');
    for (const pe of pullHistory) {
      if (pe && pe.id) pullStore.put(pe);
    }

    const noteStore = tx.objectStore('notes');
    for (const n of notes) {
      if (n && n.id) noteStore.put(n);
    }

    const shortageStore = tx.objectStore('shortages');
    for (const s of shortages) {
      if (s && s.id) shortageStore.put(s);
    }

    const markStore = tx.objectStore('manual_marks');
    for (const m of manualMarks) {
      if (m && m.id) markStore.put(m);
    }

    const photoStore = tx.objectStore('photos');
    for (const p of photos) {
      if (p && p.id) photoStore.put(p);
    }

    tx.oncomplete = () =>
      resolve({
        shelvesCount: shelves.length,
        productsCount: products.length,
        notesCount: notes.length,
      });
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAllData(): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const stores = [
      'photos',
      'shelves',
      'shortages',
      'manual_marks',
      'known_products',
      'pull_history',
      'notes',
      'settings',
    ];
    const tx = db.transaction(stores, 'readwrite');
    for (const name of stores) {
      tx.objectStore(name).clear();
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
