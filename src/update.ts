export type RunMode = 'idle' | 'gps' | 'sim';

/** Có bản mới: chưa chạy xe thì tải lại ngay; đang chạy thì chỉ nhắc (tải lại sẽ mất tuyến dẫn đường). */
export function updateAction(pending: boolean, mode: RunMode): 'none' | 'reload' | 'prompt' {
  if (!pending) return 'none';
  return mode === 'idle' ? 'reload' : 'prompt';
}

/** Gắn mã bản dựng vào VERSION của service worker (chạy lúc build). */
export function stampSw(src: string, build: string): string {
  const re = /const VERSION = '([^']+)';/;
  if (!re.test(src)) throw new Error('sw.js thiếu dòng VERSION');
  return src.replace(re, (_m, v: string) => `const VERSION = '${v}-${build}';`);
}
