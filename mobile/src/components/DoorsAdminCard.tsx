import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from './Text';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getDoorsAdminOverview, type DoorsAdminOverview } from '../challenges/doorsApi';
import type { DoorTaskKind } from '../challenges/doors';

const TASK_NAMES: Record<DoorTaskKind, string> = {
  steps: 'Steps',
  workout: 'Workout',
  water: 'Water',
  goal_day: 'All goals',
  treat: 'Treat',
  walk: 'Walk',
  cheer: 'Cheer',
};

function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '–';
}

// Admin → Daily Doors (0172): who's joined, how many open and do their
// door each day, and which tasks get done.
export function DoorsAdminCard() {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<DoorsAdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      getDoorsAdminOverview()
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e) =>
          setError(
            e instanceof Error && /admin_doors_overview/.test(e.message)
              ? 'Run 0171 and 0172_doors.sql to see these numbers.'
              : e instanceof Error
                ? e.message
                : 'Could not load the Daily Doors numbers.',
          ),
        );
    }, []),
  );

  const rows: [string, string][] = data
    ? [
        ['Challenges', `${data.live} on now · ${data.challenges} in all`],
        ['Joined', `${data.joined} · ${data.everOpened} have opened a door`],
        ['Today', `${data.openedToday} opened · ${data.doneToday} done (${pct(data.doneToday, data.openedToday)})`],
        ['All doors', `${data.opens} opened · ${data.done} done (${pct(data.done, data.opens)}) · ${data.prizes} last-door prizes`],
        ...data.games.map((g): [string, string] => [
          g.name,
          `${g.players} playing · door ${Math.max(0, Math.min(g.door, g.doors))} of ${g.doors} · ${g.openedToday} opened today, ${g.doneToday} done`,
        ]),
        [
          'Tasks done once opened',
          data.tasks.length ? data.tasks.map((t) => `${TASK_NAMES[t.task] ?? t.task} ${pct(t.done, t.opened)}`).join(' · ') : 'No doors opened yet',
        ],
        [
          'Last 14 days (opened / done)',
          data.days.length ? data.days.map((d) => `${d.day.slice(5)}: ${d.opened}/${d.done}`).join(' · ') : 'No doors opened yet',
        ],
      ]
    : [];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Daily Doors</Text>
      <Text style={styles.footNote}>
        A door a day. Opening it is the check-in; the task behind it is checked from Health, water, goals and the Kennel. Opened
        against joined is how many come back each day.
      </Text>
      {error ? (
        <Text style={styles.loadError}>{error}</Text>
      ) : !data ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        rows.map(([label, value]) => (
          <View key={label} style={styles.row}>
            <Text style={styles.label}>{label}</Text>
            <Text style={styles.value}>{value}</Text>
          </View>
        ))
      )}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    footNote: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
    loadError: { fontSize: 12.5, color: colors.amber },
    row: {
      gap: 2,
      paddingTop: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: withAlpha(colors.text, 0.07),
    },
    label: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    value: { fontFamily: font.heading, fontSize: 15, color: colors.text },
  });
}
