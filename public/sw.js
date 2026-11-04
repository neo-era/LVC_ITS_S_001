const VERSION = 'lat-v5';
const SHELL = VERSION + '-shell';
// Dữ liệu ô lưới: tên cố định, giữ qua các lần cập nhật app (đổi phiên bản không mất offline).
const DATA = 'lat-data';
const DATA_MAX = 3000;
const DATA_WAIT = 3000; // mạng chậm hơn thì dùng bản đã lưu
// Điền lúc build: mọi tệp trong assets/ (cả thư viện nạp động như maplibre).
const PRECACHE = [];

/** Bỏ bớt mục cũ nhất khi kho dữ liệu vượt giới hạn. */
async function trimData(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - DATA_MAX; i++) await cache.delete(keys[i]);
}

/** Lấy mạng; quá hạn mà đã có bản lưu thì trả bản lưu, mạng vẫn chạy nền để cập nhật kho. */
function networkFirst(e, req, store, wait, trim) {
  const net = fetch(req);
  // Ghi kho ngay trong lúc xử lý sự kiện (waitUntil gọi đồng bộ): kể cả khi đã trả bản lưu vì mạng chậm,
  // bản mới về sau vẫn được lưu lại.
  e.waitUntil(
    net
      .then(async (res) => {
        if (!res.ok) return;
        const c = await caches.open(store);
        await c.put(req, res.clone());
        if (trim) await trimData(c);
      })
      .catch(() => {}),
  );
  return new Promise((resolve) => {
    let done = false;
    const fallback = async () => {
      const hit = await caches.match(req);
      if (hit && !done) {
        done = true;
        resolve(hit);
      }
      return hit;
    };
    const t = setTimeout(fallback, wait);
    net.then(
      (res) => {
        clearTimeout(t);
        if (!done) {
          done = true;
          resolve(res);
        }
      },
      async () => {
        clearTimeout(t);
        const hit = await fallback();
        if (!done) {
          done = true;
          resolve(hit || new Response('', { status: 503 }));
        }
      },
    );
  });
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      const base = self.registration.scope;
      const html = await (await fetch(base, { cache: 'reload' })).text();
      const urls = new Set([base, base + 'manifest.webmanifest', base + 'icons/icon-192.png']);
      for (const m of html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)) urls.add(new URL(m[1], base).href);
      for (const a of PRECACHE) urls.add(new URL(a, base).href);
      await cache.addAll([...urls]);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith('lat-v') && !k.startsWith(VERSION)) await caches.delete(k); // không đụng bản đồ offline (lat-map-…) và dữ liệu (lat-data)
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
    // Dữ liệu: ưu tiên bản mới; mạng chậm > 3 s hoặc mất mạng thì dùng bản đã lưu.
    e.respondWith(networkFirst(e, req, DATA, DATA_WAIT, true));
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
