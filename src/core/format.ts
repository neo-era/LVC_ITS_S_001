import type { AlertType } from './alerts';

export type SpeedState = 'unknown' | 'ok' | 'near' | 'over';

/** Trạng thái tốc độ so với giới hạn, tính theo số km/h đã làm tròn đang hiển thị. */
export function speedState(kmh: number | null, limit: number | null): SpeedState {
  if (kmh === null || limit === null || !Number.isFinite(kmh) || !Number.isFinite(limit)) return 'unknown';
  const shown = Math.round(kmh);
  if (shown > limit) return 'over';
  if (shown >= limit - 5) return 'near';
  return 'ok';
}

function roundTo10(m: number): number {
  return Math.round(m / 10) * 10;
}

const oneDecimal = (km: number) => km.toFixed(1).replace('.', ',');

/** "400 m" / "1,6 km". Giá trị âm hoặc không hợp lệ → "0 m". */
export function formatDistance(m: number): string {
  if (!Number.isFinite(m) || m < 0) return '0 m';
  const r = roundTo10(m);
  if (r < 1000) return `${r} m`;
  return `${oneDecimal(m / 1000)} km`;
}

/** Khoảng cách viết bằng chữ cho giọng đọc: "400 mét" / "1,6 ki lô mét". */
export function speakDistance(m: number): string {
  if (!Number.isFinite(m) || m < 0) return '0 mét';
  const r = roundTo10(m);
  if (r < 1000) return `${r} mét`;
  return `${oneDecimal(m / 1000)} ki lô mét`;
}

export function overspeedVoiceText(limit: number): string {
  return `Bạn đang vượt tốc độ. Giới hạn ${limit} ki lô mét trên giờ.`;
}

export function alertLabel(type: AlertType): string {
  return type === 'camera' ? 'Camera phạt nguội' : 'Điểm đen tai nạn';
}

export function alertVoiceText(type: AlertType, distM: number): string {
  const d = speakDistance(distM);
  return type === 'camera'
    ? `Phía trước ${d} có camera phạt nguội. Chú ý tốc độ.`
    : `Phía trước ${d} có điểm đen tai nạn. Chú ý quan sát.`;
}
