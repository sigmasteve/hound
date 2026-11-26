import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  BarbellIcon,
  CheckSquareIcon,
  ClockCountdownIcon,
  DropIcon,
  FootprintsIcon,
  PersonSimpleTaiChiIcon,
  SquareIcon,
  UsersThreeIcon,
  WatchIcon,
} from 'phosphor-react-native';
import { Text } from '../components/Text';
import { useTheme } from '../theme/ThemeContext';
import { font, radius, withAlpha, type Palette } from '../theme/tokens';

// The wizard's "What will you use Hound for?" page: one checkbox per part
// of Hound, each saying what it sets up. Strength asks its days a week
// right there (Move's goal, 1 to 5).

import type { HoundUse } from './welcomeApi';

export type UseId = Extract<HoundUse, 'steps' | 'fasting' | 'workouts' | 'activities' | 'strength' | 'water' | 'friends'>;

export const USE_CHOICES: { id: UseId; name: string; detail: string; sets: string }[] = [
  { id: 'steps', name: 'Steps', detail: 'A step goal, and races and chases', sets: 'Step goal on Today' },
  { id: 'fasting', name: 'Intermittent fasting', detail: 'A live clock, stages and streaks', sets: 'Fasting on Today' },
  { id: 'workouts', name: 'Workouts', detail: 'From your watch, toward your goals', sets: 'Workout goal: 3 a week' },
  { id: 'activities', name: 'Activities, no watch needed', detail: 'Log a class, yoga or a game: Move points', sets: 'Log it from Goals for Move points' },
  { id: 'strength', name: 'Strength training', detail: 'Routines, a lifting log and your bests', sets: 'Weekly strength goal' },
  { id: 'water', name: 'Water', detail: 'A glass at a time toward a daily goal', sets: 'Water goal' },
  { id: 'friends', name: 'Games with friends', detail: 'Challenges, games, Pack Activities, clubs', sets: 'Challenges to join next' },
];

const ICONS: Record<UseId, React.ComponentType<any>> = {
  steps: FootprintsIcon,
  fasting: ClockCountdownIcon,
  workouts: WatchIcon,
  activities: PersonSimpleTaiChiIcon,
  strength: BarbellIcon,
  water: DropIcon,
  friends: UsersThreeIcon,
};

export function UsesPicker({
  picked,
  onToggle,
  strengthDays,
  onStrengthDays,
}: {
  picked: UseId[];
  onToggle: (id: UseId) => void;
  // Left out (Settings): no days row; the goal's on Move.
  strengthDays?: number;
  onStrengthDays?: (n: number) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={{ gap: 8, alignSelf: 'stretch' }}>
      {USE_CHOICES.map((u) => {
        const on = picked.includes(u.id);
        const Icon = ICONS[u.id];
        return (
          <View key={u.id} style={on ? [styles.row, styles.rowOn] : styles.row}>
            <Pressable
              onPress={() => onToggle(u.id)}
              style={styles.press}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${u.name}. ${u.detail}`}
            >
              <View style={[styles.icon, { backgroundColor: withAlpha(on ? colors.accent : colors.text, on ? 0.14 : 0.06) }]}>
                <Icon size={20} color={on ? colors.accent : withAlpha(colors.text, 0.6)} weight={on ? 'fill' : 'regular'} />
              </View>
              <View style={{ flex: 1, gap: 1 }}>
                <Text style={styles.name}>{u.name}</Text>
                <Text style={styles.detail}>{u.detail}</Text>
                {on && <Text style={styles.sets}>✓ {u.sets}</Text>}
              </View>
              {on ? (
                <CheckSquareIcon size={24} color={colors.accent} weight="fill" />
              ) : (
                <SquareIcon size={24} color={withAlpha(colors.text, 0.3)} />
              )}
            </Pressable>
            {on && u.id === 'strength' && onStrengthDays && (
              <View style={styles.days}>
                <Text style={styles.daysLabel}>Days a week</Text>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Pressable
                    key={n}
                    onPress={() => onStrengthDays(n)}
                    style={n === strengthDays ? [styles.day, styles.dayOn] : styles.day}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: n === strengthDays }}
                    accessibilityLabel={`${n} a week`}
                  >
                    <Text style={n === strengthDays ? [styles.dayText, styles.dayTextOn] : styles.dayText}>{n}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    row: {
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: withAlpha(colors.text, 0.12),
      backgroundColor: colors.surface,
    },
    rowOn: { borderColor: colors.accent, borderWidth: 1.5, backgroundColor: withAlpha(colors.accent, 0.07) },
    press: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, paddingHorizontal: 12 },
    icon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    name: { fontFamily: font.heading, fontSize: 15, color: colors.text },
    detail: { fontSize: 12.5, lineHeight: 17, color: withAlpha(colors.text, 0.6) },
    sets: { fontSize: 12, fontFamily: font.headingSemibold, color: colors.accentActive, marginTop: 2 },
    days: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingBottom: 9, marginTop: -2 },
    daysLabel: { flex: 1, fontSize: 12.5, color: withAlpha(colors.text, 0.65), paddingLeft: 48 },
    day: {
      width: 34,
      height: 30,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: withAlpha(colors.text, 0.15),
      backgroundColor: colors.bg,
    },
    dayOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    dayText: { fontSize: 13.5, fontFamily: font.heading, color: colors.text },
    dayTextOn: { color: '#fff' },
  });
}
