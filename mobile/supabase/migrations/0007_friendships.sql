-- Hound: a real friend graph, replacing FriendsScreen's static
-- src/data/sampleData.ts list.
--
-- One row per requested friendship, not two — accepting flips the same
-- row's status rather than inserting a mirror row, so there's exactly
-- one place to look up whether two people are already connected (in
-- either direction) or have a pending invite between them.
--
-- Run this once, after 0001-0006, in the SQL Editor.

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  check (requester_id <> recipient_id)
);

-- One row per pair regardless of direction, so A inviting B while B is
-- separately inviting A can't produce two pending rows. supabaseFriends.ts's
-- inviteByEmail() still checks both directions before inserting and
-- accepts the other side's existing invite when there is one, so that
-- race resolves as "you're now friends" instead of a constraint error.
create unique index friendships_pair_idx
  on public.friendships (least(requester_id, recipient_id), greatest(requester_id, recipient_id));

alter table public.friendships enable row level security;

create policy "Users can view their own friendships"
  on public.friendships for select
  to authenticated
  using (requester_id = auth.uid() or recipient_id = auth.uid());

create policy "Users can send a friend request"
  on public.friendships for insert
  to authenticated
  with check (requester_id = auth.uid());

-- Only the recipient can accept — the requester flipping their own
-- pending row to 'accepted' would let them befriend someone without
-- that person ever agreeing.
create policy "Recipients can accept a friend request"
  on public.friendships for update
  to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid() and status = 'accepted');

-- Either side can end a friendship, or the requester can withdraw a
-- pending invite, or the recipient can decline one.
create policy "Either side can remove a friendship"
  on public.friendships for delete
  to authenticated
  using (requester_id = auth.uid() or recipient_id = auth.uid());
