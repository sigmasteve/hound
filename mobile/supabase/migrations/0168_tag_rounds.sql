-- Hound: Game of Tag counts each round from the reset.
--
-- Until now Tag compared lifetime totals: It could only pick someone
-- who had logged more than It over the whole game (0047), and caught
-- them by reaching that person's total. On a new game nobody is ahead,
-- so It had nobody to pick and the app said "Nobody's ahead of you
-- yet" until the round timed out.
--
-- Now every round starts from zero. When a round starts (a new game, a
-- catch, or the 15-minute reset), tag_rounds.baselines records each
-- player's total at that moment. A player's steps in the round are
-- their total now minus that baseline.
--   - It can pick anyone except whoever tagged them last (no
--     tag-backs), unless it's just the two of them.
--   - The chase starts at the pick: It tags the target by logging more
--     than the target from the moment It picked them. The target's
--     steps count too, so they can run. There are no instant tags:
--     steps walked before the pick don't count for either of them.
--   - A player who hasn't synced any steps to the game yet has no
--     baseline: their first sync sets it, so a day's steps synced late
--     don't count as steps in the round. That covers a brand-new game,
--     where everyone joins with nothing synced yet.
-- target_snapshot_metric and the new it_snapshot_metric hold the
-- target's and It's steps in the round at the pick, and a catch's
-- tag_events.metric the target's steps since the pick.
--
-- Rounds are longer, and the creator picks how long: 1 hour, 1½ hours
-- or 2 hours (challenges.tag_round_minutes; empty means an hour, which
-- games already running get too). It was a fixed 15 minutes.
--
-- Run this once, after 0167, in the SQL Editor.

alter table public.challenges
  add column tag_round_minutes int check (tag_round_minutes in (60, 90, 120));

comment on column public.challenges.tag_round_minutes is
  'Game of Tag: how long It has to pick and catch someone before It passes on. Empty means 60.';

alter table public.tag_rounds
  add column baselines jsonb not null default '{}'::jsonb,
  add column it_snapshot_metric numeric;

comment on column public.tag_rounds.baselines is
  'Each player''s total (steps or miles, the challenge''s unit) when this round started: {user_id: total}.';

-- Everyone's total right now, as a baseline map: everyone who has
-- synced steps to the game so far.
create or replace function public.tag_baselines_now(p_challenge_id uuid)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select coalesce(jsonb_object_agg(t.user_id::text, t.total), '{}'::jsonb)
  from (
    select ps.user_id,
           sum(case when c.distance_goal_unit = 'steps' then ps.steps else ps.distance_mi end) as total
    from public.progress_snapshots ps
    join public.challenges c on c.id = ps.challenge_id
    join public.challenge_participants cp on cp.challenge_id = ps.challenge_id and cp.user_id = ps.user_id
    where ps.challenge_id = p_challenge_id
    group by ps.user_id
  ) t;
$$;

revoke execute on function public.tag_baselines_now(uuid) from public, anon, authenticated;

-- A player's steps (or miles) in the current round. Someone with no
-- baseline yet has logged nothing in it.
create or replace function public.tag_round_gain(p_challenge_id uuid, p_user_id uuid)
returns numeric
language sql
stable
security definer set search_path = public
as $$
  select greatest(0, t.total - coalesce((tr.baselines ->> p_user_id::text)::numeric, t.total))
  from public.tag_rounds tr
  join public.challenges c on c.id = tr.challenge_id
  cross join lateral (select public.tag_metric_total(p_challenge_id, p_user_id, c.distance_goal_unit) as total) t
  where tr.challenge_id = p_challenge_id;
$$;

revoke execute on function public.tag_round_gain(uuid, uuid) from public, anon, authenticated;

-- Games already running start counting from now.
update public.tag_rounds
  set baselines = public.tag_baselines_now(challenge_id),
      target_snapshot_metric = case when target_user_id is null then null else 0 end,
      it_snapshot_metric = case when target_user_id is null then null else 0 end
  where challenge_id is not null;

-- A player's first sync in a round sets their baseline, so the steps
-- they'd already walked before it don't count.
create or replace function public.tag_first_sync()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update public.tag_rounds tr
    set baselines = tr.baselines || jsonb_build_object(new.user_id::text,
          public.tag_metric_total(new.challenge_id, new.user_id, c.distance_goal_unit))
    from public.challenges c
    where tr.challenge_id = new.challenge_id and c.id = tr.challenge_id
      and not tr.baselines ? new.user_id::text;
  return new;
end;
$$;

revoke execute on function public.tag_first_sync() from public, anon, authenticated;
create trigger tag_first_sync after insert or update on public.progress_snapshots
  for each row execute procedure public.tag_first_sync();

-- It picks anyone: no more "only someone ahead of you" (0047).
create or replace function public.tag_select_target(challenge_id uuid, target_user_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  my_last_tagged_by uuid;
begin
  perform public.tag_settle_timeout(tag_select_target.challenge_id);

  if not exists (
    select 1 from public.tag_rounds tr
    where tr.challenge_id = tag_select_target.challenge_id and tr.it_user_id = caller
  ) then
    raise exception 'You''re not currently "IT" in this game.';
  end if;
  if target_user_id = caller then
    raise exception 'You can''t tag yourself.';
  end if;
  if not exists (
    select 1 from public.challenge_participants cp
    where cp.challenge_id = tag_select_target.challenge_id and cp.user_id = tag_select_target.target_user_id
  ) then
    raise exception 'That person isn''t in this game.';
  end if;

  select last_tagged_by into my_last_tagged_by
    from public.challenge_participants
    where challenge_participants.challenge_id = tag_select_target.challenge_id and user_id = caller;
  -- With just the two of you, tagging back is the only move there is.
  if my_last_tagged_by = target_user_id
     and (select count(*) from public.challenge_participants cp
          where cp.challenge_id = tag_select_target.challenge_id) > 2 then
    raise exception 'No tag-backs — pick someone else.';
  end if;

  update public.tag_rounds
    set target_user_id = tag_select_target.target_user_id,
        target_snapshot_metric = public.tag_round_gain(tag_select_target.challenge_id, tag_select_target.target_user_id),
        it_snapshot_metric = public.tag_round_gain(tag_select_target.challenge_id, caller),
        updated_at = now()
    where tag_rounds.challenge_id = tag_select_target.challenge_id;
end;
$$;

grant execute on function public.tag_select_target(uuid, uuid) to authenticated;

-- A catch: since the pick, It has logged more than the target has.
-- Starts the next round, with the caught player as It.
create or replace function public.tag_check_catch(challenge_id uuid)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  target uuid;
  my_start numeric;
  their_start numeric;
  my_gain numeric;
  their_gain numeric;
begin
  perform public.tag_settle_timeout(tag_check_catch.challenge_id);

  select tr.target_user_id, coalesce(tr.it_snapshot_metric, 0), coalesce(tr.target_snapshot_metric, 0)
    into target, my_start, their_start
    from public.tag_rounds tr
    where tr.challenge_id = tag_check_catch.challenge_id and tr.it_user_id = caller;
  if target is null then
    -- Either the caller isn't (or no longer is) IT, or IT hasn't
    -- picked anyone yet — nothing to check either way.
    return false;
  end if;

  my_gain := public.tag_round_gain(tag_check_catch.challenge_id, caller) - my_start;
  their_gain := greatest(0, public.tag_round_gain(tag_check_catch.challenge_id, target) - their_start);
  if my_gain <= their_gain then
    return false;
  end if;

  update public.challenge_participants
    set tags_made = tags_made + 1
    where challenge_participants.challenge_id = tag_check_catch.challenge_id and user_id = caller;
  update public.challenge_participants
    set last_tagged_by = caller
    where challenge_participants.challenge_id = tag_check_catch.challenge_id and user_id = target;
  insert into public.tag_events (challenge_id, tagger_id, tagged_id, metric, kind)
    values (tag_check_catch.challenge_id, caller, target, their_gain, 'catch');
  update public.tag_rounds
    set it_user_id = target, target_user_id = null, target_snapshot_metric = null, it_snapshot_metric = null,
        baselines = public.tag_baselines_now(tag_check_catch.challenge_id),
        round_started_at = now(), updated_at = now()
    where tag_rounds.challenge_id = tag_check_catch.challenge_id;

  begin
    perform net.http_post(
      url := public.edge_function_url('send-tag-notification'),
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object(
        'kind', 'caught',
        'challenge_id', tag_check_catch.challenge_id,
        'new_it_user_id', target,
        'tagger_id', caller
      )
    );
  exception when others then
    -- The catch itself already landed above — a notification failure
    -- is never a reason to fail the whole catch.
    null;
  end;

  return true;
end;
$$;

grant execute on function public.tag_check_catch(uuid) to authenticated;

-- The reset, once the round's time is up (the creator's 1 to 2 hours,
-- not 15 minutes): as before, It passes to someone else at random (or
-- the clock restarts when nobody else has joined), and now the new
-- round starts from everyone's totals at the reset.
create or replace function public.tag_settle_timeout(challenge_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  current_it uuid;
  started_at timestamptz;
  next_it uuid;
begin
  select it_user_id, round_started_at into current_it, started_at
    from public.tag_rounds where tag_rounds.challenge_id = tag_settle_timeout.challenge_id;
  if current_it is null then
    return;
  end if;
  if now() < started_at + interval '1 minute' * coalesce(
       (select c.tag_round_minutes from public.challenges c where c.id = tag_settle_timeout.challenge_id), 60) then
    return;
  end if;

  select cp.user_id into next_it
    from public.challenge_participants cp
    where cp.challenge_id = tag_settle_timeout.challenge_id and cp.user_id != current_it
    order by random()
    limit 1;

  if next_it is null then
    -- Nobody else has joined yet: restart the clock, and the round.
    update public.tag_rounds
      set round_started_at = now(), target_user_id = null, target_snapshot_metric = null, it_snapshot_metric = null,
          baselines = public.tag_baselines_now(tag_settle_timeout.challenge_id), updated_at = now()
      where tag_rounds.challenge_id = tag_settle_timeout.challenge_id;
    return;
  end if;

  update public.tag_rounds
    set it_user_id = next_it,
        target_user_id = null,
        target_snapshot_metric = null, it_snapshot_metric = null,
        baselines = public.tag_baselines_now(tag_settle_timeout.challenge_id),
        round_started_at = now(),
        updated_at = now()
    where tag_rounds.challenge_id = tag_settle_timeout.challenge_id;
  insert into public.tag_events (challenge_id, tagger_id, tagged_id, metric, kind)
    values (tag_settle_timeout.challenge_id, null, next_it, null, 'timeout');

  begin
    perform net.http_post(
      url := public.edge_function_url('send-tag-notification'),
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object(
        'kind', 'timeout',
        'challenge_id', tag_settle_timeout.challenge_id,
        'new_it_user_id', next_it
      )
    );
  exception when others then
    null;
  end;
end;
$$;

grant execute on function public.tag_settle_timeout(uuid) to authenticated;
