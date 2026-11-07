-- 0175: Other is kept among the welcome wizard's interests; anything else
-- unknown is still dropped.
select plan(1);

select tests.new_user('Ann') as ann \gset
select tests.sign_in(:'ann');
set local role authenticated;
select public.save_hound_uses(array['steps', 'other', 'nonsense']);
reset role;
select is((select hound_uses from public.profiles where id = :'ann'), array['other', 'steps'], 'Other is kept, nonsense dropped');

select * from finish();
