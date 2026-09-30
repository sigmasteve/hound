import { FireIcon, FootprintsIcon, MapPinIcon, TimerIcon } from 'phosphor-react-native';
import type { RecordKind } from './personalRecords';

export const RECORD_ICON: Record<RecordKind, typeof FireIcon> = {
  best_day_steps: FootprintsIcon,
  longest_streak_days: FireIcon,
  farthest_day_mi: MapPinIcon,
  longest_workout_min: TimerIcon,
};
