/**
 * Tốc độ tối đa theo BIỂN BÁO THẬT do cơ quan chức năng công bố cho các tuyến lớn mà OpenStreetMap còn thiếu.
 * Áp lúc dựng dữ liệu (ghi đè maxspeed của OSM trên đúng đoạn, đúng khu vực).
 * mixed = làn hỗn hợp (xe máy đi chung); car = làn dành cho ô tô (nếu tuyến có tách làn).
 * Chỉ thêm khi có nguồn công khai; biển báo thực tế trên đường luôn ưu tiên. Nguồn cũ cần rà lại định kỳ.
 */
import { foldName } from './names';

export interface PostedLimit {
  mixed: number;
  car?: number;
}

interface Rule extends PostedLimit {
  id: string;
  /** tên đường (đã bỏ dấu, chữ thường), so khớp "chứa" */
  names: string[];
  /** số hiệu (ref) đã chuẩn hoá: "ql22" */
  refs: string[];
  box: { s: number; w: number; n: number; e: number };
  source: { title: string; url: string; date: string };
}

export const POSTED_RULES: Rule[] = [
  {
    id: 'ql22-hocmon',
    names: ['quoc lo 22'],
    refs: ['ql22'],
    // đoạn từ cầu An Hạ về nút An Sương (địa bàn Hóc Môn cũ)
    box: { s: 10.83, w: 106.53, n: 10.93, e: 106.635 },
    mixed: 50,
    car: 60,
    source: {
      title: 'Phòng CSGT Công an TP.HCM — Đội CSGT An Sương xử lý chạy quá tốc độ trên QL22',
      url: 'https://csgt-congan.hochiminhcity.gov.vn/wps/portal/Home/trang-chu/noi-dung-chi-tiet/tin-tuc-hoat-dong/as_phongnhanh2024',
      date: '2024-06-11',
    },
  },
  {
    id: 'vvk-ql1-logom',
    names: ['vo van kiet'],
    refs: [],
    // đoạn từ Quốc lộ 1 (An Lạc) tới cầu Lò Gốm
    box: { s: 10.715, w: 106.595, n: 10.76, e: 106.642 },
    mixed: 60,
    car: 80,
    source: {
      title: 'Thanh Niên — Nhiều đường ở TP.HCM cho ô tô chạy 80 km/giờ (áp dụng từ 1.3.2016)',
      url: 'https://thanhnien.vn/nhieu-duong-o-tphcm-cho-o-to-chay-80-kmgio-185542473.htm',
      date: '2016-03-02',
    },
  },
];

// không áp cho cao tốc (vd cầu vượt Vành đai 3 tên "Cầu vượt Quốc lộ 22")
const MAIN = new Set(['trunk', 'primary', 'secondary', 'tertiary']);
const normRef = (r: string) => r.toLowerCase().replace(/[^a-z0-9;]/g, '');

export function matchPosted(tags: Record<string, string | undefined>, lat: number, lng: number): PostedLimit | null {
  if (!MAIN.has(tags.highway ?? '')) return null;
  const name = foldName(`${tags['name:vi'] ?? ''} ${tags.name ?? ''}`);
  const refs = normRef(tags.ref ?? '').split(';').filter(Boolean);
  for (const r of POSTED_RULES) {
    const { s, w, n, e } = r.box;
    if (lat < s || lat > n || lng < w || lng > e) continue;
    // đường có số hiệu khác (vd CT.40) thì không khớp theo tên
    const byRef = r.refs.some((x) => refs.includes(x));
    const byName = (refs.length === 0 || r.refs.length === 0) && r.names.some((x) => name.includes(x));
    if (byRef || byName) return r.car ? { mixed: r.mixed, car: r.car } : { mixed: r.mixed };
  }
  return null;
}
