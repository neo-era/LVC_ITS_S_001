/**
 * Bù số hiển thị cho khớp đồng hồ xe. Đồng hồ ô tô/xe máy luôn báo CAO hơn tốc độ thật vài %;
 * GPS đo tốc độ thật. Chỉ đổi SỐ HIỂN THỊ — cảnh báo vượt tốc độ vẫn tính theo tốc độ thật
 * (camera bắn tốc độ đo tốc độ thật).
 */
export const SPEED_CAL_OPTIONS = [0, 3, 5, 8, 10] as const;

let pct = 0;

export function setSpeedCal(p: number): void {
  pct = (SPEED_CAL_OPTIONS as readonly number[]).includes(p) ? p : 0;
}

export function speedCal(): number {
  return pct;
}

/** Số km/h hiển thị (đã làm tròn); '--' khi chưa có tốc độ. 0 vẫn là 0. */
export function shownSpeed(kmh: number | null, p = pct): string {
  if (kmh === null || !Number.isFinite(kmh)) return '--';
  return String(Math.round(kmh * (1 + p / 100)));
}
