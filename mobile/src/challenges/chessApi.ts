import { supabase } from '../lib/supabase';
import type { ChessBotLevel, ChessColor, ChessHistoryMove, ChessNeeds } from './chess';

// The client half of Hound Chess (0238). The server holds the board,
// checks every move and plays the bot; the phone reports its own step
// count (as Daily Doors does), which frees pieces.

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

async function rpc<T = any>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireClient().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

const num = (v: unknown) => Number(v ?? 0);

export interface ChessMoveOption {
  from: string;
  to: string;
  promo: string | null;
}

export interface ChessGame {
  fen: string;
  status: 'waiting' | 'active' | 'final';
  result: 'white' | 'black' | 'draw' | null;
  method: string | null;
  me: ChessColor | null;
  turn: ChessColor;
  myTurn: boolean;
  inCheck: boolean;
  white: { id: string | null; name: string };
  black: { id: string | null; name: string; bot?: ChessBotLevel } | null;
  bot: ChessBotLevel | null;
  deadline: string | null;
  endsAt: string;
  misses: { w: number; b: number };
  plies: number;
  material: number;
  steps: number;
  workoutMin: number;
  // 0239: yesterday counts too. What today alone frees, and yesterday's numbers.
  stepsYesterday: number;
  workoutMinYesterday: number;
  freeToday: string;
  free: string;
  allFree: boolean;
  theirSteps: number | null;
  theirFree: string;
  moves: ChessMoveOption[];
  history: ChessHistoryMove[];
  needs: ChessNeeds;
}

export function toChessGame(d: any): ChessGame {
  return {
    fen: d.fen,
    status: d.status,
    result: d.result ?? null,
    method: d.method ?? null,
    me: d.me ?? null,
    turn: d.turn === 'b' ? 'b' : 'w',
    myTurn: !!d.myTurn,
    inCheck: !!d.inCheck,
    white: { id: d.white?.id ?? null, name: d.white?.name ?? 'White' },
    black: d.black ? { id: d.black.id ?? null, name: d.black.name ?? 'Black', bot: d.black.bot ?? undefined } : null,
    bot: d.bot ?? null,
    deadline: d.deadline ?? null,
    endsAt: d.endsAt,
    misses: { w: num(d.misses?.w), b: num(d.misses?.b) },
    plies: num(d.plies),
    material: num(d.material),
    steps: num(d.steps),
    workoutMin: num(d.workoutMin),
    stepsYesterday: num(d.stepsYesterday),
    workoutMinYesterday: num(d.workoutMinYesterday),
    freeToday: d.freeToday ?? d.free ?? 'PK',
    free: d.free ?? 'PK',
    allFree: !!d.allFree,
    theirSteps: d.theirSteps == null ? null : num(d.theirSteps),
    theirFree: d.theirFree ?? 'PK',
    moves: ((d.moves ?? []) as any[]).map((m) => ({ from: m.from, to: m.to, promo: m.promo ?? null })),
    history: ((d.history ?? []) as any[]).map((m) => ({
      ply: num(m.ply),
      side: m.side,
      piece: m.piece,
      from: m.from,
      to: m.to,
      promo: m.promo ?? null,
      captured: m.captured ?? null,
      check: !!m.check,
      auto: !!m.auto,
    })),
    needs: {
      knightBishop: num(d.needs?.knightBishop) || 2500,
      rook: num(d.needs?.rook) || 5000,
      queen: num(d.needs?.queen) || 7500,
      queenWorkout: num(d.needs?.queenWorkout) || 20,
      moveHours: num(d.needs?.moveHours) || 24,
    },
  };
}

export async function setupChess(challengeId: string, bot: ChessBotLevel | null): Promise<void> {
  await rpc('chess_setup', { p_challenge_id: challengeId, p_bot: bot });
}

export async function claimChessSteps(steps: number): Promise<void> {
  await rpc('chess_claim_steps', { p_steps: Math.max(0, Math.min(150000, Math.round(steps))) });
}

export async function getChess(challengeId: string): Promise<ChessGame> {
  return toChessGame(await rpc('chess_state', { p_challenge_id: challengeId }));
}

export async function playChessMove(challengeId: string, from: string, to: string, promo: string | null = null): Promise<ChessGame> {
  return toChessGame(await rpc('chess_move', { p_challenge_id: challengeId, p_from: from, p_to: to, p_promo: promo }));
}

// Undo (0258): take back your last move within a few seconds, before they
// reply (against the bot, its answer comes off too).
// Admin (0258): how often Undo is used.
export interface ChessUndoOverview {
  undos7d: number;
  people7d: number;
  peopleEver: number;
  bot7d: number;
  moves7d: number;
}

export async function getChessUndoOverview(): Promise<ChessUndoOverview | null> {
  try {
    const d = await rpc<any>('admin_chess_undo_overview', {});
    const n = (v: unknown) => Number(v ?? 0);
    return { undos7d: n(d?.undos_7d), people7d: n(d?.people_7d), peopleEver: n(d?.people_ever), bot7d: n(d?.bot_7d), moves7d: n(d?.moves_7d) };
  } catch {
    // Before 0258 is run.
    return null;
  }
}

export async function undoChessMove(challengeId: string): Promise<ChessGame> {
  return toChessGame(await rpc('chess_undo', { p_challenge_id: challengeId }));
}

// The chess clock (0259): each side's time used so far, in seconds, who's
// on the clock, since when, and the server's time (to tick without drift).
export interface ChessClock {
  w: number;
  b: number;
  running: 'w' | 'b' | null;
  since: number | null;
  serverNow: number;
  fetchedAt: number;
}

export async function getChessClock(challengeId: string): Promise<ChessClock | null> {
  try {
    const d = await rpc<any>('chess_clock', { p_challenge_id: challengeId });
    return {
      w: Number(d?.w ?? 0),
      b: Number(d?.b ?? 0),
      running: d?.running === 'w' || d?.running === 'b' ? d.running : null,
      since: d?.since ? Date.parse(d.since) : null,
      serverNow: d?.now ? Date.parse(d.now) : Date.now(),
      fetchedAt: Date.now(),
    };
  } catch {
    // Before 0259 is run: no clock.
    return null;
  }
}

// Each player's look (0260), for their hound under the clock. Null for the
// bot's side, or before 0260 is run.
export interface ChessLook {
  initials: string;
  iconId: string | null;
  frameId: string | null;
  backgroundId: string | null;
}

export async function getChessLooks(challengeId: string): Promise<{ w: ChessLook | null; b: ChessLook | null }> {
  try {
    const d = await rpc<any>('chess_looks', { p_challenge_id: challengeId });
    const look = (x: any): ChessLook | null =>
      x ? { initials: String(x.initials ?? ''), iconId: x.icon_id ?? null, frameId: x.frame_id ?? null, backgroundId: x.background_id ?? null } : null;
    return { w: look(d?.w), b: look(d?.b) };
  } catch {
    return { w: null, b: null };
  }
}

// A side's time on the clock now, in seconds.
export function clockSeconds(c: ChessClock, side: 'w' | 'b', now: number): number {
  const base = side === 'w' ? c.w : c.b;
  if (c.running !== side || c.since == null) return base;
  return base + Math.max(0, (c.serverNow - c.since + (now - c.fetchedAt)) / 1000);
}

// 0:42, 12:05, 1:02:33, then 2d 4h for a long correspondence game.
export function clockText(sec: number): string {
  const s = Math.floor(sec);
  if (s >= 86400) return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export async function resignChess(challengeId: string): Promise<ChessGame> {
  return toChessGame(await rpc('chess_resign', { p_challenge_id: challengeId }));
}

export interface ChessPuzzle {
  day: string;
  open: boolean;
  steps: number;
  need: number;
  fen: string | null;
  theme: string | null;
  tries: number;
  maxTries: number;
  solved: boolean;
  firstTry: boolean | null;
  bones: number;
  bonesFirst: number;
  bonesLater: number;
  streak: number;
  moves: ChessMoveOption[];
}

function toPuzzle(d: any): ChessPuzzle {
  return {
    day: d.day,
    open: !!d.open,
    steps: num(d.steps),
    need: num(d.need) || 5000,
    fen: d.fen ?? null,
    theme: d.theme ?? null,
    tries: num(d.tries),
    maxTries: num(d.maxTries) || 3,
    solved: !!d.solved,
    firstTry: d.firstTry ?? null,
    bones: num(d.bones),
    bonesFirst: num(d.bonesFirst),
    bonesLater: num(d.bonesLater),
    streak: num(d.streak),
    moves: ((d.moves ?? []) as any[]).map((m) => ({ from: m.from, to: m.to, promo: m.promo ?? null })),
  };
}

export async function getChessPuzzle(steps: number | null): Promise<ChessPuzzle> {
  return toPuzzle(await rpc('chess_puzzle_state', { p_steps: steps == null ? null : Math.max(0, Math.min(150000, Math.round(steps))) }));
}

export async function tryChessPuzzle(from: string, to: string, promo: string | null = null): Promise<ChessPuzzle & { mate: boolean; check: boolean; fenAfter: string; earned: number }> {
  const d = await rpc<any>('chess_puzzle_try', { p_from: from, p_to: to, p_promo: promo });
  return { ...toPuzzle(d), mate: !!d.mate, check: !!d.check, fenAfter: d.fenAfter, earned: num(d.bones) };
}

// Today's line on the pinned view and Needs you.
export function chessHeadline(name: string, g: ChessGame | null): string {
  if (!g) return name;
  const them = (g.me === 'w' ? g.black?.name : g.white.name) ?? 'your opponent';
  const first = them.split(' ')[0];
  if (g.status === 'waiting') return `Waiting for your opponent to join`;
  if (g.status === 'final') return g.result === 'draw' ? `Drawn with ${first}` : (g.result === 'white') === (g.me === 'w') ? `You beat ${first}` : `${first} won`;
  if (g.myTurn) return g.inCheck ? `You’re in check: your move against ${first}` : `Your move against ${first}`;
  return `${first} to move`;
}

export interface ChessOverview {
  live: number;
  waiting: number;
  finished: number;
  vsFriend: number;
  vsBot: { easy: number; medium: number; hard: number };
  botRecord: { won: number; lost: number; drawn: number };
  endings: Record<string, number>;
  players7d: number;
  moves7d: number;
  autoMoves7d: number;
  restingMoves7d: number;
  queenResting7d: number;
  puzzlesOpened7d: number;
  puzzlers7d: number;
  puzzlesSolved7d: number;
  puzzlesFirstTry7d: number;
  puzzleBones: number;
}

export async function getChessOverview(): Promise<ChessOverview> {
  const d = await rpc<any>('admin_chess_overview', {});
  return {
    live: num(d.live),
    waiting: num(d.waiting),
    finished: num(d.finished),
    vsFriend: num(d.vsFriend),
    vsBot: { easy: num(d.vsBot?.easy), medium: num(d.vsBot?.medium), hard: num(d.vsBot?.hard) },
    botRecord: { won: num(d.botRecord?.won), lost: num(d.botRecord?.lost), drawn: num(d.botRecord?.drawn) },
    endings: d.endings ?? {},
    players7d: num(d.players7d),
    moves7d: num(d.moves7d),
    autoMoves7d: num(d.autoMoves7d),
    restingMoves7d: num(d.restingMoves7d),
    queenResting7d: num(d.queenResting7d),
    puzzlesOpened7d: num(d.puzzlesOpened7d),
    puzzlers7d: num(d.puzzlers7d),
    puzzlesSolved7d: num(d.puzzlesSolved7d),
    puzzlesFirstTry7d: num(d.puzzlesFirstTry7d),
    puzzleBones: num(d.puzzleBones),
  };
}

export function chessSummary(o: ChessOverview): string {
  if (o.live + o.waiting + o.finished === 0) return 'No games yet';
  return `${o.live} live · ${o.players7d} moved this week · ${o.puzzlesSolved7d} puzzles solved`;
}
