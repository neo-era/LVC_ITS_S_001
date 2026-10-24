const VERSION = 'lat-v5';
const SHELL = VERSION + '-shell';
const DATA = VERSION + '-data';

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      const base = self.registration.scope;
      const html = await (await fetch(base, { cache: 'reload' })).text();
      const urls = new Set([base, base + 'manifest.webmanifest', base + 'icons/icon-192.png']);
      for (const m of html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)) urls.add(new URL(m[1], base).href);
      await cache.addAll([...urls]);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith('lat-v') && !k.startsWith(VERSION)) await caches.delete(k); // không đụng bản đồ offline (lat-map-…)
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // Tệp bản đồ theo tỉnh rất lớn: app tự lưu khi người dùng bấm Tải, service worker không giữ thêm bản sao.
  if (url.pathname.includes('/map/tiles/')) return;

  if (url.pathname.includes('/map/')) {
    // Danh sách tỉnh, style, sprite, font: ưu tiên bản mới; mất mạng thì lấy bản đã lưu (kể cả bản lưu kèm tỉnh đã tải).
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            e.waitUntil(caches.open(SHELL).then((c) => c.put(req, copy)));
          }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || new Response('', { status: 503 }))),
    );
    return;
  }

  if (url.pathname.includes('/data/')) {
    // Dữ liệu: ưu tiên bản mới nhất, mất mạng thì dùng bản đã lưu.
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone(); // phải sao chép ngay, trước khi trang đọc hết nội dung
            e.waitUntil(caches.open(DATA).then((c) => c.put(req, copy)));
          }
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || new Response('', { status: 503 }))),
    );
    return;
  }

  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      const net = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            e.waitUntil(caches.open(SHELL).then((c) => c.put(req, copy)));
          }
          return res;
        })
        .catch(() => hit);
      return hit || net;
    }),
  );
});
