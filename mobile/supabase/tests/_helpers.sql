-- Loaded in front of every test file, inside the same transaction, so
-- nothing here outlives a test run.
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
create schema if not exists tests;

-- A real sign-up: inserting into auth.users fires handle_new_user, which
-- creates the profile and friend code exactly as in production.
create or replace function tests.new_user(p_name text, p_admin boolean default false)
returns uuid
language plpgsql
as $$
declare
  uid uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          lower(p_name) || '-' || left(uid::text, 8) || '@test.hound', jsonb_build_object('name', p_name), now(), now());
  if p_admin then
    update public.profiles set is_admin = true where id = uid;
  end if;
  return uid;
end;
$$;

-- Make auth.uid() return this user, the way a signed-in request does.
-- Follow with `set local role authenticated;` and end with `reset role;`.
create or replace function tests.sign_in(p_user uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claim.sub', p_user::text, true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

grant usage on schema tests to authenticated, anon;
grant execute on all functions in schema tests to authenticated, anon;
