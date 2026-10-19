-- Hound: rewarded ads (issue #360, phase 2 of the ads plan). A member can
-- choose to watch a short ad for Bones, a few times a day. Nothing plays
-- on its own, and there are no ads inside challenges or chats.
--
-- ad_settings (one shared row, admins only) holds the switches from
-- Admin → Rewarded ads: on or off (off to start), Bones per ad (10), a
-- daily cap (3), whether organization members see ads at all (not by
-- default), and the iOS and Android ad unit ids from AdMob (blank means
-- Google's test ads, which pay nothing real to anyone).
--
-- Paying the Bones has two modes, also a switch:
--   - verify_by_server off: the app says the ad was watched and calls
--     claim_ad_reward. Needed while testing, since Google's test ads
--     never call our server. The daily cap and a 20-second gap between
--     claims bound what a tampered app could take.
--   - verify_by_server on: only Google's own signed callback pays, through
--     the admob-reward Edge Function and credit_ad_reward_verified. Turn
--     it on once AdMob's server-side verification URL is set.
-- Either way every payout is a row in ad_rewards (Google's transaction id
-- is unique, so a repeated callback pays once) and an activity_events
-- row of kind 'ad_reward', like every other Bones award. Like the daily
-- bonus (0070), ad Bones go to bones_balance only, not bones_earned_total.
--
-- Run this once, after 0001-0113, in the SQL Editor.

create table public.ad_settings (
  id boolean primary key default true,
  constraint ad_settings_singleton check (id),
  enabled boolean not null default false,
  bones_per_ad int not null default 10 check (bones_per_ad between 1 and 100),
  daily_cap int not null default 3 check (daily_cap between 0 and 20),
  show_to_org_members boolean not null default false,
  verify_by_server boolean not null default false,
  ios_unit_id text check (ios_unit_id ~ '^ca-app-pub-[0-9]+/[0-9]+$'),
  android_unit_id text check (android_unit_id ~ '^ca-app-pub-[0-9]+/[0-9]+$'),
  updated_at timestamptz not null default now()
);

insert into public.ad_settings (id) values (true);

alter table public.ad_settings enable row level security;
revoke all on public.ad_settings from anon, authenticated;

create table public.ad_rewards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  local_date date not null,
  bones int not null,
  -- 'app': the app said so (verify_by_server off); 'server': Google's
  -- signed callback.
  source text not null check (source in ('app', 'server')),
  transaction_id text unique,
  ad_unit text,
  created_at timestamptz not null default now()
);

create index ad_rewards_user_day on public.ad_rewards (user_id, local_date);

alter table public.ad_rewards enable row level security;
revoke all on public.ad_rewards from anon, authenticated;

-- Whether this member can watch one now, and what it pays. Ads stay hidden
-- for organization members unless Admin says otherwise.
create or replace function public.ad_offer_for(p_user uuid, p_local_date date)
returns table (available boolean, bones int, remaining int, verify_by_server boolean, ios_unit_id text, android_unit_id text)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.enabled
      and (s.show_to_org_members or p.organization_id is null)
      and s.daily_cap > (select count(*) from public.ad_rewards r where r.user_id = p_user and r.local_date = p_local_date),
    s.bones_per_ad,
    greatest(0, s.daily_cap - (select count(*)::int from public.ad_rewards r where r.user_id = p_user and r.local_date = p_local_date)),
    s.verify_by_server,
    s.ios_unit_id,
    s.android_unit_id
  from public.ad_settings s
  join public.profiles p on p.id = p_user
  where s.id;
$$;

revoke execute on function public.ad_offer_for(uuid, date) from public, anon, authenticated;

create or replace function public.my_ad_offer(p_local_date date)
returns table (available boolean, bones int, remaining int, verify_by_server boolean, ios_unit_id text, android_unit_id text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  utc_today date := (now() at time zone 'utc')::date;
begin
  if auth.uid() is null then
    raise exception 'Sign in to do that.';
  end if;
  if p_local_date is null or p_local_date < utc_today - 1 or p_local_date > utc_today + 1 then
    raise exception 'Invalid date.';
  end if;
  return query select * from public.ad_offer_for(auth.uid(), p_local_date);
end;
$$;

revoke execute on function public.my_ad_offer(date) from public, anon;
grant execute on function public.my_ad_offer(date) to authenticated;

-- Pays one ad, if today's cap allows. Shared by both ways of paying.
create or replace function public.pay_ad_reward(
  p_user uuid,
  p_local_date date,
  p_source text,
  p_transaction_id text,
  p_ad_unit text
)
returns table (awarded boolean, bones int, remaining int)
language plpgsql
security definer
set search_path = public
as $$
declare
  offer record;
  last_at timestamptz;
begin
  -- One payout at a time per member, so two at once can't both fit under
  -- the cap.
  perform 1 from public.profiles where id = p_user for update;
  if not found then
    raise exception 'No profile for this account.';
  end if;

  if p_transaction_id is not null and exists (select 1 from public.ad_rewards r where r.transaction_id = p_transaction_id) then
    return query select false, 0, (select o.remaining from public.ad_offer_for(p_user, p_local_date) o);
    return;
  end if;

  select * into offer from public.ad_offer_for(p_user, p_local_date);
  if offer is null or not offer.available then
    return query select false, 0, coalesce(offer.remaining, 0);
    return;
  end if;

  -- An ad takes longer than this to watch, so two claims this close
  -- together didn't come from two ads.
  select max(r.created_at) into last_at from public.ad_rewards r where r.user_id = p_user;
  if p_source = 'app' and last_at is not null and last_at > now() - interval '20 seconds' then
    return query select false, 0, offer.remaining;
    return;
  end if;

  insert into public.ad_rewards (user_id, local_date, bones, source, transaction_id, ad_unit)
    values (p_user, p_local_date, offer.bones, p_source, p_transaction_id, p_ad_unit);
  update public.profiles set bones_balance = bones_balance + offer.bones where id = p_user;
  insert into public.activity_events (user_id, kind, score_points, xp_points, bones_points)
    values (p_user, 'ad_reward', 0, 0, offer.bones);

  return query select true, offer.bones, offer.remaining - 1;
end;
$$;

revoke execute on function public.pay_ad_reward(uuid, date, text, text, text) from public, anon, authenticated;

-- The app's own claim, after the ad says the reward was earned. Refused
-- once Admin has switched to verify_by_server.
create or replace function public.claim_ad_reward(p_local_date date)
returns table (awarded boolean, bones int, remaining int)
language plpgsql
security definer
set search_path = public
as $$
declare
  utc_today date := (now() at time zone 'utc')::date;
begin
  if auth.uid() is null then
    raise exception 'Sign in to do that.';
  end if;
  if p_local_date is null or p_local_date < utc_today - 1 or p_local_date > utc_today + 1 then
    raise exception 'Invalid date.';
  end if;
  if (select s.verify_by_server from public.ad_settings s where s.id) then
    raise exception 'Bones for ads are paid by the server now.';
  end if;
  return query select * from public.pay_ad_reward(auth.uid(), p_local_date, 'app', null, null);
end;
$$;

revoke execute on function public.claim_ad_reward(date) from public, anon;
grant execute on function public.claim_ad_reward(date) to authenticated;

-- Google's signed callback, checked by the admob-reward Edge Function
-- before it calls this with the service role. Pays in either mode: an ad
-- Google vouches for is always real. A local date outside the valid
-- window (or missing) falls back to UTC today.
create or replace function public.credit_ad_reward_verified(
  p_user uuid,
  p_transaction_id text,
  p_ad_unit text,
  p_local_date date
)
returns table (awarded boolean, bones int, remaining int)
language plpgsql
security definer
set search_path = public
as $$
declare
  utc_today date := (now() at time zone 'utc')::date;
  day date := p_local_date;
begin
  if p_transaction_id is null or p_transaction_id = '' then
    raise exception 'A transaction id is required.';
  end if;
  if day is null or day < utc_today - 1 or day > utc_today + 1 then
    day := utc_today;
  end if;
  return query select * from public.pay_ad_reward(p_user, day, 'server', p_transaction_id, p_ad_unit);
end;
$$;

revoke execute on function public.credit_ad_reward_verified(uuid, text, text, date) from public, anon, authenticated;
grant execute on function public.credit_ad_reward_verified(uuid, text, text, date) to service_role;

-- Admin → Rewarded ads: the switches, and how they're doing.
create or replace function public.admin_ad_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'utc')::date;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;
  return (
    select jsonb_build_object(
      'enabled', s.enabled,
      'bones_per_ad', s.bones_per_ad,
      'daily_cap', s.daily_cap,
      'show_to_org_members', s.show_to_org_members,
      'verify_by_server', s.verify_by_server,
      'ios_unit_id', s.ios_unit_id,
      'android_unit_id', s.android_unit_id,
      'today_ads', (select count(*) from public.ad_rewards r where r.created_at >= today),
      'week_ads', (select count(*) from public.ad_rewards r where r.created_at > now() - interval '7 days'),
      'week_people', (select count(distinct r.user_id) from public.ad_rewards r where r.created_at > now() - interval '7 days'),
      'week_bones', (select coalesce(sum(r.bones), 0) from public.ad_rewards r where r.created_at > now() - interval '7 days')
    )
    from public.ad_settings s where s.id
  );
end;
$$;

revoke execute on function public.admin_ad_settings() from public, anon;
grant execute on function public.admin_ad_settings() to authenticated;

create or replace function public.set_ad_settings(
  p_enabled boolean,
  p_bones_per_ad int,
  p_daily_cap int,
  p_show_to_org_members boolean,
  p_verify_by_server boolean,
  p_ios_unit_id text,
  p_android_unit_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;
  if nullif(trim(p_ios_unit_id), '') !~ '^ca-app-pub-[0-9]+/[0-9]+$'
     or nullif(trim(p_android_unit_id), '') !~ '^ca-app-pub-[0-9]+/[0-9]+$' then
    raise exception 'An ad unit id looks like ca-app-pub-1234567890123456/1234567890.';
  end if;
  update public.ad_settings set
    enabled = p_enabled,
    bones_per_ad = p_bones_per_ad,
    daily_cap = p_daily_cap,
    show_to_org_members = p_show_to_org_members,
    verify_by_server = p_verify_by_server,
    ios_unit_id = nullif(trim(p_ios_unit_id), ''),
    android_unit_id = nullif(trim(p_android_unit_id), ''),
    updated_at = now()
  where id;
end;
$$;

revoke execute on function public.set_ad_settings(boolean, int, int, boolean, boolean, text, text) from public, anon;
grant execute on function public.set_ad_settings(boolean, int, int, boolean, boolean, text, text) to authenticated;

-- Undo, if needed:
--   drop function public.set_ad_settings(boolean, int, int, boolean, boolean, text, text);
--   drop function public.admin_ad_settings();
--   drop function public.credit_ad_reward_verified(uuid, text, text, date);
--   drop function public.claim_ad_reward(date);
--   drop function public.pay_ad_reward(uuid, date, text, text, text);
--   drop function public.my_ad_offer(date);
--   drop function public.ad_offer_for(uuid, date);
--   drop table public.ad_rewards;
--   drop table public.ad_settings;
