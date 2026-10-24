/** Đổi style OpenFreeMap (lược đồ OpenMapTiles) sang nguồn ô bản đồ tự dựng + font/sprite đặt cùng trang. */
export const GLYPH_RANGES = ['0-255', '256-511', '512-767', '768-1023', '7680-7935', '8192-8447'];

export const ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank">© OpenMapTiles</a> Dữ liệu © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';

type Layer = { id: string; type: string; source?: string; layout?: Record<string, unknown> };

export function collectFontstacks(layers: Layer[]): string[] {
  const out = new Set<string>();
  const walk = (v: unknown): void => {
    if (!Array.isArray(v)) return;
    if (v.length && v.every((x) => typeof x === 'string') && v[0] !== 'literal') {
      out.add((v as string[]).join(','));
      return;
    }
    if (v[0] === 'literal' && Array.isArray(v[1])) return walk(v[1]);
    for (const x of v) walk(x);
  };
  for (const l of layers) {
    const tf = l.layout?.['text-font'];
    if (tf) walk(tf);
  }
  return [...out].filter((s) => !/^(get|case|match|step|coalesce)$/.test(s));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rewriteStyle(style: any, o: { tiles: string; glyphs: string; sprite: string }): any {
  const s = JSON.parse(JSON.stringify(style));
  const vecKey = Object.keys(s.sources).find((k) => s.sources[k].type === 'vector') ?? 'openmaptiles';
  s.sources = {
    [vecKey]: { type: 'vector', tiles: [o.tiles], minzoom: 0, maxzoom: 14, attribution: ATTRIBUTION },
  };
  s.layers = (s.layers as Layer[]).filter((l) => l.type === 'background' || l.source === vecKey);
  s.glyphs = o.glyphs;
  s.sprite = o.sprite;
  return s;
}
