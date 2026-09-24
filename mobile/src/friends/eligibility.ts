import type { Friend } from './types';

// The org-vs-global friend picker's whole rule (see GitHub issue #158's
// design decision): "org" friends are the ones who share the relevant
// org — everyone else (no org, or a different org) is "global." Used
// both when picking friends for a brand-new challenge (CreateScreen,
// keyed off the draft's chosen scope) and when inviting someone into an
// existing one later (ChallengeDetailScreen, keyed off that challenge's
// own organizationId) — the same partition either way: an org-scoped
// challenge only ever invites that org's own members, and a global one
// only ever invites people outside whichever org is relevant, not
// everyone regardless of org.
//
// Only meaningful once there's a real org to compare against (orgId
// non-null) — no org in play at all (an individual creator/inviter with
// no organization of their own, on a global challenge) means every
// friend stays selectable regardless of what org, if any, that friend
// is in; callers skip calling this entirely in that case rather than
// passing an empty string.
export function friendEligible(friend: Friend, scope: 'global' | 'org', orgId: string): boolean {
  const sharesOrg = friend.organizationId === orgId;
  return scope === 'org' ? sharesOrg : !sharesOrg;
}
