-- Hound: Admin → Social → Community challenges couldn't save a switch or
-- a limit ("UPDATE requires a WHERE clause").
--
-- 0152's admin_set_community_config updated its one-row settings table
-- with no WHERE. Supabase's API connections load pg-safeupdate, which
-- refuses any UPDATE or DELETE without one, even inside a function.
-- The tests ran without it and missed it; setup-db.sh now loads it for
-- the tests too, the way the API does.
--
-- Run this once, after 0001-0154, in the SQL Editor.

create or replace function public.admin_set_community_config(p jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  perform public.community_require_admin();
  update public.community_config cfg set
    enabled = coalesce((p ->> 'enabled')::boolean, cfg.enabled),
    pre_review = coalesce((p ->> 'pre_review')::boolean, cfg.pre_review),
    age_gate = coalesce((p ->> 'age_gate')::boolean, cfg.age_gate),
    min_level = coalesce((p ->> 'min_level')::int, cfg.min_level),
    min_account_days = coalesce((p ->> 'min_account_days')::int, cfg.min_account_days),
    max_live = coalesce((p ->> 'max_live')::int, cfg.max_live),
    max_per_week = coalesce((p ->> 'max_per_week')::int, cfg.max_per_week),
    max_players = coalesce((p ->> 'max_players')::int, cfg.max_players),
    max_joined = coalesce((p ->> 'max_joined')::int, cfg.max_joined),
    report_threshold = coalesce((p ->> 'report_threshold')::int, cfg.report_threshold),
    wrong_codes_per_hour = coalesce((p ->> 'wrong_codes_per_hour')::int, cfg.wrong_codes_per_hour),
    updated_at = now()
  where cfg.id;
end;
$$;
revoke execute on function public.admin_set_community_config(jsonb) from public, anon;
grant execute on function public.admin_set_community_config(jsonb) to authenticated;
