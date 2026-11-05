// Daily Doors: a calendar of doors, one opening each morning. Open
// today's door to see today's task; do the task by midnight. Pure
// rules and wording here, no Supabase or React Native imports.
//
//   Opening a door           1 point (it only opens on its own day)
//   Doing its task           +2
//   A run of done doors      +1 a day from the third in a row
//   One missed day a week    forgiven: it doesn't break the run
//
// Every task is scored on the server from data Hound already keeps, so
// nothing is ticked by hand.

export type DoorTaskKind = 'steps' | 'workout' | 'water' | 'goal_day' | 'treat' | 'walk' | 'cheer';

export interface DoorTask {
  kind: DoorTaskKind;
  // Only for 'steps': the viewer's own target, a little over their
  // recent average.
  steps?: number;
}

export type DoorState =
  // A day still to come.
  | 'locked'
  // Today's, not opened yet.
  | 'ready'
  // Opened, task not done (yet, or that day).
  | 'opened'
  // Opened and its task done.
  | 'done'
  // Its day passed without opening it.
  | 'missed';

export interface Door {
  no: number;
  day: string; // YYYY-MM-DD
  state: DoorState;
  // Hidden until opened; a missed door shows what it was.
  task: DoorTask | null;
  // What opening it gave, when it gave something: "5 Bones".
  bonus?: string | null;
}

export const DOOR_POINTS = { open: 1, done: 2, run: 1 } as const;
// The run bonus starts on this many done doors in a row.
export const RUN_FROM = 3;

export function taskTitle(t: DoorTask, houndName: string): string {
  switch (t.kind) {
    case 'steps':
      return `Walk ${(t.steps ?? 0).toLocaleString()} steps`;
    case 'workout':
      return 'Log any workout';
    case 'water':
      return 'Hit your water goal';
    case 'goal_day':
      return 'Close all your daily goals';
    case 'treat':
      return `Give ${houndName} a treat`;
    case 'walk':
      return 'Take a walk of 10 minutes or more';
    case 'cheer':
      return 'Cheer or nudge a friend';
  }
}

// The short name on a past door: "Water", "8,500".
export function taskShort(t: DoorTask): string {
  switch (t.kind) {
    case 'steps':
      return `${Math.round((t.steps ?? 0) / 100) / 10}K`;
    case 'workout':
      return 'Workout';
    case 'water':
      return 'Water';
    case 'goal_day':
      return 'Goals';
    case 'treat':
      return 'Treat';
    case 'walk':
      return 'Walk';
    case 'cheer':
      return 'Cheer';
  }
}

export function taskHint(t: DoorTask): string {
  switch (t.kind) {
    case 'steps':
      return 'A little over your average this past week.';
    case 'workout':
      return 'Any workout your phone or watch records counts.';
    case 'water':
      return 'Log water on Today until your goal’s full.';
    case 'goal_day':
      return 'Every daily goal you’ve set, closed today.';
    case 'treat':
      return 'Feed a treat in the Kennel, homemade or bought.';
    case 'walk':
      return 'One walk of 10 minutes or more, spotted from your steps.';
    case 'cheer':
      return 'A cheer, a nudge or a reaction to a friend.';
  }
}
