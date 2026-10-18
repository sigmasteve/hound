-- Hound: every running challenge's standings in one request (issue #335).
--
-- Today and the Challenges tab used to make three or four requests per
-- challenge (participants, leaderboard, bots, and a hunt's head-start
-- totals), and the leaderboard read paged through every
-- progress_snapshots row to add them up on the phone. challenge_boards
-- does the adding in Postgres and returns, per challenge:
--
--   participants: each one's role, highlight, profile look and level,
--                 total steps and miles, and (when asked) their totals
--                 as of a day, for a hunt's head start;
--   bots:         the challenge's bots.
--
-- The app still builds the board itself (src/challenges/board.ts), so
-- nothing about how standings are ranked changes.
--
-- Only challenges the caller is in come back, the same rule as the
-- tables' own read policies (is_challenge_participant); anything else
-- asked for is left out, and the app falls back to the old requests for
-- it.
--
-- Run this once, after 0001-0109, in the SQL Editor. The app falls back
-- to the old requests until it has run.

create or replace function public.challenge_boards(p_challenge_ids uuid[], p_as_of_days date[] default null)
returns table (challenge_id uuid, participants jsonb, bots jsonb)
language sql
stable
security definer set search_path = public
as $$
  with asked as (
    -- p_as_of_days lines up with p_challenge_ids; null (or a missing
    -- entry) means no as-of totals for that challenge.
    select distinct on (r.id) r.id, r.as_of
    from unnest(p_challenge_ids, p_as_of_days) as r(id, as_of)
    where r.id is not null
      and public.is_challenge_participant(r.id, auth.uid())
  ),
  totals as (
    select
      s.challenge_id,
      s.user_id,
      sum(s.steps)::bigint as steps,
      sum(s.distance_mi) as distance_mi,
      sum(s.steps) filter (where s.day <= a.as_of)::bigint as as_of_steps,
      sum(s.distance_mi) filter (where s.day <= a.as_of) as as_of_distance_mi
    from public.progress_snapshots s
    join asked a on a.id = s.challenge_id
    group by s.challenge_id, s.user_id
  )
  select
    a.id,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', cp.user_id,
        'role', cp.role,
        'highlighted', cp.highlighted,
        'name', p.name,
        'initials', p.initials,
        'username', p.username,
        'use_username', p.use_username,
        'frame_id', p.equipped_frame_id,
        'background_id', p.equipped_background_id,
        'icon_id', p.equipped_icon_id,
        'xp_total', p.xp_total,
        'steps', t.steps,
        'distance_mi', t.distance_mi,
        'as_of_steps', t.as_of_steps,
        'as_of_distance_mi', t.as_of_distance_mi
      ))
      from public.challenge_participants cp
      left join public.profiles p on p.id = cp.user_id
      left join totals t on t.challenge_id = cp.challenge_id and t.user_id = cp.user_id
      where cp.challenge_id = a.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'fitness_level', b.fitness_level, 'role', b.role))
      from public.challenge_bots b
      where b.challenge_id = a.id
    ), '[]'::jsonb)
  from asked a;
$$;

revoke execute on function public.challenge_boards(uuid[], date[]) from public, anon;
grant execute on function public.challenge_boards(uuid[], date[]) to authenticated;

-- Undo, if needed:
--   drop function public.challenge_boards(uuid[], date[]);
