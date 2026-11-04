-- Lái An Toàn — bước 2 (chạy MỘT lần trong Supabase → SQL Editor → Run).
-- Các bảng đã được tạo sẵn. File này thêm 3 hàm có lệnh xoá nên công cụ tự động không chạy được:
--   1) Tắt chia sẻ đội xe: xoá vị trí của chính máy mình.
--   2) Rút lại dấu camera bấm nhầm (chỉ dấu chưa duyệt của chính máy đó).
--   3) Mỗi lần gửi vị trí đội xe thì dọn mọi vị trí cũ hơn 24 giờ.

create or replace function public.fleet_leave(p_team text, p_device text)
returns void language sql security definer set search_path = '' as $$
  delete from public.lat_fleet
  where team_hash = encode(extensions.digest(p_team, 'sha256'), 'hex')
    and device_hash = encode(extensions.digest(p_team || '|' || p_device, 'sha256'), 'hex');
$$;

create or replace function public.lat_mark_withdraw(p_ids text[], p_device text)
returns integer language sql security definer set search_path = '' as $$
  with d as (
    delete from public.lat_camera_marks
    where id = any (p_ids[1:200]) and device = p_device and char_length(p_device) between 8 and 40 and status = 'moi'
    returning 1
  )
  select count(*)::integer from d;
$$;

create or replace function public.fleet_ping(p_team text, p_device text, p_name text, p_lat double precision, p_lng double precision, p_speed integer, p_heading integer)
returns void language plpgsql security definer set search_path = '' as $$
declare th text; dh text; n int;
begin
  if p_team !~ '^[A-Za-z0-9_-]{8,40}$' then raise exception 'mã đội không hợp lệ'; end if;
  if p_device !~ '^[A-Za-z0-9_-]{8,64}$' then raise exception 'mã thiết bị không hợp lệ'; end if;
  th := encode(extensions.digest(p_team, 'sha256'), 'hex');
  dh := encode(extensions.digest(p_team || '|' || p_device, 'sha256'), 'hex');
  delete from public.lat_fleet where updated_at < now() - interval '24 hours';
  select count(*) into n from public.lat_fleet where team_hash = th and device_hash <> dh;
  if n >= 50 then raise exception 'đội đã đủ 50 xe'; end if;
  insert into public.lat_fleet (team_hash, device_hash, name, lat, lng, speed, heading, updated_at)
  values (th, dh, left(p_name, 40), p_lat, p_lng, p_speed, p_heading, now())
  on conflict (team_hash, device_hash) do update
    set name = excluded.name, lat = excluded.lat, lng = excluded.lng, speed = excluded.speed, heading = excluded.heading, updated_at = now();
end $$;

revoke all on function public.fleet_leave(text, text) from public, authenticated;
revoke all on function public.lat_mark_withdraw(text[], text) from public, authenticated;
grant execute on function public.fleet_leave(text, text) to anon;
grant execute on function public.lat_mark_withdraw(text[], text) to anon;
