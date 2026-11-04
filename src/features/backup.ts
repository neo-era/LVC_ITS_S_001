/** Sao lưu / khôi phục dữ liệu người dùng (A11): một tệp JSON chứa các mục lat.* trong localStorage. */
// Không sao lưu: mã thiết bị (tránh hai máy trùng mã), chỉ mục bản đồ offline (gắn với bộ nhớ máy), trạng thái tạm.
const SKIP = new Set(['lat.device', 'lat.offline.v1', 'lat.ofm.tiles', 'lat.trip.live', 'lat.share', 'lat.errlog.v1']);
const ok = (k: string) => k.startsWith('lat.') && !SKIP.has(k);

export interface KV {
  keys: () => string[];
  get: (k: string) => string | null;
}

export function makeBackup(kv: KV, now: number): string {
  const data: Record<string, string> = {};
  for (const k of kv.keys()) {
    const v = kv.get(k);
    if (ok(k) && v !== null) data[k] = v;
  }
  return JSON.stringify({ app: 'lai-an-toan', v: 1, at: now, data });
}

export function readBackup(text: string): { ok: true; at: number; entries: Record<string, string> } | { ok: false; reason: string } {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'Tệp không phải bản sao lưu Lái An Toàn.' };
  }
  const o = j as { app?: unknown; at?: unknown; data?: unknown };
  if (!o || o.app !== 'lai-an-toan' || typeof o.data !== 'object' || o.data === null) return { ok: false, reason: 'Tệp không phải bản sao lưu Lái An Toàn.' };
  const entries: Record<string, string> = {};
  for (const [k, v] of Object.entries(o.data as Record<string, unknown>)) if (ok(k) && typeof v === 'string' && v.length < 5_000_000) entries[k] = v;
  return { ok: true, at: typeof o.at === 'number' ? o.at : 0, entries };
}
