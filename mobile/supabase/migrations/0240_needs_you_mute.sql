-- Hound: mute Today's Needs you for a while (Steve, Nov 2026).
--
-- The mute itself lives on the phone (it's that phone's Today); this
-- only records it, for Admin → Overview → Status → Needs you: how many
-- mute, for how long, and how often they unmute early.
--
--   needs_you_mutes   one row per mute: the hours picked (2, 4, 12, or
--                     "until tomorrow morning", kept as 0), until when,
--                     and when it was unmuted early, if it was.
--
-- Run this once, after 0239, in the SQL Editor.

create table public.needs_you_mutes (
  id bigserial primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  hours int not null check (hours in (0, 2, 4, 12)),
  waiting int not null default 0 check (waiting >= 0),
  muted_at timestamptz not null default now(),
  until timestamptz not null,
  unmuted_at timestamptz
);
create index needs_you_mutes_user on public.needs_you_mutes (user_id, muted_at desc);

alter table public.needs_you_mutes enable row level security;
revoke all on public.needs_you_mutes from anon;
revoke insert, update, delete on public.needs_you_mutes from authenticated;
create policy "Members see their own mutes"
  on public.needs_you_mutes for select to authenticated using (user_id = auth.uid());

-- A mute picked on the phone: how long, until when, and how many were
-- waiting. Returns its id, for an early unmute.
create or replace function public.log_needs_you_mute(p_hours int, p_until timestamptz, p_waiting int default 0)
returns bigint
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  rid bigint;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  if p_hours is null or p_hours not in (0, 2, 4, 12) then
    raise exception 'Mute for 2, 4 or 12 hours, or until tomorrow morning.';
  end if;
  if p_until is null or p_until <= now() or p_until > now() + interval '1 day' then
    raise exception 'Invalid mute.';
  end if;
  -- One mute at a time: a new one ends the last.
  update public.needs_you_mutes set unmuted_at = now()
    where user_id = me and unmuted_at is null and until > now();
  insert into public.needs_you_mutes (user_id, hours, waiting, until)
  values (me, p_hours, least(greatest(coalesce(p_waiting, 0), 0), 999), p_until)
  returning id into rid;
  return rid;
end;
$$;
revoke execute on function public.log_needs_you_mute(int, timestamptz, int) from public, anon;
grant execute on function public.log_needs_you_mute(int, timestamptz, int) to authenticated;

-- Unmuted before it ran out.
create or replace function public.log_needs_you_unmute()
returns void
language sql
security definer set search_path = public
as $$
  update public.needs_you_mutes set unmuted_at = now()
  where user_id = auth.uid() and unmuted_at is null and until > now();
$$;
revoke execute on function public.log_needs_you_unmute() from public, anon;
grant execute on function public.log_needs_you_unmute() to authenticated;

-- ── Admin → Overview → Status → Needs you ──

create or replace function public.admin_needs_you_overview()
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
    with m7 as (select * from public.needs_you_mutes m where m.muted_at > now() - interval '7 days')
    select jsonb_build_object(
      'mutedNow', (select count(distinct m.user_id) from public.needs_you_mutes m where m.unmuted_at is null and m.until > now()),
      'everMuted', (select count(distinct m.user_id) from public.needs_you_mutes m),
      'muters7d', (select count(distinct m7.user_id) from m7),
      'mutes7d', (select count(*) from m7),
      'byLength7d', jsonb_build_object(
        'h2', (select count(*) from m7 where m7.hours = 2),
        'h4', (select count(*) from m7 where m7.hours = 4),
        'h12', (select count(*) from m7 where m7.hours = 12),
        'morning', (select count(*) from m7 where m7.hours = 0)),
      'unmutedEarly7d', (select count(*) from m7 where m7.unmuted_at is not null and m7.unmuted_at < m7.until),
      'avgWaiting7d', (select round(avg(m7.waiting)::numeric, 1) from m7),
      -- Who mutes most, so a game that nags can be spotted.
      'topMuters', coalesce((
        select jsonb_agg(jsonb_build_object('name', public.horse_name(x.user_id), 'mutes', x.n) order by x.n desc)
        from (select m7.user_id, count(*) as n from m7 group by m7.user_id order by count(*) desc limit 5) x
      ), '[]'::jsonb)
    )
  );
end;
$$;
revoke execute on function public.admin_needs_you_overview() from public, anon;
grant execute on function public.admin_needs_you_overview() to authenticated;
