-- Hound: a lightweight "nice job" cheer between friends — no challenge
-- reference, no message, just a timestamped row saying one person
-- cheered another. The Friend Detail screen shows the running count each
-- way and a "Give kudos" button that inserts one more.
--
-- Deliberately unlimited, not a Strava-style one-per-activity toggle:
-- there's no specific activity or challenge this attaches to, so there's
-- nothing to "un-kudos" — someone can send as many as they want, whenever
-- they want.
--
-- Run this once, after 0001-0019, in the SQL Editor.

create table public.kudos (
  id uuid primary key default gen_random_uuid(),
  giver_id uuid not null references public.profiles (id) on delete cascade,
  receiver_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (giver_id <> receiver_id)
);

alter table public.kudos enable row level security;

create policy "Either side of a kudos can view it"
  on public.kudos for select
  to authenticated
  using (giver_id = auth.uid() or receiver_id = auth.uid());

-- Same "have to be in it to X" shape challenge_invites' own insert policy
-- already uses (0009_challenge_invites.sql) — kudos only ever renders as
-- a button on an actual friend's own detail screen, so this backs that
-- with the same rule at the schema level: not just this app's own
-- client, ever, gets to insert one for someone who isn't a real,
-- accepted friend.
create policy "Users can give kudos to an actual friend"
  on public.kudos for insert
  to authenticated
  with check (
    giver_id = auth.uid()
    and exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and (
          (f.requester_id = auth.uid() and f.recipient_id = receiver_id)
          or (f.recipient_id = auth.uid() and f.requester_id = receiver_id)
        )
    )
  );
