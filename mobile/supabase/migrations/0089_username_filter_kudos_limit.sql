-- Hound: two fixes from tester feedback.
--
--   Usernames  slurs and explicit words can't be saved as a username
--              (0030 only checked length and characters). Matched on a
--              lowercased copy with common swaps undone (1→i, 3→e, 0→o,
--              4→a, 5→s, @→a, $→s, !→i). The worst words are caught
--              anywhere in the name, even run into other text
--              ("xx_xxslurxx_99"); words that also turn up inside
--              ordinary names ("spicy", "cocktail", "therapist") only
--              when they stand alone ("big_dick_99").
--              Existing usernames aren't changed; the check runs when a
--              username is set.
--   Kudos      once per friend every 20 hours (the same cooldown as
--              nudges, 0082) instead of unlimited taps.
--
-- Run this once, after 0001-0088, in the SQL Editor.

create or replace function public.username_is_offensive(p_username text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  norm text := translate(lower(p_username), '013457@$!', 'oieastasi');
  squeezed text := replace(norm, '_', '');
begin
  if p_username is null then
    return false;
  end if;
  -- Anywhere: words that don't turn up inside ordinary names.
  -- Stand-alone only: words that do ("therapist", "Nazir", "push_it",
  -- "spicy", "cocktail").
  return squeezed ~ '(n+i+g+g+(e+r|a+h?|u+h)|r+e+t+a+r+d|t+r+a+n+n+(y|i+e)|f+u+c+k|c+u+n+t|b+i+t+c+h|w+h+o+r+e|a+s+s+h+o+l+e|h+i+t+l+e+r)'
    or norm ~ '(^|[^a-z])(f+a+g+(o+t+)?s?|k+i+k+e+s?|c+h+i+n+k+s?|s+p+i+c+s?|d+i+c+k+s?|c+o+c+k+s?|p+u+s+s+y|t+w+a+t|p+r+i+c+k|c+o+o+n+s?|p+o+r+n|s+h+i+t+s?|s+l+u+t+s?|n+a+z+i+s?|r+a+p+(e+s?|i+s+t+s?))($|[^a-z])';
end;
$$;

create or replace function public.profiles_username_allowed()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.username is not null
    and new.username is distinct from old.username
    and public.username_is_offensive(new.username) then
    raise exception 'That username isn''t allowed. Try another.';
  end if;
  return new;
end;
$$;

-- Insert has no `old`; a separate trigger keeps the update one simple.
create or replace function public.profiles_username_allowed_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.username_is_offensive(new.username) then
    raise exception 'That username isn''t allowed. Try another.';
  end if;
  return new;
end;
$$;

create trigger profiles_username_allowed
  before update of username on public.profiles
  for each row execute procedure public.profiles_username_allowed();

create trigger profiles_username_allowed_insert
  before insert on public.profiles
  for each row execute procedure public.profiles_username_allowed_insert();

-- ── Kudos: once per friend every 20 hours ────────────────────────────

create index if not exists kudos_giver_receiver_created on public.kudos (giver_id, receiver_id, created_at desc);

create or replace function public.kudos_cooldown()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.kudos k
    where k.giver_id = new.giver_id
      and k.receiver_id = new.receiver_id
      and k.created_at > now() - interval '20 hours'
  ) then
    raise exception 'Already gave kudos today. You can give more tomorrow.';
  end if;
  return new;
end;
$$;

create trigger kudos_cooldown
  before insert on public.kudos
  for each row execute procedure public.kudos_cooldown();
