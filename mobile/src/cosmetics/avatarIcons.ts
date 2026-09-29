import type React from 'react';
import {
  BroomIcon,
  CatIcon,
  CrownIcon,
  DogIcon,
  FireIcon,
  GhostIcon,
  PawPrintIcon,
  RabbitIcon,
  RobotIcon,
  RocketIcon,
  SkullIcon,
} from 'phosphor-react-native';

// Maps IconStyle.icon (catalog.ts) to the actual glyph — kept out of
// catalog.ts itself so that file stays free of RN/phosphor imports, same
// split data/challengeIcons.ts already draws against sampleData.ts.
export const ICON_COMPONENTS: Record<string, React.ComponentType<any>> = {
  paw: PawPrintIcon,
  dog: DogIcon,
  cat: CatIcon,
  rabbit: RabbitIcon,
  fire: FireIcon,
  robot: RobotIcon,
  rocket: RocketIcon,
  crown: CrownIcon,
  ghost: GhostIcon,
  broom: BroomIcon,
  skull: SkullIcon,
};

// A build only ever ships knowing the icon keys that existed when it was
// compiled — see CHALLENGE_KIND_ICON's own comment on why an unrecognized
// key (a newer icon a not-yet-updated client can't render) falls back to
// this instead of ICON_COMPONENTS[key] resolving to undefined and
// crashing the whole screen.
export const DEFAULT_AVATAR_ICON: React.ComponentType<any> = PawPrintIcon;
