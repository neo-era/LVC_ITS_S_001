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

const GO = /^(?:về|đi đến|đi tới|dẫn đường tới|dẫn đường đến|chỉ đường tới|chỉ đường đến|đến|tới)\s+(.+)$/;

/** Hiểu lệnh giọng nói tiếng Việt (nói có dấu hay máy nhận thành không dấu đều được với lệnh cố định). */
export function parseCommand(text: string): Command {
  const raw = text.normalize('NFC').toLowerCase().trim().replace(/[.!?]+$/, '');
  const f = ` ${foldName(raw)} `;
  const has = (s: string) => f.includes(` ${s} `) || f.includes(` ${s}`);
  if ((has('dung') || has('huy') || has('tat')) && has('dan duong')) return { type: 'stop_nav' };
  const go = GO.exec(raw);
  if (go) return { type: 'go_place', name: go[1].trim() };
  if (has('danh dau') && has('cam')) return { type: 'mark_camera' };
  if (has('den') && (has('tat') || has('hu') || has('hong') || has('su co') || has('chay'))) return { type: 'report_light' };
  if (has('khoa') && (has('video') || has('clip') || has('doan'))) return { type: 'dashcam_lock' };
  if (has('luu video')) return { type: 'dashcam_lock' };
  if (has('bat dau quay') || (has('quay') && has('video')) || (has('bat') && has('camera'))) return { type: 'dashcam', on: true };
  if ((has('dung') || has('tat')) && (has('quay') || has('camera'))) return { type: 'dashcam', on: false };
  if (has('tat') && has('giong')) return { type: 'voice', on: false };
  if (has('bat') && has('giong')) return { type: 'voice', on: true };
  if (has('toc do')) return { type: 'say_speed' };
  return { type: 'unknown' };
}
