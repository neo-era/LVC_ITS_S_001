/** Cấm xe tải theo thẻ OSM: hgv=no (mọi lúc) hoặc hgv:conditional="no @ (06:00-21:00)" (theo giờ). Phút trong ngày [bắt đầu, kết thúc). */
export type Windows = [number, number][];

const HM = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/;

export function parseHgv(tags: Record<string, string | undefined>): Windows | null {
  if (tags.hgv === 'no') return [[0, 1440]];
  const c = tags['hgv:conditional'];
  if (!c) return null;
  const m = /^\s*no\s*@\s*\(([^)]*)\)\s*$/.exec(c);
  if (!m) return null;
  const out: Windows = [];
  for (const part of m[1].split(',').map((s) => s.trim())) {
    const t = HM.exec(part);
    if (!t) return null; // có điều kiện ngày/khác → không tự hiểu, bỏ qua
    const s = Number(t[1]) * 60 + Number(t[2]);
    const e = Number(t[3]) * 60 + Number(t[4]);
    if (s < e) out.push([s, e]);
    else out.push([s, 1440], [0, e]);
  }
  return out.length ? out : null;
}

export function hgvBlockedAt(w: Windows, t: number): boolean {
  const d = new Date(t + 7 * 3_600_000);
  const min = d.getUTCHours() * 60 + d.getUTCMinutes();
  return w.some(([s, e]) => min >= s && min < e);
}
