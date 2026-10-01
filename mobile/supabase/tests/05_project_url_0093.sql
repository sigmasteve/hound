-- 0093: every push and scheduled job calls this project's own functions.
select plan(4);

select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosrc ~ 'supabase\.co/functions/v1/'),
  0, 'No database function has a project address written into it');
select is((select count(*)::int from cron.job where command ~ 'supabase\.co/functions/v1/'),
  0, 'No scheduled job has a project address written into it');

delete from vault.secrets where name = 'project_url';
select vault.create_secret('https://abcdefghijklmnop.supabase.co/', 'project_url');
select is(public.edge_function_url('send-social-push'),
  'https://abcdefghijklmnop.supabase.co/functions/v1/send-social-push',
  'Function addresses come from the project_url secret');
select ok(not has_function_privilege('authenticated', 'public.edge_function_url(text)', 'EXECUTE'),
  'Signed-in users cannot read the project address helper');

select * from finish();
