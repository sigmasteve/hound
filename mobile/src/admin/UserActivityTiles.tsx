import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import type { ActiveFilter, UserActivityCounts } from './adminApi';

// The User directory's quick look (0267, Steve: "Last 24 hours (x), Last 3
// days (y), Last 7 days (z), Over 7 days (v)"): how many people opened the
// app in each window, for the current search. Tap one to filter the list,
// tap it again for everyone. The "last" ones include the shorter ones, so
// Last 7 days and Over 7 days add up to everyone.

const TILES: { key: Exclude<ActiveFilter, 'all'>; label: string; long: string }[] = [
  { key: 'day', label: 'Last 24 h', long: 'people active in the last 24 hours' },
  { key: '3d', label: 'Last 3 days', long: 'people active in the last 3 days' },
  { key: '7d', label: 'Last 7 days', long: 'people active in the last 7 days' },
  { key: 'over7', label: 'Over 7 days', long: 'people not seen in 7 days, or who never opened the app' },
];

function pct(n: number, of: number): string {
  return of ? `${Math.round((n / of) * 100)}%` : '0%';
}

export function UserActivityTiles({
  counts,
  active,
  onPick,
  searching,
}: {
  counts: UserActivityCounts | null;
  active: ActiveFilter;
  onPick: (f: ActiveFilter) => void;
  // A search is typed, so the counts are for it.
  searching: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={{ gap: 8 }}>
      <View style={styles.row}>
        {TILES.map((t) => {
          const on = active === t.key;
          const n = counts?.[t.key];
          return (
            <Pressable
              key={t.key}
              onPress={() => onPick(t.key)}
              style={[styles.tile, on && styles.tileOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${t.label}: ${n ?? 'loading'}`}
            >
              <Text style={[styles.count, on && styles.textOn]}>{n ?? '–'}</Text>
              <Text style={[styles.label, on && styles.textOn]} numberOfLines={2}>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {counts && (
        <Text style={styles.note}>
          {active === 'all'
            ? `${searching ? 'Of these, opened' : 'Opened'} the app: ${pct(counts.day, counts.all)} in the last day, ${pct(counts['7d'], counts.all)} this week.${counts.never ? ` ${counts.never} never opened it.` : ''}`
            : `Showing ${TILES.find((t) => t.key === active)?.long}${searching ? ' matching the search' : ''}. Tap again for everyone.`}
        </Text>
      )}
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    row: { flexDirection: 'row', gap: 8 },
    tile: {
      flex: 1,
      minHeight: 64,
      borderRadius: 12,
      paddingVertical: 8,
      paddingHorizontal: 4,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
      backgroundColor: withAlpha(colors.text, 0.05),
      borderWidth: 1.5,
      borderColor: 'transparent',
    },
    tileOn: { backgroundColor: withAlpha(colors.accent, 0.16), borderColor: colors.accent },
    count: { fontFamily: font.headingSemibold, fontSize: 20, color: colors.text },
    label: { fontSize: 11.5, textAlign: 'center', color: withAlpha(colors.text, 0.6) },
    textOn: { color: colors.accentActive },
    note: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
  });
}
