-- Hound: preserve activity_events rows when their challenge is deleted,
-- instead of letting them vanish with it. activity_events exists
-- specifically so "why did my score change" is always answerable (see
-- 0058_hound_score.sql's own comment) — but its challenge_id foreign key
-- was declared `on delete cascade`, so deleting a challenge (Challenge
-- Detail's own "Delete" button) silently destroyed the very ledger rows
-- that explain any Hound Score/XP/Bones a settlement already awarded for
-- it, while the awarded totals themselves (cached on profiles, not
-- derived by summing activity_events at read time) stayed exactly where
-- they were. The result: a real, permanent number on your profile with
-- no way left to trace where it came from.
--
-- Switching to `on delete set null` keeps every already-recorded award
-- (score_points/xp_points/bones_points/kind/created_at) intact — only
-- the now-meaningless link to a challenge that no longer exists goes
-- away. challenge_id was already nullable (it's meant to cover a future
-- non-challenge award too — see 0058's own comment), so this needs no
-- column change, only the constraint's ON DELETE action.
--
-- Looked up by pg_constraint rather than a hardcoded name, same
-- "don't assume Postgres's own auto-generated name" caution
-- 0046_drop_tag_last_tagged_by_fkey.sql already used for exactly this
-- kind of alter — inline `create table` FKs get a default
-- `<table>_<column>_fkey` name in practice, but this is safer than
-- assuming it never changes.
--
-- Run this once, after 0062, in the SQL Editor.

do $$
declare
  fk_name text;
begin
  select con.conname into fk_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
  where con.contype = 'f'
    and rel.relname = 'activity_events'
    and array_length(con.conkey, 1) = 1
    and att.attname = 'challenge_id';

  if fk_name is not null then
    execute format('alter table public.activity_events drop constraint %I', fk_name);
  end if;

  alter table public.activity_events
    add constraint activity_events_challenge_id_fkey
    foreign key (challenge_id) references public.challenges (id) on delete set null;
end;
$$;
