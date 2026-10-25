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
  kind        text not null check (kind in ('den_tat', 'su_co', 'ngap')),
  pole        text check (char_length(pole) <= 60),
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
grant insert (id, kind, pole, lat, lng, dir, device, t_client) on table public.lat_reports to anon;
drop policy if exists lat_reports_insert on public.lat_reports;
create policy lat_reports_insert on public.lat_reports for insert to anon with check (status = 'moi');
-- Nếu đã tạo bảng từ bản trước: alter table public.lat_reports add column if not exists pole text check (char_length(pole) <= 60);
--   alter table public.lat_reports drop constraint lat_reports_kind_check; alter table public.lat_reports add constraint lat_reports_kind_check check (kind in ('den_tat','su_co','ngap'));
-- Xem báo cáo mới: select * from public.lat_reports where status = 'moi' order by created_at desc;

-- =====================================================================
-- Đội xe: vị trí theo mã đội. Bảng khoá kín; chỉ truy cập qua các hàm, phải biết mã đội (bí mật, do app sinh ngẫu nhiên).
-- Mã thiết bị cũng là bí mật riêng của máy: máy chủ chỉ lưu băm, nên người cùng đội không giả vị trí xe khác được.
-- =====================================================================
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.lat_fleet (
  team_hash   text not null,
  device_hash text not null,
  name        text check (char_length(name) <= 40),
  lat         double precision not null check (lat between 8 and 24),
  lng         double precision not null check (lng between 102 and 110),
  speed       integer,
  heading     integer,
  updated_at  timestamptz not null default now(),
  primary key (team_hash, device_hash)
);
alter table public.lat_fleet enable row level security;
revoke all on table public.lat_fleet from anon, authenticated;

create or replace function public.fleet_ping(p_team text, p_device text, p_name text, p_lat double precision, p_lng double precision, p_speed integer, p_heading integer)
returns void language plpgsql security definer set search_path = '' as $$
declare th text; dh text; n int;
begin
  if p_team !~ '^[A-Za-z0-9_-]{8,40}$' then raise exception 'mã đội không hợp lệ'; end if;
  if p_device !~ '^[A-Za-z0-9_-]{8,64}$' then raise exception 'mã thiết bị không hợp lệ'; end if;
  th := encode(extensions.digest(p_team, 'sha256'), 'hex');
  dh := encode(extensions.digest(p_team || '|' || p_device, 'sha256'), 'hex');
  -- dọn dòng cũ của đội này (không cần pg_cron)
  delete from public.lat_fleet where team_hash = th and updated_at < now() - interval '24 hours';
  select count(*) into n from public.lat_fleet where team_hash = th and device_hash <> dh;
  if n >= 50 then raise exception 'đội đã đủ 50 xe'; end if;
  insert into public.lat_fleet (team_hash, device_hash, name, lat, lng, speed, heading, updated_at)
  values (th, dh, left(p_name, 40), p_lat, p_lng, p_speed, p_heading, now())
  on conflict (team_hash, device_hash) do update
    set name = excluded.name, lat = excluded.lat, lng = excluded.lng, speed = excluded.speed, heading = excluded.heading, updated_at = now();
end $$;

-- Trả về mã xe rút gọn (8 ký tự băm), không trả mã thiết bị thật.
create or replace function public.fleet_list(p_team text)
returns table (device text, name text, lat double precision, lng double precision, speed integer, heading integer, updated_at timestamptz)
language sql security definer set search_path = '' as $$
  select left(device_hash, 8), name, lat, lng, speed, heading, updated_at from public.lat_fleet
  where team_hash = encode(extensions.digest(p_team, 'sha256'), 'hex') and updated_at > now() - interval '12 hours'
  order by updated_at desc;
$$;

-- Tắt chia sẻ: xoá ngay dòng của chính máy mình.
create or replace function public.fleet_leave(p_team text, p_device text)
returns void language sql security definer set search_path = '' as $$
  delete from public.lat_fleet
  where team_hash = encode(extensions.digest(p_team, 'sha256'), 'hex')
    and device_hash = encode(extensions.digest(p_team || '|' || p_device, 'sha256'), 'hex');
$$;

revoke all on function public.fleet_ping(text, text, text, double precision, double precision, integer, integer) from public;
revoke all on function public.fleet_list(text) from public;
revoke all on function public.fleet_leave(text, text) from public;
grant execute on function public.fleet_ping(text, text, text, double precision, double precision, integer, integer) to anon;
grant execute on function public.fleet_list(text) to anon;
grant execute on function public.fleet_leave(text, text) to anon;

-- =====================================================================
-- Rút lại dấu camera bấm nhầm: chỉ xoá dấu CHƯA DUYỆT do chính máy đó gửi (khớp mã máy).
create or replace function public.lat_mark_withdraw(p_ids text[], p_device text)
returns integer
language sql
security definer
set search_path = ''
as $$
  with d as (
    delete from public.lat_camera_marks
    where id = any (p_ids[1:200])
      and device = p_device
      and char_length(p_device) between 8 and 40
      and status = 'moi'
    returning 1
  )
  select count(*)::integer from d;
$$;
revoke all on function public.lat_mark_withdraw(text[], text) from public;
grant execute on function public.lat_mark_withdraw(text[], text) to anon;

-- =====================================================================
-- Góp ý & đánh giá của người dùng gửi người phát triển (khoá công khai chỉ được GỬI, không đọc)
create table if not exists public.lat_feedback (
  id          text primary key check (char_length(id) between 3 and 40),
  rating      integer check (rating between 1 and 5),
  kind        text not null check (kind in ('de_xuat', 'loi', 'sai_toc_do', 'sai_camera', 'khac')),
  text        text not null default '' check (char_length(text) <= 2000),
  lat         double precision check (lat between -90 and 90),
  lng         double precision check (lng between -180 and 180),
  ctx         jsonb not null default '{}'::jsonb check (pg_column_size(ctx) <= 2000),
  app_build   text check (char_length(app_build) <= 40),
  device      text check (char_length(device) <= 40),
  t_client    bigint,
  status      text not null default 'moi' check (status in ('moi', 'dang_xu_ly', 'da_xu_ly', 'bo_qua')),
  note        text,
  created_at  timestamptz not null default now(),
  check (rating is not null or char_length(text) > 0)
);
create index if not exists lat_feedback_created_idx on public.lat_feedback (created_at desc);
alter table public.lat_feedback enable row level security;
revoke all on table public.lat_feedback from anon, authenticated;
grant insert (id, rating, kind, text, lat, lng, ctx, app_build, device, t_client) on table public.lat_feedback to anon;
drop policy if exists lat_feedback_insert on public.lat_feedback;
create policy lat_feedback_insert on public.lat_feedback for insert to anon with check (status = 'moi');

-- Người phát triển xem (Table Editor hoặc SQL Editor):
--   select created_at, rating, kind, text, ctx, lat, lng, app_build from public.lat_feedback where status = 'moi' order by created_at desc;
-- Tổng hợp số sao theo tuần:
--   select date_trunc('week', created_at) tuan, count(*) so_luot, round(avg(rating), 2) sao_tb from public.lat_feedback group by 1 order by 1 desc;
-- Đánh dấu đã xử lý:
--   update public.lat_feedback set status = 'da_xu_ly', note = 'Đã sửa ở bản ...' where id = '...';
