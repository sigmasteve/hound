-- Hound: Today's one line (Steve, Nov 2026; mock-up
-- claude.ai/artifact/GJqj1VqeT3YxacL57rznFR, version A): the day in one
-- sentence at the top of Today, each fact a link, and once a day at a
-- random moment the hound says it. Worked out on the phone; this only
-- lets note_today_tap count it, for Admin → Overview → Status → Customize
-- Today: taps on each kind of link, and the days the hound said it.
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

-- To undo: note_today_tap as in 0281.
