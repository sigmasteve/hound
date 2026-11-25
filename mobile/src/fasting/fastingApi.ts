import { supabase } from '../lib/supabase';
import { DEFAULT_CONFIG, localDayKey, type FastingConfig } from './fasting';

// The client half of Fasting (0261_fasting.sql). The server keeps the
// fasts, works out the streak and pays the Bones; the phone only asks.

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

async function rpc<T = any>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await requireClient().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

const num = (v: unknown) => Number(v ?? 0);

export interface FastingPerson {
  id: string;
  name: string;
  initials: string;
  iconId: string | null;
  frameId: string | null;
  backgroundId: string | null;
}

function person(d: any): FastingPerson {
  return {
    id: String(d?.id ?? ''),
    name: String(d?.name ?? 'Someone'),
    initials: String(d?.initials ?? '?'),
    iconId: d?.icon_id ?? null,
    frameId: d?.frame_id ?? null,
    backgroundId: d?.background_id ?? null,
  };
}

export interface OpenFast {
  id: string;
  goalHours: number;
  startedAt: string;
  packId: string | null;
}

function openFast(d: any): OpenFast | null {
  if (!d) return null;
  return { id: String(d.id), goalHours: num(d.goal_hours), startedAt: String(d.started_at), packId: d.pack_id ?? null };
}

// Hours since a fast started, at `now`.
export function hoursSince(startedAt: string, now = Date.now()): number {
  return Math.max(0, (now - new Date(startedAt).getTime()) / 3600000);
}

export interface FastingNumbers {
  streak: number;
  bestStreak: number;
  longest: number;
  weekDays: number;
  days30: number;
  fasts30: number;
  avg30: number;
  planHours: number;
}

function numbers(d: any): FastingNumbers {
  return {
    streak: num(d?.streak),
    bestStreak: num(d?.best_streak),
    longest: num(d?.longest),
    weekDays: num(d?.week_days),
    days30: num(d?.days_30),
    fasts30: num(d?.fasts_30),
    avg30: num(d?.avg_30),
    planHours: num(d?.plan_hours) || 16,
  };
}

function config(d: any): FastingConfig {
  if (!d) return DEFAULT_CONFIG;
  return {
    bones12: num(d.bones_12),
    bones14: num(d.bones_14),
    bones16: num(d.bones_16),
    bones18: num(d.bones_18),
    bones20: num(d.bones_20),
    streak3: num(d.streak_3),
    streak7: num(d.streak_7),
    streak14: num(d.streak_14),
    streak30: num(d.streak_30),
    streak100: num(d.streak_100),
    packBonus: num(d.pack_bonus),
    // Phase games (0269); missing before it's run.
    ...(d.game_bones !== undefined ? { gameBones: num(d.game_bones), gamesOn: d.games_on !== false } : {}),
  };
}

export interface FastingDay {
  day: string;
  hours: number;
  onPlan: boolean;
}

export interface MyFasting {
  // null: not answered yet; 'under': Fasting is hidden.
  age: 'ok' | 'under' | null;
  planHours: number;
  restDays: number[];
  share: boolean;
  startedAny: boolean;
  open: OpenFast | null;
  cheers: FastingPerson[];
  numbers: FastingNumbers;
  paidToday: boolean;
  days: FastingDay[];
  recentStarts: string[];
  config: FastingConfig;
}

export async function getMyFasting(now = new Date()): Promise<MyFasting> {
  const d = await rpc<any>('my_fasting', { p_local_date: localDayKey(now) });
  return {
    age: d?.age === 'ok' || d?.age === 'under' ? d.age : null,
    planHours: num(d?.plan_hours) || 16,
    restDays: Array.isArray(d?.rest_days) ? d.rest_days.map(num) : [],
    share: d?.share !== false,
    startedAny: !!d?.started_any,
    open: openFast(d?.open),
    cheers: Array.isArray(d?.cheers) ? d.cheers.map(person) : [],
    numbers: numbers(d?.numbers),
    paidToday: !!d?.paid_today,
    days: Array.isArray(d?.days) ? d.days.map((x: any) => ({ day: String(x.day), hours: num(x.hours), onPlan: !!x.on_plan })) : [],
    recentStarts: Array.isArray(d?.recent_starts) ? d.recent_starts.map(String) : [],
    config: config(d?.config),
  };
}

export async function setFastingAge(ok: boolean): Promise<void> {
  await rpc('fasting_set_age', { p_ok: ok });
}

export async function saveFastingSettings(s: { planHours?: number; restDays?: number[]; share?: boolean }): Promise<void> {
  await rpc('fasting_settings', {
    p_plan_hours: s.planHours ?? null,
    p_rest_days: s.restDays ?? null,
    p_share: s.share ?? null,
  });
}

export async function startFast(planHours: number, startedAt: Date | null, invite: string[] = []): Promise<{ fastId: string; packId: string | null }> {
  const d = await rpc<any>('fasting_start', {
    p_plan_hours: planHours,
    p_started_at: startedAt ? startedAt.toISOString() : null,
    p_invite: invite,
  });
  return { fastId: String(d.fast_id), packId: d.pack_id ?? null };
}

export interface FastResult {
  fastId: string;
  hours: number;
  goalHours: number;
  onPlan: boolean;
  bones: number;
  milestoneBones: number;
  packBones: number;
  streak: number;
  bestStreak: number;
  longest: number;
  newLongest: boolean;
}

export async function endFast(endedAt: Date | null, now = new Date()): Promise<FastResult> {
  const d = await rpc<any>('fasting_end', { p_local_date: localDayKey(now), p_ended_at: endedAt ? endedAt.toISOString() : null });
  return {
    fastId: String(d.fast_id),
    hours: num(d.hours),
    goalHours: num(d.goal_hours),
    onPlan: !!d.on_plan,
    bones: num(d.bones),
    milestoneBones: num(d.milestone_bones),
    packBones: num(d.pack_bones),
    streak: num(d.streak),
    bestStreak: num(d.best_streak),
    longest: num(d.longest),
    newLongest: !!d.new_longest,
  };
}

export async function cancelFast(): Promise<void> {
  await rpc('fasting_cancel');
}

export async function setFastFeel(fastId: string, feel: string): Promise<void> {
  await rpc('fasting_feel', { p_fast_id: fastId, p_feel: feel });
}

export interface PastFast {
  id: string;
  startedAt: string;
  endedAt: string;
  hours: number;
  goalHours: number;
  onPlan: boolean;
  bones: number;
  feel: string | null;
  packId: string | null;
}

export async function getFastingHistory(limit = 30): Promise<PastFast[]> {
  const d = await rpc<any[]>('fasting_history', { p_limit: limit });
  return (d ?? []).map((x) => ({
    id: String(x.id),
    startedAt: String(x.started_at),
    endedAt: String(x.ended_at),
    hours: num(x.hours),
    goalHours: num(x.goal_hours),
    onPlan: !!x.on_plan,
    bones: num(x.bones),
    feel: x.feel ?? null,
    packId: x.pack_id ?? null,
  }));
}

export interface FriendFasting extends FastingPerson {
  fast: OpenFast;
  cheered: boolean;
}

export interface BoardRow extends FastingPerson {
  me: boolean;
  fasting: boolean;
  numbers: FastingNumbers;
}

export async function getFastingFriends(now = new Date()): Promise<{ now: FriendFasting[]; board: BoardRow[] }> {
  const d = await rpc<any>('fasting_friends', { p_local_date: localDayKey(now) });
  return {
    now: (d?.now ?? []).map((x: any) => ({ ...person(x), fast: openFast(x.fast)!, cheered: !!x.cheered })),
    board: (d?.board ?? []).map((x: any) => ({ ...person(x), me: !!x.me, fasting: !!x.fasting, numbers: numbers(x.numbers) })),
  };
}

export async function cheerFast(fastId: string): Promise<void> {
  await rpc('fasting_cheer', { p_fast_id: fastId });
}

export interface FastingCompare {
  me: FastingNumbers;
  them: FastingPerson & { numbers: FastingNumbers };
  together: number;
}

export async function compareFasting(friendId: string, now = new Date()): Promise<FastingCompare> {
  const d = await rpc<any>('fasting_compare', { p_friend: friendId, p_local_date: localDayKey(now) });
  return { me: numbers(d.me), them: { ...person(d.them), numbers: numbers(d.them?.numbers) }, together: num(d.together) };
}

export interface PackMember extends FastingPerson {
  status: 'invited' | 'joined' | 'declined';
  me: boolean;
  fast: { goalHours: number; startedAt: string; endedAt: string | null; hours: number; onPlan: boolean | null } | null;
}

export interface FastPack {
  id: string;
  createdAt: string;
  createdBy: string;
  joinUntil: string;
  bonus: number;
  bonusPaid: boolean;
  members: PackMember[];
  notes: (FastingPerson & { note: string; at: string })[];
}

export async function getFastPack(packId: string): Promise<FastPack> {
  const d = await rpc<any>('fasting_pack', { p_pack_id: packId });
  return {
    id: String(d.id),
    createdAt: String(d.created_at),
    createdBy: String(d.created_by),
    joinUntil: String(d.join_until),
    bonus: num(d.bonus),
    bonusPaid: !!d.bonus_paid,
    members: (d.members ?? []).map((m: any) => ({
      ...person(m),
      status: m.status,
      me: !!m.me,
      fast: m.fast
        ? {
            goalHours: num(m.fast.goal_hours),
            startedAt: String(m.fast.started_at),
            endedAt: m.fast.ended_at ?? null,
            hours: num(m.fast.hours),
            onPlan: m.fast.on_plan ?? null,
          }
        : null,
    })),
    notes: (d.notes ?? []).map((n: any) => ({ ...person(n), note: String(n.note), at: String(n.at) })),
  };
}

export async function joinFastPack(packId: string, planHours: number | null, startedAt: Date | null = null): Promise<void> {
  await rpc('fasting_pack_join', {
    p_pack_id: packId,
    p_plan_hours: planHours,
    p_started_at: startedAt ? startedAt.toISOString() : null,
  });
}

export async function declineFastPack(packId: string): Promise<void> {
  await rpc('fasting_pack_decline', { p_pack_id: packId });
}

export async function inviteToFastPack(packId: string, friendIds: string[]): Promise<number> {
  return num(await rpc('fasting_pack_invite', { p_pack_id: packId, p_friends: friendIds }));
}

export async function sendPackNote(packId: string, note: string): Promise<void> {
  await rpc('fasting_pack_note', { p_pack_id: packId, p_note: note });
}

export interface FastPackInvite {
  packId: string;
  from: FastingPerson;
  createdAt: string;
  joinUntil: string;
  joined: number;
}

export async function getFastingWaiting(): Promise<FastPackInvite[]> {
  const d = await rpc<any[]>('fasting_waiting');
  return (d ?? []).map((x) => ({
    packId: String(x.pack_id),
    from: person(x.from),
    createdAt: String(x.created_at),
    joinUntil: String(x.join_until),
    joined: num(x.joined),
  }));
}

export interface ClubFasting {
  // 0262: a public club you haven't joined shows only the counts.
  member: boolean;
  canFast: boolean;
  under: boolean;
  nowCount: number;
  fasters: number;
  now: (FastingPerson & { fast: OpenFast; me: boolean })[];
  // The top 25, plus your own row (with its rank) if you're further down.
  board: (FastingPerson & { me: boolean; rank: number; numbers: FastingNumbers })[];
  myRank: number | null;
}

export async function getClubFasting(clubId: string, now = new Date()): Promise<ClubFasting> {
  const d = await rpc<any>('club_fasting', { p_club_id: clubId, p_local_date: localDayKey(now) });
  return {
    // Before 0262 every caller was a member.
    member: d?.member !== false,
    canFast: !!d?.can_fast,
    under: !!d?.under,
    nowCount: num(d?.now_count ?? (d?.now ?? []).length),
    fasters: num(d?.fasters ?? (d?.board ?? []).length),
    now: (d?.now ?? []).map((x: any) => ({ ...person(x), fast: openFast(x.fast)!, me: !!x.me })),
    board: (d?.board ?? []).map((x: any, i: number) => ({ ...person(x), me: !!x.me, rank: num(x.rank) || i + 1, numbers: numbers(x.numbers) })),
    myRank: d?.my_rank == null ? null : num(d.my_rank),
  };
}

// ── Admin ──

export interface FastingOverview {
  tried: number;
  fastingNow: number;
  fasted7d: number;
  fasts7d: number;
  medianHours7d: number | null;
  onPlanPct7d: number | null;
  plans: Record<string, number>;
  streak7: number;
  streak30: number;
  bestStreak: number;
  packs7d: number;
  packPeople7d: number;
  packsPaid7d: number;
  cheers7d: number;
  notes7d: number;
  clubsFasting: number;
  fastingClubs: number;
  over36_7d: number;
  openOver36: number;
  unwell7d: number;
  feel7d: Record<string, number>;
  under16: number;
  notSharing: number;
  bones7d: number;
}

export async function getFastingOverview(): Promise<FastingOverview> {
  const d = await rpc<any>('admin_fasting_overview');
  const rec = (x: any): Record<string, number> => Object.fromEntries(Object.entries(x ?? {}).map(([k, v]) => [k, num(v)]));
  return {
    tried: num(d.tried),
    fastingNow: num(d.fasting_now),
    fasted7d: num(d.fasted_7d),
    fasts7d: num(d.fasts_7d),
    medianHours7d: d.median_hours_7d == null ? null : num(d.median_hours_7d),
    onPlanPct7d: d.on_plan_pct_7d == null ? null : num(d.on_plan_pct_7d),
    plans: rec(d.plans),
    streak7: num(d.streak_7),
    streak30: num(d.streak_30),
    bestStreak: num(d.best_streak),
    packs7d: num(d.packs_7d),
    packPeople7d: num(d.pack_people_7d),
    packsPaid7d: num(d.packs_paid_7d),
    cheers7d: num(d.cheers_7d),
    notes7d: num(d.notes_7d),
    clubsFasting: num(d.clubs_fasting),
    fastingClubs: num(d.fasting_clubs),
    over36_7d: num(d.over_36_7d),
    openOver36: num(d.open_over_36),
    unwell7d: num(d.unwell_7d),
    feel7d: rec(d.feel_7d),
    under16: num(d.under_16),
    notSharing: num(d.not_sharing),
    bones7d: num(d.bones_7d),
  };
}

export async function getFastingConfig(): Promise<FastingConfig> {
  const { data, error } = await requireClient().from('fasting_config').select('*').eq('id', true).single();
  if (error) throw new Error(error.message);
  return config(data);
}

export async function setFastingConfig(c: FastingConfig): Promise<void> {
  await rpc('admin_set_fasting_config', {
    p: {
      bones_12: c.bones12,
      bones_14: c.bones14,
      bones_16: c.bones16,
      bones_18: c.bones18,
      bones_20: c.bones20,
      streak_3: c.streak3,
      streak_7: c.streak7,
      streak_14: c.streak14,
      streak_30: c.streak30,
      streak_100: c.streak100,
      pack_bonus: c.packBonus,
      ...(c.gameBones !== undefined ? { game_bones: c.gameBones } : {}),
      ...(c.gamesOn !== undefined ? { games_on: c.gamesOn } : {}),
    },
  });
}

// ── Phase games (0269_fasting_games.sql) ──

export interface GameSlotState {
  slot: import('./fastingGames').GameSlot;
  at: number;
  game: import('./fastingGames').GameKind;
  // 'locked' until its hour; 'open' to play; 'played' or 'left' (a run
  // abandoned for 15 minutes, counted as 0).
  status: 'locked' | 'open' | 'played' | 'left';
  score: number | null;
}

export interface FastingGamesState {
  on: boolean;
  bones: number;
  points: number;
  fast: { id: string; goalHours: number; startedAt: string; endedAt: string | null } | null;
  slots: GameSlotState[];
}

// Null before 0269 is run.
export async function getFastingGames(): Promise<FastingGamesState | null> {
  try {
    const d = await rpc<any>('fasting_games_state');
    return {
      on: !!d?.on,
      bones: num(d?.bones),
      points: num(d?.points),
      fast: d?.fast
        ? { id: String(d.fast.id), goalHours: num(d.fast.goal_hours), startedAt: String(d.fast.started_at), endedAt: d.fast.ended_at ?? null }
        : null,
      slots: (d?.slots ?? []).map((s: any) => ({
        slot: s.slot,
        at: num(s.at),
        game: s.game,
        status: s.status,
        score: s.score === null || s.score === undefined ? null : num(s.score),
      })),
    };
  } catch (e) {
    if (e instanceof Error && /fasting_games_state/.test(e.message)) return null;
    throw e;
  }
}

export interface GameRun {
  id: string;
  game: import('./fastingGames').GameKind;
  seed: number;
}

export async function startFastingGame(fastId: string, slot: string): Promise<GameRun> {
  const d = await rpc<any>('fasting_game_start', { p_fast_id: fastId, p_slot: slot });
  return { id: String(d.id), game: d.game, seed: num(d.seed) };
}

export interface GameFinish {
  score: number;
  bones: number;
  points: number;
  topPct: number | null;
  playedToday: number;
  timedOut: boolean;
}

export async function finishFastingGame(id: string, stats: Record<string, number>): Promise<GameFinish> {
  const d = await rpc<any>('fasting_game_finish', { p_id: id, p_stats: stats });
  return {
    score: num(d?.score),
    bones: num(d?.bones),
    points: num(d?.points),
    topPct: d?.top_pct === null || d?.top_pct === undefined ? null : num(d.top_pct),
    playedToday: num(d?.played_today),
    timedOut: !!d?.timed_out,
  };
}

export interface GamesBoardRow extends FastingPerson {
  rank: number;
  points: number;
  games: number;
  avg: number;
  me: boolean;
}

export interface GamesBoard {
  of: number;
  me: { rank: number; points: number; games: number; avg: number } | null;
  rows: GamesBoardRow[];
}

export async function getFastingGamesBoard(scope: 'all' | 'week' | 'friends', now = new Date()): Promise<GamesBoard> {
  const d = await rpc<any>('fasting_games_board', { p_scope: scope, p_local_date: localDayKey(now) });
  return {
    of: num(d?.of),
    me: d?.me ? { rank: num(d.me.rank), points: num(d.me.points), games: num(d.me.games), avg: num(d.me.avg) } : null,
    rows: (d?.rows ?? []).map((r: any) => ({ ...person(r), rank: num(r.rank), points: num(r.points), games: num(r.games), avg: num(r.avg), me: !!r.me })),
  };
}

export interface FastingGamesOverview {
  players: number;
  players7d: number;
  games7d: number;
  left7d: number;
  bones7d: number;
  fasts7d: number;
  gamesPerFast7d: number;
  pointsAll: number;
  byGame: Record<string, { n: number; avg: number }>;
  top: (FastingPerson & { points: number; games: number })[];
  gamesOn: boolean;
  gameBones: number;
}

export async function getFastingGamesOverview(): Promise<FastingGamesOverview> {
  const d = await rpc<any>('admin_fasting_games_overview');
  return {
    players: num(d?.players),
    players7d: num(d?.players_7d),
    games7d: num(d?.games_7d),
    left7d: num(d?.left_7d),
    bones7d: num(d?.bones_7d),
    fasts7d: num(d?.fasts_7d),
    gamesPerFast7d: num(d?.games_per_fast_7d),
    pointsAll: num(d?.points_all),
    byGame: d?.by_game ?? {},
    top: (d?.top ?? []).map((r: any) => ({ ...person(r), points: num(r.points), games: num(r.games) })),
    gamesOn: d?.games_on !== false,
    gameBones: num(d?.game_bones),
  };
}
