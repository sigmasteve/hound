-- Hound: Today's one line (Steve, Nov 2026; mock-up
-- claude.ai/artifact/GJqj1VqeT3YxacL57rznFR, version A): the day in one
-- sentence at the top of Today, each fact a link, and once a day at a
-- random moment the hound says it. Worked out on the phone; this lets
-- note_today_tap count it (taps on each kind of link, and the days the
-- hound said it), and makes it a Customize Today switch: 'one_line', on
-- unless turned off (set_today_prefs takes it; Admin → Overview → Status
-- → Customize Today says how many turned it off).
--
-- Run this once, after 0282, in the SQL Editor.

create or replace function public.note_today_tap(p_what text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  today date;
begin
  if caller is null then
    raise exception 'Sign in to do that.';
  end if;
  if p_what is null or p_what not in (
    'steps', 'fasting', 'move', 'water', 'customize',
    'upnext', 'play_start', 'play_turn', 'play_done', 'play_stop',
    'try_seen', 'try_open', 'try_join', 'try_dismiss', 'hound_strip',
    'line_steps', 'line_fast', 'line_games', 'line_starter', 'line_streak', 'line_hound', 'line_spoken'
  ) then
    return;
  end if;
  select (now() at time zone coalesce(nullif(p.time_zone, ''), 'UTC'))::date into today
    from public.profiles p where p.id = caller;
  insert into public.today_taps (user_id, day, what, n)
    values (caller, coalesce(today, (now() at time zone 'UTC')::date), p_what, 1)
    on conflict (user_id, day, what) do update set n = public.today_taps.n + 1;
end;
$$;

revoke execute on function public.note_today_tap(text) from public, anon;
grant execute on function public.note_today_tap(text) to authenticated;

-- Customize Today's switch for it.
create or replace function public.set_today_prefs(p_prefs jsonb)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  allowed constant text[] := array['week', 'rank', 'journey', 'fasting_card', 'holiday', 'hound_top', 'one_line'];
  cleaned jsonb;
begin
  if caller is null then
    raise exception 'Sign in to do that.';
  end if;
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into cleaned
    from jsonb_each(case when jsonb_typeof(p_prefs) = 'object' then p_prefs else '{}'::jsonb end) e
    where e.key = any (allowed) and jsonb_typeof(e.value) = 'boolean';
  insert into public.today_prefs (user_id, prefs, updated_at)
    values (caller, cleaned, now())
    on conflict (user_id) do update set prefs = excluded.prefs, updated_at = now();
  return cleaned;
end;
$$;

revoke execute on function public.set_today_prefs(jsonb) from public, anon;
grant execute on function public.set_today_prefs(jsonb) to authenticated;

create or replace function public.admin_today_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
  since date := (now() at time zone 'UTC')::date - 7;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;

  select jsonb_build_object(
    -- An extra on (the one line is on unless turned off, so it doesn't count).
    'customized', (select count(*) from public.today_prefs t where exists (select 1 from jsonb_each(t.prefs - 'one_line') e where e.value = 'true'::jsonb)),
    -- 0283: the one line turned off.
    'line_off', (select count(*) from public.today_prefs t where t.prefs -> 'one_line' = 'false'::jsonb),
    'saved', (select count(*) from public.today_prefs),
    'customized_7d', (select count(*) from public.today_prefs t where t.updated_at >= now() - interval '7 days'),
    'extras', (
      select jsonb_object_agg(k, (select count(*) from public.today_prefs t where t.prefs -> k = 'true'::jsonb))
      from unnest(array['week', 'rank', 'journey', 'fasting_card', 'holiday', 'hound_top']) k
    ),
    'taps_7d', coalesce((
      select jsonb_object_agg(what, jsonb_build_object('people', people, 'taps', taps))
      from (
        select what, count(distinct user_id) as people, sum(n) as taps
        from public.today_taps where day > since group by what
      ) g
    ), '{}'::jsonb),
    'tapped_ever', (select count(distinct user_id) from public.today_taps where what <> 'customize')
  ) into result;
  return result;
end;
$$;

revoke execute on function public.admin_today_overview() from public, anon;
grant execute on function public.admin_today_overview() to authenticated;

-- To undo: note_today_tap as in 0281; set_today_prefs and
-- admin_today_overview as in 0278.
