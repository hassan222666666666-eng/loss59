import { NoteItem, WhatsAppRecipient } from '../../types';
import {
  formatShortDateArabic,
  formatTimeArabic,
  getLocalDateKey,
  normalizeDigits,
} from '../../utils/arabicText';

export const WHATSAPP_RECIPIENTS_STORAGE_KEY = 'naqs_whatsapp_recipients_v1';
export const DEFAULT_COUNTRY_CODE = '+964';

function cleanDigitsOnly(val: string): string {
  return normalizeDigits(val).replace(/[^\d]/g, '');
}

/**
 * Normalizes a phone number into digits-only format without '+' or spaces for wa.me links.
 * Defaults country code to 964 (Iraq) and strips any leading '0' from local numbers
 * (e.g. 07701234567 -> 9647701234567, +964 0770... -> 964770...).
 */
export function normalizePhoneNumberForWhatsApp(
  rawPhone: string,
  rawCountryCode: string = DEFAULT_COUNTRY_CODE
): string {
  const trimmedRaw = (rawPhone || '').trim();
  const hasPlusPrefix = trimmedRaw.startsWith('+');
  const hasDoubleZeroPrefix = trimmedRaw.startsWith('00');

  let cc = cleanDigitsOnly(rawCountryCode).replace(/^0+/, '');
  if (!cc) cc = '964';

  let digits = cleanDigitsOnly(trimmedRaw);
  if (!digits) return '';

  if (hasDoubleZeroPrefix) {
    digits = digits.replace(/^00+/, '');
  }

  if (hasPlusPrefix || hasDoubleZeroPrefix) {
    if (digits.startsWith(`${cc}0`)) {
      digits = `${cc}${digits.slice(cc.length).replace(/^0+/, '')}`;
    }
    return digits;
  }

  if (digits.startsWith(`${cc}0`) && digits.length >= cc.length + 8) {
    return `${cc}${digits.slice(cc.length).replace(/^0+/, '')}`;
  }

  if (digits.startsWith(cc) && digits.length >= cc.length + 8) {
    return digits;
  }

  const localWithoutLeadingZero = digits.replace(/^0+/, '');
  if (!localWithoutLeadingZero) return '';
  return `${cc}${localWithoutLeadingZero}`;
}

export function isValidWhatsAppPhone(normalizedDigits: string): boolean {
  return normalizedDigits.length >= 9 && normalizedDigits.length <= 15;
}

export function formatPhoneForDisplay(normalizedDigits: string): string {
  if (!normalizedDigits) return '';
  return `+${normalizedDigits}`;
}

export function splitPhoneForEdit(normalizedDigits: string): {
  countryCode: string;
  localNumber: string;
} {
  const clean = cleanDigitsOnly(normalizedDigits);
  const commonCodes = ['964', '966', '971', '965', '974', '973', '968', '962', '20', '90', '1'];
  for (const code of commonCodes) {
    if (clean.startsWith(code) && clean.length > code.length + 6) {
      return {
        countryCode: `+${code}`,
        localNumber: clean.slice(code.length),
      };
    }
  }
  return {
    countryCode: DEFAULT_COUNTRY_CODE,
    localNumber: clean,
  };
}

export function buildWhatsAppSchemeUrl(text: string): string {
  const encodedText = encodeURIComponent(text || '');
  return `whatsapp://send?text=${encodedText}`;
}

export function buildWhatsAppUrl(text: string, phoneDigits?: string): string {
  const encodedText = encodeURIComponent(text || '');
  const cleanPhone = phoneDigits ? cleanDigitsOnly(phoneDigits) : '';
  if (cleanPhone) {
    return `https://wa.me/${cleanPhone}?text=${encodedText}`;
  }
  return `https://wa.me/?text=${encodedText}`;
}

function triggerAnchorNavigation(href: string, newTab: boolean): void {
  if (typeof document === 'undefined') return;
  const link = document.createElement('a');
  link.href = href;
  if (newTab) {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Directly opens WhatsApp with encoded text without picking a contact beforehand.
 * Tries "whatsapp://send?text=..." first; if the page does not leave/hide,
 * falls back to "https://wa.me/?text=..." in a new tab.
 */
export function openWhatsAppDirect(text: string): void {
  const schemeUrl = buildWhatsAppSchemeUrl(text);
  const webUrl = buildWhatsAppUrl(text);

  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return;
  }

  let appOpened = false;
  let timerId: number | null = null;

  const cleanup = () => {
    document.removeEventListener('visibilitychange', onVisibilityOrBlur);
    window.removeEventListener('pagehide', onAppLeft);
    window.removeEventListener('blur', onAppLeft);
    if (timerId !== null) {
      window.clearTimeout(timerId);
      timerId = null;
    }
  };

  const onAppLeft = () => {
    appOpened = true;
    cleanup();
  };

  const onVisibilityOrBlur = () => {
    if (document.hidden) {
      appOpened = true;
      cleanup();
    }
  };

  document.addEventListener('visibilitychange', onVisibilityOrBlur);
  window.addEventListener('pagehide', onAppLeft);
  window.addEventListener('blur', onAppLeft);

  triggerAnchorNavigation(schemeUrl, false);

  timerId = window.setTimeout(() => {
    if (!appOpened && !document.hidden) {
      cleanup();
      triggerAnchorNavigation(webUrl, true);
    } else {
      cleanup();
    }
  }, 700);
}

export function sortRecipientsMostRecentFirst(
  recipients: WhatsAppRecipient[]
): WhatsAppRecipient[] {
  return [...recipients].sort((a, b) => {
    const aUsed = a.lastUsedAt || 0;
    const bUsed = b.lastUsedAt || 0;
    if (bUsed !== aUsed) return bUsed - aUsed;
    return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
  });
}

export function getSavedWhatsAppRecipients(): WhatsAppRecipient[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(WHATSAPP_RECIPIENTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid = parsed.filter(
      (r): r is WhatsAppRecipient =>
        Boolean(r && typeof r === 'object' && r.id && r.name && r.phone)
    );
    return sortRecipientsMostRecentFirst(valid);
  } catch {
    return [];
  }
}

export function saveWhatsAppRecipients(list: WhatsAppRecipient[]): WhatsAppRecipient[] {
  const sorted = sortRecipientsMostRecentFirst(list);
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(WHATSAPP_RECIPIENTS_STORAGE_KEY, JSON.stringify(sorted));
    } catch {
      // Ignore storage quota issues
    }
  }
  return sorted;
}

export function clearSavedWhatsAppRecipients(): void {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(WHATSAPP_RECIPIENTS_STORAGE_KEY);
    } catch {
      // Ignore
    }
  }
}

export function upsertWhatsAppRecipient(input: {
  id?: string;
  name: string;
  phoneDigits: string;
}): WhatsAppRecipient[] {
  const now = Date.now();
  const current = getSavedWhatsAppRecipients();
  const trimmedName = input.name.trim();
  if (!trimmedName || !input.phoneDigits) return current;

  const existing = input.id ? current.find((r) => r.id === input.id) : null;
  let next: WhatsAppRecipient[];
  if (existing) {
    next = current.map((r) =>
      r.id === existing.id
        ? { ...r, name: trimmedName, phone: input.phoneDigits, updatedAt: now }
        : r
    );
  } else {
    const created: WhatsAppRecipient = {
      id: `wa_${now}_${Math.random().toString(36).slice(2, 6)}`,
      name: trimmedName,
      phone: input.phoneDigits,
      createdAt: now,
      updatedAt: now,
    };
    next = [created, ...current];
  }
  return saveWhatsAppRecipients(next);
}

export function deleteWhatsAppRecipient(id: string): WhatsAppRecipient[] {
  const current = getSavedWhatsAppRecipients();
  return saveWhatsAppRecipients(current.filter((r) => r.id !== id));
}

export function markWhatsAppRecipientUsed(
  id: string,
  now: number = Date.now()
): WhatsAppRecipient[] {
  const current = getSavedWhatsAppRecipients();
  const updated = current.map((r) =>
    r.id === id ? { ...r, lastUsedAt: now, updatedAt: now } : r
  );
  return saveWhatsAppRecipients(updated);
}

export function canShareImageFiles(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') {
    return false;
  }
  if (typeof File === 'undefined') return false;
  try {
    const probe = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'probe.jpg', {
      type: 'image/jpeg',
    });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

export function collectNoteImageDataUrls(note: Pick<NoteItem, 'photos' | 'linePhotos'>): string[] {
  const urls: string[] = [];
  for (const lp of note.linePhotos || []) {
    if (lp.dataUrl) urls.push(lp.dataUrl);
  }
  for (const p of note.photos || []) {
    if (p.dataUrl) urls.push(p.dataUrl);
  }
  return urls;
}

export function dataUrlToImageFile(dataUrl: string, filename: string): File | null {
  try {
    const parts = dataUrl.split(',');
    if (parts.length < 2) return null;
    const headerMatch = parts[0].match(/data:([^;]+);/);
    const mime = headerMatch?.[1] || 'image/jpeg';
    const binary = atob(parts[1]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new File([bytes], filename, { type: mime });
  } catch {
    return null;
  }
}

export async function shareNoteViaOtherApp(
  note: Pick<NoteItem, 'photos' | 'linePhotos'>,
  text: string
): Promise<'shared' | 'cancelled' | 'unsupported'> {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
    return 'unsupported';
  }

  const urls = collectNoteImageDataUrls(note);
  const files: File[] = [];
  if (urls.length > 0 && canShareImageFiles()) {
    urls.forEach((url, idx) => {
      const file = dataUrlToImageFile(url, `note-photo-${idx + 1}.jpg`);
      if (file) files.push(file);
    });
  }

  const canAttachFiles =
    files.length > 0 &&
    typeof navigator.canShare === 'function' &&
    (() => {
      try {
        return navigator.canShare({ files });
      } catch {
        return false;
      }
    })();

  try {
    if (canAttachFiles) {
      await navigator.share({
        text: text || undefined,
        files,
      });
    } else {
      await navigator.share({
        text: text || '',
      });
    }
    return 'shared';
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return 'cancelled';
    }
    return 'unsupported';
  }
}

export function formatSentTimestampArabic(timestamp: number): string {
  const todayKey = getLocalDateKey(Date.now());
  const sentKey = getLocalDateKey(timestamp);
  const timeStr = formatTimeArabic(timestamp);
  if (sentKey === todayKey) return timeStr;
  return `${formatShortDateArabic(sentKey)} ${timeStr}`.trim();
}
