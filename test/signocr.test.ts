import { describe, expect, it } from 'vitest';
import { findRedCircles, segmentDigits, SignVoter } from '../src/features/signocr';

function img(w: number, h: number, paint: (x: number, y: number) => [number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = paint(x, y);
      const i = (y * w + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  return { width: w, height: h, data };
}

describe('findRedCircles', () => {
  it('thấy vòng đỏ, bỏ hình đỏ đặc và vệt đỏ dài', () => {
    const im = img(200, 120, (x, y) => {
      const d1 = Math.hypot(x - 50, y - 60);
      if (d1 > 28 && d1 < 36) return [220, 30, 30]; // vòng
      if (x > 110 && x < 150 && y > 40 && y < 80) return [220, 30, 30]; // khối đặc
      if (y > 100 && y < 104 && x > 10 && x < 190) return [220, 30, 30]; // vệt dài
      return [240, 240, 240];
    });
    const b = findRedCircles(im);
    expect(b).toHaveLength(1);
    expect(Math.abs(b[0].x + b[0].w / 2 - 50)).toBeLessThan(4);
  });
  it('ảnh không có đỏ → rỗng', () => {
    expect(findRedCircles(img(60, 60, () => [200, 200, 200]))).toEqual([]);
  });
});

describe('segmentDigits', () => {
  it('tách hai khối nét thành hai hộp', () => {
    const w = 40, h = 20;
    const bin = new Uint8Array(w * h);
    for (let y = 2; y < 18; y++) for (const x of [5, 6, 7, 8, 20, 21, 22, 23, 24]) bin[y * w + x] = 1;
    const b = segmentDigits(bin, w, h);
    expect(b).toHaveLength(2);
    expect(b[0]).toMatchObject({ x: 5, w: 4 });
  });
});

describe('SignVoter', () => {
  it('cần thấy 2 lần trong 4 khung', () => {
    const v = new SignVoter();
    expect(v.push(60)).toBeNull();
    expect(v.push(null)).toBeNull();
    expect(v.push(60)).toBe(60);
    expect(v.push(50)).toBeNull();
  });
});
