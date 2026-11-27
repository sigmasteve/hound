-- Hound: Try this and your hound's strip (the streamlining's third part,
-- Steve Nov 2026).
--
-- Global challenges are there to show what Hound can do, so Today shows
-- them one at a time as an invitation ("Try this"), kinds you've never
-- played first, rotating daily; the full list is on Challenges → Join,
-- grouped. Your hound moves to a strip at the bottom of Today.
--
--   - try_this_state: Not now three times and it steps aside for a week.
--   - my_try_this(): when it's back (or null), and the kinds you've ever
--     played, so ones you haven't come first.
--   - try_this_not_now(): one Not now.
--   - note_today_tap (0278/0279) also counts Try this shown ('try_seen',
--     once a day), See it ('try_open'), Join ('try_join'), Not now
--     ('try_dismiss') and the hound strip ('hound_strip').
--   - admin_try_this_overview(): Admin → Overview → Status → Try this.
--
-- Run this once, after 0280, in the SQL Editor.

create table if not exists public.try_this_state (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  not_nows int not null default 0,
  hidden_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.try_this_state enable row level security;

create or replace function public.my_try_this()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'Sign in to do that.';
  end if;
  return jsonb_build_object(
    'hidden_until', (select s.hidden_until from public.try_this_state s where s.user_id = caller and s.hidden_until > now()),
    'played_kinds', coalesce((
      select jsonb_agg(distinct c.kind::text)
      from public.challenge_participants cp join public.challenges c on c.id = cp.challenge_id
      where cp.user_id = caller), '[]'::jsonb));
end;
$$;

revoke execute on function public.my_try_this() from public, anon;
grant execute on function public.my_try_this() to authenticated;

-- One Not now; the third in a row steps it aside for a week.
create or replace function public.try_this_not_now()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  s public.try_this_state;
begin
  if caller is null then
    raise exception 'Sign in to do that.';
  end if;
  insert into public.try_this_state (user_id, not_nows) values (caller, 1)
    on conflict (user_id) do update
      set not_nows = case when public.try_this_state.hidden_until > now() then public.try_this_state.not_nows
                          else public.try_this_state.not_nows + 1 end,
          updated_at = now()
    returning * into s;
  if s.not_nows >= 3 then
    update public.try_this_state set not_nows = 0, hidden_until = now() + interval '7 days', updated_at = now()
      where user_id = caller returning * into s;
  end if;
  return jsonb_build_object('hidden_until', s.hidden_until, 'not_nows', s.not_nows);
end;
$$;

revoke execute on function public.try_this_not_now() from public, anon;
grant execute on function public.try_this_not_now() to authenticated;

create or replace function public.note_today_tap(p_what text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  today date;
begin
  if caller is null then
    raise exception 'Sign in to do that.';
  end if;
  if p_what is null or p_what not in (
    'steps', 'fasting', 'move', 'water', 'customize',
    'upnext', 'play_start', 'play_turn', 'play_done', 'play_stop',
    'try_seen', 'try_open', 'try_join', 'try_dismiss', 'hound_strip'
  ) then
    return;
  end if;
  select (now() at time zone coalesce(nullif(p.time_zone, ''), 'UTC'))::date into today
    from public.profiles p where p.id = caller;
  insert into public.today_taps (user_id, day, what, n)
    values (caller, coalesce(today, (now() at time zone 'UTC')::date), p_what, 1)
    on conflict (user_id, day, what) do update set n = public.today_taps.n + 1;
end;
$$;

revoke execute on function public.note_today_tap(text) from public, anon;
grant execute on function public.note_today_tap(text) to authenticated;

create or replace function public.admin_try_this_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
  since date := (now() at time zone 'UTC')::date - 7;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;

  select jsonb_build_object(
    'taps_7d', coalesce((
      select jsonb_object_agg(what, jsonb_build_object('people', people, 'n', n))
      from (
        select what, count(distinct user_id) as people, sum(n) as n
        from public.today_taps
        where day > since and what in ('try_seen', 'try_open', 'try_join', 'try_dismiss', 'hound_strip')
        group by what
      ) g
    ), '{}'::jsonb),
    'stepped_aside', (select count(*) from public.try_this_state s where s.hidden_until > now()),
    -- Joined any Global in the last 7 days (from anywhere), to set Try
    -- this's joins against.
    'joined_global_7d', (
      select count(distinct cp.user_id) from public.challenge_participants cp
      join public.challenges c on c.id = cp.challenge_id
      where c.is_global and cp.joined_at >= now() - interval '7 days'),
    'hound_top', (select count(*) from public.today_prefs t where t.prefs -> 'hound_top' = 'true'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke execute on function public.admin_try_this_overview() from public, anon;
grant execute on function public.admin_try_this_overview() to authenticated;

-- To undo:
--   drop function public.admin_try_this_overview();
--   drop function public.try_this_not_now();
--   drop function public.my_try_this();
--   drop table public.try_this_state;
--   (note_today_tap as in 0279.)
