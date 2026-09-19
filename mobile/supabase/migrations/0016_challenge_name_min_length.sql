-- Hound: challenges could be created with a blank name — the client
-- silently saved it as "Untitled challenge" instead of asking for a real
-- one. CreateScreen.tsx now requires at least 4 (trimmed) characters
-- before it lets the wizard move past step 2 at all, so this backs that
-- with the same rule at the schema level: not just this app's own
-- client, ever, gets to insert a shorter name.
--
-- If this fails to apply, some existing row's name is under 4 characters
-- (very unlikely — the only prior fallback was 'Untitled challenge',
-- itself far longer) — rename or delete that row first, then re-run.
--
-- Run this once, after 0001-0015, in the SQL Editor.

alter table public.challenges
  add constraint challenges_name_min_length check (char_length(trim(name)) >= 4);
