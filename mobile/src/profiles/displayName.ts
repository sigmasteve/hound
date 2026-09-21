// The one place that decides "real name or username" for showing
// someone ELSE'S identity — leaderboards, participant lists, challenge
// invites, and the co-participant alert emails/pushes (see
// 0030_username.sql). Every one of those call sites already fetches
// `name`/`initials` alongside a profile join; this just picks between
// that and the pseudonym once, here, so nothing downstream (board.ts,
// HomeScreen's rival/hunter copy, ChallengesScreen's rows, ...) needs to
// know usernames exist at all — they just keep reading `.name`/
// `.initials` as opaque strings.
//
// Deliberately NOT used for: the Friends screen (you already know who
// you added), or your own Settings account card (that's your own real
// account, not another user's view of you).

export interface DisplayableProfile {
  name: string;
  username?: string | null;
  useUsername?: boolean | null;
}

export function displayName(p: DisplayableProfile): string {
  return p.useUsername && p.username ? p.username : p.name;
}

export function displayInitials(p: DisplayableProfile & { initials: string }): string {
  return p.useUsername && p.username ? initialsFromUsername(p.username) : p.initials;
}

// A username is one token, not "First Last" — first-two-characters is
// the natural analog of a real name's one-letter-per-word initials.
function initialsFromUsername(username: string): string {
  return username.slice(0, 2).toUpperCase();
}
