-- 0111: an admin can put a sponsor on a global challenge, with a checked
-- link; nobody else can, and an ordinary challenge can't have one.
select plan(7);

select tests.new_user('Ada', true) as ada \gset
select tests.new_user('Bob') as bob \gset
\set g '66666666-0000-0000-0000-000000000001'
\set n '66666666-0000-0000-0000-000000000002'

insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, is_global) values
  (:'g', 'November Step Race', 'steps', :'ada', 7, now(), now() + interval '7 days', true),
  (:'n', 'Bob''s race', 'steps', :'bob', 7, now(), now() + interval '7 days', false);

select tests.sign_in(:'ada');
set local role authenticated;
select lives_ok(format($q$select public.set_challenge_sponsor(%L, ' Acme ', 'Winner gets a $50 gift card', 'https://acme.example')$q$, :'g'),
  'An admin can sponsor a global challenge');
select is((select sponsor_name from public.challenges where id = :'g'), 'Acme', 'The name is saved, trimmed');
select throws_ok(format($q$select public.set_challenge_sponsor(%L, 'Acme', null, 'http://acme.example')$q$, :'g'),
  'The sponsor''s link must start with https://', 'A link must be https');
select throws_ok(format($q$select public.set_challenge_sponsor(%L, 'Acme', null, null)$q$, :'n'),
  'Only a global challenge can have a sponsor.', 'An ordinary challenge can''t have a sponsor');
select lives_ok(format($q$select public.set_challenge_sponsor(%L, '', null, null)$q$, :'g'), 'A blank name');
select is((select sponsor_name from public.challenges where id = :'g'), null, 'takes the sponsor off');
reset role;

select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok(format($q$select public.set_challenge_sponsor(%L, 'Bob Co', null, null)$q$, :'g'),
  'not authorized', 'Someone who isn''t an admin can''t');
reset role;

select * from finish();
