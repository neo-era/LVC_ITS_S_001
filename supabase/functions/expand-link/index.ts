// Mở link rút gọn Google Maps (maps.app.goo.gl…) → URL đầy đủ + toạ độ.
// Trình duyệt không tự đọc được đích chuyển hướng (CORS), nên app gọi hàm này.
// Chỉ nhận link Google Maps; không lưu gì.
const ALLOW = /^(maps\.app\.goo\.gl|goo\.gl|g\.co|maps\.google\.[a-z.]+|(www\.)?google\.[a-z.]+|consent\.google\.[a-z.]+)$/i;
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
  'access-control-allow-methods': 'GET, OPTIONS',
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'content-type': 'application/json' } });

function coordsIn(s: string): { lat: number; lng: number } | null {
  const pats = [
    /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,
    /[?&](?:q|query|ll|center|destination)=(-?\d+\.\d+)(?:,|%2C)\s*(-?\d+\.\d+)/i,
    /@(-?\d+\.\d+),(-?\d+\.\d+)/,
    /\[null,null,(-?\d+\.\d+),(-?\d+\.\d+)\]/,
    /center=(-?\d+\.\d+)%2C(-?\d+\.\d+)/,
  ];
  for (const re of pats) {
    const m = re.exec(s);
    if (m) {
      const lat = Number(m[1]), lng = Number(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
    }
  }
  return null;
}

/** Link theo tên địa điểm (…/maps?q=Tên+nơi hoặc /maps/place/Tên/…): trả tên để app tự tìm. */
function queryIn(u: URL): string | null {
  const q = u.searchParams.get('q') ?? u.searchParams.get('query');
  if (q && !/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(q)) return q.slice(0, 200);
  const m = /\/maps\/place\/([^/@]+)/.exec(u.pathname);
  return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')).slice(0, 200) : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const u = new URL(req.url).searchParams.get('u') ?? '';
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return json({ error: 'Link không hợp lệ' }, 400);
  }
  if (url.protocol !== 'https:' || !ALLOW.test(url.hostname)) return json({ error: 'Chỉ hỗ trợ link Google Maps' }, 400);
  const ua = { 'user-agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36', 'accept-language': 'vi' };
  // đi theo chuyển hướng tối đa 6 lần, chỉ trong các tên miền Google
  for (let i = 0; i < 6; i++) {
    const res = await fetch(url, { redirect: 'manual', headers: ua });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      const next = new URL(loc, url);
      if (!ALLOW.test(next.hostname)) return json({ error: 'Link chuyển tới trang lạ' }, 400);
      // trang xin đồng ý cookie: dừng, dùng thông tin trong link trước đó
      if (/^consent\./i.test(next.hostname)) {
        const cont = next.searchParams.get('continue');
        if (cont) {
          try {
            const cu = new URL(cont);
            const c2 = coordsIn(decodeURIComponent(cu.href));
            console.log('consent', cu.href.slice(0, 300));
            if (c2) return json({ url: cu.href, ...c2 });
            return json({ url: cu.href, q: queryIn(cu) });
          } catch {
            /* bỏ qua */
          }
        }
        return json({ url: url.href, q: queryIn(url) });
      }
      url = next;
      const c = coordsIn(decodeURIComponent(url.href));
      if (c) return json({ url: url.href, ...c });
      continue;
    }
    const c = coordsIn(decodeURIComponent(url.href));
    if (c) return json({ url: url.href, ...c });
    // không có toạ độ trong URL (link theo tên địa điểm) → tìm trong trang
    const html = (await res.text()).slice(0, 2_000_000);
    const h = coordsIn(html);
    console.log('final', res.status, url.href.slice(0, 300), h ? 'coords' : 'no-coords');
    return json({ url: url.href, ...(h ?? { q: queryIn(url) }) });
  }
  return json({ error: 'Chuyển hướng quá nhiều lần' }, 400);
});
