import { describe, expect, it } from 'vitest';
import { RestTracker, REST_STOP_MS } from '../src/features/rest';
import { addPlace, findPlaceByName, parsePlaces, removePlace } from '../src/features/places';
import { reportsToCsv, parseReports, type Report } from '../src/features/reports';
import { TripRecorder, tripScore } from '../src/features/trip';
import { parseCommand } from '../src/features/voicecmd';
import { clipsToLock } from '../src/features/dashcam-plan';
import { fleetPingBody, isTeamCode, fleetFresh } from '../src/features/fleet';

const MIN = 60_000;

describe('RestTracker (nhắc nghỉ)', () => {
  it('nhắc khi lái liên tục đủ ngưỡng, nhắc lại sau 15 phút nếu chưa nghỉ', () => {
    const r = new RestTracker(2 * 60);
    const ev: string[] = [];
    for (let t = 0; t <= 2 * 60 * MIN + 16 * MIN; t += 10_000) {
      const e = r.push(t, 50);
      if (e) ev.push(`${Math.round(t / MIN)}:${e}`);
    }
    expect(ev).toEqual(['120:remind', '135:remind']);
  });
  it('dừng đủ 15 phút thì tính lại từ đầu; dừng ngắn (đèn đỏ) không tính là nghỉ', () => {
    const r = new RestTracker(60);
    let t = 0;
    for (; t < 50 * MIN; t += 10_000) r.push(t, 40);
    for (const end = t + 2 * MIN; t < end; t += 10_000) r.push(t, 0); // đèn đỏ
    expect(r.drivingMs).toBeGreaterThan(49 * MIN);
    for (const end = t + REST_STOP_MS + MIN; t < end; t += 10_000) r.push(t, 0); // nghỉ thật
    expect(r.drivingMs).toBe(0);
  });
  it('tắt nhắc (0) → không bao giờ nhắc; tổng giờ lái trong ngày vẫn tính', () => {
    const r = new RestTracker(0);
    let any = false;
    for (let t = 0; t <= 5 * 60 * MIN; t += 30_000) any = any || r.push(t, 60) !== null;
    expect(any).toBe(false);
    expect(r.dayMs).toBeGreaterThan(4.9 * 60 * MIN);
  });
  it('vượt 10 giờ lái trong ngày → báo một lần', () => {
    const r = new RestTracker(999);
    const ev: string[] = [];
    for (let t = 0; t <= 10.2 * 60 * MIN; t += 30_000) {
      const e = r.push(t, 60);
      if (e) ev.push(e);
    }
    expect(ev).toEqual(['day_limit']);
  });
  it('khoảng trống thời gian lớn (tắt app) không bị cộng vào giờ lái', () => {
    const r = new RestTracker(60);
    r.push(0, 50);
    r.push(3 * 60 * MIN, 50);
    expect(r.drivingMs).toBeLessThan(MIN);
  });
});

describe('places (địa điểm lưu)', () => {
  it('thêm, trùng tên thì thay, xoá, tìm theo tên không dấu', () => {
    let l = addPlace([], { name: 'Nhà', lat: 10.76, lng: 106.6 });
    l = addPlace(l, { name: 'Cơ quan', lat: 10.78, lng: 106.69 });
    l = addPlace(l, { name: 'nhà', lat: 10.761, lng: 106.601 });
    expect(l).toHaveLength(2);
    expect(findPlaceByName(l, 'nha')?.lat).toBe(10.761);
    expect(findPlaceByName(l, 'co quan')?.name).toBe('Cơ quan');
    expect(removePlace(l, 'Nhà')).toHaveLength(1);
  });
  it('bỏ mục hỏng khi đọc; giới hạn 30 mục', () => {
    expect(parsePlaces([{ name: 'A', lat: 10, lng: 106 }, { name: '', lat: 10, lng: 106 }, { name: 'B', lat: 99, lng: 106 }])).toHaveLength(1);
    let l: ReturnType<typeof parsePlaces> = [];
    for (let i = 0; i < 35; i++) l = addPlace(l, { name: `P${i}`, lat: 10, lng: 106 });
    expect(l).toHaveLength(30);
  });
});

describe('reports (báo đèn tắt / sự cố chiếu sáng)', () => {
  const r: Report = { id: 'r1', kind: 'den_tat', lat: 10.7712341, lng: 106.7012341, dir: 90, t: Date.UTC(2026, 9, 24, 14, 5), synced: false };
  it('xuất CSV có BOM, tiêu đề tiếng Việt, toạ độ 6 chữ số, link bản đồ, giờ Việt Nam', () => {
    const csv = reportsToCsv([r]);
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('STT,Loại,Mã trụ,Thời điểm,Vĩ độ,Kinh độ,Hướng,Bản đồ');
    expect(lines[1]).toContain('Đèn tắt');
    expect(lines[1]).toContain('24/10/2026 21:05');
    expect(lines[1]).toContain('10.771234');
    expect(lines[1]).toContain('https://www.google.com/maps?q=10.771234,106.701234');
  });
  it('parseReports bỏ mục hỏng', () => {
    expect(parseReports([r, { ...r, kind: 'x' }, { ...r, lat: 0 }])).toHaveLength(1);
  });
});

describe('TripRecorder (nhật ký chuyến đi)', () => {
  const M = 111195;
  it('cộng quãng đường, tốc độ cao nhất, thời gian chạy; bỏ điểm GPS nhảy bất thường', () => {
    const tr = new TripRecorder(0, 10.7, 106.6);
    let lat = 10.7;
    for (let i = 1; i <= 60; i++) {
      lat += 15 / M;
      tr.push({ t: i * 1000, lat, lng: 106.6, kmh: 54, limit: 60, limitEstimated: false, ok: true });
    }
    tr.push({ t: 61_000, lat: lat + 5000 / M, lng: 106.6, kmh: 54, limit: 60, limitEstimated: false, ok: true }); // nhảy 5 km
    const s = tr.summary(62_000);
    expect(s.distM).toBeGreaterThan(880);
    expect(s.distM).toBeLessThan(920);
    expect(s.maxKmh).toBe(54);
    expect(s.movingS).toBeGreaterThanOrEqual(59);
  });
  it('đếm số lần vượt tốc độ (biển thật) và phanh gấp; số ước tính không tính vượt', () => {
    const tr = new TripRecorder(0, 10.7, 106.6);
    const seq = [50, 70, 72, 69, 66, 58, 70, 67, 64, 34];
    seq.forEach((kmh, i) => tr.push({ t: (i + 1) * 1000, lat: 10.7 + (i * 15) / 111195, lng: 106.6, kmh, limit: 60, limitEstimated: i >= 6 && i <= 8, ok: true }));
    const s = tr.summary(10_000);
    expect(s.overCount).toBe(1); // lần 2 là số ước tính
    expect(s.hardBrakes).toBe(1); // 64 → 34 km/h trong 1 giây
  });
  it('điểm lái an toàn: 100 khi không lỗi, trừ theo lỗi, không âm', () => {
    expect(tripScore({ overCount: 0, hardBrakes: 0, overSeconds: 0, distM: 10000 })).toBe(100);
    expect(tripScore({ overCount: 2, hardBrakes: 1, overSeconds: 30, distM: 10000 })).toBeLessThan(100);
    expect(tripScore({ overCount: 99, hardBrakes: 99, overSeconds: 9999, distM: 1000 })).toBe(0);
  });
});

describe('parseCommand (lệnh giọng nói)', () => {
  it.each([
    ['đánh dấu camera', { type: 'mark_camera' }],
    ['Đánh dấu cam', { type: 'mark_camera' }],
    ['báo đèn tắt', { type: 'report_light' }],
    ['đèn hư ở đây', { type: 'report_light' }],
    ['về nhà', { type: 'go_place', name: 'nhà' }],
    ['đi đến cơ quan', { type: 'go_place', name: 'cơ quan' }],
    ['dẫn đường tới Chợ Bến Thành', { type: 'go_place', name: 'chợ bến thành' }],
    ['dừng dẫn đường', { type: 'stop_nav' }],
    ['tắt giọng nói', { type: 'voice', on: false }],
    ['bật giọng', { type: 'voice', on: true }],
    ['bắt đầu quay', { type: 'dashcam', on: true }],
    ['khoá video', { type: 'dashcam_lock' }],
    ['tốc độ bao nhiêu', { type: 'say_speed' }],
    ['hôm nay trời đẹp', { type: 'unknown' }],
  ])('%s', (text, want) => expect(parseCommand(text)).toEqual(want));
});

describe('clipsToLock (khoá video quanh va chạm)', () => {
  const clips = [
    { id: 'a', bytes: 1, startedAt: 0, endedAt: 60_000, locked: false },
    { id: 'b', bytes: 1, startedAt: 60_000, endedAt: 120_000, locked: false },
    { id: 'c', bytes: 1, startedAt: 120_000, endedAt: 180_000, locked: false },
  ];
  it('khoá các đoạn giao với cửa sổ ±15 giây', () => {
    expect(clipsToLock(clips, { from: 50_000, to: 80_000 })).toEqual(['a', 'b']);
    expect(clipsToLock(clips, { from: 130_000, to: 140_000 })).toEqual(['c']);
  });
  it('đoạn đang quay (chưa có endedAt) vẫn được khoá nếu bắt đầu trước cuối cửa sổ', () => {
    expect(clipsToLock([{ id: 'x', bytes: 0, startedAt: 100_000, locked: false }], { from: 90_000, to: 120_000 })).toEqual(['x']);
  });
});

describe('fleet (đội xe)', () => {
  it('mã đội ≥ 8 ký tự chữ/số', () => {
    expect(isTeamCode('SAPU-KVTT-01')).toBe(true);
    expect(isTeamCode('abc')).toBe(false);
    expect(isTeamCode('có dấu cách')).toBe(false);
  });
  it('dữ liệu gửi làm tròn hợp lý, tên xe cắt 40 ký tự', () => {
    const b = fleetPingBody('TEAMCODE1', 'dev1', 'X'.repeat(60), { lat: 10.7712341, lng: 106.7012341, kmh: 42.6, heading: 91.4 });
    expect(b).toEqual({ p_team: 'TEAMCODE1', p_device: 'dev1', p_name: 'X'.repeat(40), p_lat: 10.771234, p_lng: 106.701234, p_speed: 43, p_heading: 91 });
  });
  it('fleetFresh: cập nhật < 2 phút là đang hoạt động', () => {
    expect(fleetFresh('2026-10-24T10:00:00Z', Date.parse('2026-10-24T10:01:30Z'))).toBe('live');
    expect(fleetFresh('2026-10-24T10:00:00Z', Date.parse('2026-10-24T10:20:00Z'))).toBe('stale');
  });
});

/* ===== Sau review ===== */
import { ImpactDetector } from '../src/features/dashcam-plan';

describe('parseCommand — sửa sau review', () => {
  it.each([
    ['dừng quay video', { type: 'dashcam', on: false }],
    ['tắt quay video', { type: 'dashcam', on: false }],
    ['tắt camera', { type: 'dashcam', on: false }],
    ['chạy đến nhà', { type: 'go_place', name: 'nhà' }],
    ['hủy đến chợ', { type: 'unknown' }],
    ['đèn đỏ chạy', { type: 'unknown' }],
    ['đèn cháy', { type: 'unknown' }],
    ['tắt đèn', { type: 'unknown' }],
    ['tới đâu rồi', { type: 'unknown' }],
    ['đến cơ quan', { type: 'go_place', name: 'cơ quan' }],
    ['đèn tắt', { type: 'report_light' }],
    ['báo ngập', { type: 'report_flood' }],
    ['đường ngập nước', { type: 'report_flood' }],
    ['báo đèn hư', { type: 'report_light' }],
  ])('%s', (text, want) => expect(parseCommand(text)).toEqual(want));
});

describe('findPlaceByName — chỉ khớp nguyên từ', () => {
  const l = [{ name: 'Chợ Bàn Cờ', lat: 10.77, lng: 106.68 }, { name: 'Nhà', lat: 10.76, lng: 106.6 }];
  it('"ba" không ra "Bàn Cờ"; "bàn cờ" ra', () => {
    expect(findPlaceByName(l, 'ba')).toBeNull();
    expect(findPlaceByName(l, 'bàn cờ')?.name).toBe('Chợ Bàn Cờ');
    expect(findPlaceByName(l, 'nha')?.name).toBe('Nhà');
  });
});

describe('RestTracker — nhiễu khi đỗ không xoá thời gian nghỉ', () => {
  it('một mẫu 8 km/h giữa lúc đỗ không reset; chạy thật ≥ 30 giây mới reset', () => {
    const r = new RestTracker(60);
    let t = 0;
    for (; t < 30 * MIN; t += 10_000) r.push(t, 40);
    for (const end = t + 10 * MIN; t < end; t += 10_000) r.push(t, t % (3 * MIN) === 0 ? 8 : 0);
    for (const end = t + 6 * MIN; t < end; t += 10_000) r.push(t, 0);
    expect(r.drivingMs).toBe(0); // đã nghỉ > 15 phút dù có vài mẫu nhiễu
  });
  it('trạng thái lưu/khôi phục được', () => {
    const r = new RestTracker(60);
    for (let t = 0; t < 20 * MIN; t += 10_000) r.push(t, 40);
    const r2 = RestTracker.restore(60, r.snapshot());
    expect(r2.drivingMs).toBe(r.drivingMs);
    expect(r2.push(20 * MIN + 10_000, 40)).toBeNull();
  });
});

describe('TripRecorder — sửa sau review', () => {
  const M = 111195;
  it('mẫu GPS yếu (lệch sang bên 110 m) bị bỏ, không làm phình quãng đường', () => {
    const tr = new TripRecorder(0, 10.7, 106.6);
    for (let i = 1; i <= 10; i++) {
      const ok = i % 2 === 0;
      tr.push({ t: i * 1000, lat: 10.7 + (i * 15) / M, lng: ok ? 106.6 : 106.601, kmh: 54, limit: null, limitEstimated: false, ok });
    }
    expect(tr.summary(11_000).distM).toBeLessThan(170);
  });
  it('dao động 50–52 quanh biển 50 không tính vượt; vượt ≥ 4 km/h liên tục 3 giây mới tính', () => {
    const tr = new TripRecorder(0, 10.7, 106.6);
    const seq = [50, 52, 51, 53, 50, 56, 57, 58, 59, 50];
    seq.forEach((kmh, i) => tr.push({ t: (i + 1) * 1000, lat: 10.7 + (i * 15) / M, lng: 106.6, kmh, limit: 50, limitEstimated: false, ok: true }));
    expect(tr.summary(11_000).overCount).toBe(1);
  });
  it('lưu/khôi phục chuyến đang đi', () => {
    const tr = new TripRecorder(0, 10.7, 106.6);
    for (let i = 1; i <= 5; i++) tr.push({ t: i * 1000, lat: 10.7 + (i * 15) / M, lng: 106.6, kmh: 54, limit: null, limitEstimated: false, ok: true });
    const tr2 = TripRecorder.restore(tr.snapshot())!;
    expect(tr2.summary(6000).distM).toBe(tr.summary(6000).distM);
    expect(tr2.lastT).toBe(5000);
  });
});

describe('ImpactDetector — ổ gà một nhịp không khoá', () => {
  it('cần ≥ 3 mẫu vượt ngưỡng trong 500 ms', () => {
    const d = new ImpactDetector(2.5);
    const big = { x: 0, y: 0, z: 30 };
    const small = { x: 0, y: 0, z: 9.8 };
    expect(d.push(big, 0)).toBe(false);
    expect(d.push(small, 20)).toBe(false);
    expect(d.push(big, 1000)).toBe(false);
    expect(d.push(big, 1020)).toBe(false);
    expect(d.push(big, 1040)).toBe(true);
    expect(d.push(big, 1060)).toBe(false); // đã báo, chờ 10 giây
  });
});
