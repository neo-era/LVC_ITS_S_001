/** Kết quả soi dữ liệu Củ Chi (25/10/2026): (1) cầu vượt Vành đai 3 tên "Cầu vượt Quốc lộ 22" bị áp nhầm biển QL22;
 *  (2) đường qua làng nhảy 50 ↔ 80 vì ô thưa đường bên cạnh ô dày. */
import { describe, expect, it } from 'vitest';
import { matchPosted } from '../src/pipeline/posted-limits';
import { CellWriter, URBAN_KM } from '../src/pipeline/compact';

describe('biển công bố không áp nhầm', () => {
  it('cầu vượt Vành đai 3 (ref CT.40, motorway) tên có chữ "Quốc lộ 22" → không áp biển QL22', () => {
    expect(matchPosted({ highway: 'motorway', ref: 'CT.40', name: 'Cầu vượt Quốc lộ 22' }, 10.872, 106.594)).toBeNull();
    expect(matchPosted({ highway: 'trunk', ref: 'CT.40', name: 'Cầu vượt Quốc lộ 22' }, 10.872, 106.594)).toBeNull();
  });
  it('đường không có ref, tên Quốc lộ 22 → vẫn áp', () => {
    expect(matchPosted({ highway: 'trunk', name: 'Quốc lộ 22' }, 10.872, 106.594)).toEqual({ mixed: 50, car: 60 });
  });
});

const M = 111195;
/** Rải một đường dài `km` trong ô (y, x) (ô 0,01°). */
function fill(w: CellWriter, y: number, x: number, km: number, id: number) {
  // các đoạn ngang ~0,8 km rời nhau trong ô → tổng đúng ≈ km
  const lat0 = y * 0.01 + 0.0005;
  const lng0 = x * 0.01 + 0.001;
  const seg = (0.0073 * 111195 * Math.cos((lat0 * Math.PI) / 180)) / 1000;
  const n = Math.round(km / seg);
  for (let r = 0; r < n; r++) w.addWay(id * 1000 + r, [{ lat: lat0 + r * 0.0004, lng: lng0 }, { lat: lat0 + r * 0.0004, lng: lng0 + 0.0073 }], null, 0);
}

describe('khu đông dân cư làm mượt theo ô bên cạnh', () => {
  it('ô thưa (≥ 4 km đường) nằm giữa các ô dày → coi là đô thị', () => {
    const w = new CellWriter();
    fill(w, 1090, 10655, 6, 1); // ô giữa: 6 km
    fill(w, 1090, 10654, URBAN_KM + 3, 2); // trái: dày
    fill(w, 1090, 10656, URBAN_KM + 3, 3); // phải: dày
    const files = w.files();
    expect(files.get('1090_10655')?.u).toBe(1);
  });
  it('ô thưa giữa đồng (bên cạnh không có ô dày) → vẫn ngoài đô thị', () => {
    const w = new CellWriter();
    fill(w, 1090, 10655, 6, 1);
    fill(w, 1090, 10654, 3, 2);
    expect(w.files().get('1090_10655')?.u).toBeUndefined();
  });
  it('ô gần như không có đường (đồng ruộng, cao tốc) → không bị kéo theo', () => {
    const w = new CellWriter();
    fill(w, 1090, 10655, 1.5, 1);
    fill(w, 1090, 10654, URBAN_KM + 3, 2);
    fill(w, 1090, 10656, URBAN_KM + 3, 3);
    expect(w.files().get('1090_10655')?.u).toBeUndefined();
  });
});
void M;
