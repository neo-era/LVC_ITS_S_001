import { parseLatmapUrl } from './core';
import type { OfflineMaps } from './store';

const TJ_KEY = 'lat.ofm.tiles';
let template: Promise<string | null> | null = null;

/** Địa chỉ ô của OpenFreeMap (đổi theo phiên bản dữ liệu) — đọc từ TileJSON, nhớ lại khi mất mạng. */
function remoteTemplate(): Promise<string | null> {
  template ??= (async () => {
    try {
      const r = await fetch('https://tiles.openfreemap.org/planet', { signal: AbortSignal.timeout(5000) });
      const j = (await r.json()) as { tiles?: string[] };
      if (j.tiles?.[0]) {
        try {
          localStorage.setItem(TJ_KEY, j.tiles[0]);
        } catch {
          /* bỏ qua */
        }
        return j.tiles[0];
      }
    } catch {
      /* dùng bản đã nhớ */
    }
    try {
      return localStorage.getItem(TJ_KEY);
    } catch {
      return null;
    }
  })();
  const p = template;
  // Chưa lấy được thì không nhớ kết quả rỗng — lần sau (khi có mạng) thử lại.
  void p.then((v) => {
    if (v === null && template === p) template = null;
  });
  return p;
}

const EMPTY = new ArrayBuffer(0);


/** Giao thức latmap://z/x/y: ưu tiên bản đồ đã tải trên máy, không có thì lấy ô trực tuyến OpenFreeMap. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerLatmap(ml: any, offline: OfflineMaps): void {
  ml.addProtocol('latmap', async (params: { url: string }, ctl: AbortController) => {
    const t = parseLatmapUrl(params.url);
    if (!t) return { data: EMPTY };
    // Có mạng: ưu tiên ô trực tuyến (đủ cả vùng biên giới, nước láng giềng); lỗi thì dùng ô trên máy.
    if (navigator.onLine) {
      const tpl = await remoteTemplate();
      if (tpl) {
        try {
          const r = await fetch(tpl.replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y)), {
            signal: AbortSignal.any ? AbortSignal.any([ctl.signal, AbortSignal.timeout(6000)]) : ctl.signal,
          });
          if (r.ok) return { data: await r.arrayBuffer() };
        } catch {
          /* mất mạng giữa chừng → dùng ô trên máy */
        }
      }
    }
    const local = await offline.tile(t.z, t.x, t.y, ctl.signal);
    if (local) return { data: local };
    // Không có ô: báo lỗi (không trả ô rỗng) để khi có mạng lại, tải lại được.
    throw new Error('Chưa có ô bản đồ này trên máy');
  });
}
