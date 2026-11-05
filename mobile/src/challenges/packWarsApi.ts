import { supabase } from '../lib/supabase';
import { localDayKey } from '../goals/goals';
import { PACKS, TERRITORY_NAMES, packOf, type PackId, type Territory } from './packWars';

// The client half of Pack Wars — see 0174_pack_wars.sql. The server keeps
// the packs, the map and the votes, and plays each night; the phone votes
// and reports its own steps for today.

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

export interface PackMove {
  idx: number;
  to: PackId;
  from: PackId | null;
  // Steps a member: the winner's, and what it beat.
  avg: number;
  vsAvg: number | null;
}

export interface PackWarsGame {
  firstDay: string;
  days: number;
  myPack: PackId;
  map: Territory[];
  members: Record<PackId, number>;
  // Today: where you voted (-1 Hold, null none), your pack's tally.
  myVote: number | null;
  packVotes: { idx: number; votes: number }[];
  votedToday: number;
  // The last night played, and what changed hands.
  lastDay: string | null;
  lastNight: PackMove[];
  settled: boolean;
  winBones: number;
  finishBones: number;
}

function fromServer(j: any): PackWarsGame {
  const owners = new Map<number, PackId | null>((j.map ?? []).map((t: any) => [t.idx, t.owner ?? null]));
  return {
    firstDay: String(j.firstDay),
    days: j.days,
    myPack: j.myPack,
    map: TERRITORY_NAMES.map((name, idx) => ({ idx, name, owner: owners.get(idx) ?? null })),
    members: { wolves: 0, goldens: 0, collies: 0, beagles: 0, ...(j.members ?? {}) },
    myVote: j.myVote ?? null,
    packVotes: j.packVotes ?? [],
    votedToday: j.votedToday ?? 0,
    lastDay: j.lastDay ?? null,
    lastNight: (j.lastNight ?? []).map((m: any) => ({ idx: m.idx, to: m.to, from: m.from ?? null, avg: m.avg, vsAvg: m.vsAvg ?? null })),
    settled: !!j.settled,
    winBones: j.winBones ?? 50,
    finishBones: j.finishBones ?? 20,
  };
}

export async function getPackWars(challengeId: string): Promise<PackWarsGame> {
  const { data, error } = await requireClient().rpc('pack_state', { p_challenge_id: challengeId, p_day: localDayKey(new Date()) });
  if (error) throw new Error(error.message);
  return fromServer(data);
}

// A territory to march on, or -1 to hold.
export async function votePackMarch(challengeId: string, target: number): Promise<PackWarsGame> {
  const { data, error } = await requireClient().rpc('pack_vote', {
    p_challenge_id: challengeId,
    p_day: localDayKey(new Date()),
    p_target: target,
  });
  if (error) throw new Error(error.message);
  return fromServer(data);
}

// The phone's own count for today, on today's vote.
export async function claimPackSteps(challengeId: string, steps: number): Promise<void> {
  const { error } = await requireClient().rpc('pack_claim_steps', {
    p_challenge_id: challengeId,
    p_day: localDayKey(new Date()),
    p_steps: Math.max(0, Math.round(steps)),
  });
  if (error) throw new Error(error.message);
}

// Which day of the game today is, from the phone's date: null before it
// starts or after it ends.
export function packDayNo(game: PackWarsGame, today = localDayKey(new Date())): number | null {
  const [y, m, d] = game.firstDay.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  const n = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(y, m - 1, d)) / 86_400_000) + 1;
  return n >= 1 && n <= game.days ? n : null;
}

export function heldBy(game: PackWarsGame, pack: PackId): number {
  return game.map.filter((t) => t.owner === pack).length;
}

// Today's line: "You're a Wolf · your pack holds 6 · marching on Mill Pond".
export function packWarsHeadline(name: string, game: PackWarsGame | null): string {
  if (!game) return name;
  const me = packOf(game.myPack);
  const held = heldBy(game, game.myPack);
  const lead = Math.max(...PACKS.map((p) => heldBy(game, p.id)));
  const standing = held === lead ? 'in the lead' : `${lead - held} behind`;
  if (packDayNo(game) == null) return `${name}: the ${me.name} hold ${held}, ${standing}`;
  const vote =
    game.myVote == null ? 'vote today’s march' : game.myVote === -1 ? 'holding today' : `marching on ${game.map[game.myVote]?.name ?? 'it'}`;
  return `${name}: the ${me.name} hold ${held}, ${standing} · ${vote}`;
}

export interface PackSettings {
  winBones: number;
  finishBones: number;
}

export interface PacksAdminOverview {
  challenges: number;
  live: number;
  joined: number;
  everVoted: number;
  votedToday: number;
  votes: number;
  holds: number;
  settings: PackSettings;
  days: { day: string; voted: number }[];
  games: { name: string; day: number; days: number; packs: Record<PackId, { members: number; votedToday: number; held: number }> }[];
}

export async function getPacksAdminOverview(): Promise<PacksAdminOverview> {
  const { data, error } = await requireClient().rpc('admin_packs_overview');
  if (error) throw new Error(error.message);
  return data as PacksAdminOverview;
}

// Admin → Pack Wars: the Bones for the winning pack and for everyone else.
// The table's own policy lets only admins change them.
export async function setPackSettings(s: PackSettings): Promise<void> {
  const { data, error } = await requireClient()
    .from('pack_settings')
    .update({ win_bones: s.winBones, finish_bones: s.finishBones, updated_at: new Date().toISOString() })
    .eq('id', true)
    .select('id');
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error('Only an admin can change these.');
}
