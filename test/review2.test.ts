/** Kiểm thử các lỗi tìm ra ở lượt rà soát độc lập nhóm tính năng 9–17. */
import { describe, expect, it } from 'vitest';
import { glosa, parseSignals, signalAhead, type SignalPlan } from '../src/features/signals';
import { parseObd, ObdSanity, ObdBuffer } from '../src/features/obd';
import { CrashConfirm, sosMessage, validPhone } from '../src/features/sos';
import { poleFromSearch } from '../src/features/qr';
import { csvCell, reportsToCsv } from '../src/features/reports';
import { dupCodes, parsePoles, patrolCsv, PoleTracker, type Pole } from '../src/features/patrol';
import { SignVoter } from '../src/features/signocr';

const M = 1 / 111195; // độ vĩ / mét

describe('đèn tín hiệu: chỉ nút PHÍA TRƯỚC', () => {
  const plan: SignalPlan = { id: 'N', name: 'N', lat: 10.77, lng: 106.7, cycleS: 90, offsetS: 0, approaches: [{ heading: 0, greenStart: 0, greenEnd: 35, yellowS: 3 }] };
  it('xe phía nam đi lên bắc → nút phía trước', () => {
    expect(signalAhead({ lat: 10.77 - 100 * M, lng: 106.7 }, plan, 0)).toBe(true);
  });
  it('đã qua nút, đi tiếp lên bắc → nút ở sau lưng, không báo', () => {
    expect(signalAhead({ lat: 10.77 + 100 * M, lng: 106.7 }, plan, 0)).toBe(false);
  });
  it('không có hướng → không báo', () => {
    expect(signalAhead({ lat: 10.77 - 100 * M, lng: 106.7 }, plan, null)).toBe(false);
  });
  it('parseSignals loại hướng tiếp cận hỏng (thiếu số, vượt chu kỳ)', () => {
    const bad1 = { ...plan, approaches: [{}] };
    const bad2 = { ...plan, approaches: [{ heading: 0, greenStart: 0, greenEnd: 89, yellowS: 3 }] };
    expect(parseSignals([plan, bad1, bad2])).toHaveLength(1);
  });
});

describe('GLOSA an toàn', () => {
  it('không bao giờ khuyên chạy nhanh hơn đang chạy', () => {
    // xanh còn 3 s, cách 40 m: trước đây khuyên 48 km/h
    expect(glosa(40, { color: 'green', remainS: 3 }, 50, 30)).toBeNull();
    // xanh còn 30 s, cách 300 m, đang 25 km/h → cần (300/27)*3.6 = 40 > 25 → không khuyên tăng tốc
    expect(glosa(300, { color: 'green', remainS: 30 }, 50, 25)).toBeNull();
  });
  it('trừ biên 3 s và cần ≥ 8 s xanh', () => {
    // còn 30 s → dùng 27 s: 300 m → 40 km/h; đang 45 → khuyên giữ 40–50
    expect(glosa(300, { color: 'green', remainS: 30 }, 50, 45)).toEqual({ minKmh: 40, maxKmh: 50 });
    expect(glosa(20, { color: 'green', remainS: 7 }, 50, 45)).toBeNull();
  });
  it('không có giới hạn tốc độ → không khuyên', () => {
    expect(glosa(300, { color: 'green', remainS: 30 }, null, 45)).toBeNull();
    expect(glosa(300, { color: 'red', remainS: 40 }, null, 45)).toBeNull();
  });
  it('đèn đỏ: khuyên chạy chậm (an toàn) như cũ', () => {
    expect(glosa(300, { color: 'red', remainS: 40 }, 50, 45)).toEqual({ minKmh: 0, maxKmh: 27 });
  });
});

describe('OBD: không ghép rác của lệnh trước', () => {
  it('khung dở "410D" + phản hồi RPM không thành tốc độ giả', () => {
    expect(parseObd('410D' + '410C1AF8>', '0D')).toBeNull();
    expect(parseObd('410D\r410C1AF8\r>', '0C')).toEqual({ pid: 'rpm', value: 1726 });
  });
  it('chỉ nhận đúng PID vừa hỏi', () => {
    expect(parseObd('410C1AF8>', '0D')).toBeNull();
    expect(parseObd('410D3C\r>', '0D')).toEqual({ pid: 'speed', value: 60 });
  });
  it('bộ đệm: xoá khi bắt đầu lệnh mới, giới hạn độ dài', () => {
    const b = new ObdBuffer();
    expect(b.feed('410D')).toBeNull();
    b.reset();
    expect(b.feed('410C1AF8\r>')).toBe('410C1AF8\r>');
    expect(b.feed('x'.repeat(2000))).toBeNull();
    expect(b.size).toBeLessThanOrEqual(512);
  });
  it('lệch GPS > 20 km/h liên tục 5 s (GPS tốt) → thôi tin OBD', () => {
    const s = new ObdSanity();
    let t = 0;
    for (let i = 0; i < 4; i++) expect(s.push(0, 50, (t += 1000))).toBe(true); // 4 s
    expect(s.push(0, 50, (t += 2500))).toBe(false); // > 5 s kể từ lúc bắt đầu lệch
    expect(s.push(50, 50, (t += 1000))).toBe(false); // đã thôi tin trong phiên kết nối này
    s.reset();
    expect(s.push(50, 52, (t += 1000))).toBe(true);
  });
  it('lệch ngắn (GPS nhảy) hoặc không có GPS → vẫn tin OBD', () => {
    const s = new ObdSanity();
    expect(s.push(0, 50, 1000)).toBe(true);
    expect(s.push(48, 50, 2000)).toBe(true);
    expect(s.push(0, 50, 7000)).toBe(true); // bắt đầu lệch lại từ đầu
    expect(s.push(30, null, 20000)).toBe(true);
  });
});

describe('SOS', () => {
  const now = Date.UTC(2026, 9, 24, 14, 5);
  it('không có vị trí → không gửi toạ độ 0,0', () => {
    const m = sosMessage(null, now, 'Xe 51C');
    expect(m).not.toContain('maps?q=');
    expect(m).toContain('chưa xác định được vị trí');
  });
  it('vị trí cũ hơn 30 s → ghi rõ cách đây bao lâu', () => {
    const m = sosMessage({ lat: 10.77, lng: 106.7, t: now - 3 * 60_000 }, now, '');
    expect(m).toContain('maps?q=10.770000,106.700000');
    expect(m).toContain('3 phút');
  });
  it('số điện thoại hợp lệ', () => {
    expect(validPhone('0989 725 507')).toBe(true);
    expect(validPhone('+84989725507')).toBe(true);
    expect(validPhone('abc')).toBe(false);
    expect(validPhone('123')).toBe(false);
  });
  it('va chạm thật: sau cú sốc xe dừng hẳn → kích hoạt', () => {
    const c = new CrashConfirm();
    c.shock(0);
    expect(c.sample(1000, 30)).toBeNull();
    expect(c.sample(3000, 2)).toBe('trigger');
  });
  it('ổ gà/xe máy: xe vẫn chạy > 20 km/h → bỏ qua', () => {
    const c = new CrashConfirm();
    c.shock(0);
    expect(c.sample(1000, 35)).toBeNull();
    expect(c.sample(4000, 32)).toBe('cancel');
  });
  it('mất GPS sau cú sốc → hết 8 s thì kích hoạt (an toàn)', () => {
    const c = new CrashConfirm();
    c.shock(0);
    expect(c.tick(5000)).toBeNull();
    expect(c.tick(8500)).toBe('trigger');
    expect(c.tick(9000)).toBeNull(); // đã xử lý
  });
});

describe('mã trụ và CSV an toàn', () => {
  it('QR từ chối mã có ký tự công thức/HTML', () => {
    expect(poleFromSearch('?tru=%3DHYPERLINK(%22http%3A%2F%2Fx%22)')).toBeNull();
    expect(poleFromSearch('?tru=%3Cb%3E')).toBeNull();
    expect(poleFromSearch('?tru=CS-001%2FA')).toBe('CS-001/A');
    expect(poleFromSearch('?tru=Tr%E1%BB%A5%2012%20(L%C3%AA%20L%E1%BB%A3i)')).toBe('Trụ 12 (Lê Lợi)');
  });
  it('ô CSV bắt đầu bằng = + - @ được vô hiệu hoá công thức', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('CS-001')).toBe('CS-001');
    const out = reportsToCsv([{ id: 'r', kind: 'den_tat', lat: 10.77, lng: 106.7, t: 0, pole: '=cmd' }]);
    expect(out).toContain("'=cmd");
    const pc = patrolCsv([{ code: '+x', lat: 10.77, lng: 106.7 }], []);
    expect(pc).toContain("'+x");
  });
  it('mã trụ dài bị cắt 60 ký tự; báo mã trùng', () => {
    const p = parsePoles(`ma,lat,lng\n${'A'.repeat(80)},10.77,106.7\nB,10.77,106.7\nB,10.771,106.7\n`);
    expect(p[0].code).toHaveLength(60);
    expect(dupCodes(p)).toEqual(['B']);
  });
});

describe('tuần tra: trụ đang hiện không bị đổi giữa lúc nhìn và lúc bấm', () => {
  const poles: Pole[] = [
    { code: 'A', lat: 10.77, lng: 106.7 },
    { code: 'B', lat: 10.77 + 40 * M, lng: 106.7 },
  ];
  it('vừa qua A (cách 5 m rồi 15 m phía sau) → vẫn giữ A trong 4 s', () => {
    const tr = new PoleTracker();
    expect(tr.update(poles, { lat: 10.77 - 5 * M, lng: 106.7 }, 0, new Set(), 0)?.pole.code).toBe('A');
    expect(tr.update(poles, { lat: 10.77 + 10 * M, lng: 106.7 }, 0, new Set(), 1000)?.pole.code).toBe('A');
    expect(tr.update(poles, { lat: 10.77 + 15 * M, lng: 106.7 }, 0, new Set(), 2000)?.pole.code).toBe('A');
  });
  it('quá 4 s và đã cách xa > 60 m → chuyển trụ kế', () => {
    const tr = new PoleTracker();
    tr.update(poles, { lat: 10.77 - 5 * M, lng: 106.7 }, 0, new Set(), 0);
    expect(tr.update(poles, { lat: 10.77 + 65 * M, lng: 106.7 }, 0, new Set(), 6000)).toBeNull();
    expect(tr.update(poles, { lat: 10.77 + 25 * M, lng: 106.7 }, 0, new Set(), 6000)?.pole.code).toBe('B');
  });
  it('đã bấm A → chuyển ngay', () => {
    const tr = new PoleTracker();
    tr.update(poles, { lat: 10.77 - 5 * M, lng: 106.7 }, 0, new Set(), 0);
    expect(tr.update(poles, { lat: 10.77 + 10 * M, lng: 106.7 }, 0, new Set(['A']), 500)?.pole.code).toBe('B');
  });
});

describe('nhận dạng biển: chặt hơn', () => {
  it('cần ≥ 3 trong 5 khung gần nhất', () => {
    const v = new SignVoter();
    expect(v.push(60)).toBeNull();
    expect(v.push(60)).toBeNull();
    expect(v.push(60)).toBe(60);
    const w = new SignVoter();
    expect([w.push(80), w.push(null), w.push(80), w.push(null)]).toEqual([null, null, null, null]);
  });
});

import { parseHgv } from '../src/pipeline/hgv';
describe('hgv=no kèm "yes @ (giờ)" → chỉ cấm ngoài giờ được phép', () => {
  it('cho phép 21:00–06:00 → cấm 06:00–21:00', () => {
    expect(parseHgv({ hgv: 'no', 'hgv:conditional': 'yes @ (21:00-06:00)' })).toEqual([[360, 1260]]);
  });
  it('cho phép 22:00–05:00 và 11:00-13:00', () => {
    expect(parseHgv({ hgv: 'no', 'hgv:conditional': 'yes @ (11:00-13:00,22:00-05:00)' })).toEqual([[300, 660], [780, 1320]]);
  });
  it('điều kiện lạ → vẫn coi như cấm mọi lúc', () => {
    expect(parseHgv({ hgv: 'no', 'hgv:conditional': 'yes @ (Mo-Fr)' })).toEqual([[0, 1440]]);
  });
});
