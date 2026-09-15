-- Hound: let a challenge's creator delete it.
--
-- challenge_participants, challenge_bots, and progress_snapshots all
-- reference challenges with `on delete cascade` already (0001, 0003), so
-- deleting the challenges row is enough to remove everyone's participation
-- and progress in it too — nothing else needs its own delete policy.
--
-- Run this once, after 0001-0004, in the SQL Editor.

create policy "Creators can delete their own challenge"
  on public.challenges for delete
  to authenticated
  using (created_by = auth.uid());
