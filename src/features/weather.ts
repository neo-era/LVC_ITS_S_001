/** Khuyến nghị giảm tốc theo thời tiết (Open-Meteo, miễn phí, không cần khoá). Đây là khuyến nghị của app, không phải biển báo. */
export interface WeatherNow {
  code: number | null;
  rainMm: number | null;
  visibilityM: number | null;
}
export interface Advice {
  level: 'none' | 'rain' | 'heavy_rain' | 'storm' | 'fog';
  reduceKmh: number;
  text: string;
}

export function weatherUrl(lat: number, lng: number): string {
  const u = new URL('https://api.open-meteo.com/v1/forecast');
  u.searchParams.set('latitude', lat.toFixed(2));
  u.searchParams.set('longitude', lng.toFixed(2));
  u.searchParams.set('current', 'precipitation,rain,weather_code,visibility,wind_speed_10m');
  return u.toString();
}

export function weatherAdvice(w: WeatherNow): Advice {
  const c = w.code ?? -1;
  const r = w.rainMm ?? 0;
  const v = w.visibilityM ?? Infinity;
  if (c >= 95) return { level: 'storm', reduceKmh: 20, text: 'Có giông — nên giảm 20 km/h, giữ khoảng cách xa hơn' };
  if ([65, 67, 82].includes(c) || r >= 7.6) return { level: 'heavy_rain', reduceKmh: 20, text: 'Mưa to — nên giảm 20 km/h, đường trơn' };
  if ([45, 48].includes(c) || v < 1000) return { level: 'fog', reduceKmh: 20, text: 'Tầm nhìn kém — nên giảm 20 km/h, bật đèn' };
  if ([61, 63, 66, 80, 81].includes(c) || r >= 2.5) return { level: 'rain', reduceKmh: 10, text: 'Đang mưa — nên giảm 10 km/h' };
  return { level: 'none', reduceKmh: 0, text: '' };
}
