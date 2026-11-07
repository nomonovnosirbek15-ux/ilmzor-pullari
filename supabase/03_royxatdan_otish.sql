-- =====================================================================
--  ILMZOR PULLARI — 3-qism: O'QUVCHI O'ZI RO'YXATDAN O'TADI, O'QITUVCHI TASDIQLAYDI
-- =====================================================================

alter table public.profiles add column if not exists requested_group bigint references public.groups(id) on delete set null;

-- Yangi akkaunt: ism va so'ralgan guruh ro'yxatdan o'tish formasidan olinadi
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_role  user_role := 'pending';
  v_group bigint;
  v_raw   text := new.raw_user_meta_data->>'group_id';
begin
  if not exists (select 1 from profiles where role = 'admin') then
    v_role := 'admin';
  end if;
  if v_raw ~ '^\d{1,18}$' then
    select id into v_group from groups where id = v_raw::bigint;
  end if;
  insert into profiles (id, username, full_name, role, requested_group)
  values (new.id,
          lower(split_part(new.email, '@', 1)),
          left(trim(coalesce(new.raw_user_meta_data->>'full_name', '')), 80),
          v_role, v_group);
  return new;
end $$;

-- Ro'yxatdan o'tish oynasi uchun guruhlar ro'yxati (kirmasdan ham ko'rinadi)
create or replace function public.public_groups()
returns table(id bigint, name text, teacher text)
language sql stable security definer set search_path = public as $$
  select g.id, g.name, coalesce(p.full_name, '') from groups g left join profiles p on p.id = g.teacher_id order by g.name;
$$;
grant execute on function public.public_groups() to anon, authenticated;

-- Tasdiqlash: admin — istalgan guruhga, o'qituvchi — faqat o'z guruhiga
create or replace function public.approve_registration(p_user uuid, p_group bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v_role user_role := my_role();
begin
  if v_role not in ('admin','teacher') then raise exception 'Bu amal uchun ruxsat yo''q'; end if;
  if not exists (select 1 from profiles where id = p_user and role = 'pending' and active) then
    raise exception 'So''rov topilmadi yoki allaqachon tasdiqlangan';
  end if;
  if p_group is null or not exists (select 1 from groups where id = p_group) then raise exception 'Guruhni tanlang'; end if;
  if v_role = 'teacher' and not exists (select 1 from groups where id = p_group and teacher_id = auth.uid()) then
    raise exception 'Faqat o''z guruhingizga qo''sha olasiz';
  end if;
  update profiles set role = 'student', requested_group = null where id = p_user;
  insert into group_members(group_id, student_id) values (p_group, p_user) on conflict do nothing;
end $$;

-- Rad etish: akkaunt butunlay o'chiriladi (login yana bo'sh bo'ladi)
create or replace function public.reject_registration(p_user uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
declare v_role user_role := my_role(); v_req bigint;
begin
  if v_role not in ('admin','teacher') then raise exception 'Bu amal uchun ruxsat yo''q'; end if;
  select requested_group into v_req from profiles where id = p_user and role = 'pending';
  if not found then raise exception 'So''rov topilmadi'; end if;
  if v_role = 'teacher' and not exists (select 1 from groups where id = v_req and teacher_id = auth.uid()) then
    raise exception 'Bu so''rov sizning guruhingizga emas';
  end if;
  delete from auth.users where id = p_user;
end $$;
