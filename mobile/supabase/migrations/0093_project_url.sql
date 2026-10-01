-- Hound: call this project's own edge functions, not production's.
--
-- Push notifications and scheduled jobs call edge functions over HTTP.
-- Until now the address was written into each function and job:
-- production's (vaypjksgpuuopqvurcus) in tictacgo_notify, tag_check_catch,
-- tag_settle_timeout, friend_notify, social_notify and admin_signup_notify
-- and the sign-up digest job, and a <project-ref> placeholder in the three
-- jobs from 0010 and 0025. A staging or test database built from these
-- files would have sent its pushes to production's functions.
--
-- Now every call asks edge_function_url('send-...'), which reads this
-- project's address from the Vault secret 'project_url', for example
-- https://vaypjksgpuuopqvurcus.supabase.co. Nothing else changes: same
-- functions, same jobs, same schedules, same service-role key secret.
--
-- Production: the secret is created automatically from the address its
-- scheduled jobs already use, so there is nothing to set by hand.
-- A new project (staging): create it once in the SQL Editor:
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
-- Until it exists, pushes from that project are skipped (each call is
-- already inside an error handler, so nothing else is affected).
--
-- Safe to run twice. Run it once, after 0092 (or after 0091 if 0092 is
-- still waiting), in the SQL Editor.

create or replace function public.edge_function_url(fn text)
returns text
language sql
stable
set search_path = public
as $$
  select rtrim(decrypted_secret, '/') || '/functions/v1/' || fn
  from vault.decrypted_secrets
  where name = 'project_url'
  limit 1;
$$;

revoke execute on function public.edge_function_url(text) from public, anon, authenticated;

-- Production already knows its own address: the login-reminder, stale-data
-- and daily-standings jobs were edited by hand to use it. A new project
-- still has the <project-ref> placeholder there, which doesn't match, so
-- nothing is guessed for it.
do $$
declare
  u text;
begin
  if not exists (select 1 from vault.secrets where name = 'project_url') then
    select substring(command from 'https://[a-z0-9]+\.supabase\.co')
      into u
      from cron.job
      where jobname in ('hound-daily-login-reminder', 'hound-stale-data-alert', 'hound-daily-standings-alert')
        and command ~ 'https://[a-z0-9]+\.supabase\.co'
      limit 1;
    if u is not null then
      perform vault.create_secret(u, 'project_url');
    end if;
  end if;
end $$;

-- Every function that calls an edge function by a written-in address is
-- recreated with edge_function_url() in its place. The rest of each
-- function is untouched: the definition is read back from the database
-- and only the address is replaced.
do $$
declare
  r record;
  def text;
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosrc ~ '''https://[^'']*\.supabase\.co/functions/v1/[a-z0-9-]+'''
  loop
    def := regexp_replace(
      pg_get_functiondef(r.oid),
      '''https://[^'']*\.supabase\.co/functions/v1/([a-z0-9-]+)''',
      'public.edge_function_url(''\1'')',
      'g'
    );
    execute def;
  end loop;
end $$;

-- Same for the scheduled jobs.
do $$
declare
  j record;
begin
  for j in
    select jobid, command from cron.job
    where command ~ '''https://[^'']*\.supabase\.co/functions/v1/[a-z0-9-]+'''
  loop
    perform cron.alter_job(
      job_id := j.jobid,
      command := regexp_replace(
        j.command,
        '''https://[^'']*\.supabase\.co/functions/v1/([a-z0-9-]+)''',
        'public.edge_function_url(''\1'')',
        'g'
      )
    );
  end loop;
end $$;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'project_url') then
    raise notice 'No project_url secret yet. Pushes and scheduled emails from this project are skipped until you run: select vault.create_secret(''https://<project-ref>.supabase.co'', ''project_url'');';
  end if;
end $$;
