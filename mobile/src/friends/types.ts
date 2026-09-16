export type FriendshipStatus = 'pending' | 'accepted';

export interface Friend {
  friendshipId: string;
  userId: string;
  name: string;
  initials: string;
  status: FriendshipStatus;
  // Only meaningful while status === 'pending' — whether *I* sent this
  // invite (so the UI shows "Invite sent", not "Accept/Decline") or the
  // other person did (so I get to accept or decline it).
  requestedByMe: boolean;
}

export interface FriendsProvider {
  // Every real friendship the current user is party to, accepted and
  // pending in both directions — the screen splits these into "Friends"
  // and "Pending" itself rather than the provider doing it, same
  // reasoning as ChallengesProvider's raw-rows convention.
  listFriends(): Promise<Friend[]>;
  // Looks up a Hound account by email and sends a request. If that
  // person already sent *you* one, this accepts it instead of creating
  // a second, redundant row — either way you end the call as friends or
  // with one pending invite between you, never two. If nobody's signed
  // up with that email yet, this parks the invite and emails them
  // instead of erroring — see 0008_pending_invites.sql and
  // supabase/functions/send-invite-email.
  inviteByEmail(email: string): Promise<void>;
  acceptFriendRequest(friendshipId: string): Promise<void>;
  // Declining a pending invite and unfriending someone are the same
  // operation on this schema — there's only one row per pair either way.
  removeFriendship(friendshipId: string): Promise<void>;
}
