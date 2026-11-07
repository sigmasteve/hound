-- 0176: Health connected ticks on the phone's word, before any steps.
select plan(3);

select tests.new_user('Ann') as ann \gset
select tests.sign_in(:'ann');
set local role authenticated;
select is((select health_connected from public.onboarding_status()), false, 'Not connected, no steps: unticked');
select public.mark_health_connected();
select is((select health_connected from public.onboarding_status()), true, 'Connected, still no steps: ticked');
select throws_ok($$update public.profiles set health_connected_at = null where id = auth.uid()$$, '42501', null, 'Not something a member sets by hand');
reset role;

select * from finish();
