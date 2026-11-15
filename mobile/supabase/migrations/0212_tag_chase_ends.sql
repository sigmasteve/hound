-- Hound: a Tag chase ends when its last day is settled (Steve, Nov 2026:
-- "Family TAG was over earlier today, but it still shows a countdown").
--
-- A chase plays its days by the calendar (0181): day 7 of 7 settles the
-- morning after day 7. But a challenge started "Now" (say 8 PM) has its
-- ends_at seven 24-hour days later, 8 PM on the eighth calendar day. So
-- after the winner was known the challenge kept running for most of a day:
-- "ends in 2h" under "The chase is over", and the stale-data alert telling
-- people they hadn't synced, for a day that can't count.
--
-- tag_chase_advance (redefined from 0186, its latest) now pulls the
-- challenge's ends_at in to now() once the last day is settled, the way
-- Tic-Tac-Go does when its game ends. It runs on view and from the daily
-- job, so games already finished end the next time either runs.
--
-- Run this once, after 0001-0211, in the SQL Editor.

create or replace function public.tag_chase_advance(p_challenge_id uuid)
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges;
  first_day date;
  last_day date;
  cutoff date;
  d date;
  n int := 0;
  it uuid;
  it_steps int;
  head int;
  steps jsonb;
  tagged jsonb;
  escaped jsonb;
  nxt uuid;
  latest int;
begin
  select * into c from public.challenges x where x.id = p_challenge_id;
  if not found or c.kind::text <> 'tag' or c.tag_mode is distinct from 'chase' then
    return 0;
  end if;
  -- One at a time per game.
  perform pg_advisory_xact_lock(hashtext('tag_chase:' || p_challenge_id::text));
  first_day := public.soccer_first_day(c);
  last_day := first_day + c.duration_days - 1;
  cutoff := (now() at time zone 'utc')::date - case when extract(hour from now() at time zone 'utc') >= 11 then 1 else 2 end;
  head := coalesce(c.tag_head_start, 2000);
  for d in
    select s::date from generate_series(first_day::timestamp, least(last_day, cutoff)::timestamp, interval '1 day') s
  loop
    continue when exists (select 1 from public.tag_chase_days x where x.challenge_id = p_challenge_id and x.day = d);
    it := public.tag_chase_it(p_challenge_id);
    exit when it is null;
    select coalesce(jsonb_object_agg(cp.user_id::text, coalesce(ps.steps, 0)), '{}'::jsonb) into steps
      from public.challenge_participants cp
      left join public.progress_snapshots ps on ps.challenge_id = cp.challenge_id and ps.user_id = cp.user_id and ps.day = d
      where cp.challenge_id = p_challenge_id;
    it_steps := coalesce((steps ->> it::text)::int, 0);
    select coalesce(jsonb_agg(jsonb_build_object('user', k, 'margin', (v::int + head - it_steps)) order by v::int) filter (where v::int + head < it_steps), '[]'::jsonb),
           coalesce(jsonb_agg(jsonb_build_object('user', k, 'margin', (v::int + head - it_steps)) order by v::int desc) filter (where v::int + head >= it_steps), '[]'::jsonb)
      into tagged, escaped
      from jsonb_each_text(steps) e(k, v)
      where k <> it::text;
    -- The slowest tagged hound is IT next; nobody tagged, IT stays.
    -- Never anyone under 1,000 steps that day (0186).
    nxt := public.tag_chase_next_it(it, it_steps, steps, tagged);
    insert into public.tag_chase_days (challenge_id, day_no, day, it_user, head_start, steps, tagged, escaped, next_it, passed)
      values (p_challenge_id, d - first_day + 1, d, it, head, steps, tagged, escaped, nxt, nxt is distinct from coalesce((tagged -> 0 ->> 'user')::uuid, it));
    update public.tag_chase_state set it_user = nxt, updated_at = now() where challenge_id = p_challenge_id;
    n := n + 1;
  end loop;

  -- 0212: once the last day is settled the chase is over, so the
  -- challenge ends now. A chase started "Now" in the evening otherwise
  -- ran on to the same time on the day after its last day: a countdown
  -- under "The chase is over", and stale-sync alerts for a day that
  -- can't count. Also catches games already finished.
  if exists (select 1 from public.tag_chase_days x where x.challenge_id = p_challenge_id and x.day_no >= c.duration_days) then
    update public.challenges set ends_at = now() where id = p_challenge_id and ends_at > now();
  end if;

  -- Pushes for the latest day settled just now, if the game isn't over.
  if n > 0 then
    select max(x.day_no) into latest from public.tag_chase_days x where x.challenge_id = p_challenge_id;
    if latest < c.duration_days then
      select x.next_it, x.tagged into nxt, tagged from public.tag_chase_days x where x.challenge_id = p_challenge_id and x.day_no = latest;
      select x.it_user into it from public.tag_chase_days x where x.challenge_id = p_challenge_id and x.day_no = latest;
      perform public.tag_chase_notify('chase_it', p_challenge_id, nxt, jsonb_build_object('head_start', head));
      perform public.tag_chase_notify('chase_tagged', p_challenge_id, (t ->> 'user')::uuid,
          jsonb_build_object('tagger_id', it, 'margin', abs((t ->> 'margin')::int)))
        from jsonb_array_elements(tagged) t
        where (t ->> 'user')::uuid is distinct from nxt;
    end if;
  end if;
  return n;
end;
$$;

revoke execute on function public.tag_chase_advance(uuid) from public, anon, authenticated;
