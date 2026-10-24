import { fmtVnTime } from './reports';

/** Tin nhắn khẩn cấp. Không có vị trí thì nói rõ (không gửi toạ độ 0,0); vị trí cũ thì ghi cách đây bao lâu. */
export function sosMessage(pos: { lat: number; lng: number; t: number } | null, now: number, name: string): string {
  const head = `KHẨN CẤP: ${name || 'Tôi'} có thể vừa gặp va chạm lúc ${fmtVnTime(now)}.`;
  if (!pos) return `${head} Điện thoại chưa xác định được vị trí — hãy gọi lại ngay.`;
  const age = now - pos.t;
  const old = age > 30_000 ? ` (vị trí lúc ${fmtVnTime(pos.t).slice(-5)}, cách đây ${Math.max(1, Math.round(age / 60_000))} phút)` : '';
  return `${head} Vị trí${old}: https://www.google.com/maps?q=${pos.lat.toFixed(6)},${pos.lng.toFixed(6)}`;
}

/** Số điện thoại Việt Nam/quốc tế: 9–12 chữ số, có thể có dấu + đầu; cho phép khoảng trắng, chấm, gạch. */
export function validPhone(s: string): boolean {
  return /^\+?\d{9,12}$/.test(s.replace(/[\s.\-()]/g, ''));
}

/** Mở sẵn tin nhắn (người dùng bấm Gửi) — trình duyệt không cho tự gửi. */
export function smsUrl(phone: string, body: string): string {
  return `sms:${phone.replace(/[^\d+]/g, '')}?&body=${encodeURIComponent(body)}`;
}

/**
 * Xác nhận va chạm sau cú sốc: xe dừng hẳn (< 5 km/h) trong 8 s → kích hoạt;
 * sau 3 s xe vẫn chạy > 20 km/h (ổ gà, xe máy dằn) → bỏ qua; hết 8 s không đủ dữ liệu → kích hoạt (an toàn).
 */
export class CrashConfirm {
  private at: number | null = null;
  shock(t: number): void {
    this.at ??= t;
  }
  get pending(): boolean {
    return this.at !== null;
  }
  reset(): void {
    this.at = null;
  }
  sample(t: number, kmh: number): 'trigger' | 'cancel' | null {
    if (this.at === null) return null;
    if (kmh < 5) return this.done('trigger');
    if (t - this.at >= 3000 && kmh > 20) return this.done('cancel');
    return this.tick(t);
  }
  tick(t: number): 'trigger' | 'cancel' | null {
    if (this.at === null) return null;
    return t - this.at >= 8000 ? this.done('trigger') : null;
  }
  private done(r: 'trigger' | 'cancel'): 'trigger' | 'cancel' {
    this.at = null;
    return r;
  }
}
