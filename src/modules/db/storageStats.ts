import { NoteItem, ShelfPhoto } from '../../types';

export interface StorageBreakdown {
  photosBytes: number;
  notesBytes: number;
  audioBytes: number;
  totalBytes: number;
}

function estimateBase64DataUrlBytes(dataUrl?: string): number {
  if (!dataUrl) return 0;
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) return dataUrl.length;
  const payloadLen = Math.max(0, dataUrl.length - commaIdx - 1);
  return Math.round((payloadLen * 3) / 4);
}

export function computeStorageBreakdown(params: {
  photos: ShelfPhoto[];
  notes: NoteItem[];
  audioBytes?: number;
}): StorageBreakdown {
  let photosBytes = 0;
  for (const p of params.photos) {
    photosBytes +=
      estimateBase64DataUrlBytes(p.dataUrl) +
      estimateBase64DataUrlBytes(p.thumbnailDataUrl) +
      estimateBase64DataUrlBytes(p.originalDataUrl) +
      256;
  }

  let notesBytes = 0;
  for (const n of params.notes) {
    notesBytes +=
      (n.title?.length || 0) * 2 + (n.body?.length || 0) * 2 + 256;
    for (const np of n.photos || []) {
      notesBytes += estimateBase64DataUrlBytes(np.dataUrl);
    }
    for (const lp of n.linePhotos || []) {
      notesBytes += estimateBase64DataUrlBytes(lp.dataUrl);
    }
  }

  const audioBytes = Math.max(0, Math.round(params.audioBytes || 0));
  return {
    photosBytes,
    notesBytes,
    audioBytes,
    totalBytes: photosBytes + notesBytes + audioBytes,
  };
}
