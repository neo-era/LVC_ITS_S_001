/** Gọi mạng có hạn giờ: quá ms thì huỷ (không để app treo khi sóng yếu). Giữ được tín hiệu huỷ từ ngoài. */
export function fetchT(url: string | URL, ms: number, init: RequestInit = {}): Promise<Response> {
  const ac = new AbortController();
  const outer = init.signal;
  const onAbort = () => ac.abort();
  if (outer) {
    if (outer.aborted) ac.abort();
    else outer.addEventListener('abort', onAbort, { once: true });
  }
  const t = setTimeout(() => ac.abort(), ms);
  return fetch(url, { ...init, signal: ac.signal }).finally(() => {
    clearTimeout(t);
    outer?.removeEventListener('abort', onAbort);
  });
}

/** Chạy fn cho từng phần tử, tối đa n việc cùng lúc; lỗi của một việc không làm dừng việc khác. */
export async function mapLimit<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const x = items[i++];
      try {
        await fn(x);
      } catch {
        /* bỏ qua, việc khác vẫn chạy */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

/** Hạn giờ dùng chung. */
export const ROUTE_MS = 10_000;
export const NET_MS = 8_000;
