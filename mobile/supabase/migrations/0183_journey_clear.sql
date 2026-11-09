-- Hound: take a finished Journey off Today (Steve: "If I'm done, I
-- should be able to have nothing displayed to give me back space on
-- Today").
--
-- end_journey() only ended a Journey still on the go, so a finished one
-- stayed "your Journey" (my_journey returns it, and Today shows its
-- tile) until you started another. Now it ends whichever one you're on,
-- finished or not. A finished one keeps its finish: the medal, your
-- count of courses finished, and friends seeing you finished.
--
-- Run this once, after 0182, in the SQL Editor, before publishing the
-- app update that goes with it.
--
-- Undo, if needed: re-run end_journey from 0120.

create or replace function public.end_journey()
returns void
language sql
security definer set search_path = public
as $$
  update public.journeys j set ended_at = now()
    where j.user_id = auth.uid() and j.ended_at is null;
$$;

revoke execute on function public.end_journey() from public, anon;
grant execute on function public.end_journey() to authenticated;
