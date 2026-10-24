import { describe, expect, it } from 'vitest';
import { weatherAdvice, weatherUrl } from '../src/features/weather';
import { sosMessage, smsUrl } from '../src/features/sos';
import { nextPole, parsePoles, patrolCsv } from '../src/features/patrol';
import { poleFromSearch, poleUrl } from '../src/features/qr';
import { glosa, phaseAt, pickApproach, parseSignals, type SignalPlan } from '../src/features/signals';
import { parseObd } from '../src/features/obd';
import { hgvBlockedAt, parseHgv } from '../src/pipeline/hgv';
import { shareName } from '../src/features/fleet';

describe('weatherAdvice (giảm tốc theo thời tiết — khuyến nghị, không phải luật)', () => {
  it('trời quang → không nhắc', () => {
    expect(weatherAdvice({ code: 1, rainMm: 0, visibilityM: 20000 }).level).toBe('none');
  });
  it('mưa vừa → giảm 10; mưa to/giông → giảm 20; sương mù/tầm nhìn kém → giảm 20', () => {
    expect(weatherAdvice({ code: 63, rainMm: 3, visibilityM: 8000 })).toMatchObject({ level: 'rain', reduceKmh: 10 });
    expect(weatherAdvice({ code: 65, rainMm: 12, visibilityM: 3000 })).toMatchObject({ level: 'heavy_rain', reduceKmh: 20 });
    expect(weatherAdvice({ code: 95, rainMm: 1, visibilityM: 9000 })).toMatchObject({ level: 'storm', reduceKmh: 20 });
    expect(weatherAdvice({ code: 45, rainMm: 0, visibilityM: 300 })).toMatchObject({ level: 'fog', reduceKmh: 20 });
  });
  it('dữ liệu thiếu → không nhắc', () => {
    expect(weatherAdvice({ code: null, rainMm: null, visibilityM: null }).level).toBe('none');
  });
  it('URL Open-Meteo có toạ độ làm tròn và các biến hiện tại', () => {
    const u = new URL(weatherUrl(10.7712, 106.7012));
    expect(u.hostname).toBe('api.open-meteo.com');
    expect(u.searchParams.get('latitude')).toBe('10.77');
    expect(u.searchParams.get('current')).toContain('weather_code');
  });
});

describe('SOS', () => {
  it('tin nhắn có vị trí, link bản đồ, giờ Việt Nam', () => {
    const m = sosMessage(10.7712341, 106.7012341, Date.UTC(2026, 9, 24, 14, 5), 'Xe 51C');
    expect(m).toContain('https://www.google.com/maps?q=10.771234,106.701234');
    expect(m).toContain('21:05');
    expect(m).toContain('Xe 51C');
  });
  it('smsUrl mã hoá nội dung, bỏ ký tự lạ trong số điện thoại', () => {
    expect(smsUrl('0989 725-507', 'a b&c')).toBe('sms:0989725507?&body=a%20b%26c');
  });
});

describe('patrol (tuần tra chiếu sáng)', () => {
  const csv = '﻿Mã trụ,Vĩ độ,Kinh độ,Tuyến\nCS-001,10.7700,106.7000,Lê Lợi\nCS-002,10.7705,106.7000,Lê Lợi\nlỗi,abc,1,\nCS-003,10.7710,106.7000,Lê Lợi\n';
  it('đọc CSV linh hoạt tên cột (mã/vĩ độ/kinh độ), bỏ dòng hỏng', () => {
    const p = parsePoles(csv);
    expect(p.map((x) => x.code)).toEqual(['CS-001', 'CS-002', 'CS-003']);
    expect(p[0].route).toBe('Lê Lợi');
  });
  it('đọc cả CSV dùng dấu chấm phẩy và cột lat/lng tiếng Anh', () => {
    expect(parsePoles('code;lat;lng\nA1;10.77;106.7\n')).toHaveLength(1);
  });
  it('đọc GeoJSON điểm', () => {
    const gj = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [106.7, 10.77] }, properties: { ma_tru: 'T1' } }] });
    expect(parsePoles(gj)[0]).toMatchObject({ code: 'T1', lat: 10.77, lng: 106.7 });
  });
  it('trụ kế tiếp: phía trước theo hướng đi, trong 80 m, bỏ trụ đã kiểm', () => {
    const p = parsePoles(csv);
    const here = { lat: 10.7698, lng: 106.7 };
    expect(nextPole(p, here, 0, new Set())?.pole.code).toBe('CS-001');
    expect(nextPole(p, here, 0, new Set(['CS-001']))?.pole.code).toBe('CS-002');
    expect(nextPole(p, here, 180, new Set())).toBeNull(); // đi ngược hướng
  });
  it('CSV kết quả tuần tra có trụ chưa kiểm', () => {
    const p = parsePoles(csv);
    const out = patrolCsv(p, [{ code: 'CS-002', status: 'tat', t: Date.UTC(2026, 9, 24, 14, 0) }]);
    const lines = out.trim().split('\r\n');
    expect(lines[0]).toBe('STT,Mã trụ,Tuyến,Trạng thái,Thời điểm,Vĩ độ,Kinh độ');
    expect(lines[2]).toContain('CS-002');
    expect(lines[2]).toContain('Đèn tắt');
    expect(lines[1]).toContain('Chưa kiểm');
  });
});

describe('QR trụ đèn', () => {
  it('URL trụ và đọc lại tham số', () => {
    const u = poleUrl('https://neo-era.github.io/LVC_ITS_S_001/', 'CS-001/A');
    expect(u).toBe('https://neo-era.github.io/LVC_ITS_S_001/?tru=CS-001%2FA');
    expect(poleFromSearch('?tru=CS-001%2FA')).toBe('CS-001/A');
    expect(poleFromSearch('?x=1')).toBeNull();
    expect(poleFromSearch('?tru=' + 'x'.repeat(80))).toBeNull();
  });
});

describe('đèn tín hiệu (kế hoạch pha cố định)', () => {
  const plan: SignalPlan = {
    id: 'N1', name: 'Nút thử', lat: 10.77, lng: 106.7, cycleS: 100, offsetS: 0,
    approaches: [
      { heading: 0, greenStart: 0, greenEnd: 40, yellowS: 3 },
      { heading: 90, greenStart: 50, greenEnd: 90, yellowS: 3 },
    ],
  };
  const at = (s: number) => Date.UTC(2026, 9, 24, 17, 0, 0) + s * 1000; // 00:00 giờ VN
  it('màu và số giây còn lại', () => {
    expect(phaseAt(plan, 0, at(10))).toEqual({ color: 'green', remainS: 30 });
    expect(phaseAt(plan, 0, at(41))).toEqual({ color: 'yellow', remainS: 2 });
    expect(phaseAt(plan, 0, at(60))).toEqual({ color: 'red', remainS: 40 });
    expect(phaseAt(plan, 0, at(110))).toEqual({ color: 'green', remainS: 30 }); // chu kỳ sau
  });
  it('chọn hướng tiếp cận theo hướng xe (±45°)', () => {
    expect(pickApproach(plan, 10)).toBe(0);
    expect(pickApproach(plan, 85)).toBe(1);
    expect(pickApproach(plan, 200)).toBe(-1);
  });
  it('GLOSA: tốc độ để tới khi còn xanh; không vượt giới hạn; không khả thi → null', () => {
    // còn 30 s xanh, cách 300 m → cần ≥ 36 km/h; giới hạn 50 → khuyên 36–50
    expect(glosa(300, { color: 'green', remainS: 30 }, 50)).toEqual({ minKmh: 36, maxKmh: 50 });
    // đỏ còn 40 s, cách 300 m → đến lúc xanh nếu đi ≤ 27 km/h
    expect(glosa(300, { color: 'red', remainS: 40 }, 50)).toEqual({ minKmh: 0, maxKmh: 27 });
    // xanh còn 5 s, cách 300 m → cần 216 km/h > giới hạn → null
    expect(glosa(300, { color: 'green', remainS: 5 }, 50)).toBeNull();
  });
  it('parseSignals bỏ mục hỏng', () => {
    expect(parseSignals([plan, { id: 'x' }, { ...plan, cycleS: 0 }])).toHaveLength(1);
  });
});

describe('OBD-II (ELM327)', () => {
  it.each([
    ['41 0D 3C', { pid: 'speed', value: 60 }],
    ['410D3C\r>', { pid: 'speed', value: 60 }],
    ['41 0C 1A F8', { pid: 'rpm', value: 1726 }],
    ['41 05 7B', { pid: 'coolant', value: 83 }],
    ['NO DATA', null],
    ['7E8 03 41 0D 28', { pid: 'speed', value: 40 }],
  ])('%s', (raw, want) => expect(parseObd(raw)).toEqual(want));
});

describe('cấm xe tải theo OSM (hgv)', () => {
  it('hgv=no → cấm mọi lúc; hgv:conditional theo giờ; không có thẻ → null', () => {
    expect(parseHgv({ hgv: 'no' })).toEqual([[0, 1440]]);
    expect(parseHgv({ 'hgv:conditional': 'no @ (06:00-21:00)' })).toEqual([[360, 1260]]);
    expect(parseHgv({ 'hgv:conditional': 'no @ (06:00-09:00,16:00-20:00)' })).toEqual([[360, 540], [960, 1200]]);
    expect(parseHgv({ 'hgv:conditional': 'no @ (22:00-05:00)' })).toEqual([[1320, 1440], [0, 300]]);
    expect(parseHgv({ highway: 'primary' })).toBeNull();
    expect(parseHgv({ 'hgv:conditional': 'destination @ (Mo-Fr)' })).toBeNull();
  });
  it('hgvBlockedAt theo giờ Việt Nam', () => {
    const w = [[360, 1260]] as [number, number][];
    expect(hgvBlockedAt(w, Date.UTC(2026, 9, 24, 3, 0))).toBe(true); // 10:00 VN
    expect(hgvBlockedAt(w, Date.UTC(2026, 9, 24, 15, 0))).toBe(false); // 22:00 VN
  });
});

describe('chia sẻ hành trình', () => {
  it('tên hiển thị kèm điểm đến và giờ tới, tối đa 40 ký tự', () => {
    const n = shareName('Anh Lâm', 'Hẻm 45 Liên khu 16-18 Bình Trị Đông', Date.UTC(2026, 9, 24, 15, 30));
    expect(n.length).toBeLessThanOrEqual(40);
    expect(n).toContain('22:30');
    expect(n.startsWith('Anh Lâm')).toBe(true);
  });
});

import { CellWriter } from '../src/pipeline/compact';
import { parseCell } from '../src/core/cells';
import { Engine } from '../src/engine';

describe('cấm xe tải trong ô dữ liệu và Engine', () => {
  it('ghi windows vào ô, đọc lại thành seg.hgv', () => {
    const w = new CellWriter();
    w.addWay(5, [{ lat: 10.7701, lng: 106.7001 }, { lat: 10.7721, lng: 106.7001 }], 50, 0, [[360, 1260]]);
    const f = [...w.files().values()][0];
    const c = parseCell(JSON.parse(JSON.stringify(f)))!;
    expect(c.segments[0].hgv).toEqual([[360, 1260]]);
  });
  it('xe tải trên đường cấm giờ này → truckBan; ô tô → không', () => {
    const M = 111195;
    const mk = (vehicle: 'truck' | 'car') => {
      const e = new Engine({ radiusM: 500, speak: () => {}, vehicle });
      e.loadData({ segments: [{ id: 'S', a: { lat: 10.77, lng: 106.7 }, b: { lat: 10.77 + 1000 / M, lng: 106.7 }, maxspeed: 50, hgv: [[360, 1260]] }], alerts: [] });
      const t0 = Date.UTC(2026, 9, 24, 3, 0); // 10:00 VN
      let v = e.view();
      for (let i = 1; i <= 5; i++) v = e.push({ t: t0 + i * 1000, lat: 10.77 + (i * 12) / M, lng: 106.7, speed: 12, accuracy: 5 }, null);
      return v;
    };
    expect(mk('truck').truckBan).toBe(true);
    expect(mk('car').truckBan).toBe(false);
  });
});
