/**
 * Các tuyến đường được báo chí nêu là có camera phạt nguội ở TP.HCM.
 * LƯU Ý: đây chỉ là tên đường (không có toạ độ camera), tổng hợp từ các bài công khai,
 * có thể chưa đầy đủ hoặc đã thay đổi — app chỉ nhắc "tuyến này có camera", không báo khoảng cách.
 */
export const CAMERA_ROUTES_META = {
  updated: '2026-01',
  sources: [
    { title: 'Soha/VOV — Các điểm lắp camera phạt nguội tại TP.HCM', url: 'https://soha.vn/cac-diem-lap-camera-phat-nguoi-tai-tphcm-198250212105345598.htm', date: '2025-02-12' },
    { title: 'Thư Viện Pháp Luật — Danh sách 24 tuyến đường TPHCM lắp camera phạt nguội', url: 'https://thuvienphapluat.vn/banan/tin-tuc/danh-sach-24-tuyen-duong-tphcm-lap-camera-phat-nguoi-2025-13598', date: '2025-02-13' },
    { title: 'Thanh Niên — Danh sách các tuyến đường lắp camera AI phạt nguội tại TP.HCM', url: 'https://thanhnien.vn/danh-sach-cac-tuyen-duong-lap-camera-ai-phat-nguoi-tai-tphcm-185251011171857577.htm', date: '2025-10-12' },
  ],
} as const;

interface Box {
  s: number;
  w: number;
  n: number;
  e: number;
}

/** Khung gần đúng để tránh nhầm đường trùng tên ở nơi khác (vd: Lê Lợi ở Bình Dương). */
const AREAS = {
  hcm: { s: 10.6, w: 106.35, n: 11.1, e: 107.05 },
  core: { s: 10.735, w: 106.64, n: 10.835, e: 106.735 },
  thuduc: { s: 10.74, w: 106.7, n: 10.92, e: 106.92 },
  hocmon: { s: 10.85, w: 106.55, n: 10.95, e: 106.67 },
} satisfies Record<string, Box>;

type Area = keyof typeof AREAS;

const ROUTES: [name: string, area: Area][] = [
  ['xa lộ hà nội', 'hcm'], ['mai chí thọ', 'hcm'], ['võ văn kiệt', 'hcm'],
  ['quốc lộ 1', 'hcm'], ['quốc lộ 1a', 'hcm'], ['quốc lộ 22', 'hcm'],
  ['kinh dương vương', 'hcm'], ['nguyễn thị tú', 'hcm'], ['lê trọng tấn', 'hcm'],
  ['lê duẩn', 'core'], ['hai bà trưng', 'core'], ['phạm ngọc thạch', 'core'], ['lý tự trọng', 'core'],
  ['nam kỳ khởi nghĩa', 'core'], ['điện biên phủ', 'core'], ['nguyễn thái học', 'core'],
  ['nguyễn thị minh khai', 'core'], ['pasteur', 'core'], ['hùng vương', 'core'], ['nguyễn chí thanh', 'core'],
  ['nguyễn thị nghĩa', 'core'], ['lê lợi', 'core'], ['đinh tiên hoàng', 'core'], ['tôn đức thắng', 'core'],
  ['trường sơn', 'core'], ['an dương vương', 'core'], ['trần phú', 'core'], ['lê thánh tôn', 'core'],
  ['nguyễn huệ', 'core'], ['đồng khởi', 'core'], ['trương định', 'core'], ['cộng hòa', 'core'],
  ['hoàng văn thụ', 'core'], ['hồng hà', 'core'], ['bạch đằng', 'core'], ['đinh bộ lĩnh', 'core'],
  ['võ thị sáu', 'core'], ['nguyễn hữu cảnh', 'core'], ['xô viết nghệ tĩnh', 'core'],
  ['nguyễn thị định', 'thuduc'], ['đồng văn cống', 'thuduc'], ['nguyễn duy trinh', 'thuduc'], ['nguyễn xiển', 'thuduc'],
  ['đặng thúc vịnh', 'hocmon'],
];

const INDEX = new Map<string, Area[]>();
for (const [n, a] of ROUTES) INDEX.set(n, [...(INDEX.get(n) ?? []), a]);


/** Bỏ tiền tố (Đường, Đại lộ, Phố), gộp khoảng trắng, chữ thường. "Quốc lộ 1A" giữ nguyên số hiệu. */
export function normalizeRoadName(raw: string): string {
  const s = raw.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
  return s.replace(/^(đường|đại lộ|phố)\s+/, '');
}

const inBox = (b: Box, lat: number, lng: number) => lat >= b.s && lat <= b.n && lng >= b.w && lng <= b.e;

/** Tên đường (OSM) + vị trí → có thuộc tuyến camera phạt nguội đã công bố không. */
export function matchCameraRoute(name: string | undefined, lat: number, lng: number): boolean {
  if (!name) return false;
  const areas = INDEX.get(normalizeRoadName(name));
  return !!areas && areas.some((a) => inBox(AREAS[a], lat, lng));
}

