-- =====================================================================
--  ILMZOR PULLARI — 5-qism: SUN'IY INTELLEKT YORDAMCHISI (Gemini)
--  Javoblar keshlanadi (bir xil savol qayta so'ralsa — bepul), kunlik limit bor.
-- =====================================================================

create table if not exists public.ai_cache (
  assignment_id bigint not null references public.assignments(id) on delete cascade,
  question      integer not null,
  kind          text not null,             -- 'explain:A' | 'similar'
  content       jsonb not null,
  created_at    timestamptz not null default now(),
  primary key (assignment_id, question, kind)
);

create table if not exists public.ai_usage (
  user_id  uuid not null references public.profiles(id) on delete cascade,
  day      date not null default (now() at time zone 'Asia/Tashkent')::date,
  count    integer not null default 0,
  primary key (user_id, day)
);

-- Faqat server (Edge Function, service role) ishlatadi — ilovadan to'g'ridan-to'g'ri kirish yo'q
alter table public.ai_cache enable row level security;
alter table public.ai_usage enable row level security;
revoke all on public.ai_cache, public.ai_usage from anon, authenticated;

insert into public.settings(key, value, role, label, sort) values
  ('ai_help', true, 'student', 'Sun''iy intellekt yordamchisi (xatolarni tushuntirish)', 3)
on conflict (key) do nothing;
