import type React from 'react';
import {
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
