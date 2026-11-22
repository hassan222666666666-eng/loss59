import {
  AppSettings,
  DEFAULT_SETTINGS,
  MusicFabColorId,
  NoteItem,
  ShelfPhoto,
  WhatsAppRecipient,
} from '../../types';
import { DEFAULT_MUSIC_MAX_STORAGE_MB } from '../music/musicLogic';
import { MusicBackupSection } from '../music/types';

export const LEGACY_AI_CLEANUP_STORAGE_KEY = 'naqs_legacy_ai_cleaned_v1';

export const LEGACY_LOCAL_STORAGE_PREFIXES = ['naqs_ai_', 'ai_'] as const;

export const LEGACY_PHOTO_AI_FIELDS = [
  'shelfId',
  'shelfLabel',
  'status',
  'photoQuality',
  'errorMessage',
  'analyzedAt',
] as const;

export const LEGACY_SETTINGS_AI_FIELDS = [
  'aiAnalysisEnabled',
  'activeShelfLabel',
  'unifiedFraming',
  'musicHideDuringCapture',
] as const;

export interface CleanBackupPayload {
  app: string;
  version: number;
  exportedAt: string;
  settings: AppSettings;
  notes: NoteItem[];
  photos: ShelfPhoto[];
  whatsappRecipients?: WhatsAppRecipient[];
  musicModule?: MusicBackupSection;
}

export interface NormalizedImportedBackup {
  settings: AppSettings | null;
  photos: ShelfPhoto[];
  notes: NoteItem[];
  whatsappRecipients: WhatsAppRecipient[] | null;
  musicModule: MusicBackupSection | null;
}

export function hasLegacyPhotoAiFields(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const obj = raw as Record<string, unknown>;
  return LEGACY_PHOTO_AI_FIELDS.some((key) => key in obj && obj[key] !== undefined);
}

export function sanitizePhotoRecord(raw: unknown): ShelfPhoto | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== 'string' || !obj.id.trim()) return null;

  const timestamp =
    typeof obj.timestamp === 'number' && Number.isFinite(obj.timestamp)
      ? obj.timestamp
      : Date.now();
  const dateKey =
    typeof obj.dateKey === 'string' && obj.dateKey.trim()
      ? obj.dateKey.trim()
      : new Date(timestamp).toISOString().slice(0, 10);

  const clean: ShelfPhoto = {
    id: obj.id,
    sessionId: typeof obj.sessionId === 'string' ? obj.sessionId : 'imported',
    timestamp,
    dateKey,
    dataUrl: typeof obj.dataUrl === 'string' ? obj.dataUrl : '',
    width:
      typeof obj.width === 'number' && Number.isFinite(obj.width)
        ? obj.width
        : 0,
    height:
      typeof obj.height === 'number' && Number.isFinite(obj.height)
        ? obj.height
        : 0,
  };

  if (obj.imageCleaned === true) clean.imageCleaned = true;
  if (typeof obj.done === 'boolean') clean.done = obj.done;

  return clean;
}

export function sanitizeSettingsRecord(
  stored?: Partial<AppSettings> | Record<string, unknown> | null
): AppSettings {
  const rest: Record<string, unknown> =
    stored && typeof stored === 'object'
      ? { ...(stored as Record<string, unknown>) }
      : {};
  for (const legacyKey of LEGACY_SETTINGS_AI_FIELDS) {
    delete rest[legacyKey];
  }

  const s = rest as Partial<AppSettings>;
  const normalizedDeviceId =
    typeof s.selectedCameraDeviceId === 'string' &&
    s.selectedCameraDeviceId.trim().length > 0
      ? s.selectedCameraDeviceId.trim()
      : undefined;

  const rawMaxMb = Number(s.musicMaxStorageMb);
  const musicMaxStorageMb =
    Number.isFinite(rawMaxMb) && rawMaxMb >= 50 && rawMaxMb <= 10000
      ? Math.round(rawMaxMb)
      : DEFAULT_MUSIC_MAX_STORAGE_MB;

  const validFabColors = new Set<MusicFabColorId>([
    'violet-pink',
    'indigo-cyan',
    'amber-rose',
    'sky-blue',
    'crimson-orange',
    'teal-violet',
  ]);
  const rawFabColor = s.musicFabColor as MusicFabColorId | undefined;
  const musicFabColor: MusicFabColorId =
    rawFabColor && validFabColors.has(rawFabColor)
      ? rawFabColor
      : 'violet-pink';

  return {
    ...DEFAULT_SETTINGS,
    ...s,
    selectedCameraDeviceId: normalizedDeviceId,
    cameraHighQuality:
      s.cameraHighQuality !== undefined ? Boolean(s.cameraHighQuality) : true,
    cameraToolbarSide: s.cameraToolbarSide === 'left' ? 'left' : 'right',
    defaultNoteQuantities:
      s.defaultNoteQuantities !== undefined
        ? Boolean(s.defaultNoteQuantities)
        : true,
    noteCopySortOrder:
      s.noteCopySortOrder === 'alphabetical' ? 'alphabetical' : 'as-written',
    noteCopyDigitStyle:
      s.noteCopyDigitStyle === 'arabic' ? 'arabic' : 'western',
    noteCopyIncludeTotalQuantities: Boolean(s.noteCopyIncludeTotalQuantities),
    musicPlayerEnabled: Boolean(s.musicPlayerEnabled),
    musicShowOnCapture: Boolean(s.musicShowOnCapture),
    musicMaxStorageMb,
    musicFabColor,
    musicVisualEffects:
      s.musicVisualEffects !== undefined ? Boolean(s.musicVisualEffects) : true,
    musicAudioReactive: Boolean(s.musicAudioReactive),
  };
}

export function hasLegacySettingsAiFields(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const obj = raw as Record<string, unknown>;
  return LEGACY_SETTINGS_AI_FIELDS.some((key) => key in obj);
}

export function normalizeImportedBackup(
  jsonText: string
): NormalizedImportedBackup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('ملف النسخة الاحتياطية غير صالح');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('ملف النسخة الاحتياطية غير صالح');
  }

  const raw = parsed as Record<string, unknown>;

  const rawPhotos = Array.isArray(raw.photos) ? raw.photos : [];
  const photos: ShelfPhoto[] = [];
  for (const item of rawPhotos) {
    const cleanPhoto = sanitizePhotoRecord(item);
    if (cleanPhoto) photos.push(cleanPhoto);
  }

  const rawNotes = Array.isArray(raw.notes) ? raw.notes : [];
  const notes = rawNotes.filter(
    (n): n is NoteItem =>
      Boolean(n && typeof n === 'object' && typeof (n as NoteItem).id === 'string')
  );

  const settings =
    raw.settings && typeof raw.settings === 'object'
      ? sanitizeSettingsRecord(raw.settings as Record<string, unknown>)
      : null;

  const whatsappRecipients = Array.isArray(raw.whatsappRecipients)
    ? raw.whatsappRecipients.filter(
        (r): r is WhatsAppRecipient =>
          Boolean(
            r &&
              typeof r === 'object' &&
              typeof (r as WhatsAppRecipient).id === 'string' &&
              typeof (r as WhatsAppRecipient).name === 'string' &&
              typeof (r as WhatsAppRecipient).phone === 'string'
          )
      )
    : null;

  const rawMusic = raw.musicModule as Partial<MusicBackupSection> | undefined;
  const musicModule: MusicBackupSection | null =
    rawMusic && typeof rawMusic === 'object' && Array.isArray(rawMusic.tracks)
      ? {
          tracks: rawMusic.tracks,
          lists: Array.isArray(rawMusic.lists)
            ? rawMusic.lists.filter(
                (l) =>
                  Boolean(
                    l &&
                      typeof l === 'object' &&
                      typeof l.id === 'string' &&
                      typeof l.name === 'string'
                  )
              )
            : undefined,
          playback: rawMusic.playback,
        }
      : null;

  return {
    settings,
    photos,
    notes,
    whatsappRecipients,
    musicModule,
  };
}

export function isLegacyAiCleanupDone(storage: {
  getItem: (key: string) => string | null;
} | null | undefined): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(LEGACY_AI_CLEANUP_STORAGE_KEY) === '1';
  } catch {
    return true;
  }
}

export function markLegacyAiCleanupDone(storage: {
  setItem: (key: string, value: string) => void;
} | null | undefined): void {
  if (!storage) return;
  try {
    storage.setItem(LEGACY_AI_CLEANUP_STORAGE_KEY, '1');
  } catch {
    // Ignore storage errors
  }
}
