-- Hound: new users join the open Global Hound Challenges (Steve, Nov
-- 2026). Approved mockup: claude.ai/artifact/3yH2t6bnCr8Qu1B4TS717x.
--
--   auto_join_open_globals()   once per account, from Today's first open
--                              (after the welcome wizard): joins up to 3
--                              Global challenges that are set up and not
--                              over. Accounts under 7 days old get in even
--                              after a challenge's 3-day join window has
--                              closed. Not 75 Day or Accountability (a
--                              personal commitment). Live ones first, the
--                              soonest to end that still has 2+ days left;
--                              then upcoming ones, soonest to start.
--                              Accounts older than 7 days are never swept
--                              in. Returns the card.
--   auto_join_card()           the "You're in" card on Today until Got it
--   auto_join_leave(id)        Leave on the card: out of the challenge, and
--                              whatever joining made (the bingo card, the
--                              Derby or Shootout player, ...)
--   auto_join_rejoin(id)       Undo on the card, even past the join window
--   auto_join_dismiss()        Got it
--   admin_auto_join_overview() Admin → Overview → Status
--
-- Run this once, after 0001-0221, in the SQL Editor.

alter table public.profiles add column if not exists globals_auto_joined_at timestamptz;
alter table public.profiles add column if not exists globals_card_done_at timestamptz;

create table if not exists public.global_auto_joins (
  user_id uuid not null references public.profiles (id) on delete cascade,
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  joined_at timestamptz not null default now(),
  -- Joined after the challenge's join window had closed.
  late boolean not null default false,
  left_at timestamptz,
  primary key (user_id, challenge_id)
);
create index if not exists global_auto_joins_at on public.global_auto_joins (joined_at desc);
alter table public.global_auto_joins enable row level security;
revoke all on public.global_auto_joins from anon, authenticated;

-- What the card shows: each auto-joined challenge, whether you're still
-- in, and how many are.
create or replace function public.auto_join_card()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  p public.profiles%rowtype;
begin
  if caller is null then
    raise exception 'not authorized';
  end if;
  select * into p from public.profiles where id = caller;
  return jsonb_build_object(
    'show', p.globals_card_done_at is null and exists (select 1 from public.global_auto_joins j where j.user_id = caller),
    'challenges', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'id', c.id, 'name', c.name, 'kind', c.kind, 'starts_at', c.starts_at, 'ends_at', c.ends_at,
          'duration_days', c.duration_days,
          'joined', j.left_at is null and exists (select 1 from public.challenge_participants cp where cp.challenge_id = c.id and cp.user_id = caller),
          'field', (select count(*) from public.challenge_participants cp where cp.challenge_id = c.id))
        order by j.joined_at, c.ends_at), '[]'::jsonb)
      from public.global_auto_joins j
      join public.challenges c on c.id = j.challenge_id
      where j.user_id = caller));
end;
$$;
revoke execute on function public.auto_join_card() from public, anon;
grant execute on function public.auto_join_card() to authenticated;

create or replace function public.auto_join_open_globals()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  p public.profiles%rowtype;
  c record;
  n int := 0;
begin
  if caller is null then
    raise exception 'not authorized';
  end if;
  select * into p from public.profiles where id = caller for update;
  if p.id is null or p.globals_auto_joined_at is not null then
    return public.auto_join_card();
  end if;
  update public.profiles set globals_auto_joined_at = now() where id = caller;
  -- New accounts only.
  if p.created_at < now() - interval '7 days' then
    return public.auto_join_card();
  end if;

  for c in
    select x.* from public.challenges x
    where x.is_global and not coalesce(x.community, false)
      and x.kind::text not in ('seventyfive', 'checklist')
      and now() < x.ends_at
      and not exists (select 1 from public.challenge_participants cp where cp.challenge_id = x.id and cp.user_id = caller)
      -- The Derby and the Shootout take nobody until they're set up.
      and (x.kind::text <> 'derby' or exists (select 1 from public.derby_games g where g.challenge_id = x.id))
      and (x.kind::text <> 'shootout' or exists (select 1 from public.shootout_games g where g.challenge_id = x.id))
    order by
      case when x.starts_at <= now() and x.ends_at > now() + interval '2 days' then 0
           when x.starts_at > now() then 1 else 2 end,
      case when x.starts_at <= now() then x.ends_at else x.starts_at end
  loop
    exit when n >= 3;
    begin
      insert into public.challenge_participants (challenge_id, user_id) values (c.id, caller);
      insert into public.global_auto_joins (user_id, challenge_id, late)
        values (caller, c.id, now() >= c.join_closes_at)
        on conflict do nothing;
      n := n + 1;
    exception when others then
      -- A challenge that won't take them (a kind's own rule): skip it.
      null;
    end;
  end loop;
  return public.auto_join_card();
end;
$$;
revoke execute on function public.auto_join_open_globals() from public, anon;
grant execute on function public.auto_join_open_globals() to authenticated;

-- Out of an auto-joined challenge, and whatever joining it made.
create or replace function public.auto_join_leave(p_challenge_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  t text;
begin
  if caller is null then
    raise exception 'not authorized';
  end if;
  if not exists (select 1 from public.global_auto_joins j where j.user_id = caller and j.challenge_id = p_challenge_id) then
    raise exception 'You can only leave a challenge you were put in.';
  end if;
  foreach t in array array['bingo_progress', 'bingo_cards', 'golf_shots', 'golf_players', 'houndopoly_events', 'houndopoly_turns',
    'houndopoly_players', 'pack_votes', 'pack_members', 'derby_swings', 'derby_days', 'derby_players', 'shootout_kicks',
    'shootout_players', 'door_opens', 'progress_snapshots'] loop
    if to_regclass('public.' || t) is not null then
      execute format('delete from public.%I where challenge_id = $1 and user_id = $2', t) using p_challenge_id, caller;
    end if;
  end loop;
  delete from public.challenge_participants where challenge_id = p_challenge_id and user_id = caller;
  update public.global_auto_joins set left_at = now() where user_id = caller and challenge_id = p_challenge_id;
  return public.auto_join_card();
end;
$$;
revoke execute on function public.auto_join_leave(uuid) from public, anon;
grant execute on function public.auto_join_leave(uuid) to authenticated;

-- Undo on the card: back in, even past the join window, while it's on.
create or replace function public.auto_join_rejoin(p_challenge_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  c public.challenges%rowtype;
begin
  if caller is null then
    raise exception 'not authorized';
  end if;
  select x.* into c from public.challenges x
    join public.global_auto_joins j on j.challenge_id = x.id and j.user_id = caller
    where x.id = p_challenge_id;
  if c.id is null then
    raise exception 'You can only rejoin a challenge you were put in.';
  end if;
  if now() >= c.ends_at then
    raise exception 'That challenge is over.';
  end if;
  insert into public.challenge_participants (challenge_id, user_id) values (p_challenge_id, caller)
    on conflict (challenge_id, user_id) do nothing;
  update public.global_auto_joins set left_at = null where user_id = caller and challenge_id = p_challenge_id;
  return public.auto_join_card();
end;
$$;
revoke execute on function public.auto_join_rejoin(uuid) from public, anon;
grant execute on function public.auto_join_rejoin(uuid) to authenticated;

create or replace function public.auto_join_dismiss()
returns void
language sql
security definer set search_path = public
as $$
  update public.profiles set globals_card_done_at = now() where id = auth.uid() and globals_card_done_at is null;
$$;
revoke execute on function public.auto_join_dismiss() from public, anon;
grant execute on function public.auto_join_dismiss() to authenticated;

-- Played a challenge within 3 days of being put in it: synced steps for
-- it, a kick, a swing or a golf shot.
create or replace function public.auto_join_played(j public.global_auto_joins)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (select 1 from public.progress_snapshots ps
                 where ps.challenge_id = j.challenge_id and ps.user_id = j.user_id and ps.steps > 0
                   and ps.day <= (j.joined_at + interval '3 days')::date)
      or exists (select 1 from public.shootout_kicks k
                 where k.challenge_id = j.challenge_id and k.user_id = j.user_id and k.kicked_at <= j.joined_at + interval '3 days')
      or exists (select 1 from public.derby_swings s
                 where s.challenge_id = j.challenge_id and s.user_id = j.user_id and s.swung_at <= j.joined_at + interval '3 days')
      or exists (select 1 from public.golf_shots g
                 where g.challenge_id = j.challenge_id and g.user_id = j.user_id and g.created_at <= j.joined_at + interval '3 days');
$$;
revoke execute on function public.auto_join_played(public.global_auto_joins) from public, anon, authenticated;

-- Admin → Overview → Status → New users in Global challenges.
create or replace function public.admin_auto_join_overview()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  shipped timestamptz := (select min(j.joined_at) from public.global_auto_joins j);
begin
  perform public.admin_require();
  return jsonb_build_object(
    'new_7d', (select count(*) from public.profiles p where p.created_at > now() - interval '7 days'),
    'people_7d', (select count(distinct j.user_id) from public.global_auto_joins j where j.joined_at > now() - interval '7 days'),
    'joins_7d', (select count(*) from public.global_auto_joins j where j.joined_at > now() - interval '7 days'),
    'challenges_7d', (select count(distinct j.challenge_id) from public.global_auto_joins j where j.joined_at > now() - interval '7 days'),
    -- Of those put in at least 3 days ago (so they've had the chance).
    'eligible_played', (select count(distinct j.user_id) from public.global_auto_joins j where j.joined_at <= now() - interval '3 days'),
    'played', (select count(distinct j.user_id) from public.global_auto_joins j
               where j.joined_at <= now() - interval '3 days' and public.auto_join_played(j)),
    'people_all', (select count(distinct j.user_id) from public.global_auto_joins j),
    'left_one', (select count(distinct j.user_id) from public.global_auto_joins j where j.left_at is not null),
    'left_all', (select count(*) from (select j.user_id from public.global_auto_joins j group by j.user_id
                                       having bool_and(j.left_at is not null)) z),
    'late_7d', (select count(*) from public.global_auto_joins j where j.late and j.joined_at > now() - interval '7 days'),
    -- Still syncing steps a week later (days 7-13 after signing up):
    -- the auto-joined, and the accounts from the 30 days before it shipped.
    'week_later_auto', (
      select round(100.0 * count(*) filter (where exists (
               select 1 from public.daily_step_totals d where d.user_id = z.id and d.steps > 0
                 and d.day between (z.created_at + interval '7 days')::date and (z.created_at + interval '13 days')::date))
             / nullif(count(*), 0))
      from (select distinct p.id, p.created_at from public.profiles p
            join public.global_auto_joins j on j.user_id = p.id
            where p.created_at <= now() - interval '14 days') z),
    'week_later_before', (
      select round(100.0 * count(*) filter (where exists (
               select 1 from public.daily_step_totals d where d.user_id = p.id and d.steps > 0
                 and d.day between (p.created_at + interval '7 days')::date and (p.created_at + interval '13 days')::date))
             / nullif(count(*), 0))
      from public.profiles p
      where shipped is not null and p.created_at between shipped - interval '30 days' and shipped
        and p.created_at <= now() - interval '14 days'),
    'by_challenge', (
      select coalesce(jsonb_agg(jsonb_build_object('name', z.name, 'joined', z.joined, 'left', z.lft, 'played', z.played)
        order by z.joined desc), '[]'::jsonb)
      from (select c.name, count(*) as joined, count(*) filter (where j.left_at is not null) as lft,
                   count(*) filter (where public.auto_join_played(j)) as played
            from public.global_auto_joins j join public.challenges c on c.id = j.challenge_id
            where j.joined_at > now() - interval '7 days'
            group by c.id, c.name
            order by count(*) desc limit 8) z));
end;
$$;
revoke execute on function public.admin_auto_join_overview() from public, anon;
grant execute on function public.admin_auto_join_overview() to authenticated;
