-- Hound: end a challenge early. A global Bingo with four BINGOs by day 6
-- and three weeks left, a race everyone has lost interest in: the admin
-- (for a global challenge) or the creator (for their own) can make
-- today its last day.
--
-- Today still counts, for everyone: the challenge keeps its start and
-- ends at the end of today, the same way a challenge of that length
-- would have (ends_at = starts_at + duration_days, as the app creates
-- them, so every rule that reads the days from start_day and
-- duration_days — progress, Bingo marks, check-ins — agrees). Results
-- settle after the usual grace period (0095/0096), prizes pay as they
-- would have, and nobody can join a global one after that.
--
-- Run this once, after 0126, in the SQL Editor.
--
-- Undo, if needed: drop function public.end_challenge_early(uuid, date);

create or replace function public.end_challenge_early(p_challenge_id uuid, p_today date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.challenges%rowtype;
  caller uuid := auth.uid();
  new_days int;
  new_end timestamptz;
begin
  select * into c from public.challenges where id = p_challenge_id for update;
  if not found then
    raise exception 'That challenge is gone.';
  end if;
  if caller is null or not (
    c.created_by = caller
    or (c.is_global and exists (select 1 from public.profiles p where p.id = caller and p.is_admin))
  ) then
    raise exception 'Only the creator can end a challenge early.';
  end if;
  if c.score_settled_at is not null or c.ends_at <= now() then
    raise exception 'It has already ended.';
  end if;
  -- The phone's own date, within a day of the server's so it can't be
  -- made up.
  if p_today is null or abs(p_today - current_date) > 1 then
    raise exception 'That day doesn''t match today.';
  end if;
  if c.start_day is null or p_today < c.start_day then
    raise exception 'It hasn''t started yet — take it down instead.';
  end if;
  new_days := p_today - c.start_day + 1;
  if new_days >= c.duration_days then
    raise exception 'Today is already its last day.';
  end if;
  new_end := c.starts_at + make_interval(days => new_days);

  update public.challenges
    set duration_days = new_days,
        ends_at = new_end,
        join_closes_at = case when join_closes_at is null then null else least(join_closes_at, new_end) end
    where id = p_challenge_id;
end;
$$;

revoke execute on function public.end_challenge_early(uuid, date) from public, anon;
grant execute on function public.end_challenge_early(uuid, date) to authenticated;
