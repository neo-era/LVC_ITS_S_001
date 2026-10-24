import { foldName } from '../pipeline/names';

export type Command =
  | { type: 'mark_camera' }
  | { type: 'report_light' }
  | { type: 'go_place'; name: string }
  | { type: 'stop_nav' }
  | { type: 'voice'; on: boolean }
  | { type: 'dashcam'; on: boolean }
  | { type: 'dashcam_lock' }
  | { type: 'say_speed' }
  | { type: 'unknown' };

const GO = /^(?:(?:chạy|đi|dẫn đường|chỉ đường)\s+)?(?:về|đến|tới)\s+(.+)$/;
const NOT_A_PLACE = /\b(đâu|rồi|chưa|bao giờ|mấy giờ|không)\b/;

/** Hiểu lệnh giọng nói tiếng Việt. So trên chữ còn dấu với các từ dễ nhầm (đèn/đến); các từ khác so nguyên từ không dấu. */
export function parseCommand(text: string): Command {
  const raw = text.normalize('NFC').toLowerCase().trim().replace(/[.!?]+$/, '');
  const words = new Set(foldName(raw).split(' ').filter(Boolean));
  const rawWords = new Set(raw.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean));
  const f = ` ${foldName(raw)} `;
  const has = (s: string) => (s.includes(' ') ? f.includes(` ${s} `) : words.has(s));
  const hasRaw = (s: string) => rawWords.has(s);
  const off = has('dung') || has('tat') || has('huy') || has('ngung');

  if (off && has('dan duong')) return { type: 'stop_nav' };
  if (off && (has('quay') || has('camera') || has('video'))) return { type: 'dashcam', on: false };
  if (has('tat') && has('giong')) return { type: 'voice', on: false };
  if (has('bat') && has('giong')) return { type: 'voice', on: true };
  if (hasRaw('đèn') && (has('tat') || has('hu') || has('hong') || has('su co'))) {
    // "tắt đèn" là lệnh tắt, không phải báo đèn tắt; "đèn tắt" / "báo đèn hư" mới là báo cáo
    if (/^tắt\s+đèn/.test(raw)) return { type: 'unknown' };
    return { type: 'report_light' };
  }
  const go = GO.exec(raw);
  if (go && !NOT_A_PLACE.test(go[1]) && !off) return { type: 'go_place', name: go[1].trim() };
  if (has('danh dau') && (has('cam') || has('camera'))) return { type: 'mark_camera' };
  if (has('khoa') && (has('video') || has('clip') || has('doan'))) return { type: 'dashcam_lock' };
  if (has('luu video')) return { type: 'dashcam_lock' };
  if (has('bat dau quay') || (has('quay') && has('video')) || (has('bat') && has('camera'))) return { type: 'dashcam', on: true };
  if (has('toc do')) return { type: 'say_speed' };
  return { type: 'unknown' };
}
