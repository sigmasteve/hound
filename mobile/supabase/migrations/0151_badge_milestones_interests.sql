-- Hound: K-06 and K-08 from testers' feedback.
--
-- K-06, milestone badges: three new achievements for finishing 25, 50
-- and 100 challenges (Seasoned, Veteran, Centurion). The app makes them
-- shareable as a picture; nothing here is needed for that.
--
--   They count only finishes that are hard to farm: challenges that ran
--   at least 3 days, or had someone else in them. A one-day challenge on
--   your own, created and finished over and over, doesn't count. The
--   existing First Finish and Regular (10) keep counting every finish.
--   Awarding stays exactly-once (user_achievements' primary key), and
--   check_achievements is 0072's with the three new conditions.
--   my_finish_progress() gives the app the count, for "37 of 50".
--
-- K-08, interests: what someone's working toward (athlete, sports,
-- gym, weight loss, general fitness), asked in onboarding and editable
-- in Settings, to personalise discovery later. Kept in its own table that
-- only its owner can read: profiles rows are readable by other signed-in
-- users, and "losing weight" isn't for anyone else to see.
--
-- Run this once, after 0001-0150, in the SQL Editor, before publishing
-- the app update that goes with it.

insert into public.achievements (id, name, description, bones, sort_order) values
  ('finishes_25', 'Seasoned', 'Finish 25 challenges.', 75, 21),
  ('finishes_50', 'Veteran', 'Finish 50 challenges.', 125, 22),
  ('finishes_100', 'Centurion', 'Finish 100 challenges.', 250, 23)
on conflict (id) do nothing;

-- Finished challenges that count toward the milestones: ran at least 3
-- days, or had someone else in them.
create or replace function public.milestone_finishes(p_user uuid)
returns integer
language sql
stable
security definer set search_path = public
as $$
  select count(distinct ae.challenge_id)::integer
  from public.activity_events ae
  join public.challenges c on c.id = ae.challenge_id
  where ae.user_id = p_user
    and (ae.kind like '%\_result' or ae.kind = 'participation')
    and (
      c.duration_days >= 3
      or exists (
        select 1 from public.challenge_participants cp
        where cp.challenge_id = c.id and cp.user_id <> p_user
      )
    );
$$;

revoke execute on function public.milestone_finishes(uuid) from public, anon, authenticated;

create or replace function public.my_finish_progress()
returns integer
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to do that.';
  end if;
  return public.milestone_finishes(auth.uid());
end;
$$;

revoke execute on function public.my_finish_progress() from public, anon;
grant execute on function public.my_finish_progress() to authenticated;

-- 0072's check_achievements, with the milestone badges.
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
  counted int;
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

  counted := public.milestone_finishes(caller);

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
      when 'finishes_25' then counted >= 25
      when 'finishes_50' then counted >= 50
      when 'finishes_100' then counted >= 100
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

-- ── K-08: interests ──────────────────────────────────────────────────

create table public.profile_interests (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  interests text[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.profile_interests enable row level security;

create policy "Users can view their own interests"
  on public.profile_interests for select to authenticated
  using (user_id = auth.uid());

revoke all on public.profile_interests from anon;
revoke insert, update, delete on public.profile_interests from authenticated;

-- src/onboarding/interests.ts mirrors these ids. Unknown ones are dropped.
create or replace function public.save_my_interests(p_interests text[])
returns text[]
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  cleaned text[];
begin
  if caller is null then
    raise exception 'Sign in to do that.';
  end if;
  select coalesce(array_agg(distinct i order by i), '{}') into cleaned
  from unnest(coalesce(p_interests, '{}')) i
  where i in ('athlete', 'sports', 'gym', 'weight_loss', 'general');
  insert into public.profile_interests (user_id, interests) values (caller, cleaned)
  on conflict (user_id) do update set interests = excluded.interests, updated_at = now();
  return cleaned;
end;
$$;

revoke execute on function public.save_my_interests(text[]) from public, anon;
grant execute on function public.save_my_interests(text[]) to authenticated;

-- Undo, if needed:
--   drop function public.save_my_interests(text[]);
--   drop table public.profile_interests;
--   drop function public.my_finish_progress();
--   then run 0072's check_achievements again, and:
--   drop function public.milestone_finishes(uuid);
--   delete from public.user_achievements where achievement_id in ('finishes_25', 'finishes_50', 'finishes_100');
--   delete from public.achievements where id in ('finishes_25', 'finishes_50', 'finishes_100');
