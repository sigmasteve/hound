export type FriendshipStatus = 'pending' | 'accepted';

// The web landing page a friend code's QR/link points at — see
// 0019_friend_codes.sql. Not yet built (that's the site/ directory's
// own follow-up), but the URL shape is fixed here since both the app
// (generating it) and that page (reading its own path) need to agree on
// it independently.
const FRIEND_CODE_URL_PREFIX = 'https://houndchallenge.net/f/';

export function friendCodeUrl(code: string): string {
  return `${FRIEND_CODE_URL_PREFIX}${code}`;
}

// Accepts either a bare code or a full pasted link — someone redeeming a
// friend's code by hand (no camera scan) is just as likely to paste the
// whole URL they were sent as the code by itself.
export function extractFriendCode(input: string): string {
  const trimmed = input.trim();
  return trimmed.startsWith(FRIEND_CODE_URL_PREFIX) ? trimmed.slice(FRIEND_CODE_URL_PREFIX.length) : trimmed;
}

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
  // This friend's own profiles.organization_id (0035_organizations.sql),
  // straight through — null means they're not in an org. Friendships
  // themselves stay global/unscoped (see GitHub issue #158): this exists
  // so CreateScreen's own org-vs-global friend picker can tell "in my
  // org" apart from "not," it's not a restriction on who can be friends.
  organizationId: string | null;
  // This friend's own equipped cosmetics (profiles.equipped_frame_id/
  // equipped_background_id — 0059_cosmetics.sql), straight through to
  // Avatar's own frameId/backgroundId props — see GitHub issue #229's
  // first fast-follow.
  frameId: string | null;
  backgroundId: string | null;
  iconId: string | null;
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
  // Sends a request straight to a known Hound user (e.g. someone on a
  // shared challenge leaderboard) — same one-row-per-pair handling as
  // inviteByEmail: accepts their pending invite instead if they sent one
  // first, and errors if you're already friends or already asked.
  sendFriendRequest(userId: string): Promise<void>;
  acceptFriendRequest(friendshipId: string): Promise<void>;
  // Declining a pending invite and unfriending someone are the same
  // operation on this schema — there's only one row per pair either way.
  removeFriendship(friendshipId: string): Promise<void>;
  // This user's own durable "add me" code (see 0019_friend_codes.sql) —
  // every account has one, minted at signup, so this never needs a
  // "generate mine" step.
  getMyFriendCode(): Promise<string>;
  // Redeems someone else's code (accepts either the bare code or a full
  // friendCodeUrl(...) link — see extractFriendCode). Unlike
  // inviteByEmail, this connects immediately as 'accepted': opening
  // someone's own code is a deliberate, already-mutual act, not an async
  // invite that still needs a separate accept step.
  addFriendByCode(code: string): Promise<void>;
  // How many kudos have passed between the caller and this friend, each
  // direction (see 0020_friend_kudos.sql) — unlimited and un-doable, so
  // this is just a running count, not a list of individual events.
  getKudosCounts(friendUserId: string): Promise<KudosCounts>;
  giveKudos(friendUserId: string): Promise<void>;
}

export interface KudosCounts {
  given: number;
  received: number;
  // Already gave this friend kudos in the last 20 hours — the most
  // allowed (0089_username_filter_kudos_limit.sql).
  givenRecently: boolean;
}

// The server's refusal for a second kudos within 20 hours (0089).
export const KUDOS_LIMIT_MESSAGE = 'Already gave kudos today. You can give more tomorrow.';
export const KUDOS_COOLDOWN_MS = 20 * 3_600_000;
