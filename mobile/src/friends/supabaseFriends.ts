import { supabase } from '../lib/supabase';
import type { Friend, FriendsProvider } from './types';

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

async function requireUserId(): Promise<string> {
  const { data } = await requireClient().auth.getUser();
  if (!data.user) throw new Error('Sign in to do that.');
  return data.user.id;
}

interface ProfileRef {
  id: string;
  name: string;
  initials: string;
}

interface FriendshipRow {
  id: string;
  requester_id: string;
  recipient_id: string;
  status: Friend['status'];
  requester: ProfileRef | null;
  recipient: ProfileRef | null;
}

const FRIENDSHIP_COLUMNS =
  'id, requester_id, recipient_id, status, ' +
  'requester:profiles!friendships_requester_id_fkey(id, name, initials), ' +
  'recipient:profiles!friendships_recipient_id_fkey(id, name, initials)';

function rowToFriend(row: FriendshipRow, myUserId: string): Friend {
  const iAmRequester = row.requester_id === myUserId;
  const other = iAmRequester ? row.recipient : row.requester;
  return {
    friendshipId: row.id,
    userId: iAmRequester ? row.recipient_id : row.requester_id,
    name: other?.name ?? 'Someone',
    initials: other?.initials ?? '?',
    status: row.status,
    requestedByMe: iAmRequester,
  };
}

export const supabaseFriendsProvider: FriendsProvider = {
  async listFriends(): Promise<Friend[]> {
    const client = requireClient();
    const userId = await requireUserId();
    const { data, error } = await client
      .from('friendships')
      .select(FRIENDSHIP_COLUMNS)
      .or(`requester_id.eq.${userId},recipient_id.eq.${userId}`);
    if (error) throw new Error(error.message);
    return ((data ?? []) as unknown as FriendshipRow[]).map((row) => rowToFriend(row, userId));
  },

  async inviteByEmail(email: string): Promise<void> {
    const client = requireClient();
    const userId = await requireUserId();
    const normalized = email.trim().toLowerCase();

    const { data: target, error: lookupError } = await client
      .from('profiles')
      .select('id')
      .eq('email', normalized)
      .maybeSingle();
    if (lookupError) throw new Error(lookupError.message);

    if (!target) {
      // Nobody's signed up with this email yet — park the invite so it
      // auto-completes as an accepted friendship the moment they do
      // (0008_pending_invites.sql's handle_new_user() redeems it), and
      // try to actually email them now via the send-invite-email Edge
      // Function. A failed send is non-fatal: the invite itself is
      // already durably recorded in pending_invites either way, so this
      // still succeeds even if the function isn't deployed yet or
      // Resend rejects the send.
      const { error: inviteError } = await client
        .from('pending_invites')
        .insert({ inviter_id: userId, email: normalized });
      if (inviteError) {
        if (inviteError.code === '23505') throw new Error('You already invited this email.');
        throw new Error(inviteError.message);
      }
      await client.functions.invoke('send-invite-email', { body: { email: normalized } }).catch(() => {});
      return;
    }
    if (target.id === userId) throw new Error("That's your own email.");

    const { data: existing, error: existingError } = await client
      .from('friendships')
      .select('id, requester_id, status')
      .or(
        `and(requester_id.eq.${userId},recipient_id.eq.${target.id}),` +
          `and(requester_id.eq.${target.id},recipient_id.eq.${userId})`,
      )
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);

    if (existing) {
      if (existing.status === 'accepted') throw new Error("You're already friends.");
      if (existing.requester_id === userId) throw new Error('You already sent this person an invite.');
      // They invited you first — inviting them back just accepts theirs
      // instead of leaving two people each waiting on the other.
      await supabaseFriendsProvider.acceptFriendRequest(existing.id);
      return;
    }

    const { data: created, error } = await client
      .from('friendships')
      .insert({ requester_id: userId, recipient_id: target.id })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    // Best-effort, same reasoning as inviteFriendToChallenge's own email
    // call: the friendship row is already durably written either way,
    // so a failed send here shouldn't surface as "could not send that
    // invite" — target.id is a real Hound user who'll still see the
    // request on their own Friends tab regardless of whether this email
    // arrives.
    client.functions.invoke('send-friend-request-email', { body: { friendshipId: created.id } }).catch(() => {});
  },

  async acceptFriendRequest(friendshipId: string): Promise<void> {
    const client = requireClient();
    const { error } = await client.from('friendships').update({ status: 'accepted' }).eq('id', friendshipId);
    if (error) throw new Error(error.message);
  },

  async removeFriendship(friendshipId: string): Promise<void> {
    const client = requireClient();
    const { error } = await client.from('friendships').delete().eq('id', friendshipId);
    if (error) throw new Error(error.message);
  },
};
