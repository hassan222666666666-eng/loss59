export interface ManifestValidationResult {
  valid: boolean;
  reason?: string;
  icon192Src?: string;
  icon512Src?: string;
}

export interface PwaDiagnosticsSnapshot {
  manifestValid: boolean;
  manifestDetails?: string;
  iconsLoaded: boolean;
  iconsDetails?: string;
  swRegisteredAndActive: boolean;
  swDetails?: string;
  isHttps: boolean;
  protocol: string;
  isInIframe: boolean;
  isStandalone: boolean;
  lastError: string | null;
}

export interface PwaDiagnosticsRow {
  key: string;
  label: string;
  value: string;
  ok?: boolean;
}

export const IFRAME_INSTALL_WARNING_TEXT =
  'التثبيت لا يعمل من داخل المعاينة؛ افتح الرابط المنشور للتطبيق مباشرة';

export function shouldRegisterServiceWorker(
  protocol: string,
  hostname: string
): boolean {
  const normalizedProtocol = protocol.toLowerCase();
  const normalizedHost = hostname.toLowerCase();
  return (
    normalizedProtocol === 'https:' ||
    normalizedHost === 'localhost' ||
    normalizedHost === '127.0.0.1' ||
    normalizedHost === '[::1]'
  );
}

export function validateManifestPayload(raw: unknown): ManifestValidationResult {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, reason: 'بيانات البيان غير صالحة' };
  }
  const m = raw as Record<string, unknown>;
  if (typeof m.name !== 'string' || !m.name.trim()) {
    return { valid: false, reason: 'حقل name مفقود' };
  }
  if (typeof m.short_name !== 'string' || !m.short_name.trim()) {
    return { valid: false, reason: 'حقل short_name مفقود' };
  }
  if (typeof m.start_url !== 'string' || !m.start_url.trim()) {
    return { valid: false, reason: 'حقل start_url مفقود' };
  }
  if (m.display !== 'standalone') {
    return { valid: false, reason: 'حقل display ليس standalone' };
  }
  if (!Array.isArray(m.icons) || m.icons.length === 0) {
    return { valid: false, reason: 'قائمة الأيقونات فارغة' };
  }

  let icon192Src: string | undefined;
  let icon512Src: string | undefined;

  for (const item of m.icons) {
    if (!item || typeof item !== 'object') continue;
    const icon = item as Record<string, unknown>;
    const src = typeof icon.src === 'string' ? icon.src : '';
    const sizes = typeof icon.sizes === 'string' ? icon.sizes : '';
    const type = typeof icon.type === 'string' ? icon.type : '';
    const isPng = type === 'image/png' || src.toLowerCase().endsWith('.png');
    if (!src || !isPng) continue;

    const sizeTokens = sizes.toLowerCase().split(/\s+/);
    if (sizeTokens.includes('192x192') && !icon192Src) {
      icon192Src = src;
    }
    if (sizeTokens.includes('512x512') && !icon512Src) {
      icon512Src = src;
    }
  }

  if (!icon192Src) {
    return { valid: false, reason: 'أيقونة 192x192 PNG مفقودة' };
  }
  if (!icon512Src) {
    return { valid: false, reason: 'أيقونة 512x512 PNG مفقودة' };
  }

  return {
    valid: true,
    icon192Src,
    icon512Src,
  };
}

export function isRunningInIframe(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function isStandaloneDisplayMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const mediaStandalone =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches;
    const iosStandalone =
      (window.navigator as unknown as { standalone?: boolean }).standalone ===
      true;
    return Boolean(mediaStandalone || iosStandalone);
  } catch {
    return false;
  }
}

export function buildPwaDiagnosticsRows(
  diag: PwaDiagnosticsSnapshot
): PwaDiagnosticsRow[] {
  return [
    {
      key: 'manifest',
      label: 'ملف البيان (Manifest) موجود وصالح',
      value: diag.manifestValid
        ? 'نعم'
        : `لا${diag.manifestDetails ? ` (${diag.manifestDetails})` : ''}`,
      ok: diag.manifestValid,
    },
    {
      key: 'icons',
      label: 'أيقونتا 192 و 512 محمّلتان',
      value: diag.iconsLoaded
        ? 'نعم'
        : `لا${diag.iconsDetails ? ` (${diag.iconsDetails})` : ''}`,
      ok: diag.iconsLoaded,
    },
    {
      key: 'sw',
      label: 'عامل الخدمة (Service Worker) مسجّل ونشط',
      value: diag.swRegisteredAndActive
        ? 'نعم'
        : `لا${diag.swDetails ? ` (${diag.swDetails})` : ''}`,
      ok: diag.swRegisteredAndActive,
    },
    {
      key: 'https',
      label: 'يعمل عبر HTTPS',
      value: diag.isHttps
        ? 'نعم'
        : `لا (${diag.protocol || 'http:'})`,
      ok: diag.isHttps,
    },
    {
      key: 'iframe',
      label: 'يعمل داخل إطار معاينة (iframe)',
      value: diag.isInIframe ? 'نعم (إطار معاينة)' : 'لا (صفحة مستقلة)',
      ok: !diag.isInIframe,
    },
    {
      key: 'lastError',
      label: 'آخر خطأ',
      value: diag.lastError ? diag.lastError : 'لا يوجد',
      ok: !diag.lastError,
    },
  ];
}

export function formatPwaDiagnosticsClipboardText(
  diag: PwaDiagnosticsSnapshot
): string {
  const rows = buildPwaDiagnosticsRows(diag);
  const lines = [
    'حالة تثبيت التطبيق:',
    `- وضع التشغيل: ${diag.isStandalone ? 'مثبّت (مستقل)' : 'متصفح'}`,
    ...rows.map((r) => `- ${r.label}: ${r.value}`),
  ];
  if (diag.isInIframe) {
    lines.push(`- ملاحظة: ${IFRAME_INSTALL_WARNING_TEXT}`);
  }
  return lines.join('\n');
}

function checkImageLoad(
  src: string,
  minDimension: number
): Promise<{ ok: boolean; width: number; height: number }> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') {
      resolve({ ok: false, width: 0, height: 0 });
      return;
    }
    const img = new Image();
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, width: 0, height: 0 });
    }, 4000);

    img.onload = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      const w = img.naturalWidth || 0;
      const h = img.naturalHeight || 0;
      resolve({ ok: w >= minDimension && h >= minDimension, width: w, height: h });
    };
    img.onerror = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve({ ok: false, width: 0, height: 0 });
    };
    img.src = src;
  });
}

export async function runLivePwaDiagnostics(
  lastError: string | null
): Promise<PwaDiagnosticsSnapshot> {
  const protocol =
    typeof window !== 'undefined' ? window.location.protocol : '';
  const isHttps = protocol.toLowerCase() === 'https:';
  const isInIframe = isRunningInIframe();
  const isStandalone = isStandaloneDisplayMode();

  let manifestValid = false;
  let manifestDetails: string | undefined;
  let icon192Src = '/pwa-192x192.png';
  let icon512Src = '/pwa-512x512.png';

  try {
    const manifestLink =
      typeof document !== 'undefined'
        ? document.querySelector('link[rel="manifest"]')?.getAttribute('href') ||
          '/manifest.webmanifest'
        : '/manifest.webmanifest';
    const res = await fetch(manifestLink, { cache: 'no-store' });
    if (!res.ok) {
      manifestDetails = `HTTP ${res.status}`;
    } else {
      const json = (await res.json()) as unknown;
      const validation = validateManifestPayload(json);
      manifestValid = validation.valid;
      manifestDetails = validation.reason;
      if (validation.icon192Src) icon192Src = validation.icon192Src;
      if (validation.icon512Src) icon512Src = validation.icon512Src;
    }
  } catch (err) {
    manifestValid = false;
    manifestDetails =
      err instanceof Error ? err.message : 'تعذر قراءة ملف البيان';
  }

  let iconsLoaded = false;
  let iconsDetails: string | undefined;
  try {
    const [res192, res512] = await Promise.all([
      checkImageLoad(icon192Src, 192),
      checkImageLoad(icon512Src, 512),
    ]);
    iconsLoaded = res192.ok && res512.ok;
    if (!iconsLoaded) {
      iconsDetails = `192:${res192.ok ? 'OK' : 'ERR'} / 512:${res512.ok ? 'OK' : 'ERR'}`;
    }
  } catch {
    iconsLoaded = false;
    iconsDetails = 'تعذر تحميل الأيقونات';
  }

  let swRegisteredAndActive = false;
  let swDetails: string | undefined;
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      swDetails = 'غير مدعوم في المتصفح';
    } else {
      const reg = await navigator.serviceWorker.getRegistration('/');
      if (reg && reg.active && reg.active.state === 'activated') {
        swRegisteredAndActive = true;
      } else if (reg && (reg.installing || reg.waiting)) {
        swDetails = reg.waiting ? 'بانتظار التفعيل' : 'قيد التثبيت';
      } else if (navigator.serviceWorker.controller) {
        swRegisteredAndActive = true;
      } else {
        swDetails = 'غير مسجّل';
      }
    }
  } catch (err) {
    swRegisteredAndActive = false;
    swDetails = err instanceof Error ? err.message : 'خطأ في فحص عامل الخدمة';
  }

  return {
    manifestValid,
    manifestDetails,
    iconsLoaded,
    iconsDetails,
    swRegisteredAndActive,
    swDetails,
    isHttps,
    protocol,
    isInIframe,
    isStandalone,
    lastError,
  };
}
