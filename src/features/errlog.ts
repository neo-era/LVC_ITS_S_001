/** Nhật ký lỗi trên máy (A10): 20 lỗi gần nhất, không có toạ độ; đính kèm khi người dùng báo "Lỗi app". */
export interface ErrEntry {
  m: string;
  t: number;
  n: number;
}

export const ERRLOG_KEY = 'lat.errlog.v1';

export function cleanError(msg: string): string {
  return String(msg)
    .replace(/-?\d{1,3}\.\d{3,}/g, '…') // số thập phân dài (toạ độ) → bỏ
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

export function addError(list: ErrEntry[], msg: string, now: number): ErrEntry[] {
  const m = cleanError(msg);
  if (!m) return list;
  const last = list.at(-1);
  if (last && last.m === m) return [...list.slice(0, -1), { ...last, t: now, n: last.n + 1 }];
  return [...list, { m, t: now, n: 1 }].slice(-20);
}

export function errorsForReport(list: ErrEntry[]): string[] {
  return list.slice(-5).map((e) => (e.n > 1 ? `${e.m} (×${e.n})` : e.m));
}

export function parseErrors(raw: string | null): ErrEntry[] {
  try {
    const v = JSON.parse(raw ?? '[]');
    return Array.isArray(v) ? v.filter((e) => e && typeof e.m === 'string' && typeof e.t === 'number').map((e) => ({ m: e.m, t: e.t, n: Number(e.n) || 1 })) : [];
  } catch {
    return [];
  }
}
