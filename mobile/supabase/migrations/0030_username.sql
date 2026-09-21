-- Optional pseudonym: a signed-in user can set a username and choose to
-- show it instead of their real name wherever a challenge context
-- reveals someone else's identity — leaderboards, participant lists,
-- challenge invites, and the alert emails/pushes that name a
-- co-participant to others (see src/profiles/displayName.ts, the one
-- place that decides which of the two to show). Friends screen, DMs and
-- your own Settings account card are untouched — those are contexts
-- where you already know who you're looking at, or it's your own
-- account viewing itself.
alter table public.profiles add column username text;
alter table public.profiles add column use_username boolean not null default false;

-- Case-insensitive uniqueness, only enforced once someone actually sets
-- one — most accounts will have username = null forever otherwise.
create unique index profiles_username_unique on public.profiles (lower(username)) where username is not null;

-- Sane, predictable formatting — long enough to be expressive, short
-- enough to fit next to an avatar in a leaderboard row; letters/digits/
-- underscore only so it never collides with anything display code
-- assumes about a plain name (spaces, punctuation).
alter table public.profiles
  add constraint profiles_username_format check (username is null or username ~ '^[A-Za-z0-9_]{3,20}$');
