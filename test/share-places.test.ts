import { describe, expect, it } from 'vitest';
import { placesShareUrl, parseSharedPlaces, placeShareText, type SavedPlace } from '../src/features/places';

const BASE = 'https://neo-era.github.io/LVC_ITS_S_001/';
const P: SavedPlace[] = [
  { name: 'Kho Củ Chi', lat: 11.06176, lng: 106.529633 },
  { name: 'Nhà Anh Hùng CT', lat: 10.962983, lng: 106.588974 },
];

describe('chia sẻ điểm đã lưu', () => {
  it('một điểm: link mở app + link Google Maps', () => {
    const t = placeShareText(BASE, P[0]);
    expect(t).toContain('Kho Củ Chi');
    expect(t).toContain('https://www.google.com/maps?q=11.06176,106.52963');
    expect(t).toContain(BASE + '?diem=');
  });
  it('đọc lại đúng tên và toạ độ (làm tròn 5 chữ số), cả danh sách', () => {
    const url = new URL(placesShareUrl(BASE, P));
    const back = parseSharedPlaces(url.search);
    expect(back).toEqual([
      { name: 'Kho Củ Chi', lat: 11.06176, lng: 106.52963 },
      { name: 'Nhà Anh Hùng CT', lat: 10.96298, lng: 106.58897 },
    ]);
  });
  it('link hỏng / ngoài Việt Nam / tên rỗng → bỏ', () => {
    expect(parseSharedPlaces('?diem=@@@')).toEqual([]);
    expect(parseSharedPlaces('?x=1')).toEqual([]);
    const bad = new URL(placesShareUrl(BASE, [{ name: 'Paris', lat: 48.85, lng: 2.35 }, { name: ' ', lat: 10.8, lng: 106.6 }, P[0]]));
    expect(parseSharedPlaces(bad.search).map((p) => p.name)).toEqual(['Kho Củ Chi']);
  });
  it('tối đa 30 điểm, tên ≤ 40 ký tự', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ name: `Điểm ${i} ${'x'.repeat(50)}`, lat: 10.8, lng: 106.6 + i / 1000 }));
    const back = parseSharedPlaces(new URL(placesShareUrl(BASE, many)).search);
    expect(back).toHaveLength(30);
    expect(back[0].name.length).toBeLessThanOrEqual(40);
  });
});
