-- 0254: Long Shot's arms tire after 15 s, not 9. The app's longshotSway
-- (longshotApi.ts) gives these same numbers.
select plan(4);

select is((select round(x::numeric, 5) || ',' || round(y::numeric, 5) from public.longshot_sway(48213, 1.2, 3000)), '0.20932,-0.31547',
  'Sway at 3 s matches the app');
select is((select round(x::numeric, 5) || ',' || round(y::numeric, 5) from public.longshot_sway(48213, 1.2, 12000)), '-0.20848,0.10629',
  'At 12 s it matches the app (no tiring yet)');
select is((select round(x::numeric, 5) || ',' || round(y::numeric, 5) from public.longshot_sway(48213, 1.2, 20000)), '0.89828,-0.88739',
  'At 20 s it matches the app (tiring)');
-- At 12 s, before 0254 the sway was half as big again (tired 1.5); now it's the untired size.
select ok((select abs(x) from public.longshot_sway(48213, 1.2, 12000)) < 0.3, 'Not tired at 12 s');

select * from finish();
