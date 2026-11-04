/** Logic màn lái xe (Đợt C, phương án C): khoá thao tác, dải lỗi, vượt tốc 3 mức, dải đáy. */

/** C5: trên 10 km/h khoá gõ chữ / cài đặt, trừ khi người ngồi cạnh xác nhận. */
export const driveLocked = (kmh: number | null, passenger: boolean) => !passenger && kmh !== null && kmh > 10;

/** C8: 0 = không vượt; 1 = +1–5; 2 = +6–10; 3 = vượt hơn 10 km/h. */
export function overTier(kmh: number | null, limit: number | null): 0 | 1 | 2 | 3 {
  if (kmh === null || limit === null) return 0;
  const d = Math.round(kmh) - limit;
  if (d <= 0) return 0;
  if (d <= 5) return 1;
  if (d <= 10) return 2;
  return 3;
}

export interface BannerIn {
  gpsLostMs: number;
  online: boolean;
  navigating: boolean;
  rerouteFailed: boolean;
}
export type Banner = { kind: 'gps' | 'reroute' | 'offline'; text: string };

/** C6: chọn một dải báo lỗi theo mức ưu tiên. */
export function pickBanner(s: BannerIn): Banner | null {
  if (s.gpsLostMs > 3000) return { kind: 'gps', text: 'Mất tín hiệu GPS — tốc độ và cảnh báo tạm dừng' };
  if (s.navigating && s.rerouteFailed) return { kind: 'reroute', text: 'Chưa tìm được đường mới' };
  if (s.navigating && !s.online) return { kind: 'offline', text: 'Mất mạng — vẫn dẫn theo tuyến đã tải' };
  return null;
}

/** Tên điểm đến: toạ độ thô → "Điểm đã chọn". */
export function destLabel(name: string | null | undefined): string {
  const n = (name ?? '').trim();
  if (!n || /^t[oọ][aạ]\s*độ(\s|$)/i.test(n) || /^-?\d{1,3}[.,]\d+\s*,\s*-?\d{1,3}[.,]\d+$/.test(n)) return 'Điểm đã chọn';
  return n;
}

/** Giờ đến dự kiến (giờ Việt Nam, HH:MM). */
export function etaClock(now: number, remainS: number): string {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(now + remainS * 1000));
  return p;
}

const km = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);

/** "7,1 km · 13 phút" */
export function stripText(remainM: number, remainS: number): string {
  return `${km(remainM)} · ${Math.max(1, Math.round(remainS / 60))} phút`;
}
