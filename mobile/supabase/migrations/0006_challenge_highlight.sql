-- Hound: let a user pick which of their challenges is highlighted on the
-- Today (Home) screen, instead of Home always defaulting to whichever
-- challenge was created most recently.
--
-- Lives on challenge_participants (per participant, not per challenge) so
-- each person's own Home screen can highlight a different challenge —
-- same convention challenge_participants.role already uses.
--
-- Run this once, after 0001-0005, in the SQL Editor.

alter table public.challenge_participants
  add column highlighted boolean not null default false;

-- 0001 never added an UPDATE policy for challenge_participants (only
-- select/insert) — needed now so a user can flip their own row's
-- highlighted flag.
create policy "Users can update their own participant row"
  on public.challenge_participants for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
