-- Hound: Admin → Engagement, the numbers behind "is it working?" For
-- platform admins only. The default friend account (0034) isn't counted
-- as a member anywhere.
--
-- "Opened the app" on a day = the daily bonus was claimed that day (0070
-- claims it automatically on every first open), so it goes back as far
-- as the bonus does. Days are UTC.
--
--   members        everyone
--   active         opened the app in the last 1, 7 and 30 days
--   daily          people who opened it each of the last 14 days
--   new_members    joined in the last 30 days, and of them how many:
--                  connected health (a day of steps on file), picked how
--                  they'll use Hound, set their goals, allowed
--                  notifications, added a friend, joined a challenge,
--                  finished setup (0109) and use their hound as avatar
--   came_back      of people who joined 2-31 days ago, how many opened
--                  the app the day after joining; of those who joined
--                  8-60 days ago, how many opened it in their second week
--                  (days 7-13 after joining)
--   week           the last 7 days: goal days paid, treats and meals,
--                  Kennel items bought, Bone Digs, bounties posted,
--                  challenges started, global challenges joined and
--                  sponsor link taps
--
-- Run this once, after 0001-0112, in the SQL Editor.

create or replace function public.admin_engagement()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'utc')::date;
  result jsonb;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;

  with members as (
    select p.id, p.created_at, (p.created_at at time zone 'utc')::date as joined_on
    from public.profiles p
    where not coalesce(p.is_default_friend, false)
  ),
  opens as (
    select distinct a.user_id, (a.created_at at time zone 'utc')::date as day
    from public.activity_events a
    join members m on m.id = a.user_id
    where a.kind = 'daily_bonus' and a.created_at > now() - interval '75 days'
  ),
  recent as (
    select m.* from members m where m.created_at > now() - interval '30 days'
  )
  select jsonb_build_object(
    'members', (select count(*) from members),
    'active', jsonb_build_object(
      'day', (select count(distinct user_id) from opens where day >= today - 0),
      'week', (select count(distinct user_id) from opens where day > today - 7),
      'month', (select count(distinct user_id) from opens where day > today - 30)
    ),
    'daily', (
      select jsonb_agg(jsonb_build_object('day', d::date, 'people', (select count(*) from opens o where o.day = d::date)) order by d)
      from generate_series(today - 13, today, interval '1 day') d
    ),
    'new_members', jsonb_build_object(
      'joined', (select count(*) from recent),
      'health', (select count(*) from recent r where exists (
        select 1 from public.daily_step_totals d where d.user_id = r.id and d.steps > 0)),
      'uses', (select count(*) from recent r join public.profiles p on p.id = r.id where cardinality(p.hound_uses) > 0),
      'goals', (select count(*) from recent r join public.hound_settings h on h.user_id = r.id where h.goals_set_at is not null),
      'notifications', (select count(*) from recent r join public.profiles p on p.id = r.id where p.push_permission = 'granted'),
      'friend', (select count(*) from recent r where exists (
        select 1 from public.friendships f
        join public.profiles other
          on other.id = case when f.requester_id = r.id then f.recipient_id else f.requester_id end
        where (f.requester_id = r.id or (f.recipient_id = r.id and f.status = 'accepted'))
          and not other.is_default_friend)),
      'challenge', (select count(*) from recent r where exists (
        select 1 from public.challenge_participants cp where cp.user_id = r.id)),
      'finished_setup', (select count(*) from recent r join public.profiles p on p.id = r.id where p.welcome_done_at is not null),
      'hound_avatar', (select count(*) from recent r join public.profiles p on p.id = r.id where p.equipped_icon_id like 'hound:%')
    ),
    'came_back', jsonb_build_object(
      'next_day_of', (select count(*) from members m where m.joined_on between today - 31 and today - 2),
      'next_day', (select count(*) from members m where m.joined_on between today - 31 and today - 2
        and exists (select 1 from opens o where o.user_id = m.id and o.day = m.joined_on + 1)),
      'second_week_of', (select count(*) from members m where m.joined_on between today - 60 and today - 14),
      'second_week', (select count(*) from members m where m.joined_on between today - 60 and today - 14
        and exists (select 1 from opens o where o.user_id = m.id and o.day between m.joined_on + 7 and m.joined_on + 13))
    ),
    'week', jsonb_build_object(
      'goal_days', (select count(*) from public.activity_events a where a.kind = 'goal_day' and a.created_at > now() - interval '7 days'),
      'treats', (select count(*) from public.kennels k where k.treated_on > today - 7),
      'kennel_items', (select count(*) from public.kennel_purchases k where k.purchased_at > now() - interval '7 days' and k.bones > 0),
      'bone_digs', (select count(*) from public.bone_digs b where b.day > today - 7),
      'bounties', (select count(*) from public.bounties b where b.created_at > now() - interval '7 days'),
      'challenges', (select count(*) from public.challenges c where c.created_at > now() - interval '7 days' and not c.is_global),
      'global_joins', (select count(*) from public.challenge_participants cp join public.challenges c on c.id = cp.challenge_id
        where c.is_global and cp.joined_at > now() - interval '7 days'),
      'sponsor_taps', (select count(*) from public.sponsor_link_clicks s where s.clicked_at > now() - interval '7 days')
    )
  ) into result;

  return result;
end;
$$;

revoke execute on function public.admin_engagement() from public, anon;
grant execute on function public.admin_engagement() to authenticated;

-- Undo, if needed:
--   drop function public.admin_engagement();
