/**
 * Web Worker for off-thread camera capture orientation baking,
 * thumbnail resizing, JPEG encoding (quality 0.92, max 4096px),
 * blur detection (when requested), and IndexedDB persistence.
 */

const DB_NAME = 'naqs_alrofoof_db';
const DB_VERSION = 11;

interface WorkerPhotoMeta {
  id: string;
  sessionId: string;
  timestamp: number;
  dateKey: string;
  enhancementStatus?: 'pending';
}

interface WorkerProcessRequest {
  id: number;
  blob?: Blob;
  bitmap?: ImageBitmap;
  digitalScale?: number;
  rotationDeg?: 0 | 90 | 180 | 270;
  maxDim: number;
  quality: number;
  thumbnailMaxDim?: number;
  thumbnailQuality?: number;
  blurThreshold: number;
  saveToDb?: boolean;
  photoMeta?: WorkerPhotoMeta;
}

function calcTargetDims(
  width: number,
  height: number,
  maxDim: number
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 1, height: 1 };
  if (
    !Number.isFinite(maxDim) ||
    maxDim <= 0 ||
    (width <= maxDim && height <= maxDim)
  ) {
    return { width: Math.round(width), height: Math.round(height) };
  }
  if (width >= height) {
    return {
      width: maxDim,
      height: Math.max(1, Math.round((height * maxDim) / width)),
    };
  }
  return {
    width: Math.max(1, Math.round((width * maxDim) / height)),
    height: maxDim,
  };
}

function computeLaplacianVar(
  grayPixels: Uint8Array,
  width: number,
  height: number
): number {
  if (width < 3 || height < 3 || grayPixels.length < width * height) return 0;
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    const prev = (y - 1) * width;
    const next = (y + 1) * width;
    for (let x = 1; x < width - 1; x++) {
      const lap =
        grayPixels[prev + x] +
        grayPixels[next + x] +
        grayPixels[row + x - 1] +
        grayPixels[row + x + 1] -
        4 * grayPixels[row + x];
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }
  if (count === 0) return 0;
  const mean = sum / count;
  return Math.max(0, sumSq / count - mean * mean);
}

async function createUprightBitmapFromBlob(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    return await createImageBitmap(blob);
  }
}

async function blobToJpegDataUrl(blob: Blob): Promise<string> {
  const scope = self as unknown as {
    FileReaderSync?: new () => { readAsDataURL(b: Blob): string };
  };
  if (typeof scope.FileReaderSync === 'function') {
    try {
      return new scope.FileReaderSync().readAsDataURL(blob);
    } catch {
      // Fallback below
    }
  }
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x2000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

let workerDb: IDBDatabase | null = null;

async function openWorkerDb(): Promise<IDBDatabase> {
  if (workerDb) return workerDb;
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB unavailable in worker');
  }
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('photos')) {
        const photoStore = db.createObjectStore('photos', { keyPath: 'id' });
        photoStore.createIndex('sessionId', 'sessionId', { unique: false });
        photoStore.createIndex('dateKey', 'dateKey', { unique: false });
        photoStore.createIndex('timestamp', 'timestamp', { unique: false });
      }
      if (!db.objectStoreNames.contains('notes')) {
        const noteStore = db.createObjectStore('notes', { keyPath: 'id' });
        noteStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => {
      workerDb = req.result;
      workerDb.onclose = () => {
        workerDb = null;
      };
      resolve(workerDb);
    };
    req.onerror = () => {
      reject(req.error || new Error('Failed to open IndexedDB in worker'));
    };
  });
}

async function savePhotoRecordInWorker(record: {
  id: string;
  sessionId: string;
  timestamp: number;
  dateKey: string;
  dataUrl: string;
  thumbnailDataUrl: string;
  width: number;
  height: number;
  enhancementStatus?: 'pending';
}): Promise<void> {
  const db = await openWorkerDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite');
    tx.objectStore('photos').put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Worker IDB put failed'));
  });
}

const workerScope = self as unknown as {
  addEventListener: (
    type: 'message',
    listener: (e: MessageEvent<WorkerProcessRequest>) => void
  ) => void;
  postMessage: (message: unknown) => void;
};

workerScope.addEventListener('message', async (event) => {
  const {
    id,
    blob,
    bitmap: incomingBitmap,
    digitalScale = 1,
    rotationDeg = 0,
    maxDim,
    quality,
    thumbnailMaxDim = 480,
    thumbnailQuality = 0.8,
    blurThreshold,
    saveToDb = false,
    photoMeta,
  } = event.data;

  let bitmap: ImageBitmap | null = incomingBitmap || null;
  try {
    const procStart = performance.now();

    if (!bitmap && blob) {
      bitmap = await createUprightBitmapFromBlob(blob);
    }
    if (!bitmap) {
      throw new Error('No image source provided');
    }

    const srcW = bitmap.width;
    const srcH = bitmap.height;
    const scale = digitalScale > 1.01 ? digitalScale : 1;
    const cropW = srcW / scale;
    const cropH = srcH / scale;
    const cropX = (srcW - cropW) / 2;
    const cropY = (srcH - cropH) / 2;

    const quarterTurn = rotationDeg === 90 || rotationDeg === 270;
    const target = calcTargetDims(
      quarterTurn ? cropH : cropW,
      quarterTurn ? cropW : cropH,
      maxDim
    );
    const outCanvas = new OffscreenCanvas(target.width, target.height);
    const outCtx = outCanvas.getContext('2d');
    if (!outCtx) {
      throw new Error('OffscreenCanvas 2d context unavailable');
    }

    outCtx.imageSmoothingEnabled = true;
    outCtx.imageSmoothingQuality = 'high';
    outCtx.save();
    if (rotationDeg === 90) {
      outCtx.translate(target.width, 0);
      outCtx.rotate(Math.PI / 2);
      outCtx.drawImage(
        bitmap,
        cropX,
        cropY,
        cropW,
        cropH,
        0,
        0,
        target.height,
        target.width
      );
    } else if (rotationDeg === 180) {
      outCtx.translate(target.width, target.height);
      outCtx.rotate(Math.PI);
      outCtx.drawImage(
        bitmap,
        cropX,
        cropY,
        cropW,
        cropH,
        0,
        0,
        target.width,
        target.height
      );
    } else if (rotationDeg === 270) {
      outCtx.translate(0, target.height);
      outCtx.rotate(-Math.PI / 2);
      outCtx.drawImage(
        bitmap,
        cropX,
        cropY,
        cropW,
        cropH,
        0,
        0,
        target.height,
        target.width
      );
    } else {
      outCtx.drawImage(
        bitmap,
        cropX,
        cropY,
        cropW,
        cropH,
        0,
        0,
        target.width,
        target.height
      );
    }
    outCtx.restore();

    // Release input bitmap ASAP before encoding
    try {
      bitmap.close();
    } catch {
      // Ignore close error
    }
    bitmap = null;

    let variance = 100;
    let isBlurry = false;
    if (blurThreshold > 0) {
      const blurW = Math.min(200, target.width);
      const blurH = Math.max(
        12,
        Math.round((target.height * blurW) / target.width)
      );
      const blurCanvas = new OffscreenCanvas(blurW, blurH);
      const blurCtx = blurCanvas.getContext('2d', { willReadFrequently: true });
      if (blurCtx) {
        blurCtx.drawImage(outCanvas, 0, 0, blurW, blurH);
        const px = blurCtx.getImageData(0, 0, blurW, blurH).data;
        const gray = new Uint8Array(blurW * blurH);
        for (let i = 0, p = 0; i < px.length; i += 4, p++) {
          gray[p] = Math.round(
            0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]
          );
        }
        variance =
          Math.round(computeLaplacianVar(gray, blurW, blurH) * 10) / 10;
        isBlurry = variance < blurThreshold;
      }
    }

    // Encode full-resolution JPEG (quality 0.92, long side <= 4096px)
    const jpegBlob = await outCanvas.convertToBlob({
      type: 'image/jpeg',
      quality,
    });
    const byteLength = jpegBlob.size;
    const dataUrl = await blobToJpegDataUrl(jpegBlob);

    // Resize separate lightweight thumbnail off the main thread
    let thumbnailDataUrl = dataUrl;
    const thumbDims = calcTargetDims(
      target.width,
      target.height,
      thumbnailMaxDim
    );
    if (
      thumbDims.width < target.width ||
      thumbDims.height < target.height
    ) {
      const thumbCanvas = new OffscreenCanvas(
        thumbDims.width,
        thumbDims.height
      );
      const thumbCtx = thumbCanvas.getContext('2d');
      if (thumbCtx) {
        thumbCtx.imageSmoothingEnabled = true;
        thumbCtx.imageSmoothingQuality = 'high';
        thumbCtx.drawImage(
          outCanvas,
          0,
          0,
          thumbDims.width,
          thumbDims.height
        );
        const thumbBlob = await thumbCanvas.convertToBlob({
          type: 'image/jpeg',
          quality: thumbnailQuality,
        });
        thumbnailDataUrl = await blobToJpegDataUrl(thumbBlob);
      }
    }

    const processingMs = Math.max(1, Math.round(performance.now() - procStart));

    let savingMs = 0;
    let savedInWorker = false;
    if (saveToDb && photoMeta) {
      const saveStart = performance.now();
      try {
        await savePhotoRecordInWorker({
          id: photoMeta.id,
          sessionId: photoMeta.sessionId,
          timestamp: photoMeta.timestamp,
          dateKey: photoMeta.dateKey,
          dataUrl,
          thumbnailDataUrl,
          width: target.width,
          height: target.height,
          ...(photoMeta.enhancementStatus
            ? { enhancementStatus: photoMeta.enhancementStatus }
            : {}),
        });
        savingMs = Math.max(1, Math.round(performance.now() - saveStart));
        savedInWorker = true;
      } catch {
        // Return full dataUrl so main thread can fallback to savePhoto
        savingMs = 0;
        savedInWorker = false;
      }
    }

    workerScope.postMessage({
      id,
      ok: true,
      dataUrl: savedInWorker ? '' : dataUrl,
      thumbnailDataUrl: savedInWorker ? '' : thumbnailDataUrl,
      width: target.width,
      height: target.height,
      byteLength,
      processingMs,
      savingMs,
      savedInWorker,
      photoId: photoMeta?.id,
      variance,
      isBlurry,
    });
  } catch (err) {
    workerScope.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : 'Worker processing failed',
    });
  } finally {
    try {
      bitmap?.close();
    } catch {
      // Ignore close error
    }
  }
});
