import { RANKS, type Rank } from '../challenges/ranks';

// Moon forms: the transformation your hound goes through at each new rank
// (a tester, Nov 2026: "I need my hound animated... like a werewolf as I
// grow in levels. Let's get some cut scenes going"). Each rank has its own
// night and its own cut scene (MoonScene), and adds to how the hound looks
// (HoundArt's `moon`): a crescent mark, a shaggy ruff, glowing eyes, a
// moonlight aura. Scenes for ranks you've already reached can be watched
// again any time (the Kennel's Moon forms).

export type MoonPhase = 'crescent' | 'half' | 'full' | 'blue';
export type MoonScenery = 'meadow' | 'forest' | 'ridge' | 'aurora';

export interface MoonForm {
  rank: Rank['id'];
  level: number;
  // The scene's name and the form's.
  title: string;
  form: string;
  // What changed, under the title.
  gains: string;
  phase: MoonPhase;
  scenery: MoonScenery;
  // Sky, top to horizon, and the ground's colour.
  sky: [string, string];
  ground: string;
  // Words over the scene before the change.
  caption: string;
}

export const MOON_FORMS: MoonForm[] = [
  {
    rank: 'tracker',
    level: 5,
    title: 'First Moon',
    form: 'Tracker',
    gains: 'Bigger, with the moon’s mark on its brow',
    phase: 'crescent',
    scenery: 'meadow',
    sky: ['#0e1636', '#33407a'],
    ground: '#1c2a2a',
    caption: 'A thin moon rises over the meadow…',
  },
  {
    rank: 'hunter',
    level: 10,
    title: 'Forest Moon',
    form: 'Hunter',
    gains: 'Bigger again, with a shaggy ruff',
    phase: 'half',
    scenery: 'forest',
    sky: ['#0a1426', '#24405a'],
    ground: '#101c18',
    caption: 'Deep in the pines, the half moon calls…',
  },
  {
    rank: 'alpha',
    level: 15,
    title: 'Full Moon',
    form: 'Alpha',
    gains: 'Full grown, with glowing eyes and a wild ruff',
    phase: 'full',
    scenery: 'ridge',
    sky: ['#120c2a', '#4a2f5c'],
    ground: '#1a1424',
    caption: 'The full moon climbs over the ridge…',
  },
  {
    rank: 'legend',
    level: 20,
    title: 'Blue Moon',
    form: 'Legend',
    gains: 'Wrapped in moonlight, with stars in its aura',
    phase: 'blue',
    scenery: 'aurora',
    sky: ['#050a1e', '#163a5c'],
    ground: '#0c1626',
    caption: 'Once in a blue moon, the sky lights up…',
  },
];

export function moonFormFor(rank: Rank['id']): MoonForm | null {
  return MOON_FORMS.find((f) => f.rank === rank) ?? null;
}

// The rank just before, for the "before" hound in a scene.
export function rankBefore(rank: Rank['id']): Rank['id'] {
  const i = RANKS.findIndex((r) => r.id === rank);
  return RANKS[Math.max(0, i - 1)].id;
}

// The forms you've reached at this level.
export function formsReached(level: number): MoonForm[] {
  return MOON_FORMS.filter((f) => level >= f.level);
}
