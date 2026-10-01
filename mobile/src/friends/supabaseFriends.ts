import { supabase } from '../lib/supabase';
import { isMissingFunction } from '../lib/rpcFallback';
import { extractFriendCode, KUDOS_COOLDOWN_MS, type Friend, type FriendsProvider, type KudosCounts } from './types';

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
  organization_id: string | null;
  equipped_frame_id: string | null;
  equipped_background_id: string | null;
  equipped_icon_id: string | null;
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
  'requester:profiles!friendships_requester_id_fkey(id, name, initials, organization_id, equipped_frame_id, equipped_background_id, equipped_icon_id), ' +
  'recipient:profiles!friendships_recipient_id_fkey(id, name, initials, organization_id, equipped_frame_id, equipped_background_id, equipped_icon_id)';

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
    organizationId: other?.organization_id ?? null,
    frameId: other?.equipped_frame_id ?? null,
    backgroundId: other?.equipped_background_id ?? null,
    iconId: other?.equipped_icon_id ?? null,
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

    // Who has this address. Other people's emails aren't readable directly
    // (0092_hide_private_profile_columns.sql), so this asks the server;
    // before 0091 has run, the direct lookup still works.
    let target: { id: string } | null = null;
    const { data: foundId, error: rpcError } = await client.rpc('profile_id_for_email', { p_email: normalized });
    if (!rpcError) {
      target = foundId ? { id: foundId as string } : null;
    } else if (isMissingFunction(rpcError)) {
      const { data, error: lookupError } = await client.from('profiles').select('id').eq('email', normalized).maybeSingle();
      if (lookupError) throw new Error(lookupError.message);
      target = data;
    } else {
      throw new Error(rpcError.message);
    }

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
    await supabaseFriendsProvider.sendFriendRequest(target.id);
  },

  async sendFriendRequest(targetUserId: string): Promise<void> {
    const client = requireClient();
    const userId = await requireUserId();
    if (targetUserId === userId) throw new Error("You can't friend yourself.");

    const { data: existing, error: existingError } = await client
      .from('friendships')
      .select('id, requester_id, status')
      .or(
        `and(requester_id.eq.${userId},recipient_id.eq.${targetUserId}),` +
          `and(requester_id.eq.${targetUserId},recipient_id.eq.${userId})`,
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
      .insert({ requester_id: userId, recipient_id: targetUserId })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    // Best-effort, same reasoning as inviteFriendToChallenge's own email
    // call: the friendship row is already durably written either way,
    // so a failed send here shouldn't surface as "could not send that
    // invite" — the recipient is a real Hound user who'll still see the
    // request on their own Friends tab regardless of whether this email
    // arrives. (The push notification rides friendships' own insert
    // trigger — 0065_friend_push_notifications.sql.)
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

  async getMyFriendCode(): Promise<string> {
    const client = requireClient();
    const userId = await requireUserId();
    // Friend codes aren't readable from the profile table any more
    // (0092_hide_private_profile_columns.sql) — your own comes from
    // my_friend_code(); before 0091 has run, the direct read still works.
    const { data: code, error: rpcError } = await client.rpc('my_friend_code');
    if (!rpcError) return code as string;
    if (!isMissingFunction(rpcError)) throw new Error(rpcError.message);
    const { data, error } = await client.from('profiles').select('friend_code').eq('id', userId).single();
    if (error) throw new Error(error.message);
    return data.friend_code;
  },

  async addFriendByCode(code: string): Promise<void> {
    const client = requireClient();
    await requireUserId();
    const { error } = await client.rpc('add_friend_by_code', { code: extractFriendCode(code) });
    if (error) throw new Error(error.message);
  },

  async getKudosCounts(friendUserId: string): Promise<KudosCounts> {
    const client = requireClient();
    const userId = await requireUserId();
    const [given, received, recent] = await Promise.all([
      client.from('kudos').select('id', { count: 'exact', head: true }).eq('giver_id', userId).eq('receiver_id', friendUserId),
      client.from('kudos').select('id', { count: 'exact', head: true }).eq('giver_id', friendUserId).eq('receiver_id', userId),
      client
        .from('kudos')
        .select('id', { count: 'exact', head: true })
        .eq('giver_id', userId)
        .eq('receiver_id', friendUserId)
        .gt('created_at', new Date(Date.now() - KUDOS_COOLDOWN_MS).toISOString()),
    ]);
    if (given.error) throw new Error(given.error.message);
    if (received.error) throw new Error(received.error.message);
    return { given: given.count ?? 0, received: received.count ?? 0, givenRecently: (recent.count ?? 0) > 0 };
  },

  async giveKudos(friendUserId: string): Promise<void> {
    const client = requireClient();
    const userId = await requireUserId();
    const { error } = await client.from('kudos').insert({ giver_id: userId, receiver_id: friendUserId });
    if (error) throw new Error(error.message);
  },
};
