-- Hound: H-O-R-S-E — one on one, on steps. See 0194 for the enum value
-- and 0195 for Hoops (this also pays both games and gives Admin their
-- numbers).
--
-- One player sets a shot, the other has to match it:
--
--   shots    Layup 6,000 · Free throw 8,000 · Three 10,000 · Hook shot
--            12,000 · Half-court 15,000 (steps in the day)
--   setter   the creator first. Picks the shot (sticky; a Three to
--            start). At the end of the day: walked the target, it's made,
--            and the other has to walk it too or takes the next letter.
--            Missed: no letter, and the other sets tomorrow. Made: the
--            setter keeps setting.
--   the end  someone spells the word (HORSE, or PIG for a short one), or
--            the last day comes and fewer letters wins; level is a tie.
--
-- Days play the morning after, like Hoops and Soccer. Nothing happens on
-- a day before the second player has joined. The winner gets Hoops'
-- win Bones (hoops_config), both get the play Bones.
--
-- Run this once, after 0195, in the SQL Editor.

create table public.horse_games (
  challenge_id uuid primary key references public.challenges (id) on delete cascade,
  word text not null default 'HORSE' check (word in ('HORSE', 'PIG')),
  setter uuid not null references public.profiles (id),
  shot text not null default 'three' check (shot in ('layup', 'free_throw', 'three', 'hook', 'half_court')),
  letters jsonb not null default '{}'::jsonb,
  days_played int not null default 0,
  status text not null default 'active' check (status in ('active', 'final')),
  winner uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);
alter table public.horse_games enable row level security;
revoke all on public.horse_games from anon;
revoke insert, update, delete on public.horse_games from authenticated;
create policy "Players can view their H-O-R-S-E game"
  on public.horse_games for select to authenticated
  using (exists (select 1 from public.challenge_participants cp where cp.challenge_id = horse_games.challenge_id and cp.user_id = auth.uid()));

create table public.horse_days (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  day date not null,
  day_no int not null,
  setter uuid not null,
  matcher uuid not null,
  shot text not null,
  target int not null,
  setter_steps int not null,
  made boolean not null,
  matcher_steps int,
  matched boolean,
  letter_to uuid,
  resolved_at timestamptz not null default now(),
  primary key (challenge_id, day)
);
alter table public.horse_days enable row level security;
revoke all on public.horse_days from anon;
revoke insert, update, delete on public.horse_days from authenticated;
create policy "Players can view their H-O-R-S-E days"
  on public.horse_days for select to authenticated
  using (exists (select 1 from public.challenge_participants cp where cp.challenge_id = horse_days.challenge_id and cp.user_id = auth.uid()));

create or replace function public.horse_shots()
returns jsonb
language sql
immutable
as $$
  select '[{"id":"layup","name":"Layup","target":6000},{"id":"free_throw","name":"Free throw","target":8000},{"id":"three","name":"Three","target":10000},{"id":"hook","name":"Hook shot","target":12000},{"id":"half_court","name":"Half-court","target":15000}]'::jsonb;
$$;
revoke execute on function public.horse_shots() from public, anon, authenticated;

create or replace function public.horse_target(p_shot text)
returns int
language sql
immutable
as $$
  select (s ->> 'target')::int from jsonb_array_elements(public.horse_shots()) s where s ->> 'id' = p_shot;
$$;
revoke execute on function public.horse_target(text) from public, anon, authenticated;

create or replace function public.horse_shot_name(p_shot text)
returns text
language sql
immutable
as $$
  select s ->> 'name' from jsonb_array_elements(public.horse_shots()) s where s ->> 'id' = p_shot;
$$;
revoke execute on function public.horse_shot_name(text) from public, anon, authenticated;

create or replace function public.horse_letter_count(p_game public.horse_games, p_user uuid)
returns int
language sql
immutable
as $$
  select coalesce((p_game.letters ->> p_user::text)::int, 0);
$$;
revoke execute on function public.horse_letter_count(public.horse_games, uuid) from public, anon, authenticated;

create or replace function public.horse_setup(p_challenge_id uuid, p_word text default 'HORSE')
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
begin
  select * into c from public.challenges where id = p_challenge_id;
  if not found or c.kind::text <> 'horse' or c.created_by is distinct from auth.uid() then
    raise exception 'Only whoever made this game can set it up.';
  end if;
  if not (public.hoops_cfg()).enabled then
    raise exception 'Hoops is paused right now.';
  end if;
  if coalesce(p_word, 'HORSE') not in ('HORSE', 'PIG') then
    raise exception 'Play to HORSE or PIG.';
  end if;
  if c.duration_days < 3 or c.duration_days > 14 then
    raise exception 'A game of H-O-R-S-E is 3 to 14 days.';
  end if;
  if exists (select 1 from public.horse_games g where g.challenge_id = p_challenge_id) then
    raise exception 'This game is already set up.';
  end if;
  insert into public.horse_games (challenge_id, word, setter) values (p_challenge_id, coalesce(p_word, 'HORSE'), auth.uid());
end;
$$;
revoke execute on function public.horse_setup(uuid, text) from public, anon;
grant execute on function public.horse_setup(uuid, text) to authenticated;

-- One on one: a third person can't join.
create or replace function public.horse_before_join()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.challenges c where c.id = new.challenge_id and c.kind::text = 'horse') then
    return new;
  end if;
  if (select count(*) from public.challenge_participants cp where cp.challenge_id = new.challenge_id and cp.user_id <> new.user_id) >= 2 then
    raise exception 'H-O-R-S-E is one on one.';
  end if;
  if exists (select 1 from public.horse_games g where g.challenge_id = new.challenge_id and g.status <> 'active') then
    raise exception 'This game is over.';
  end if;
  return new;
end;
$$;
revoke execute on function public.horse_before_join() from public, anon, authenticated;
create trigger horse_before_join
  before insert on public.challenge_participants
  for each row execute procedure public.horse_before_join();

create or replace function public.horse_set_shot(p_challenge_id uuid, p_shot text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  g public.horse_games%rowtype;
begin
  select * into g from public.horse_games where challenge_id = p_challenge_id;
  if not found or not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = auth.uid()) then
    raise exception 'You''re not playing in this game.';
  end if;
  if g.status <> 'active' then
    raise exception 'This game is over.';
  end if;
  if g.setter is distinct from auth.uid() then
    raise exception 'It''s their shot to set today.';
  end if;
  if public.horse_target(p_shot) is null then
    raise exception 'Pick a layup, a free throw, a three, a hook shot or half-court.';
  end if;
  update public.horse_games set shot = p_shot, updated_at = now() where challenge_id = p_challenge_id;
end;
$$;
revoke execute on function public.horse_set_shot(uuid, text) from public, anon;
grant execute on function public.horse_set_shot(uuid, text) to authenticated;

create or replace function public.horse_name(p_user uuid)
returns text
language sql
stable
security definer set search_path = public
as $$
  select coalesce((select case when p.use_username and p.username is not null then p.username else p.name end from public.profiles p where p.id = p_user), 'Someone');
$$;
revoke execute on function public.horse_name(uuid) from public, anon, authenticated;

-- Plays every day that's over everywhere, the morning after (Soccer's
-- rule), until someone spells the word or the last day's played.
create or replace function public.horse_advance(p_challenge_id uuid)
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  g public.horse_games%rowtype;
  caller uuid := auth.uid();
  first_day date;
  last_day date;
  cutoff date;
  d date;
  other uuid;
  target int;
  s_steps int;
  m_steps int;
  made boolean;
  matched boolean;
  letter uuid;
  n int := 0;
  wlen int;
  r record;
  extra jsonb;
  p_a uuid;
  p_b uuid;
begin
  select * into c from public.challenges where id = p_challenge_id for update;
  if not found or c.kind::text <> 'horse' then
    return 0;
  end if;
  if caller is not null and not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = caller) then
    return 0;
  end if;
  select * into g from public.horse_games where challenge_id = p_challenge_id;
  if not found or g.status <> 'active' then
    return 0;
  end if;
  first_day := public.soccer_first_day(c);
  last_day := first_day + c.duration_days - 1;
  cutoff := (now() at time zone 'utc')::date - case when extract(hour from now() at time zone 'utc') >= 11 then 1 else 2 end;
  wlen := length(g.word);

  loop
    d := first_day + g.days_played;
    exit when d > cutoff or d > last_day;
    select cp.user_id into other from public.challenge_participants cp
      where cp.challenge_id = p_challenge_id and cp.user_id <> g.setter limit 1;
    if other is not null then
      target := public.horse_target(g.shot);
      s_steps := coalesce((select ps.steps from public.progress_snapshots ps where ps.challenge_id = p_challenge_id and ps.user_id = g.setter and ps.day = d), 0);
      m_steps := coalesce((select ps.steps from public.progress_snapshots ps where ps.challenge_id = p_challenge_id and ps.user_id = other and ps.day = d), 0);
      made := s_steps >= target;
      matched := case when made then m_steps >= target end;
      letter := case when made and not matched then other end;
      insert into public.horse_days (challenge_id, day, day_no, setter, matcher, shot, target, setter_steps, made, matcher_steps, matched, letter_to)
        values (p_challenge_id, d, g.days_played + 1, g.setter, other, g.shot, target, s_steps, made, case when made then m_steps end, matched, letter);
      update public.horse_games set
        days_played = days_played + 1,
        letters = case when letter is null then letters
                       else letters || jsonb_build_object(letter::text, public.horse_letter_count(g, letter) + 1) end,
        setter = case when made then setter else other end,
        updated_at = now()
        where challenge_id = p_challenge_id;
      n := n + 1;
    else
      -- Nobody to play yet: the day passes.
      update public.horse_games set days_played = days_played + 1, updated_at = now() where challenge_id = p_challenge_id;
    end if;
    select * into g from public.horse_games where challenge_id = p_challenge_id;

    select min(cp.user_id::text)::uuid, max(cp.user_id::text)::uuid into p_a, p_b
      from public.challenge_participants cp where cp.challenge_id = p_challenge_id;
    if exists (select 1 from jsonb_each_text(g.letters) l where l.value::int >= wlen)
       or first_day + g.days_played > last_day then
      update public.horse_games set
        status = 'final',
        winner = case
          when p_a is null or p_b is null or p_a = p_b then p_a
          when public.horse_letter_count(g, p_a) < public.horse_letter_count(g, p_b) then p_a
          when public.horse_letter_count(g, p_b) < public.horse_letter_count(g, p_a) then p_b
        end,
        updated_at = now()
        where challenge_id = p_challenge_id;
      select * into g from public.horse_games where challenge_id = p_challenge_id;
    end if;

    if other is not null then
      extra := (select jsonb_build_object('day_no', hd.day_no, 'word', g.word,
          'setter_id', hd.setter, 'matcher_id', hd.matcher, 'setter_name', public.horse_name(hd.setter), 'matcher_name', public.horse_name(hd.matcher),
          'shot_name', public.horse_shot_name(hd.shot), 'target', hd.target, 'made', hd.made, 'matched', hd.matched,
          'letter_to', hd.letter_to, 'letters', g.letters, 'winner', g.winner, 'next_setter', g.setter)
        from public.horse_days hd where hd.challenge_id = p_challenge_id and hd.day = d);
      for r in select cp.user_id from public.challenge_participants cp where cp.challenge_id = p_challenge_id loop
        perform public.hoops_notify(case when g.status = 'final' then 'horse_final' else 'horse_result' end, p_challenge_id, r.user_id, extra);
      end loop;
    end if;
    exit when g.status = 'final';
  end loop;
  return n;
end;
$$;
revoke execute on function public.horse_advance(uuid) from public, anon;
grant execute on function public.horse_advance(uuid) to authenticated;

create or replace function public.horse_advance_all()
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select c.id from public.challenges c
    join public.horse_games g on g.challenge_id = c.id
    where c.kind::text = 'horse' and g.status = 'active' and c.starts_at < now()
    order by c.starts_at
  loop
    begin
      n := n + public.horse_advance(r.id);
    exception when others then
      raise warning 'horse_advance_all: % failed: %', r.id, sqlerrm;
    end;
  end loop;
  return n;
end;
$$;
revoke execute on function public.horse_advance_all() from public, anon, authenticated;

select cron.schedule('hound-horse-advance', '31 11 * * *', $$ select public.horse_advance_all(); $$);

create or replace function public.horse_view(p_challenge_id uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  c public.challenges%rowtype;
  g public.horse_games%rowtype;
  first_day date;
  today date;
begin
  select * into c from public.challenges where id = p_challenge_id;
  select * into g from public.horse_games where challenge_id = p_challenge_id;
  if c.id is null or g.challenge_id is null
     or not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = caller) then
    raise exception 'not authorized';
  end if;
  first_day := public.soccer_first_day(c);
  today := public.soccer_today(caller);
  return jsonb_build_object(
    'status', case when g.status = 'final' then 'final' when today < first_day and g.days_played = 0 then 'upcoming' else 'live' end,
    'first_day', first_day,
    'day_no', greatest(0, today - first_day + 1),
    'days', c.duration_days,
    'word', g.word,
    'setter', g.setter,
    'me', caller,
    'players', (select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', cp.user_id, 'name', public.horse_name(cp.user_id), 'initials', p.initials,
        'icon_id', p.equipped_icon_id, 'frame_id', p.equipped_frame_id, 'background_id', p.equipped_background_id,
        'letters', left(g.word, public.horse_letter_count(g, cp.user_id)),
        'steps_today', coalesce((select ps.steps from public.progress_snapshots ps where ps.challenge_id = p_challenge_id and ps.user_id = cp.user_id and ps.day = today), 0))
      order by (cp.user_id = c.created_by) desc, cp.joined_at), '[]'::jsonb)
      from public.challenge_participants cp join public.profiles p on p.id = cp.user_id
      where cp.challenge_id = p_challenge_id),
    'shot', jsonb_build_object('id', g.shot, 'name', public.horse_shot_name(g.shot), 'target', public.horse_target(g.shot)),
    'shots', public.horse_shots(),
    'history', (select coalesce(jsonb_agg(jsonb_build_object(
        'day_no', hd.day_no, 'setter', hd.setter, 'shot', hd.shot, 'target', hd.target, 'setter_steps', hd.setter_steps,
        'made', hd.made, 'matcher_steps', hd.matcher_steps, 'matched', hd.matched, 'letter_to', hd.letter_to)
      order by hd.day_no), '[]'::jsonb)
      from public.horse_days hd where hd.challenge_id = p_challenge_id),
    'winner', g.winner
  );
end;
$$;
revoke execute on function public.horse_view(uuid) from public, anon;
grant execute on function public.horse_view(uuid) to authenticated;

-- ── Paying both games ──

-- 0181's core with Hoops and H-O-R-S-E: the winners score like a Soccer
-- winner and get Admin's win Bones, everyone who played the play Bones.
create or replace function public.settle_challenge_score_core(p_challenge_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  concluded boolean;
  hunt_fully_caught boolean := false;
  goal numeric;
  total numeric;
  ttt public.tictacgo_games%rowtype;
  rg public.rally_games%rowtype;
  sg public.soccer_games%rowtype;
  cg public.cricket_games%rowtype;
  bg public.baseball_games%rowtype;
  hg public.hoops_games%rowtype;
  xg public.horse_games%rowtype;
  hcfg public.hoops_config%rowtype;
  bones_trickle constant int := 5;
  bones_per_level constant int := 25;
  first_day date;
begin
  select * into c from public.challenges where id = p_challenge_id for update;
  if not found or c.score_settled_at is not null then
    return;
  end if;

  concluded := now() >= c.ends_at;

  if not concluded and c.kind = 'tag' and c.tag_mode is distinct from 'chase' then
    goal := case when c.distance_goal_unit = 'steps' then c.distance_goal_steps else c.distance_goal_mi end;
    if goal is not null then
      select coalesce(sum(case when c.distance_goal_unit = 'steps' then ps.steps else ps.distance_mi end), 0)
        into total
        from public.progress_snapshots ps
        where ps.challenge_id = p_challenge_id;
      if total >= goal then
        concluded := true;
      end if;
    end if;
  end if;

  -- A Journey ends the moment someone reaches the end of the course.
  if not concluded and c.kind = 'journey' and c.distance_goal_mi is not null then
    if exists (
      select 1 from public.progress_snapshots ps
      where ps.challenge_id = p_challenge_id
      group by ps.user_id
      having coalesce(sum(ps.distance_mi), 0) >= c.distance_goal_mi
    ) then
      concluded := true;
    end if;
  end if;

  if c.kind = 'hunt' then
    hunt_fully_caught :=
      exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.role in ('hunted', 'zombie'))
      and not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.role = 'hunted');
    if hunt_fully_caught then
      concluded := true;
    end if;
  end if;

  if c.kind = 'tictacgo' then
    select * into ttt from public.tictacgo_games where challenge_id = p_challenge_id;
    concluded := found and ttt.status in ('won', 'draw');
  end if;

  -- A Cricket match ends once the second innings is over: that can be
  -- well before ends_at, or the morning after it.
  if c.kind = 'cricket' then
    perform public.cricket_advance(p_challenge_id);
    select * into cg from public.cricket_games where challenge_id = p_challenge_id;
    concluded := found and cg.status = 'final';
  end if;

  -- A Tag chase (0181) ends once its last day is settled, the morning
  -- after ends_at.
  if c.kind = 'tag' and c.tag_mode = 'chase' then
    perform public.tag_chase_advance(p_challenge_id);
    concluded := (select count(*) from public.tag_chase_days d where d.challenge_id = p_challenge_id) >= c.duration_days;
  end if;

  -- A Baseball game ends after its last inning, which can be days past
  -- ends_at in extra innings, or before it on a skipped bottom half.
  if c.kind = 'baseball' then
    perform public.baseball_advance(p_challenge_id);
    select * into bg from public.baseball_games where challenge_id = p_challenge_id;
    concluded := found and bg.status = 'final';
  end if;

  -- A Hoops game ends after its last quarter, or its last overtime: the
  -- morning after ends_at at the earliest.
  if c.kind::text = 'hoops' then
    perform public.hoops_advance(p_challenge_id);
    select * into hg from public.hoops_games where challenge_id = p_challenge_id;
    concluded := found and hg.status = 'final';
  end if;

  -- H-O-R-S-E ends when someone spells the word, or after its last day.
  if c.kind::text = 'horse' then
    perform public.horse_advance(p_challenge_id);
    select * into xg from public.horse_games where challenge_id = p_challenge_id;
    concluded := found and xg.status = 'final';
  end if;

  -- A Soccer match ends after its last day is resolved, which can be the
  -- morning after ends_at — never before.
  if c.kind = 'soccer' then
    perform public.soccer_advance(p_challenge_id);
    select * into sg from public.soccer_games where challenge_id = p_challenge_id;
    concluded := found and sg.status = 'final';
  end if;

  -- A Rally ends on two games, or on time with the leading team winning.
  if c.kind = 'rally' then
    perform public.rally_settle(p_challenge_id);
    select * into rg from public.rally_games where challenge_id = p_challenge_id;
    concluded := found and rg.status in ('won', 'draw');
  end if;

  if not concluded then
    return;
  end if;

  update public.challenges set score_settled_at = now() where id = p_challenge_id;

  if c.kind = 'hunt' then
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select
      cp.user_id,
      p_challenge_id,
      'hunt_result',
      case cp.role
        when 'hunter' then case when hunt_fully_caught then 40 else 10 end
        when 'zombie' then 10
        when 'hunted' then 30
        else 5
      end,
      25,
      bones_trickle
    from public.challenge_participants cp
    where cp.challenge_id = p_challenge_id;

  elsif c.kind = 'tag' and c.tag_mode = 'chase' then
    -- Placed by points (+3 a tag, +1 a day got away), fewer days as IT
    -- breaking a tie, and scored like a Step Race.
    with ranked as (
      select s.user_id, row_number() over (order by s.points desc, s.days_it asc) as rnk
      from public.tag_chase_standings(p_challenge_id) s
    )
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select user_id, p_challenge_id, 'tag_result',
      case rnk when 1 then 50 when 2 then 25 when 3 then 15 else 5 end,
      25,
      bones_trickle
    from ranked;

  elsif c.kind = 'tag' then
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select cp.user_id, p_challenge_id, 'tag_result', 10 + least(cp.tags_made, 5) * 5, 25, bones_trickle
    from public.challenge_participants cp
    where cp.challenge_id = p_challenge_id;

  elsif c.kind = 'distance' then
    goal := case when c.distance_goal_unit = 'steps' then c.distance_goal_steps else c.distance_goal_mi end;
    select coalesce(sum(case when c.distance_goal_unit = 'steps' then ps.steps else ps.distance_mi end), 0)
      into total
      from public.progress_snapshots ps
      where ps.challenge_id = p_challenge_id;
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select cp.user_id, p_challenge_id, 'distance_result',
      case when goal is not null and total >= goal then 15 else 10 end,
      25,
      bones_trickle
    from public.challenge_participants cp
    where cp.challenge_id = p_challenge_id;

  elsif c.kind = 'journey' then
    -- Furthest along the course places first, like a Step Race by
    -- miles; finishing the course is worth a little more on top.
    with totals as (
      select cp.user_id, coalesce(sum(ps.distance_mi), 0) as total_mi
      from public.challenge_participants cp
      left join public.progress_snapshots ps on ps.challenge_id = cp.challenge_id and ps.user_id = cp.user_id
      where cp.challenge_id = p_challenge_id
      group by cp.user_id
    ),
    ranked as (
      select user_id, total_mi, row_number() over (order by total_mi desc) as rnk from totals
    )
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select user_id, p_challenge_id, 'journey_result',
      case rnk when 1 then 50 when 2 then 25 when 3 then 15 else 5 end
        + case when c.distance_goal_mi is not null and total_mi >= c.distance_goal_mi then 10 else 0 end,
      25,
      bones_trickle
    from ranked;

  elsif c.kind = 'steps' then
    with totals as (
      -- Not named `total` — see 0058's own comment on why that collides
      -- with this function's declared `total` variable.
      select cp.user_id, coalesce(sum(ps.steps), 0) as total_steps
      from public.challenge_participants cp
      left join public.progress_snapshots ps on ps.challenge_id = cp.challenge_id and ps.user_id = cp.user_id
      where cp.challenge_id = p_challenge_id
      group by cp.user_id
    ),
    ranked as (
      select user_id, row_number() over (order by total_steps desc) as rnk from totals
    )
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select user_id, p_challenge_id, 'steps_result',
      case rnk when 1 then 50 when 2 then 25 when 3 then 15 else 5 end,
      25,
      bones_trickle
    from ranked;

  elsif c.kind = 'streak' and c.daily_goal_steps is not null then
    -- Every day from the challenge's first day (or the day they joined,
    -- if later) through its last day. The join day is taken in UTC,
    -- which never makes someone west of UTC answer for a day before
    -- they joined.
    first_day := coalesce(c.start_day, (c.starts_at at time zone 'America/New_York')::date);
    with survival as (
      select cp.user_id,
        not exists (
          select 1
          from generate_series(
            greatest(first_day, (cp.joined_at at time zone 'UTC')::date)::timestamp,
            (first_day + c.duration_days - 1)::timestamp,
            interval '1 day'
          ) d
          left join public.progress_snapshots ps
            on ps.challenge_id = p_challenge_id and ps.user_id = cp.user_id and ps.day = d::date
          where coalesce(ps.steps, 0) < c.daily_goal_steps
        ) as survived
      from public.challenge_participants cp
      where cp.challenge_id = p_challenge_id
    )
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select user_id, p_challenge_id, 'streak_result',
      case when survived then 40 else 10 end,
      case when survived then 30 else 25 end,
      bones_trickle
    from survival;

  elsif c.kind = 'bingo' and c.bingo_card_type = 'hound' then
    -- Squares count only if they're on the player's card. BINGOs are
    -- placed in the order Hound saw them.
    with st as (
      select cp.user_id, bc.bingo_at, bc.blackout_at,
        count(bp.category) filter (where bp.category = any (bc.squares)) as n
      from public.challenge_participants cp
      left join public.bingo_cards bc on bc.challenge_id = cp.challenge_id and bc.user_id = cp.user_id
      left join public.bingo_progress bp on bp.challenge_id = cp.challenge_id and bp.user_id = cp.user_id
      where cp.challenge_id = p_challenge_id
      group by cp.user_id, bc.bingo_at, bc.blackout_at
    ),
    placed as (
      select st.*, case when st.bingo_at is not null then rank() over (order by st.bingo_at) end as place
      from st
    )
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select user_id, p_challenge_id, 'bingo_result',
      case
        when blackout_at is not null then 40
        when place = 1 then 35
        when place = 2 then 30
        when place = 3 then 25
        when bingo_at is not null then 20
        else least(n, 15)
      end,
      25 + n::int,
      bones_trickle
    from placed;

  elsif c.kind = 'bingo' then
    with counts as (
      select cp.user_id, count(bp.category) as n
      from public.challenge_participants cp
      left join public.bingo_progress bp on bp.challenge_id = cp.challenge_id and bp.user_id = cp.user_id
      where cp.challenge_id = p_challenge_id
      group by cp.user_id
    )
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select user_id, p_challenge_id, 'bingo_result',
      case when n = 9 then 40 else n * 4 end,
      25 + n,
      bones_trickle
    from counts;

  elsif c.kind = 'tictacgo' then
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select uid, p_challenge_id, 'tictacgo_result',
      case
        when ttt.status = 'draw' then 15
        when uid = ttt.winner_user_id then 35
        else 5
      end,
      25,
      bones_trickle
    from (values (ttt.x_user_id), (ttt.o_user_id)) as players (uid);

  elsif c.kind = 'rally' then
    -- The winning team scores like a Tic-Tac-Go winner, a draw on time
    -- like a Tic-Tac-Go draw.
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select p.user_id, p_challenge_id, 'rally_result',
      case
        when rg.status = 'draw' then 15
        when p.team = rg.winner_team then 35
        else 5
      end,
      25,
      bones_trickle
    from public.rally_players p
    where p.challenge_id = p_challenge_id and p.joined and p.user_id is not null;

  elsif c.kind = 'cricket' then
    -- The winning side scores like a Soccer winner, a tie like a draw.
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select p.user_id, p_challenge_id, 'cricket_result',
      case
        when cg.winner_team is null then 15
        when p.team = cg.winner_team then 35
        else 5
      end,
      25,
      bones_trickle
    from public.cricket_players p
    where p.challenge_id = p_challenge_id and p.joined and p.user_id is not null;

  elsif c.kind = 'baseball' then
    -- The winning side scores like a Soccer winner, a tie like a draw.
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select p.user_id, p_challenge_id, 'baseball_result',
      case
        when bg.winner_team is null then 15
        when p.team = bg.winner_team then 35
        else 5
      end,
      25,
      bones_trickle
    from public.baseball_players p
    where p.challenge_id = p_challenge_id and p.joined and p.user_id is not null;

  elsif c.kind::text = 'hoops' then
    -- The winning side scores like a Soccer winner and gets Admin's win
    -- Bones; everyone who played gets the play Bones.
    select * into hcfg from public.hoops_config where id;
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select p.user_id, p_challenge_id, 'hoops_result',
      case
        when hg.winner_team is null then 15
        when p.team = hg.winner_team then 35
        else 5
      end,
      25,
      bones_trickle + coalesce(hcfg.play_bones, 10)
        + case when p.team = hg.winner_team then coalesce(hcfg.win_bones, 40) else 0 end
    from public.hoops_players p
    where p.challenge_id = p_challenge_id and p.joined and p.user_id is not null;

  elsif c.kind::text = 'horse' then
    select * into hcfg from public.hoops_config where id;
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select cp.user_id, p_challenge_id, 'horse_result',
      case
        when xg.winner is null then 15
        when cp.user_id = xg.winner then 35
        else 5
      end,
      25,
      bones_trickle + coalesce(hcfg.play_bones, 10)
        + case when cp.user_id = xg.winner then coalesce(hcfg.win_bones, 40) else 0 end
    from public.challenge_participants cp
    where cp.challenge_id = p_challenge_id;

  elsif c.kind = 'soccer' then
    -- The winning side scores like a Rally winner, a draw like a Rally draw.
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select p.user_id, p_challenge_id, 'soccer_result',
      case
        when sg.winner_team is null then 15
        when p.team = sg.winner_team then 35
        else 5
      end,
      25,
      bones_trickle
    from public.soccer_players p
    where p.challenge_id = p_challenge_id and p.joined and p.user_id is not null;

  elsif c.kind = 'seventyfive' then
    -- Total complete days (all 6 items true), not the reset-on-a-miss
    -- streak computeSeventyFiveStatus tracks client-side — same
    -- acceptable divergence Daily Streak's own "survived" scoring
    -- already has from its own richer client display: scoring reads a
    -- simpler, independently-derived signal from the same durable rows
    -- rather than replicating the display's own reset logic in SQL.
    with counts as (
      select cp.user_id,
        count(*) filter (
          where sc.workout1_done and sc.workout2_outdoor_done and sc.diet_done
            and sc.water_done and sc.reading_done and sc.photo_done
        ) as complete_days
      from public.challenge_participants cp
      left join public.seventyfive_checkins sc
        on sc.challenge_id = cp.challenge_id and sc.user_id = cp.user_id
      where cp.challenge_id = p_challenge_id
      group by cp.user_id
    )
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select user_id, p_challenge_id, 'seventyfive_result', complete_days * 3, 25 + complete_days, bones_trickle
    from counts;

  elsif c.kind = 'checklist' then
    -- Complete days: every shared item ticked, and the person's own
    -- line too if they wrote one. Same shape as 75 Day above: total
    -- complete days, not the reset-on-a-miss streak the app shows.
    with days as (
      select ck.user_id, ck.day, count(distinct ck.item_id) as ticked
      from public.checklist_checkins ck
      where ck.challenge_id = p_challenge_id and ck.done
      group by ck.user_id, ck.day
    ),
    counts as (
      select cp.user_id,
        -- Every shared item, plus your own line from the day you wrote
        -- it (so a line added on day 10 doesn't undo days 1 to 9).
        count(d.day) filter (where d.ticked >= (
          select count(*) from public.checklist_items i
          where i.challenge_id = p_challenge_id
            and (i.owner_id is null
              or (i.owner_id = cp.user_id
                  and coalesce(i.from_day, (i.created_at at time zone 'utc')::date) <= d.day))
        )) as complete_days
      from public.challenge_participants cp
      left join days d on d.user_id = cp.user_id
      where cp.challenge_id = p_challenge_id
      group by cp.user_id
    )
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select user_id, p_challenge_id, 'checklist_result', complete_days * 3, 25 + complete_days, bones_trickle
    from counts;

  elsif c.kind = 'houndopoly' then
    -- Every day rolled first, then richest wins: net worth is cash plus
    -- the price of every square owned. Places like a Step Race.
    perform public.houndopoly_advance(p_challenge_id);
    with worth as (
      select cp.user_id, public.houndopoly_net_worth(p_challenge_id, cp.user_id) as net
      from public.challenge_participants cp
      where cp.challenge_id = p_challenge_id
    ),
    ranked as (
      select user_id, rank() over (order by net desc) as rnk from worth
    )
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select user_id, p_challenge_id, 'houndopoly_result',
      case rnk when 1 then 50 when 2 then 25 when 3 then 15 else 5 end,
      25,
      bones_trickle
    from ranked;

  elsif c.kind = 'doors' then
    -- Most points wins, placed like a Step Race, and everyone gets the
    -- Bones for finishing. Every door's day is past by now, so each is
    -- counted as done, opened or missed.
    with ranked as (
      select b.user_id, rank() over (order by s.points desc, s.done desc) as rnk
      from public.challenge_participants b
      cross join lateral public.doors_points(p_challenge_id, b.user_id, public.doors_first_day(c) + c.duration_days) s
      where b.challenge_id = p_challenge_id
    )
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select user_id, p_challenge_id, 'doors_result',
      case rnk when 1 then 50 when 2 then 25 when 3 then 15 else 5 end,
      25,
      -- Everyone gets Admin's Bones for finishing, on top of the trickle.
      bones_trickle + coalesce((select d.finish_bones from public.doors_settings d), 25)
    from ranked;

  elsif c.kind = 'packs' then
    -- Every day played first, then the pack with the most ground wins (a
    -- tie shares it). Its members get Admin's win Bones, everyone else the
    -- finishing Bones, all on top of the trickle.
    perform public.pack_advance(p_challenge_id);
    with held as (
      select p as pack, (select count(*) from public.pack_territories t where t.challenge_id = p_challenge_id and t.owner = p) as n
      from unnest(array['wolves', 'goldens', 'collies', 'beagles']) p
    ),
    top as (select max(n) as n from held)
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select m.user_id, p_challenge_id, 'packs_result',
      case when h.n = (select n from top) and h.n > 0 then 40 else 10 end,
      25,
      bones_trickle + case when h.n = (select n from top) and h.n > 0
        then coalesce((select s.win_bones from public.pack_settings s), 50)
        else coalesce((select s.finish_bones from public.pack_settings s), 20) end
    from public.pack_members m
    join held h on h.pack = m.pack
    join public.challenge_participants cp on cp.challenge_id = m.challenge_id and cp.user_id = m.user_id
    where m.challenge_id = p_challenge_id;

  else
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select cp.user_id, p_challenge_id, 'participation', 10, 25, bones_trickle
    from public.challenge_participants cp
    where cp.challenge_id = p_challenge_id;
  end if;

  -- Safe to read activity_events back by challenge_id alone: the
  -- score_settled_at guard above means a challenge is only ever settled
  -- once, so every row here was inserted by this exact call, not a mix
  -- with some earlier run.
  with events as (
    select user_id, score_points, xp_points, bones_points
    from public.activity_events
    where challenge_id = p_challenge_id
  ),
  per_user as (
    select
      e.user_id, e.score_points, e.xp_points, e.bones_points,
      public.level_for_xp(p.xp_total) as old_level,
      public.level_for_xp(p.xp_total + e.xp_points) as new_level
    from events e
    join public.profiles p on p.id = e.user_id
  )
  update public.profiles p
    set hound_score = p.hound_score + pu.score_points,
        xp_total = p.xp_total + pu.xp_points,
        bones_balance = p.bones_balance + pu.bones_points + (pu.new_level - pu.old_level) * bones_per_level,
        bones_earned_total = p.bones_earned_total + pu.bones_points + (pu.new_level - pu.old_level) * bones_per_level
    from per_user pu
    where p.id = pu.user_id;
end;
$$;

revoke execute on function public.settle_challenge_score_core(uuid) from public, anon, authenticated;

-- 0167's wrapper, with Hoops and H-O-R-S-E settling on their own state
-- like the other games (a Hoops side may be all bots).
create or replace function public.settle_challenge_score(p_challenge_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  grace constant interval := interval '24 hours';
  min_players constant int := 2;
  players int;
  caller uuid := auth.uid();
  personal boolean;
begin
  select * into c from public.challenges where id = p_challenge_id for update;
  if not found or c.score_settled_at is not null then
    return;
  end if;

  -- A signed-in caller must be in the challenge. The scheduled job runs as
  -- the database and has no signed-in user.
  if caller is not null and not exists (
    select 1 from public.challenge_participants cp
    where cp.challenge_id = p_challenge_id and cp.user_id = caller
  ) then
    return;
  end if;

  select count(*) into players
  from public.challenge_participants cp
  where cp.challenge_id = p_challenge_id;

  -- Played for your own effort, so one player is enough.
  personal := c.kind::text in ('seventyfive', 'bingo', 'checklist');

  -- Game-event kinds (a Journey, which ends when someone reaches the end
  -- of the course, and a Rally, which ends on two games) can end before
  -- ends_at; the core decides if they have.
  -- A Rally's or a Soccer match's other players may all be bots: its own
  -- state says whether it's over, whatever the participant count.
  if c.kind::text in ('rally', 'soccer', 'cricket', 'baseball', 'hoops') then
    perform public.settle_challenge_score_core(p_challenge_id);
    return;
  end if;

  -- H-O-R-S-E needs its second player.
  if c.kind::text = 'horse' then
    if players >= min_players then
      perform public.settle_challenge_score_core(p_challenge_id);
    elsif now() >= c.ends_at + grace then
      update public.challenges set score_settled_at = now() where id = p_challenge_id;
    end if;
    return;
  end if;

  if c.kind::text in ('hunt', 'tag', 'tictacgo', 'journey') then
    if players >= min_players then
      perform public.settle_challenge_score_core(p_challenge_id);
    elsif now() >= c.ends_at + grace then
      -- Never had an opponent: close it without paying anyone.
      update public.challenges set score_settled_at = now() where id = p_challenge_id;
    end if;
    return;
  end if;

  -- Time-based kinds wait for the grace period.
  if now() < c.ends_at + grace then
    return;
  end if;

  if players < min_players and not personal then
    -- Nobody to compete against: close it without paying anyone.
    update public.challenges set score_settled_at = now() where id = p_challenge_id;
    return;
  end if;

  perform public.settle_challenge_score_core(p_challenge_id);
end;
$$;

revoke execute on function public.settle_challenge_score(uuid) from public, anon;
grant execute on function public.settle_challenge_score(uuid) to authenticated;

-- 0167's trophies, with Hoops and H-O-R-S-E wins.
create or replace function public.yard_trophies(p_user uuid)
returns table (kind text, wins integer, last_won timestamptz)
language sql
stable
security definer set search_path = public
as $$
  with won as (
    select e.created_at,
      case e.kind
        when 'steps_result' then 'steps'
        when 'houndopoly_result' then 'houndopoly'
        when 'soccer_result' then 'soccer'
        when 'rally_result' then 'rally'
        when 'cricket_result' then 'cricket'
        when 'baseball_result' then 'baseball'
        when 'hoops_result' then 'hoops'
        when 'horse_result' then 'horse'
        when 'tictacgo_result' then 'tictacgo'
        when 'bingo_result' then 'bingo'
        when 'streak_result' then 'streak'
        when 'journey_result' then 'journey'
      end as trophy
    from public.activity_events e
    where e.user_id = p_user
      and (
        (e.kind in ('steps_result', 'houndopoly_result') and e.score_points >= 50
          and exists (
            select 1 from public.activity_events o
            where o.challenge_id = e.challenge_id and o.kind = e.kind and o.user_id <> p_user
          ))
        or (e.kind in ('soccer_result', 'rally_result', 'cricket_result', 'baseball_result', 'hoops_result', 'horse_result', 'tictacgo_result') and e.score_points = 35)
        or (e.kind = 'bingo_result' and e.score_points >= 35)
        or (e.kind = 'streak_result' and e.score_points = 40)
        or (e.kind = 'journey_result' and exists (
          select 1 from public.challenges c
          where c.id = e.challenge_id
            and c.distance_goal_mi is not null
            and (select coalesce(sum(ps.distance_mi), 0) from public.progress_snapshots ps
                 where ps.challenge_id = e.challenge_id and ps.user_id = p_user) >= c.distance_goal_mi
        ))
      )
  )
  select trophy, count(*)::integer, max(created_at)
  from won
  group by trophy
  order by max(created_at) desc, trophy;
$$;

revoke execute on function public.yard_trophies(uuid) from public, anon, authenticated;

-- ── Admin → Overview → Hoops ──

create or replace function public.admin_hoops_overview()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;
  return jsonb_build_object(
    'config', to_jsonb(public.hoops_cfg()),
    'hoops_live', (select count(*) from public.hoops_games g where g.status = 'active'),
    'hoops_7d', (select count(*) from public.hoops_games g join public.challenges c on c.id = g.challenge_id where c.created_at > now() - interval '7 days'),
    'hoops_all', (select count(*) from public.hoops_games),
    'players_7d', (select count(distinct p.user_id) from public.hoops_players p join public.challenges c on c.id = p.challenge_id
                   where p.user_id is not null and p.joined and c.created_at > now() - interval '7 days'),
    'shots_7d', (select count(*) from public.hoops_events e where e.created_at > now() - interval '7 days'),
    'dunks_7d', (select count(*) from public.hoops_events e where e.dunk and e.created_at > now() - interval '7 days'),
    'on_fire_7d', (select count(*) from public.hoops_events e where e.on_fire and e.created_at > now() - interval '7 days'),
    'horse_live', (select count(*) from public.horse_games g where g.status = 'active'),
    'horse_7d', (select count(*) from public.horse_games g join public.challenges c on c.id = g.challenge_id where c.created_at > now() - interval '7 days'),
    'horse_all', (select count(*) from public.horse_games),
    'bones_7d', (select coalesce(sum(e.bones_points), 0) from public.activity_events e
                 where e.kind in ('hoops_result', 'horse_result') and e.created_at > now() - interval '7 days')
  );
end;
$$;
revoke execute on function public.admin_hoops_overview() from public, anon;
grant execute on function public.admin_hoops_overview() to authenticated;
