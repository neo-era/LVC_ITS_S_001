import { fmtVnTime } from './reports';

export function sosMessage(lat: number, lng: number, t: number, name: string): string {
  return `KHẨN CẤP: ${name || 'Tôi'} có thể vừa gặp va chạm lúc ${fmtVnTime(t)}. Vị trí: https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

/** Mở sẵn tin nhắn (người dùng bấm Gửi) — trình duyệt không cho tự gửi. */
export function smsUrl(phone: string, body: string): string {
  return `sms:${phone.replace(/[^\d+]/g, '')}?&body=${encodeURIComponent(body)}`;
}
