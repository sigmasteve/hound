-- Hound: the welcome wizard. A new account (or anyone who never
-- finished 0074's "Get started" steps) goes through one screen at a
-- time instead of a Today full of setup cards: connect health, how
-- you'll use Hound, goals, notifications, a friend, a challenge, and
-- your hound.
--
--   - profiles.hound_uses: what they said they'll use Hound for (any of
--     steps, workouts, strength, cardio, friends, habits). The app uses
--     it to pick goals and a challenge to suggest.
--   - profiles.welcome_done_at: set when they finish or skip through
--     the wizard, so it shows once.
--   - my_welcome() says whether to show it: not done yet, and not every
--     "Get started" step already done (someone who has done all three
--     doesn't need it).
--   - save_hound_uses() and finish_welcome() write the two columns;
--     nobody can write them directly (0043's column grants).
--
-- Run this once, after 0001-0108, in the SQL Editor, before publishing
-- the app update that goes with it.

alter table public.profiles add column if not exists hound_uses text[] not null default '{}';
alter table public.profiles add column if not exists welcome_done_at timestamptz;

create or replace function public.my_welcome()
returns table (show_wizard boolean, uses text[])
language sql
stable
security definer set search_path = public
as $$
  select
    p.welcome_done_at is null
      and p.onboarding_reward_claimed_at is null
      and not coalesce((select s.health_connected and s.has_friend and s.joined_challenge from public.onboarding_status() s), false),
    p.hound_uses
  from public.profiles p
  where p.id = auth.uid();
$$;

create or replace function public.save_hound_uses(p_uses text[])
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  allowed constant text[] := array['steps', 'workouts', 'strength', 'cardio', 'friends', 'habits'];
  cleaned text[];
begin
  if caller is null then
    raise exception 'Sign in to do that.';
  end if;
  select coalesce(array_agg(distinct u order by u), '{}') into cleaned
    from unnest(coalesce(p_uses, '{}')) u
    where u = any (allowed);
  update public.profiles p set hound_uses = cleaned where p.id = caller;
end;
$$;

create or replace function public.finish_welcome()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to do that.';
  end if;
  update public.profiles p set welcome_done_at = coalesce(p.welcome_done_at, now()) where p.id = auth.uid();
end;
$$;

revoke execute on function public.my_welcome() from public, anon;
grant execute on function public.my_welcome() to authenticated;
revoke execute on function public.save_hound_uses(text[]) from public, anon;
grant execute on function public.save_hound_uses(text[]) to authenticated;
revoke execute on function public.finish_welcome() from public, anon;
grant execute on function public.finish_welcome() to authenticated;

-- Undo, if needed:
--   drop function public.finish_welcome();
--   drop function public.save_hound_uses(text[]);
--   drop function public.my_welcome();
--   alter table public.profiles drop column welcome_done_at, drop column hound_uses;
