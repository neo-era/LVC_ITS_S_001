import { describe, expect, it } from 'vitest';
import { foldName, NameIndex, nameShardKey, shardsAround } from '../src/pipeline/names';
import { parseNameShard, searchLocal } from '../src/nav/localsearch';

describe('foldName', () => {
  it.each([
    ['Liên Khu 16-18', 'lien khu 16 18'],
    ['Đường Nguyễn  Huệ', 'duong nguyen hue'],
    ['  Quốc lộ 1A ', 'quoc lo 1a'],
  ])('%s → %s', (a, b) => expect(foldName(a)).toBe(b));
});

describe('NameIndex', () => {
  it('gộp các đoạn cùng tên gần nhau thành một mục, giữ mục cùng tên ở nơi xa', () => {
    const ix = new NameIndex();
    ix.add('Liên Khu 16-18', 10.7601, 106.6001, 's');
    ix.add('Liên Khu 16-18', 10.7605, 106.6003, 's'); // cùng đường, đoạn khác
    ix.add('Liên Khu 16-18', 21.03, 105.85, 's'); // trùng tên ở Hà Nội
    const files = ix.files();
    const all = [...files.values()].flat();
    expect(all).toHaveLength(2);
    expect(files.get(nameShardKey(10.76, 106.6))).toHaveLength(1);
  });
  it('bỏ tên rỗng hoặc toạ độ hỏng', () => {
    const ix = new NameIndex();
    ix.add('', 10.7, 106.6, 's');
    ix.add('A', Number.NaN, 106.6, 's');
    expect(ix.files().size).toBe(0);
  });
});

describe('shardsAround', () => {
  it('3×3 mảnh quanh vị trí', () => {
    const k = shardsAround(10.76, 106.6);
    expect(k).toHaveLength(9);
    expect(k).toContain(nameShardKey(10.76, 106.6));
  });
});

describe('searchLocal', () => {
  const ix = new NameIndex();
  ix.add('Liên Khu 16-18', 10.7601, 106.6001, 's');
  ix.add('Liên Khu 4-5', 10.765, 106.61, 's');
  ix.add('Hẻm 45 Liên Khu 16-18', 10.761, 106.601, 's');
  ix.add('Liên Khu 16-18', 21.03, 105.85, 's');
  ix.add('Bình Trị Đông', 10.765, 106.61, 'p');
  const entries = [...ix.files().values()].flatMap((rows) => parseNameShard(rows));
  const here = { lat: 10.76, lng: 106.6 };

  it('gõ không dấu, có gạch nối hay không đều ra; tên khớp đúng lên trước, gần vị trí lên trước', () => {
    for (const q of ['lien khu 16-18', 'Liên khu 16 18', 'LIEN KHU 16-18']) {
      const r = searchLocal(entries, q, here);
      expect(r[0].name).toBe('Liên Khu 16-18');
      expect(r[0].lat).toBeCloseTo(10.7601, 3);
    }
  });
  it('tất cả từ khoá phải có trong tên', () => {
    const r = searchLocal(entries, 'lien khu 4', here);
    expect(r.map((x) => x.name)).toEqual(['Liên Khu 4-5']);
  });
  it('địa danh (phường, khu) cũng tìm được, ghi rõ loại và khoảng cách', () => {
    const r = searchLocal(entries, 'binh tri dong', here);
    expect(r[0].name).toBe('Bình Trị Đông');
    expect(r[0].detail).toMatch(/Khu vực/);
    expect(r[0].detail).toMatch(/km|m$/);
  });
  it('chuỗi rỗng hoặc quá ngắn → rỗng; không vượt giới hạn số kết quả', () => {
    expect(searchLocal(entries, ' ', here)).toEqual([]);
    expect(searchLocal(entries, 'l', here, 2).length).toBeLessThanOrEqual(2);
  });
  it('parseNameShard bỏ dòng hỏng', () => {
    expect(parseNameShard([['A', 1076000, 10660000, 's'], ['B', 'x', 1, 's'], 5] as unknown[])).toHaveLength(1);
  });
});
