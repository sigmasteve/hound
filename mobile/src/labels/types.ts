// The customizable words a chase's three roles show up as everywhere in
// the app — the leaderboard's role Tag, Home's hero copy, and the Create
// wizard's "Who's the Chaser?" step. The challenge kind's own display name
// ("Chase" — see huntKindName in ../challenges/present) isn't built from
// these anymore, so it isn't part of this set. Internal role identifiers
// (HuntRole — 'hunter' | 'hunted' | 'zombie' in ../challenges/types) never
// change; this is purely what a screen displays for them.
export interface HuntLabels {
  hunter: string;
  hunted: string;
  zombie: string;
}

// What every screen shows before the real, shared row loads (or when
// nobody's ever changed it, or Supabase isn't configured) — the app's
// current, generic wording (0017_rename_hunt_labels_to_chase.sql and
// 0124_chaser_label.sql are the backend half). "Chaser", not "Hound":
// your hound is the pet in the Kennel, and a chase's hunter shouldn't
// share its name.
export const DEFAULT_HUNT_LABELS: HuntLabels = {
  hunter: 'Chaser',
  hunted: 'Fox',
  zombie: 'Out',
};
