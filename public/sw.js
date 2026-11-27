const CACHE_VERSION = 'v1';
const CACHE_NAME = `naqs-alrofoof-shell-${CACHE_VERSION}`;

const APP_SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon.svg',
  '/apple-touch-icon.png',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/pwa-maskable-512x512.png',
];

const STATIC_ASSET_EXT_RE =
  /\.(?:js|mjs|css|png|jpg|jpeg|svg|ico|webp|woff|woff2|ttf|webmanifest)$/i;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.all(
          APP_SHELL_URLS.map((url) =>
            cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined)
          )
        )
      )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key).catch(() => false))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

function isHtmlRequest(request, url) {
  if (request.mode === 'navigate') return true;
  const accept = request.headers.get('accept') || '';
  if (accept.includes('text/html')) return true;
  return url.pathname === '/' || url.pathname === '/index.html';
}

function isDevModulePath(pathname) {
  return (
    pathname.startsWith('/src/') ||
    pathname.startsWith('/@') ||
    pathname.startsWith('/node_modules/')
  );
}

function isStaticShellAsset(url) {
  if (
    url.origin === 'https://fonts.googleapis.com' ||
    url.origin === 'https://fonts.gstatic.com'
  ) {
    return true;
  }
  if (url.origin !== self.location.origin) {
    return false;
  }
  if (isDevModulePath(url.pathname)) {
    return false;
  }
  if (url.pathname.startsWith('/assets/')) {
    return true;
  }
  return STATIC_ASSET_EXT_RE.test(url.pathname);
}

async function handleNetworkFirst(request, fallbackUrls) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.ok && response.type !== 'opaque') {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    for (const fallbackUrl of fallbackUrls) {
      const fb = await cache.match(fallbackUrl);
      if (fb) return fb;
    }
    throw err;
  }
}

async function handleCacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }
  const response = await fetch(request);
  if (response && (response.ok || response.type === 'opaque')) {
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return;
  }

  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) {
    return;
  }

  if (url.origin === self.location.origin && isHtmlRequest(request, url)) {
    event.respondWith(handleNetworkFirst(request, ['/', '/index.html']));
    return;
  }

  if (isStaticShellAsset(url)) {
    event.respondWith(handleCacheFirst(request));
    return;
  }

  if (url.origin === self.location.origin && isDevModulePath(url.pathname)) {
    event.respondWith(handleNetworkFirst(request, []));
  }
});
