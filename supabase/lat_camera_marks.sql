-- Lái An Toàn: dấu camera do người dùng đánh dấu ngoài đường.
-- Chạy một lần trong Supabase → SQL Editor của dự án "lai-an-toan".
-- Khoá công khai (anon) chỉ được GỬI dấu mới (trạng thái 'moi') và ĐỌC các dấu đã duyệt.
create table if not exists public.lat_camera_marks (
  id          text primary key check (char_length(id) between 3 and 40),
  type        text not null check (type in ('camera', 'blackspot')),
  lat         double precision not null check (lat between 8 and 24),
  lng         double precision not null check (lng between 102 and 110),
  dir         integer check (dir between 0 and 360),
  device      text check (char_length(device) <= 40),
  t_client    bigint,
  status      text not null default 'moi' check (status in ('moi', 'duyet', 'tu_choi')),
  created_at  timestamptz not null default now()
);

create index if not exists lat_camera_marks_status_idx on public.lat_camera_marks (status);

alter table public.lat_camera_marks enable row level security;

revoke all on table public.lat_camera_marks from anon, authenticated;
grant insert (id, type, lat, lng, dir, device, t_client) on table public.lat_camera_marks to anon;
grant select (id, type, lat, lng, dir) on table public.lat_camera_marks to anon;

drop policy if exists lat_marks_insert_new on public.lat_camera_marks;
create policy lat_marks_insert_new on public.lat_camera_marks
  for insert to anon
  with check (status = 'moi');

drop policy if exists lat_marks_read_approved on public.lat_camera_marks;
create policy lat_marks_read_approved on public.lat_camera_marks
  for select to anon
  using (status = 'duyet');

-- Duyệt một dấu (sau khi kiểm tra đúng vị trí):
--   update public.lat_camera_marks set status = 'duyet' where id = '...';
-- Xem các dấu mới chờ duyệt:
--   select id, type, lat, lng, dir, device, created_at from public.lat_camera_marks where status = 'moi' order by created_at;
