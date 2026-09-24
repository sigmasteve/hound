-- Hound: undo the exact thing that broke every challenge's participant
-- list for existing app installs, not just Tag's — see this repo's own
-- incident notes. 0045_tag_game_state.sql added
-- challenge_participants.last_tagged_by as a second foreign key to
-- profiles (alongside the existing user_id). PostgREST can only
-- auto-resolve a bare `profiles(...)` embed when there's exactly one
-- relationship between the two tables — with two, it returns HTTP 300
-- "multiple relationships" instead of data, for every embed of profiles
-- on this table, regardless of which challenge or which app build is
-- asking. The app's own client code has already been fixed to hint the
-- embed explicitly (profiles!user_id(...)), but an app store rollout
-- can't be forced onto every existing install — this migration instead
-- removes the ambiguity at its root, so an *old*, unpatched client's
-- plain `profiles(...)` embed resolves exactly the way it always did
-- before Tag existed, with zero app update required.
--
-- Safe to drop: last_tagged_by's only real job is the no-tag-backs
-- check in tag_select_target (0045), which already only ever assigns it
-- from tag_check_catch's own `caller := auth.uid()` — necessarily a real
-- profile, never an arbitrary value a client could set directly (see
-- 0045's own revoke/grant: clients can't update this column at all).
-- Dropping the FK constraint doesn't touch the column, its data, or that
-- validation — it only removes the *declared* relationship PostgREST
-- was using to (mis)detect a second embed path.
do $$
declare
  fk_name text;
begin
  select con.conname into fk_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
  where con.contype = 'f'
    and rel.relname = 'challenge_participants'
    and array_length(con.conkey, 1) = 1
    and att.attname = 'last_tagged_by';

  if fk_name is not null then
    execute format('alter table public.challenge_participants drop constraint %I', fk_name);
  end if;
end;
$$;
