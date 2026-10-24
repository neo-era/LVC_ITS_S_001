import type { Mark } from './marks';

/** Chỉ cho phép địa chỉ web app của Google Apps Script (https). */
export function isValidSyncUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' && url.hostname === 'script.google.com';
  } catch {
    return false;
  }
}

export function parseSyncResponse(raw: unknown): string[] {
  if (typeof raw !== 'object' || raw === null) throw new Error('Phản hồi không hợp lệ');
  const r = raw as { ok?: unknown; saved?: unknown; error?: unknown };
  if (r.ok !== true || !Array.isArray(r.saved)) throw new Error(typeof r.error === 'string' ? r.error : 'Máy chủ từ chối');
  return r.saved.filter((x): x is string => typeof x === 'string');
}

/** Gửi các dấu lên Apps Script. Dùng text/plain để không bị yêu cầu tiền kiểm CORS. */
export async function pushMarks(url: string, device: string, marks: Mark[]): Promise<string[]> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ device, marks: marks.map(({ id, type, lat, lng, dir, t }) => ({ id, type, lat, lng, dir, t })) }),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`Máy chủ trả lỗi ${res.status}`);
  return parseSyncResponse(await res.json());
}
