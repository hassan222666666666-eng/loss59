export type FlashMode = 'auto' | 'on' | 'off';

export type CameraToolbarSide = 'right' | 'left';

export type KeepPhotosDays = 1 | 3 | 7;

export interface ShelfPhoto {
  id: string;
  sessionId: string;
  timestamp: number;
  dateKey: string; // YYYY-MM-DD local date
  dataUrl: string; // Max 2048px JPEG (cleared to '' only after photo is done & expired)
  width: number;
  height: number;
  imageCleaned?: boolean;
  done?: boolean;
}

export interface NotePhoto {
  id: string;
  dataUrl: string; // Max 1280px JPEG
  createdAt: number;
}

export interface NoteLinePhoto {
  lineIndex: number; // 0-based visual line index in note.body
  dataUrl: string; // Max 512px/1024px JPEG
}

export type NoteQuantityUnit = 'carton' | 'piece';

export interface NoteLineQuantity {
  lineIndex: number; // 0-based visual line index in note.body
  quantity: number; // Positive numeric quantity
  unit?: NoteQuantityUnit; // Optional unit ('carton' = كارتون, 'piece' = قطع)
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
  cameraHighQuality?: boolean;
  cameraToolbarSide?: CameraToolbarSide;
  selectedCameraDeviceId?: string;
  continuousMode: boolean;
  autoFlash: boolean;
  zoomControls: boolean;
  shutterSound: boolean;
  defaultNoteNumbering: boolean;
  defaultNoteQuantities: boolean;
  noteCopySortOrder: NoteCopySortOrder;
  noteCopyDigitStyle: NoteCopyDigitStyle;
  noteCopyIncludeTotalQuantities: boolean;
  includeTotalInWhatsApp: boolean;
  duplicateDebugEnabled?: boolean;
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
  cameraHighQuality: true,
  cameraToolbarSide: 'right',
  continuousMode: true,
  autoFlash: true,
  zoomControls: true,
  shutterSound: true,
  defaultNoteNumbering: false,
  defaultNoteQuantities: true,
  noteCopySortOrder: 'as-written',
  noteCopyDigitStyle: 'western',
  noteCopyIncludeTotalQuantities: false,
  includeTotalInWhatsApp: false,
  duplicateDebugEnabled: false,
  autoDeletePhotos: true,
  keepPhotosDays: 1,
  musicPlayerEnabled: false,
  musicShowOnCapture: false,
  musicMaxStorageMb: 500,
  musicFabColor: 'violet-pink',
  musicVisualEffects: true,
  musicAudioReactive: false,
};
