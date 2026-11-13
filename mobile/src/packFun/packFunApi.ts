import { supabase } from '../lib/supabase';

// Pack Activity (0192_pack_fun.sql): a live session for a group walking,
// running or hiking together.

export interface PackFunMember {
  userId: string;
  name: string;
  initials: string;
  iconId: string | null;
  frameId: string | null;
  backgroundId: string | null;
  joined: boolean;
  steps: number;
  stepsAt: string | null;
  live: boolean;
  lat: number | null;
  lng: number | null;
  bones: number;
}

export interface PackFunTrail {
  id: string;
  seq: number;
  openedAt: string;
  closesAt: string;
  open: boolean;
  question: string;
  choices: string[];
  kind: string;
  firstUser: string | null;
  answer: number | null;
  myChoice: number | null;
  answered: string[];
}

export interface PackFunFlash {
  id: string;
  kind: 'dash' | 'push';
  startedBy: string;
  startsAt: string;
  endsAt: string;
  target: number | null;
  startSteps: Record<string, number>;
  settled: boolean;
  result: { winner?: string | null; steps?: number; total?: number; made_it?: boolean } | null;
}

export interface PackFunState {
  id: string;
  name: string;
  createdBy: string;
  clubId: string | null;
  startsAt: string;
  endsAt: string;
  settled: boolean;
  trailsOn: boolean;
  flashOn: boolean;
  mapOn: boolean;
  joined: boolean;
  muted: boolean;
  packSteps: number;
  trailEvery: number;
  nextTrailAt: number;
  trailsSolved: number;
  bones: { trailFirst: number; trailAnswer: number; flashWin: number; pushBonus: number; finish: number; boneFind: number };
  myBones: number;
  members: PackFunMember[];
  trail: PackFunTrail | null;
  flash: PackFunFlash | null;
  cheers: { userId: string; kind: 'go' | 'wait' | 'water' | 'nice'; at: string }[];
  mapBones: { id: string; lat: number; lng: number }[];
  bonesFound: number;
}

function client() {
  if (!supabase) throw new Error('Not connected to Hound.');
  return supabase;
}

function toState(d: any): PackFunState {
  const n = (v: unknown) => Number(v ?? 0);
  return {
    id: d.id,
    name: d.name,
    createdBy: d.created_by,
    clubId: d.club_id ?? null,
    startsAt: d.starts_at,
    endsAt: d.ends_at,
    settled: !!d.settled,
    trailsOn: !!d.trails_on,
    flashOn: !!d.flash_on,
    mapOn: !!d.map_on,
    joined: !!d.joined,
    muted: !!d.muted,
    packSteps: n(d.pack_steps),
    trailEvery: n(d.trail_every),
    nextTrailAt: n(d.next_trail_at),
    trailsSolved: n(d.trails_solved),
    bones: {
      trailFirst: n(d.bones?.trail_first),
      trailAnswer: n(d.bones?.trail_answer),
      flashWin: n(d.bones?.flash_win),
      pushBonus: n(d.bones?.push_bonus),
      finish: n(d.bones?.finish),
      boneFind: n(d.bones?.bone_find),
    },
    myBones: n(d.my_bones),
    members: ((d.members ?? []) as any[]).map((m) => ({
      userId: m.user_id,
      name: m.name ?? 'Someone',
      initials: m.initials ?? '?',
      iconId: m.icon_id ?? null,
      frameId: m.frame_id ?? null,
      backgroundId: m.background_id ?? null,
      joined: !!m.joined,
      steps: n(m.steps),
      stepsAt: m.steps_at ?? null,
      live: !!m.live,
      lat: m.lat ?? null,
      lng: m.lng ?? null,
      bones: n(m.bones),
    })),
    trail: d.trail
      ? {
          id: d.trail.id,
          seq: n(d.trail.seq),
          openedAt: d.trail.opened_at,
          closesAt: d.trail.closes_at,
          open: !!d.trail.open,
          question: d.trail.question,
          choices: d.trail.choices ?? [],
          kind: d.trail.kind,
          firstUser: d.trail.first_user ?? null,
          answer: d.trail.answer ?? null,
          myChoice: d.trail.my_choice ?? null,
          answered: d.trail.answered ?? [],
        }
      : null,
    flash: d.flash
      ? {
          id: d.flash.id,
          kind: d.flash.kind,
          startedBy: d.flash.started_by,
          startsAt: d.flash.starts_at,
          endsAt: d.flash.ends_at,
          target: d.flash.target ?? null,
          startSteps: d.flash.start_steps ?? {},
          settled: !!d.flash.settled,
          result: d.flash.result ?? null,
        }
      : null,
    cheers: ((d.cheers ?? []) as any[]).map((c) => ({ userId: c.user_id, kind: c.kind, at: c.at })),
    mapBones: ((d.map_bones ?? []) as any[]).map((b) => ({ id: b.id, lat: Number(b.lat), lng: Number(b.lng) })),
    bonesFound: n(d.bones_found),
  };
}

async function rpc<T = any>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await client().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export async function startPackFun(input: {
  name: string;
  minutes: 30 | 60 | 120 | 240;
  invite: string[];
  clubId: string | null;
  trails: boolean;
  flash: boolean;
  map: boolean;
  startsAt: Date | null;
}): Promise<string> {
  return rpc<string>('start_pack_fun', {
    p_name: input.name,
    p_minutes: input.minutes,
    p_invite: input.invite,
    p_club: input.clubId,
    p_trails: input.trails,
    p_flash: input.flash,
    p_map: input.map,
    p_starts_at: input.startsAt ? input.startsAt.toISOString() : null,
  });
}

export async function joinPackFun(id: string): Promise<void> {
  await rpc('join_pack_fun', { p_pack: id });
}

export async function endPackFun(id: string): Promise<void> {
  await rpc('end_pack_fun', { p_pack: id });
}

export async function mutePackFun(id: string, muted: boolean): Promise<void> {
  await rpc('mute_pack_fun', { p_pack: id, p_muted: muted });
}

export async function getPackFun(id: string): Promise<PackFunState> {
  return toState(await rpc('pack_fun_state', { p_pack: id }));
}

export async function pingPackFun(id: string, steps: number, live: boolean, where: { lat: number; lng: number } | null): Promise<PackFunState> {
  return toState(
    await rpc('pack_fun_ping', {
      p_pack: id,
      p_steps: Math.max(0, Math.round(steps)),
      p_live: live,
      p_lat: where?.lat ?? null,
      p_lng: where?.lng ?? null,
    }),
  );
}

export async function answerTrail(trailId: string, choice: number): Promise<{ correct: boolean; first: boolean; bones: number; answer: number }> {
  return rpc('answer_pack_fun_trail', { p_trail: trailId, p_choice: choice });
}

export async function startFlash(id: string, kind: 'dash' | 'push', minutes: 5 | 10 | 15, target: number | null): Promise<string> {
  return rpc<string>('start_pack_fun_flash', { p_pack: id, p_kind: kind, p_minutes: minutes, p_target: target });
}

export async function cheer(id: string, kind: 'go' | 'wait' | 'water' | 'nice'): Promise<void> {
  await rpc('pack_fun_cheer', { p_pack: id, p_kind: kind });
}

export async function findBone(boneId: string, where: { lat: number; lng: number }): Promise<number> {
  return rpc<number>('find_pack_fun_bone', { p_bone: boneId, p_lat: where.lat, p_lng: where.lng });
}

export interface MyPackFun {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  settled: boolean;
  joined: boolean;
  createdBy: string;
  mapOn: boolean;
  people: number;
  // Invited and not joined yet (0193).
  invited: boolean;
  creatorName: string;
  clubId: string | null;
  clubName: string | null;
}

export async function myPackFuns(): Promise<MyPackFun[]> {
  const d = await rpc<any[]>('my_pack_funs');
  return (d ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    startsAt: p.starts_at,
    endsAt: p.ends_at,
    settled: !!p.settled,
    joined: !!p.joined,
    createdBy: p.created_by,
    mapOn: !!p.map_on,
    people: Number(p.people ?? 0),
    invited: !!p.invited,
    creatorName: p.creator_name ?? 'Someone',
    clubId: p.club_id ?? null,
    clubName: p.club_name ?? null,
  }));
}

// The ones on now or coming up (not finished), live ones first.
export function currentPackFuns(list: MyPackFun[], now = Date.now()): MyPackFun[] {
  return list
    .filter((p) => !p.settled && new Date(p.endsAt).getTime() > now)
    .sort((a, b) => Number(isLive(b, now)) - Number(isLive(a, now)) || new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
}

// Invite more friends to one that's on or coming up (0193). Skipped:
// not a friend in Hound yet, or already in it.
export async function inviteToPackFun(
  id: string,
  userIds: string[],
): Promise<{ added: string[]; skipped: { userId: string; why: 'not_friend' | 'already' }[] }> {
  const d = await rpc<any>('invite_to_pack_fun', { p_pack: id, p_invite: userIds });
  return {
    added: (d?.added ?? []) as string[],
    skipped: ((d?.skipped ?? []) as any[]).map((x) => ({ userId: x.user_id, why: x.why })),
  };
}

export function isLive(p: { startsAt: string; endsAt: string; settled: boolean }, now = Date.now()): boolean {
  return !p.settled && new Date(p.startsAt).getTime() <= now && new Date(p.endsAt).getTime() > now;
}

// "1:12" of elapsed or left.
export function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

// ── Admin ──

export interface PackFunConfig {
  enabled: boolean;
  trail_first_bones: number;
  trail_answer_bones: number;
  flash_win_bones: number;
  push_bonus_bones: number;
  finish_bonus_bones: number;
  bone_find_bones: number;
  daily_cap: number;
  trail_every_steps: number;
  trail_minutes: number;
  finish_min_steps: number;
}

export interface PackFunOverview {
  config: PackFunConfig;
  liveNow: number;
  started7d: number;
  startedAll: number;
  people7d: number;
  peopleAll: number;
  avgPack: number;
  withMap7d: number;
  trails7d: number;
  trailsSolved7d: number;
  flashes7d: number;
  bonesFound7d: number;
  bonesGiven7d: number;
  bonesCapped7d: number;
  peopleAtCap7d: number;
}

export async function getPackFunOverview(): Promise<PackFunOverview> {
  const d = await rpc<any>('admin_pack_fun_overview');
  const n = (v: unknown) => Number(v ?? 0);
  return {
    config: d.config,
    liveNow: n(d.live_now),
    started7d: n(d.started_7d),
    startedAll: n(d.started_all),
    people7d: n(d.people_7d),
    peopleAll: n(d.people_all),
    avgPack: n(d.avg_pack),
    withMap7d: n(d.with_map_7d),
    trails7d: n(d.trails_7d),
    trailsSolved7d: n(d.trails_solved_7d),
    flashes7d: n(d.flashes_7d),
    bonesFound7d: n(d.bones_found_7d),
    bonesGiven7d: n(d.bones_given_7d),
    bonesCapped7d: n(d.bones_capped_7d),
    peopleAtCap7d: n(d.people_at_cap_7d),
  };
}

export async function setPackFunConfig(patch: Partial<PackFunConfig>): Promise<void> {
  await rpc('admin_set_pack_fun_config', { p: patch });
}

export function packFunSummary(o: PackFunOverview): string {
  return `${o.liveNow} live now · ${o.started7d} this week · ${o.people7d} ${o.people7d === 1 ? 'person' : 'people'}`;
}
