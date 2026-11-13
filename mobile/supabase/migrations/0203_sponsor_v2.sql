-- Hound: sponsor placements — more places a sponsor can show up on a
-- global challenge, and a report of how often they were seen.
--
-- 0111 gave a sponsor a name, a message and a link, with taps counted.
-- Now, on any global challenge (Golf uses all of them):
--   - a logo (a public Storage bucket admins upload to) and a colour;
--   - "presented by" on the title, Today and the leaderboard;
--   - boards behind every green, and a sponsored hole (0202 pays its
--     Bones), on a Global Golf;
--   - a message once you finish, with a link and its label;
--   - "Prizes from …" with a line of its own.
-- Each placement counts views (once per screen it's on, per person per
-- day) and taps on the link, for Admin's sponsor report. Like 0111,
-- nothing about members goes to the sponsor: the report is counts only.

-- ── The sponsor's placements, on the challenge ──

alter table public.challenges
  add column if not exists sponsor_logo_url text,
  add column if not exists sponsor_color text,
  add column if not exists sponsor_presented boolean not null default false,
  add column if not exists sponsor_boards boolean not null default false,
  add column if not exists sponsor_hole integer,
  add column if not exists sponsor_hole_bones integer,
  add column if not exists sponsor_finish_message text,
  add column if not exists sponsor_finish_label text,
  add column if not exists sponsor_prizes boolean not null default false,
  add column if not exists sponsor_prize_note text;

alter table public.challenges
  drop constraint if exists challenges_sponsor_v2_valid,
  add constraint challenges_sponsor_v2_valid check (
    (sponsor_logo_url is null or (sponsor_logo_url ~ '^https://[^\s]+$' and char_length(sponsor_logo_url) <= 300))
    and (sponsor_color is null or sponsor_color ~ '^#[0-9a-fA-F]{6}$')
    and (sponsor_hole is null or sponsor_hole between 1 and 9)
    and (sponsor_hole_bones is null or sponsor_hole_bones between 0 and 100)
    and (sponsor_finish_message is null or char_length(sponsor_finish_message) between 1 and 120)
    and (sponsor_finish_label is null or char_length(sponsor_finish_label) between 1 and 30)
    and (sponsor_prize_note is null or char_length(sponsor_prize_note) between 1 and 120)
  );

-- Takes every placement off with the sponsor.
create or replace function public.clear_challenge_sponsor(p_challenge_id uuid)
returns void
language sql
security definer set search_path = public
as $$
  update public.challenges set
    sponsor_name = null, sponsor_message = null, sponsor_url = null,
    sponsor_logo_url = null, sponsor_color = null, sponsor_presented = false, sponsor_boards = false,
    sponsor_hole = null, sponsor_hole_bones = null, sponsor_finish_message = null, sponsor_finish_label = null,
    sponsor_prizes = false, sponsor_prize_note = null
  where id = p_challenge_id;
$$;
revoke execute on function public.clear_challenge_sponsor(uuid) from public, anon, authenticated;

-- 0111's, taking the placements off too when the name's cleared.
create or replace function public.set_challenge_sponsor(p_challenge_id uuid, p_name text, p_message text, p_url text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
  v_url text := nullif(btrim(coalesce(p_url, '')), '');
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;
  select * into c from public.challenges x where x.id = p_challenge_id for update;
  if not found or not c.is_global then
    raise exception 'Only a global challenge can have a sponsor.';
  end if;
  if v_name is null then
    perform public.clear_challenge_sponsor(p_challenge_id);
    return;
  end if;
  if char_length(v_name) > 40 then
    raise exception 'Keep the sponsor''s name to 40 characters.';
  end if;
  if v_message is not null and char_length(v_message) > 100 then
    raise exception 'Keep the sponsor''s message to 100 characters.';
  end if;
  if v_url is not null and (v_url !~ '^https://[^\s]+$' or char_length(v_url) > 200) then
    raise exception 'The sponsor''s link must start with https://';
  end if;
  update public.challenges
    set sponsor_name = v_name, sponsor_message = v_message, sponsor_url = v_url
    where id = p_challenge_id;
end;
$$;
revoke execute on function public.set_challenge_sponsor(uuid, text, text, text) from public, anon;
grant execute on function public.set_challenge_sponsor(uuid, text, text, text) to authenticated;

-- The whole sponsor at once (admins): name, message, url, logo_url,
-- color, presented, boards, hole, hole_bones, finish_message,
-- finish_label, prizes, prize_note. A blank name takes it all off.
create or replace function public.set_challenge_sponsor_v2(p_challenge_id uuid, p jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges;
  v_name text := nullif(btrim(coalesce(p ->> 'name', '')), '');
  v_message text := nullif(btrim(coalesce(p ->> 'message', '')), '');
  v_url text := nullif(btrim(coalesce(p ->> 'url', '')), '');
  v_logo text := nullif(btrim(coalesce(p ->> 'logo_url', '')), '');
  v_color text := nullif(btrim(coalesce(p ->> 'color', '')), '');
  v_finish text := nullif(btrim(coalesce(p ->> 'finish_message', '')), '');
  v_label text := nullif(btrim(coalesce(p ->> 'finish_label', '')), '');
  v_note text := nullif(btrim(coalesce(p ->> 'prize_note', '')), '');
  v_hole int := nullif(p ->> 'hole', '')::int;
  v_hole_bones int := coalesce(nullif(p ->> 'hole_bones', '')::int, 5);
begin
  if not exists (select 1 from public.profiles x where x.id = auth.uid() and x.is_admin) then
    raise exception 'not authorized';
  end if;
  select * into c from public.challenges x where x.id = p_challenge_id for update;
  if not found or not c.is_global then
    raise exception 'Only a global challenge can have a sponsor.';
  end if;
  if v_name is null then
    perform public.clear_challenge_sponsor(p_challenge_id);
    return;
  end if;
  if char_length(v_name) > 40 then
    raise exception 'Keep the sponsor''s name to 40 characters.';
  end if;
  if v_message is not null and char_length(v_message) > 100 then
    raise exception 'Keep the sponsor''s message to 100 characters.';
  end if;
  if v_url is not null and (v_url !~ '^https://[^\s]+$' or char_length(v_url) > 200) then
    raise exception 'The sponsor''s link must start with https://';
  end if;
  if v_logo is not null and (v_logo !~ '^https://[^\s]+$' or char_length(v_logo) > 300) then
    raise exception 'The logo must be an https:// link.';
  end if;
  if v_color is not null and v_color !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'The sponsor''s colour is a hex colour like #F08A24.';
  end if;
  if v_hole is not null and (v_hole not between 1 and 9 or c.kind::text <> 'golf') then
    raise exception 'A sponsored hole is 1 to 9, on a Golf challenge.';
  end if;
  if v_hole_bones not between 0 and 100 then
    raise exception 'The hole''s Bones are 0 to 100.';
  end if;
  if v_finish is not null and char_length(v_finish) > 120 then
    raise exception 'Keep the finish message to 120 characters.';
  end if;
  if v_label is not null and char_length(v_label) > 30 then
    raise exception 'Keep the link''s label to 30 characters.';
  end if;
  if v_note is not null and char_length(v_note) > 120 then
    raise exception 'Keep the prize line to 120 characters.';
  end if;
  update public.challenges set
    sponsor_name = v_name, sponsor_message = v_message, sponsor_url = v_url,
    sponsor_logo_url = v_logo, sponsor_color = v_color,
    sponsor_presented = coalesce((p ->> 'presented')::boolean, false),
    sponsor_boards = coalesce((p ->> 'boards')::boolean, false) and c.kind::text = 'golf',
    sponsor_hole = v_hole,
    sponsor_hole_bones = case when v_hole is null then null else v_hole_bones end,
    sponsor_finish_message = v_finish,
    sponsor_finish_label = case when v_finish is null then null else v_label end,
    sponsor_prizes = coalesce((p ->> 'prizes')::boolean, false),
    sponsor_prize_note = v_note
  where id = p_challenge_id;
end;
$$;
revoke execute on function public.set_challenge_sponsor_v2(uuid, jsonb) from public, anon;
grant execute on function public.set_challenge_sponsor_v2(uuid, jsonb) to authenticated;

-- ── Logos: a public bucket; admins upload ──
do $storage$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'No Storage here (a test database): skipping the sponsor-logos bucket.';
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('sponsor-logos', 'sponsor-logos', true, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
  on conflict (id) do update set public = true, file_size_limit = 1048576,
    allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'];
  execute 'drop policy if exists "Sponsor logos: admins add" on storage.objects';
  execute $p$create policy "Sponsor logos: admins add" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'sponsor-logos' and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))$p$;
  execute 'drop policy if exists "Sponsor logos: admins change" on storage.objects';
  execute $p$create policy "Sponsor logos: admins change" on storage.objects
    for update to authenticated
    using (bucket_id = 'sponsor-logos' and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))$p$;
  execute 'drop policy if exists "Sponsor logos: admins remove" on storage.objects';
  execute $p$create policy "Sponsor logos: admins remove" on storage.objects
    for delete to authenticated
    using (bucket_id = 'sponsor-logos' and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))$p$;
  execute 'drop policy if exists "Sponsor logos: everyone reads" on storage.objects';
  execute $p$create policy "Sponsor logos: everyone reads" on storage.objects
    for select using (bucket_id = 'sponsor-logos')$p$;
end;
$storage$;

-- ── Views ──

create table if not exists public.sponsor_views (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  placement text not null check (placement in ('presented', 'today', 'board', 'course', 'hole', 'finish', 'prizes')),
  day date not null,
  views integer not null default 1,
  primary key (challenge_id, user_id, placement, day)
);
create index if not exists sponsor_views_day on public.sponsor_views (day);
alter table public.sponsor_views enable row level security;
revoke all on public.sponsor_views from public, anon, authenticated;

-- The app calls this once per screen a sponsor's on, with the
-- placements it showed. Unknown placements are ignored; a challenge
-- without a sponsor counts nothing.
create or replace function public.record_sponsor_views(p_challenge_id uuid, p_placements text[])
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  if not exists (select 1 from public.challenges c where c.id = p_challenge_id and c.is_global and c.sponsor_name is not null) then
    return;
  end if;
  insert into public.sponsor_views (challenge_id, user_id, placement, day)
  select distinct p_challenge_id, me, x, (now() at time zone 'utc')::date
  from unnest(coalesce(p_placements, array[]::text[])) x
  where x in ('presented', 'today', 'board', 'course', 'hole', 'finish', 'prizes')
  on conflict (challenge_id, user_id, placement, day) do update set views = public.sponsor_views.views + 1;
end;
$$;
revoke execute on function public.record_sponsor_views(uuid, text[]) from public, anon;
grant execute on function public.record_sponsor_views(uuid, text[]) to authenticated;

-- ── Taps, now with where they were ──

alter table public.sponsor_link_clicks add column if not exists placement text;

drop function if exists public.record_sponsor_click(uuid);
create or replace function public.record_sponsor_click(p_challenge_id uuid, p_placement text default null)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  if not exists (select 1 from public.challenges c where c.id = p_challenge_id and c.is_global and c.sponsor_url is not null) then
    return;
  end if;
  if exists (
    select 1 from public.sponsor_link_clicks k
    where k.challenge_id = p_challenge_id and k.user_id = me and k.clicked_at > now() - interval '10 seconds'
  ) then
    return;
  end if;
  insert into public.sponsor_link_clicks (challenge_id, user_id, placement)
  values (p_challenge_id, me,
    case when p_placement in ('presented', 'today', 'board', 'course', 'hole', 'finish', 'prizes') then p_placement end);
end;
$$;
revoke execute on function public.record_sponsor_click(uuid, text) from public, anon;
grant execute on function public.record_sponsor_click(uuid, text) to authenticated;

-- ── Admin: the sponsor report ──

-- One sponsored challenge: who joined, how many people saw the sponsor,
-- views and taps, by placement, and on a Golf the sponsored hole.
create or replace function public.admin_sponsor_report(p_challenge_id uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  v_views bigint;
  v_taps bigint;
  v_hole jsonb;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;
  select * into c from public.challenges where id = p_challenge_id;
  if not found then
    raise exception 'not authorized';
  end if;
  select coalesce(sum(v.views), 0) into v_views from public.sponsor_views v where v.challenge_id = p_challenge_id;
  select count(*) into v_taps from public.sponsor_link_clicks k where k.challenge_id = p_challenge_id;
  if c.kind::text = 'golf' and c.sponsor_hole is not null then
    select jsonb_build_object(
      'hole', c.sponsor_hole,
      'played', (select count(*) from public.golf_shots s where s.challenge_id = p_challenge_id
                 and public.golf_course_no(s.hole) = c.sponsor_hole and s.score is not null),
      'birdies', (select count(*) from public.golf_shots s where s.challenge_id = p_challenge_id
                  and public.golf_course_no(s.hole) = c.sponsor_hole and s.holed and s.score <= s.par - 1),
      'bones', (select coalesce(sum(p.sponsor_bones), 0) from public.golf_players p where p.challenge_id = p_challenge_id))
      into v_hole;
  end if;
  return jsonb_build_object(
    'challenge_id', c.id,
    'name', c.name,
    'sponsor', jsonb_build_object('name', c.sponsor_name, 'logo_url', c.sponsor_logo_url, 'color', c.sponsor_color),
    'starts_at', c.starts_at,
    'ends_at', c.ends_at,
    'players', (select count(*) from public.challenge_participants cp where cp.challenge_id = p_challenge_id),
    'reached', (select count(distinct v.user_id) from public.sponsor_views v where v.challenge_id = p_challenge_id),
    'views', v_views,
    'taps', v_taps,
    'tap_rate', case when v_views > 0 then round(v_taps::numeric / v_views, 3) else 0 end,
    'placements', (select coalesce(jsonb_agg(jsonb_build_object(
        'placement', x.placement, 'views', x.views, 'viewers', x.viewers, 'taps', x.taps) order by x.views desc, x.placement), '[]'::jsonb)
      from (
        select pl.placement,
          (select coalesce(sum(v.views), 0) from public.sponsor_views v where v.challenge_id = p_challenge_id and v.placement = pl.placement) as views,
          (select count(distinct v.user_id) from public.sponsor_views v where v.challenge_id = p_challenge_id and v.placement = pl.placement) as viewers,
          (select count(*) from public.sponsor_link_clicks k where k.challenge_id = p_challenge_id and k.placement = pl.placement) as taps
        from unnest(array['presented', 'today', 'board', 'course', 'hole', 'finish', 'prizes']) pl(placement)
      ) x where x.views > 0 or x.taps > 0),
    'hole', v_hole);
end;
$$;
revoke execute on function public.admin_sponsor_report(uuid) from public, anon;
grant execute on function public.admin_sponsor_report(uuid) to authenticated;

-- Admin → Overview → Sponsors: every sponsored challenge, this week's
-- views, taps and people reached, and the newest 20.
create or replace function public.admin_sponsor_overview()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  since date := (now() at time zone 'utc')::date - 6;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;
  return jsonb_build_object(
    'sponsored_live', (select count(*) from public.challenges c where c.is_global and c.sponsor_name is not null
                       and c.starts_at <= now() and now() < c.ends_at),
    'sponsored_all', (select count(*) from public.challenges c where c.is_global and c.sponsor_name is not null),
    'views_7d', (select coalesce(sum(v.views), 0) from public.sponsor_views v where v.day >= since),
    'taps_7d', (select count(*) from public.sponsor_link_clicks k where k.clicked_at >= now() - interval '7 days'),
    'reached_7d', (select count(distinct v.user_id) from public.sponsor_views v where v.day >= since),
    'challenges', (select coalesce(jsonb_agg(jsonb_build_object(
        'challenge_id', x.id, 'name', x.name, 'kind', x.kind, 'sponsor_name', x.sponsor_name,
        'starts_at', x.starts_at, 'ends_at', x.ends_at,
        'views', (select coalesce(sum(v.views), 0) from public.sponsor_views v where v.challenge_id = x.id),
        'taps', (select count(*) from public.sponsor_link_clicks k where k.challenge_id = x.id))
      order by x.starts_at desc), '[]'::jsonb)
      from (select c.id, c.name, c.kind, c.sponsor_name, c.starts_at, c.ends_at from public.challenges c
            where c.is_global and c.sponsor_name is not null order by c.starts_at desc limit 20) x)
  );
end;
$$;
revoke execute on function public.admin_sponsor_overview() from public, anon;
grant execute on function public.admin_sponsor_overview() to authenticated;

-- Undo, if needed:
--   drop table public.sponsor_views;
--   alter table public.sponsor_link_clicks drop column placement;
--   alter table public.challenges drop column sponsor_logo_url, drop column sponsor_color, ...;
