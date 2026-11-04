import { fetchT } from '../core/net';
import { authHeaders, SUPABASE_URL } from '../sync';

export type ServerState = 'ok' | 'thieu' | 'tat' | 'offline';

/** Hỏi máy chủ còn chạy và đủ bảng chưa (hàm lat_health). Lỗi gì cũng không ném ra. */
export async function checkServer(online: boolean): Promise<ServerState> {
  if (!online) return 'offline';
  try {
    const res = await fetchT(`${SUPABASE_URL}/rest/v1/rpc/lat_health`, 6000, {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: '{}',
    });
    if (res.status === 404) return 'thieu';
    if (!res.ok) return 'tat';
    const j = (await res.json()) as { ok?: boolean };
    return j?.ok ? 'ok' : 'thieu';
  } catch {
    return 'tat';
  }
}

export function serverText(s: ServerState): string {
  switch (s) {
    case 'ok':
      return 'Máy chủ: đang hoạt động — gửi báo cáo, góp ý, đội xe bình thường.';
    case 'thieu':
      return 'Máy chủ: chưa cài đặt đủ — báo cáo, góp ý được lưu trên máy và gửi sau.';
    case 'tat':
      return 'Máy chủ: chưa kết nối được — báo cáo, góp ý được lưu trên máy và gửi sau.';
    case 'offline':
      return 'Máy chủ: đang ngoại tuyến — dữ liệu được lưu trên máy và gửi khi có mạng.';
  }
}
