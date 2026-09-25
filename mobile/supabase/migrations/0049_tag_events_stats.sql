-- Hound: Game of Tag recap stats — "no winner" is the whole point of
-- this mechanic (see 0045_tag_game_state.sql's own "deliberately
-- anti-competitive" note), but a finished game still deserves a recap
-- of how it actually played out: how many times each participant was
-- It, how many times they were caught, and how many people they
-- caught themselves.
--
-- tags_made (challenge_participants) already covers the last of those.
-- The other two need every "who becomes It" transition logged, not
-- just real catches (tag_events, until now, only ever recorded a catch)
-- — a stalled round timing out (tag_settle_timeout) hands It to someone
-- new too, and the very first It (the creator, via
-- handle_new_tag_challenge) never got logged anywhere at all. This
-- extends tag_events to cover all three with a `kind` column, reusing
-- tagged_id as "who becomes It as of this event" uniformly across all
-- three kinds (for 'catch' it doubles as literally who got tagged,
-- which is also who's now It — the same person, the same column) —
-- tagger_id/metric stay meaningful only for 'catch' (nobody "tags"
-- anyone on a timeout or a game's opening move), hence dropped to
-- nullable.
--
-- Run this once, after 0048, in the SQL Editor.

alter table public.tag_events
  add column kind text not null default 'catch' check (kind in ('catch', 'timeout', 'start'));

alter table public.tag_events
  alter column tagger_id drop not null,
  alter column metric drop not null;

comment on column public.tag_events.tagged_id is
  'Who becomes It as of this event — for kind=catch this is literally who got tagged (and is now It); for kind=timeout/start there was no tag, just a new It.';

-- Backfill the one transition that predates this column: every existing
-- 'tag' challenge's opening move, never previously recorded anywhere.
-- Guarded by "no start event yet" so re-running this migration (or
-- applying it to a project that already has one, however that'd
-- happen) is a no-op the second time.
insert into public.tag_events (challenge_id, tagger_id, tagged_id, metric, kind, created_at)
select c.id, null, c.created_by, null, 'start', c.created_at
from public.challenges c
where c.kind = 'tag'
  and not exists (select 1 from public.tag_events te where te.challenge_id = c.id and te.kind = 'start');

-- The creator's own opening turn as It, now logged the same way every
-- later handoff is — see the backfill above for why this was missing
-- for every challenge created before this migration.
create or replace function public.handle_new_tag_challenge()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.kind = 'tag' then
    insert into public.tag_rounds (challenge_id, it_user_id) values (new.id, new.created_by);
    insert into public.tag_events (challenge_id, tagger_id, tagged_id, metric, kind)
      values (new.id, null, new.created_by, null, 'start');
  end if;
  return new;
end;
$$;

-- Unchanged from 0048 except the insert below now says kind explicitly
-- (still the column's own default, just no longer implicit) — the
-- notification behavior is identical.
create or replace function public.tag_check_catch(challenge_id uuid)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  target uuid;
  snapshot numeric;
  unit text;
  my_total numeric;
begin
  perform public.tag_settle_timeout(tag_check_catch.challenge_id);

  select tr.target_user_id, tr.target_snapshot_metric
    into target, snapshot
    from public.tag_rounds tr
    where tr.challenge_id = tag_check_catch.challenge_id and tr.it_user_id = caller;
  if target is null then
    -- Either the caller isn't (or no longer is) IT, or IT hasn't
    -- picked anyone yet — nothing to check either way.
    return false;
  end if;

  select distance_goal_unit into unit from public.challenges where id = tag_check_catch.challenge_id;
  my_total := public.tag_metric_total(tag_check_catch.challenge_id, caller, unit);
  if my_total < snapshot then
    return false;
  end if;

  update public.challenge_participants
    set tags_made = tags_made + 1
    where challenge_participants.challenge_id = tag_check_catch.challenge_id and user_id = caller;
  update public.challenge_participants
    set last_tagged_by = caller
    where challenge_participants.challenge_id = tag_check_catch.challenge_id and user_id = target;
  insert into public.tag_events (challenge_id, tagger_id, tagged_id, metric, kind)
    values (tag_check_catch.challenge_id, caller, target, snapshot, 'catch');
  update public.tag_rounds
    set it_user_id = target, target_user_id = null, target_snapshot_metric = null, round_started_at = now(), updated_at = now()
    where tag_rounds.challenge_id = tag_check_catch.challenge_id;

  begin
    perform net.http_post(
      url := 'https://vaypjksgpuuopqvurcus.supabase.co/functions/v1/send-tag-notification',
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
    -- (pg_net missing, no vault secret yet, a network hiccup) is never
    -- a reason to fail the whole catch.
    null;
  end;

  return true;
end;
$$;

-- Unchanged from 0048 except the real-handoff branch now also logs a
-- 'timeout' tag_event — the "nobody to hand off to" branch still logs
-- nothing, same as before, since It didn't actually change there.
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
  if now() < started_at + interval '15 minutes' then
    return;
  end if;

  select cp.user_id into next_it
    from public.challenge_participants cp
    where cp.challenge_id = tag_settle_timeout.challenge_id and cp.user_id != current_it
    order by random()
    limit 1;

  if next_it is null then
    -- Nobody else has joined yet — nothing to hand off to, just
    -- restart the clock rather than erroring. Nobody to notify or log
    -- either, since It didn't actually change.
    update public.tag_rounds
      set round_started_at = now(), target_user_id = null, target_snapshot_metric = null, updated_at = now()
      where tag_rounds.challenge_id = tag_settle_timeout.challenge_id;
    return;
  end if;

  update public.tag_rounds
    set it_user_id = next_it,
        target_user_id = null,
        target_snapshot_metric = null,
        round_started_at = now(),
        updated_at = now()
    where tag_rounds.challenge_id = tag_settle_timeout.challenge_id;
  insert into public.tag_events (challenge_id, tagger_id, tagged_id, metric, kind)
    values (tag_settle_timeout.challenge_id, null, next_it, null, 'timeout');

  begin
    perform net.http_post(
      url := 'https://vaypjksgpuuopqvurcus.supabase.co/functions/v1/send-tag-notification',
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
    -- Same reasoning as tag_check_catch's own handler — the handoff
    -- itself already landed above regardless of whether this succeeds.
    null;
  end;
end;
$$;
