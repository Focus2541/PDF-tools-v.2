// เครื่องมือ PDF — service worker
// กลยุทธ์: precache หน้าแอปเอง, ส่วนไฟล์จาก CDN (pdf-lib, pdf.js, ฟอนต์) จะถูกเก็บลงแคช
// อัตโนมัติหลังโหลดสำเร็จครั้งแรก แล้วใช้จากแคชได้ทันทีในครั้งถัดไปแม้ไม่มีเน็ต

const CACHE_PREFIX = 'pdf2-';
const CACHE_VERSION = CACHE_PREFIX + 'v1';
const SHARE_CACHE = CACHE_PREFIX + 'share-inbox';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_VERSION && k !== SHARE_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Files shared from other apps (Android share sheet) arrive as a POST
  if (req.method === 'POST' && new URL(req.url).pathname.endsWith('/share-target')) {
    event.respondWith((async () => {
      try {
        const form = await req.formData();
        const files = form.getAll('files').filter((f) => f && typeof f !== 'string');
        const cache = await caches.open(SHARE_CACHE);
        for (const k of await cache.keys()) await cache.delete(k);
        let i = 0;
        for (const f of files) {
          await cache.put(new Request(`./shared/${Date.now()}-${i++}`), new Response(f, {
            headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-Name': encodeURIComponent(f.name || 'file') },
          }));
        }
      } catch (e) {}
      return Response.redirect('./index.html?shared=1', 303);
    })());
    return;
  }
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  if (sameOrigin) {
    // App shell: cache-first, fall back to network
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req))
    );
  } else {
    // Third-party (pdf-lib, pdf.js, Google Fonts, etc.): try network first,
    // cache a copy on success, fall back to cache when offline
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
  }
});
