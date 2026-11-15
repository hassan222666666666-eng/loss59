export interface NormalizedBox {
  x: number; // 0..1 from left
  y: number; // 0..1 from top
  w: number; // 0..1 width
  h: number; // 0..1 height
}

export type PhotoStatus =
  | 'pending'
  | 'analyzing'
  | 'completed'
  | 'poor_quality'
  | 'error'
  | 'manual_only';

export type FlashMode = 'auto' | 'on' | 'off';

export type KeepPhotosDays = 1 | 3 | 7;

export interface Shelf {
  id: string;
  label: string;
  thumbnailDataUrl: string; // Permanent compact thumbnail for visual shelf matching
  createdAt: number;
  updatedAt: number;
}

export interface ShelfPhoto {
  id: string;
  sessionId: string;
  shelfId?: string;
  timestamp: number;
  dateKey: string; // YYYY-MM-DD local date
  dataUrl: string; // Max 2048px JPEG (cleared to '' only after photo is done & expired)
  width: number;
  height: number;
  status: PhotoStatus;
  photoQuality?: 'good' | 'poor';
  errorMessage?: string;
  analyzedAt?: number;
  imageCleaned?: boolean;
  done?: boolean;
}

export interface KnownProduct {
  id: string; // Primary visual product identity
  productName: string; // Optional user-typed display name (empty = show picture only)
  normalizedName: string;
  productDescription: string; // Short English visual description
  thumbnailDataUrl: string; // Permanent 256px product crop thumbnail
  lastQuantity?: number; // Learned from worker's quantity edits
  hiddenFromTopStrip?: boolean;
  updatedAt: number;
}

export interface PullHistoryEntry {
  id: string;
  productId: string;
  dateKey: string; // YYYY-MM-DD
  timestamp: number;
}

export interface ManualProductMark {
  id: string;
  photoId: string;
  dateKey: string; // YYYY-MM-DD pull day recorded when marked
  timestamp: number;
  productId: string;
  box: NormalizedBox;
  markNumber: number; // 1-based number displayed on the mark rectangle
  updatedAt: number;
}

export type ShortageStatus = 'new' | 'done';

export interface ShortageItem {
  id: string;
  photoId: string;
  shelfId?: string;
  dateKey: string; // YYYY-MM-DD
  timestamp: number;
  productId: string;
  productName: string; // Optional snapshot; UI resolves live name & thumbnail by productId
  productDescription: string;
  gapBox: NormalizedBox;
  productBox: NormalizedBox;
  estimatedMissing: number;
  quantity: number;
  status: ShortageStatus;
  colorIndex: number; // Ordered RTL then top-to-bottom within photo
  confidence: number;
  source: 'ai' | 'manual';
  duplicateResolved?: boolean;
  updatedAt: number;
}

export interface NotePhoto {
  id: string;
  dataUrl: string; // Max 1280px JPEG
  createdAt: number;
}

export interface NoteLinePhoto {
  lineIndex: number; // 0-based visual line index in note.body
  dataUrl: string;   // Max 512px/1024px JPEG
}

export interface NoteItem {
  id: string;
  title: string;
  body: string;
  photos: NotePhoto[];
  linePhotos?: NoteLinePhoto[];
  numberingEnabled: boolean;
  resetAfterBlankLine: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AppSettings {
  aiAnalysisEnabled: boolean;
  continuousMode: boolean;
  autoFlash: boolean;
  zoomControls: boolean;
  shutterSound: boolean;
  defaultNoteNumbering: boolean;
  autoDeletePhotos: boolean;
  keepPhotosDays: KeepPhotosDays;
}

export const DEFAULT_SETTINGS: AppSettings = {
  aiAnalysisEnabled: true,
  continuousMode: true,
  autoFlash: true,
  zoomControls: true,
  shutterSound: true,
  defaultNoteNumbering: false,
  autoDeletePhotos: true,
  keepPhotosDays: 1,
};

export interface AnalyzedShortageRaw {
  productDescription: string;
  gapBox: NormalizedBox;
  productBox: NormalizedBox;
  estimatedMissing: number;
  confidence: number;
}

export interface AnalyzeShelfResponse {
  photoQuality: 'good' | 'poor';
  shortages: AnalyzedShortageRaw[];
}

export interface MatchProductResponse {
  matchIndex: number; // 0..N-1 or -1
  matchedProductId: string | null;
}

export interface MatchShelfResponse {
  matchIndex: number; // 0..N-1 or -1
  matchedShelfId: string | null;
}
