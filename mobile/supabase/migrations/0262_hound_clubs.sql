-- 0262: Hound clubs (Steve, 25 Nov 2026: "a public / global club,
-- specifically for Intermittent Fasting"). An admin marks a public club
-- as a Hound club (admin_set_hound_club, from the club's page):
--
--   - open to everyone: no member cap (club_config.max_members doesn't
--     apply), still public, still the 13+ and username asks;
--   - featured on the Clubs tab for everyone not in it (hound_clubs), and
--     first in Find a club;
--   - a Fasting one is suggested on the Fasting screen.
--
-- And a fasting club's numbers: club_fasting now shows every member who
-- has ever fasted and shares (not only the last 30 days), the top 25 plus
-- your own row and rank, and to people who haven't joined a public club
-- yet, just how many are fasting now and how many fast there.
--
-- Run this once, after 0001-0261, in the SQL Editor.

alter table public.clubs add column if not exists hound boolean not null default false;

-- club_row, as in 0185, plus 'hound'.
create or replace function public.club_row(cl public.clubs, p_user uuid)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select jsonb_build_object(
    'id', cl.id,
    'name', cl.name,
    'sport', cl.sport,
    'city', cl.city,
    'description', cl.description,
    'color', cl.color,
    'is_public', cl.is_public,
    'hound', cl.hound,
    'members', (select count(*) from public.club_members m where m.club_id = cl.id),
    'role', (select m.role from public.club_members m where m.club_id = cl.id and m.user_id = p_user),
    'muted', coalesce((select m.muted from public.club_members m where m.club_id = cl.id and m.user_id = p_user), false),
    'open', (
      select count(*) from public.club_posts cp join public.challenges c on c.id = cp.challenge_id
      where cp.club_id = cl.id and public.club_challenge_open(c)
        and not exists (select 1 from public.challenge_participants x where x.challenge_id = c.id and x.user_id = p_user)
    ),
    'new', (
      select count(*) from public.club_posts cp join public.challenges c on c.id = cp.challenge_id
      join public.club_members m on m.club_id = cl.id and m.user_id = p_user
      where cp.club_id = cl.id and cp.posted_at > m.seen_at and public.club_challenge_open(c)
        and cp.posted_by is distinct from p_user
        and not exists (select 1 from public.challenge_participants x where x.challenge_id = c.id and x.user_id = p_user)
    )
  );
$$;
revoke execute on function public.club_row(public.clubs, uuid) from public, anon, authenticated;

-- club_join_problem, as in 0185, but a Hound club has no member cap.
create or replace function public.club_join_problem(p_club uuid, p_user uuid)
returns text
language plpgsql
stable
security definer set search_path = public
as $$
declare
  cfg public.club_config;
  comm public.community_config;
  cl public.clubs;
  org_kind text;
  org_ok boolean;
begin
  select * into cfg from public.club_config;
  select * into comm from public.community_config;
  select * into cl from public.clubs where id = p_club;
  if not found or cl.removed_at is not null then
    return 'That club isn''t on Hound anymore.';
  end if;
  if exists (select 1 from public.club_members m where m.club_id = p_club and m.user_id = p_user) then
    return null;
  end if;
  if not cfg.enabled then
    return 'Clubs are switched off right now.';
  end if;
  if not cl.hound and (select count(*) from public.club_members m where m.club_id = p_club) >= cfg.max_members then
    return 'This club is full.';
  end if;
  if (select count(*) from public.club_members m join public.clubs c on c.id = m.club_id
      where m.user_id = p_user and c.removed_at is null) >= cfg.max_joined then
    return format('You''re in %s clubs already. Leave one first.', cfg.max_joined);
  end if;
  if comm.age_gate then
    select o.kind, o.community_ok into org_kind, org_ok
      from public.organizations o join public.profiles p on p.organization_id = o.id where p.id = p_user;
    if org_kind = 'school' and not coalesce(org_ok, false) then
      return 'Clubs aren''t available through your school.';
    end if;
    if not exists (select 1 from public.community_age_ok a where a.user_id = p_user) then
      return 'age';
    end if;
  end if;
  if (select p.username from public.profiles p where p.id = p_user) is null then
    return 'username';
  end if;
  return null;
end;
$$;
revoke execute on function public.club_join_problem(uuid, uuid) from public, anon, authenticated;

-- Find a club, as in 0185, with Hound clubs first.
create or replace function public.search_clubs(p_query text default '', p_sport text default null)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  q text := '%' || replace(replace(trim(coalesce(p_query, '')), '%', ''), '_', '') || '%';
begin
  if not (select cfg.search_on and cfg.enabled from public.club_config cfg) then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(r.j order by r.hound desc, r.members desc, r.name)
    from (
      select public.club_row(c, auth.uid()) as j, c.name, c.hound,
        (select count(*) from public.club_members m where m.club_id = c.id) as members
      from public.clubs c
      where c.is_public and c.removed_at is null
        and (p_sport is null or c.sport = p_sport)
        and (c.name ilike q or coalesce(c.city, '') ilike q)
      order by c.hound desc, members desc, c.name
      limit 30
    ) r
  ), '[]'::jsonb);
end;
$$;
revoke execute on function public.search_clubs(text, text) from public, anon;
grant execute on function public.search_clubs(text, text) to authenticated;

-- The Hound clubs, for the Clubs tab and the Fasting screen: each with
-- how many fast there and how many are fasting now (fasting clubs).
create or replace function public.hound_clubs()
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select coalesce(jsonb_agg(public.club_row(c, auth.uid()) || jsonb_build_object(
      'fasting_now', (select count(*) from public.fasts f join public.club_members m on m.user_id = f.user_id and m.club_id = c.id
                      join public.fasting_profiles fp on fp.user_id = f.user_id and fp.share and fp.age = 'ok'
                      where f.ended_at is null),
      'fasters', (select count(*) from public.club_members m join public.fasting_profiles fp on fp.user_id = m.user_id and fp.age = 'ok'
                  where m.club_id = c.id and exists (select 1 from public.fasts f where f.user_id = m.user_id)))
    order by c.created_at), '[]'::jsonb)
  from public.clubs c
  where c.hound and c.is_public and c.removed_at is null
    and (select cfg.enabled from public.club_config cfg);
$$;
revoke execute on function public.hound_clubs() from public, anon;
grant execute on function public.hound_clubs() to authenticated;

-- An admin makes a public club a Hound club, or stops.
create or replace function public.admin_set_hound_club(p_club_id uuid, p_on boolean)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Admins only.';
  end if;
  if p_on and not exists (select 1 from public.clubs c where c.id = p_club_id and c.is_public and c.removed_at is null) then
    raise exception 'Only a public club can be a Hound club.';
  end if;
  update public.clubs set hound = coalesce(p_on, false) where id = p_club_id;
end;
$$;
revoke execute on function public.admin_set_hound_club(uuid, boolean) from public, anon;
grant execute on function public.admin_set_hound_club(uuid, boolean) to authenticated;

-- A club's fasting (0261), for its page. Members: who's fasting now (up
-- to 30), the week's board of everyone in it who has ever fasted and
-- shares (the top 25, and your own row with its rank if you're further
-- down). Someone looking at a public club they haven't joined: only the
-- counts.
create or replace function public.club_fasting(p_club_id uuid, p_local_date date)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  member boolean;
  ranked jsonb;
  mine jsonb;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  member := exists (select 1 from public.club_members m where m.club_id = p_club_id and m.user_id = me);
  if not member and not exists (select 1 from public.clubs c where c.id = p_club_id and c.is_public and c.removed_at is null) then
    raise exception 'You''re not in that club.';
  end if;
  perform public.fasting_check_date(p_local_date);

  if member then
    select coalesce(jsonb_agg(b.j || jsonb_build_object('rank', b.rank) order by b.rank), '[]') into ranked
    from (
      select x.j, row_number() over (order by (x.j -> 'numbers' ->> 'week_days')::int desc,
                                              (x.j -> 'numbers' ->> 'streak')::int desc,
                                              (x.j -> 'numbers' ->> 'longest')::numeric desc) as rank
      from (
        select public.fasting_person(m.user_id) || jsonb_build_object('me', m.user_id = me,
                 'numbers', public.fasting_numbers(m.user_id, p_local_date)) j
        from public.club_members m
        join public.fasting_profiles fp on fp.user_id = m.user_id and fp.share and fp.age = 'ok'
        where m.club_id = p_club_id
          and exists (select 1 from public.fasts f where f.user_id = m.user_id)
      ) x
    ) b;
    select e into mine from jsonb_array_elements(ranked) e where (e ->> 'me')::boolean;
  end if;

  return jsonb_build_object(
    'member', member,
    'can_fast', exists (select 1 from public.fasting_profiles fp where fp.user_id = me and fp.age = 'ok'),
    'under', exists (select 1 from public.fasting_profiles fp where fp.user_id = me and fp.age = 'under'),
    'now_count', (select count(*) from public.fasts f
                  join public.club_members m on m.club_id = p_club_id and m.user_id = f.user_id
                  join public.fasting_profiles fp on fp.user_id = f.user_id and fp.share and fp.age = 'ok'
                  where f.ended_at is null),
    'fasters', (select count(*) from public.club_members m
                join public.fasting_profiles fp on fp.user_id = m.user_id and fp.share and fp.age = 'ok'
                where m.club_id = p_club_id and exists (select 1 from public.fasts f where f.user_id = m.user_id)),
    'now', case when member then coalesce((
      select jsonb_agg(x.j order by x.started_at)
      from (select public.fasting_person(f.user_id) || jsonb_build_object('fast', public.fasting_open_json(f), 'me', f.user_id = me) j, f.started_at
            from public.fasts f
            join public.club_members m on m.club_id = p_club_id and m.user_id = f.user_id
            join public.fasting_profiles fp on fp.user_id = f.user_id and fp.share and fp.age = 'ok'
            where f.ended_at is null
            order by f.started_at
            limit 30) x), '[]') else '[]' end,
    'board', case when member then coalesce((
      select jsonb_agg(e order by (e ->> 'rank')::int) from jsonb_array_elements(ranked) e
      where (e ->> 'rank')::int <= 25 or (e ->> 'me')::boolean), '[]') else '[]' end,
    'my_rank', case when mine is null then null else (mine ->> 'rank')::int end);
end;
$$;
revoke execute on function public.club_fasting(uuid, date) from public, anon;
grant execute on function public.club_fasting(uuid, date) to authenticated;

-- Admin → Overview → Fitness → Hound clubs: each one's members, joins
-- this week, how many fast there and how many are fasting now.
create or replace function public.admin_hound_clubs_overview()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Admins only.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'sport', c.sport,
      'members', (select count(*) from public.club_members m where m.club_id = c.id),
      'joined_7d', (select count(*) from public.club_members m where m.club_id = c.id and m.joined_at > now() - interval '7 days'),
      'fasters', (select count(*) from public.club_members m
                  where m.club_id = c.id and exists (select 1 from public.fasts f where f.user_id = m.user_id)),
      'fasted_7d', (select count(distinct f.user_id) from public.fasts f join public.club_members m on m.user_id = f.user_id and m.club_id = c.id
                    where f.ended_at > now() - interval '7 days'),
      'fasting_now', (select count(*) from public.fasts f join public.club_members m on m.user_id = f.user_id and m.club_id = c.id
                      where f.ended_at is null)) order by c.created_at)
    from public.clubs c where c.hound and c.removed_at is null), '[]'::jsonb);
end;
$$;
revoke execute on function public.admin_hound_clubs_overview() from public, anon;
grant execute on function public.admin_hound_clubs_overview() to authenticated;
