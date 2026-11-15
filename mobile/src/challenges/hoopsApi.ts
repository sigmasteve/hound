import { supabase } from '../lib/supabase';
import type { HoopsDefense, HoopsEventKind, HoopsShot, HoopsTeam } from './hoops';

// The client-facing half of Hoops — see 0195_hoops.sql for the schema
// and RPCs this wraps. One read (hoops_view) has everything the card
// shows.

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

async function rpc<T = any>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireClient().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export type HoopsStatus = 'upcoming' | 'live' | 'final';

export interface HoopsPlayer {
  id: string;
  userId: string | null;
  name: string;
  initials: string;
  iconId: string | null;
  frameId: string | null;
  backgroundId: string | null;
  bot: boolean;
  // A friend who hasn't accepted yet keeps their seat (0195).
  joined: boolean;
  team: HoopsTeam;
  guarding: string | null;
  shot: HoopsShot;
  stepsToday: number;
  shotsToday: number;
  pts: number;
  fgMade: number;
  fgAtt: number;
  threeMade: number;
  threeAtt: number;
  ftMade: number;
  ftAtt: number;
}

export interface HoopsEvent {
  seq: number;
  team: HoopsTeam;
  shooter: string;
  defender: string | null;
  kind: HoopsEventKind;
  dunk: boolean;
  made: boolean;
  pts: number;
  onFire: boolean;
  rebound: HoopsTeam | null;
  shooterSteps: number;
  defenderSteps: number;
  // The defending team's lean that day; 'none' when nobody voted.
  defense: HoopsDefense | 'none' | null;
  // Taken by hand on the shooting screen (0206), not rolled overnight.
  byHand: boolean;
}

export interface HoopsPeriod {
  period: number;
  label: string;
  home: number;
  away: number;
  events: HoopsEvent[];
}

export interface HoopsGame {
  status: HoopsStatus;
  firstDay: string | null;
  dayNo: number;
  days: number;
  daysPerQuarter: number;
  shotSteps: number;
  teams: Record<HoopsTeam, { name: string; score: number }>;
  line: { period: number; label: string; home: number; away: number; played: boolean }[];
  winner: HoopsTeam | null;
  me: string | null;
  players: HoopsPlayer[];
  myOdds: Record<HoopsShot, number> | null;
  myVote: HoopsDefense | null;
  teamVotes: Record<HoopsDefense, number>;
  last: HoopsPeriod | null;
  // 0206: everyone takes their own shots during the day (Create's "Take
  // my own shots"); anything not taken plays overnight as before.
  handsOn: boolean;
  live: HoopsLive | null;
}

const num = (v: unknown) => Number(v ?? 0);

function toEvent(e: any): HoopsEvent {
  return {
    seq: num(e.seq),
    team: e.team,
    shooter: e.shooter,
    defender: e.defender ?? null,
    kind: e.kind,
    dunk: !!e.dunk,
    made: !!e.made,
    pts: num(e.pts),
    onFire: !!e.on_fire,
    rebound: e.rebound ?? null,
    shooterSteps: num(e.shooter_steps),
    defenderSteps: num(e.defender_steps),
    defense: e.defense ?? null,
    byHand: !!e.by_hand,
  };
}

function toPeriod(p: any): HoopsPeriod | null {
  if (!p) return null;
  return { period: num(p.period), label: p.label ?? '', home: num(p.home), away: num(p.away), events: ((p.events ?? []) as any[]).map(toEvent) };
}

export function toHoopsGame(d: any): HoopsGame {
  return {
    status: d.status ?? 'upcoming',
    firstDay: d.first_day ?? null,
    dayNo: num(d.day_no),
    days: num(d.days),
    daysPerQuarter: num(d.days_per_quarter) || 1,
    shotSteps: num(d.shot_steps) || 2000,
    teams: {
      home: { name: d.teams?.home?.name ?? 'Hounds', score: num(d.teams?.home?.score) },
      away: { name: d.teams?.away?.name ?? 'Strays', score: num(d.teams?.away?.score) },
    },
    line: ((d.line ?? []) as any[]).map((l) => ({ period: num(l.period), label: l.label, home: num(l.home), away: num(l.away), played: !!l.played })),
    winner: d.winner ?? null,
    me: d.me ?? null,
    players: ((d.players ?? []) as any[]).map((p) => ({
      id: p.id,
      userId: p.user_id ?? null,
      name: p.name ?? 'Someone',
      initials: p.initials ?? '?',
      iconId: p.icon_id ?? null,
      frameId: p.frame_id ?? null,
      backgroundId: p.background_id ?? null,
      bot: !!p.bot,
      joined: p.joined !== false,
      team: p.team,
      guarding: p.guarding ?? null,
      shot: p.shot ?? 'drive',
      stepsToday: num(p.steps_today),
      shotsToday: num(p.shots_today),
      pts: num(p.pts),
      fgMade: num(p.fg_made),
      fgAtt: num(p.fg_att),
      threeMade: num(p.three_made),
      threeAtt: num(p.three_att),
      ftMade: num(p.ft_made),
      ftAtt: num(p.ft_att),
    })),
    myOdds: d.my_odds ? { drive: num(d.my_odds.drive), mid: num(d.my_odds.mid), three: num(d.my_odds.three) } : null,
    myVote: d.my_vote ?? null,
    teamVotes: { paint: num(d.team_votes?.paint), arc: num(d.team_votes?.arc) },
    last: toPeriod(d.last),
    handsOn: !!d.hands_on,
    live: d.live ? toLive(d.live) : null,
  };
}

// ── Taking your own shots (0206) ──

export type HoopsShotQuality = 'swish' | 'green' | 'near' | 'off';

export interface HoopsLiveShot {
  n: number;
  kind: HoopsShot;
  quality: HoopsShotQuality;
  made: boolean;
  pts: number;
  dunk: boolean;
  onFire: boolean;
  putback: { made: boolean; pts: number } | null;
}

export interface HoopsLive {
  handsOn: boolean;
  canShoot: boolean;
  // Why not, in the server's sentence ("Not a game day.", "No shots
  // ready: your next one comes at 6,000 steps.", "That's all your shots
  // today."): shown as is.
  reason: string | null;
  day: string | null;
  dayNo: number;
  period: number;
  // hoops_label: "Q2", "OT".
  label: string;
  steps: number;
  shotSteps: number;
  earned: number;
  taken: number;
  ready: number;
  // Steps at which the next shot comes; null at the day's cap.
  nextAt: number | null;
  defender: { name: string; steps: number } | null;
  theirDefense: HoopsDefense | 'none';
  // The make zone's width on the meter (a share of it), per shot: the
  // green narrows the more your defender out-walks you.
  windows: Record<HoopsShot, number>;
  streak: number;
  todayPts: number;
  shots: HoopsLiveShot[];
}

export interface HoopsShotResult {
  n: number;
  kind: HoopsShot;
  quality: HoopsShotQuality;
  chance: number;
  made: boolean;
  pts: number;
  dunk: boolean;
  onFire: boolean;
  putback: { made: boolean; pts: number } | null;
  ready: number;
  todayPts: number;
  message: string;
}

function toPutback(p: any): { made: boolean; pts: number } | null {
  return p ? { made: !!p.made, pts: num(p.pts) } : null;
}

export function toLive(d: any): HoopsLive {
  const w = d?.windows ?? {};
  return {
    handsOn: d?.hands_on !== false,
    canShoot: !!d?.can_shoot,
    reason: d?.reason ?? null,
    day: d?.day ?? null,
    dayNo: num(d?.day_no),
    period: num(d?.period),
    label: d?.label ?? '',
    steps: num(d?.steps),
    shotSteps: num(d?.shot_steps) || 2000,
    earned: num(d?.earned),
    taken: num(d?.taken),
    ready: num(d?.ready),
    nextAt: d?.next_at == null ? null : num(d.next_at),
    defender: d?.defender ? { name: d.defender.name ?? 'Your defender', steps: num(d.defender.steps) } : null,
    theirDefense: d?.their_defense ?? 'none',
    windows: { drive: num(w.drive) || 0.36, mid: num(w.mid) || 0.26, three: num(w.three) || 0.2 },
    streak: num(d?.streak),
    todayPts: num(d?.today_pts),
    shots: ((d?.shots ?? []) as any[]).map((x) => ({
      n: num(x.n),
      kind: x.kind ?? 'drive',
      quality: x.quality ?? 'off',
      made: !!x.made,
      pts: num(x.pts),
      dunk: !!x.dunk,
      onFire: !!x.on_fire,
      putback: toPutback(x.putback),
    })),
  };
}

export async function getHoopsLive(challengeId: string): Promise<HoopsLive> {
  return toLive(await rpc<any>('hoops_live', { p_challenge_id: challengeId }));
}

// One shot, by hand: the meter's offset from the middle (−0.5 early/short
// … 0.5 late/long). The server decides it and keeps it for tonight.
export async function takeHoopsShot(challengeId: string, kind: HoopsShot, timing: number): Promise<HoopsShotResult> {
  const d = await rpc<any>('hoops_take_shot', { p_challenge_id: challengeId, p_kind: kind, p_timing: Math.max(-0.5, Math.min(0.5, timing)) });
  return {
    n: num(d?.n),
    kind: d?.kind ?? kind,
    quality: d?.quality ?? 'off',
    chance: num(d?.chance),
    made: !!d?.made,
    pts: num(d?.pts),
    dunk: !!d?.dunk,
    onFire: !!d?.on_fire,
    putback: toPutback(d?.putback),
    ready: num(d?.ready),
    todayPts: num(d?.today_pts),
    message: d?.message ?? '',
  };
}

export async function getHoops(challengeId: string): Promise<HoopsGame | null> {
  const d = await rpc<any>('hoops_view', { p_challenge_id: challengeId });
  return d ? toHoopsGame(d) : null;
}

export async function getHoopsPeriod(challengeId: string, period: number): Promise<HoopsPeriod | null> {
  return toPeriod(await rpc<any>('hoops_period', { p_challenge_id: challengeId, p_period: period }));
}

export async function setupHoops(
  challengeId: string,
  opts: { shotSteps: number; daysPerQuarter: number; fillBots: boolean; players: { userId: string; team: HoopsTeam }[]; homeName?: string; awayName?: string; handsOn?: boolean },
): Promise<void> {
  await rpc('hoops_setup', {
    ...(opts.handsOn ? { p_hands_on: true } : {}),
    p_challenge_id: challengeId,
    p_shot_steps: opts.shotSteps,
    p_days_per_quarter: opts.daysPerQuarter,
    p_fill_bots: opts.fillBots,
    p_players: opts.players.map((p) => ({ user_id: p.userId, team: p.team })),
    p_home_name: opts.homeName ?? 'Hounds',
    p_away_name: opts.awayName ?? 'Strays',
  });
}

export async function setHoopsShot(challengeId: string, shot: HoopsShot): Promise<void> {
  await rpc('hoops_set_shot', { p_challenge_id: challengeId, p_shot: shot });
}

export async function voteHoopsDefense(challengeId: string, choice: HoopsDefense): Promise<void> {
  await rpc('hoops_vote', { p_challenge_id: challengeId, p_choice: choice });
}

export async function advanceHoops(challengeId: string): Promise<number> {
  return num(await rpc('hoops_advance', { p_challenge_id: challengeId }));
}

// Who's guarding this player (the opposing player whose `guarding` is
// them), else whoever they guard.
export function hoopsDefenderOf(game: HoopsGame, playerId: string): HoopsPlayer | null {
  const me = game.players.find((p) => p.id === playerId);
  if (!me) return null;
  return (
    game.players.find((p) => p.team !== me.team && p.guarding === playerId) ??
    game.players.find((p) => p.id === me.guarding) ??
    null
  );
}

// ── Admin ──

export interface HoopsConfig {
  enabled: boolean;
  win_bones: number;
  play_bones: number;
  bot_steps: number;
}

export interface HoopsOverview {
  config: HoopsConfig;
  hoopsLive: number;
  hoops7d: number;
  hoopsAll: number;
  players7d: number;
  shots7d: number;
  dunks7d: number;
  onFire7d: number;
  horseLive: number;
  horse7d: number;
  horseAll: number;
  bones7d: number;
  // 0206: shots taken by hand.
  live: { gamesHandsOn: number; people7d: number; shots7d: number; makeRate7d: number | null; autoMakeRate7d: number | null; swish7d: number } | null;
  // 0209: H-O-R-S-E, calling your own shots.
  horseHandsOn: {
    gamesHandsOn: number;
    people7d: number;
    shots7d: number;
    madeRate7d: number | null;
    highlights7d: number;
    farShots7d: number;
    stakesPaidAll: number;
    timeouts7d: number;
  } | null;
}

function toHorseHandsOn(h: any): HoopsOverview['horseHandsOn'] {
  if (!h || typeof h !== 'object') return null;
  return {
    gamesHandsOn: num(h.games_hands_on),
    people7d: num(h.people_7d),
    shots7d: num(h.shots_7d),
    madeRate7d: h.made_rate_7d == null ? null : Number(h.made_rate_7d),
    highlights7d: num(h.highlights_7d),
    farShots7d: num(h.far_shots_7d),
    stakesPaidAll: num(h.stakes_paid_all),
    timeouts7d: num(h.timeouts_7d),
  };
}

export async function getHoopsOverview(): Promise<HoopsOverview> {
  const d = await rpc<any>('admin_hoops_overview');
  return {
    config: {
      enabled: d.config?.enabled !== false,
      win_bones: num(d.config?.win_bones),
      play_bones: num(d.config?.play_bones),
      bot_steps: num(d.config?.bot_steps),
    },
    hoopsLive: num(d.hoops_live),
    hoops7d: num(d.hoops_7d),
    hoopsAll: num(d.hoops_all),
    players7d: num(d.players_7d),
    shots7d: num(d.shots_7d),
    dunks7d: num(d.dunks_7d),
    onFire7d: num(d.on_fire_7d),
    horseLive: num(d.horse_live),
    horse7d: num(d.horse_7d),
    horseAll: num(d.horse_all),
    bones7d: num(d.bones_7d),
    live: d.live
      ? {
          gamesHandsOn: num(d.live.games_hands_on),
          people7d: num(d.live.people_7d),
          shots7d: num(d.live.shots_7d),
          makeRate7d: d.live.make_rate_7d == null ? null : Number(d.live.make_rate_7d),
          autoMakeRate7d: d.live.auto_make_rate_7d == null ? null : Number(d.live.auto_make_rate_7d),
          swish7d: num(d.live.swish_7d),
        }
      : null,
    horseHandsOn: toHorseHandsOn(d.horse_hands_on),
  };
}

export async function setHoopsConfig(patch: Partial<HoopsConfig>): Promise<void> {
  await rpc('admin_set_hoops_config', { p: patch });
}

export function hoopsSummary(o: HoopsOverview): string {
  const byHand = o.live && o.live.shots7d > 0 ? ` · ${o.live.shots7d} shots by hand` : '';
  const called = o.horseHandsOn && o.horseHandsOn.shots7d > 0 ? ` · ${o.horseHandsOn.shots7d} called shots` : '';
  return `${o.hoopsLive} Hoops and ${o.horseLive} H-O-R-S-E on now · ${o.hoops7d + o.horse7d} this week${byHand}${called}`;
}
