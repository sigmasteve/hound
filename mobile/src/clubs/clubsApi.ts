import { supabase } from '../lib/supabase';
import type { ChallengeKind } from '../challenges/types';

// Clubs (0185): run clubs, cycling clubs, walking groups. Members post
// challenges to their clubs; the rest of the club sees them and joins.
// A club never narrows who you can play with.

export type ClubSport = 'running' | 'cycling' | 'walking' | 'hiking' | 'swimming' | 'mixed';
export type ClubColor = 'orange' | 'blue' | 'green' | 'purple' | 'red' | 'teal';
export type ClubRole = 'owner' | 'organizer' | 'member';

// The kinds that can be posted to a club (club_kind_ok on the server).
export const CLUB_KINDS: ChallengeKind[] = ['steps', 'streak', 'distance', 'bingo', 'seventyfive', 'journey', 'checklist', 'houndopoly', 'hunt'];

export interface Club {
  id: string;
  name: string;
  sport: ClubSport;
  city: string | null;
  description: string | null;
  color: ClubColor;
  isPublic: boolean;
  members: number;
  // Null when you're not in it.
  role: ClubRole | null;
  muted: boolean;
  // Open challenges you haven't joined, and how many are new to you.
  open: number;
  fresh: number;
}

export interface ClubChallenge {
  id: string;
  name: string;
  kind: ChallengeKind;
  startsAt: string;
  endsAt: string;
  durationDays: number;
  postedBy: string | null;
  postedByMe: boolean;
  players: number;
  clubPlayers: number;
  faces: { initials: string; frameId: string | null; backgroundId: string | null; iconId: string | null }[];
  joined: boolean;
  open: boolean;
}

export interface ClubMember {
  userId: string;
  name: string;
  initials: string;
  role: ClubRole;
  frameId: string | null;
  backgroundId: string | null;
  iconId: string | null;
  me: boolean;
}

export interface ClubPage extends Club {
  // Members only.
  code: string | null;
  // Why you can't join it (not a member): 'age' and 'username' are asks.
  problem: string | null;
  week: { mi: number; lastMi: number; people: number };
  top: { name: string; mi: number; me: boolean }[];
  challenges: ClubChallenge[];
  memberList: ClubMember[];
  // A public club you're not in: just the names of what's on.
  openNames: string[];
}

export interface ClubStatus {
  createProblem: string | null;
  minLevel: number;
  searchOn: boolean;
  communityListOn: boolean;
  enabled: boolean;
}

function client() {
  if (!supabase) throw new Error('Not connected to Hound.');
  return supabase;
}

async function rpc<T = any>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await client().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

function toClub(d: any): Club {
  return {
    id: d.id,
    name: d.name,
    sport: d.sport,
    city: d.city ?? null,
    description: d.description ?? null,
    color: d.color ?? 'orange',
    isPublic: !!d.is_public,
    members: Number(d.members ?? 0),
    role: d.role ?? null,
    muted: !!d.muted,
    open: Number(d.open ?? 0),
    fresh: Number(d.new ?? 0),
  };
}

export async function getClubStatus(): Promise<ClubStatus> {
  const d = await rpc('my_club_status');
  return {
    createProblem: d?.create_problem ?? null,
    minLevel: Number(d?.min_level ?? 3),
    searchOn: d?.search_on !== false,
    communityListOn: d?.community_list_on !== false,
    enabled: d?.enabled !== false,
  };
}

export async function getMyClubs(): Promise<Club[]> {
  return ((await rpc<any[]>('my_clubs')) ?? []).map(toClub);
}

export async function getClubsBadge(): Promise<number> {
  return Number((await rpc('clubs_badge')) ?? 0);
}

export async function searchClubs(query: string, sport: ClubSport | null): Promise<Club[]> {
  return ((await rpc<any[]>('search_clubs', { p_query: query, p_sport: sport })) ?? []).map(toClub);
}

export async function createClub(input: {
  name: string;
  sport: ClubSport;
  city: string;
  description: string;
  color: ClubColor;
  isPublic: boolean;
}): Promise<{ id: string; code: string }> {
  const d = await rpc('create_club', {
    p_name: input.name,
    p_sport: input.sport,
    p_city: input.city,
    p_description: input.description,
    p_color: input.color,
    p_public: input.isPublic,
  });
  return { id: d.id, code: d.code };
}

export async function updateClub(id: string, input: { name: string; sport: ClubSport; city: string; description: string; color: ClubColor }): Promise<void> {
  await rpc('update_club', {
    p_club_id: id,
    p_name: input.name,
    p_sport: input.sport,
    p_city: input.city,
    p_description: input.description,
    p_color: input.color,
  });
}

export async function getClubPage(id: string, weekStart: string): Promise<ClubPage> {
  const d = await rpc('club_page', { p_club_id: id, p_week_start: weekStart });
  return {
    ...toClub(d),
    code: d.code ?? null,
    problem: d.problem ?? null,
    week: { mi: Number(d.week?.mi ?? 0), lastMi: Number(d.week?.last_mi ?? 0), people: Number(d.week?.people ?? 0) },
    top: ((d.top ?? []) as any[]).map((t) => ({ name: t.name, mi: Number(t.mi), me: !!t.me })),
    challenges: ((d.challenges ?? []) as any[]).map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      startsAt: c.starts_at,
      endsAt: c.ends_at,
      durationDays: Number(c.duration_days ?? 0),
      postedBy: c.posted_by ?? null,
      postedByMe: !!c.posted_by_me,
      players: Number(c.players ?? 0),
      clubPlayers: Number(c.club_players ?? 0),
      faces: ((c.from_club ?? []) as any[]).map((f) => ({ initials: f.initials, frameId: f.frame ?? null, backgroundId: f.background ?? null, iconId: f.icon ?? null })),
      joined: !!c.joined,
      open: !!c.open,
    })),
    memberList: ((d.members_list ?? []) as any[]).map((m) => ({
      userId: m.user_id,
      name: m.name,
      initials: m.initials,
      role: m.role,
      frameId: m.frame ?? null,
      backgroundId: m.background ?? null,
      iconId: m.icon ?? null,
      me: !!m.me,
    })),
    openNames: (d.open_names ?? []) as string[],
  };
}

export async function previewClubByCode(code: string): Promise<(Club & { problem: string | null }) | null> {
  const d = await rpc('preview_club_by_code', { p_code: code });
  return d ? { ...toClub(d), problem: d.problem ?? null } : null;
}

export async function joinClubByCode(code: string): Promise<string> {
  return rpc<string>('join_club_by_code', { p_code: code });
}

export async function joinClub(id: string): Promise<void> {
  await rpc('join_club', { p_club_id: id });
}

export async function leaveClub(id: string): Promise<void> {
  await rpc('leave_club', { p_club_id: id });
}

export async function setClubMuted(id: string, muted: boolean): Promise<void> {
  await rpc('set_club_muted', { p_club_id: id, p_muted: muted });
}

export async function setClubRole(id: string, userId: string, role: 'organizer' | 'member'): Promise<void> {
  await rpc('set_club_role', { p_club_id: id, p_user: userId, p_role: role });
}

export async function removeClubMember(id: string, userId: string): Promise<void> {
  await rpc('remove_club_member', { p_club_id: id, p_user: userId });
}

export async function newClubCode(id: string): Promise<string> {
  return rpc<string>('new_club_code', { p_club_id: id });
}

export async function joinClubChallenge(clubId: string, challengeId: string): Promise<void> {
  await rpc('join_club_challenge', { p_club_id: clubId, p_challenge_id: challengeId });
}

export async function removeClubPost(clubId: string, challengeId: string): Promise<void> {
  await rpc('remove_club_post', { p_club_id: clubId, p_challenge_id: challengeId });
}

export async function postToClubs(challengeId: string, clubIds: string[]): Promise<number> {
  return Number(await rpc('post_to_clubs', { p_challenge_id: challengeId, p_club_ids: clubIds }));
}

export interface ShareableClub {
  id: string;
  name: string;
  sport: ClubSport;
  color: ClubColor;
  members: number;
  posted: boolean;
}

export async function clubsForChallenge(challengeId: string | null): Promise<ShareableClub[]> {
  const rows = (await rpc<any[]>('clubs_for_challenge', { p_challenge_id: challengeId })) ?? [];
  return rows.map((r) => ({ id: r.id, name: r.name, sport: r.sport, color: r.color, members: Number(r.members ?? 0), posted: !!r.posted }));
}

// ── Community challenges, listed on the Clubs tab ──

export interface CommunityListing {
  id: string;
  name: string;
  description: string | null;
  kind: ChallengeKind;
  creator: string | null;
  players: number;
  startsAt: string;
  endsAt: string;
  durationDays: number;
  code: string;
  joined: boolean;
}

export async function listCommunityChallenges(): Promise<{ featured: CommunityListing[]; popular: CommunityListing[] }> {
  const d = await rpc('list_community_challenges');
  const row = (r: any): CommunityListing => ({
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    kind: r.kind,
    creator: r.creator ?? null,
    players: Number(r.players ?? 0),
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    durationDays: Number(r.duration_days ?? 0),
    code: r.code,
    joined: !!r.joined,
  });
  return { featured: ((d?.featured ?? []) as any[]).map(row), popular: ((d?.popular ?? []) as any[]).map(row) };
}

// ── Admin ──

export interface ClubConfig {
  enabled: boolean;
  minLevel: number;
  minAccountDays: number;
  searchOn: boolean;
  communityListOn: boolean;
  maxOwned: number;
  maxJoined: number;
  maxMembers: number;
}

export interface ClubsOverview {
  config: ClubConfig;
  clubs: number;
  publicClubs: number;
  privateClubs: number;
  new7d: number;
  people: number;
  memberships: number;
  joined7d: number;
  active30d: number;
  posts30d: number;
  clubJoins30d: number;
  // 0187
  invites30d: number;
  invitesAccepted30d: number;
  bySport: Partial<Record<ClubSport, number>>;
  newest: { id: string; name: string; sport: ClubSport; city: string | null; isPublic: boolean; createdAt: string; members: number; posts: number; owner: string | null }[];
}

export async function getClubsOverview(): Promise<ClubsOverview> {
  const d = (await rpc('admin_clubs_overview')) ?? {};
  const n = (v: unknown) => Number(v ?? 0);
  const c = d.config ?? {};
  return {
    config: {
      enabled: c.enabled !== false,
      minLevel: n(c.min_level),
      minAccountDays: n(c.min_account_days),
      searchOn: c.search_on !== false,
      communityListOn: c.community_list_on !== false,
      maxOwned: n(c.max_owned),
      maxJoined: n(c.max_joined),
      maxMembers: n(c.max_members),
    },
    clubs: n(d.clubs),
    publicClubs: n(d.public),
    privateClubs: n(d.private),
    new7d: n(d.new_7d),
    people: n(d.people),
    memberships: n(d.memberships),
    joined7d: n(d.joined_7d),
    active30d: n(d.active_30d),
    posts30d: n(d.posts_30d),
    clubJoins30d: n(d.club_joins_30d),
    invites30d: n(d.invites_30d),
    invitesAccepted30d: n(d.invites_accepted_30d),
    bySport: d.by_sport ?? {},
    newest: ((d.newest ?? []) as any[]).map((r) => ({
      id: r.id,
      name: r.name,
      sport: r.sport,
      city: r.city ?? null,
      isPublic: !!r.is_public,
      createdAt: r.created_at,
      members: n(r.members),
      posts: n(r.posts),
      owner: r.owner ?? null,
    })),
  };
}

export async function setClubConfig(patch: Partial<{ enabled: boolean; min_level: number; search_on: boolean; community_list_on: boolean }>): Promise<void> {
  await rpc('admin_set_club_config', { p: patch });
}

export async function adminRemoveClub(id: string, reason: string): Promise<void> {
  await rpc('admin_remove_club', { p_club_id: id, p_reason: reason });
}

// ── Invites (0187) ──

export interface ClubFriend {
  userId: string;
  name: string;
  initials: string;
  frameId: string | null;
  backgroundId: string | null;
  iconId: string | null;
  member: boolean;
  invited: boolean;
}

export async function friendsForClub(clubId: string): Promise<ClubFriend[]> {
  const rows = (await rpc<any[]>('friends_for_club', { p_club_id: clubId })) ?? [];
  return rows.map((r) => ({
    userId: r.user_id,
    name: r.name,
    initials: r.initials,
    frameId: r.frame ?? null,
    backgroundId: r.background ?? null,
    iconId: r.icon ?? null,
    member: !!r.member,
    invited: !!r.invited,
  }));
}

export async function inviteToClub(clubId: string, userIds: string[]): Promise<number> {
  return Number(await rpc('invite_to_club', { p_club_id: clubId, p_user_ids: userIds }));
}

export type ClubInvite = Club & { invitedBy: string | null };

export async function getMyClubInvites(): Promise<ClubInvite[]> {
  return ((await rpc<any[]>('my_club_invites')) ?? []).map((d) => ({ ...toClub(d), invitedBy: d.invited_by ?? null }));
}

export async function acceptClubInvite(clubId: string): Promise<void> {
  await rpc('accept_club_invite', { p_club_id: clubId });
}

export async function declineClubInvite(clubId: string): Promise<void> {
  await rpc('decline_club_invite', { p_club_id: clubId });
}
