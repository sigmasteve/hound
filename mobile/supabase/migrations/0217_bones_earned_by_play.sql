-- Hound: "Earned by playing" counts all play, and locked games are locked
-- on the server too (Steve, 17 Nov 2026).
--
-- bones_earned_total (0066) is what opens a locked game (0067). Until now
-- only challenge settling added to it, so goal days, goal weeks, the daily
-- bonus, Bone Dig, badges and finishing setup paid Bones into the balance
-- without counting toward unlocks. Every one of those records itself in
-- activity_events with its Bones (bones_points), and nothing else writes
-- those kinds, so one trigger on that ledger counts them all from here on,
-- and the same ledger backfills what people already won.
--
-- Left out on purpose:
--   - bought Bones (credit_bones_purchase) and rewarded ads: not play;
--   - bounties and challenge pots: they move Bones between friends, so
--     bought Bones could be passed through a friend and come out "earned";
--   - refunds of your own bounty.
--
-- Creating a challenge of a locked kind is refused unless the creator has
-- earned enough, whatever app version they use. Joining one you're invited
-- to, and global challenges, are never locked.
--
-- admin_challenge_unlocks_overview(): for each locked game, how many
-- active people have reached it and how many games of it were made, for
-- Admin → Overview → Games → Game unlocks.
--
-- Run this once, after 0001-0216, in the SQL Editor.

-- ── Earned by playing ──

create or replace function public.bones_earned_from_play()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.kind in ('goal_day', 'goal_week', 'daily_bonus', 'bone_dig', 'achievement', 'onboarding_reward')
     and coalesce(new.bones_points, 0) > 0 then
    update public.profiles p
      set bones_earned_total = coalesce(p.bones_earned_total, 0) + new.bones_points
      where p.id = new.user_id;
  end if;
  return new;
end;
$$;
revoke execute on function public.bones_earned_from_play() from public, anon, authenticated;
drop trigger if exists bones_earned_from_play on public.activity_events;
create trigger bones_earned_from_play after insert on public.activity_events
  for each row execute procedure public.bones_earned_from_play();

-- What people already won from these, once.
update public.profiles p
  set bones_earned_total = coalesce(p.bones_earned_total, 0) + e.bones
  from (
    select a.user_id, sum(a.bones_points)::int as bones
    from public.activity_events a
    where a.kind in ('goal_day', 'goal_week', 'daily_bonus', 'bone_dig', 'achievement', 'onboarding_reward')
      and coalesce(a.bones_points, 0) > 0
    group by a.user_id
  ) e
  where p.id = e.user_id;

-- ── Locked games, on the server ──

create or replace function public.challenge_unlock_guard()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  need int;
  have int;
begin
  -- Global challenges are for everyone; server jobs have no caller.
  if new.is_global or auth.uid() is null or new.created_by is distinct from auth.uid() then
    return new;
  end if;
  select g.bones_required into need from public.challenge_unlock_gates g where g.kind = new.kind;
  if need is null then
    return new;
  end if;
  select coalesce(p.bones_earned_total, 0) into have from public.profiles p where p.id = new.created_by;
  if coalesce(have, 0) < need then
    raise exception 'This game opens at % Bones earned by playing.', need;
  end if;
  return new;
end;
$$;
revoke execute on function public.challenge_unlock_guard() from public, anon, authenticated;
drop trigger if exists challenge_unlock_guard on public.challenges;
create trigger challenge_unlock_guard before insert on public.challenges
  for each row execute procedure public.challenge_unlock_guard();

-- ── Admin ──

create or replace function public.admin_challenge_unlocks_overview()
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
    with people as (
      select p.id, coalesce(p.bones_earned_total, 0) as earned
      from public.profiles p
      where p.last_active_at > now() - interval '30 days'
    ),
    gates as (
      select g.kind::text as kind, g.bones_required from public.challenge_unlock_gates g
    )
    select jsonb_build_object(
      'active_30d', (select count(*) from people),
      'median_earned', (select coalesce(percentile_disc(0.5) within group (order by earned), 0) from people),
      'open_all', (select count(*) from people pe where not exists (select 1 from gates g where pe.earned < g.bones_required)),
      'gates', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'kind', g.kind,
          'bones', g.bones_required,
          'reached', (select count(*) from people pe where pe.earned >= g.bones_required),
          'made_30d', (select count(*) from public.challenges c
                       where c.kind::text = g.kind and not c.is_global and c.created_at > now() - interval '30 days')
        ) order by g.bones_required, g.kind), '[]'::jsonb)
        from gates g
      )
    )
  );
end;
$$;
revoke execute on function public.admin_challenge_unlocks_overview() from public, anon;
grant execute on function public.admin_challenge_unlocks_overview() to authenticated;
