-- Hound: Game of Tag's actual game state — see 0043_tag_challenge_kind.sql
-- for the enum value this depends on (must already be committed).
--
-- Deliberately anti-competitive (see GitHub discussion): there's no
-- Hunter/Hunted-style ranking, just a rotating "IT" that has to close a
-- real, snapshotted gap in steps or workout distance (creator's choice
-- at creation — challenges.distance_goal_unit, reusing the exact same
-- column Distance Pool already has, see CreateChallengeInput) to catch
-- whoever they pick, with no tag-backs against whoever caught them last.
-- The whole challenge ends early once the group's combined total (same
-- shared-pool total Distance Pool already computes) hits its own
-- distance_goal_mi/distance_goal_steps target — unlike Distance Pool
-- itself, where hitting that number is only ever a cosmetic badge and
-- the pool keeps running to its scheduled end regardless. That
-- early-finish check is purely client-side (src/challenges/board.ts's
-- isChallengeFinished), the same way a hunt's own conclusion is never
-- persisted as a database flag either — nothing here needs to know
-- about it.
--
-- Snapshotting math (why only the target's own total needs storing):
-- catching someone means IT's own total needs to grow, from the moment
-- of selection, by the GAP between the two of them at that instant —
-- target's total minus IT's own total then. IT's later total needs to
-- reach target_total - it_total_then + it_total_then = target_total_then
-- exactly — the "then" cancels out. So the only number worth
-- snapshotting is the target's own total at selection; the catch
-- condition is just "IT's current total >= that stored number," which
-- tag_check_catch below computes fresh every time it's called rather
-- than trusting anything the client computed.
--
-- No bot support in this pass — a bot has no way to "pick" a target in
-- the UI, and this whole mechanic assumes a real client doing the
-- picking and the catching. A bot can still exist as an ordinary
-- challenge_participants row for a non-tag challenge; it just never
-- becomes IT or gets selected here.
--
-- Run this once, after 0043 (as its own, separately committed
-- transaction), in the SQL Editor.

-- Who's chasing whom right now, for a given 'tag'-kind challenge — one
-- row per challenge, mutated in place as the game progresses rather
-- than inserting a new row every time IT changes (there's exactly one
-- "current" round at a time; history lives in tag_events below
-- instead).
create table public.tag_rounds (
  challenge_id uuid primary key references public.challenges (id) on delete cascade,
  it_user_id uuid not null references public.profiles (id),
  -- Both null until IT actually picks someone.
  target_user_id uuid references public.profiles (id),
  target_snapshot_metric numeric,
  -- When THIS IT's turn began — TAG_TIME_LIMIT_MINUTES (see
  -- tag_settle_timeout below) after this, with no catch yet, IT passes
  -- to a random other participant regardless of whether a target had
  -- even been picked.
  round_started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tag_rounds enable row level security;

-- Same "any participant can see the shared game state" shape as
-- challenge_participants' own "Participants can view each other" policy
-- (0001) — no insert/update/delete policy at all, every write goes
-- through the security-definer functions below (or the trigger, for the
-- very first row), matching organizations' own "no in-app way to do
-- this directly" shape (0035_organizations.sql).
create policy "Participants can view their challenge's tag round"
  on public.tag_rounds for select
  to authenticated
  using (
    exists (
      select 1 from public.challenge_participants cp
      where cp.challenge_id = tag_rounds.challenge_id and cp.user_id = auth.uid()
    )
  );

-- An append-only log of every real catch — not read by anything yet,
-- but exactly what a future "most tags wins" or "who tagged whom"
-- summary needs (see the no-ranking-yet decision this shipped with),
-- without another migration to backfill it from nothing once that's
-- built.
create table public.tag_events (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  tagger_id uuid not null references public.profiles (id),
  tagged_id uuid not null references public.profiles (id),
  -- The snapshotted target metric the tagger had to reach for this
  -- specific catch — a record of how big a gap it actually was.
  metric numeric not null,
  created_at timestamptz not null default now()
);

alter table public.tag_events enable row level security;

create policy "Participants can view their challenge's tag events"
  on public.tag_events for select
  to authenticated
  using (
    exists (
      select 1 from public.challenge_participants cp
      where cp.challenge_id = tag_events.challenge_id and cp.user_id = auth.uid()
    )
  );

-- Durable per-participant tag facts — who most recently tagged them
-- (the one person they can't immediately pick back, once it's their
-- turn to be IT) and how many people they've personally caught over
-- the whole challenge (also for that same future ranking, not surfaced
-- anywhere yet).
alter table public.challenge_participants
  add column last_tagged_by uuid references public.profiles (id),
  add column tags_made int not null default 0;

-- challenge_participants already has a broad "update your own row"
-- policy (0006_challenge_highlight.sql) that would otherwise let
-- anyone freely rewrite their own tag history directly. Unlike
-- is_admin's own revoke (0021_admin_flag.sql) or organization_id's
-- (0035_organizations.sql) — which turned out NOT to actually work,
-- see the column-privileges finding this migration's own PR raised —
-- this locks the whole table down first, then explicitly re-opens only
-- the two columns real client code already updates directly today
-- (highlighted: setHighlighted; role: markCaught's own hunt-catch
-- write). A bare `revoke update (col) ... from authenticated` cannot
-- narrow a role's existing TABLE-level UPDATE grant (Postgres tracks
-- column- and table-level ACLs separately, and the broader one wins) —
-- Supabase's own default project template already grants authenticated
-- a blanket UPDATE on every public table, specifically so RLS alone is
-- meant to be the real gate. Only revoke-then-selectively-grant
-- actually removes a privilege that grant provides.
revoke update on public.challenge_participants from authenticated, anon;
grant update (highlighted, role) on public.challenge_participants to authenticated;

-- The creator always starts as IT — simpler and just as fair as a
-- random pick, since at creation time they may be the only participant
-- who exists yet at all (everyone else joins later, asynchronously, by
-- accepting an invite — see 0009_challenge_invites.sql). Fires once per
-- 'tag' challenge; every other kind is untouched.
create function public.handle_new_tag_challenge()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.kind = 'tag' then
    insert into public.tag_rounds (challenge_id, it_user_id) values (new.id, new.created_by);
  end if;
  return new;
end;
$$;

create trigger on_tag_challenge_created
  after insert on public.challenges
  for each row execute procedure public.handle_new_tag_challenge();

-- A participant's own current cumulative total for a challenge, in
-- whichever unit ('steps' or 'miles') that challenge's own
-- distance_goal_unit says matters — the same sum a real leaderboard row
-- already is, just computed directly rather than through
-- getLeaderboard's own per-user grouping. Not security definer: a plain
-- function runs with the CALLER's own privileges, and
-- progress_snapshots' own "Participants can view challenge progress"
-- policy (0001) already lets any participant read any other
-- participant's rows for a shared challenge (the same access a real
-- multi-person leaderboard already depends on) — nothing extra to
-- bypass here.
create or replace function public.tag_metric_total(p_challenge_id uuid, p_user_id uuid, p_unit text)
returns numeric
language sql
stable
as $$
  select coalesce(
    sum(case when p_unit = 'steps' then steps else distance_mi end),
    0
  )
  from public.progress_snapshots
  where challenge_id = p_challenge_id and user_id = p_user_id;
$$;

grant execute on function public.tag_metric_total(uuid, uuid, text) to authenticated;

-- Shared by tag_select_target/tag_check_catch below, and callable on
-- its own by any participant (e.g. right after loading the challenge) —
-- a no-op unless the current round has genuinely run past its time
-- limit with no catch, in which case IT passes to a random other
-- participant regardless of whether they'd even picked a target yet.
-- Never touches last_tagged_by/tags_made/tag_events — nobody was
-- actually caught, this is a stall timing out, not a tag.
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
    -- restart the clock rather than erroring.
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
end;
$$;

grant execute on function public.tag_settle_timeout(uuid) to authenticated;

-- IT picking who to chase. Settles a stalled round first (see
-- tag_settle_timeout above) — if that just moved IT to someone else,
-- the original caller is no longer IT and this correctly refuses,
-- rather than letting a stale client pick a target after their own
-- turn already timed out.
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
  if my_last_tagged_by = target_user_id then
    raise exception 'No tag-backs — pick someone else.';
  end if;

  update public.tag_rounds
    set target_user_id = tag_select_target.target_user_id,
        target_snapshot_metric = public.tag_metric_total(
          tag_select_target.challenge_id,
          tag_select_target.target_user_id,
          (select distance_goal_unit from public.challenges where id = tag_select_target.challenge_id)
        ),
        updated_at = now()
    where tag_rounds.challenge_id = tag_select_target.challenge_id;
end;
$$;

grant execute on function public.tag_select_target(uuid, uuid) to authenticated;

-- Whether IT has now closed the gap on their picked target — called
-- after every device sync while IT (mirroring markCaught's own "the
-- client notices, then persists it" shape for a hunt's catch), and
-- re-verified here from scratch rather than trusting the client's own
-- read, same reasoning acceptChallengeInvite re-checks its own window
-- server-side. Settles a stalled round first, same as
-- tag_select_target — if IT's turn already timed out, this correctly
-- returns false instead of letting a late catch attempt still land.
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

  return true;
end;
$$;

grant execute on function public.tag_check_catch(uuid) to authenticated;
