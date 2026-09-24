-- Hound: Game of Tag's "instant catch" bug — flagged during manual
-- testing. tag_select_target (0045_tag_game_state.sql) snapshots only
-- the target's own current total, and tag_check_catch's catch
-- condition is simply "It's current total >= that snapshot." That
-- algebra only makes sense when the target is currently AHEAD of It —
-- the snapshot is meant to be the number It has to grow into. But
-- nothing stops It from picking someone who's already at or behind
-- It's own current total; when that happens, the snapshot is already
-- less than or equal to It's total the instant it's taken, so the very
-- next catch-check (which runs right after selection) completes the
-- catch immediately, with no real chase in between at all.
--
-- A first draft of this fix tried snapshotting whichever total was
-- larger (target's or It's own), so a "behind" pick would still make
-- It close a gap up to their own current total — but that's exactly
-- equal to It's total the instant it's taken too, and tag_check_catch's
-- own ">=" (not ">") means that still catches instantly, verified
-- against a real Postgres before shipping this version instead.
--
-- Real fix: refuse the pick outright when there's no actual gap to
-- close (target's total isn't strictly greater than It's own right
-- now) — same shape as every other invalid-pick guard already here
-- (can't tag yourself, no tag-backs, not a real participant). This
-- keeps target_snapshot_metric's meaning exactly what it always was
-- (the target's own total, nothing else needs to change), and turns
-- "no gap to close" into a clear error the picker sees immediately
-- instead of a free, instant tag.
create or replace function public.tag_select_target(challenge_id uuid, target_user_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  my_last_tagged_by uuid;
  unit text;
  target_total numeric;
  my_total numeric;
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
  if my_last_tagged_by = target_user_id then
    raise exception 'No tag-backs — pick someone else.';
  end if;

  select distance_goal_unit into unit from public.challenges where id = tag_select_target.challenge_id;
  target_total := public.tag_metric_total(tag_select_target.challenge_id, tag_select_target.target_user_id, unit);
  my_total := public.tag_metric_total(tag_select_target.challenge_id, caller, unit);

  if target_total <= my_total then
    raise exception 'They haven''t out-logged you yet — pick someone who''s ahead of you right now.';
  end if;

  update public.tag_rounds
    set target_user_id = tag_select_target.target_user_id,
        target_snapshot_metric = target_total,
        updated_at = now()
    where tag_rounds.challenge_id = tag_select_target.challenge_id;
end;
$$;
