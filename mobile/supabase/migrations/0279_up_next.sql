-- Hound: Up next and Play your turns (the streamlining's second part,
-- Steve Nov 2026).
--
-- Today's Needs you becomes Up next: the one most urgent turn with its
-- button (live-clock games first: Chess on your move, a H-O-R-S-E turn, a
-- Rally shot, a Roulette duel, Tic-Tac-Go, punches to slip), and "Play
-- your turns", which opens each game's screen one after another and comes
-- back to Today at the end. The sheet has one row per challenge.
--
--   - challenge_quiet: "Quiet this one" on a challenge leaves it out of Up
--     next (it's still on the Challenges tab, and its pushes still come).
--   - my_quiet_challenges() / set_challenge_quiet(id, on).
--   - note_today_tap (0278) also counts Up next's button ('upnext') and
--     Play your turns: started ('play_start'), each game opened from it
--     ('play_turn'), played to the end ('play_done') and stopped part way
--     ('play_stop').
--   - admin_upnext_overview(): Admin → Overview → Status → Up next.
--
-- Run this once, after 0278, in the SQL Editor.

create table if not exists public.challenge_quiet (
  user_id uuid not null references public.profiles (id) on delete cascade,
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, challenge_id)
);

alter table public.challenge_quiet enable row level security;

create or replace function public.my_quiet_challenges()
returns uuid[]
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
  return coalesce((select array_agg(q.challenge_id order by q.created_at) from public.challenge_quiet q where q.user_id = caller), '{}');
end;
$$;

revoke execute on function public.my_quiet_challenges() from public, anon;
grant execute on function public.my_quiet_challenges() to authenticated;

create or replace function public.set_challenge_quiet(p_challenge_id uuid, p_quiet boolean)
returns uuid[]
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'Sign in to do that.';
  end if;
  if p_quiet then
    if not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = caller) then
      raise exception 'You''re not in that challenge.';
    end if;
    insert into public.challenge_quiet (user_id, challenge_id) values (caller, p_challenge_id)
      on conflict do nothing;
  else
    delete from public.challenge_quiet q where q.user_id = caller and q.challenge_id = p_challenge_id;
  end if;
  return coalesce((select array_agg(q.challenge_id order by q.created_at) from public.challenge_quiet q where q.user_id = caller), '{}');
end;
$$;

revoke execute on function public.set_challenge_quiet(uuid, boolean) from public, anon;
grant execute on function public.set_challenge_quiet(uuid, boolean) to authenticated;

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
    'upnext', 'play_start', 'play_turn', 'play_done', 'play_stop'
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

create or replace function public.admin_upnext_overview()
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
        where day > since and what in ('upnext', 'play_start', 'play_turn', 'play_done', 'play_stop')
        group by what
      ) g
    ), '{}'::jsonb),
    'played_ever', (select count(distinct user_id) from public.today_taps where what = 'play_start'),
    'quiet_people', (
      select count(distinct q.user_id) from public.challenge_quiet q
      join public.challenges c on c.id = q.challenge_id
      where c.ends_at >= now()
    ),
    'quiet_challenges', (
      select count(*) from public.challenge_quiet q
      join public.challenges c on c.id = q.challenge_id
      where c.ends_at >= now()
    ),
    'quiet_kinds', coalesce((
      select jsonb_object_agg(kind, n)
      from (
        select c.kind::text as kind, count(*) as n from public.challenge_quiet q
        join public.challenges c on c.id = q.challenge_id
        where c.ends_at >= now()
        group by c.kind
      ) k
    ), '{}'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke execute on function public.admin_upnext_overview() from public, anon;
grant execute on function public.admin_upnext_overview() to authenticated;

-- To undo:
--   drop function public.admin_upnext_overview();
--   drop function public.set_challenge_quiet(uuid, boolean);
--   drop function public.my_quiet_challenges();
--   drop table public.challenge_quiet;
--   (note_today_tap as in 0278.)
