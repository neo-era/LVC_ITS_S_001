import { describe, expect, it } from 'vitest';
import { Guidance } from '../src/nav/guidance';
import { parsePhoton } from '../src/nav/geocode';
import { decodePolyline, encodePolyline } from '../src/nav/polyline';
import { buildRouteBody, parseValhalla, type Route } from '../src/nav/route';

describe('polyline', () => {
  it('mã hoá rồi giải mã (độ chính xác 6) cho lại điểm cũ', () => {
    const pts = [
      { lat: 10.776889, lng: 106.700806 },
      { lat: 10.78, lng: 106.69 },
      { lat: 10.79, lng: 106.7 },
    ];
    const back = decodePolyline(encodePolyline(pts, 6), 6);
    expect(back).toHaveLength(3);
    back.forEach((p, i) => {
      expect(p.lat).toBeCloseTo(pts[i].lat, 6);
      expect(p.lng).toBeCloseTo(pts[i].lng, 6);
    });
  });
  it('ví dụ chuẩn của Google (độ chính xác 5)', () => {
    const d = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5);
    expect(d[0]).toEqual({ lat: 38.5, lng: -120.2 });
    expect(d[2].lat).toBeCloseTo(43.252, 5);
  });
  it('chuỗi rỗng hoặc cụt không làm hỏng', () => {
    expect(decodePolyline('', 6)).toEqual([]);
    expect(() => decodePolyline('_p~iF~', 6)).not.toThrow();
  });
});

const M = 111195;
const BASE = { lat: 10.77, lng: 106.7 };
const north = (m: number) => ({ lat: BASE.lat + m / M, lng: BASE.lng });

function valhallaFixture() {
  const pts = [north(0), north(500), north(1000), north(1500)];
  return {
    trip: {
      summary: { length: 1.5, time: 180 },
      legs: [
        {
          shape: encodePolyline(pts, 6),
          maneuvers: [
            { type: 1, instruction: 'Đi về hướng bắc trên đường A.', verbal_pre_transition_instruction: 'Đi về hướng bắc trên đường A.', begin_shape_index: 0, length: 0.5, time: 60 },
            { type: 10, instruction: 'Rẽ phải vào đường B.', verbal_pre_transition_instruction: 'Rẽ phải vào đường B.', begin_shape_index: 1, length: 1.0, time: 120 },
            { type: 4, instruction: 'Bạn đã đến nơi.', verbal_pre_transition_instruction: 'Bạn đã đến nơi.', begin_shape_index: 3, length: 0, time: 0 },
          ],
        },
      ],
    },
  };
}

describe('parseValhalla', () => {
  it('đọc tuyến: điểm, bước rẽ (mét), tổng quãng đường và thời gian', () => {
    const r = parseValhalla(valhallaFixture())!;
    expect(r.points).toHaveLength(4);
    expect(r.distM).toBe(1500);
    expect(r.durS).toBe(180);
    expect(r.maneuvers.map((m) => [m.text, m.startIdx, m.lenM])).toEqual([
      ['Đi về hướng bắc trên đường A.', 0, 500],
      ['Rẽ phải vào đường B.', 1, 1000],
      ['Bạn đã đến nơi.', 3, 0],
    ]);
  });
  it('phản hồi hỏng hoặc không có tuyến → null', () => {
    expect(parseValhalla(null)).toBeNull();
    expect(parseValhalla({})).toBeNull();
    expect(parseValhalla({ trip: { legs: [] } })).toBeNull();
    expect(parseValhalla({ trip: { legs: [{ shape: '', maneuvers: [] }] } })).toBeNull();
  });
  it('yêu cầu gửi đi dùng tiếng Việt, ô tô, đơn vị km', () => {
    const body = JSON.parse(buildRouteBody(north(0), north(1500)));
    expect(body.costing).toBe('auto');
    expect(body.directions_options.language).toBe('vi-VN');
    expect(body.directions_options.units).toBe('kilometers');
    expect(body.locations).toHaveLength(2);
    expect(body.locations[0]).toMatchObject({ lat: BASE.lat, lon: BASE.lng });
  });
});

describe('parsePhoton', () => {
  it('đọc địa điểm, bỏ mục thiếu toạ độ, ghép địa chỉ gọn', () => {
    const r = parsePhoton({
      features: [
        { geometry: { coordinates: [106.7, 10.77] }, properties: { name: 'Chợ Bến Thành', street: 'Lê Lợi', district: 'Quận 1', city: 'Thành phố Hồ Chí Minh' } },
        { geometry: { coordinates: [106.6] }, properties: { name: 'Hỏng' } },
        { geometry: { coordinates: [106.71, 10.78] }, properties: { street: 'Nguyễn Huệ', housenumber: '10', city: 'Thành phố Hồ Chí Minh' } },
      ],
    });
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ name: 'Chợ Bến Thành', lat: 10.77, lng: 106.7 });
    expect(r[0].detail).toBe('Lê Lợi, Quận 1, Thành phố Hồ Chí Minh');
    expect(r[1].name).toBe('10 Nguyễn Huệ');
  });
  it('dữ liệu rác → danh sách rỗng', () => {
    expect(parsePhoton(null)).toEqual([]);
    expect(parsePhoton({ features: 'x' })).toEqual([]);
  });
});

function route(): Route {
  return parseValhalla(valhallaFixture())!;
}
const fix = (m: number, i: number) => ({ ...north(m), t: 1_000_000 + i * 1000 });

describe('Guidance', () => {
  it('khởi đầu: bước hiện tại là bước 1, còn nguyên quãng đường', () => {
    const spoken: string[] = [];
    const g = new Guidance(route(), (t) => spoken.push(t));
    const s = g.update(fix(0, 0));
    expect(s.offRoute).toBe(false);
    expect(s.next?.text).toBe('Rẽ phải vào đường B.');
    expect(s.distToNextM).toBeGreaterThan(480);
    expect(s.distToNextM).toBeLessThan(520);
    expect(s.remainingM).toBeGreaterThan(1480);
  });

  it('báo trước lúc rẽ đúng một lần ở mỗi mốc (khoảng 300 m và 100 m)', () => {
    const spoken: string[] = [];
    const g = new Guidance(route(), (t) => spoken.push(t));
    for (let i = 0, m = 0; m <= 480; i++, m += 10) g.update(fix(m, i));
    const turn = spoken.filter((t) => t.includes('Rẽ phải') || t.includes('rẽ phải'));
    expect(turn).toHaveLength(2);
    expect(turn[0]).toMatch(/^Sau \d+ mét/);
    expect(turn[1]).toMatch(/^Sau \d+ mét/);
  });

  it('qua điểm rẽ thì chuyển sang bước kế tiếp', () => {
    const g = new Guidance(route(), () => {});
    let s = g.update(fix(0, 0));
    for (let i = 1, m = 10; m <= 700; i++, m += 10) s = g.update(fix(m, i));
    expect(s.next?.text).toBe('Bạn đã đến nơi.');
  });

  it('lệch khỏi tuyến liên tiếp → offRoute và gọi onOffRoute một lần', () => {
    let calls = 0;
    const g = new Guidance(route(), () => {}, () => calls++);
    let s = g.update(fix(100, 0));
    for (let i = 1; i <= 4; i++) s = g.update({ lat: north(120).lat, lng: BASE.lng + 0.001, t: 1_000_000 + i * 1000 }); // ~110 m ngang
    expect(s.offRoute).toBe(true);
    expect(calls).toBe(1);
  });

  it('một mẫu lệch thoáng qua không bị coi là lạc đường', () => {
    const g = new Guidance(route(), () => {});
    g.update(fix(100, 0));
    g.update({ lat: north(120).lat, lng: BASE.lng + 0.001, t: 1_001_000 });
    const s = g.update(fix(140, 2));
    expect(s.offRoute).toBe(false);
  });

  it('tới gần điểm cuối → arrived và đọc "đã đến nơi"', () => {
    const spoken: string[] = [];
    const g = new Guidance(route(), (t) => spoken.push(t));
    let s = g.update(fix(0, 0));
    for (let i = 1, m = 10; m <= 1490; i++, m += 10) s = g.update(fix(m, i));
    expect(s.arrived).toBe(true);
    expect(spoken.some((t) => /đã đến nơi/i.test(t))).toBe(true);
  });

  it('mẫu GPS hỏng (NaN) bị bỏ qua', () => {
    const g = new Guidance(route(), () => {});
    g.update(fix(0, 0));
    expect(() => g.update({ lat: Number.NaN, lng: BASE.lng, t: 1 })).not.toThrow();
  });
});

import { pickedPlace } from '../src/nav/geocode';

describe('pickedPlace (điểm chọn trên bản đồ)', () => {
  it('có kết quả tra ngược → dùng tên gần nhất, giữ đúng toạ độ đã chọn', () => {
    const p = pickedPlace(10.7712345, 106.7012345, [{ name: 'Chợ Bến Thành', detail: 'Quận 1', lat: 10.772, lng: 106.698 }]);
    expect(p).toEqual({ name: 'Chợ Bến Thành', detail: 'Quận 1', lat: 10.7712345, lng: 106.7012345 });
  });
  it('không có tên → "Vị trí đã chọn" kèm toạ độ', () => {
    expect(pickedPlace(10.77123, 106.70123, [])).toEqual({ name: 'Vị trí đã chọn', detail: '10.77123, 106.70123', lat: 10.77123, lng: 106.70123 });
  });
});
