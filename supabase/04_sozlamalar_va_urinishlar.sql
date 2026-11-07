-- =====================================================================
--  ILMZOR PULLARI — 4-qism: SOZLAMALAR (RUXSATLAR), O'QITUVCHI GURUHLARI,
--  TESTNI QAYTA ISHLASH (eng yuqori ball uchun to'lov)
-- =====================================================================

-- ---------- Sozlamalar ----------
create table if not exists public.settings (
  key    text primary key,
  value  boolean not null,
  role   text not null,     -- 'teacher' | 'seller' | 'student' | 'general' (panelda guruhlash uchun)
  label  text not null,
  sort   integer not null default 0
);

insert into public.settings(key, value, role, label, sort) values
  ('teacher_give_rewards',     true,  'teacher', 'O''quvchilarga pul berish', 1),
  ('teacher_free_amount',      true,  'teacher', 'Erkin summali sabablardan foydalanish', 2),
  ('teacher_upload_tasks',     true,  'teacher', 'Test va vazifa yuklash', 3),
  ('teacher_manage_groups',    true,  'teacher', 'Guruh ochish va o''quvchilarni qo''shish', 4),
  ('teacher_approve_students', true,  'teacher', 'Ro''yxatdan o''tganlarni tasdiqlash', 5),
  ('teacher_block_students',   false, 'teacher', 'O''z guruhidagi o''quvchini bloklash', 6),
  ('seller_sell',              true,  'seller',  'O''quvchilarga sotish', 1),
  ('seller_manage_items',      true,  'seller',  'Mahsulot qo''shish va narxini o''zgartirish', 2),
  ('seller_topup_teachers',    true,  'seller',  'O''qituvchilarga pul ajratish', 3),
  ('seller_see_history',       true,  'seller',  'Barcha amallar tarixini ko''rish', 4),
  ('self_registration',        true,  'student', 'O''quvchilar o''zi ro''yxatdan o''tishi', 1),
  ('center_rating_visible',    true,  'student', 'Markaz reytingini ko''rish', 2)
on conflict (key) do nothing;

create or replace function public.perm(p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select value from settings where key = p_key), true);
$$;

alter table public.settings enable row level security;
drop policy if exists "read settings" on public.settings;
create policy "read settings" on public.settings for select to anon, authenticated using (true);
drop policy if exists "admin settings" on public.settings;
create policy "admin settings" on public.settings for update to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
grant select on public.settings to anon;

create or replace function public.require_perm(p_role public.user_role, p_key text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if public.my_role() = p_role and not public.perm(p_key) then
    raise exception 'Bu imkoniyat admin tomonidan yopilgan';
  end if;
end $$;

-- ---------- O'qituvchi: o'z guruhlarini boshqarish ----------
drop policy if exists "teacher insert groups" on public.groups;
create policy "teacher insert groups" on public.groups for insert to authenticated
  with check (public.my_role() = 'teacher' and public.perm('teacher_manage_groups') and teacher_id = auth.uid());
drop policy if exists "teacher update groups" on public.groups;
create policy "teacher update groups" on public.groups for update to authenticated
  using (public.my_role() = 'teacher' and public.perm('teacher_manage_groups') and teacher_id = auth.uid())
  with check (teacher_id = auth.uid());
drop policy if exists "teacher delete groups" on public.groups;
create policy "teacher delete groups" on public.groups for delete to authenticated
  using (public.my_role() = 'teacher' and public.perm('teacher_manage_groups') and teacher_id = auth.uid());

drop policy if exists "teacher members" on public.group_members;
create policy "teacher members" on public.group_members for all to authenticated
  using (public.my_role() = 'teacher' and public.perm('teacher_manage_groups')
         and exists (select 1 from public.groups g where g.id = group_id and g.teacher_id = auth.uid()))
  with check (public.my_role() = 'teacher' and public.perm('teacher_manage_groups')
         and exists (select 1 from public.groups g where g.id = group_id and g.teacher_id = auth.uid()));

-- O'qituvchi o'z guruhidagi o'quvchini bloklaydi / qayta yoqadi
create or replace function public.teacher_set_student_active(p_student uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if my_role() = 'admin' then perform admin_set_active(p_student, p_active); return; end if;
  if my_role() <> 'teacher' or not perm('teacher_block_students') then raise exception 'Bu imkoniyat admin tomonidan yopilgan'; end if;
  if not exists (select 1 from group_members gm join groups g on g.id = gm.group_id join profiles p on p.id = gm.student_id
                 where gm.student_id = p_student and g.teacher_id = auth.uid() and p.role = 'student') then
    raise exception 'Faqat o''z guruhingizdagi o''quvchini bloklay olasiz';
  end if;
  update profiles set active = p_active where id = p_student;
end $$;

-- ---------- Mavjud funksiyalarga ruxsat tekshiruvi ----------
create or replace function public.give_reward(p_students uuid[], p_reason bigint, p_amount integer default null, p_note text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_teacher uuid := auth.uid(); v_reason reasons%rowtype; v_amount integer; v_total integer; v_balance integer; v_student uuid; v_count integer;
begin
  perform require_role(array['teacher']::user_role[]);
  perform require_perm('teacher', 'teacher_give_rewards');
  select * into v_reason from reasons where id = p_reason and active;
  if not found then raise exception 'Sabab topilmadi'; end if;
  if v_reason.fixed_amount is null and not perm('teacher_free_amount') then
    raise exception 'Erkin summali sabablar admin tomonidan yopilgan';
  end if;
  v_amount := coalesce(v_reason.fixed_amount, p_amount);
  if v_amount is null or v_amount <= 0 then raise exception 'Summani kiriting'; end if;
  select array_agg(distinct s) into p_students from unnest(p_students) s;
  v_count := coalesce(array_length(p_students, 1), 0);
  if v_count = 0 then raise exception 'O''quvchi tanlanmadi'; end if;
  if exists (
    select 1 from unnest(p_students) s
    where not exists (
      select 1 from group_members gm join groups g on g.id = gm.group_id join profiles p on p.id = gm.student_id
      where gm.student_id = s and g.teacher_id = v_teacher and p.role = 'student' and p.active)
  ) then raise exception 'Faqat o''z guruhingizdagi o''quvchilarga pul bera olasiz'; end if;
  v_total := v_amount * v_count;
  select balance into v_balance from profiles where id = v_teacher for update;
  if v_balance < v_total then raise exception 'Hisobingizda yetarli pul yo''q (kerak: %, bor: %)', v_total, v_balance; end if;
  update profiles set balance = balance - v_total where id = v_teacher;
  foreach v_student in array p_students loop
    update profiles set balance = balance + v_amount where id = v_student;
    insert into transactions(type, from_id, to_id, amount, reason_id, note, created_by)
    values ('reward', v_teacher, v_student, v_amount, p_reason, p_note, v_teacher);
  end loop;
  return v_total;
end $$;

create or replace function public.allocate_to_teacher(p_teacher uuid, p_amount integer, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_role(array['admin','seller']::user_role[]);
  perform require_perm('seller', 'seller_topup_teachers');
  if p_amount is null or p_amount <= 0 then raise exception 'Summa musbat bo''lishi kerak'; end if;
  if not exists (select 1 from profiles where id = p_teacher and role = 'teacher' and active) then raise exception 'O''qituvchi topilmadi'; end if;
  update profiles set balance = balance + p_amount where id = p_teacher;
  insert into transactions(type, to_id, amount, note, created_by) values ('allocation', p_teacher, p_amount, p_note, auth.uid());
end $$;

create or replace function public.sell_item(p_student uuid, p_item bigint, p_qty integer default 1)
returns integer language plpgsql security definer set search_path = public as $$
declare v_item shop_items%rowtype; v_total integer; v_bal integer;
begin
  perform require_role(array['seller','admin']::user_role[]);
  perform require_perm('seller', 'seller_sell');
  if p_qty is null or p_qty <= 0 then raise exception 'Miqdor noto''g''ri'; end if;
  select * into v_item from shop_items where id = p_item and active for update;
  if not found then raise exception 'Mahsulot topilmadi'; end if;
  if v_item.stock < p_qty then raise exception 'Omborda yetarli emas (bor: %)', v_item.stock; end if;
  select balance into v_bal from profiles where id = p_student and role = 'student' and active for update;
  if not found then raise exception 'O''quvchi topilmadi'; end if;
  v_total := v_item.price * p_qty;
  if v_bal < v_total then raise exception 'O''quvchida yetarli pul yo''q (kerak: %, bor: %)', v_total, v_bal; end if;
  update profiles set balance = balance - v_total where id = p_student;
  update shop_items set stock = stock - p_qty where id = p_item;
  insert into transactions(type, from_id, amount, item_id, quantity, created_by) values ('purchase', p_student, v_total, p_item, p_qty, auth.uid());
  return v_total;
end $$;

drop policy if exists "manage items" on public.shop_items;
create policy "manage items" on public.shop_items for all to authenticated
  using (public.my_role() = 'admin' or (public.my_role() = 'seller' and public.perm('seller_manage_items')))
  with check (public.my_role() = 'admin' or (public.my_role() = 'seller' and public.perm('seller_manage_items')));

drop policy if exists "read tx" on public.transactions;
create policy "read tx" on public.transactions for select to authenticated
  using (from_id = auth.uid() or to_id = auth.uid() or public.my_role() = 'admin'
         or (public.my_role() = 'seller' and public.perm('seller_see_history')));

-- Tasdiqlash / rad etish — o'qituvchi uchun ruxsat
create or replace function public.approve_registration(p_user uuid, p_group bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v_role user_role := my_role();
begin
  if v_role not in ('admin','teacher') then raise exception 'Bu amal uchun ruxsat yo''q'; end if;
  perform require_perm('teacher', 'teacher_approve_students');
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

create or replace function public.reject_registration(p_user uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
declare v_role user_role := my_role(); v_req bigint;
begin
  if v_role not in ('admin','teacher') then raise exception 'Bu amal uchun ruxsat yo''q'; end if;
  perform require_perm('teacher', 'teacher_approve_students');
  select requested_group into v_req from profiles where id = p_user and role = 'pending';
  if not found then raise exception 'So''rov topilmadi'; end if;
  if v_role = 'teacher' and not exists (select 1 from groups where id = v_req and teacher_id = auth.uid()) then
    raise exception 'Bu so''rov sizning guruhingizga emas';
  end if;
  delete from auth.users where id = p_user;
end $$;

-- Markaz reytingi yopiq bo'lsa, o'quvchi faqat guruh reytingini ko'radi
create or replace function public.leaderboard(p_period text default 'month', p_group bigint default null)
returns table(student_id uuid, full_name text, earned bigint, balance integer, place bigint)
language plpgsql stable security definer set search_path = public as $$
declare v_from timestamptz;
begin
  if my_role() = 'pending' then raise exception 'Ruxsat yo''q'; end if;
  if p_group is null and my_role() = 'student' and not perm('center_rating_visible') then
    raise exception 'Markaz reytingi yopilgan';
  end if;
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

-- =====================================================================
--  TESTNI QAYTA ISHLASH
-- =====================================================================
alter table public.assignments add column if not exists max_attempts integer default 3 check (max_attempts is null or max_attempts between 1 and 50);
alter table public.assignments add column if not exists show_key boolean not null default true;
alter table public.submissions add column if not exists attempts integer not null default 1;
alter table public.submissions add column if not exists paid integer not null default 0;
update public.submissions set paid = reward where status = 'paid' and paid = 0 and reward > 0;

create table if not exists public.test_attempts (
  id             bigint generated always as identity primary key,
  assignment_id  bigint not null references public.assignments(id) on delete cascade,
  student_id     uuid not null references public.profiles(id) on delete cascade,
  answers        text[] not null,
  results        boolean[] not null,
  correct        integer not null,
  total          integer not null,
  reward_value   integer not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists att_idx on public.test_attempts(assignment_id, student_id, created_at);
-- eski topshiriqlarni 1-urinish sifatida ko'chirish
insert into public.test_attempts(assignment_id, student_id, answers, results, correct, total, reward_value, created_at)
select s.assignment_id, s.student_id, s.answers, s.results, s.correct, s.total, s.reward, s.created_at
from public.submissions s join public.assignments a on a.id = s.assignment_id
where a.kind = 'test' and s.results is not null
  and not exists (select 1 from public.test_attempts t where t.assignment_id = s.assignment_id and t.student_id = s.student_id);

alter table public.test_attempts enable row level security;
drop policy if exists "read attempts" on public.test_attempts;
create policy "read attempts" on public.test_attempts for select to authenticated
  using (student_id = auth.uid() or public.can_manage_assignment(assignment_id));
revoke insert, update, delete on public.test_attempts from anon, authenticated;

-- To'lov: faqat hali to'lanmagan farq (reward - paid) to'lanadi
create or replace function public._pay_submission(p_sub bigint) returns text
language plpgsql security definer set search_path = public as $$
declare s submissions%rowtype; a assignments%rowtype; v_role user_role; v_bal integer; v_due integer;
begin
  select * into s from submissions where id = p_sub for update;
  select * into a from assignments where id = s.assignment_id;
  v_due := s.reward - s.paid;
  if v_due <= 0 then update submissions set status = 'paid' where id = p_sub; return 'paid'; end if;
  select role, balance into v_role, v_bal from profiles where id = a.created_by for update;
  if v_role = 'teacher' then
    if v_bal < v_due then update submissions set status = 'unpaid' where id = p_sub; return 'unpaid'; end if;
    update profiles set balance = balance - v_due where id = a.created_by;
  end if;
  update profiles set balance = balance + v_due where id = s.student_id;
  insert into transactions(type, from_id, to_id, amount, assignment_id, note, created_by)
  values ('reward', a.created_by, s.student_id, v_due, a.id, a.title, coalesce(auth.uid(), a.created_by));
  update submissions set status = 'paid', paid = reward where id = p_sub;
  return 'paid';
end $$;
revoke all on function public._pay_submission(bigint) from public, anon, authenticated;

create or replace function public.submit_test(p_assignment bigint, p_answers text[])
returns json language plpgsql security definer set search_path = public as $$
declare
  a assignments%rowtype; s submissions%rowtype; k text[]; v_ans text[] := array[]::text[]; v_res boolean[] := array[]::boolean[];
  v_correct int := 0; v_reward int := 0; v_sub bigint; v_status text; v_before int := 0; v_attempts int := 0; i int;
begin
  if my_role() <> 'student' then raise exception 'Faqat o''quvchilar topshira oladi'; end if;
  select * into a from assignments where id = p_assignment and active and kind = 'test';
  if not found or not student_sees_assignment(p_assignment, auth.uid()) then raise exception 'Test topilmadi'; end if;
  if a.deadline is not null and now() > a.deadline then raise exception 'Muddat tugagan'; end if;
  select * into s from submissions where assignment_id = p_assignment and student_id = auth.uid() for update;
  if found then
    v_attempts := s.attempts; v_before := s.paid;
    if a.max_attempts is not null and s.attempts >= a.max_attempts then raise exception 'Urinishlar soni tugagan'; end if;
  end if;
  select answers into k from assignment_keys where assignment_id = p_assignment;
  for i in 1..a.question_count loop
    v_ans := v_ans || upper(trim(coalesce(p_answers[i], '')));
    v_res := v_res || (upper(trim(coalesce(p_answers[i], ''))) = k[i]);
    if v_res[i] then v_correct := v_correct + 1; end if;
  end loop;
  if a.reward_mode = 'per_correct' then v_reward := v_correct * a.per_correct;
  elsif v_correct * 100 >= a.threshold_pct * a.question_count then v_reward := a.reward_amount; end if;

  insert into test_attempts(assignment_id, student_id, answers, results, correct, total, reward_value)
  values (p_assignment, auth.uid(), v_ans, v_res, v_correct, a.question_count, v_reward);

  if s.id is null then
    insert into submissions(assignment_id, student_id, answers, results, status, correct, total, reward, paid, attempts)
    values (p_assignment, auth.uid(), v_ans, v_res, 'pending', v_correct, a.question_count, v_reward, 0, 1)
    returning id into v_sub;
  else
    v_sub := s.id;
    update submissions set attempts = attempts + 1,
      answers = case when v_correct >= coalesce(s.correct, 0) then v_ans else answers end,
      results = case when v_correct >= coalesce(s.correct, 0) then v_res else results end,
      correct = greatest(coalesce(s.correct, 0), v_correct),
      reward  = greatest(s.reward, v_reward),
      created_at = now()
    where id = v_sub;
  end if;
  v_status := _pay_submission(v_sub);
  select * into s from submissions where id = v_sub;
  return json_build_object(
    'correct', v_correct, 'total', a.question_count, 'results', v_res,
    'reward', v_reward, 'best', s.correct, 'best_reward', s.reward,
    'paid_now', s.paid - v_before, 'status', v_status,
    'attempts', s.attempts, 'attempts_left', case when a.max_attempts is null then null else a.max_attempts - s.attempts end);
end $$;

-- To'g'ri javoblar: o'qituvchiga doim; o'quvchiga — urinishlar tugagach yoki muddat o'tgach (agar ruxsat berilgan bo'lsa)
create or replace function public.get_test_key(p_assignment bigint) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare a assignments%rowtype; s submissions%rowtype;
begin
  if can_manage_assignment(p_assignment) then
    return (select answers from assignment_keys where assignment_id = p_assignment);
  end if;
  select * into a from assignments where id = p_assignment;
  if not found or not a.show_key or my_role() <> 'student' then return null; end if;
  select * into s from submissions where assignment_id = p_assignment and student_id = auth.uid();
  if not found then return null; end if;
  if (a.max_attempts is not null and s.attempts >= a.max_attempts) or (a.deadline is not null and now() > a.deadline) then
    return (select answers from assignment_keys where assignment_id = p_assignment);
  end if;
  return null;
end $$;

-- save_assignment: urinishlar soni va javoblarni ko'rsatish qo'shildi
drop function if exists public.save_assignment(bigint,text,text,text,text,text,integer,integer,text[],text,integer,integer,integer,timestamptz,bigint[],boolean);
create or replace function public.save_assignment(
  p_id bigint, p_title text, p_description text, p_kind text,
  p_file_path text, p_file_type text,
  p_question_count integer, p_option_count integer, p_answers text[],
  p_reward_mode text, p_per_correct integer, p_threshold_pct integer, p_reward_amount integer,
  p_deadline timestamptz, p_groups bigint[], p_active boolean default true,
  p_max_attempts integer default 3, p_show_key boolean default true)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint := p_id; v_role user_role := my_role();
begin
  if v_role not in ('admin','teacher') then raise exception 'Bu amal uchun ruxsat yo''q'; end if;
  perform require_perm('teacher', 'teacher_upload_tasks');
  if coalesce(trim(p_title),'') = '' then raise exception 'Sarlavhani kiriting'; end if;
  if p_kind not in ('test','task') then raise exception 'Turi noto''g''ri'; end if;
  if coalesce(array_length(p_groups,1),0) = 0 then raise exception 'Kamida bitta guruhni tanlang'; end if;
  if v_role = 'teacher' and exists (
      select 1 from unnest(p_groups) g where not exists (select 1 from groups where id = g and teacher_id = auth.uid())) then
    raise exception 'Faqat o''z guruhlaringizni tanlay olasiz';
  end if;
  if p_kind = 'test' then
    if p_question_count is null or p_question_count < 1 then raise exception 'Savollar sonini kiriting'; end if;
    if coalesce(array_length(p_answers,1),0) <> p_question_count then raise exception 'Javob kaliti to''liq emas'; end if;
    if exists (select 1 from unnest(p_answers) a where coalesce(a,'') = '') then raise exception 'Javob kaliti to''liq emas'; end if;
    if p_reward_mode = 'per_correct' and coalesce(p_per_correct,0) <= 0 then raise exception 'Har to''g''ri javob uchun summani kiriting'; end if;
    if p_reward_mode = 'threshold' and (coalesce(p_threshold_pct,0) <= 0 or coalesce(p_reward_amount,0) <= 0) then raise exception 'Foiz va summani kiriting'; end if;
    if p_reward_mode not in ('per_correct','threshold') then raise exception 'Mukofot usulini tanlang'; end if;
  else
    if coalesce(p_reward_amount,0) <= 0 then raise exception 'Mukofot summasini kiriting'; end if;
  end if;

  if v_id is null then
    insert into assignments(title, description, kind, file_path, file_type, question_count, option_count,
                            reward_mode, per_correct, threshold_pct, reward_amount, deadline, active, created_by, max_attempts, show_key)
    values (trim(p_title), p_description, p_kind, p_file_path, p_file_type,
            case when p_kind='test' then p_question_count end, coalesce(p_option_count,4),
            case when p_kind='test' then p_reward_mode end,
            case when p_kind='test' and p_reward_mode='per_correct' then p_per_correct end,
            case when p_kind='test' and p_reward_mode='threshold' then p_threshold_pct end,
            case when p_kind='task' or p_reward_mode='threshold' then p_reward_amount end,
            p_deadline, coalesce(p_active,true), auth.uid(), p_max_attempts, coalesce(p_show_key, true))
    returning id into v_id;
  else
    if not can_manage_assignment(v_id) then raise exception 'Bu vazifani o''zgartira olmaysiz'; end if;
    if exists (select 1 from submissions where assignment_id = v_id) and
       exists (select 1 from assignments where id = v_id and (kind <> p_kind or coalesce(question_count,0) <> coalesce(p_question_count,0))) then
      raise exception 'Javoblar kelib tushgan — turi va savollar sonini o''zgartirib bo''lmaydi';
    end if;
    update assignments set title = trim(p_title), description = p_description, kind = p_kind,
      file_path = coalesce(p_file_path, file_path), file_type = coalesce(p_file_type, file_type),
      question_count = case when p_kind='test' then p_question_count end, option_count = coalesce(p_option_count,4),
      reward_mode = case when p_kind='test' then p_reward_mode end,
      per_correct = case when p_kind='test' and p_reward_mode='per_correct' then p_per_correct end,
      threshold_pct = case when p_kind='test' and p_reward_mode='threshold' then p_threshold_pct end,
      reward_amount = case when p_kind='task' or p_reward_mode='threshold' then p_reward_amount end,
      deadline = p_deadline, active = coalesce(p_active,true), max_attempts = p_max_attempts, show_key = coalesce(p_show_key, true)
    where id = v_id;
    delete from assignment_groups where assignment_id = v_id;
  end if;
  insert into assignment_groups(assignment_id, group_id) select v_id, g from unnest(p_groups) g on conflict do nothing;
  if p_kind = 'test' then
    insert into assignment_keys(assignment_id, answers)
    values (v_id, (select array_agg(upper(trim(a)) order by i) from unnest(p_answers) with ordinality t(a,i)))
    on conflict (assignment_id) do update set answers = excluded.answers;
  else
    delete from assignment_keys where assignment_id = v_id;
  end if;
  return v_id;
end $$;
