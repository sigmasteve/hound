-- 0233: Step challenges, more than a leaderboard (approved mockup
-- claude.ai/artifact/17YoJpFbHGVeWq335R1hj1). The story itself is worked
-- out in the app from everyone's daily steps (progress_snapshots, which
-- participants can already read, and the bots' simulated steps):
--   the race      Most steps drawn as lanes on a course of the
--                 challenge's days x 10,000 steps, with checkpoints at a
--                 quarter, half and three quarters (first to each wears
--                 a ribbon)
--   yesterday     the hounds run from where they stood at the start of
--                 yesterday to the end of it; overtakes, the big day
--   a rival       each day, the person just ahead of you when it began
--                 (or just behind, when you lead): out-walk them that
--                 day for a rival badge
--   bounties      one a day, the same for everyone, in turn: 10,000
--                 steps; the biggest day; beat your own yesterday; a
--                 tenth over your own average so far. A star each; stars
--                 show on the board and don't change the score.
--   the finish    the reveal: the hounds cross the line in order, then a
--                 podium
--   the trail     a Distance pool walks one trail together, landmarks at
--                 each quarter of the goal
-- Here: the creator's options and the engagement numbers.
--
--   challenges.step_rivals      default on
--   challenges.step_bounties    default on
--   challenges.blackout_last_day  default off: for the last 24 hours the
--                 standings go dark (everyone sees only their own steps)
--                 and the 8 PM standings push stays quiet.
--   step_story_seen             who saw what, once a day each: the race,
--                 yesterday's replay, the finish, the trail, a rival
--                 beaten, a bounty star (logged by the app when it shows
--                 one), through log_step_story().
--   admin_step_story_overview() the Admin fold.
--
-- Run after 0232. Then redeploy send-daily-standings (it reads
-- blackout_last_day).

alter table public.challenges add column if not exists step_rivals boolean not null default true;
alter table public.challenges add column if not exists step_bounties boolean not null default true;
alter table public.challenges add column if not exists blackout_last_day boolean not null default false;

create table public.step_story_seen (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('race', 'list', 'replay', 'finish', 'trail', 'rival_beaten', 'bounty_star', 'checkpoint')),
  created_at timestamptz not null default now(),
  primary key (challenge_id, user_id, day, kind)
);
create index step_story_seen_created_idx on public.step_story_seen (created_at);
alter table public.step_story_seen enable row level security;
revoke all on public.step_story_seen from anon;
revoke insert, update, delete on public.step_story_seen from authenticated;
create policy "People can view their own step story log"
  on public.step_story_seen for select to authenticated
  using (user_id = auth.uid());

-- Logged by the app, once a day per kind. Participants only; the day is
-- the caller's own.
create or replace function public.log_step_story(p_challenge_id uuid, p_kind text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null
     or not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = caller) then
    raise exception 'not authorized';
  end if;
  if p_kind is null or p_kind not in ('race', 'list', 'replay', 'finish', 'trail', 'rival_beaten', 'bounty_star', 'checkpoint') then
    raise exception 'Unknown kind.';
  end if;
  insert into public.step_story_seen (challenge_id, user_id, day, kind)
    values (p_challenge_id, caller, public.soccer_today(caller), p_kind)
    on conflict do nothing;
end;
$$;
revoke execute on function public.log_step_story(uuid, text) from public, anon;
grant execute on function public.log_step_story(uuid, text) to authenticated;

create or replace function public.admin_step_story_overview()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;
  return (
    with w as (select * from public.step_story_seen s where s.created_at > now() - interval '7 days')
    select jsonb_build_object(
      'live_steps', (select count(*) from public.challenges c where c.kind = 'steps' and c.starts_at <= now() and c.ends_at > now()),
      'live_pools', (select count(*) from public.challenges c where c.kind = 'distance' and c.starts_at <= now() and c.ends_at > now()),
      'live_blackout', (select count(*) from public.challenges c where c.kind = 'steps' and c.blackout_last_day and c.starts_at <= now() and c.ends_at > now()),
      'live_no_rivals', (select count(*) from public.challenges c where c.kind = 'steps' and not c.step_rivals and c.starts_at <= now() and c.ends_at > now()),
      'live_no_bounties', (select count(*) from public.challenges c where c.kind = 'steps' and not c.step_bounties and c.starts_at <= now() and c.ends_at > now()),
      'people_7d', (select count(distinct w.user_id) from w),
      'race_people_7d', (select count(distinct w.user_id) from w where w.kind = 'race'),
      'race_days_7d', (select count(*) from w where w.kind = 'race'),
      'list_people_7d', (select count(distinct w.user_id) from w where w.kind = 'list'),
      'replay_people_7d', (select count(distinct w.user_id) from w where w.kind = 'replay'),
      'replays_7d', (select count(*) from w where w.kind = 'replay'),
      'finish_people_7d', (select count(distinct w.user_id) from w where w.kind = 'finish'),
      'trail_people_7d', (select count(distinct w.user_id) from w where w.kind = 'trail'),
      'rivals_beaten_7d', (select count(*) from w where w.kind = 'rival_beaten'),
      'bounty_stars_7d', (select count(*) from w where w.kind = 'bounty_star'),
      'checkpoints_7d', (select count(*) from w where w.kind = 'checkpoint')
    )
  );
end;
$$;
revoke execute on function public.admin_step_story_overview() from public, anon;
grant execute on function public.admin_step_story_overview() to authenticated;
