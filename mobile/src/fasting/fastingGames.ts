// Fasting phase games (0269_fasting_games.sql): the pure part. Which game
// each slot plays, the day's content built from the server's seed (the
// same for everyone that day), and the scores, mirroring
// fasting_game_score. Mock-ups: claude.ai/artifact/U1CrpWcmrmk9ijwxZSaAuK.

export type GameSlot = "settling" | "fatburn" | "ketosis" | "goal";
export type GameKind = "craving" | "pour" | "burn" | "clarity" | "refeed";

export const SLOT_STAGE: Record<GameSlot, string> = {
  settling: "settling",
  fatburn: "fatburn",
  ketosis: "ketosis",
  goal: "goal",
};

export const SLOT_NAME: Record<GameSlot, string> = {
  settling: "Settling",
  fatburn: "Fat burning",
  ketosis: "Ketosis",
  goal: "Goal",
};

export const GAME_INFO: Record<
  GameKind,
  { name: string; secs: string; how: string; teaser: string }
> = {
  craving: {
    name: "Craving Control",
    secs: "45 s",
    how: "Each card: does it keep your fast, or break it? Swipe or tap. Cards speed up.",
    teaser: "Sort what keeps a fast from what breaks it.",
  },
  pour: {
    name: "Steady Pour",
    secs: "20 s",
    how: "Hold to pour, let go on the line. Three glasses, each line somewhere new.",
    teaser: "Three glasses, let go on the line.",
  },
  burn: {
    name: "Burn Zone",
    secs: "30 s",
    how: "Hold anywhere to push the needle up; let go and it drifts down, faster at times. Keep it in the zone for 30 s.",
    teaser: "Hold the needle in the zone for 30 seconds.",
  },
  clarity: {
    name: "Clarity",
    secs: "20 s",
    how: "Tap the moment the target appears. Five rounds. Tapping early costs you.",
    teaser: "A five-round reaction test, in milliseconds.",
  },
  refeed: {
    name: "Refeed",
    secs: "12 s",
    how: "Build an easy first meal: pick 4 in 12 seconds. Gentle and protein first scores best.",
    teaser: "Build a gentle first meal in 12 seconds.",
  },
};

// A small seeded generator (mulberry32), so a seed gives everyone the same run.
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Craving Control ──

export interface CravingCard {
  name: string;
  detail: string;
  keeps: boolean;
}

const KEEPS: [string, string][] = [
  ["Water", "still or sparkling"],
  ["Black coffee", "no milk, no sugar"],
  ["Green tea", "plain"],
  ["Sparkling water", "with a slice of lemon"],
  ["Electrolytes", "unsweetened"],
  ["Peppermint tea", "herbal"],
  ["Americano", "black"],
  ["Espresso", "a double"],
  ["Cold brew", "black, over ice"],
  ["Mineral water", "a pinch of salt"],
];
const BREAKS: [string, string][] = [
  ["Oat milk latte", "16 oz"],
  ["Orange juice", "fresh squeezed"],
  ["Green smoothie", "spinach and banana"],
  ["Regular soda", "12 oz can"],
  ["Butter coffee", "sold as “keto”"],
  ["Protein shake", "30 g whey"],
  ["Honey in tea", "one spoon"],
  ["IPA", "one pint"],
  ["Coffee with cream", "and a sugar"],
  ["Kombucha", "sweetened"],
  ["Chai latte", "from the café"],
];

export const CRAVING_CARDS = 20;

export function cravingDeck(seed: number): CravingCard[] {
  const r = rng(seed);
  return Array.from({ length: CRAVING_CARDS }, () => {
    const keeps = r() < 0.45;
    const src = keeps ? KEEPS : BREAKS;
    const [name, detail] = src[Math.floor(r() * src.length)];
    return { name, detail, keeps };
  });
}

export const cravingMs = (i: number) => 2400 - i * 75;

// ── Steady Pour ──

export function pourLines(seed: number): number[] {
  const r = rng(seed);
  return [0, 1, 2].map(() => Math.round(45 + r() * 43));
}

// ── Burn Zone ──

export const BURN_SECS = 30;
// 0.18 s to answer, 36 a second up, 21 to 33 down: a quick thumb keeps it
// in 90% of the time or more, a slower one about 60 to 80%.
export const BURN_ZONE: [number, number] = [57, 75];

// How hard the needle falls, second by second.
export function burnDrag(seed: number): number[] {
  const r = rng(seed);
  return Array.from({ length: BURN_SECS + 1 }, () => 0.6 + r() * 1.0);
}

// ── Clarity ──

export interface ClarityRound {
  delayMs: number;
  x: number;
  y: number;
}

export function clarityRounds(seed: number): ClarityRound[] {
  const r = rng(seed);
  return [0, 1, 2, 3, 4].map(() => ({
    delayMs: 900 + r() * 1700,
    x: 0.15 + r() * 0.7,
    y: 0.15 + r() * 0.7,
  }));
}

export const CLARITY_EARLY_MS = 600;

// ── Refeed ──

export interface RefeedFood {
  name: string;
  detail: string;
  pts: number;
}

const FOODS: RefeedFood[] = [
  { name: "Eggs", detail: "2, scrambled", pts: 3 },
  { name: "Greek yogurt", detail: "plain", pts: 3 },
  { name: "Bone broth", detail: "a mug", pts: 3 },
  { name: "Salmon", detail: "small fillet", pts: 3 },
  { name: "Berries", detail: "a handful", pts: 2 },
  { name: "Avocado", detail: "half", pts: 2 },
  { name: "Lentil soup", detail: "a bowl", pts: 2 },
  { name: "Water", detail: "a big glass", pts: 1 },
  { name: "Glazed donut", detail: "", pts: -2 },
  { name: "Large pizza", detail: "3 slices", pts: -3 },
  { name: "Energy drink", detail: "16 oz", pts: -2 },
  { name: "Fries", detail: "large", pts: -2 },
];

export const REFEED_SECS = 12;

export function refeedFoods(seed: number): RefeedFood[] {
  const r = rng(seed);
  const all = [...FOODS];
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  const nine = all.slice(0, 9);
  // Always at least two 3-point picks on the plate.
  const threes = FOODS.filter((f) => f.pts === 3);
  let k = 0;
  while (nine.filter((f) => f.pts === 3).length < 2) {
    const t = threes[k++];
    if (!nine.includes(t)) nine[nine.findIndex((f) => f.pts < 3)] = t;
  }
  return nine;
}

// ── Scores (mirror fasting_game_score) ──

export type GameStats =
  | { right: number; streak: number }
  | { off: number }
  | { pct: number }
  | { ms: number }
  | { pts: number; left: number };

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function scoreOf(game: GameKind, s: any): number {
  switch (game) {
    case "craving":
      return clamp((s.right / 20) * 85 + Math.min(s.streak, 10) * 1.5);
    case "pour":
      return clamp(100 - s.off * 6);
    case "burn":
      return clamp(s.pct * 1.12);
    case "clarity":
      return clamp((560 - s.ms) / 2.8);
    case "refeed":
      return clamp((s.pts / 12) * 85 + s.left * 1.5);
  }
}
