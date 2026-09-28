-- Hound: push notifications for friend requests — a real gap found
-- while reviewing the app, not a deliberate omission. inviteByEmail()
-- (supabaseFriends.ts) already emails a new request via
-- send-friend-request-email, but nothing at all notifies either side
-- of the two moments that actually matter in the moment: getting a new
-- request, and having your own request accepted. Same event-driven
-- push shape 0048/0057 already established for Tag/Tic-Tac-Go — a
-- trigger calls this notify helper via pg_net, wrapped so a
-- notification failure (pg_net missing, no vault secret, network)
-- never rolls back the friendship write that triggered it.
--
-- Run this once, after 0001-0064, in the SQL Editor.

create or replace function public.friend_notify(p_kind text, p_friendship_id uuid, p_recipient uuid, p_actor uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://vaypjksgpuuopqvurcus.supabase.co/functions/v1/send-friend-push-notification',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'kind', p_kind,
      'friendship_id', p_friendship_id,
      'recipient_id', p_recipient,
      'actor_id', p_actor
    )
  );
exception when others then
  null;
end;
$$;

-- Internal only: Postgres grants EXECUTE to PUBLIC by default, which
-- would let any signed-in user push arbitrary notifications through RPC
-- — same fix 0057's own tictacgo_notify already needed.
revoke execute on function public.friend_notify(text, uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.friendships_after_insert()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  perform public.friend_notify('request', new.id, new.recipient_id, new.requester_id);
  return new;
end;
$$;

create trigger friendships_after_insert
  after insert on public.friendships
  for each row execute procedure public.friendships_after_insert();

-- status only ever moves 'pending' -> 'accepted' — 0007_friendships.sql's
-- own check constraint has no other value it could become — so this
-- fires exactly once per friendship, on the one transition that means
-- anything to notify about.
create or replace function public.friendships_after_accept()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if old.status = 'pending' and new.status = 'accepted' then
    perform public.friend_notify('accepted', new.id, new.requester_id, new.recipient_id);
  end if;
  return new;
end;
$$;

create trigger friendships_after_accept
  after update on public.friendships
  for each row execute procedure public.friendships_after_accept();
