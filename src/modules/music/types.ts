export type MusicTrackKind = 'file' | 'radio';

export type MusicRepeatMode = 'off' | 'all' | 'one';

export type MusicLibraryTab = 'all' | 'favorites' | 'recent' | `list:${string}`;

export interface MusicCustomList {
  id: string;
  name: string;
  createdAt: number;
}

export interface MusicTrackRecord {
  id: string;
  kind: MusicTrackKind;
  title: string; // Short editable display name
  fileName?: string; // Original file name (kept unchanged)
  mimeType?: string;
  streamUrl?: string;
  duration: number; // seconds (0 if unknown / live radio)
  size: number; // bytes (0 for radio)
  contentHash?: string; // SHA-256 / content fingerprint to prevent re-adding renamed duplicates
  order: number;
  missingFile?: boolean;
  favorite?: boolean;
  lastPlayedAt?: number;
  coverDataUrl?: string; // <=160px JPEG (stored locally in IndexedDB; excluded from JSON backup)
  tileColor?: string; // One of 8 curated tile color IDs
  listIds?: string[]; // Custom list memberships
  createdAt: number;
  updatedAt: number;
}

export interface MusicBlobRecord {
  id: string; // matches MusicTrackRecord.id
  blob: Blob;
  mimeType: string;
  size: number;
  updatedAt: number;
}

export interface MusicPlaybackState {
  key: 'playback';
  currentTrackId: string | null;
  positionSec: number;
  trackPositions?: Record<string, number>;
  volume: number; // 0..1 (never overwritten with 0 when muting)
  muted: boolean; // separate mute flag
  lastNonZeroVolume: number; // 0.1..1
  shuffle: boolean;
  repeat: MusicRepeatMode;
  updatedAt: number;
}

export interface MusicPlaybackDiagnostics {
  trackTitle: string;
  fileName: string;
  mimeType: string;
  resolvedMimeType: string;
  sizeBytes: number;
  durationSec: number;
  readyState: number;
  networkState: number;
  volume: number;
  muted: boolean;
  paused: boolean;
  ended: boolean;
  lastError: string | null;
}

export interface MusicStorageStats {
  trackCount: number;
  fileTrackCount: number;
  radioCount: number;
  usedBytes: number;
  persisted: boolean;
  isStorageLow: boolean;
  browserUsageBytes: number;
  browserQuotaBytes: number;
}

export interface MusicBackupTrackMeta {
  id: string;
  kind: MusicTrackKind;
  title: string;
  fileName?: string;
  mimeType?: string;
  streamUrl?: string;
  duration: number;
  size: number;
  contentHash?: string;
  order: number;
  favorite?: boolean;
  lastPlayedAt?: number;
  tileColor?: string;
  listIds?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface MusicBackupSection {
  tracks: MusicBackupTrackMeta[];
  lists?: MusicCustomList[];
  playback?: {
    currentTrackId: string | null;
    volume: number;
    muted?: boolean;
    lastNonZeroVolume?: number;
    shuffle: boolean;
    repeat: MusicRepeatMode;
  };
}

export interface MusicImportFailedItem {
  fileName: string;
  reason: string;
}

export interface MusicImportProgress {
  active: boolean;
  currentIndex: number;
  total: number;
  currentFileName: string;
  addedCount: number;
  skippedDuplicatesCount: number;
  failedCount: number;
}

export interface MusicImportReport {
  addedCount: number;
  skippedDuplicatesCount: number;
  skippedDuplicateFiles?: string[];
  failedCount: number;
  cancelled: boolean;
  failedFiles: MusicImportFailedItem[];
  summaryText: string;
}

export interface MusicAddFilesResult {
  addedTracks: MusicTrackRecord[];
  reattachedTracks: MusicTrackRecord[];
  rejectedOverLimit: boolean;
  rejectedReason?: string;
  skippedInvalid: number;
  skippedDuplicatesCount: number;
  skippedDuplicateFiles?: string[];
  failedCount: number;
  failedFiles: MusicImportFailedItem[];
  cancelled: boolean;
  summaryText: string;
  usedBytes: number;
  persisted: boolean;
}
