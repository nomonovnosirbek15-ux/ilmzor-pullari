-- =====================================================================
--  ILMZOR PULLARI — ma'lumotlar bazasi
--  Supabase > SQL Editor ga butunligicha joylab, "Run" bosing.
--  Faqat bir marta ishga tushiriladi.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Turlar ----------
do $$ begin
  create type public.user_role as enum ('pending','admin','teacher','seller','student');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.tx_type as enum ('reward','purchase','allocation','adjustment');
exception when duplicate_object then null; end $$;

-- ---------- Jadvallar ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text unique,
  full_name   text not null default '',
  role        public.user_role not null default 'pending',
  balance     integer not null default 0 check (balance >= 0),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.groups (
  id          bigint generated always as identity primary key,
  name        text not null,
  teacher_id  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id    bigint not null references public.groups(id) on delete cascade,
  student_id  uuid   not null references public.profiles(id) on delete cascade,
  primary key (group_id, student_id)
);

-- Pul berish sabablari. fixed_amount bo'sh (null) bo'lsa — o'qituvchi summani o'zi yozadi.
create table if not exists public.reasons (
  id            bigint generated always as identity primary key,
  name          text not null,
  fixed_amount  integer check (fixed_amount is null or fixed_amount > 0),
  active        boolean not null default true,
  sort          integer not null default 0
);

create table if not exists public.shop_items (
  id          bigint generated always as identity primary key,
  name        text not null,
  category    text not null default 'Boshqa',
  price       integer not null check (price > 0),
  stock       integer not null default 0 check (stock >= 0),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.transactions (
  id          bigint generated always as identity primary key,
  type        public.tx_type not null,
  from_id     uuid references public.profiles(id) on delete set null,
  to_id       uuid references public.profiles(id) on delete set null,
  amount      integer not null check (amount > 0),
  reason_id   bigint references public.reasons(id) on delete set null,
  item_id     bigint references public.shop_items(id) on delete set null,
  quantity    integer,
  note        text,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists tx_to_idx   on public.transactions(to_id, created_at desc);
create index if not exists tx_from_idx on public.transactions(from_id, created_at desc);
create index if not exists tx_type_idx on public.transactions(type, created_at desc);

-- ---------- Yordamchi funksiyalar ----------
create or replace function public.my_role() returns public.user_role
language sql stable security definer set search_path = public as $$
  select coalesce((select role from profiles where id = auth.uid() and active), 'pending'::user_role);
$$;

create or replace function public.require_role(roles public.user_role[]) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.my_role() = any(roles)) then
    raise exception 'Bu amal uchun ruxsat yo''q';
  end if;
end $$;

-- Yangi akkaunt ochilganda profil yaratiladi.
-- Eng birinchi ro'yxatdan o'tgan foydalanuvchi avtomatik ADMIN bo'ladi.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_role user_role := 'pending';
begin
  if not exists (select 1 from profiles where role = 'admin') then
    v_role := 'admin';
  end if;
  insert into profiles (id, username, full_name, role)
  values (new.id,
          lower(split_part(new.email, '@', 1)),
          coalesce(new.raw_user_meta_data->>'full_name', ''),
          v_role);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Admin: foydalanuvchilarni boshqarish ----------
create or replace function public.admin_setup_user(p_user uuid, p_role public.user_role, p_full_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_role(array['admin']::user_role[]);
  if p_user = auth.uid() and p_role <> 'admin' then
    raise exception 'O''zingizning admin rolingizni o''zgartira olmaysiz';
  end if;
  update profiles set role = p_role, full_name = trim(p_full_name) where id = p_user;
end $$;

create or replace function public.admin_set_active(p_user uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_role(array['admin']::user_role[]);
  if p_user = auth.uid() then raise exception 'O''zingizni o''chira olmaysiz'; end if;
  update profiles set active = p_active where id = p_user;
end $$;

create or replace function public.admin_reset_password(p_user uuid, p_password text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform require_role(array['admin']::user_role[]);
  if length(p_password) < 6 then raise exception 'Parol kamida 6 belgi bo''lsin'; end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
         updated_at = now()
   where id = p_user;
end $$;

-- ---------- Pul oqimi ----------

-- Admin yoki sotuvchi o'qituvchining hisobiga pul ajratadi
create or replace function public.allocate_to_teacher(p_teacher uuid, p_amount integer, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_role(array['admin','seller']::user_role[]);
  if p_amount is null or p_amount <= 0 then raise exception 'Summa musbat bo''lishi kerak'; end if;
  if not exists (select 1 from profiles where id = p_teacher and role = 'teacher' and active) then
    raise exception 'O''qituvchi topilmadi';
  end if;
  update profiles set balance = balance + p_amount where id = p_teacher;
  insert into transactions(type, to_id, amount, note, created_by)
  values ('allocation', p_teacher, p_amount, p_note, auth.uid());
end $$;

-- O'qituvchi bir yoki bir nechta o'quvchiga pul beradi
create or replace function public.give_reward(p_students uuid[], p_reason bigint, p_amount integer default null, p_note text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_teacher uuid := auth.uid();
  v_reason  reasons%rowtype;
  v_amount  integer;
  v_total   integer;
  v_balance integer;
  v_student uuid;
  v_count   integer;
begin
  perform require_role(array['teacher']::user_role[]);

  select * into v_reason from reasons where id = p_reason and active;
  if not found then raise exception 'Sabab topilmadi'; end if;

  v_amount := coalesce(v_reason.fixed_amount, p_amount);   -- qat'iy summa bo'lsa, o'shani oladi
  if v_amount is null or v_amount <= 0 then raise exception 'Summani kiriting'; end if;

  select array_agg(distinct s) into p_students from unnest(p_students) s;
  v_count := coalesce(array_length(p_students, 1), 0);
  if v_count = 0 then raise exception 'O''quvchi tanlanmadi'; end if;

  -- faqat o'z guruhlaridagi faol o'quvchilarga
  if exists (
    select 1 from unnest(p_students) s
    where not exists (
      select 1 from group_members gm
      join groups g on g.id = gm.group_id
      join profiles p on p.id = gm.student_id
      where gm.student_id = s and g.teacher_id = v_teacher and p.role = 'student' and p.active)
  ) then
    raise exception 'Faqat o''z guruhingizdagi o''quvchilarga pul bera olasiz';
  end if;

  v_total := v_amount * v_count;
  select balance into v_balance from profiles where id = v_teacher for update;
  if v_balance < v_total then
    raise exception 'Hisobingizda yetarli pul yo''q (kerak: %, bor: %)', v_total, v_balance;
  end if;

  update profiles set balance = balance - v_total where id = v_teacher;
  foreach v_student in array p_students loop
    update profiles set balance = balance + v_amount where id = v_student;
    insert into transactions(type, from_id, to_id, amount, reason_id, note, created_by)
    values ('reward', v_teacher, v_student, v_amount, p_reason, p_note, v_teacher);
  end loop;
  return v_total;
end $$;

-- Sotuvchi (yoki admin) o'quvchiga do'kondan narsa sotadi
create or replace function public.sell_item(p_student uuid, p_item bigint, p_qty integer default 1)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_item  shop_items%rowtype;
  v_total integer;
  v_bal   integer;
begin
  perform require_role(array['seller','admin']::user_role[]);
  if p_qty is null or p_qty <= 0 then raise exception 'Miqdor noto''g''ri'; end if;

  select * into v_item from shop_items where id = p_item and active for update;
  if not found then raise exception 'Mahsulot topilmadi'; end if;
  if v_item.stock < p_qty then raise exception 'Omborda yetarli emas (bor: %)', v_item.stock; end if;

  select balance into v_bal from profiles where id = p_student and role = 'student' and active for update;
  if not found then raise exception 'O''quvchi topilmadi'; end if;

  v_total := v_item.price * p_qty;
  if v_bal < v_total then
    raise exception 'O''quvchida yetarli pul yo''q (kerak: %, bor: %)', v_total, v_bal;
  end if;

  update profiles set balance = balance - v_total where id = p_student;
  update shop_items set stock = stock - p_qty where id = p_item;
  insert into transactions(type, from_id, amount, item_id, quantity, created_by)
  values ('purchase', p_student, v_total, p_item, p_qty, auth.uid());
  return v_total;
end $$;

-- Admin istalgan hisobni tuzatadi (+ yoki -)
create or replace function public.adjust_balance(p_user uuid, p_delta integer, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_bal integer;
begin
  perform require_role(array['admin']::user_role[]);
  if p_delta is null or p_delta = 0 then raise exception 'Summa 0 bo''lmasin'; end if;
  select balance into v_bal from profiles where id = p_user for update;
  if not found then raise exception 'Foydalanuvchi topilmadi'; end if;
  if v_bal + p_delta < 0 then raise exception 'Balans manfiy bo''lib qoladi (bor: %)', v_bal; end if;
  update profiles set balance = balance + p_delta where id = p_user;
  insert into transactions(type, from_id, to_id, amount, note, created_by)
  values ('adjustment',
          case when p_delta < 0 then p_user end,
          case when p_delta > 0 then p_user end,
          abs(p_delta), p_note, auth.uid());
end $$;

-- ---------- Reyting ----------
-- p_period: 'week' | 'month' | 'all';  p_group: null = butun markaz
create or replace function public.leaderboard(p_period text default 'month', p_group bigint default null)
returns table(student_id uuid, full_name text, earned bigint, balance integer, place bigint)
language plpgsql stable security definer set search_path = public as $$
declare v_from timestamptz;
begin
  if my_role() = 'pending' then raise exception 'Ruxsat yo''q'; end if;
  v_from := case p_period
              when 'week'  then date_trunc('week',  now() at time zone 'Asia/Tashkent') at time zone 'Asia/Tashkent'
              when 'month' then date_trunc('month', now() at time zone 'Asia/Tashkent') at time zone 'Asia/Tashkent'
              else '-infinity'::timestamptz end;
  return query
  with st as (
    select p.id, p.full_name, p.balance from profiles p
    where p.role = 'student' and p.active
      and (p_group is null or exists (select 1 from group_members gm where gm.group_id = p_group and gm.student_id = p.id))
  ), e as (
    select st.id, st.full_name, st.balance,
           coalesce((select sum(t.amount) from transactions t
                     where t.to_id = st.id and t.type = 'reward' and t.created_at >= v_from), 0)::bigint as earned
    from st
  )
  select e.id, e.full_name, e.earned, e.balance, rank() over (order by e.earned desc)::bigint
  from e order by e.earned desc, e.full_name;
end $$;

-- ---------- Admin uchun statistika (infografika) ----------
create or replace function public.admin_stats()
returns json language plpgsql stable security definer set search_path = public as $$
declare
  v_month timestamptz := date_trunc('month', now() at time zone 'Asia/Tashkent') at time zone 'Asia/Tashkent';
  v_week  timestamptz := date_trunc('week',  now() at time zone 'Asia/Tashkent') at time zone 'Asia/Tashkent';
begin
  perform require_role(array['admin','seller']::user_role[]);
  return json_build_object(
    'students',        (select count(*) from profiles where role='student' and active),
    'teachers',        (select count(*) from profiles where role='teacher' and active),
    'groups',          (select count(*) from groups),
    'student_money',   (select coalesce(sum(balance),0) from profiles where role='student'),
    'teacher_money',   (select coalesce(sum(balance),0) from profiles where role='teacher'),
    'given_week',      (select coalesce(sum(amount),0) from transactions where type='reward' and created_at >= v_week),
    'given_month',     (select coalesce(sum(amount),0) from transactions where type='reward' and created_at >= v_month),
    'spent_month',     (select coalesce(sum(amount),0) from transactions where type='purchase' and created_at >= v_month),
    'by_reason',       (select coalesce(json_agg(x order by x.total desc), '[]'::json) from (
                          select r.name, sum(t.amount)::bigint as total
                          from transactions t join reasons r on r.id = t.reason_id
                          where t.type='reward' and t.created_at >= v_month
                          group by r.name) x),
    'by_teacher',      (select coalesce(json_agg(x order by x.total desc), '[]'::json) from (
                          select p.full_name as name, sum(t.amount)::bigint as total
                          from transactions t join profiles p on p.id = t.from_id
                          where t.type='reward' and t.created_at >= v_month
                          group by p.full_name) x),
    'top_items',       (select coalesce(json_agg(x order by x.qty desc), '[]'::json) from (
                          select i.name, sum(t.quantity)::bigint as qty
                          from transactions t join shop_items i on i.id = t.item_id
                          where t.type='purchase' and t.created_at >= v_month
                          group by i.name limit 5) x)
  );
end $$;

-- ---------- Xavfsizlik (RLS) ----------
alter table public.profiles      enable row level security;
alter table public.groups        enable row level security;
alter table public.group_members enable row level security;
alter table public.reasons       enable row level security;
alter table public.shop_items    enable row level security;
alter table public.transactions  enable row level security;

drop policy if exists "read profiles" on public.profiles;
create policy "read profiles" on public.profiles for select to authenticated
  using (id = auth.uid() or public.my_role() <> 'pending');

drop policy if exists "read groups" on public.groups;
create policy "read groups" on public.groups for select to authenticated using (public.my_role() <> 'pending');
drop policy if exists "admin groups" on public.groups;
create policy "admin groups" on public.groups for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

drop policy if exists "read members" on public.group_members;
create policy "read members" on public.group_members for select to authenticated using (public.my_role() <> 'pending');
drop policy if exists "admin members" on public.group_members;
create policy "admin members" on public.group_members for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

drop policy if exists "read reasons" on public.reasons;
create policy "read reasons" on public.reasons for select to authenticated using (public.my_role() <> 'pending');
drop policy if exists "admin reasons" on public.reasons;
create policy "admin reasons" on public.reasons for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

drop policy if exists "read items" on public.shop_items;
create policy "read items" on public.shop_items for select to authenticated using (public.my_role() <> 'pending');
drop policy if exists "manage items" on public.shop_items;
create policy "manage items" on public.shop_items for all to authenticated
  using (public.my_role() in ('admin','seller')) with check (public.my_role() in ('admin','seller'));

drop policy if exists "read tx" on public.transactions;
create policy "read tx" on public.transactions for select to authenticated
  using (from_id = auth.uid() or to_id = auth.uid() or public.my_role() in ('admin','seller'));
-- Balans va tranzaksiyalarga to'g'ridan-to'g'ri yozish taqiqlangan: faqat yuqoridagi funksiyalar orqali.
revoke insert, update, delete on public.profiles, public.transactions from anon, authenticated;
revoke all on function public.handle_new_user() from anon, authenticated, public;

-- Realtime (balans darhol yangilanishi uchun)
do $$ begin
  alter publication supabase_realtime add table public.profiles;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.transactions;
exception when others then null; end $$;

-- ---------- Boshlang'ich sabablar ----------
insert into public.reasons (name, fixed_amount, sort)
select * from (values
  ('Darsga kelgani (davomat)', 5, 1),
  ('Uy vazifasini bajargani', 10, 2),
  ('Qo''shimcha vazifa', null, 3),
  ('Lug''at yodlagani (ingliz tili)', null, 4),
  ('Namunali xulq', null, 5)
) v(name, fixed_amount, sort)
where not exists (select 1 from public.reasons);
