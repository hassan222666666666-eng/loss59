export type FlashMode = 'auto' | 'on' | 'off';

export type CameraToolbarSide = 'right' | 'left';

export type KeepPhotosDays = 1 | 3 | 7;

export type CaptureMode = 'high-quality' | 'fast';

export type PreviewResolutionSetting = 'auto' | '1080p' | '720p';

export type CameraIdleTimeoutSec = 30 | 60 | 120 | 0;

export type PreviewFrameRateSetting = 30 | 24 | 15;

export type BatterySaverMode = 'off' | 'auto' | 'always';

export type PhotoEnhanceLevel = 'off' | 'light' | 'medium' | 'strong';
export type PhotoEnhancementStatus = 'pending' | 'enhanced' | 'unenhanced';

export interface ShelfPhoto {
  id: string;
  sessionId: string;
  timestamp: number;
  dateKey: string; // YYYY-MM-DD local date
  dataUrl: string; // Max 4096px JPEG (cleared to '' only after photo is done & expired)
  thumbnailDataUrl?: string; // Resized copy for fast Log grid rendering
  originalDataUrl?: string; // Preserved unenhanced full-res JPEG only when keepOriginalPhoto is ON
  width: number;
  height: number;
  imageCleaned?: boolean;
  done?: boolean;
  enhancementStatus?: PhotoEnhancementStatus;
  enhancementLevel?: Exclude<PhotoEnhanceLevel, 'off'>;
}

export interface NotePhoto {
  id: string;
  dataUrl: string; // Max 1280px JPEG
  thumbnailDataUrl?: string; // Small preview for Notes list
  createdAt: number;
}

export interface NoteLinePhoto {
  lineIndex: number; // 0-based visual line index in note.body
  dataUrl: string; // Max 512px/1024px JPEG
}

export type NoteQuantityUnit = 'carton' | 'box' | 'piece' | 'kg' | 'gram';

export type NoteUnitMode = 'per-product' | 'fixed';
export type NoteDefaultUnit = NoteQuantityUnit | 'none';

export interface NoteLineQuantity {
  lineIndex: number; // 0-based visual line index in note.body
  quantity: number; // Positive numeric quantity
  unit?: NoteQuantityUnit; // Optional unit ('carton' = كارتون, 'box' = علبة, 'piece' = قطع, 'kg' = كيلو, 'gram' = غرام)
}

export type NoteCopySortOrder = 'as-written' | 'alphabetical';
export type NoteCopyDigitStyle = 'western' | 'arabic';

export interface WhatsAppRecipient {
  id: string;
  name: string;
  phone: string; // Digits with country code, e.g. 9647701234567
  lastUsedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface NoteItem {
  id: string;
  title: string;
  body: string;
  photos: NotePhoto[];
  linePhotos?: NoteLinePhoto[];
  quantitiesEnabled?: boolean;
  lineQuantities?: NoteLineQuantity[];
  numberingEnabled: boolean;
  resetAfterBlankLine: boolean;
  keptDuplicatePairs?: string[];
  lastSentToName?: string;
  lastSentAt?: number;
  createdAt: number;
  updatedAt: number;
}

export type MusicFabColorId =
  | 'violet-pink'
  | 'indigo-cyan'
  | 'amber-rose'
  | 'sky-blue'
  | 'crimson-orange'
  | 'teal-violet';

export interface AppSettings {
  captureMode?: CaptureMode;
  previewResolution?: PreviewResolutionSetting;
  previewFrameRate?: PreviewFrameRateSetting;
  cameraIdleTimeoutSec?: CameraIdleTimeoutSec;
  batterySaverMode?: BatterySaverMode;
  cameraHighQuality?: boolean;
  cameraToolbarSide?: CameraToolbarSide;
  selectedCameraDeviceId?: string;
  continuousMode: boolean;
  autoFlash: boolean;
  zoomControls: boolean;
  shutterSound: boolean;
  photoEnhanceLevel?: PhotoEnhanceLevel;
  enhanceGalleryImports?: boolean;
  keepOriginalPhoto?: boolean;
  defaultNoteNumbering: boolean;
  defaultNoteQuantities: boolean;
  autoTakeNoteNumber?: boolean;
  noteUnitMode?: NoteUnitMode;
  noteDefaultUnit?: NoteDefaultUnit;
  noteCopySortOrder: NoteCopySortOrder;
  noteCopyDigitStyle: NoteCopyDigitStyle;
  noteCopyIncludeTotalQuantities: boolean;
  includeTotalInWhatsApp: boolean;
  autoDeletePhotos: boolean;
  keepPhotosDays: KeepPhotosDays;
  musicPlayerEnabled: boolean;
  musicShowOnCapture: boolean;
  musicMaxStorageMb: number;
  musicFabColor: MusicFabColorId;
  musicVisualEffects: boolean;
  musicAudioReactive: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  captureMode: 'fast',
  previewResolution: 'auto',
  previewFrameRate: 24,
  cameraIdleTimeoutSec: 60,
  batterySaverMode: 'auto',
  cameraHighQuality: true,
  cameraToolbarSide: 'right',
  continuousMode: true,
  autoFlash: true,
  zoomControls: true,
  shutterSound: true,
  photoEnhanceLevel: 'medium',
  enhanceGalleryImports: false,
  keepOriginalPhoto: false,
  defaultNoteNumbering: false,
  defaultNoteQuantities: true,
  autoTakeNoteNumber: false,
  noteUnitMode: 'per-product',
  noteDefaultUnit: 'none',
  noteCopySortOrder: 'as-written',
  noteCopyDigitStyle: 'western',
  noteCopyIncludeTotalQuantities: false,
  includeTotalInWhatsApp: false,
  autoDeletePhotos: true,
  keepPhotosDays: 1,
  musicPlayerEnabled: false,
  musicShowOnCapture: false,
  musicMaxStorageMb: 500,
  musicFabColor: 'violet-pink',
  musicVisualEffects: true,
  musicAudioReactive: false,
};
