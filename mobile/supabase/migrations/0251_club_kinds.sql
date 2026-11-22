-- 0251: the newer group games can be posted to a club too. Bullseye,
-- Long Shot, Paw Slots and Hound Roulette are everyone-for-themselves
-- and anyone can join part way (each sets a player up when they join),
-- so a club's members can join them from the club's page like a Steps
-- challenge. One-on-one and fixed-team games still can't.
create or replace function public.club_kind_ok(p_kind public.challenge_kind)
returns boolean
language sql
immutable
as $$
  select p_kind::text in ('steps', 'streak', 'distance', 'bingo', 'seventyfive', 'journey', 'checklist', 'houndopoly', 'hunt',
                          'bullseye', 'longshot', 'slots', 'roulette');
$$;
revoke execute on function public.club_kind_ok(public.challenge_kind) from public, anon, authenticated;
