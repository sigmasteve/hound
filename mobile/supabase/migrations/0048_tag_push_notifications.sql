-- Hound: Game of Tag push notifications — the one piece of the
-- original spec still missing (see GitHub discussion): "notifications
-- will need to be sent when a person is caught." Extends that to the
-- other way It changes hands too — a stalled round timing out
-- (tag_settle_timeout) — since both are the same "you're It now, on a
-- clock" moment from the notified person's own point of view.
--
-- Both are event-driven, not scheduled, so unlike every other
-- notification job in this app (send-login-reminders,
-- send-stale-data-alerts, send-daily-standings — all pg_cron), this
-- calls send-tag-notification directly from inside the two
-- security-definer functions that actually change tag_rounds.it_user_id,
-- via pg_net's net.http_post, right at the moment each one happens —
-- the same "Postgres calls an Edge Function directly" mechanism
-- 0010_login_reminders.sql's own cron job already uses, just fired by
-- a state change instead of a clock.
--
-- Wrapped in its own exception handler in both functions: a failure to
-- reach the Edge Function (network hiccup, pg_net not enabled, whatever)
-- must never roll back the actual game state change — the catch or
-- handoff itself always has to land regardless of whether anyone gets
-- notified about it.
--
-- Gated on profiles.notify_push_enabled — reuses the same blanket push
-- preference Login reminders already has (Settings → Data & account),
-- rather than a new dedicated Tag alerts toggle, so there's nothing new
-- to opt into here.
--
-- Run this once, after 0047, in the SQL Editor. Requires pg_net
-- (already enabled by 0010) and the same vault 'service_role_key'
-- secret 0010's own cron job needs — if that secret was never set up
-- (see 0010's own comment), notifications from this migration will
-- silently no-op rather than error, same as any other net.http_post
-- failure here.

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
  insert into public.tag_events (challenge_id, tagger_id, tagged_id, metric)
    values (tag_check_catch.challenge_id, caller, target, snapshot);
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
    -- restart the clock rather than erroring. Nobody to notify either.
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
