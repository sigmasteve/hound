-- Hound: "Other" among the welcome wizard's interests. The wizard's About
-- you page asks "What are your interests?" (the same hound_uses as 0109)
-- and now offers Other too; save_hound_uses kept only the six it knew, so
-- it would have dropped it.
--
-- Run this once, after 0174, in the SQL Editor.

create or replace function public.save_hound_uses(p_uses text[])
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  allowed constant text[] := array['steps', 'workouts', 'strength', 'cardio', 'friends', 'habits', 'other'];
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

revoke execute on function public.save_hound_uses(text[]) from public, anon;
grant execute on function public.save_hound_uses(text[]) to authenticated;
