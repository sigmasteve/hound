// Move points (0270_move_points.sql): the pure part. The guided routines
// and strength templates Hound ships, the activities' names, and how a
// day's points read. Mock-ups: claude.ai/artifact/LXZQp7xBLLJdXTGicvTojm.

export interface RoutineMove {
  name: string;
  cue: string;
}

export interface Routine {
  // Sent to the server as the session's ref; a stretch routine's id starts
  // with 'stretch' so it counts as stretching, not strength.
  id: string;
  name: string;
  short: string;
  gear: string;
  rounds: number;
  workSec: number;
  restSec: number;
  moves: RoutineMove[];
}

export const ROUTINES: Routine[] = [
  {
    id: 'full10',
    name: '10-minute full body',
    short: 'Full body',
    gear: 'Bodyweight',
    rounds: 2,
    workSec: 40,
    restSec: 20,
    moves: [
      { name: 'Squats', cue: 'Feet shoulder-width, sit back like there’s a chair behind you.' },
      { name: 'Push-ups', cue: 'Knees down is fine. Chest toward the floor, push away.' },
      { name: 'Glute bridge', cue: 'Feet flat, squeeze and lift your hips.' },
      { name: 'Plank', cue: 'Elbows under shoulders, one long straight line.' },
      { name: 'Reverse lunges', cue: 'Step back, back knee toward the floor, alternate legs.' },
    ],
  },
  {
    id: 'quick7',
    name: '7-minute quick start',
    short: 'Quick 7',
    gear: 'Bodyweight and a chair',
    rounds: 1,
    workSec: 30,
    restSec: 5,
    moves: [
      { name: 'Jumping jacks', cue: 'Or step side to side. Keep moving.' },
      { name: 'Wall sit', cue: 'Back on the wall, knees over ankles.' },
      { name: 'Push-ups', cue: 'Knees down, or hands on the chair seat.' },
      { name: 'Crunches', cue: 'Lift your shoulders, not your neck.' },
      { name: 'Step-ups', cue: 'Onto a sturdy chair or a step, alternate legs.' },
      { name: 'Squats', cue: 'Sit back and stand tall.' },
      { name: 'Chair dips', cue: 'Hands on the seat edge, bend your elbows back.' },
      { name: 'Plank', cue: 'Hold it straight. Knees down if you need.' },
      { name: 'High knees', cue: 'March or jog in place.' },
      { name: 'Lunges', cue: 'Alternate legs, upright chest.' },
      { name: 'Push-up and rotate', cue: 'Push up, then turn to a side plank. Alternate.' },
      { name: 'Side plank', cue: 'Switch sides halfway.' },
    ],
  },
  {
    id: 'db18',
    name: '18-minute dumbbells',
    short: 'Dumbbells',
    gear: 'A pair of dumbbells',
    rounds: 3,
    workSec: 45,
    restSec: 15,
    moves: [
      { name: 'Goblet squat', cue: 'Hold one dumbbell at your chest, sit between your heels.' },
      { name: 'Dumbbell row', cue: 'Hinge forward, pull to your hip, alternate arms.' },
      { name: 'Shoulder press', cue: 'Press overhead, ribs down.' },
      { name: 'Romanian deadlift', cue: 'Soft knees, push your hips back, flat back.' },
      { name: 'Floor press', cue: 'Lying down, press up, elbows touch the floor.' },
      { name: 'Dead bug', cue: 'Back flat, opposite arm and leg reach out.' },
    ],
  },
  {
    id: 'stretch5',
    name: '5-minute desk stretch',
    short: 'Desk stretch',
    gear: 'Just you',
    rounds: 1,
    workSec: 50,
    restSec: 10,
    moves: [
      { name: 'Neck rolls', cue: 'Slow half circles, ear toward shoulder.' },
      { name: 'Shoulder circles', cue: 'Big circles back, then forward.' },
      { name: 'Chair squats', cue: 'Stand up and sit down, slowly.' },
      { name: 'Calf raises', cue: 'Up on your toes, hold, and down.' },
      { name: 'Hip flexor stretch', cue: 'Lunge back, tuck your hips. Switch halfway.' },
    ],
  },
];

export function routineById(id: string): Routine | undefined {
  return ROUTINES.find((r) => r.id === id);
}

// Every step of a routine in order: a move, then rest (no rest after the last).
export interface RoutineStep {
  move: RoutineMove;
  round: number;
  work: boolean;
  sec: number;
}

export function routineSteps(r: Routine): RoutineStep[] {
  const steps: RoutineStep[] = [];
  for (let round = 0; round < r.rounds; round++) {
    r.moves.forEach((m, i) => {
      steps.push({ move: m, round, work: true, sec: r.workSec });
      const last = round === r.rounds - 1 && i === r.moves.length - 1;
      if (!last && r.restSec > 0) steps.push({ move: r.moves[(i + 1) % r.moves.length], round, work: false, sec: r.restSec });
    });
  }
  return steps;
}

export function routineSeconds(r: Routine): number {
  return routineSteps(r).reduce((s, x) => s + x.sec, 0);
}

export function routineMinutes(r: Routine): number {
  return Math.max(1, Math.round(routineSeconds(r) / 60));
}

// ── Strength log templates ──

export interface StrengthTemplate {
  id: string;
  name: string;
  exercises: string[];
}

export const TEMPLATES: StrengthTemplate[] = [
  { id: 'full', name: 'Full body', exercises: ['Goblet squat', 'Push-up', 'Dumbbell row', 'Romanian deadlift', 'Plank'] },
  { id: 'push', name: 'Push', exercises: ['Bench press', 'Shoulder press', 'Push-up', 'Triceps dip'] },
  { id: 'pull', name: 'Pull', exercises: ['Lat pulldown', 'Seated row', 'Dumbbell row', 'Biceps curl'] },
  { id: 'legs', name: 'Legs', exercises: ['Goblet squat', 'Romanian deadlift', 'Walking lunges', 'Leg press', 'Calf raise'] },
  { id: 'core', name: 'Core', exercises: ['Plank', 'Dead bug', 'Russian twist', 'Hanging knee raise'] },
  { id: 'own', name: 'Start empty', exercises: [] },
];

export function templateById(id: string): StrengthTemplate {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[TEMPLATES.length - 1];
}

// ── Activities ──

export const ACTIVITY_LABEL: Record<string, string> = {
  steps: 'Walk, run or hike',
  stretching: 'Stretching',
  yoga: 'Yoga',
  pilates: 'Pilates',
  housework: 'Housework',
  strength_heavy: 'Strength, hard',
  strength_light: 'Strength',
  pickleball: 'Pickleball',
  dance: 'Dance',
  elliptical: 'Elliptical',
  swim: 'Swimming',
  basketball: 'Basketball',
  spin: 'Spin class',
  cycling: 'Cycling',
  rowing: 'Rowing',
  tennis_soccer: 'Tennis or soccer',
  hiit: 'HIIT',
  other: 'Workout',
};

export function isStrength(activity: string): boolean {
  return activity === 'strength_light' || activity === 'strength_heavy';
}

export function fmtPts(n: number): string {
  return Math.round(n).toLocaleString();
}

export function clockMS(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
