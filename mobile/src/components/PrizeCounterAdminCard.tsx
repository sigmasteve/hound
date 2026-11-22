import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from './Text';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getPrizeCounterOverview, type PrizeCounterOverview } from '../kennel/prizeCounterApi';

// Admin → Overview → Hound → Prize Counter (0243): Paw Coins banked from
// finished Paw Slots challenges, what's spent, and which prizes sell.
export function PrizeCounterAdminCard({ onChanged }: { onChanged?: (o: PrizeCounterOverview) => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<PrizeCounterOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      getPrizeCounterOverview()
        .then((d) => {
          setData(d);
          setError(null);
          onChanged?.(d);
        })
        .catch((e) =>
          setError(
            e instanceof Error && /admin_prize_counter_overview/.test(e.message)
              ? 'Run 0243 to see these numbers.'
              : e instanceof Error
                ? e.message
                : 'Could not load the Prize Counter numbers.',
          ),
        );
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const n = (v: number) => v.toLocaleString('en-US');
  const rows: [string, string][] = data
    ? [
        ['Wallets', `${n(data.wallets)} ever filled · ${n(data.withCoins)} with coins now`],
        ['Paw Coins', `${n(data.earned)} banked · ${n(data.spent)} spent · ${n(data.balance)} waiting`],
        ['Prizes bought', `${n(data.bought)} by ${n(data.buyers)} ${data.buyers === 1 ? 'hound' : 'hounds'} · ${n(data.bought7d)} this week`],
        ...data.items.map((i): [string, string] => [i.name, `${n(i.price)} coins · ${n(i.sold)} sold`]),
      ]
    : [];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Prize Counter</Text>
      <Text style={styles.footNote}>
        Paw Coins from finished Paw Slots challenges, spent on prizes only (never Bones). Prices are in prize_counter_items. Lots waiting and little
        bought means the prices are too high.
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
    row: { gap: 2, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(colors.text, 0.07) },
    label: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    value: { fontFamily: font.headingSemibold, fontSize: 15, color: colors.text },
  });
}
