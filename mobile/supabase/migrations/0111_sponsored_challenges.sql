-- Hound: sponsored global challenges. A brand can put its name on a
-- Global Hound Challenge, with a one-line message (often a real prize,
-- "Winner gets a $50 gift card") and a link to its site.
--
--   - challenges.sponsor_name / sponsor_message / sponsor_url, global
--     challenges only.
--   - set_challenge_sponsor: admins only, when publishing or later from
--     Admin. A blank name takes the sponsor off.
--   - Anyone signed in can read a global challenge's row already
--     (0075), so the app reads the sponsor alongside its prizes.
--   - Nothing about members goes to the sponsor: the app only opens the
--     link when someone taps it.
--
-- Run this once, after 0001-0110, in the SQL Editor. The app shows no
-- sponsor until it has run.

alter table public.challenges
  add column if not exists sponsor_name text,
  add column if not exists sponsor_message text,
  add column if not exists sponsor_url text;

alter table public.challenges
  drop constraint if exists challenges_sponsor_valid,
  add constraint challenges_sponsor_valid check (
    (sponsor_name is null and sponsor_message is null and sponsor_url is null)
    or (
      is_global
      and char_length(sponsor_name) between 1 and 40
      and (sponsor_message is null or char_length(sponsor_message) between 1 and 100)
      and (sponsor_url is null or (sponsor_url ~ '^https://[^\s]+$' and char_length(sponsor_url) <= 200))
    )
  );

create or replace function public.set_challenge_sponsor(p_challenge_id uuid, p_name text, p_message text, p_url text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
  v_url text := nullif(btrim(coalesce(p_url, '')), '');
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;
  select * into c from public.challenges x where x.id = p_challenge_id for update;
  if not found or not c.is_global then
    raise exception 'Only a global challenge can have a sponsor.';
  end if;
  if v_name is null then
    update public.challenges set sponsor_name = null, sponsor_message = null, sponsor_url = null where id = p_challenge_id;
    return;
  end if;
  if char_length(v_name) > 40 then
    raise exception 'Keep the sponsor''s name to 40 characters.';
  end if;
  if v_message is not null and char_length(v_message) > 100 then
    raise exception 'Keep the sponsor''s message to 100 characters.';
  end if;
  if v_url is not null and (v_url !~ '^https://[^\s]+$' or char_length(v_url) > 200) then
    raise exception 'The sponsor''s link must start with https://';
  end if;
  update public.challenges
    set sponsor_name = v_name, sponsor_message = v_message, sponsor_url = v_url
    where id = p_challenge_id;
end;
$$;

revoke execute on function public.set_challenge_sponsor(uuid, text, text, text) from public, anon;
grant execute on function public.set_challenge_sponsor(uuid, text, text, text) to authenticated;

-- Undo, if needed:
--   drop function public.set_challenge_sponsor(uuid, text, text, text);
--   alter table public.challenges drop constraint challenges_sponsor_valid,
--     drop column sponsor_url, drop column sponsor_message, drop column sponsor_name;
