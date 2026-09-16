-- Hound: let inviting a friend by email who hasn't signed up for Hound
-- yet actually go somewhere. 0007_friendships.sql's inviteByEmail()
-- could only ever connect two people who already both had accounts —
-- an email with no matching profile just errored. This adds a place to
-- park that invite and extends the profile-creation trigger to redeem
-- it automatically the moment that email does sign up, so accepting
-- the invite and becoming friends happen in the same step.
--
-- The actual email send is a separate piece — see
-- supabase/functions/send-invite-email — since sending real email needs
-- a provider API key that can't live in this repo or the client app.
--
-- Run this once, after 0001-0007, in the SQL Editor.

create table public.pending_invites (
  id uuid primary key default gen_random_uuid(),
  inviter_id uuid not null references public.profiles (id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  unique (inviter_id, email)
);

alter table public.pending_invites enable row level security;

create policy "Users can view their own outgoing invites"
  on public.pending_invites for select
  to authenticated
  using (inviter_id = auth.uid());

create policy "Users can create their own outgoing invites"
  on public.pending_invites for insert
  to authenticated
  with check (inviter_id = auth.uid());

create policy "Users can withdraw their own outgoing invites"
  on public.pending_invites for delete
  to authenticated
  using (inviter_id = auth.uid());

-- Redefines 0001's handle_new_user() wholesale (Postgres has no "alter
-- function body", only a full replace) to add one step after creating
-- the new profile: connect the new user, already 'accepted', to
-- whoever's pending_invites row matches their email. `inviter_id <>
-- new.id` guards against a self-invite (sent before this email had an
-- account) tripping friendships' own `check (requester_id <>
-- recipient_id)` and aborting the whole signup. Runs as security
-- definer, same as before, so it isn't blocked by pending_invites' or
-- friendships' own RLS — a brand-new user has no session yet to satisfy
-- either policy's auth.uid() check.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name, initials, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    upper(left(coalesce(new.raw_user_meta_data->>'name', new.email), 1)),
    new.email
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
