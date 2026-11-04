// Đợt C: logic hiển thị màn lái xe (phương án C đã chốt).
import { describe, expect, it } from 'vitest';
import { actionText, cardLine, iconKind, nextLine, shortStreet } from '../src/nav/maneuver';
import { destLabel, driveLocked, etaClock, overTier, pickBanner, stripText } from '../src/ui/drive';
import { parseValhalla } from '../src/nav/route';
import { Guidance } from '../src/nav/guidance';
import { encodePolyline } from '../src/nav/polyline';

const north = (m: number) => ({ lat: 10.77 + m / 111195, lng: 106.7 });

describe('C1: biểu tượng rẽ theo loại', () => {
  it('Valhalla type → loại mũi tên', () => {
    expect(iconKind(10)).toBe('right');
    expect(iconKind(15)).toBe('left');
    expect(iconKind(9)).toBe('slight-right');
    expect(iconKind(16)).toBe('slight-left');
    expect(iconKind(11)).toBe('sharp-right');
    expect(iconKind(12)).toBe('uturn');
    expect(iconKind(13)).toBe('uturn');
    expect(iconKind(26)).toBe('roundabout');
    expect(iconKind(4)).toBe('arrive');
    expect(iconKind(8)).toBe('straight');
    expect(iconKind(25)).toBe('merge');
    expect(iconKind(999)).toBe('straight');
  });
  it('lời ngắn', () => {
    expect(actionText(10)).toBe('Rẽ phải');
    expect(actionText(15)).toBe('Rẽ trái');
    expect(actionText(12)).toBe('Quay đầu');
    expect(actionText(26)).toBe('Vào vòng xoay');
  });
});

describe('C2: thẻ dẫn đường tối đa 2 dòng, không cắt tên đường', () => {
  it('bỏ tiền tố "Đường"', () => {
    expect(shortStreet('Đường Nguyễn Thị Đặng')).toBe('Nguyễn Thị Đặng');
    expect(shortStreet('đường số 7')).toBe('số 7');
    expect(shortStreet('Quốc lộ 1A')).toBe('Quốc lộ 1A');
  });
  it('vừa chỗ thì "Rẽ phải · tên"; dài quá thì chỉ tên (biểu tượng đã chỉ hướng)', () => {
    expect(cardLine({ type: 10, text: 'Rẽ phải vào Đường Nguyễn Thị Đặng.', streets: ['Đường Nguyễn Thị Đặng'] }, 26)).toBe('Rẽ phải · Nguyễn Thị Đặng');
    expect(cardLine({ type: 10, text: '', streets: ['Xa lộ Hà Nội', 'Phạm Văn Đồng'] }, 26)).toBe('Xa lộ Hà Nội · Phạm Văn Đồng');
    expect(cardLine({ type: 10, text: 'Rẽ phải.', streets: [] }, 26)).toBe('Rẽ phải');
    expect(cardLine({ type: 4, text: 'Bạn đã đến nơi.', streets: [] }, 26)).toBe('Đến nơi');
  });
  it('dòng "rồi…" chỉ khi bước sau cách dưới 300 m', () => {
    expect(nextLine({ type: 15, text: '', streets: ['Hà Huy Giáp'] }, 200)).toBe('rồi Rẽ trái · Hà Huy Giáp');
    expect(nextLine({ type: 15, text: '', streets: ['Hà Huy Giáp'] }, 450)).toBe('');
    expect(nextLine(null, 100)).toBe('');
  });
  it('tên điểm đến là toạ độ → "Điểm đã chọn"', () => {
    expect(destLabel('Toạ độ 10.962983, 106.588974')).toBe('Điểm đã chọn');
    expect(destLabel('10.96, 106.58')).toBe('Điểm đã chọn');
    expect(destLabel('Kho Củ Chi')).toBe('Kho Củ Chi');
    expect(destLabel('')).toBe('Điểm đã chọn');
  });
  it('dải đáy: giờ đến, km, phút', () => {
    const now = Date.UTC(2026, 10, 4, 6, 28); // 13:28 giờ VN
    expect(etaClock(now, 13 * 60)).toBe('13:41');
    expect(stripText(7100, 13 * 60)).toBe('7,1 km · 13 phút');
    expect(stripText(800, 50)).toBe('800 m · 1 phút');
  });
  it('maneuver giữ tên đường từ Valhalla; Guidance trả bước sau và khoảng cách giữa 2 bước', () => {
    const r = parseValhalla({
      trip: {
        legs: [{ shape: encodePolyline([north(0), north(500), north(700), north(900)], 6), maneuvers: [
          { type: 1, instruction: 'Đi', begin_shape_index: 0, length: 0.5, street_names: ['A'] },
          { type: 10, instruction: 'Rẽ phải vào Đường B.', begin_shape_index: 1, length: 0.2, street_names: ['Đường B'] },
          { type: 15, instruction: 'Rẽ trái vào C.', begin_shape_index: 2, length: 0, street_names: ['C'] },
        ] }],
        summary: { length: 1, time: 60 },
      },
    });
    expect(r!.maneuvers[1].streets).toEqual(['Đường B']);
    const g = new Guidance(r!, () => {});
    const s = g.update({ lat: r!.points[0].lat, lng: r!.points[0].lng, t: 0 });
    expect(s.next?.streets).toEqual(['Đường B']);
    expect(s.after?.type).toBe(15);
    expect(typeof s.afterGapM).toBe('number');
  });
});

describe('C4/C5: khoá thao tác khi xe chạy', () => {
  it('> 10 km/h khoá, trừ khi "Tôi ngồi cạnh"', () => {
    expect(driveLocked(5, false)).toBe(false);
    expect(driveLocked(10, false)).toBe(false);
    expect(driveLocked(11, false)).toBe(true);
    expect(driveLocked(60, true)).toBe(false);
    expect(driveLocked(null, false)).toBe(false);
  });
});

describe('C6: dải báo lỗi', () => {
  it('ưu tiên: mất GPS > mất tìm lại đường > ngoại tuyến khi dẫn đường', () => {
    expect(pickBanner({ gpsLostMs: 3500, online: false, navigating: true, rerouteFailed: true })?.kind).toBe('gps');
    expect(pickBanner({ gpsLostMs: 2000, online: true, navigating: true, rerouteFailed: true })?.kind).toBe('reroute');
    expect(pickBanner({ gpsLostMs: 0, online: false, navigating: true, rerouteFailed: false })?.kind).toBe('offline');
    expect(pickBanner({ gpsLostMs: 0, online: false, navigating: false, rerouteFailed: false })).toBeNull();
    expect(pickBanner({ gpsLostMs: 0, online: true, navigating: true, rerouteFailed: false })).toBeNull();
  });
});

describe('C8: vượt tốc 3 mức', () => {
  it('+1–5 / +6–10 / > 10', () => {
    expect(overTier(50, 50)).toBe(0);
    expect(overTier(51, 50)).toBe(1);
    expect(overTier(55, 50)).toBe(1);
    expect(overTier(56, 50)).toBe(2);
    expect(overTier(60, 50)).toBe(2);
    expect(overTier(61, 50)).toBe(3);
    expect(overTier(null, 50)).toBe(0);
    expect(overTier(80, null)).toBe(0);
  });
});

import { TierAlarm } from '../src/ui/drive';
describe('QA: báo vượt tốc không lặp khi tốc độ dao động quanh ngưỡng', () => {
  it('55↔56 mỗi giây chỉ báo 1 lần trong 8 s; vượt hẳn lên mức 3 vẫn báo ngay', () => {
    const a = new TierAlarm();
    const fired: number[] = [];
    for (let i = 0; i < 8; i++) {
      const t = i * 1000;
      const r = a.update(i % 2 ? 2 : 1, t);
      if (r) fired.push(r);
    }
    expect(fired).toEqual([1]);
    // mức 3 luôn báo ngay khi vừa lên
    expect(a.update(3, 8500)).toBe(3);
    // ở lại mức ≥ 2: nhắc lại sau 20 s
    expect(a.update(3, 20_000)).toBe(0);
    expect(a.update(3, 29_000)).toBe(3);
  });
  it('hạ về 0 rồi vượt lại sau 8 s → báo lại', () => {
    const a = new TierAlarm();
    expect(a.update(1, 0)).toBe(1);
    expect(a.update(0, 1000)).toBe(0);
    expect(a.update(1, 2000)).toBe(0);
    expect(a.update(1, 9500)).toBe(1);
  });
});
