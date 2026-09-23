-- Testing-only: every new signup is automatically made friends with
-- whichever account(s) are flagged as a "default friend" — so a brand
-- new tester has someone real on their Friends tab from the moment they
-- sign up, and can immediately try inviting them to a challenge, sending
-- kudos, seeing them on a leaderboard, etc. without first having to find
-- and redeem someone else's friend code.
--
-- Same restricted-column shape as is_admin (0021_admin_flag.sql): no
-- in-app way to set it, on purpose. Flip it for whichever test
-- account(s) should play this role directly in the SQL Editor:
--   update public.profiles set is_default_friend = true where email = 'you@example.com';
-- and unset it again once real users no longer need a guaranteed first
-- friend — this is meant to be temporary, for the current testing phase.
alter table public.profiles add column is_default_friend boolean not null default false;
revoke update (is_default_friend) on public.profiles from authenticated, anon;

-- Redefines handle_new_user() wholesale again (same "no alter function
-- body" constraint as 0008/0019) to also friend every new signup with
-- the default-friend account(s) above, on top of everything it already
-- does (profile row, friend code, pending-invite redemption).
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

  -- Excludes new.id itself so a default-friend account signing up
  -- doesn't try to friend itself (friendships has its own
  -- requester_id <> recipient_id check either way, but this avoids
  -- ever hitting it).
  insert into public.friendships (requester_id, recipient_id, status)
  select id, new.id, 'accepted'
  from public.profiles
  where is_default_friend and id <> new.id
  on conflict do nothing;

  return new;
end;
$$;
