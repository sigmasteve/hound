-- Hound: achievements — one-time badges for milestones, each paying a
-- small Bones reward exactly once.
--
-- Three pieces:
--   achievements       — the catalog (name, description, reward), seeded
--                        below. Readable by anyone signed in; admins can
--                        edit a reward or description later.
--   user_achievements  — who has earned what, and when. Append-only,
--                        written only by check_achievements(). Readable
--                        by the owner and by their accepted friends (the
--                        friend profile shows their badges).
--   check_achievements — evaluates every condition for the caller from
--                        data the server already has, records anything
--                        newly earned, and credits the Bones — the client
--                        never says "I earned X", it only asks "anything
--                        new?" (Home calls it on every load, right after
--                        the daily bonus claim).
--
-- Every condition reads data already in the database:
--   - finished challenges / wins: activity_events rows written by
--     settle_challenge_score (0066). A "win" is exactly the top-tier
--     result score that function awards: a Step Race 1st place (50), a
--     Tic-Tac-Go win (35), a Chase won as the Hunter (40, caught
--     everyone) or as a Hunted who was never caught (30).
--   - Bingo blackout (40) and a Daily Streak survived (40), likewise.
--   - friends: accepted friendships (0007).
--   - steps: daily_step_totals (0027) — the same self-reported device
--     totals every step leaderboard in the app already trusts.
--   - login streak: profiles.daily_bonus_streak (0070).
--   - level: level_for_xp(xp_total) (0060).
--
-- Rewards are recorded in the activity_events ledger (kind 'achievement')
-- and credited to bones_balance only — deliberately NOT bones_earned_total
-- (0066), same as the daily bonus: that total gates challenge unlocks and
-- stays "earned by finishing challenges".
--
-- Existing players get credit for anything they've already done the first
-- time the app checks (a one-time catch-up), since every condition reads
-- history, not just new events.
--
-- Run this once, after 0001-0071, in the SQL Editor.

create table public.achievements (
  id text primary key,
  name text not null,
  description text not null,
  bones int not null check (bones > 0),
  sort_order int not null
);

alter table public.achievements enable row level security;

create policy "Anyone signed in can browse achievements"
  on public.achievements for select
  to authenticated
  using (true);

create policy "Admins can edit achievements"
  on public.achievements for update
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

insert into public.achievements (id, name, description, bones, sort_order) values
  ('first_finish', 'First Finish', 'Finish your first challenge.', 10, 10),
  ('ten_finishes', 'Regular', 'Finish 10 challenges.', 50, 20),
  ('first_win', 'First Win', 'Win a Step Race, a Chase, or a game of Tic-Tac-Go.', 25, 30),
  ('blackout', 'Blackout', 'Fill a whole Variety Bingo card.', 25, 40),
  ('unbroken', 'Unbroken', 'Make it through a Daily Streak without missing a day.', 25, 50),
  ('first_friend', 'Pack of Two', 'Add your first friend.', 10, 60),
  ('five_friends', 'Pack Leader', 'Have 5 friends.', 25, 70),
  ('steps_10k_day', 'Five Digits', 'Walk 10,000 steps in a day.', 10, 80),
  ('steps_100k_week', 'Hundred Thousand', 'Walk 100,000 steps in a week.', 25, 90),
  ('streak_7', 'Week Strong', 'Open Hound 7 days in a row.', 15, 100),
  ('streak_30', 'Month Strong', 'Open Hound 30 days in a row.', 50, 110),
  ('level_5', 'Level 5', 'Reach level 5.', 20, 120),
  ('level_10', 'Level 10', 'Reach level 10.', 40, 130);

create table public.user_achievements (
  user_id uuid not null references public.profiles (id) on delete cascade,
  achievement_id text not null references public.achievements (id),
  earned_at timestamptz not null default now(),
  primary key (user_id, achievement_id)
);

alter table public.user_achievements enable row level security;

-- No insert/update/delete policy: check_achievements() is the only writer.
create policy "Users and their friends can view earned achievements"
  on public.user_achievements for select
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and ((f.requester_id = auth.uid() and f.recipient_id = user_achievements.user_id)
          or (f.recipient_id = auth.uid() and f.requester_id = user_achievements.user_id))
    )
  );

-- Returns only what was newly earned by this call (empty most of the
-- time). `for update` on the caller's profile serializes two concurrent
-- checks (Home's focus + resume firing together), and the primary key on
-- user_achievements means nothing can ever be awarded twice anyway.
create or replace function public.check_achievements()
returns table (achievement_id text, name text, bones int)
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  my_xp int;
  my_streak int;
  finished int;
  friend_count int;
  best_day int;
  week_steps int;
  total_bones int;
  new_ids text[];
begin
  if caller is null then
    raise exception 'Sign in to do that.';
  end if;

  select p.xp_total, p.daily_bonus_streak into my_xp, my_streak
    from public.profiles p where p.id = caller
    for update;
  if not found then
    raise exception 'No profile for this account.';
  end if;

  select count(distinct ae.challenge_id) into finished
    from public.activity_events ae
    where ae.user_id = caller
      and ae.challenge_id is not null
      and (ae.kind like '%\_result' or ae.kind = 'participation');

  select count(*) into friend_count
    from public.friendships f
    where f.status = 'accepted' and (f.requester_id = caller or f.recipient_id = caller);

  select coalesce(max(d.steps), 0) into best_day
    from public.daily_step_totals d where d.user_id = caller;

  select coalesce(sum(d.steps), 0) into week_steps
    from public.daily_step_totals d
    where d.user_id = caller and d.day > (now() at time zone 'utc')::date - 7;

  select coalesce(array_agg(a.id), '{}') into new_ids
  from public.achievements a
  where not exists (
      select 1 from public.user_achievements ua where ua.user_id = caller and ua.achievement_id = a.id
    )
    and case a.id
      when 'first_finish' then finished >= 1
      when 'ten_finishes' then finished >= 10
      when 'first_win' then exists (
        select 1 from public.activity_events ae
        where ae.user_id = caller
          and ((ae.kind = 'steps_result' and ae.score_points = 50)
            or (ae.kind = 'tictacgo_result' and ae.score_points = 35)
            or (ae.kind = 'hunt_result' and ae.score_points in (40, 30)))
      )
      when 'blackout' then exists (
        select 1 from public.activity_events ae
        where ae.user_id = caller and ae.kind = 'bingo_result' and ae.score_points = 40
      )
      when 'unbroken' then exists (
        select 1 from public.activity_events ae
        where ae.user_id = caller and ae.kind = 'streak_result' and ae.score_points = 40
      )
      when 'first_friend' then friend_count >= 1
      when 'five_friends' then friend_count >= 5
      when 'steps_10k_day' then best_day >= 10000
      when 'steps_100k_week' then week_steps >= 100000
      when 'streak_7' then coalesce(my_streak, 0) >= 7
      when 'streak_30' then coalesce(my_streak, 0) >= 30
      when 'level_5' then public.level_for_xp(coalesce(my_xp, 0)) >= 5
      when 'level_10' then public.level_for_xp(coalesce(my_xp, 0)) >= 10
      else false
    end;

  if cardinality(new_ids) = 0 then
    return;
  end if;

  insert into public.user_achievements (user_id, achievement_id)
    select caller, unnest(new_ids)
    on conflict do nothing;

  insert into public.activity_events (user_id, kind, score_points, xp_points, bones_points)
    select caller, 'achievement', 0, 0, a.bones
    from public.achievements a where a.id = any (new_ids);

  select coalesce(sum(a.bones), 0) into total_bones
    from public.achievements a where a.id = any (new_ids);
  update public.profiles set bones_balance = bones_balance + total_bones where id = caller;

  return query
    select a.id, a.name, a.bones
    from public.achievements a where a.id = any (new_ids)
    order by a.sort_order;
end;
$$;

revoke execute on function public.check_achievements() from public, anon;
grant execute on function public.check_achievements() to authenticated;
