import type React from 'react';
import {
  FlagIcon,
  FlagCheckeredIcon,
  FlameIcon,
  FootprintsIcon,
  HandTapIcon,
  PawPrintIcon,
} from 'phosphor-react-native';
import type { ChallengeKind } from './sampleData';

export const CHALLENGE_KIND_ICON: Record<ChallengeKind, React.ComponentType<any>> = {
  hunt: PawPrintIcon,
  steps: FootprintsIcon,
  streak: FlameIcon,
  distance: FlagCheckeredIcon,
  tag: HandTapIcon,
};

// A build only ever ships knowing the challenge kinds that existed when
// it was compiled — a real server can (and, on a staggered rollout,
// will) start returning a newer kind before every installed client has
// updated to recognize it. `CHALLENGE_KIND_ICON[kind]` is `undefined`
// for anything outside that fixed map, and rendering `undefined` as a
// component throws ("Element type is invalid... got: undefined"),
// crashing the whole screen instead of just that one row. Callers
// indexing by real data (not a kind from this build's own
// CHALLENGE_TYPES list) should fall back to this rather than trust the
// lookup unconditionally.
export const DEFAULT_CHALLENGE_ICON: React.ComponentType<any> = FlagIcon;
