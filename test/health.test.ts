// A7: trạng thái máy chủ hiển thị rõ cho người dùng.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkServer, serverText } from '../src/features/health';

afterEach(() => vi.unstubAllGlobals());

describe('checkServer', () => {
  it('máy chủ chạy, đủ bảng → ok', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ ok: true, v: 1 }), { status: 200 }));
    expect(await checkServer(true)).toBe('ok');
  });
  it('thiếu bảng → thieu', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ ok: false }), { status: 200 }));
    expect(await checkServer(true)).toBe('thieu');
  });
  it('chưa có hàm (404) → thieu', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    expect(await checkServer(true)).toBe('thieu');
  });
  it('máy chủ tạm dừng/lỗi mạng → tat', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await checkServer(true)).toBe('tat');
    vi.stubGlobal('fetch', async () => new Response('', { status: 540 }));
    expect(await checkServer(true)).toBe('tat');
  });
  it('máy đang ngoại tuyến → offline (không gọi mạng)', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect(await checkServer(false)).toBe('offline');
    expect(f).not.toHaveBeenCalled();
  });
  it('lời hiển thị', () => {
    expect(serverText('ok')).toMatch(/hoạt động/);
    expect(serverText('tat')).toMatch(/chưa kết nối/i);
    expect(serverText('offline')).toMatch(/ngoại tuyến/i);
  });
});
