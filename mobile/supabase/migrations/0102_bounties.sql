-- Hound: Bounties. Put Bones on a step target for your friends:
-- "First to 15,000 steps today gets 30 Bones."
--
--   - The poster pays: 10-100 Bones come off their bones_balance when
--     they post. The first friend whose steps today reach the target gets
--     them. Nobody by the end of the poster's day: the Bones go back.
--   - One bounty out at a time, at most 3 posted a day, and only to
--     accepted friends.
--   - Winning is about steps, not chance. The winner's Bones go to
--     bones_balance only: bones_earned_total (what challenge unlocks go
--     by) is for Bones Hound pays out, and these came from a friend.
--   - Steps are the phone's own count, the same trust every goal and
--     challenge already runs on (claim_bounty takes them like
--     claim_goal_day takes "every goal is done").
--   - Unclaimed bounties are refunded the next time the poster opens
--     Today (list_bounties) or posts again; nothing needs a schedule.
--   - Posting pushes the poster's friends, and a claim pushes the poster,
--     through send-social-push (kinds 'bounty_posted', 'bounty_claimed').
--
-- Run this once, after 0001-0101, in the SQL Editor, then deploy
-- send-social-push, before publishing the app update that goes with it.

create table public.bounties (
  id uuid primary key default gen_random_uuid(),
  poster_id uuid not null references public.profiles (id) on delete cascade,
  target_steps integer not null check (target_steps between 2000 and 60000),
  bones integer not null check (bones between 10 and 100),
  ends_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'claimed', 'refunded')),
  claimed_by uuid references public.profiles (id) on delete set null,
  claimed_steps integer,
  settled_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index bounties_one_open on public.bounties (poster_id) where status = 'open';
create index bounties_poster_created on public.bounties (poster_id, created_at desc);

alter table public.bounties enable row level security;

-- Your own bounties only. Friends' bounties come through list_bounties.
create policy "Posters can view their bounties"
  on public.bounties for select to authenticated
  using (poster_id = auth.uid());

revoke all on public.bounties from anon;
revoke insert, update, delete on public.bounties from authenticated;

-- Gives back the Bones on a poster's open bounties whose time is up.
create or replace function public.refund_expired_bounties(p_poster uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  back integer;
begin
  with done as (
    update public.bounties b
      set status = 'refunded', settled_at = now()
      where b.poster_id = p_poster and b.status = 'open' and b.ends_at <= now()
      returning b.bones
  )
  select coalesce(sum(bones), 0) into back from done;
  if back > 0 then
    update public.profiles p set bones_balance = p.bones_balance + back where p.id = p_poster;
  end if;
end;
$$;

revoke execute on function public.refund_expired_bounties(uuid) from public, anon, authenticated;

-- p_ends_at is the end of the poster's own day, worked out on the phone;
-- it has to be at least 30 minutes away and no more than 26 hours.
create or replace function public.post_bounty(p_target_steps integer, p_bones integer, p_ends_at timestamptz)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  balance integer;
  new_id uuid;
  recipients uuid[];
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  if p_target_steps is null or p_target_steps not between 2000 and 60000 then
    raise exception 'Pick a target between 2,000 and 60,000 steps.';
  end if;
  if p_bones is null or p_bones not between 10 and 100 then
    raise exception 'A bounty is 10 to 100 Bones.';
  end if;
  if p_ends_at is null or p_ends_at < now() + interval '30 minutes' or p_ends_at > now() + interval '26 hours' then
    raise exception 'It''s too late in the day for a bounty. Post one tomorrow.';
  end if;
  if not exists (
    select 1 from public.friendships f
    where f.status = 'accepted' and (f.requester_id = me or f.recipient_id = me)
  ) then
    raise exception 'Add a friend first: bounties are for your friends.';
  end if;

  perform public.refund_expired_bounties(me);
  if exists (select 1 from public.bounties b where b.poster_id = me and b.status = 'open') then
    raise exception 'You already have a bounty out.';
  end if;
  if (select count(*) from public.bounties b where b.poster_id = me and b.created_at > now() - interval '24 hours') >= 3 then
    raise exception 'That''s 3 bounties today. Post another tomorrow.';
  end if;

  select p.bones_balance into balance from public.profiles p where p.id = me for update;
  if coalesce(balance, 0) < p_bones then
    raise exception 'Not enough Bones for that bounty.';
  end if;

  update public.profiles p set bones_balance = p.bones_balance - p_bones where p.id = me;
  insert into public.bounties (poster_id, target_steps, bones, ends_at)
    values (me, p_target_steps, p_bones, p_ends_at)
    returning id into new_id;

  select coalesce(array_agg(x.friend), '{}') into recipients
  from (
    select case when f.requester_id = me then f.recipient_id else f.requester_id end as friend
    from public.friendships f
    where f.status = 'accepted' and (f.requester_id = me or f.recipient_id = me)
  ) x
  where public.social_push_reachable(x.friend);

  if array_length(recipients, 1) > 0 then
    perform public.social_notify(jsonb_build_object(
      'kind', 'bounty_posted', 'from_user', me, 'challenge_id', null,
      'to_users', to_jsonb(recipients), 'target_steps', p_target_steps, 'bones', p_bones));
  end if;

  return new_id;
end;
$$;

revoke execute on function public.post_bounty(integer, integer, timestamptz) from public, anon;
grant execute on function public.post_bounty(integer, integer, timestamptz) to authenticated;

-- Takes back an open bounty nobody has claimed yet; the Bones go back.
create or replace function public.cancel_bounty(p_bounty_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  b public.bounties;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  select * into b from public.bounties x where x.id = p_bounty_id and x.poster_id = me for update;
  if not found or b.status <> 'open' then
    raise exception 'That bounty has already been settled.';
  end if;
  update public.bounties x set status = 'refunded', settled_at = now() where x.id = b.id;
  update public.profiles p set bones_balance = p.bones_balance + b.bones where p.id = me;
end;
$$;

revoke execute on function public.cancel_bounty(uuid) from public, anon;
grant execute on function public.cancel_bounty(uuid) to authenticated;

-- A friend's steps today reached the target. The first claim wins;
-- anyone after that gets claimed = false.
create or replace function public.claim_bounty(p_bounty_id uuid, p_steps integer)
returns table (claimed boolean, bones integer)
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  b public.bounties;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  if p_steps is null or p_steps not between 0 and 150000 then
    raise exception 'Invalid steps.';
  end if;
  select * into b from public.bounties x where x.id = p_bounty_id for update;
  if not found or b.poster_id = me or public.friend_relation(me, b.poster_id) <> 'friends' then
    raise exception 'That bounty isn''t open to you.';
  end if;
  if b.status <> 'open' or b.ends_at <= now() or p_steps < b.target_steps then
    return query select false, 0;
    return;
  end if;

  update public.bounties x
    set status = 'claimed', claimed_by = me, claimed_steps = p_steps, settled_at = now()
    where x.id = b.id;
  update public.profiles p set bones_balance = p.bones_balance + b.bones where p.id = me;
  insert into public.activity_events (user_id, kind, score_points, xp_points, bones_points)
    values (me, 'bounty_won', 0, 0, b.bones);

  if public.social_push_reachable(b.poster_id) then
    perform public.social_notify(jsonb_build_object(
      'kind', 'bounty_claimed', 'from_user', me, 'to_user', b.poster_id, 'challenge_id', null,
      'target_steps', b.target_steps, 'bones', b.bones));
  end if;

  return query select true, b.bones;
end;
$$;

revoke execute on function public.claim_bounty(uuid, integer) from public, anon;
grant execute on function public.claim_bounty(uuid, integer) to authenticated;

-- What Today shows: your own bounty (open, or settled in the last 12
-- hours so you see how it went) and your friends' open ones, plus
-- theirs claimed in the last 12 hours. Refunds your own expired ones
-- first.
create or replace function public.list_bounties()
returns table (
  id uuid,
  mine boolean,
  poster_id uuid,
  poster_name text,
  poster_initials text,
  poster_frame_id text,
  poster_background_id text,
  poster_icon_id text,
  target_steps integer,
  bones integer,
  ends_at timestamptz,
  status text,
  claimed_by_me boolean,
  claimer_name text,
  settled_at timestamptz
)
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  perform public.refund_expired_bounties(me);

  return query
    select b.id,
      b.poster_id = me,
      b.poster_id,
      case when p.use_username and p.username is not null then p.username else p.name end,
      p.initials, p.equipped_frame_id, p.equipped_background_id, p.equipped_icon_id,
      b.target_steps, b.bones, b.ends_at, b.status,
      coalesce(b.claimed_by = me, false),
      case when c.id is null then null
           when c.use_username and c.username is not null then c.username else c.name end,
      b.settled_at
    from public.bounties b
    join public.profiles p on p.id = b.poster_id
    left join public.profiles c on c.id = b.claimed_by
    where (
        b.poster_id = me
        and (b.status = 'open' or b.settled_at > now() - interval '12 hours')
      ) or (
        b.poster_id <> me
        and public.friend_relation(me, b.poster_id) = 'friends'
        and ((b.status = 'open' and b.ends_at > now())
             or (b.status = 'claimed' and b.settled_at > now() - interval '12 hours'))
      )
    order by (b.poster_id = me) desc, (b.status = 'open') desc, b.created_at desc
    limit 20;
end;
$$;

revoke execute on function public.list_bounties() from public, anon;
grant execute on function public.list_bounties() to authenticated;

-- Undo, if needed:
--   drop function public.list_bounties();
--   drop function public.claim_bounty(uuid, integer);
--   drop function public.cancel_bounty(uuid);
--   drop function public.post_bounty(integer, integer, timestamptz);
--   drop function public.refund_expired_bounties(uuid);
--   (refund open bounties first:
--    update profiles p set bones_balance = bones_balance + b.bones
--      from bounties b where b.poster_id = p.id and b.status = 'open';)
--   drop table public.bounties;
