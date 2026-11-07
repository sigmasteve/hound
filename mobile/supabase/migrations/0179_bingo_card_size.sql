-- Bingo: pick the card's size (3×3, 4×4 or 5×5) whatever the length.
-- Steve's ask: a 5×5 card for a 7-day challenge.
--
-- Until now the size came from the length (0117's hound_bingo_size: 3×3
-- for a week, 4×4 up to 20 days, 5×5 after). challenges.bingo_size, when
-- set, wins; left empty, a card is sized by length as before, so every
-- challenge already running keeps its cards.
--
--   challenges.bingo_size        3, 4 or 5 (hound cards only), or null
--   bingo_card_on_join(),
--   my_bingo_card()              deal that size
--   publish_global_challenge(),
--   publish_community_challenge()  + p_bingo_size (optional, last)
--   bingo_card_drafts, deal_bingo_card_draft()
--                                the creator's card, dealt while they set
--                                the challenge up (they see it, can
--                                shuffle it), and theirs when they join
--
-- Everyone else still gets their own shuffle when they join.
--
-- A friends' challenge sets the column on insert (RLS already lets its
-- creator insert the row). BINGOs are scored from the card itself
-- (0117's hound_bingo_lines), so any size scores the same way.
--
-- Run this once, after 0178, in the SQL Editor, before publishing the
-- app update that goes with it.
--
-- Undo, if needed: re-run bingo_card_on_join and my_bingo_card from 0117,
-- drop deal_bingo_card_draft, hound_bingo_deal and bingo_card_drafts,
-- publish_global_challenge from 0174 and publish_community_challenge from
-- 0152 (dropping these first). The column can stay.

alter table public.challenges
  add column bingo_size smallint check (bingo_size in (3, 4, 5));

-- The size a hound card is dealt at.
create or replace function public.hound_bingo_card_size(p_bingo_size integer, p_days integer)
returns integer
language sql
immutable
as $$
  select coalesce(p_bingo_size, public.hound_bingo_size(p_days));
$$;

revoke execute on function public.hound_bingo_card_size(integer, integer) from public, anon, authenticated;

-- The card a creator sees on the Create screen: dealt here, so it's a
-- real card, and kept (one per person) until they join their new
-- challenge, within a day, at the same size.
create table public.bingo_card_drafts (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  size smallint not null check (size in (3, 4, 5)),
  squares text[] not null,
  created_at timestamptz not null default now()
);

alter table public.bingo_card_drafts enable row level security;
revoke all on public.bingo_card_drafts from anon, authenticated;

create or replace function public.deal_bingo_card_draft(p_size integer)
returns text[]
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  card text[];
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  if p_size is null or p_size not in (3, 4, 5) then
    raise exception 'A Bingo card is 3×3, 4×4 or 5×5.';
  end if;
  card := public.hound_bingo_new_card(p_size);
  insert into public.bingo_card_drafts (user_id, size, squares) values (me, p_size, card)
    on conflict (user_id) do update set size = excluded.size, squares = excluded.squares, created_at = now();
  return card;
end;
$$;

revoke execute on function public.deal_bingo_card_draft(integer) from public, anon;
grant execute on function public.deal_bingo_card_draft(integer) to authenticated;

-- A card for this person in this challenge: the creator's draft when it
-- fits (and it's used up), otherwise a fresh shuffle.
create or replace function public.hound_bingo_deal(p_challenge public.challenges, p_user uuid)
returns text[]
language plpgsql
security definer set search_path = public
as $$
declare
  n integer := public.hound_bingo_card_size(p_challenge.bingo_size, p_challenge.duration_days);
  card text[];
begin
  if p_user = p_challenge.created_by then
    delete from public.bingo_card_drafts d
      where d.user_id = p_user and d.size = n and d.created_at > now() - interval '1 day'
      returning d.squares into card;
  end if;
  return coalesce(card, public.hound_bingo_new_card(n));
end;
$$;

revoke execute on function public.hound_bingo_deal(public.challenges, uuid) from public, anon, authenticated;

-- Deals a card to someone who joins. From 0117, at the chosen size.
create or replace function public.bingo_card_on_join()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges;
begin
  select * into c from public.challenges x where x.id = new.challenge_id;
  if found and c.kind::text = 'bingo' and c.bingo_card_type = 'hound' then
    insert into public.bingo_cards (challenge_id, user_id, squares)
      values (new.challenge_id, new.user_id, public.hound_bingo_deal(c, new.user_id))
      on conflict do nothing;
  end if;
  return null;
end;
$$;

revoke execute on function public.bingo_card_on_join() from public, anon, authenticated;

-- The caller's card. From 0117, at the chosen size.
create or replace function public.my_bingo_card(p_challenge_id uuid)
returns text[]
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  c public.challenges;
  card text[];
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  select * into c from public.challenges x where x.id = p_challenge_id;
  if not found or c.kind::text <> 'bingo' or c.bingo_card_type is distinct from 'hound' then
    raise exception 'That challenge doesn''t deal Bingo cards.';
  end if;
  if not exists (
    select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = me
  ) then
    raise exception 'Join the challenge first.';
  end if;
  insert into public.bingo_cards (challenge_id, user_id, squares)
    values (p_challenge_id, me, public.hound_bingo_deal(c, me))
    on conflict do nothing;
  select b.squares into card from public.bingo_cards b where b.challenge_id = p_challenge_id and b.user_id = me;
  return card;
end;
$$;

revoke execute on function public.my_bingo_card(uuid) from public, anon;
grant execute on function public.my_bingo_card(uuid) to authenticated;

-- From 0174, with p_bingo_size.
drop function public.publish_global_challenge(text, public.challenge_kind, int, timestamptz, timestamptz, int, text, numeric, int, text, text, text);

create or replace function public.publish_global_challenge(
  p_name text,
  p_kind public.challenge_kind,
  p_duration_days int,
  p_starts_at timestamptz,
  p_join_closes_at timestamptz,
  p_daily_goal_steps int default null,
  p_distance_goal_unit text default null,
  p_distance_goal_mi numeric default null,
  p_distance_goal_steps int default null,
  p_bingo_card_type text default null,
  p_course_id text default null,
  p_distance_source text default null,
  -- 0179: the hound card's size (3, 4 or 5), or null to size it by length.
  p_bingo_size int default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  ends timestamptz;
  new_id uuid;
begin
  if p_bingo_size is not null and p_bingo_size not in (3, 4, 5) then
    raise exception 'A Bingo card is 3×3, 4×4 or 5×5.';
  end if;
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Only an admin can publish a global challenge.';
  end if;
  if p_kind not in ('steps', 'streak', 'distance', 'bingo', 'seventyfive', 'journey', 'checklist', 'houndopoly', 'doors', 'packs') then
    raise exception 'That kind of challenge can''t be global — pick Step Race, Daily Streak, Distance, Bingo, 75 Day, Journey, Accountability, Hound''opoly, Daily Doors or Pack Wars.';
  end if;
  if p_duration_days is null or p_duration_days < 1 or p_duration_days > 365 then
    raise exception 'A global challenge runs between 1 and 365 days.';
  end if;
  if p_starts_at is null or p_starts_at < now() - interval '1 day' then
    raise exception 'Pick a start date from today on.';
  end if;
  ends := p_starts_at + make_interval(days => p_duration_days);
  if p_join_closes_at is null or p_join_closes_at <= now() or p_join_closes_at > ends then
    raise exception 'Joining has to close after now and no later than the challenge ends.';
  end if;
  if p_kind = 'packs' and (p_duration_days < 7 or p_duration_days > 30) then
    raise exception 'Pack Wars runs 7 to 30 days.';
  end if;
  if p_kind = 'doors' and (p_duration_days < 3 or p_duration_days > 60) then
    raise exception 'Daily Doors runs 3 to 60 days, a door a day.';
  end if;
  if p_kind = 'streak' and coalesce(p_daily_goal_steps, 0) <= 0 then
    raise exception 'A Daily Streak needs a daily step goal.';
  end if;
  if p_kind = 'distance' and not (
    (p_distance_goal_unit = 'miles' and coalesce(p_distance_goal_mi, 0) > 0)
    or (p_distance_goal_unit = 'steps' and coalesce(p_distance_goal_steps, 0) > 0)
  ) then
    raise exception 'A Distance challenge needs a group target.';
  end if;
  if p_kind = 'journey' and (p_course_id is null or coalesce(p_distance_goal_mi, 0) <= 0) then
    raise exception 'A Journey needs a course.';
  end if;
  if p_distance_source is not null and p_distance_source not in ('workouts', 'all') then
    raise exception 'Miles count from logged workouts or every mile.';
  end if;

  insert into public.challenges (
    name, kind, created_by, duration_days, starts_at, ends_at,
    daily_goal_steps, distance_goal_unit, distance_goal_mi, distance_goal_steps, bingo_card_type, course_id,
    distance_source, bingo_size, is_global, join_closes_at
  ) values (
    trim(p_name), p_kind, auth.uid(), p_duration_days, p_starts_at, ends,
    case when p_kind = 'streak' then p_daily_goal_steps end,
    case when p_kind = 'distance' then p_distance_goal_unit when p_kind = 'journey' then 'miles' end,
    case when (p_kind = 'distance' and p_distance_goal_unit = 'miles') or p_kind = 'journey' then p_distance_goal_mi end,
    case when p_kind = 'distance' and p_distance_goal_unit = 'steps' then p_distance_goal_steps end,
    case when p_kind = 'bingo' then coalesce(p_bingo_card_type, 'variety') end,
    case when p_kind = 'journey' or (p_kind = 'distance' and p_distance_goal_unit = 'miles') then p_course_id end,
    case when p_kind = 'distance' and p_distance_goal_unit = 'miles' then p_distance_source end,
    case when p_kind = 'bingo' and coalesce(p_bingo_card_type, 'variety') = 'hound' then p_bingo_size end,
    true, p_join_closes_at
  )
  returning id into new_id;

  return new_id;
end;
$$;

revoke execute on function public.publish_global_challenge(text, public.challenge_kind, int, timestamptz, timestamptz, int, text, numeric, int, text, text, text, int) from public, anon;
grant execute on function public.publish_global_challenge(text, public.challenge_kind, int, timestamptz, timestamptz, int, text, numeric, int, text, text, text, int) to authenticated;


-- From 0152, with p_bingo_size.
drop function public.publish_community_challenge(text, text, public.challenge_kind, int, timestamptz, timestamptz, boolean, int, text, numeric, int, text, text, text);

create or replace function public.publish_community_challenge(
  p_name text,
  p_description text,
  p_kind public.challenge_kind,
  p_duration_days int,
  p_starts_at timestamptz,
  p_join_closes_at timestamptz,
  p_org_only boolean default false,
  p_daily_goal_steps int default null,
  p_distance_goal_unit text default null,
  p_distance_goal_mi numeric default null,
  p_distance_goal_steps int default null,
  p_bingo_card_type text default null,
  p_course_id text default null,
  p_distance_source text default null,
  -- 0179: the hound card's size (3, 4 or 5), or null to size it by length.
  p_bingo_size int default null
)
returns table (id uuid, join_code text, review_state text)
language plpgsql
security definer set search_path = public
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  cfg public.community_config;
  problem text;
  ends timestamptz;
  new_id uuid;
  code text;
  state text;
  my_org uuid;
  nm text := trim(coalesce(p_name, ''));
  descr text := nullif(trim(coalesce(p_description, '')), '');
begin
  if p_bingo_size is not null and p_bingo_size not in (3, 4, 5) then
    raise exception 'A Bingo card is 3×3, 4×4 or 5×5.';
  end if;
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  select * into cfg from public.community_config;
  problem := public.community_publish_problem(me);
  if problem is not null then
    raise exception '%', problem;
  end if;
  if cfg.age_gate and not exists (select 1 from public.community_age_ok a where a.user_id = me) then
    raise exception 'Confirm you''re 13 or older first.';
  end if;
  if p_kind not in ('steps', 'streak', 'distance', 'bingo', 'seventyfive', 'journey', 'checklist', 'houndopoly') then
    raise exception 'That kind of challenge can''t be a community challenge.';
  end if;
  if char_length(nm) < 1 or char_length(nm) > 40 then
    raise exception 'Give it a name of up to 40 characters.';
  end if;
  if char_length(coalesce(descr, '')) > 120 then
    raise exception 'Keep the description to 120 characters.';
  end if;
  problem := coalesce(public.community_words_problem(nm), public.community_words_problem(descr));
  if problem is not null then
    raise exception '%', problem;
  end if;
  if p_kind = 'seventyfive' then
    if p_duration_days <> 75 then
      raise exception 'A 75 Day Challenge runs 75 days.';
    end if;
  elsif p_duration_days is null or p_duration_days < 3 or p_duration_days > 30 then
    raise exception 'A community challenge runs 3 to 30 days.';
  end if;
  if p_starts_at is null or p_starts_at < now() - interval '1 day' or p_starts_at > now() + interval '15 days' then
    raise exception 'Pick a start date in the next two weeks.';
  end if;
  ends := p_starts_at + make_interval(days => p_duration_days);
  if p_join_closes_at is null or p_join_closes_at <= now() or p_join_closes_at > ends then
    raise exception 'Joining has to close after now and no later than the challenge ends.';
  end if;
  if p_kind = 'streak' and coalesce(p_daily_goal_steps, 0) <= 0 then
    raise exception 'A Daily Streak needs a daily step goal.';
  end if;
  if p_kind = 'distance' and not (
    (p_distance_goal_unit = 'miles' and coalesce(p_distance_goal_mi, 0) > 0)
    or (p_distance_goal_unit = 'steps' and coalesce(p_distance_goal_steps, 0) > 0)
  ) then
    raise exception 'A Distance challenge needs a group target.';
  end if;
  if p_kind = 'journey' and (p_course_id is null or coalesce(p_distance_goal_mi, 0) <= 0) then
    raise exception 'A Journey needs a course.';
  end if;
  if p_distance_source is not null and p_distance_source not in ('workouts', 'all') then
    raise exception 'Miles count from logged workouts or every mile.';
  end if;
  if (
    select count(*) from public.challenges c
    where c.created_by = me and c.community and c.ends_at > now() and c.review_state <> 'removed'
  ) >= cfg.max_live then
    raise exception 'You have % community challenges running. Wait for one to end first.', cfg.max_live;
  end if;
  if (
    select count(*) from public.challenges c
    where c.created_by = me and c.community and c.created_at > now() - interval '7 days'
  ) >= cfg.max_per_week then
    raise exception 'You''ve published % this week. Try again in a few days.', cfg.max_per_week;
  end if;
  if p_org_only then
    select p.organization_id into my_org from public.profiles p where p.id = me;
    if my_org is null then
      raise exception 'You''re not in an organization.';
    end if;
  end if;

  code := public.community_new_code();
  state := case when cfg.pre_review then 'pending' else 'listed' end;
  insert into public.challenges (
    name, kind, created_by, duration_days, starts_at, ends_at,
    daily_goal_steps, distance_goal_unit, distance_goal_mi, distance_goal_steps, bingo_card_type, course_id,
    distance_source, bingo_size, is_global, join_closes_at, organization_id,
    community, join_code, description, review_state
  ) values (
    nm, p_kind, me, p_duration_days, p_starts_at, ends,
    case when p_kind = 'streak' then p_daily_goal_steps end,
    case when p_kind = 'distance' then p_distance_goal_unit when p_kind = 'journey' then 'miles' end,
    case when (p_kind = 'distance' and p_distance_goal_unit = 'miles') or p_kind = 'journey' then p_distance_goal_mi end,
    case when p_kind = 'distance' and p_distance_goal_unit = 'steps' then p_distance_goal_steps end,
    case when p_kind = 'bingo' then coalesce(p_bingo_card_type, 'variety') end,
    case when p_kind = 'journey' or (p_kind = 'distance' and p_distance_goal_unit = 'miles') then p_course_id end,
    case when p_kind = 'distance' and p_distance_goal_unit = 'miles' then p_distance_source end,
    case when p_kind = 'bingo' and coalesce(p_bingo_card_type, 'variety') = 'hound' then p_bingo_size end,
    false, p_join_closes_at, my_org,
    true, code, descr, state
  )
  returning challenges.id into new_id;
  insert into public.challenge_participants (challenge_id, user_id) values (new_id, me)
    on conflict (challenge_id, user_id) do nothing;
  return query select new_id, code, state;
end;
$$;
revoke execute on function public.publish_community_challenge(text, text, public.challenge_kind, int, timestamptz, timestamptz, boolean, int, text, numeric, int, text, text, text, int) from public, anon;
grant execute on function public.publish_community_challenge(text, text, public.challenge_kind, int, timestamptz, timestamptz, boolean, int, text, numeric, int, text, text, text, int) to authenticated;

