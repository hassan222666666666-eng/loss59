/**
 * Arabic & fuzzy product name helpers, digit normalization, date & byte formatting.
 */

const ARABIC_INDIC_ZERO = 0x0660;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;

export function normalizeDigits(val: unknown): string {
  if (val === null || val === undefined) return '';
  return String(val)
    .replace(/[\u0660-\u0669]/g, (ch) =>
      String(ch.charCodeAt(0) - ARABIC_INDIC_ZERO)
    )
    .replace(/[\u06F0-\u06F9]/g, (ch) =>
      String(ch.charCodeAt(0) - EXTENDED_ARABIC_INDIC_ZERO)
    )
    .replace(/[\u066C,\s]/g, '')
    .trim();
}

export function normalizeDigitsKeepSpaces(val: string): string {
  return val
    .replace(/[\u0660-\u0669]/g, (ch) =>
      String(ch.charCodeAt(0) - ARABIC_INDIC_ZERO)
    )
    .replace(/[\u06F0-\u06F9]/g, (ch) =>
      String(ch.charCodeAt(0) - EXTENDED_ARABIC_INDIC_ZERO)
    )
    .replace(/\u066B/g, '.')
    .replace(/\u066C/g, '');
}

export function parsePositiveInt(val: unknown, max: number = 9999): number | null {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') {
    if (!Number.isFinite(val) || val <= 0 || val > max) return null;
    return Math.floor(val);
  }
  const normalized = normalizeDigits(val);
  if (!/^\d+$/.test(normalized)) return null;
  const num = parseInt(normalized, 10);
  if (isNaN(num) || num <= 0 || num > max) return null;
  return num;
}

export function getLocalDateKey(timestamp: number = Date.now()): string {
  const d = new Date(timestamp);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function dateKeyToTimestamp(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y || 2026, (m || 1) - 1, d || 1).getTime();
}

export function getCutoffDateKey(keepDays: number, referenceTs: number = Date.now()): string {
  const ref = new Date(referenceTs);
  ref.setHours(12, 0, 0, 0);
  const cutoffTs = ref.getTime() - Math.max(0, keepDays - 1) * 86400000;
  return getLocalDateKey(cutoffTs);
}

export function isWithinLastDays(
  dateKey: string,
  days: number,
  referenceTs: number = Date.now()
): boolean {
  const cutoff = getCutoffDateKey(days, referenceTs);
  const today = getLocalDateKey(referenceTs);
  return dateKey >= cutoff && dateKey <= today;
}

export function formatDayHeading(dateKey: string): string {
  const todayKey = getLocalDateKey(Date.now());
  const yesterdayKey = getLocalDateKey(Date.now() - 86400000);
  if (dateKey === todayKey) return 'اليوم';
  if (dateKey === yesterdayKey) return 'أمس';
  try {
    const dt = new Date(dateKeyToTimestamp(dateKey));
    return new Intl.DateTimeFormat('ar-IQ', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(dt);
  } catch {
    return dateKey;
  }
}

export function formatShortDateArabic(dateKey: string): string {
  try {
    const dt = new Date(dateKeyToTimestamp(dateKey));
    return new Intl.DateTimeFormat('ar-IQ', {
      month: 'short',
      day: 'numeric',
    }).format(dt);
  } catch {
    return dateKey;
  }
}

export function formatTimeArabic(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat('ar-IQ', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestamp));
  } catch {
    return '';
  }
}

export function formatBytesArabic(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 ك.ب';
  if (bytes < 1024) return `${Math.round(bytes)} بايت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ك.ب`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} م.ب`;
}

export function normalizeProductName(name: string): string {
  return normalizeDigits(name)
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
