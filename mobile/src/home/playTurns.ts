import { useEffect, useState } from 'react';
import type { PendingAction } from '../challenges/pendingActions';
import { noteTodayTap } from './todayExtras';

// Play your turns (0279): each game that's waiting on you, one after
// another. Today opens the first game's own screen; each time you come
// back, it offers the next (and opens it after a short count unless you
// stop), until the last one brings you back to Today.

export interface PlayRun {
  turns: PendingAction[];
  // How many have been opened.
  done: number;
}

let run: PlayRun | null = null;
const listeners = new Set<(r: PlayRun | null) => void>();

function publish(r: PlayRun | null) {
  run = r;
  listeners.forEach((l) => l(r));
}

export function startPlayTurns(turns: PendingAction[]): PendingAction | null {
  if (turns.length === 0) return null;
  noteTodayTap('play_start');
  noteTodayTap('play_turn');
  publish({ turns, done: 1 });
  return turns[0];
}

// The next turn to open, counting it as opened; null at the end.
export function nextPlayTurn(): PendingAction | null {
  if (!run || run.done >= run.turns.length) return null;
  const t = run.turns[run.done];
  noteTodayTap('play_turn');
  publish({ ...run, done: run.done + 1 });
  return t;
}

// The last one's been played: back on Today for good.
export function finishPlayTurns(): void {
  if (!run) return;
  noteTodayTap('play_done');
  publish(null);
}

export function stopPlayTurns(): void {
  if (!run) return;
  noteTodayTap('play_stop');
  publish(null);
}

export function usePlayRun(): PlayRun | null {
  const [r, setR] = useState<PlayRun | null>(run);
  useEffect(() => {
    listeners.add(setR);
    setR(run);
    return () => {
      listeners.delete(setR);
    };
  }, []);
  return r;
}
