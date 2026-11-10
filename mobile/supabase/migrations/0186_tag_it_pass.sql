-- Hound: Tag chase, IT can't sit out (Steve: "No one should be IT for
-- multiple days when they have less than 1000 steps"). A player whose
-- steps aren't syncing stayed IT day after day: nobody's tagged by
-- someone at 0 steps, and nobody tagged meant IT stays.
--
-- Now, when nobody's tagged and IT walked under 1,000 steps that day,
-- IT passes to whoever got away by the least among those who walked
-- 1,000 or more (the closest call). If nobody did, IT stays: nobody's
-- steps are coming in. A tag still decides it as before (the slowest
-- hound tagged).
--
-- tag_chase_days.passed marks a day IT passed this way, for the replay's
-- line ("Dad walked under 1,000 steps, so IT passes to Sky").
--
-- Games stuck right now are fixed when this runs: where the last
-- settled day kept a sub-1,000 IT, today's IT passes the same way, and
-- the new IT gets the "You're IT" push.
--
-- Run this once, after 0185, in the SQL Editor, before publishing the
-- app update that goes with it.
--
-- Undo, if needed: re-run tag_chase_advance and tag_chase_view from 0181.

alter table public.tag_chase_days add column if not exists passed boolean not null default false;

-- Who's IT tomorrow. steps: {user_id: steps} for everyone that day;
-- tagged: [{user, margin}], slowest first.
create or replace function public.tag_chase_next_it(p_it uuid, p_it_steps int, p_steps jsonb, p_tagged jsonb)
returns uuid
language sql
immutable
as $$
  select coalesce(
    (p_tagged -> 0 ->> 'user')::uuid,
    case when p_it_steps >= 1000 then p_it end,
    (select e.k::uuid from jsonb_each_text(p_steps) e(k, v)
      where e.k <> p_it::text and e.v::int >= 1000
      order by e.v::int, e.k limit 1),
    p_it
  );
$$;
revoke execute on function public.tag_chase_next_it(uuid, int, jsonb, jsonb) from public, anon, authenticated;

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
    -- The slowest tagged hound is IT next; nobody tagged, IT stays,
    -- unless IT walked under 1,000 steps (0186).
    nxt := public.tag_chase_next_it(it, it_steps, steps, tagged);
    insert into public.tag_chase_days (challenge_id, day_no, day, it_user, head_start, steps, tagged, escaped, next_it, passed)
      values (p_challenge_id, d - first_day + 1, d, it, head, steps, tagged, escaped, nxt, jsonb_array_length(tagged) = 0 and nxt is distinct from it);
    update public.tag_chase_state set it_user = nxt, updated_at = now() where challenge_id = p_challenge_id;
    n := n + 1;
  end loop;

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

create or replace function public.tag_chase_view(p_challenge_id uuid, p_day date)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  c public.challenges;
  first_day date;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  select * into c from public.challenges x where x.id = p_challenge_id;
  if not found or c.kind::text <> 'tag' or c.tag_mode is distinct from 'chase' then
    raise exception 'That isn''t a Tag chase.';
  end if;
  if not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = me) then
    raise exception 'Join the challenge first.';
  end if;
  perform public.tag_chase_advance(p_challenge_id);
  first_day := public.soccer_first_day(c);
  return jsonb_build_object(
    'head_start', coalesce(c.tag_head_start, 2000),
    'days', c.duration_days,
    'first_day', first_day,
    'it', case when now() >= c.starts_at then public.tag_chase_it(p_challenge_id) end,
    'players', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'id', p.id,
          'name', case when p.use_username and p.username is not null then p.username else p.name end,
          'hound', public.kennel_avatar_code(p.id)) order by p.name), '[]'::jsonb)
      from public.challenge_participants cp join public.profiles p on p.id = cp.user_id
      where cp.challenge_id = p_challenge_id
    ),
    'today', (
      select coalesce(jsonb_object_agg(ps.user_id::text, ps.steps), '{}'::jsonb)
      from public.progress_snapshots ps
      where ps.challenge_id = p_challenge_id and ps.day = p_day
    ),
    'history', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'day_no', d.day_no, 'day', d.day, 'it', d.it_user, 'head_start', d.head_start,
          'steps', d.steps, 'tagged', d.tagged, 'escaped', d.escaped, 'next_it', d.next_it, 'passed', d.passed) order by d.day_no), '[]'::jsonb)
      from public.tag_chase_days d where d.challenge_id = p_challenge_id
    ),
    'standings', (
      select coalesce(jsonb_agg(jsonb_build_object('user', s.user_id, 'tags', s.tags, 'escapes', s.escapes,
          'days_it', s.days_it, 'points', s.points) order by s.points desc, s.days_it), '[]'::jsonb)
      from public.tag_chase_standings(p_challenge_id) s
    )
  );
end;
$$;

revoke execute on function public.tag_chase_view(uuid, date) from public, anon;
grant execute on function public.tag_chase_view(uuid, date) to authenticated;

-- Games stuck now: the last settled day kept an IT under 1,000 steps.
do $$
declare
  r record;
  nxt uuid;
begin
  for r in
    select d.challenge_id, d.day_no, d.it_user, d.steps, d.tagged, d.head_start
    from public.tag_chase_days d
    join public.challenges c on c.id = d.challenge_id
    join public.tag_chase_state s on s.challenge_id = d.challenge_id
    where c.score_settled_at is null
      and d.day_no = (select max(x.day_no) from public.tag_chase_days x where x.challenge_id = d.challenge_id)
      and d.day_no < c.duration_days
      and jsonb_array_length(d.tagged) = 0
      and d.next_it = d.it_user
      and s.it_user = d.it_user
      and coalesce((d.steps ->> d.it_user::text)::int, 0) < 1000
  loop
    nxt := public.tag_chase_next_it(r.it_user, coalesce((r.steps ->> r.it_user::text)::int, 0), r.steps, r.tagged);
    continue when nxt = r.it_user;
    update public.tag_chase_days set next_it = nxt, passed = true where challenge_id = r.challenge_id and day_no = r.day_no;
    update public.tag_chase_state set it_user = nxt, updated_at = now() where challenge_id = r.challenge_id;
    perform public.tag_chase_notify('chase_it', r.challenge_id, nxt, jsonb_build_object('head_start', r.head_start));
  end loop;
end;
$$;
