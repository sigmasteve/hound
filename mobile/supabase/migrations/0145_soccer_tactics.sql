-- Hound: Soccer tactics — one pick a day per player, hidden from the
-- other side until the morning report.
--
--   forwards  aim: one of five zones on the goal (four corners or the
--             centre). All of that forward's shots that day go there.
--   keeper    dives: the zone to guard. Guess a shot's zone and an
--             on-target shot is 1.6 times as likely to be saved (capped
--             at 90%); guess wrong and it's 0.85 times as likely. Against
--             a forward aiming at random that evens out, so a guess only
--             pays when it reads the shooter.
--   defenders mark: an opposing forward to shadow. That forward's chance
--             of hitting the target is then set by the markers' steps
--             against theirs, instead of the whole defense's average; a
--             defender who marks is out of the general defense, so
--             unmarked forwards face only the defenders left over.
--
-- Nobody is punished for not opening the app: a forward with no pick
-- shoots at a random zone (seeded, like every other roll), a keeper with
-- no pick neither gains nor loses, and a defender with no pick stays in
-- the general defense, exactly as before. Bots pick their aim and dive by
-- seeded roll, so a match against bots has the same guessing game.
--
-- A pick is for the player's own today (profiles.time_zone, New York as
-- the game's fallback) and can change until that day is played. Your
-- side's picks are visible to your side; the other side's only once the
-- day has been played. A reminder goes out at 17:07 UTC (midday in the
-- US) to anyone who hasn't picked.
--
-- Run this once, after 0144, in the SQL Editor; redeploy
-- send-soccer-notification for the reminder.

create table public.soccer_tactics (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  day date not null,
  player_id uuid not null references public.profiles (id) on delete cascade,
  aim text check (aim in ('top_left', 'top_right', 'bottom_left', 'bottom_right', 'center')),
  dive text check (dive in ('top_left', 'top_right', 'bottom_left', 'bottom_right', 'center')),
  mark_id uuid,
  updated_at timestamptz not null default now(),
  primary key (challenge_id, day, player_id)
);

alter table public.soccer_tactics enable row level security;
revoke all on public.soccer_tactics from anon;
revoke insert, update, delete on public.soccer_tactics from authenticated;

create policy "Your side's picks, and everyone's once the day is played"
  on public.soccer_tactics for select
  to authenticated
  using (
    exists (
      select 1 from public.soccer_players me, public.soccer_players them
      where me.challenge_id = soccer_tactics.challenge_id and me.user_id = auth.uid()
        and them.challenge_id = soccer_tactics.challenge_id and them.player_id = soccer_tactics.player_id
        and me.team = them.team
    )
    or (
      exists (select 1 from public.soccer_days d where d.challenge_id = soccer_tactics.challenge_id and d.day = soccer_tactics.day)
      and exists (select 1 from public.challenge_participants cp where cp.challenge_id = soccer_tactics.challenge_id and cp.user_id = auth.uid())
    )
  );

alter table public.soccer_events
  add column aim text,
  add column dive text,
  add column marker_ids uuid[];

-- The odds, on their own so they can be read and tested.
create or replace function public.soccer_on_target_chance(p_steps numeric, p_defense numeric)
returns double precision
language sql
immutable
as $$
  select least(0.80, greatest(0.15, 0.20 + 0.40 * p_steps / nullif(p_steps + p_defense, 0)))::double precision;
$$;

create or replace function public.soccer_save_chance(p_keeper_steps numeric, p_shooter_steps numeric, p_aim text, p_dive text)
returns double precision
language sql
immutable
as $$
  select case
    when p_dive is null then base
    when p_dive = p_aim then least(0.90, base * 1.6)
    else base * 0.85
  end
  from (select least(0.85, greatest(0.05, 0.25 + 0.55 * p_keeper_steps / nullif(p_keeper_steps + p_shooter_steps, 0)))::double precision as base) b;
$$;

-- A seeded zone, for a forward or bot who didn't pick.
create or replace function public.soccer_seeded_zone(p_seed text)
returns text
language sql
immutable
as $$
  select (array['top_left', 'top_right', 'bottom_left', 'bottom_right', 'center'])[1 + floor(public.rally_js_rand(public.rally_js_hash(p_seed)) * 5)::int];
$$;

grant execute on function public.soccer_on_target_chance(numeric, numeric) to authenticated;
grant execute on function public.soccer_save_chance(numeric, numeric, text, text) to authenticated;
revoke execute on function public.soccer_on_target_chance(numeric, numeric) from public, anon;
revoke execute on function public.soccer_save_chance(numeric, numeric, text, text) from public, anon;
revoke execute on function public.soccer_seeded_zone(text) from public, anon, authenticated;

-- The caller's own today in a match, by their time zone.
create or replace function public.soccer_today(p_user_id uuid)
returns date
language sql
stable
as $$
  select (now() at time zone coalesce((select p.time_zone from public.profiles p where p.id = p_user_id), 'America/New_York'))::date;
$$;

revoke execute on function public.soccer_today(uuid) from public, anon, authenticated;

-- Sets the caller's pick for their today: an aim for a forward, a dive for
-- the keeper, a forward to mark for a defender. A null clears it. Returns
-- the day it's for.
create or replace function public.soccer_set_tactic(p_challenge_id uuid, p_choice text)
returns date
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  me public.soccer_players%rowtype;
  c public.challenges%rowtype;
  d date;
  first_day date;
  target uuid;
begin
  select * into me from public.soccer_players p where p.challenge_id = p_challenge_id and p.user_id = caller;
  if not found or not me.joined then
    raise exception 'You''re not playing in this match.';
  end if;
  if not exists (select 1 from public.soccer_games g where g.challenge_id = p_challenge_id and g.status = 'active') then
    raise exception 'This match is over.';
  end if;
  select * into c from public.challenges where id = p_challenge_id;
  first_day := public.soccer_first_day(c);
  d := public.soccer_today(caller);
  if d < first_day or d > first_day + c.duration_days - 1 then
    raise exception 'There''s no match day today.';
  end if;
  if exists (select 1 from public.soccer_days sd where sd.challenge_id = p_challenge_id and sd.day = d) then
    raise exception 'Today''s play is already decided.';
  end if;

  if p_choice is null then
    delete from public.soccer_tactics t where t.challenge_id = p_challenge_id and t.day = d and t.player_id = caller;
    return d;
  end if;

  if me.position = 'defender' then
    target := p_choice::uuid;
    if not exists (
      select 1 from public.soccer_players p
      where p.challenge_id = p_challenge_id and p.player_id = target and p.team <> me.team and p.position = 'forward'
    ) then
      raise exception 'Mark one of the other side''s forwards.';
    end if;
    insert into public.soccer_tactics (challenge_id, day, player_id, mark_id) values (p_challenge_id, d, caller, target)
      on conflict (challenge_id, day, player_id) do update set mark_id = excluded.mark_id, aim = null, dive = null, updated_at = now();
  else
    if p_choice not in ('top_left', 'top_right', 'bottom_left', 'bottom_right', 'center') then
      raise exception 'Pick a corner or the centre.';
    end if;
    if me.position = 'forward' then
      insert into public.soccer_tactics (challenge_id, day, player_id, aim) values (p_challenge_id, d, caller, p_choice)
        on conflict (challenge_id, day, player_id) do update set aim = excluded.aim, dive = null, mark_id = null, updated_at = now();
    else
      insert into public.soccer_tactics (challenge_id, day, player_id, dive) values (p_challenge_id, d, caller, p_choice)
        on conflict (challenge_id, day, player_id) do update set dive = excluded.dive, aim = null, mark_id = null, updated_at = now();
    end if;
  end if;
  return d;
end;
$$;

revoke execute on function public.soccer_set_tactic(uuid, text) from public, anon;
grant execute on function public.soccer_set_tactic(uuid, text) to authenticated;

-- 0142's day, with the picks: each forward shoots at their aim (or a
-- seeded zone), marked forwards face their markers, and the keeper's dive
-- tilts the save. Every roll stays seeded.
create or replace function public.soccer_play_day(p_challenge_id uuid, p_day date, p_day_no int, p_first_day date)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  g public.soccer_games%rowtype;
  seed text := p_challenge_id::text || ':' || p_day;
  t text;
  o text;
  f record;
  defense numeric;
  keeper_steps numeric;
  keeper_id uuid;
  keeper_bot boolean;
  dive text;
  aim text;
  markers uuid[];
  mark_defense numeric;
  f_defense numeric;
  s int;
  shots int;
  i int;
  outcome text;
  goals int;
  tot_shots int;
  tot_on int;
  tot_saves int;
  day_goals_a int := 0;
  day_goals_b int := 0;
  shots_a int := 0;
  shots_b int := 0;
  on_a int := 0;
  on_b int := 0;
  saves_a int := 0;
  saves_b int := 0;
begin
  select * into g from public.soccer_games where challenge_id = p_challenge_id;

  foreach t in array array['a', 'b'] loop
    o := case when t = 'a' then 'b' else 'a' end;
    goals := 0; tot_shots := 0; tot_on := 0; tot_saves := 0;

    -- The other side's general defense: the keeper and every defender who
    -- isn't marking someone.
    select coalesce(avg(public.soccer_steps(p_challenge_id, p.player_id, p_day, p_first_day)), 0) into defense
      from public.soccer_players p
      where p.challenge_id = p_challenge_id and p.team = o and p.joined and p.position in ('defender', 'keeper')
        and not (p.position = 'defender' and exists (
          select 1 from public.soccer_tactics st
          where st.challenge_id = p_challenge_id and st.day = p_day and st.player_id = p.player_id and st.mark_id is not null));

    -- Their keeper (a stand-in defender at 60% without one), and the dive.
    keeper_id := null; keeper_steps := null; keeper_bot := false; dive := null;
    select p.player_id, p.bot_id is not null, public.soccer_steps(p_challenge_id, p.player_id, p_day, p_first_day)
      into keeper_id, keeper_bot, keeper_steps
      from public.soccer_players p
      where p.challenge_id = p_challenge_id and p.team = o and p.joined and p.position = 'keeper';
    if keeper_id is null then
      select p.player_id, public.soccer_steps(p_challenge_id, p.player_id, p_day, p_first_day) * 0.6 into keeper_id, keeper_steps
        from public.soccer_players p
        where p.challenge_id = p_challenge_id and p.team = o and p.joined and p.position = 'defender'
        order by public.soccer_steps(p_challenge_id, p.player_id, p_day, p_first_day) desc
        limit 1;
    else
      select st.dive into dive from public.soccer_tactics st
        where st.challenge_id = p_challenge_id and st.day = p_day and st.player_id = keeper_id;
      if dive is null and keeper_bot then
        dive := public.soccer_seeded_zone(seed || ':' || keeper_id || ':dive');
      end if;
    end if;
    keeper_steps := coalesce(keeper_steps, 0);

    for f in
      select p.player_id from public.soccer_players p
      where p.challenge_id = p_challenge_id and p.team = t and p.joined and p.position = 'forward'
      order by p.player_id
    loop
      s := public.soccer_steps(p_challenge_id, f.player_id, p_day, p_first_day);
      shots := least(4, floor(s::numeric / g.shot_steps))::int;
      if shots = 0 then
        continue;
      end if;

      select array_agg(st.player_id order by st.player_id), coalesce(sum(public.soccer_steps(p_challenge_id, st.player_id, p_day, p_first_day)), 0)
        into markers, mark_defense
        from public.soccer_tactics st
        join public.soccer_players p on p.challenge_id = st.challenge_id and p.player_id = st.player_id
        where st.challenge_id = p_challenge_id and st.day = p_day and st.mark_id = f.player_id
          and p.joined and p.team = o and p.position = 'defender';
      f_defense := case when markers is not null then mark_defense else defense end;

      aim := null;
      select st.aim into aim from public.soccer_tactics st
        where st.challenge_id = p_challenge_id and st.day = p_day and st.player_id = f.player_id;
      if aim is null then
        aim := public.soccer_seeded_zone(seed || ':' || f.player_id || ':aim');
      end if;

      for i in 1..shots loop
        if public.rally_js_rand(public.rally_js_hash(seed || ':' || f.player_id || ':' || i || ':on')) >= public.soccer_on_target_chance(s, f_defense) then
          outcome := 'miss';
        elsif public.rally_js_rand(public.rally_js_hash(seed || ':' || f.player_id || ':' || i || ':save')) < public.soccer_save_chance(keeper_steps, s, aim, dive) then
          outcome := 'saved';
        else
          outcome := 'goal';
        end if;
        insert into public.soccer_events (challenge_id, day, day_no, team, shooter_id, keeper_id, shooter_steps, shot_no, outcome, aim, dive, marker_ids)
          values (p_challenge_id, p_day, p_day_no, t, f.player_id, keeper_id, s, i, outcome, aim, dive, markers);
        tot_shots := tot_shots + 1;
        if outcome != 'miss' then tot_on := tot_on + 1; end if;
        if outcome = 'saved' then tot_saves := tot_saves + 1; end if;
        if outcome = 'goal' then goals := goals + 1; end if;
      end loop;
    end loop;

    if t = 'a' then
      day_goals_a := goals; shots_a := tot_shots; on_a := tot_on; saves_b := tot_saves;
    else
      day_goals_b := goals; shots_b := tot_shots; on_b := tot_on; saves_a := tot_saves;
    end if;
  end loop;

  insert into public.soccer_days (challenge_id, day, day_no, goals_a, goals_b, shots_a, shots_b, on_target_a, on_target_b, saves_a, saves_b)
    values (p_challenge_id, p_day, p_day_no, day_goals_a, day_goals_b, shots_a, shots_b, on_a, on_b, saves_a, saves_b);
  update public.soccer_games
    set goals_a = goals_a + day_goals_a, goals_b = goals_b + day_goals_b, days_played = p_day_no, updated_at = now()
    where challenge_id = p_challenge_id;
end;
$$;

revoke execute on function public.soccer_play_day(uuid, date, int, date) from public, anon, authenticated;

-- Midday nudge to every player in a running match who hasn't picked for
-- their today. Returns how many were nudged.
create or replace function public.soccer_pick_reminders()
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select p.challenge_id, p.user_id, p.position, public.soccer_today(p.user_id) as d,
           public.soccer_first_day(c) as first_day, c.duration_days
    from public.soccer_players p
    join public.soccer_games g on g.challenge_id = p.challenge_id and g.status = 'active'
    join public.challenges c on c.id = p.challenge_id
    where p.user_id is not null and p.joined
  loop
    continue when r.d < r.first_day or r.d > r.first_day + r.duration_days - 1;
    continue when exists (select 1 from public.soccer_days sd where sd.challenge_id = r.challenge_id and sd.day = r.d);
    continue when exists (select 1 from public.soccer_tactics t where t.challenge_id = r.challenge_id and t.day = r.d and t.player_id = r.user_id);
    perform public.soccer_notify('pick', r.challenge_id, r.user_id, jsonb_build_object('position', r.position, 'day_no', (r.d - r.first_day) + 1, 'days', r.duration_days));
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke execute on function public.soccer_pick_reminders() from public, anon, authenticated;

select cron.schedule('hound-soccer-pick-reminders', '7 17 * * *', $$ select public.soccer_pick_reminders(); $$);
