-- Hound: Bullseye, harder to fluke (Steve, Nov 2026: "If I do nothing and
-- just draw, it seems to always hit the target").
--
-- Before, the pin barely moved at full draw (0.2 mils with a workout: 3 mm
-- at 18 m), arrows grouped within 2 cm at 70 m, the breeze was 2 to 10 mph
-- and an unshot sight mark was the exact physics, so drawing and letting
-- go with no aiming was nearly always gold or red. Modelled out across
-- every distance (doing nothing / reading the breeze / plus a set sight
-- tape / all that but rushed with no workout), now:
--
--   18 m   about 8 (gold 44%)  / 8.5 / 9.6 / 7.4
--   50 m   about 6 (gold 7%)   / 7.6 / 9.3 / 6.2
--   70 m   about 5 (gold 3%)   / 7.9 / 9.3 / 6.6
--   90 m   about 2 (on the face 62%) / 7.0 / 8.9 / 5.4
--
-- so the little ones still hit the face up close, and golds further out
-- come from reading the windsocks, earning your sight tape and letting go
-- in the steady part of the draw. It changes:
--
--   the sway     0.8 -> 5 mils before the bow, a workout (x0.55) and the
--                draw (x0.4 at full draw, x1 while drawing, up to x3 tired)
--   the spread   0.3 -> 1 mil
--   the breeze   2-10 -> 3-13 mph (today's breeze changes when this runs)
--   a guess      an unshot sight mark is the book give or take up to 4
--                mils (bullseye_guess: your own, the same each time for
--                that bow, arrow and target), until a gold sets your tape,
--                as the screen always said ("a guess can be a ring or two
--                off").
--
-- Every number stays in bullseye_settings. Run this once, after 0249.

alter table public.bullseye_settings drop constraint if exists bullseye_settings_sway_mil_check;
alter table public.bullseye_settings add constraint bullseye_settings_sway_mil_check check (sway_mil between 0 and 10);
alter table public.bullseye_settings add column if not exists guess_mil numeric(4, 2) not null default 4.00 check (guess_mil between 0 and 10);
update public.bullseye_settings set sway_mil = 5.00, spread_mil = 1.000, updated_at = now() where id;

-- How far your unshot sight mark is off (mils): your own, steady for that
-- bow, arrows, world and target, up to guess_mil either way.
create or replace function public.bullseye_guess(p_user uuid, p_bow text, p_arrow text, p_world text, p_dist int)
returns double precision
language sql
stable
security definer set search_path = public
as $$
  select ((abs(hashtext('guess:' || p_user::text || ':' || p_bow || ':' || p_arrow || ':' || p_world || ':' || p_dist)::bigint) % 801) - 400)
         / 400.0 * s.guess_mil::double precision
  from public.bullseye_settings s;
$$;
revoke execute on function public.bullseye_guess(uuid, text, text, text, int) from public, anon, authenticated;

create or replace function public.bullseye_sight(p_user uuid, p_bow text, p_arrow text, p_world text, p_dist int)
returns double precision
language plpgsql
security definer set search_path = public
as $$
declare
  m numeric;
begin
  select t.mark into m from public.bullseye_tapes t
  where t.user_id = p_user and t.bow = p_bow and t.arrow = p_arrow and t.world = p_world and t.dist = p_dist;
  if found then
    return m;
  end if;
  -- Not shot in yet: the book, give or take your own guess.
  return round((public.bullseye_book_get(p_bow, p_arrow, p_world, p_dist)).mark::numeric, 1)
         + public.bullseye_guess(p_user, p_bow, p_arrow, p_world, p_dist);
end;
$$;
revoke execute on function public.bullseye_sight(uuid, text, text, text, int) from public, anon, authenticated;

create or replace function public.bullseye_conditions(p_challenge_id uuid, p_day date)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  g public.bullseye_games%rowtype;
  h bigint;
  moon boolean;
  balloon boolean;
  temp int;
begin
  select * into g from public.bullseye_games where challenge_id = p_challenge_id;
  if not found then
    g.far := 150;
    g.moon := 'sat';
    g.balloons := 'wed';
    g.helper := false;
    g.bounty := true;
  end if;
  h := abs(hashtext('bullseye:' || p_challenge_id::text || ':' || p_day::text)::bigint);
  moon := g.moon = 'sat' and extract(isodow from p_day) = 6;
  balloon := not moon and g.balloons = 'wed' and extract(isodow from p_day) = 3;
  temp := 45 + (h % 41)::int;
  return jsonb_build_object(
    'world', case when moon then 'moon' else 'earth' end,
    'balloons', balloon,
    'far', g.far,
    'helper', g.helper,
    'bounty', g.bounty and not moon,
    'tempF', temp,
    'air', case when moon then 0 else round((519.0 / (460 + temp))::numeric, 4) end,
    'wind', case when moon then jsonb_build_object('mph', 0, 'from', 'none', 'gust', 0, 'period', 30, 'phase', 0, 'near', 1, 'mid', 1, 'far', 1)
            else jsonb_build_object(
              'mph', 3 + ((h / 41) % 1001)::numeric / 100,
              'from', case when (h / 32841) % 2 = 0 then 'left' else 'right' end,
              'gust', 0.15 + ((h / 65682) % 21)::numeric / 100,
              'period', 14 + ((h / 1379322) % 15)::int,
              'phase', round((((h / 20689830) % 628)::numeric / 100), 2),
              'near', 0.85 + ((h / 7) % 31)::numeric / 100,
              'mid', 0.85 + ((h / 217) % 31)::numeric / 100,
              'far', 0.85 + ((h / 6727) % 31)::numeric / 100) end,
    -- Balloon days: each balloon's drift (cm either side, period s, phase).
    'drift', case when balloon then jsonb_build_object(
              'amp', 90 + (h % 61), 'period', 9 + ((h / 13) % 6)::int, 'phase', round((((h / 97) % 628)::numeric / 100), 2)) end
  );
end;
$$;
revoke execute on function public.bullseye_conditions(uuid, date) from public, anon, authenticated;
