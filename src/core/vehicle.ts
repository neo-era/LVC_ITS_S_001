/** Loại xe — ảnh hưởng tốc độ ước tính theo luật và cách tìm đường. */
export const VEHICLES = ['car', 'motorbike', 'truck', 'bus'] as const;
export type Vehicle = (typeof VEHICLES)[number];

export const VEHICLE_LABEL: Record<Vehicle, string> = {
  car: 'Ô tô con (đến 28 chỗ, tải đến 3,5 tấn)',
  motorbike: 'Xe mô tô (xe máy)',
  truck: 'Xe khách trên 28 chỗ, xe tải trên 3,5 tấn',
  bus: 'Xe buýt, đầu kéo sơ mi rơ moóc',
};

export const isVehicle = (v: unknown): v is Vehicle => typeof v === 'string' && (VEHICLES as readonly string[]).includes(v);

/** Giới hạn ngoài khu đông dân cư [đường đôi, đường hai chiều] theo Điều 7 (VBHN 74/2026/VBHN-BXD). */
export const OUTSIDE_LIMITS: Record<Vehicle, [number, number]> = {
  car: [90, 80],
  motorbike: [70, 60],
  truck: [80, 70],
  bus: [70, 60],
};

/** Kiểu tìm đường của Valhalla. */
export const COSTING: Record<Vehicle, string> = { car: 'auto', motorbike: 'motorcycle', truck: 'truck', bus: 'bus' };
