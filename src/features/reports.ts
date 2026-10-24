/** Báo đèn tắt / sự cố chiếu sáng ghi ngay từ xe. */
export type ReportKind = 'den_tat' | 'su_co' | 'ngap';
export interface Report {
  id: string;
  kind: ReportKind;
  lat: number;
  lng: number;
  dir?: number;
  t: number;
  /** Mã trụ (khi báo từ tuần tra hoặc quét QR). */
  pole?: string;
  synced?: boolean;
  /** Máy chủ từ chối (dữ liệu không hợp lệ) — không gửi lại, vẫn xuất CSV được. */
  rejected?: boolean;
}

export const REPORT_LABEL: Record<ReportKind, string> = { den_tat: 'Đèn tắt', su_co: 'Sự cố chiếu sáng', ngap: 'Đường ngập' };

export function parseReports(raw: unknown): Report[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (r): r is Report =>
      !!r &&
      typeof r.id === 'string' &&
      (r.kind === 'den_tat' || r.kind === 'su_co' || r.kind === 'ngap') &&
      typeof r.lat === 'number' &&
      typeof r.lng === 'number' &&
      r.lat >= 8 &&
      r.lat <= 24 &&
      r.lng >= 102 &&
      r.lng <= 110 &&
      typeof r.t === 'number',
  );
}

export function fmtVnTime(t: number): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Ho_Chi_Minh',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .formatToParts(new Date(t))
      .map((x) => [x.type, x.value]),
  );
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

/** Một ô CSV: chặn công thức Excel (= + - @ đầu ô) và đặt ngoặc kép khi cần. */
export function csvCell(c: string): string {
  const v = /^[=+\-@\t\r]/.test(c) && !/^-?\d+([.,]\d+)?$/.test(c) ? `'${c}` : c;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** CSV mở thẳng bằng Excel (UTF-8 có BOM), có link bản đồ từng điểm. */
export function reportsToCsv(list: Report[]): string {
  const rows = [['STT', 'Loại', 'Mã trụ', 'Thời điểm', 'Vĩ độ', 'Kinh độ', 'Hướng', 'Bản đồ']];
  list.forEach((r, i) => {
    const lat = r.lat.toFixed(6);
    const lng = r.lng.toFixed(6);
    rows.push([String(i + 1), REPORT_LABEL[r.kind], r.pole ?? '', fmtVnTime(r.t), lat, lng, r.dir === undefined ? '' : String(r.dir), `https://www.google.com/maps?q=${lat},${lng}`]);
  });
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
