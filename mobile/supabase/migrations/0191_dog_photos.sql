-- Hound: your dog as your avatar, and a hound that looks like your dog
-- (Steve: "how could we have users submit/upload a picture of their own
-- dog/puppy to use as the avatar"; friends only, an automatic check plus
-- reports, and admins can block someone from uploading).
--
-- How a photo goes:
--   1. The app (1.2.0, which has the photo picker) sends a small square
--      photo to the dog-photo function (supabase/functions/dog-photo).
--   2. The function asks Claude whether it's a dog and appropriate, and
--      what the dog looks like, then calls dog_photo_checked. A photo
--      that passes is stored as 'pending'; nobody else can see it.
--   3. "Use as my avatar" (dog_photo_use) makes it 'active'. Its token
--      goes on the end of the hound avatar code in equipped_icon_id:
--        hound:<coat>.<ears>.<tail>.<markings>.<neck>.<head>.<face>.<breed>.~<token>
--      Older builds read the first eight parts and draw the hound, so
--      everyone who can't see the photo sees the hound.
--   4. friend_dog_photos() gives each phone the tokens and files of its
--      own and its friends' photos, and Storage only serves a file to
--      its owner, their friends and admins (can_see_dog_photo). Everyone
--      else sees the hound.
--   5. Friends can report a photo. Three people reporting it hide it
--      ('hidden') until an admin keeps or removes it. Admins can also
--      block someone from uploading, for a while or for good.
--
-- Uploads and deletes happen in the function with the service role;
-- nobody writes these tables or the bucket directly.
--
-- Run once, after 0190, in the SQL Editor. It creates the private
-- 'dog-photos' bucket and its read rule when Storage is there.

create table if not exists public.dog_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  path text not null unique,
  token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  -- pending: checked, not chosen · active: the avatar · hidden: reported,
  -- waiting for an admin · removed: by an admin · retired: replaced or
  -- stopped by its owner · discarded: checked but never used
  status text not null default 'pending' check (status in ('pending', 'active', 'hidden', 'removed', 'retired', 'discarded')),
  checked jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete set null,
  purged_at timestamptz
);
create unique index if not exists dog_photos_one_live on public.dog_photos (user_id) where status in ('active', 'hidden');
create index if not exists dog_photos_user on public.dog_photos (user_id, created_at desc);

-- Every check, passed or not, for the daily limit and Admin's numbers.
create table if not exists public.dog_photo_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  ok boolean not null,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists dog_photo_attempts_user on public.dog_photo_attempts (user_id, created_at desc);

create table if not exists public.dog_photo_reports (
  photo_id uuid not null references public.dog_photos (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reason text check (reason is null or char_length(reason) <= 200),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  primary key (photo_id, reporter_id)
);

create table if not exists public.dog_photo_blocks (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  until timestamptz not null,
  blocked_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Each time someone gives their hound the look from a photo.
create table if not exists public.dog_look_applied (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.dog_photos enable row level security;
alter table public.dog_photo_attempts enable row level security;
alter table public.dog_photo_reports enable row level security;
alter table public.dog_photo_blocks enable row level security;
alter table public.dog_look_applied enable row level security;
revoke all on public.dog_photos, public.dog_photo_attempts, public.dog_photo_reports, public.dog_photo_blocks, public.dog_look_applied from anon, authenticated;

-- How many checks a day, and how many reports hide a photo.
create or replace function public.dog_photo_limits()
returns jsonb
language sql
immutable
as $$ select jsonb_build_object('tries_per_day', 5, 'reports_to_hide', 3) $$;
revoke execute on function public.dog_photo_limits() from public, anon, authenticated;

create or replace function public.dog_photo_is_admin()
returns boolean
language sql
stable
security definer set search_path = public
as $$ select exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) $$;
revoke execute on function public.dog_photo_is_admin() from public, anon, authenticated;

create or replace function public.dog_photo_are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.requester_id = a and f.recipient_id = b) or (f.requester_id = b and f.recipient_id = a))
  )
$$;
revoke execute on function public.dog_photo_are_friends(uuid, uuid) from public, anon, authenticated;

-- The hound avatar code, with the active photo's token on the end.
create or replace function public.kennel_avatar_code(p_user uuid)
returns text
language sql
stable
security definer set search_path = public
as $$
  select 'hound:' || concat_ws('.',
    coalesce(k.coat_id, ''), coalesce(k.ears, 'floppy'), coalesce(k.tail, 'wavy'), coalesce(k.markings, 'none'),
    coalesce(k.neck_id, ''), coalesce(k.head_id, ''), coalesce(k.face_id, ''),
    case when ph.token is not null then coalesce(k.breed_id, '') else k.breed_id end,
    case when ph.token is not null then '~' || ph.token end)
  from (select 1) one
  left join public.kennels k on k.user_id = p_user
  left join public.dog_photos ph on ph.user_id = p_user and ph.status = 'active';
$$;
revoke execute on function public.kennel_avatar_code(uuid) from public, anon, authenticated;

-- After a photo changes: an avatar that's a hound (with or without a
-- photo) is redrawn from the kennel and the active photo. An icon from
-- the Locker stays.
create or replace function public.dog_photo_refresh_avatar(p_user uuid)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  code text := public.kennel_avatar_code(p_user);
begin
  update public.profiles p set equipped_icon_id = code
   where p.id = p_user and p.equipped_icon_id like 'hound:%';
  return code;
end;
$$;
revoke execute on function public.dog_photo_refresh_avatar(uuid) from public, anon, authenticated;

-- Blocked until (null when not blocked).
create or replace function public.dog_photo_blocked_until(p_user uuid)
returns timestamptz
language sql
stable
security definer set search_path = public
as $$ select b.until from public.dog_photo_blocks b where b.user_id = p_user and b.until > now() $$;
revoke execute on function public.dog_photo_blocked_until(uuid) from public, anon, authenticated;

-- ── Called by the dog-photo function (service role) ──

-- Before a check: null to go ahead, else what to tell them.
create or replace function public.dog_photo_may_try(p_user uuid)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  tries int;
begin
  if public.dog_photo_blocked_until(p_user) is not null then
    return 'Photo uploads are off for your account.';
  end if;
  select count(*) into tries from public.dog_photo_attempts a where a.user_id = p_user and a.created_at > now() - interval '24 hours';
  if tries >= (public.dog_photo_limits() ->> 'tries_per_day')::int then
    return 'You''ve tried a few photos today. Try again tomorrow.';
  end if;
  return null;
end;
$$;
revoke execute on function public.dog_photo_may_try(uuid) from public, anon, authenticated;
grant execute on function public.dog_photo_may_try(uuid) to service_role;

-- After a check. A photo that passed is stored as pending (any earlier
-- pending one is discarded). Returns the new photo's id, or null.
create or replace function public.dog_photo_checked(p_user uuid, p_ok boolean, p_reason text, p_path text, p_checked jsonb)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.dog_photo_attempts (user_id, ok, reason) values (p_user, coalesce(p_ok, false), left(p_reason, 200));
  if not coalesce(p_ok, false) or p_path is null then
    return null;
  end if;
  update public.dog_photos d set status = 'discarded' where d.user_id = p_user and d.status = 'pending';
  insert into public.dog_photos (user_id, path, checked) values (p_user, p_path, coalesce(p_checked, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.dog_photo_checked(uuid, boolean, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.dog_photo_checked(uuid, boolean, text, text, jsonb) to service_role;

-- Files no longer needed (discarded, retired, removed), to delete from
-- Storage; marked as gone once returned.
create or replace function public.dog_photo_take_purgeable(p_user uuid)
returns setof text
language sql
security definer set search_path = public
as $$
  update public.dog_photos d set purged_at = now()
   where d.user_id = p_user and d.purged_at is null and d.status in ('discarded', 'retired', 'removed')
  returning d.path;
$$;
revoke execute on function public.dog_photo_take_purgeable(uuid) from public, anon, authenticated;
grant execute on function public.dog_photo_take_purgeable(uuid) to service_role;

-- ── The owner ──

-- Settings → Your avatar: the photo in use or waiting, and whether
-- uploads are open.
create or replace function public.my_dog_photo()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  d public.dog_photos;
  tries int;
begin
  if me is null then
    raise exception 'not authorized';
  end if;
  select * into d from public.dog_photos x
   where x.user_id = me and x.status in ('active', 'hidden', 'pending')
   order by (x.status = 'pending'), x.created_at desc limit 1;
  select count(*) into tries from public.dog_photo_attempts a where a.user_id = me and a.created_at > now() - interval '24 hours';
  return jsonb_build_object(
    'photo_id', d.id,
    'status', d.status,
    'path', d.path,
    'token', d.token,
    'checked', d.checked,
    'blocked_until', public.dog_photo_blocked_until(me),
    'tries_left', greatest(0, (public.dog_photo_limits() ->> 'tries_per_day')::int - tries)
  );
end;
$$;
revoke execute on function public.my_dog_photo() from public, anon;
grant execute on function public.my_dog_photo() to authenticated;

-- "Use as my avatar".
create or replace function public.dog_photo_use(p_photo uuid)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not authorized';
  end if;
  if public.dog_photo_blocked_until(me) is not null then
    raise exception 'Photo uploads are off for your account.';
  end if;
  if not exists (select 1 from public.dog_photos d where d.id = p_photo and d.user_id = me and d.status = 'pending') then
    raise exception 'That photo isn''t ready. Pick it again.';
  end if;
  if exists (select 1 from public.dog_photos d where d.user_id = me and d.status = 'hidden') then
    raise exception 'Your last photo is being looked at. Try again once it''s done.';
  end if;
  update public.dog_photos d set status = 'retired' where d.user_id = me and d.status = 'active';
  update public.dog_photos d set status = 'active', activated_at = now() where d.id = p_photo;
  update public.profiles p set equipped_icon_id = public.kennel_avatar_code(me) where p.id = me;
  return public.kennel_avatar_code(me);
end;
$$;
revoke execute on function public.dog_photo_use(uuid) from public, anon;
grant execute on function public.dog_photo_use(uuid) to authenticated;

-- Back to the hound (or keep the photo but switch to an icon: equipping
-- an icon already replaces the code).
create or replace function public.dog_photo_stop()
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not authorized';
  end if;
  update public.dog_photos d set status = 'retired' where d.user_id = me and d.status in ('active', 'pending');
  return public.dog_photo_refresh_avatar(me);
end;
$$;
revoke execute on function public.dog_photo_stop() from public, anon;
grant execute on function public.dog_photo_stop() to authenticated;

-- The look from a photo went onto the hound (Admin's count).
create or replace function public.dog_look_was_applied()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is not null then
    insert into public.dog_look_applied (user_id) values (auth.uid());
  end if;
end;
$$;
revoke execute on function public.dog_look_was_applied() from public, anon;
grant execute on function public.dog_look_was_applied() to authenticated;

-- ── Seeing photos: you, your friends, admins ──

create or replace function public.can_see_dog_photo(p_path text)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.dog_photos d
    where d.path = p_path
      and (
        d.user_id = auth.uid()
        or public.dog_photo_is_admin()
        or (d.status = 'active' and public.dog_photo_are_friends(d.user_id, auth.uid()))
      )
  )
$$;
revoke execute on function public.can_see_dog_photo(text) from public, anon;
grant execute on function public.can_see_dog_photo(text) to authenticated;

-- Your own and your friends' photos in use: the token in their avatar
-- code, and the file to show.
create or replace function public.friend_dog_photos()
returns table (user_id uuid, token text, path text)
language sql
stable
security definer set search_path = public
as $$
  select d.user_id, d.token, d.path
  from public.dog_photos d
  where d.status = 'active'
    and (d.user_id = auth.uid() or public.dog_photo_are_friends(d.user_id, auth.uid()))
$$;
revoke execute on function public.friend_dog_photos() from public, anon;
grant execute on function public.friend_dog_photos() to authenticated;

-- A friend reports a photo. Enough people reporting it hides it until
-- an admin looks.
create or replace function public.report_dog_photo(p_user uuid, p_reason text default null)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  d public.dog_photos;
  open_reports int;
begin
  if me is null then
    raise exception 'not authorized';
  end if;
  select * into d from public.dog_photos x where x.user_id = p_user and x.status = 'active';
  if d.id is null then
    return;
  end if;
  if p_user = me or not public.dog_photo_are_friends(p_user, me) then
    raise exception 'You can only report a friend''s photo.';
  end if;
  insert into public.dog_photo_reports (photo_id, reporter_id, reason)
  values (d.id, me, nullif(left(trim(coalesce(p_reason, '')), 200), ''))
  on conflict (photo_id, reporter_id) do update set reason = excluded.reason, created_at = now(), resolved_at = null;
  select count(*) into open_reports from public.dog_photo_reports r where r.photo_id = d.id and r.resolved_at is null;
  if open_reports >= (public.dog_photo_limits() ->> 'reports_to_hide')::int then
    update public.dog_photos x set status = 'hidden' where x.id = d.id;
    perform public.dog_photo_refresh_avatar(p_user);
  end if;
end;
$$;
revoke execute on function public.report_dog_photo(uuid, text) from public, anon;
grant execute on function public.report_dog_photo(uuid, text) to authenticated;

-- ── Admin ──

create or replace function public.admin_dog_photos_overview()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.dog_photo_is_admin() then
    raise exception 'not authorized';
  end if;
  return jsonb_build_object(
    'using_now', (select count(*) from public.dog_photos d where d.status = 'active'),
    'tried', (select count(distinct a.user_id) from public.dog_photo_attempts a),
    'checks_7d', (select count(*) from public.dog_photo_attempts a where a.created_at > now() - interval '7 days'),
    'turned_down_7d', (select count(*) from public.dog_photo_attempts a where not a.ok and a.created_at > now() - interval '7 days'),
    'looks_applied', (select count(*) from public.dog_look_applied),
    'looks_people', (select count(distinct l.user_id) from public.dog_look_applied l),
    'blocked', (select count(*) from public.dog_photo_blocks b where b.until > now()),
    'to_review', (
      select count(distinct d.id) from public.dog_photos d
      join public.dog_photo_reports r on r.photo_id = d.id and r.resolved_at is null
      where d.status in ('active', 'hidden')
    ),
    'reported', coalesce((
      select jsonb_agg(x order by x.hidden desc, x.reports desc, x.last_at desc)
      from (
        select d.id as photo_id, d.user_id, p.name, d.path, d.status = 'hidden' as hidden, d.checked,
               count(*) as reports, max(r.created_at) as last_at,
               array_remove(array_agg(distinct r.reason), null) as reasons
        from public.dog_photos d
        join public.dog_photo_reports r on r.photo_id = d.id and r.resolved_at is null
        join public.profiles p on p.id = d.user_id
        where d.status in ('active', 'hidden')
        group by d.id, p.name
        limit 50
      ) x
    ), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.admin_dog_photos_overview() from public, anon;
grant execute on function public.admin_dog_photos_overview() to authenticated;

-- Block (p_days > 0, or -1 for good) or unblock (0) someone's uploads.
-- Blocking also takes their photo down.
create or replace function public.admin_block_dog_uploads(p_user uuid, p_days integer)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.dog_photo_is_admin() then
    raise exception 'not authorized';
  end if;
  if p_days = 0 then
    delete from public.dog_photo_blocks b where b.user_id = p_user;
    return;
  end if;
  insert into public.dog_photo_blocks (user_id, until, blocked_by)
  values (p_user, case when p_days < 0 then 'infinity'::timestamptz else now() + make_interval(days => p_days) end, auth.uid())
  on conflict (user_id) do update set until = excluded.until, blocked_by = excluded.blocked_by, created_at = now();
  update public.dog_photos d set status = 'removed', reviewed_at = now(), reviewed_by = auth.uid()
   where d.user_id = p_user and d.status in ('active', 'hidden', 'pending');
  update public.dog_photo_reports r set resolved_at = now()
   where r.resolved_at is null and r.photo_id in (select d.id from public.dog_photos d where d.user_id = p_user);
  perform public.dog_photo_refresh_avatar(p_user);
end;
$$;
revoke execute on function public.admin_block_dog_uploads(uuid, integer) from public, anon;
grant execute on function public.admin_block_dog_uploads(uuid, integer) to authenticated;

-- A reported photo: keep it (back on show) or remove it, and optionally
-- block uploads too (p_block_days as above; null for no block).
create or replace function public.admin_review_dog_photo(p_photo uuid, p_keep boolean, p_block_days integer default null)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  d public.dog_photos;
begin
  if not public.dog_photo_is_admin() then
    raise exception 'not authorized';
  end if;
  select * into d from public.dog_photos x where x.id = p_photo;
  if d.id is null then
    raise exception 'That photo is gone.';
  end if;
  update public.dog_photo_reports r set resolved_at = now() where r.photo_id = p_photo and r.resolved_at is null;
  if p_keep then
    update public.dog_photos x set status = 'active', reviewed_at = now(), reviewed_by = auth.uid()
     where x.id = p_photo and x.status = 'hidden';
  else
    update public.dog_photos x set status = 'removed', reviewed_at = now(), reviewed_by = auth.uid() where x.id = p_photo;
  end if;
  perform public.dog_photo_refresh_avatar(d.user_id);
  if not p_keep and p_block_days is not null and p_block_days <> 0 then
    perform public.admin_block_dog_uploads(d.user_id, p_block_days);
  end if;
end;
$$;
revoke execute on function public.admin_review_dog_photo(uuid, boolean, integer) from public, anon;
grant execute on function public.admin_review_dog_photo(uuid, boolean, integer) to authenticated;

-- A person's Admin page: their photo history and any block.
create or replace function public.admin_user_dog_photo(p_user uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.dog_photo_is_admin() then
    raise exception 'not authorized';
  end if;
  return jsonb_build_object(
    'status', (select d.status from public.dog_photos d where d.user_id = p_user and d.status in ('active', 'hidden') limit 1),
    'path', (select d.path from public.dog_photos d where d.user_id = p_user and d.status in ('active', 'hidden') limit 1),
    'blocked_until', public.dog_photo_blocked_until(p_user),
    'turned_down', (select count(*) from public.dog_photo_attempts a where a.user_id = p_user and not a.ok),
    'removed', (select count(*) from public.dog_photos d where d.user_id = p_user and d.status = 'removed')
  );
end;
$$;
revoke execute on function public.admin_user_dog_photo(uuid) from public, anon;
grant execute on function public.admin_user_dog_photo(uuid) to authenticated;

-- ── Storage: a private bucket; only can_see_dog_photo reads a file ──
do $storage$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'No Storage here (a test database): skipping the dog-photos bucket.';
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('dog-photos', 'dog-photos', false, 512000, array['image/jpeg'])
  on conflict (id) do update set public = false, file_size_limit = 512000, allowed_mime_types = array['image/jpeg'];
  execute 'drop policy if exists "Dog photos: owner, friends and admins read" on storage.objects';
  execute $p$create policy "Dog photos: owner, friends and admins read" on storage.objects
    for select to authenticated
    using (bucket_id = 'dog-photos' and public.can_see_dog_photo(name))$p$;
end;
$storage$;

-- Undo, if needed:
--   update public.profiles set equipped_icon_id = regexp_replace(equipped_icon_id, '\.~[0-9a-f]+$', '') where equipped_icon_id like '%.~%';
--   drop table public.dog_photo_reports, public.dog_photo_attempts, public.dog_photo_blocks, public.dog_look_applied, public.dog_photos;
--   (and 0132's kennel_avatar_code)
