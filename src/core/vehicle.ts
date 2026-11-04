/** Loại xe — ảnh hưởng tốc độ ước tính theo luật và cách tìm đường. */
export const VEHICLES = ['car', 'motorbike', 'moped', 'truck', 'bus', 'trailer'] as const;
export type Vehicle = (typeof VEHICLES)[number];

export const VEHICLE_LABEL: Record<Vehicle, string> = {
  car: 'Ô tô con (đến 28 chỗ, tải đến 3,5 tấn)',
  motorbike: 'Xe mô tô (xe máy)',
  moped: 'Xe gắn máy (đến 50 cc, xe đạp máy)',
  truck: 'Xe khách trên 28 chỗ, xe tải trên 3,5 tấn',
  bus: 'Xe buýt, đầu kéo sơ mi rơ moóc',
  trailer: 'Ô tô kéo rơ moóc, xi téc, trộn bê tông',
};

export const isVehicle = (v: unknown): v is Vehicle => typeof v === 'string' && (VEHICLES as readonly string[]).includes(v);
/** Xe hai bánh: theo làn hỗn hợp, cảm biến va chạm riêng. */
export const isTwoWheel = (v: Vehicle) => v === 'motorbike' || v === 'moped';
/** Xe lớn: chịu biển cấm xe tải theo giờ. */
export const isHeavy = (v: Vehicle) => v === 'truck' || v === 'bus' || v === 'trailer';

/**
 * Giới hạn ngoài khu đông dân cư [đường đôi, đường hai chiều] theo Điều 7
 * (VBHN 74/2026/VBHN-TT-BXD hợp nhất TT 38/2024/TT-BGTVT và TT 09/2025/TT-BXD).
 */
export const OUTSIDE_LIMITS: Record<Vehicle, [number, number]> = {
  car: [90, 80],
  motorbike: [70, 60],
  moped: [40, 40],
  truck: [80, 70],
  bus: [70, 60],
  trailer: [60, 50],
};

/** Xe gắn máy (Điều 8): tối đa 40 km/h trên mọi tuyến. */
export const VEHICLE_CAP: Partial<Record<Vehicle, number>> = { moped: 40 };

/** Kiểu tìm đường của Valhalla. */
export const COSTING: Record<Vehicle, string> = { car: 'auto', motorbike: 'motorcycle', moped: 'motor_scooter', truck: 'truck', bus: 'bus', trailer: 'truck' };
