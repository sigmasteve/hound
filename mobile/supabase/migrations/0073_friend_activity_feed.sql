-- Hound: a friend activity feed — recent highlights from the caller's
-- accepted friends ("Avery won a Step Race", "Blake unlocked Week
-- Strong"), shown on the Friends tab.
--
-- activity_events and user_achievements are private-by-default ledgers
-- (0058's own-rows-only policy; 0072's owner-and-friends policy), and a
-- feed needs a few friends' rows at once, so this is one security-definer
-- function rather than a wider select policy: it returns only rows
-- belonging to the caller's accepted friends, only the highlight kinds
-- below, only the last 14 days, and never anything about a challenge
-- beyond its kind — no names, no other participants — since the caller
-- may not have been in it.
--
-- Highlight kinds (the same top-tier result scores 0072's achievements
-- read from settle_challenge_score, 0066):
--   won_steps        Step Race 1st place          steps_result = 50
--   won_tictacgo     Tic-Tac-Go win               tictacgo_result = 35
--   won_chase_hunter caught everyone in a Chase   hunt_result = 40
--   won_chase_escape escaped in a Chase           hunt_result = 30
--   bingo_blackout   filled a whole Bingo card    bingo_result = 40
--   streak_survived  a Daily Streak with no miss  streak_result = 40
--   achievement      unlocked a badge (detail = its name)
--
-- Run this once, after 0001-0072, in the SQL Editor.

create or replace function public.friend_activity_feed(p_limit int default 30)
returns table (
  event_id text,
  user_id uuid,
  kind text,
  detail text,
  occurred_at timestamptz,
  name text,
  initials text,
  frame_id text,
  background_id text,
  icon_id text
)
language sql
stable
security definer
set search_path = public
as $$
  with friends as (
    select case when f.requester_id = auth.uid() then f.recipient_id else f.requester_id end as fid
    from public.friendships f
    where f.status = 'accepted'
      and (f.requester_id = auth.uid() or f.recipient_id = auth.uid())
  ),
  events as (
    select
      'r:' || ae.id::text as event_id,
      ae.user_id,
      case
        when ae.kind = 'steps_result' then 'won_steps'
        when ae.kind = 'tictacgo_result' then 'won_tictacgo'
        when ae.kind = 'hunt_result' and ae.score_points = 40 then 'won_chase_hunter'
        when ae.kind = 'hunt_result' then 'won_chase_escape'
        when ae.kind = 'bingo_result' then 'bingo_blackout'
        else 'streak_survived'
      end as kind,
      null::text as detail,
      ae.created_at as occurred_at
    from public.activity_events ae
    join friends on friends.fid = ae.user_id
    where ae.created_at > now() - interval '14 days'
      and ((ae.kind = 'steps_result' and ae.score_points = 50)
        or (ae.kind = 'tictacgo_result' and ae.score_points = 35)
        or (ae.kind = 'hunt_result' and ae.score_points in (40, 30))
        or (ae.kind = 'bingo_result' and ae.score_points = 40)
        or (ae.kind = 'streak_result' and ae.score_points = 40))
    union all
    select
      'a:' || ua.user_id::text || ':' || ua.achievement_id,
      ua.user_id,
      'achievement',
      a.name,
      ua.earned_at
    from public.user_achievements ua
    join friends on friends.fid = ua.user_id
    join public.achievements a on a.id = ua.achievement_id
    where ua.earned_at > now() - interval '14 days'
  )
  select e.event_id, e.user_id, e.kind, e.detail, e.occurred_at,
    p.name, p.initials, p.equipped_frame_id, p.equipped_background_id, p.equipped_icon_id
  from events e
  join public.profiles p on p.id = e.user_id
  where auth.uid() is not null
  order by e.occurred_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 50);
$$;

revoke execute on function public.friend_activity_feed(int) from public, anon;
grant execute on function public.friend_activity_feed(int) to authenticated;
