-- =====================================================================
--  ILMZOR PULLARI — 2-qism: VAZIFALAR VA TESTLAR
--  schema.sql dan keyin SQL Editor'da bir marta ishga tushiriladi.
-- =====================================================================

-- Tranzaksiya qaysi vazifa uchun ekanini bilish uchun
alter table public.transactions add column if not exists assignment_id bigint;

-- ---------- Jadvallar ----------
create table if not exists public.assignments (
  id               bigint generated always as identity primary key,
  title            text not null,
  description      text,
  kind             text not null check (kind in ('test','task')),
  file_path        text,                 -- storage: assignments/...
  file_type        text,                 -- 'pdf' | 'image'
  question_count   integer check (question_count is null or question_count between 1 and 200),
  option_count     integer not null default 4 check (option_count between 2 and 6),
  -- test mukofoti: 'per_correct' (har to'g'ri javobga) | 'threshold' (foizdan oshsa)
  reward_mode      text check (reward_mode in ('per_correct','threshold')),
  per_correct      integer check (per_correct is null or per_correct > 0),
  threshold_pct    integer check (threshold_pct is null or threshold_pct between 1 and 100),
  reward_amount    integer check (reward_amount is null or reward_amount > 0),  -- threshold yoki task uchun
  deadline         timestamptz,
  active           boolean not null default true,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);

create table if not exists public.assignment_groups (
  assignment_id bigint not null references public.assignments(id) on delete cascade,
  group_id      bigint not null references public.groups(id) on delete cascade,
  primary key (assignment_id, group_id)
);

-- Javob kaliti alohida jadvalda: o'quvchilar uni ko'ra olmaydi
create table if not exists public.assignment_keys (
  assignment_id bigint primary key references public.assignments(id) on delete cascade,
  answers       text[] not null
);

create table if not exists public.submissions (
  id             bigint generated always as identity primary key,
  assignment_id  bigint not null references public.assignments(id) on delete cascade,
  student_id     uuid not null references public.profiles(id) on delete cascade,
  answers        text[],
  results        boolean[],             -- har savol: to'g'ri/noto'g'ri
  file_path      text,                  -- storage: submissions/<student_id>/...
  status         text not null check (status in ('pending','rejected','unpaid','paid')),
  correct        integer,
  total          integer,
  reward         integer not null default 0,
  comment        text,
  reviewed_by    uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  reviewed_at    timestamptz,
  unique (assignment_id, student_id)
);
create index if not exists sub_student_idx on public.submissions(student_id);
create index if not exists sub_status_idx on public.submissions(status);

-- ---------- Yordamchi ----------
create or replace function public.can_manage_assignment(p_assignment bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() = 'admin'
      or exists (select 1 from assignments a where a.id = p_assignment and a.created_by = auth.uid() and public.my_role() = 'teacher');
$$;

create or replace function public.student_sees_assignment(p_assignment bigint, p_student uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from assignment_groups ag join group_members gm on gm.group_id = ag.group_id
    where ag.assignment_id = p_assignment and gm.student_id = p_student);
$$;

-- ---------- Vazifa yaratish / tahrirlash ----------
create or replace function public.save_assignment(
  p_id bigint, p_title text, p_description text, p_kind text,
  p_file_path text, p_file_type text,
  p_question_count integer, p_option_count integer, p_answers text[],
  p_reward_mode text, p_per_correct integer, p_threshold_pct integer, p_reward_amount integer,
  p_deadline timestamptz, p_groups bigint[], p_active boolean default true)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_id bigint := p_id;
  v_role user_role := my_role();
begin
  if v_role not in ('admin','teacher') then raise exception 'Bu amal uchun ruxsat yo''q'; end if;
  if coalesce(trim(p_title),'') = '' then raise exception 'Sarlavhani kiriting'; end if;
  if p_kind not in ('test','task') then raise exception 'Turi noto''g''ri'; end if;
  if coalesce(array_length(p_groups,1),0) = 0 then raise exception 'Kamida bitta guruhni tanlang'; end if;

  -- o'qituvchi faqat o'z guruhlariga bera oladi
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
                            reward_mode, per_correct, threshold_pct, reward_amount, deadline, active, created_by)
    values (trim(p_title), p_description, p_kind, p_file_path, p_file_type,
            case when p_kind='test' then p_question_count end, coalesce(p_option_count,4),
            case when p_kind='test' then p_reward_mode end,
            case when p_kind='test' and p_reward_mode='per_correct' then p_per_correct end,
            case when p_kind='test' and p_reward_mode='threshold' then p_threshold_pct end,
            case when p_kind='task' or p_reward_mode='threshold' then p_reward_amount end,
            p_deadline, coalesce(p_active,true), auth.uid())
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
      deadline = p_deadline, active = coalesce(p_active,true)
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

create or replace function public.delete_assignment(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_manage_assignment(p_id) then raise exception 'Bu vazifani o''chira olmaysiz'; end if;
  if exists (select 1 from submissions where assignment_id = p_id and status in ('paid','unpaid')) then
    update assignments set active = false where id = p_id;   -- tarix saqlansin: faqat yashiriladi
  else
    delete from assignments where id = p_id;
  end if;
end $$;

-- ---------- To'lov (ichki) ----------
-- Vazifa egasi o'qituvchi bo'lsa — uning hisobidan, admin bo'lsa — markaz hisobidan.
-- O'qituvchida pul yetmasa — 'unpaid' bo'lib qoladi, keyin pay_pending bilan to'lanadi.
create or replace function public._pay_submission(p_sub bigint) returns text
language plpgsql security definer set search_path = public as $$
declare
  s submissions%rowtype; a assignments%rowtype; v_payer_role user_role; v_bal integer;
begin
  select * into s from submissions where id = p_sub for update;
  select * into a from assignments where id = s.assignment_id;
  if s.reward <= 0 then
    update submissions set status = 'paid' where id = p_sub; return 'paid';
  end if;
  select role, balance into v_payer_role, v_bal from profiles where id = a.created_by for update;
  if v_payer_role = 'teacher' then
    if v_bal < s.reward then
      update submissions set status = 'unpaid' where id = p_sub; return 'unpaid';
    end if;
    update profiles set balance = balance - s.reward where id = a.created_by;
  end if;
  update profiles set balance = balance + s.reward where id = s.student_id;
  insert into transactions(type, from_id, to_id, amount, assignment_id, note, created_by)
  values ('reward', a.created_by, s.student_id, s.reward, a.id, a.title, coalesce(auth.uid(), a.created_by));
  update submissions set status = 'paid' where id = p_sub;
  return 'paid';
end $$;
revoke all on function public._pay_submission(bigint) from public, anon, authenticated;

-- ---------- O'quvchi: test topshirish ----------
create or replace function public.submit_test(p_assignment bigint, p_answers text[])
returns json language plpgsql security definer set search_path = public as $$
declare
  a assignments%rowtype; k text[]; v_ans text[]; v_res boolean[]; v_correct int := 0; v_reward int := 0;
  v_sub bigint; v_status text; i int;
begin
  if my_role() <> 'student' then raise exception 'Faqat o''quvchilar topshira oladi'; end if;
  select * into a from assignments where id = p_assignment and active and kind = 'test';
  if not found or not student_sees_assignment(p_assignment, auth.uid()) then raise exception 'Test topilmadi'; end if;
  if a.deadline is not null and now() > a.deadline then raise exception 'Muddat tugagan'; end if;
  if exists (select 1 from submissions where assignment_id = p_assignment and student_id = auth.uid()) then
    raise exception 'Bu testni allaqachon topshirgansiz';
  end if;
  select answers into k from assignment_keys where assignment_id = p_assignment;

  v_ans := array[]::text[]; v_res := array[]::boolean[];
  for i in 1..a.question_count loop
    v_ans := v_ans || upper(trim(coalesce(p_answers[i], '')));
    v_res := v_res || (upper(trim(coalesce(p_answers[i], ''))) = k[i]);
    if v_res[i] then v_correct := v_correct + 1; end if;
  end loop;

  if a.reward_mode = 'per_correct' then
    v_reward := v_correct * a.per_correct;
  elsif v_correct * 100 >= a.threshold_pct * a.question_count then
    v_reward := a.reward_amount;
  end if;

  insert into submissions(assignment_id, student_id, answers, results, status, correct, total, reward)
  values (p_assignment, auth.uid(), v_ans, v_res, 'pending', v_correct, a.question_count, v_reward)
  returning id into v_sub;
  v_status := _pay_submission(v_sub);
  return json_build_object('correct', v_correct, 'total', a.question_count, 'reward', v_reward, 'status', v_status, 'results', v_res);
end $$;

-- ---------- O'quvchi: vazifa (rasm) yuborish ----------
create or replace function public.submit_task(p_assignment bigint, p_file_path text, p_comment text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a assignments%rowtype; v_old submissions%rowtype;
begin
  if my_role() <> 'student' then raise exception 'Faqat o''quvchilar topshira oladi'; end if;
  select * into a from assignments where id = p_assignment and active and kind = 'task';
  if not found or not student_sees_assignment(p_assignment, auth.uid()) then raise exception 'Vazifa topilmadi'; end if;
  if a.deadline is not null and now() > a.deadline then raise exception 'Muddat tugagan'; end if;
  if coalesce(p_file_path,'') = '' or split_part(p_file_path, '/', 1) <> auth.uid()::text then raise exception 'Rasm yuklanmadi'; end if;
  select * into v_old from submissions where assignment_id = p_assignment and student_id = auth.uid();
  if found then
    if v_old.status <> 'rejected' then raise exception 'Bu vazifani allaqachon yuborgansiz'; end if;
    update submissions set file_path = p_file_path, answers = case when p_comment is null then null else array[p_comment] end,
      status = 'pending', comment = null, reviewed_by = null, reviewed_at = null, created_at = now()
    where id = v_old.id;
  else
    insert into submissions(assignment_id, student_id, file_path, answers, status, reward)
    values (p_assignment, auth.uid(), p_file_path, case when p_comment is null then null else array[p_comment] end, 'pending', 0);
  end if;
end $$;

-- ---------- O'qituvchi/admin: vazifani tekshirish ----------
create or replace function public.review_submission(p_sub bigint, p_approve boolean, p_comment text default null)
returns text language plpgsql security definer set search_path = public as $$
declare s submissions%rowtype; a assignments%rowtype;
begin
  select * into s from submissions where id = p_sub for update;
  if not found then raise exception 'Topilmadi'; end if;
  if not can_manage_assignment(s.assignment_id) then raise exception 'Bu vazifani tekshira olmaysiz'; end if;
  if s.status <> 'pending' then raise exception 'Bu javob allaqachon tekshirilgan'; end if;
  select * into a from assignments where id = s.assignment_id;
  if not p_approve then
    update submissions set status = 'rejected', comment = p_comment, reviewed_by = auth.uid(), reviewed_at = now() where id = p_sub;
    return 'rejected';
  end if;
  update submissions set reward = a.reward_amount, comment = p_comment, reviewed_by = auth.uid(), reviewed_at = now() where id = p_sub;
  return _pay_submission(p_sub);
end $$;

-- To'lanmay qolganlarni to'lash (o'qituvchi hisobi to'ldirilgandan keyin)
create or replace function public.pay_pending() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  if my_role() not in ('teacher','admin') then raise exception 'Ruxsat yo''q'; end if;
  for r in
    select s.id from submissions s join assignments a on a.id = s.assignment_id
    where s.status = 'unpaid' and (my_role() = 'admin' or a.created_by = auth.uid())
    order by s.created_at
  loop
    if _pay_submission(r.id) = 'paid' then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- ---------- Statistika: vazifa mukofotlarini ham ko'rsatish ----------
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
    'tasks_month',     (select count(*) from submissions where created_at >= v_month),
    'to_review',       (select count(*) from submissions where status = 'pending'),
    'by_reason',       (select coalesce(json_agg(x order by x.total desc), '[]'::json) from (
                          select coalesce(r.name, case when t.assignment_id is not null then '📝 Vazifa va testlar' else 'Boshqa' end) as name,
                                 sum(t.amount)::bigint as total
                          from transactions t left join reasons r on r.id = t.reason_id
                          where t.type='reward' and t.created_at >= v_month
                          group by 1) x),
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

-- ---------- Xavfsizlik ----------
alter table public.assignments       enable row level security;
alter table public.assignment_groups enable row level security;
alter table public.assignment_keys   enable row level security;
alter table public.submissions       enable row level security;

drop policy if exists "read assignments" on public.assignments;
create policy "read assignments" on public.assignments for select to authenticated
  using (public.my_role() in ('admin','teacher','seller')
         or (public.my_role() = 'student' and active and public.student_sees_assignment(id, auth.uid())));

drop policy if exists "read assignment groups" on public.assignment_groups;
create policy "read assignment groups" on public.assignment_groups for select to authenticated
  using (public.my_role() <> 'pending');

drop policy if exists "read keys" on public.assignment_keys;
create policy "read keys" on public.assignment_keys for select to authenticated
  using (public.can_manage_assignment(assignment_id));

drop policy if exists "read submissions" on public.submissions;
create policy "read submissions" on public.submissions for select to authenticated
  using (student_id = auth.uid() or public.can_manage_assignment(assignment_id));

revoke insert, update, delete on public.assignments, public.assignment_groups, public.assignment_keys, public.submissions from anon, authenticated;

-- ---------- Fayllar (Storage) ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('assignments', 'assignments', false, 20971520), ('submissions', 'submissions', false, 10485760)
on conflict (id) do nothing;

drop policy if exists "ilmzor read assignment files" on storage.objects;
create policy "ilmzor read assignment files" on storage.objects for select to authenticated
  using (bucket_id = 'assignments' and public.my_role() <> 'pending');

drop policy if exists "ilmzor upload assignment files" on storage.objects;
create policy "ilmzor upload assignment files" on storage.objects for insert to authenticated
  with check (bucket_id = 'assignments' and public.my_role() in ('admin','teacher'));

drop policy if exists "ilmzor read submission files" on storage.objects;
create policy "ilmzor read submission files" on storage.objects for select to authenticated
  using (bucket_id = 'submissions' and ((storage.foldername(name))[1] = auth.uid()::text or public.my_role() in ('admin','teacher')));

drop policy if exists "ilmzor upload submission files" on storage.objects;
create policy "ilmzor upload submission files" on storage.objects for insert to authenticated
  with check (bucket_id = 'submissions' and public.my_role() = 'student' and (storage.foldername(name))[1] = auth.uid()::text);
