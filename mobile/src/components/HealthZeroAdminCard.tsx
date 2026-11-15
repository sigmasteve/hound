import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from './Text';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getHealthZeroOverview, type HealthZeroOverview } from '../admin/adminApi';

function ago(iso: string | null): string {
  if (!iso) return 'not opened lately';
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000);
  return h < 1 ? 'opened just now' : h < 24 ? `opened ${h}h ago` : `opened ${Math.round(h / 24)}d ago`;
}

function shortDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Admin → Status → Not seeing steps (0205): people who keep opening Hound
// but whose phone has sent 0 steps for days. Almost always Steps turned
// off for Hound in Health; Today shows them "Hound can't see your steps"
// with how to fix it. Find them under People to look closer.
export function HealthZeroAdminCard({ onChanged }: { onChanged?: (o: HealthZeroOverview) => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<HealthZeroOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      getHealthZeroOverview()
        .then((d) => {
          setData(d);
          setError(null);
          onChanged?.(d);
        })
        .catch((e) =>
          setError(
            e instanceof Error && /admin_health_zero_overview/.test(e.message)
              ? 'Run 0205_health_zero.sql to see this.'
              : e instanceof Error
                ? e.message
                : 'Could not load.',
          ),
        );
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  return (
    <Card style={{ gap: 10 }} elevated={false}>
      <Text style={styles.note}>
        People who opened Hound in the last 3 days but whose phone has sent 0 steps for 3 days or more. Usually Steps is
        turned off for Hound in Health. Today tells them how to fix it.
      </Text>
      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : !data ? (
        <ActivityIndicator color={colors.accent} />
      ) : data.people.length === 0 ? (
        <Text style={styles.note}>Nobody right now.</Text>
      ) : (
        data.people.map((p, i) => (
          <View key={p.userId} style={[styles.row, i > 0 && styles.divider]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{p.name}</Text>
              <Text style={styles.sub}>
                {ago(p.lastActiveAt)} · {p.lastNonzeroDay ? `steps last on ${shortDay(p.lastNonzeroDay)}` : 'no steps ever'}
              </Text>
            </View>
            <Text style={styles.days}>{p.zeroDays} days at 0</Text>
          </View>
        ))
      )}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    note: { fontSize: 12.5, lineHeight: 18, color: withAlpha(colors.text, 0.65) },
    error: { fontSize: 12.5, color: colors.amber },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(colors.text, 0.12) },
    name: { fontFamily: font.headingSemibold, fontSize: 14, color: colors.text },
    sub: { fontSize: 12, color: withAlpha(colors.text, 0.6) },
    days: { fontFamily: font.headingSemibold, fontSize: 13, color: colors.amber },
  });
}
