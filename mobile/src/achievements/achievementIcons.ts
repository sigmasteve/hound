import type React from 'react';
import {
  CalendarCheckIcon,
  CalendarStarIcon,
  CrownIcon,
  FireIcon,
  FlagCheckeredIcon,
  FootprintsIcon,
  GridNineIcon,
  HandshakeIcon,
  MedalIcon,
  SneakerMoveIcon,
  StarIcon,
  TrophyIcon,
  UsersThreeIcon,
} from 'phosphor-react-native';

// Badge glyph per achievement id (0072_achievements.sql's seeded rows).
// An id this build doesn't know yet — one added server-side later — gets
// DEFAULT_ACHIEVEMENT_ICON rather than breaking the screen.
export const ACHIEVEMENT_ICONS: Record<string, React.ComponentType<any>> = {
  first_finish: FlagCheckeredIcon,
  ten_finishes: MedalIcon,
  first_win: TrophyIcon,
  blackout: GridNineIcon,
  unbroken: FireIcon,
  first_friend: HandshakeIcon,
  five_friends: UsersThreeIcon,
  steps_10k_day: FootprintsIcon,
  steps_100k_week: SneakerMoveIcon,
  streak_7: CalendarCheckIcon,
  streak_30: CalendarStarIcon,
  level_5: StarIcon,
  level_10: CrownIcon,
};

export const DEFAULT_ACHIEVEMENT_ICON: React.ComponentType<any> = MedalIcon;

export function achievementIcon(id: string): React.ComponentType<any> {
  return ACHIEVEMENT_ICONS[id] ?? DEFAULT_ACHIEVEMENT_ICON;
}
