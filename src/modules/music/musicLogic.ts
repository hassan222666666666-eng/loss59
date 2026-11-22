import { MusicFabColorId } from '../../types';
import {
  MusicBackupTrackMeta,
  MusicLibraryTab,
  MusicRepeatMode,
  MusicTrackRecord,
} from './types';

export const DEFAULT_MUSIC_MAX_STORAGE_MB = 500;
export const SEARCH_BAR_TRACK_THRESHOLD = 1;
export const MISSING_FILE_LABEL = 'الملف غير موجود، أعد إضافته';
export const SLEEP_TIMER_PRESETS_MIN = [15, 30, 60] as const;

export const MUSIC_IDLE_FADE_DELAY_MS = 4000;
export const MUSIC_IDLE_OPACITY = 0.35;

export const AUDIO_FILE_EXTENSIONS = [
  'mp3',
  'm4a',
  'mp4',
  'aac',
  'ogg',
  'opus',
  'wav',
  'flac',
  'webm',
  'wma',
] as const;

export interface MusicFabColorPreset {
  id: MusicFabColorId;
  label: string;
  gradientClass: string;
  conicColorsCss: string;
  ringBgClass: string;
  swatchHex: string;
}

export const MUSIC_FAB_COLOR_PRESETS: readonly MusicFabColorPreset[] = [
  {
    id: 'violet-pink',
    label: 'بنفسجي ووردي',
    gradientClass: 'bg-gradient-to-br from-violet-600 via-fuchsia-500 to-pink-500',
    conicColorsCss: 'conic-gradient(from 0deg, #a855f7, #ec4899, #f472b6, #8b5cf6, #a855f7)',
    ringBgClass: 'bg-fuchsia-400/50',
    swatchHex: '#c026d3',
  },
  {
    id: 'indigo-cyan',
    label: 'نيلي وسماوي',
    gradientClass: 'bg-gradient-to-br from-indigo-600 via-blue-500 to-cyan-400',
    conicColorsCss: 'conic-gradient(from 0deg, #4f46e5, #06b6d4, #38bdf8, #6366f1, #4f46e5)',
    ringBgClass: 'bg-cyan-400/50',
    swatchHex: '#4f46e5',
  },
  {
    id: 'amber-rose',
    label: 'عنبر ومرجاني',
    gradientClass: 'bg-gradient-to-br from-amber-500 via-orange-500 to-rose-500',
    conicColorsCss: 'conic-gradient(from 0deg, #f59e0b, #f43f5e, #fb7185, #ea580c, #f59e0b)',
    ringBgClass: 'bg-rose-400/50',
    swatchHex: '#f97316',
  },
  {
    id: 'sky-blue',
    label: 'أزرق سماوي',
    gradientClass: 'bg-gradient-to-br from-sky-500 via-blue-600 to-indigo-600',
    conicColorsCss: 'conic-gradient(from 0deg, #0ea5e9, #2563eb, #6366f1, #38bdf8, #0ea5e9)',
    ringBgClass: 'bg-sky-400/50',
    swatchHex: '#0284c7',
  },
  {
    id: 'crimson-orange',
    label: 'قرمزي وبرتقالي',
    gradientClass: 'bg-gradient-to-br from-rose-600 via-red-500 to-amber-500',
    conicColorsCss: 'conic-gradient(from 0deg, #e11d48, #ef4444, #f59e0b, #f43f5e, #e11d48)',
    ringBgClass: 'bg-red-400/50',
    swatchHex: '#e11d48',
  },
  {
    id: 'teal-violet',
    label: 'تركواز وبنفسجي',
    gradientClass: 'bg-gradient-to-br from-teal-500 via-cyan-600 to-violet-600',
    conicColorsCss: 'conic-gradient(from 0deg, #14b8a6, #0891b2, #7c3aed, #2dd4bf, #14b8a6)',
    ringBgClass: 'bg-violet-400/50',
    swatchHex: '#0d9488',
  },
] as const;

export function resolveMusicFabColorPreset(
  id?: string | null
): MusicFabColorPreset {
  const found = MUSIC_FAB_COLOR_PRESETS.find((p) => p.id === id);
  return found || MUSIC_FAB_COLOR_PRESETS[0];
}

export type SleepTimerMinutes = (typeof SLEEP_TIMER_PRESETS_MIN)[number];

export function computeSleepTimerRemainingSec(
  endsAtMs: number | null,
  nowMs: number = Date.now()
): number {
  if (!endsAtMs || !Number.isFinite(endsAtMs)) return 0;
  const diffMs = endsAtMs - nowMs;
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / 1000);
}

export function formatSleepTimerBadge(remainingSec: number): string {
  if (!Number.isFinite(remainingSec) || remainingSec <= 0) return '';
  const total = Math.ceil(remainingSec);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function getDefaultFloatingButtonY(
  viewportHeight: number,
  buttonSize: number = 44
): number {
  const safeVh =
    Number.isFinite(viewportHeight) && viewportHeight > 220
      ? viewportHeight
      : 844;
  return clampFloatingButtonY(
    Math.round((safeVh - buttonSize) * 0.5),
    safeVh,
    buttonSize
  );
}

export function clampFloatingButtonY(
  y: number,
  viewportHeight: number,
  buttonSize: number = 44
): number {
  const safeVh =
    Number.isFinite(viewportHeight) && viewportHeight > 220
      ? viewportHeight
      : 844;
  const minY = 56;
  const maxY = Math.max(minY, safeVh - buttonSize - 92);
  if (!Number.isFinite(y)) {
    return Math.max(
      minY,
      Math.min(maxY, Math.round((safeVh - buttonSize) * 0.5))
    );
  }
  return Math.max(minY, Math.min(maxY, Math.round(y)));
}

export function isSupportedAudioFile(file: {
  name?: string;
  type?: string;
  size?: number;
}): boolean {
  if (!file || typeof file !== 'object') return false;
  if (typeof file.size === 'number' && file.size <= 0) return false;
  const mime = (file.type || '').trim().toLowerCase();
  if (mime.startsWith('audio/')) return true;
  const name = (file.name || '').trim().toLowerCase();
  const dotIdx = name.lastIndexOf('.');
  if (dotIdx === -1 || dotIdx === name.length - 1) return false;
  const ext = name.slice(dotIdx + 1);
  return (AUDIO_FILE_EXTENSIONS as readonly string[]).includes(ext);
}

export function makeAudioDuplicateKey(fileName: string, size: number): string {
  return `${(fileName || '').trim().toLowerCase()}::${Math.max(0, Number(size) || 0)}`;
}

export function isDuplicateAudioFile(
  existingTracks: ReadonlyArray<MusicTrackRecord>,
  seenKeys: ReadonlySet<string>,
  fileName: string,
  size: number
): boolean {
  const key = makeAudioDuplicateKey(fileName, size);
  if (seenKeys.has(key)) return true;
  return existingTracks.some(
    (t) =>
      t.kind === 'file' &&
      !t.missingFile &&
      makeAudioDuplicateKey(t.fileName || '', t.size) === key
  );
}

export function formatMusicImportSummary(params: {
  addedCount: number;
  skippedDuplicatesCount: number;
  failedCount: number;
}): string {
  return `أضيف ${params.addedCount} ملف · تم تخطي ${params.skippedDuplicatesCount} مكرر · فشل ${params.failedCount}`;
}

export function stripAudioFileExtension(filename: string): string {
  const trimmed = (filename || '').trim();
  if (!trimmed) return 'مقطع صوتي';
  const dotIdx = trimmed.lastIndexOf('.');
  if (dotIdx === 0 && trimmed.length <= 8) {
    return 'مقطع صوتي';
  }
  if (dotIdx > 0 && trimmed.length - dotIdx <= 8) {
    const base = trimmed.slice(0, dotIdx).trim();
    if (base) return base;
    return 'مقطع صوتي';
  }
  return trimmed;
}

export function deriveShortTrackName(filename: string): string {
  const withoutExt = stripAudioFileExtension(filename);
  const normalized = withoutExt.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized || 'مقطع صوتي';
}

export function formatAudioTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  if (hrs > 0) {
    return `${hrs}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

export function canAddAudioBytes(
  currentUsedBytes: number,
  newBytes: number,
  maxStorageMb: number = DEFAULT_MUSIC_MAX_STORAGE_MB
): {
  ok: boolean;
  currentBytes: number;
  projectedBytes: number;
  maxBytes: number;
} {
  const safeCurrent = Math.max(0, Number.isFinite(currentUsedBytes) ? currentUsedBytes : 0);
  const safeNew = Math.max(0, Number.isFinite(newBytes) ? newBytes : 0);
  const safeMaxMb =
    Number.isFinite(maxStorageMb) && maxStorageMb > 0
      ? maxStorageMb
      : DEFAULT_MUSIC_MAX_STORAGE_MB;
  const maxBytes = Math.round(safeMaxMb * 1024 * 1024);
  const projectedBytes = safeCurrent + safeNew;
  return {
    ok: projectedBytes <= maxBytes,
    currentBytes: safeCurrent,
    projectedBytes,
    maxBytes,
  };
}

export function isBrowserStorageLow(
  usageBytes: number,
  quotaBytes: number
): boolean {
  if (!Number.isFinite(quotaBytes) || quotaBytes <= 0) return false;
  if (!Number.isFinite(usageBytes) || usageBytes < 0) return false;
  const remaining = quotaBytes - usageBytes;
  const ratio = usageBytes / quotaBytes;
  return ratio >= 0.85 || remaining < 50 * 1024 * 1024;
}

export function isValidRadioUrl(rawUrl: string): boolean {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function normalizeTrackOrder(
  tracks: MusicTrackRecord[]
): MusicTrackRecord[] {
  const sorted = [...tracks].sort(
    (a, b) => a.order - b.order || a.createdAt - b.createdAt
  );
  return sorted.map((t, index) => ({
    ...t,
    order: index,
  }));
}

export function reorderTrackList(
  tracks: MusicTrackRecord[],
  trackId: string,
  direction: 'up' | 'down'
): MusicTrackRecord[] {
  const ordered = normalizeTrackOrder(tracks);
  const idx = ordered.findIndex((t) => t.id === trackId);
  if (idx === -1) return ordered;
  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= ordered.length) return ordered;

  const swapped = [...ordered];
  const temp = swapped[idx];
  swapped[idx] = swapped[targetIdx];
  swapped[targetIdx] = temp;

  return swapped.map((t, i) => ({
    ...t,
    order: i,
    updatedAt: t.id === trackId ? Date.now() : t.updatedAt,
  }));
}

export function filterPlaylistTracks(
  tracks: MusicTrackRecord[],
  query: string
): MusicTrackRecord[] {
  const q = (query || '').trim().toLowerCase();
  if (!q) return tracks;
  return tracks.filter(
    (t) =>
      t.title.toLowerCase().includes(q) ||
      (t.fileName && t.fileName.toLowerCase().includes(q)) ||
      (t.kind === 'radio' && 'إذاعة راديو radio'.includes(q))
  );
}

export function getRecentPlayedTracks(
  tracks: MusicTrackRecord[],
  limit: number = 8
): MusicTrackRecord[] {
  return [...tracks]
    .filter((t) => typeof t.lastPlayedAt === 'number' && t.lastPlayedAt > 0)
    .sort((a, b) => (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0))
    .slice(0, Math.max(0, limit));
}

export function filterTracksByTabAndQuery(
  tracks: MusicTrackRecord[],
  params: {
    tab: MusicLibraryTab;
    query: string;
  }
): MusicTrackRecord[] {
  let base: MusicTrackRecord[];
  if (params.tab === 'favorites') {
    base = tracks.filter((t) => Boolean(t.favorite));
  } else if (params.tab === 'recent') {
    base = [...tracks]
      .filter((t) => typeof t.lastPlayedAt === 'number' && t.lastPlayedAt > 0)
      .sort((a, b) => (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0));
  } else if (params.tab.startsWith('list:')) {
    const listId = params.tab.slice(5);
    base = tracks.filter(
      (t) => Array.isArray(t.listIds) && t.listIds.includes(listId)
    );
  } else {
    base = tracks;
  }
  return filterPlaylistTracks(base, params.query);
}

export function isTrackPlayable(track: MusicTrackRecord): boolean {
  if (track.kind === 'radio') {
    return Boolean(track.streamUrl && isValidRadioUrl(track.streamUrl));
  }
  return !track.missingFile;
}

export function pickNextTrackIndex(
  tracks: MusicTrackRecord[],
  currentIndex: number,
  shuffle: boolean,
  repeat: MusicRepeatMode,
  direction: 'next' | 'prev',
  failedIds?: ReadonlySet<string>,
  randomFn: () => number = Math.random
): number {
  if (tracks.length === 0) return -1;

  const isEligible = (idx: number) => {
    const t = tracks[idx];
    if (!t || !isTrackPlayable(t)) return false;
    if (failedIds && failedIds.has(t.id)) return false;
    return true;
  };

  if (
    repeat === 'one' &&
    direction === 'next' &&
    currentIndex >= 0 &&
    currentIndex < tracks.length &&
    isEligible(currentIndex)
  ) {
    return currentIndex;
  }

  const eligibleIndices: number[] = [];
  for (let i = 0; i < tracks.length; i++) {
    if (isEligible(i)) eligibleIndices.push(i);
  }
  if (eligibleIndices.length === 0) return -1;

  if (shuffle) {
    const others = eligibleIndices.filter((i) => i !== currentIndex);
    if (others.length > 0) {
      const pick = Math.floor(Math.min(0.999999, Math.max(0, randomFn())) * others.length);
      return others[pick];
    }
    return repeat === 'off' && currentIndex !== -1 ? -1 : eligibleIndices[0];
  }

  const start = currentIndex < 0 || currentIndex >= tracks.length ? -1 : currentIndex;
  const step = direction === 'next' ? 1 : -1;

  if (start === -1) {
    return direction === 'next'
      ? eligibleIndices[0]
      : eligibleIndices[eligibleIndices.length - 1];
  }

  // Linear search forward or backward from start
  for (let offset = 1; offset <= tracks.length; offset++) {
    const rawIdx = start + step * offset;
    if (repeat === 'off' && (rawIdx < 0 || rawIdx >= tracks.length)) {
      return -1;
    }
    const wrapped = ((rawIdx % tracks.length) + tracks.length) % tracks.length;
    if (isEligible(wrapped)) {
      return wrapped;
    }
  }

  return -1;
}

export function findMatchingMissingTrack(
  tracks: MusicTrackRecord[],
  fileName: string,
  fileSize: number
): MusicTrackRecord | null {
  const baseTitle = stripAudioFileExtension(fileName).toLowerCase();
  const normalizedName = (fileName || '').trim().toLowerCase();

  const missing = tracks.filter((t) => t.kind === 'file' && t.missingFile);
  if (missing.length === 0) return null;

  // Prefer exact fileName + size match
  const exactBoth = missing.find(
    (t) =>
      t.fileName &&
      t.fileName.trim().toLowerCase() === normalizedName &&
      t.size === fileSize
  );
  if (exactBoth) return exactBoth;

  // Next match exact fileName
  const byFileName = missing.find(
    (t) => t.fileName && t.fileName.trim().toLowerCase() === normalizedName
  );
  if (byFileName) return byFileName;

  // Next match stripped title
  const byTitle = missing.find(
    (t) => t.title.trim().toLowerCase() === baseTitle
  );
  return byTitle || null;
}

export function buildMusicBackupTracks(
  tracks: MusicTrackRecord[]
): MusicBackupTrackMeta[] {
  return normalizeTrackOrder(tracks).map((t) => ({
    id: t.id,
    kind: t.kind,
    title: t.title,
    fileName: t.fileName,
    mimeType: t.mimeType,
    streamUrl: t.kind === 'radio' ? t.streamUrl : undefined,
    duration: t.duration,
    size: t.size,
    order: t.order,
    favorite: Boolean(t.favorite),
    lastPlayedAt: t.lastPlayedAt,
    tileColor: t.tileColor,
    listIds: Array.isArray(t.listIds) ? [...t.listIds] : undefined,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }));
}

export function mergeImportedMusicTracks(
  existingTracks: MusicTrackRecord[],
  existingBlobTrackIds: ReadonlySet<string>,
  importedTracks: MusicBackupTrackMeta[]
): MusicTrackRecord[] {
  const byId = new Map<string, MusicTrackRecord>();
  for (const existing of existingTracks) {
    const hasBlob = existing.kind === 'radio' || existingBlobTrackIds.has(existing.id);
    byId.set(existing.id, {
      ...existing,
      missingFile: existing.kind === 'file' ? !hasBlob : false,
    });
  }

  for (let i = 0; i < importedTracks.length; i++) {
    const imp = importedTracks[i];
    if (!imp || typeof imp !== 'object' || !imp.id || !imp.title) continue;
    const kind = imp.kind === 'radio' ? 'radio' : 'file';
    const hasLocalBlob = kind === 'radio' ? true : existingBlobTrackIds.has(imp.id);
    const prev = byId.get(imp.id);
    byId.set(imp.id, {
      id: String(imp.id),
      kind,
      title: String(imp.title),
      fileName: imp.fileName ? String(imp.fileName) : prev?.fileName,
      mimeType: imp.mimeType ? String(imp.mimeType) : prev?.mimeType,
      streamUrl: kind === 'radio' && imp.streamUrl ? String(imp.streamUrl) : undefined,
      duration: Number.isFinite(imp.duration) ? Math.max(0, imp.duration) : 0,
      size: Number.isFinite(imp.size) ? Math.max(0, imp.size) : 0,
      order: Number.isFinite(imp.order) ? imp.order : i,
      missingFile: kind === 'file' ? !hasLocalBlob : false,
      favorite: imp.favorite !== undefined ? Boolean(imp.favorite) : prev?.favorite,
      lastPlayedAt:
        typeof imp.lastPlayedAt === 'number' && Number.isFinite(imp.lastPlayedAt)
          ? imp.lastPlayedAt
          : prev?.lastPlayedAt,
      coverDataUrl: prev?.coverDataUrl, // Keep any locally cached cover; never expect covers in backup
      tileColor: imp.tileColor ? String(imp.tileColor) : prev?.tileColor,
      listIds: Array.isArray(imp.listIds)
        ? imp.listIds.filter((id): id is string => typeof id === 'string')
        : prev?.listIds,
      createdAt: Number.isFinite(imp.createdAt) ? imp.createdAt : Date.now(),
      updatedAt: Number.isFinite(imp.updatedAt) ? imp.updatedAt : Date.now(),
    });
  }

  return normalizeTrackOrder(Array.from(byId.values()));
}

let cachedArtworkUrl: string | null = null;

export function generateMusicArtworkDataUrl(): string {
  if (cachedArtworkUrl) return cachedArtworkUrl;

  if (typeof document !== 'undefined') {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#065f46';
        ctx.fillRect(0, 0, 256, 256);

        ctx.fillStyle = '#10b981';
        ctx.beginPath();
        ctx.arc(128, 128, 92, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(102, 162, 20, 0, Math.PI * 2);
        ctx.arc(158, 150, 20, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillRect(114, 84, 12, 78);
        ctx.fillRect(170, 72, 12, 78);
        ctx.beginPath();
        ctx.moveTo(114, 84);
        ctx.lineTo(182, 72);
        ctx.lineTo(182, 92);
        ctx.lineTo(114, 104);
        ctx.closePath();
        ctx.fill();

        cachedArtworkUrl = canvas.toDataURL('image/png');
        return cachedArtworkUrl;
      }
    } catch {
      // Fallback below
    }
  }

  cachedArtworkUrl =
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="24" fill="#065f46"/><circle cx="64" cy="64" r="44" fill="#10b981"/><path d="M54 80V44l28-6v34" stroke="#fff" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="48" cy="82" r="8" fill="#fff"/><circle cx="76" cy="74" r="8" fill="#fff"/></svg>'
    );
  return cachedArtworkUrl;
}
