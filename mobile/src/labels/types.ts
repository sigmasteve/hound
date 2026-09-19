// The customizable words a hunt's three roles show up as everywhere in
// the app — the leaderboard's role Tag, Home's hero copy, the Create
// wizard's "Who's the Hunter?" step, and the "Hunter & Hunted" challenge
// kind name itself (see huntKindName in ../challenges/present). Internal
// role identifiers (HuntRole — 'hunter' | 'hunted' | 'zombie' in
// ../challenges/types) never change; this is purely what a screen
// displays for them.
export interface HuntLabels {
  hunter: string;
  hunted: string;
  zombie: string;
}

// What every screen shows before the real, shared row loads (or when
// nobody's ever changed it, or Supabase isn't configured) — the app's
// original, only wording until this setting existed.
export const DEFAULT_HUNT_LABELS: HuntLabels = {
  hunter: 'Hunter',
  hunted: 'Hunted',
  zombie: 'Zombie',
};
