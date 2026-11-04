/** Thẻ dẫn đường (C1/C2): biểu tượng theo loại rẽ, lời ngắn, tên đường không bị cắt. Mã loại theo Valhalla. */
export type IconKind = 'straight' | 'slight-right' | 'right' | 'sharp-right' | 'uturn' | 'slight-left' | 'left' | 'sharp-left' | 'roundabout' | 'arrive' | 'depart' | 'merge' | 'keep-right' | 'keep-left';

export interface ManeuverLike {
  type: number;
  text: string;
  streets?: string[];
}

const KIND: Record<number, IconKind> = {
  1: 'depart', 2: 'depart', 3: 'depart',
  4: 'arrive', 5: 'arrive', 6: 'arrive',
  7: 'straight', 8: 'straight', 17: 'straight', 22: 'straight',
  9: 'slight-right', 10: 'right', 11: 'sharp-right', 12: 'uturn', 13: 'uturn', 14: 'sharp-left', 15: 'left', 16: 'slight-left',
  18: 'slight-right', 19: 'slight-left', 20: 'slight-right', 21: 'slight-left', 23: 'keep-right', 24: 'keep-left',
  25: 'merge', 37: 'merge', 38: 'merge', 26: 'roundabout', 27: 'roundabout',
};

const ACTION: Record<number, string> = {
  1: 'Xuất phát', 2: 'Xuất phát', 3: 'Xuất phát', 4: 'Đến nơi', 5: 'Đến nơi', 6: 'Đến nơi',
  7: 'Đi tiếp', 8: 'Đi thẳng', 9: 'Chếch phải', 10: 'Rẽ phải', 11: 'Rẽ gắt phải', 12: 'Quay đầu', 13: 'Quay đầu',
  14: 'Rẽ gắt trái', 15: 'Rẽ trái', 16: 'Chếch trái', 17: 'Lên nhánh', 18: 'Lên nhánh phải', 19: 'Lên nhánh trái',
  20: 'Ra lối phải', 21: 'Ra lối trái', 22: 'Đi thẳng', 23: 'Giữ bên phải', 24: 'Giữ bên trái', 25: 'Nhập làn',
  26: 'Vào vòng xoay', 27: 'Ra vòng xoay', 28: 'Lên phà', 29: 'Rời phà', 37: 'Nhập làn', 38: 'Nhập làn',
};

export const iconKind = (type: number): IconKind => KIND[type] ?? 'straight';
export const actionText = (type: number): string => ACTION[type] ?? 'Đi tiếp';

/** "Đường Nguyễn Thị Đặng" → "Nguyễn Thị Đặng" (biển tên đường không ghi chữ "Đường"). */
export function shortStreet(name: string): string {
  return name.trim().replace(/^đường\s+/i, '').trim();
}

/** Một dòng cho thẻ: "Rẽ phải · Tên đường"; quá dài thì chỉ tên đường (không cắt tên). */
export function cardLine(m: ManeuverLike, maxChars = 26): string {
  const streets = (m.streets ?? []).map(shortStreet).filter(Boolean).slice(0, 2);
  const act = actionText(m.type);
  if (iconKind(m.type) === 'arrive') return 'Đến nơi';
  if (!streets.length) return act;
  const name = streets.join(' · ');
  const full = `${act} · ${name}`;
  return full.length <= maxChars ? full : name;
}

/** Dòng "rồi …" khi bước sau đến sát (dưới 300 m). */
export function nextLine(after: ManeuverLike | null, gapM: number): string {
  if (!after || !(gapM < 300)) return '';
  return `rồi ${cardLine(after, 40)}`;
}

const P: Record<IconKind, string> = {
  straight: '<path d="M32 58V10"/><path d="M18 24 32 10l14 14"/>',
  depart: '<path d="M32 58V10"/><path d="M18 24 32 10l14 14"/>',
  right: '<path d="M20 58V32a8 8 0 0 1 8-8h22"/><path d="M38 12l12 12-12 12"/>',
  left: '<path d="M44 58V32a8 8 0 0 0-8-8H14"/><path d="M26 12 14 24l12 12"/>',
  'slight-right': '<path d="M24 58V36l20-20"/><path d="M30 14h16v16"/>',
  'slight-left': '<path d="M40 58V36L20 16"/><path d="M34 14H18v16"/>',
  'sharp-right': '<path d="M22 58V18l26 26"/><path d="M48 28v16H32"/>',
  'sharp-left': '<path d="M42 58V18L16 44"/><path d="M16 28v16h16"/>',
  uturn: '<path d="M42 58V24a10 10 0 0 0-20 0v20"/><path d="M12 34l10 12 10-12"/>',
  roundabout: '<circle cx="32" cy="30" r="10"/><path d="M32 58V40"/><path d="M39 23l9-9"/><path d="M38 14h10v10"/>',
  arrive: '<path d="M32 58V30"/><path d="M32 8a10 10 0 0 1 10 10c0 8-10 14-10 14S22 26 22 18A10 10 0 0 1 32 8z"/>',
  merge: '<path d="M20 58V40l12-12V10"/><path d="M44 58V40L32 28"/><path d="M22 20 32 10l10 10"/>',
  'keep-right': '<path d="M24 58V30l16-14V8"/><path d="M30 18l10-10 10 10"/>',
  'keep-left': '<path d="M40 58V30L24 16V8"/><path d="M14 18 24 8l10 10"/>',
};

/** SVG mũi tên rẽ (vẽ nét trắng, khung 64). */
export function iconSvg(kind: IconKind, size = 64): string {
  return `<svg class="nav-icon" aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round">${P[kind]}</svg>`;
}
