/** Biển tốc độ thật do cơ quan chức năng công bố cho các tuyến lớn (OSM thường thiếu), áp lúc dựng dữ liệu. */
import { describe, expect, it } from 'vitest';
import { matchPosted, POSTED_RULES } from '../src/pipeline/posted-limits';
import { CellWriter } from '../src/pipeline/compact';
import { parseCell } from '../src/core/cells';
import { limitOf } from '../src/core/speedlimit';
import { Engine } from '../src/engine';

describe('matchPosted', () => {
  it('QL22 đoạn Hóc Môn: hỗn hợp 50, làn ô tô 60 (CSGT TP.HCM 06/2024)', () => {
    expect(matchPosted({ highway: 'trunk', ref: 'QL.22', name: 'Quốc lộ 22' }, 10.872, 106.594)).toEqual({ mixed: 50, car: 60 });
    expect(matchPosted({ highway: 'trunk', ref: 'QL22' }, 10.872, 106.594)).toEqual({ mixed: 50, car: 60 });
    expect(matchPosted({ highway: 'trunk', name: 'Xa lộ Trường Chinh' }, 10.872, 106.594)).toBeNull();
  });
  it('ngoài khu vực (QL22 ở Tây Ninh) → không áp', () => {
    expect(matchPosted({ highway: 'trunk', ref: 'QL22' }, 11.2, 106.2)).toBeNull();
  });
  it('nhánh rẽ, đường dịch vụ → không áp', () => {
    expect(matchPosted({ highway: 'trunk_link', ref: 'QL22' }, 10.872, 106.594)).toBeNull();
    expect(matchPosted({ highway: 'service', name: 'Quốc lộ 22' }, 10.872, 106.594)).toBeNull();
  });
  it('Võ Văn Kiệt (QL1 → cầu Lò Gốm): hỗn hợp 60, làn ô tô 80', () => {
    expect(matchPosted({ highway: 'primary', name: 'Đại lộ Võ Văn Kiệt' }, 10.736, 106.615)).toEqual({ mixed: 60, car: 80 });
    expect(matchPosted({ highway: 'primary', name: 'Võ Văn Kiệt' }, 10.758, 106.69)).toBeNull(); // đoạn trung tâm: chưa có nguồn
  });
  it('mọi quy tắc đều ghi nguồn và ngày', () => {
    for (const r of POSTED_RULES) {
      expect(r.source.url).toMatch(/^https:\/\//);
      expect(r.source.date).toMatch(/^\d{4}-\d{2}/);
    }
  });
});

const M = 1 / 111195;
const pts = Array.from({ length: 6 }, (_, i) => ({ lat: 10.87 + i * 60 * M, lng: 106.594 }));

describe('làn ô tô trong ô dữ liệu', () => {
  const w = new CellWriter();
  w.addWay(77, pts, 50, 2, null, 60);
  const [, file] = [...w.files()][0];
  const cell = parseCell(JSON.parse(JSON.stringify(file)))!;
  it('đọc lại được giới hạn làn ô tô', () => {
    expect(cell.segments[0]).toMatchObject({ maxspeed: 50, carLane: 60 });
  });
  it('xe máy theo làn hỗn hợp; ô tô theo làn ô tô kèm ghi chú làn hỗn hợp', () => {
    expect(limitOf(cell.segments[0], 'motorbike')).toMatchObject({ kmh: 50, estimated: false });
    expect(limitOf(cell.segments[0], 'motorbike')?.note).toBeUndefined();
    expect(limitOf(cell.segments[0], 'car')).toMatchObject({ kmh: 60, estimated: false, note: 'Làn ô tô · hỗn hợp 50' });
    expect(limitOf(cell.segments[0], 'truck')).toMatchObject({ kmh: 60 });
  });
  it('Engine: xe máy 55 km/h → vượt, có cảnh báo giọng nói; ô tô 55 → không', () => {
    const run = (vehicle: 'car' | 'motorbike') => {
      const said: string[] = [];
      const e = new Engine({ radiusM: 500, speak: (t) => said.push(t), vehicle });
      e.loadData(cell);
      let v = e.view();
      for (let i = 0; i < 4; i++) v = e.push({ t: 1e6 + i * 1000, lat: pts[1].lat + i * 15 * M, lng: 106.594, speed: 55 / 3.6, accuracy: 5 }, 0);
      return { v, said };
    };
    const moto = run('motorbike');
    expect(moto.v.limit).toBe(50);
    expect(moto.v.state).toBe('over');
    expect(moto.said.length).toBeGreaterThan(0);
    const car = run('car');
    expect(car.v.limit).toBe(60);
    expect(car.v.limitNote).toBe('Làn ô tô · hỗn hợp 50');
    expect(car.v.state).not.toBe('over');
  });
});
