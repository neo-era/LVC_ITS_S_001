import { angleDiff, bearing, haversine } from '../core/geo';
import { foldName } from '../pipeline/names';
import { csvCell, fmtVnTime } from './reports';

/** Tuần tra chiếu sáng: nạp danh sách trụ, chạy dọc tuyến, ghi trạng thái từng trụ, xuất báo cáo. */
export interface Pole {
  code: string;
  lat: number;
  lng: number;
  route?: string;
}
export type PoleStatus = 'sang' | 'tat' | 'hu';
export interface PatrolRecord {
  code: string;
  status: PoleStatus;
  t: number;
}
export const STATUS_LABEL: Record<PoleStatus, string> = { sang: 'Sáng', tat: 'Đèn tắt', hu: 'Hư hỏng' };

const okVN = (lat: number, lng: number) => lat >= 8 && lat <= 24 && lng >= 102 && lng <= 110;

function splitCsv(line: string, d: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === d) out.push(cur), (cur = '');
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const pickKey = (keys: string[], re: RegExp) => keys.findIndex((k) => re.test(foldName(k)));
const CODE = /^(ma|ma tru|ma so|code|id|ten tru|so hieu|so hieu tru|name|ten)$/;
const LAT = /^(vi do|lat|latitude|y)$/;
const LNG = /^(kinh do|lng|lon|long|longitude|x)$/;
const ROUTE = /^(tuyen|duong|ten duong|route|street)$/;

export function parsePoles(text: string): Pole[] {
  const t = text.replace(/^﻿/, '').trim();
  if (t.startsWith('{')) {
    try {
      const fc = JSON.parse(t) as { features?: { geometry?: { type?: string; coordinates?: number[] }; properties?: Record<string, unknown> }[] };
      const out: Pole[] = [];
      for (const f of fc.features ?? []) {
        if (f.geometry?.type !== 'Point' || !Array.isArray(f.geometry.coordinates)) continue;
        const [lng, lat] = f.geometry.coordinates;
        const props = f.properties ?? {};
        const keys = Object.keys(props);
        const ck = keys[pickKey(keys, /^(ma tru|ma|code|id|so hieu|ten tru|name|ten)$/)];
        const rk = keys[pickKey(keys, ROUTE)];
        const code = ck ? String(props[ck] ?? '').trim().slice(0, 60) : '';
        if (!code || !okVN(lat, lng)) continue;
        out.push({ code, lat, lng, ...(rk && props[rk] ? { route: String(props[rk]) } : {}) });
      }
      return out;
    } catch {
      return [];
    }
  }
  const lines = t.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const d = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const head = splitCsv(lines[0], d);
  const ci = pickKey(head, CODE);
  const la = pickKey(head, LAT);
  const lo = pickKey(head, LNG);
  const ro = pickKey(head, ROUTE);
  if (ci < 0 || la < 0 || lo < 0) return [];
  const out: Pole[] = [];
  for (const l of lines.slice(1)) {
    const c = splitCsv(l, d);
    const lat = Number(c[la]?.replace(',', '.'));
    const lng = Number(c[lo]?.replace(',', '.'));
    const code = (c[ci] ?? '').slice(0, 60);
    if (!code || !Number.isFinite(lat) || !Number.isFinite(lng) || !okVN(lat, lng)) continue;
    out.push({ code, lat, lng, ...(ro >= 0 && c[ro] ? { route: c[ro] } : {}) });
  }
  return out;
}

/** Trụ chưa kiểm gần nhất phía trước (±60° theo hướng đi), trong maxM mét. */
export function nextPole(
  poles: Pole[],
  pos: { lat: number; lng: number },
  heading: number | null,
  checked: Set<string>,
  maxM = 80,
): { pole: Pole; distM: number } | null {
  let best: { pole: Pole; distM: number } | null = null;
  for (const p of poles) {
    if (checked.has(p.code)) continue;
    const d = haversine(pos, p);
    if (d > maxM) continue;
    if (heading !== null && d > 8 && angleDiff(heading, bearing(pos, p)) > 60) continue;
    if (!best || d < best.distM) best = { pole: p, distM: d };
  }
  return best;
}

export function patrolCsv(poles: Pole[], records: PatrolRecord[]): string {
  const last = new Map<string, PatrolRecord>();
  for (const r of records) last.set(r.code, r);
  const rows = [['STT', 'Mã trụ', 'Tuyến', 'Trạng thái', 'Thời điểm', 'Vĩ độ', 'Kinh độ']];
  poles.forEach((p, i) => {
    const r = last.get(p.code);
    rows.push([String(i + 1), p.code, p.route ?? '', r ? STATUS_LABEL[r.status] : 'Chưa kiểm', r ? fmtVnTime(r.t) : '', p.lat.toFixed(6), p.lng.toFixed(6)]);
  });
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Mã trụ bị trùng trong danh sách (mỗi mã chỉ ghi được một kết quả). */
export function dupCodes(poles: Pole[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const p of poles) (seen.has(p.code) ? dup : seen).add(p.code);
  return [...dup];
}

/**
 * Chọn trụ hiển thị, "dính" trụ đang hiện: khi đã tới gần (< 30 m) thì giữ trụ đó thêm 4 s kể từ lần cuối còn
 * gần (miễn xe chưa cách nó > 60 m), để tài xế bấm đúng trụ vừa nhìn. Trụ đã bấm thì chuyển ngay.
 */
export class PoleTracker {
  private cur: Pole | null = null;
  private nearAt = -Infinity;
  update(poles: Pole[], pos: { lat: number; lng: number }, heading: number | null, checked: Set<string>, t: number): { pole: Pole; distM: number } | null {
    if (this.cur && !checked.has(this.cur.code)) {
      const d = haversine(pos, this.cur);
      if (d < 30) this.nearAt = t;
      if (t - this.nearAt < 4000 && d <= 60) return { pole: this.cur, distM: d };
    }
    const next = nextPole(poles, pos, heading, checked);
    if (next?.pole !== this.cur) {
      this.cur = next?.pole ?? null;
      this.nearAt = next && next.distM < 30 ? t : -Infinity;
    }
    return next;
  }
  reset(): void {
    this.cur = null;
    this.nearAt = -Infinity;
  }
}
