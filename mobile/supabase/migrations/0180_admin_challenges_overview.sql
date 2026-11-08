-- Admin → Overview → Challenges: how many challenges are running on
-- Hound, of which kinds, made by whom (friends, a community code or a
-- global one), how many people are in them, and how many are being
-- made week to week.
--
--   admin_challenges_overview()   admins only
--
-- "Running" is started and not yet ended; "upcoming" hasn't started.
-- Community challenges taken down (review_state 'removed') don't count.
--
-- Run this once, after 0179, in the SQL Editor. Read only: nothing else
-- changes.
--
-- Undo, if needed: drop function public.admin_challenges_overview();

create or replace function public.admin_challenges_overview()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;
  return (
    with ch as (
      select c.id, c.kind::text as kind, c.created_by, c.created_at, c.starts_at, c.ends_at,
        case when c.is_global then 'global' when c.community then 'community' else 'friends' end as source,
        c.starts_at <= now() and c.ends_at > now() as running,
        c.starts_at > now() as upcoming,
        (select count(*) from public.challenge_participants cp where cp.challenge_id = c.id) as people
      from public.challenges c
      where coalesce(c.review_state, 'listed') <> 'removed'
    ),
    kinds as (select unnest(enum_range(null::public.challenge_kind))::text as kind)
    select jsonb_build_object(
      'running', (select count(*) from ch where running),
      'upcoming', (select count(*) from ch where upcoming),
      'finished_30d', (select count(*) from ch where ch.ends_at <= now() and ch.ends_at > now() - interval '30 days'),
      'all', (select count(*) from ch),
      'created_7d', (select count(*) from ch where ch.created_at > now() - interval '7 days'),
      'created_30d', (select count(*) from ch where ch.created_at > now() - interval '30 days'),
      'creators_30d', (select count(distinct ch.created_by) from ch where ch.created_at > now() - interval '30 days'),
      -- People in at least one running challenge, and the usual group size.
      'people_running', (
        select count(distinct cp.user_id) from public.challenge_participants cp
        join ch on ch.id = cp.challenge_id where ch.running
      ),
      'avg_people_running', (select coalesce(round(avg(ch.people), 1), 0) from ch where running),
      'by_source', (
        select jsonb_object_agg(s.source, jsonb_build_object(
          'running', (select count(*) from ch where ch.source = s.source and ch.running),
          'created_30d', (select count(*) from ch where ch.source = s.source and ch.created_at > now() - interval '30 days'),
          'all', (select count(*) from ch where ch.source = s.source)))
        from (values ('friends'), ('community'), ('global')) s(source)
      ),
      -- Every kind, most played this month first (then all time).
      'by_kind', (
        select coalesce(jsonb_agg(row_to_json(k) order by k.created_30d desc, k.running desc, k.all_time desc, k.kind), '[]'::jsonb)
        from (
          select kinds.kind,
            (select count(*) from ch where ch.kind = kinds.kind and ch.running) as running,
            (select count(*) from ch where ch.kind = kinds.kind and ch.upcoming) as upcoming,
            (select count(*) from ch where ch.kind = kinds.kind and ch.created_at > now() - interval '30 days') as created_30d,
            (select count(*) from ch where ch.kind = kinds.kind) as all_time,
            (select coalesce(sum(ch.people), 0) from ch where ch.kind = kinds.kind and ch.running) as people_running
          from kinds
        ) k
      ),
      -- Made per week, the last 8 weeks (Monday starts), oldest first.
      'weekly', (
        select jsonb_agg(jsonb_build_object('week', w.week::date, 'created', (
          select count(*) from ch where date_trunc('week', ch.created_at) = w.week)) order by w.week)
        from generate_series(date_trunc('week', now()) - interval '7 weeks', date_trunc('week', now()), interval '1 week') w(week)
      )
    )
  );
end;
$$;

revoke execute on function public.admin_challenges_overview() from public, anon;
grant execute on function public.admin_challenges_overview() to authenticated;
