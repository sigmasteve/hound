-- Hound: admin-configurable challenge-kind gating — which challenge
-- kinds require bones_earned_total (0066_bones_earned_total.sql) to
-- unlock in CreateScreen's picker, and how much. Replaces the hardcoded
-- CHALLENGE_UNLOCK_BONES map that originally shipped this feature with a
-- real table an admin can edit from the Admin screen: gate or ungate any
-- kind, or change its threshold, without a new build.
--
-- A kind with no row here is always unlocked — "absence means off," the
-- same shape app_banner's own enabled flag gets with a boolean, just
-- expressed as row-presence instead (there's no meaningful "gated at 0
-- Bones" state to represent, so there's no on/off column to get out of
-- sync with a row that shouldn't exist).
--
-- Seeded with this session's initial gating call: Variety Bingo at 250,
-- 75 Day Challenge at 500. Tic-Tac-Go, previously gated at 150, moves
-- into the always-available core loop — this migration simply never
-- inserts a row for it, so it reads as unlocked from here on.
--
-- Run this once, after 0001-0066, in the SQL Editor.

create table public.challenge_unlock_gates (
  kind public.challenge_kind primary key,
  bones_required int not null check (bones_required > 0),
  updated_at timestamptz not null default now()
);

insert into public.challenge_unlock_gates (kind, bones_required) values
  ('bingo', 250),
  ('seventyfive', 500);

alter table public.challenge_unlock_gates enable row level security;

create policy "Anyone signed in can read challenge unlock gates"
  on public.challenge_unlock_gates for select
  to authenticated
  using (true);

create policy "Only admins can insert challenge unlock gates"
  on public.challenge_unlock_gates for insert
  to authenticated
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

create policy "Only admins can update challenge unlock gates"
  on public.challenge_unlock_gates for update
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

create policy "Only admins can delete challenge unlock gates"
  on public.challenge_unlock_gates for delete
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));
