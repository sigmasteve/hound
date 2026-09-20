-- Hound: a durable, shareable "add me" identifier per person — a QR code
-- and URL (https://houndchallenge.net/f/<code>) that embed who's doing
-- the inviting, so whoever opens it always knows "so-and-so wants to add
-- you" without either side needing to already know the other's email.
--
-- Deliberately durable and reusable, not a one-time token: the recipient
-- side of this still goes through the exact same friendships table
-- everything else does, so there's no separate expiry/replay logic to
-- build — anyone who has your code can always try to add you, the same
-- way anyone who has your email already could via inviteByEmail.
--
-- Run this once, after 0001-0018, in the SQL Editor.

-- Excludes visually ambiguous characters (0/O, 1/I/l) since this is
-- meant to be readable/typeable as a fallback to scanning the QR code
-- itself, not just machine-copy-pasted.
create or replace function public.generate_friend_code()
returns text
language plpgsql
as $$
declare
  alphabet text := '23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  code text;
begin
  loop
    code := '';
    for i in 1..8 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.profiles where friend_code = code);
  end loop;
  return code;
end;
$$;

alter table public.profiles add column friend_code text unique;
update public.profiles set friend_code = public.generate_friend_code() where friend_code is null;
alter table public.profiles alter column friend_code set not null;

-- Redefines 0008's handle_new_user() wholesale again (same "no alter
-- function body" constraint as that migration) to also mint a code for
-- every new signup, not just existing rows via the backfill above.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name, initials, email, friend_code)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    upper(left(coalesce(new.raw_user_meta_data->>'name', new.email), 1)),
    new.email,
    public.generate_friend_code()
  );

  insert into public.friendships (requester_id, recipient_id, status)
  select inviter_id, new.id, 'accepted'
  from public.pending_invites
  where email = new.email and inviter_id <> new.id
  on conflict do nothing;

  delete from public.pending_invites where email = new.email;

  return new;
end;
$$;

-- The actual redeem step, called from the app as a single RPC rather
-- than a plain insert — friendships' own insert policy only lets a
-- caller insert a row where *they* are requester_id, but redeeming
-- someone else's code has to create a row where *they* (the code's
-- owner) are the requester and the caller is the recipient (see this
-- migration's own comment on the QR/link's whole point: it embeds who's
-- doing the inviting). A security definer function is what safely lets
-- the caller do that, instead of widening the insert policy to let
-- anyone insert a row naming any requester_id they like.
create or replace function public.add_friend_by_code(code text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  owner_id uuid;
  me uuid := auth.uid();
  existing record;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;

  select id into owner_id from public.profiles where friend_code = code;
  if owner_id is null then
    raise exception 'That code doesn''t match anyone on Hound.';
  end if;
  if owner_id = me then
    raise exception 'That''s your own code.';
  end if;

  select id, status into existing
  from public.friendships
  where (requester_id = owner_id and recipient_id = me)
     or (requester_id = me and recipient_id = owner_id)
  limit 1;

  if found then
    if existing.status = 'accepted' then
      raise exception 'You''re already friends.';
    end if;
    -- Either direction, an existing pending row between the same two
    -- people just needed one side to say yes — redeeming a code is that
    -- "yes," same as inviteByEmail accepting the other side's invite
    -- instead of leaving two rows or two people each waiting.
    update public.friendships set status = 'accepted' where id = existing.id;
    return;
  end if;

  -- Scanning/opening someone's own code is a deliberate, already-mutual
  -- act (unlike an async email invite, which genuinely needs a separate
  -- accept step) — inserted straight as 'accepted', not 'pending'.
  insert into public.friendships (requester_id, recipient_id, status)
  values (owner_id, me, 'accepted');
end;
$$;

grant execute on function public.add_friend_by_code(text) to authenticated;

-- For the (not-yet-built) houndchallenge.net/f/<code> landing page a
-- visitor with no Hound account and no session hits when they open the
-- link — needs to resolve a code to "so-and-so invited you" without any
-- of the auth profiles' own select policy requires. Exposes only
-- name/initials, never email or id.
create or replace function public.friend_code_owner_name(code text)
returns table(name text, initials text)
language sql
security definer set search_path = public
stable
as $$
  select name, initials from public.profiles where friend_code = code;
$$;

grant execute on function public.friend_code_owner_name(text) to anon, authenticated;
