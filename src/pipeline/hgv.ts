/** Cấm xe tải theo thẻ OSM: hgv=no (mọi lúc) hoặc hgv:conditional="no @ (06:00-21:00)" (theo giờ). Phút trong ngày [bắt đầu, kết thúc). */
export type Windows = [number, number][];

const HM = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/;

function windows(spec: string): Windows | null {
  const out: Windows = [];
  for (const part of spec.split(',').map((s) => s.trim())) {
    const t = HM.exec(part);
    if (!t) return null; // có điều kiện ngày/khác → không tự hiểu, bỏ qua
    const s = Number(t[1]) * 60 + Number(t[2]);
    const e = Number(t[3]) * 60 + Number(t[4]);
    if (s < e) out.push([s, e]);
    else out.push([s, 1440], [0, e]);
  }
  return out.length ? out : null;
}

/** Phần bù của các khung giờ trong ngày (ghép đoạn liền nhau). */
function complement(w: Windows): Windows {
  const sorted = [...w].sort((a, b) => a[0] - b[0]);
  const out: Windows = [];
  let cur = 0;
  for (const [s, e] of sorted) {
    if (s > cur) out.push([cur, s]);
    cur = Math.max(cur, e);
  }
  if (cur < 1440) out.push([cur, 1440]);
  return out;
}

export function parseHgv(tags: Record<string, string | undefined>): Windows | null {
  const c = tags['hgv:conditional'];
  if (tags.hgv === 'no') {
    // hgv=no + "yes @ (21:00-06:00)": chỉ được chạy trong giờ đó → cấm phần còn lại
    const y = c ? /^\s*yes\s*@\s*\(([^)]*)\)\s*$/.exec(c) : null;
    const allow = y ? windows(y[1]) : null;
    return allow ? complement(allow) : [[0, 1440]];
  }
  if (!c) return null;
  const m = /^\s*no\s*@\s*\(([^)]*)\)\s*$/.exec(c);
  return m ? windows(m[1]) : null;
}

export function hgvBlockedAt(w: Windows, t: number): boolean {
  const d = new Date(t + 7 * 3_600_000);
  const min = d.getUTCHours() * 60 + d.getUTCMinutes();
  return w.some(([s, e]) => min >= s && min < e);
}
