import { supabase } from '../lib/supabase';
import { localDayKey } from '../goals/goals';
import { taskShort, type Door, type DoorState, type DoorTaskKind } from './doors';

// The client half of Daily Doors — see 0172_doors.sql. The server keeps
// the calendar, scores the tasks and holds the board; the phone opens
// today's door and, for a steps door, reports its own count.

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

export interface DoorsBoardRow {
  userId: string;
  points: number;
  done: number;
  run: number;
  place: number;
}

export interface DoorsGame {
  firstDay: string;
  doors: Door[];
  points: number;
  run: number;
  opened: number;
  done: number;
  place: number | null;
  players: number;
  // The top ten and the viewer's own row.
  board: DoorsBoardRow[];
  stepsToday: number | null;
  waterMl: number;
  waterTargetMl: number;
  settled: boolean;
  // Admin's numbers (doors_settings): Bones behind every Nth door, and
  // for everyone when it's over.
  bonusEvery: number;
  finishBones: number;
}

function fromServer(j: any): DoorsGame {
  return {
    firstDay: String(j.firstDay),
    doors: (j.doors ?? []).map(
      (d: any): Door => ({
        no: d.no,
        day: String(d.day),
        state: d.state as DoorState,
        task: d.task ? { kind: d.task as DoorTaskKind, steps: d.stepsTarget ?? undefined } : null,
        bonus:
          [d.bonusBones > 0 ? `${d.bonusBones} Bones` : null, d.prizeId ? 'the Doorbell Ring for your Locker' : null].filter(Boolean).join(' and ') ||
          null,
      }),
    ),
    points: j.points ?? 0,
    run: j.run ?? 0,
    opened: j.opened ?? 0,
    done: j.done ?? 0,
    place: j.place ?? null,
    players: j.players ?? 0,
    board: (j.board ?? []).map((b: any) => ({ userId: b.userId, points: b.points, done: b.done, run: b.run, place: b.place })),
    stepsToday: j.stepsToday ?? null,
    waterMl: j.waterMl ?? 0,
    waterTargetMl: j.waterTargetMl ?? 1893,
    settled: !!j.settled,
    bonusEvery: j.bonusEvery ?? 3,
    finishBones: j.finishBones ?? 25,
  };
}

export async function getDoors(challengeId: string): Promise<DoorsGame> {
  const { data, error } = await requireClient().rpc('doors_state', { p_challenge_id: challengeId, p_day: localDayKey(new Date()) });
  if (error) throw new Error(error.message);
  return fromServer(data);
}

export async function openDoor(challengeId: string): Promise<DoorsGame> {
  const { data, error } = await requireClient().rpc('doors_open', { p_challenge_id: challengeId, p_day: localDayKey(new Date()) });
  if (error) throw new Error(error.message);
  return fromServer(data);
}

// A steps door done on the phone's own count for today. True when it
// marked one done.
export async function claimDoorSteps(challengeId: string, steps: number): Promise<boolean> {
  const { data, error } = await requireClient().rpc('doors_claim_steps', {
    p_challenge_id: challengeId,
    p_day: localDayKey(new Date()),
    p_steps: Math.max(0, Math.round(steps)),
  });
  if (error) throw new Error(error.message);
  return !!data;
}

// Today's door, for Today and Needs you: its number and whether it's
// still shut, or null when there's none today.
export function todaysDoor(game: DoorsGame, today = localDayKey(new Date())): Door | null {
  return game.doors.find((d) => d.day === today) ?? null;
}

export interface DoorsAdminOverview {
  challenges: number;
  live: number;
  joined: number;
  everOpened: number;
  openedToday: number;
  doneToday: number;
  opens: number;
  done: number;
  prizes: number;
  settings: DoorsSettings;
  days: { day: string; opened: number; done: number }[];
  tasks: { task: DoorTaskKind; opened: number; done: number }[];
  games: { name: string; players: number; door: number; doors: number; openedToday: number; doneToday: number }[];
}

export async function getDoorsAdminOverview(): Promise<DoorsAdminOverview> {
  const { data, error } = await requireClient().rpc('admin_doors_overview');
  if (error) throw new Error(error.message);
  return data as DoorsAdminOverview;
}

// Today's line for a Daily Doors challenge: "Door 6 is open. Knock knock!"
export function doorsHeadline(name: string, game: DoorsGame | null): string {
  if (!game) return name;
  const d = todaysDoor(game);
  const standing = game.place != null ? ` · ${game.points} points, #${game.place}` : '';
  if (!d) return `${name}: ${game.points} points${game.place != null ? `, #${game.place} of ${game.players.toLocaleString()}` : ''}`;
  if (d.state === 'ready') return `${name}: Door ${d.no} is open. Knock knock!`;
  if (d.state === 'done') return `${name}: Door ${d.no} done${standing}`;
  return `${name}: Door ${d.no}, ${d.task ? taskShort(d.task).toLowerCase() : 'its task'} by midnight${standing}`;
}

// Admin → Daily Doors: which doors have Bones behind them (every Nth, a
// random amount from low to high) and the Bones everyone gets when it's
// over. The table's own policy lets only admins change them.
export interface DoorsSettings {
  bonusEvery: number;
  bonusMin: number;
  bonusMax: number;
  finishBones: number;
}

export async function setDoorsSettings(s: DoorsSettings): Promise<void> {
  const { data, error } = await requireClient()
    .from('doors_settings')
    .update({
      bonus_every: s.bonusEvery,
      bonus_min: s.bonusMin,
      bonus_max: s.bonusMax,
      finish_bones: s.finishBones,
      updated_at: new Date().toISOString(),
    })
    .eq('id', true)
    .select('id');
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error('Only an admin can change these.');
}
