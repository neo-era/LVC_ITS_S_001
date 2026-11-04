export type RunMode = 'idle' | 'gps' | 'sim';

/** Có bản mới: chưa chạy xe thì tải lại ngay; đang chạy thì chỉ nhắc (tải lại sẽ mất tuyến dẫn đường). */
export function updateAction(pending: boolean, mode: RunMode): 'none' | 'reload' | 'prompt' {
  if (!pending) return 'none';
  return mode === 'idle' ? 'reload' : 'prompt';
}

/** Gắn mã bản dựng vào VERSION của service worker (chạy lúc build). */
export function stampSw(src: string, build: string, precache: string[] = []): string {
  const re = /const VERSION = '([^']+)';/;
  if (!re.test(src)) throw new Error('sw.js thiếu dòng VERSION');
  const out = src.replace(re, (_m, v: string) => `const VERSION = '${v}-${build}';`);
  // danh sách tệp assets cần lưu sẵn (kể cả thư viện nạp động như maplibre)
  return out.replace(/const PRECACHE = \[\];/, () => `const PRECACHE = ${JSON.stringify(precache)};`);
}
