-- 0254: Long Shot, less rushed (a tester, Nov 2026: "feels rushed for
-- time to read the wind direction and aim"). Arms start to tire after
-- 15 s in the scope instead of 9; the breathing and its natural pause are
-- unchanged. The app mirrors it (longshotSway, LONGSHOT_TIRE_MS in
-- longshotApi.ts), and now shows the wind as an arrow and a number in the
-- scope, with the hold it asks for, and zooms the scope out for a big
-- hold so the plate stays in view.
--
-- Run this once, after 0001-0253, in the SQL Editor.

create or replace function public.longshot_sway(p_seed int, p_amp double precision, p_t int)
returns table (x double precision, y double precision)
language plpgsql
immutable
as $$
declare
  s bigint := abs(p_seed::bigint);
  ph double precision[] := array[0, 0, 0, 0];
  i int;
  cyc int := p_t % 4500;
  breath double precision;
  tired double precision;
  a double precision;
begin
  for i in 1..4 loop
    ph[i] := ((s / (32 ^ (i - 1))::bigint) % 32) / 32.0 * 2 * pi();
  end loop;
  breath := case when cyc >= 2800 and cyc < 4200 then 0.35 else 1 end;
  tired := least(2.5, 1 + greatest(0, p_t - 15000) / 6000.0);
  a := p_amp * breath * tired;
  x := a * (0.62 * sin(2 * pi() * p_t / 1700.0 + ph[1]) + 0.38 * sin(2 * pi() * p_t / 690.0 + ph[2]));
  y := a * (0.62 * sin(2 * pi() * p_t / 2100.0 + ph[3]) + 0.38 * sin(2 * pi() * p_t / 810.0 + ph[4]));
  return next;
end;
$$;
revoke execute on function public.longshot_sway(int, double precision, int) from public, anon, authenticated;
