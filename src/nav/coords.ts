/**
 * Đọc toạ độ người dùng gõ/dán vào ô tìm kiếm:
 *  - "11.06176, 106.529633", "(11.06, 106.52)", "11.06 106.52", "11,06176 106,529633" (phẩy thập phân)
 *  - độ phút giây: 11°03'42.3"N 106°31'46.7"E; độ phút: 10°46.188'N
 *  - link Google Maps (?q=, @lat,lng), OpenStreetMap (#map=z/lat/lng), geo:lat,lng
 * Gõ ngược (kinh độ trước) với điểm ở Việt Nam thì tự đảo lại. Không phải toạ độ → null.
 */
export interface LatLng {
  lat: number;
  lng: number;
}

const ok = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
const inVN = (lat: number, lng: number) => lat >= 7 && lat <= 24 && lng >= 101 && lng <= 118;

function finish(a: number, b: number): LatLng | null {
  // kinh độ VN (101–118) không thể là vĩ độ → nếu số đầu lọt vùng kinh độ VN và số sau lọt vùng vĩ độ VN thì đảo
  if (!inVN(a, b) && inVN(b, a)) [a, b] = [b, a];
  return ok(a, b) ? { lat: a, lng: b } : null;
}

function fromUrl(s: string): LatLng | null {
  const pats = [
    /[?&](?:q|query|ll|destination|daddr)=(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i,
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    /#map=\d+(?:\.\d+)?\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/,
    /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i,
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
  ];
  for (const re of pats) {
    const m = re.exec(s);
    if (m) return finish(Number(m[1]), Number(m[2]));
  }
  return null;
}

/** Một thành phần độ-phút-giây → số độ (có dấu theo N/S/E/W). */
function dms(part: string): number | null {
  const m = /^([NSEW])?\s*(\d+(?:[.,]\d+)?)\s*[°º˚d]\s*(?:(\d+(?:[.,]\d+)?)\s*['′’m]\s*)?(?:(\d+(?:[.,]\d+)?)\s*(?:["″”]|''|s)\s*)?([NSEW])?$/i.exec(part.trim());
  if (!m) return null;
  const n = (x?: string) => (x ? Number(x.replace(',', '.')) : 0);
  let v = n(m[2]) + n(m[3]) / 60 + n(m[4]) / 3600;
  const h = (m[1] || m[5] || '').toUpperCase();
  if (h === 'S' || h === 'W') v = -v;
  return v;
}

export function parseCoords(input: string): LatLng | null {
  const s = input.trim();
  if (!s) return null;
  if (/^(https?:|geo:)/i.test(s)) return fromUrl(s);

  // độ phút giây: tách tại chỗ kết thúc bằng N/S (hoặc dấu phẩy/chấm phẩy giữa hai cụm có ký hiệu độ)
  if (/[°º˚]/.test(s)) {
    const m = /^(.*?[NS])\s*[,;]?\s*(.*[EW])$/i.exec(s) ?? /^(.*?)\s*[,;]\s*(.*)$/.exec(s);
    if (!m) return null;
    const a = dms(m[1]);
    const b = dms(m[2]);
    return a !== null && b !== null ? finish(a, b) : null;
  }

  // bỏ ngoặc, chữ N/E kiểu "N 10.77 E 106.7"
  const t = s.replace(/^[([{]\s*|\s*[)\]}]$/g, '').replace(/\b[NSEW]\b/gi, ' ').trim();
  // hai số thập phân, ngăn bởi dấu phẩy/chấm phẩy/khoảng trắng; số có thể dùng phẩy thập phân
  const num = String.raw`-?\d{1,3}(?:[.,]\d+)?`;
  const m = new RegExp(String.raw`^(${num})\s*(?:[;]|,\s|\s+|,)\s*(${num})$`).exec(t);
  if (!m) return null;
  // ít nhất một số phải có phần thập phân (tránh nhầm "16 18", "1, 22" là địa chỉ)
  if (!/[.,]\d/.test(m[1]) && !/[.,]\d/.test(m[2])) return null;
  const a = Number(m[1].replace(',', '.'));
  const b = Number(m[2].replace(',', '.'));
  return finish(a, b);
}

/** Link rút gọn của Google Maps (cần mở qua máy chủ mới biết toạ độ). */
export function isShortMapLink(s: string): boolean {
  return /^https:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs)\//i.test(s.trim());
}
