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

-- =====================================================================
-- Báo đèn tắt / sự cố chiếu sáng gửi từ xe (khoá công khai chỉ được GỬI, không đọc)
-- =====================================================================
create table if not exists public.lat_reports (
  id          text primary key check (char_length(id) between 3 and 40),
  kind        text not null check (kind in ('den_tat', 'su_co')),
  lat         double precision not null check (lat between 8 and 24),
  lng         double precision not null check (lng between 102 and 110),
  dir         integer check (dir between 0 and 360),
  device      text check (char_length(device) <= 40),
  t_client    bigint,
  status      text not null default 'moi' check (status in ('moi', 'da_xu_ly', 'tu_choi')),
  created_at  timestamptz not null default now()
);
alter table public.lat_reports enable row level security;
revoke all on table public.lat_reports from anon, authenticated;
grant insert (id, kind, lat, lng, dir, device, t_client) on table public.lat_reports to anon;
drop policy if exists lat_reports_insert on public.lat_reports;
create policy lat_reports_insert on public.lat_reports for insert to anon with check (status = 'moi');
-- Xem báo cáo mới: select * from public.lat_reports where status = 'moi' order by created_at desc;

-- =====================================================================
-- Đội xe: vị trí theo mã đội. Bảng khoá kín; chỉ truy cập qua 2 hàm, phải biết mã đội.
-- =====================================================================
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.lat_fleet (
  team_hash   text not null,
  device      text not null check (char_length(device) between 3 and 40),
  name        text check (char_length(name) <= 40),
  lat         double precision not null check (lat between 8 and 24),
  lng         double precision not null check (lng between 102 and 110),
  speed       integer,
  heading     integer,
  updated_at  timestamptz not null default now(),
  primary key (team_hash, device)
);
alter table public.lat_fleet enable row level security;
revoke all on table public.lat_fleet from anon, authenticated;

create or replace function public.fleet_ping(p_team text, p_device text, p_name text, p_lat double precision, p_lng double precision, p_speed integer, p_heading integer)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_team !~ '^[A-Za-z0-9_-]{8,40}$' then raise exception 'mã đội không hợp lệ'; end if;
  insert into public.lat_fleet (team_hash, device, name, lat, lng, speed, heading, updated_at)
  values (encode(digest(p_team, 'sha256'), 'hex'), p_device, left(p_name, 40), p_lat, p_lng, p_speed, p_heading, now())
  on conflict (team_hash, device) do update
    set name = excluded.name, lat = excluded.lat, lng = excluded.lng, speed = excluded.speed, heading = excluded.heading, updated_at = now();
end $$;

create or replace function public.fleet_list(p_team text)
returns table (device text, name text, lat double precision, lng double precision, speed integer, heading integer, updated_at timestamptz)
language sql security definer set search_path = public, extensions as $$
  select device, name, lat, lng, speed, heading, updated_at from public.lat_fleet
  where team_hash = encode(digest(p_team, 'sha256'), 'hex') and updated_at > now() - interval '12 hours'
  order by updated_at desc;
$$;

revoke all on function public.fleet_ping(text, text, text, double precision, double precision, integer, integer) from public;
revoke all on function public.fleet_list(text) from public;
grant execute on function public.fleet_ping(text, text, text, double precision, double precision, integer, integer) to anon;
grant execute on function public.fleet_list(text) to anon;
