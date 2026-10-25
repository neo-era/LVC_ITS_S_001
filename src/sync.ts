import type { Mark } from './marks';

/**
 * Dự án Supabase "lai-an-toan". Khoá anon là khoá CÔNG KHAI theo thiết kế của Supabase;
 * quyền thật được giới hạn bằng RLS (chỉ gửi dấu mới và đọc dấu đã duyệt) — xem supabase/lat_camera_marks.sql.
 */
export const SUPABASE_URL = 'https://xiqkdrlhkmalpafdtplc.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhpcWtkcmxoa21hbHBhZmR0cGxjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI4MjMyMjksImV4cCI6MjEwODM5OTIyOX0.K-sQ7I8OmhehmvekAt-ob6UVZ4zvP8I24EWYlriDg1E';

const TABLE = 'lat_camera_marks';
const CHUNK = 100;

export const insertUrl = (): string => `${SUPABASE_URL}/rest/v1/${TABLE}?on_conflict=id`;

export function approvedUrl(offset: number, limit: number): string {
  const u = new URL(`${SUPABASE_URL}/rest/v1/${TABLE}`);
  u.searchParams.set('select', 'id,type,lat,lng,dir');
  u.searchParams.set('status', 'eq.duyet');
  u.searchParams.set('order', 'id');
  u.searchParams.set('offset', String(offset));
  u.searchParams.set('limit', String(limit));
  return u.toString();
}

export const authHeaders = (): Record<string, string> => ({
  apikey: SUPABASE_ANON_KEY,
  authorization: `Bearer ${SUPABASE_ANON_KEY}`,
});

export function buildInsertRows(marks: Mark[], device: string) {
  return marks.map((m) => ({
    id: m.id,
    type: m.type,
    lat: m.lat,
    lng: m.lng,
    dir: m.dir ?? null,
    device,
    t_client: m.t,
  }));
}

/** Gửi các dấu lên Supabase (gửi lại dấu đã có thì bị bỏ qua, nên an toàn khi thử lại). Trả danh sách id đã gửi. */
export async function pushMarks(device: string, marks: Mark[]): Promise<string[]> {
  const sent: string[] = [];
  for (let i = 0; i < marks.length; i += CHUNK) {
    const part = marks.slice(i, i + CHUNK);
    const res = await fetch(insertUrl(), {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'content-type': 'application/json',
        prefer: 'resolution=ignore-duplicates,return=minimal',
      },
      body: JSON.stringify(buildInsertRows(part, device)),
    });
    if (!res.ok) throw new Error(`Máy chủ trả lỗi ${res.status}`);
    sent.push(...part.map((m) => m.id));
  }
  return sent;
}

/** Rút (xoá) các dấu do chính máy này đã gửi mà chưa được duyệt — qua hàm lat_mark_withdraw. */
export function withdrawBody(ids: string[], device: string) {
  return { p_ids: ids, p_device: device };
}

/** Gộp id cần rút vào hàng chờ (không trùng, giữ 200 mục mới nhất) để gửi lại khi có mạng. */
export function queueWithdraw(queue: string[], ids: string[]): string[] {
  const out = [...queue];
  for (const id of ids) if (!out.includes(id)) out.push(id);
  return out.slice(Math.max(0, out.length - 200));
}

export async function withdrawMarks(device: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/lat_mark_withdraw`, {
    method: 'POST',
    headers: { ...authHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify(withdrawBody(ids, device)),
  });
  if (!res.ok) throw new Error(`Máy chủ trả lỗi ${res.status}`);
}
