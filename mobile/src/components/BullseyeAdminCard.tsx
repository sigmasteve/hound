import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from './Text';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getBullseyeOverview, getBullseyeVolleyOverview, type BullseyeOverview, type BullseyeVolleyOverview } from '../challenges/bullseyeApi';

// Admin → Bullseye (0249): who's tried it and who shoots now, arrows and
// golds by target, bows, Robin Hoods, balloons and the gold balloon.
export function BullseyeAdminCard({ onChanged }: { onChanged?: (o: BullseyeOverview) => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<BullseyeOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [volleys, setVolleys] = useState<BullseyeVolleyOverview | null>(null);

  useFocusEffect(
    useCallback(() => {
      getBullseyeVolleyOverview().then(setVolleys);
      getBullseyeOverview()
        .then((d) => {
          setData(d);
          setError(null);
          onChanged?.(d);
        })
        .catch((e) =>
          setError(
            e instanceof Error && /admin_bullseye_overview/.test(e.message)
              ? 'Run 0248 and 0249 to see these numbers.'
              : e instanceof Error
                ? e.message
                : 'Could not load the Bullseye numbers.',
          ),
        );
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const n = (v: number) => v.toLocaleString('en-US');
  const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '–');
  const rows: [string, string][] = data
    ? [
        ['Games', `${data.live} live · ${data.games} ever · ${data.helperGames} with the aim helper`],
        ['Archers', `${n(data.active7d)} this week · ${n(data.tried)} ever shot`],
        ['Arrows this week', `${n(data.arrows7d)} · ${pct(data.golds7d, data.arrows7d)} in the gold · ${n(data.moon7d)} on the Moon`],
        ['Gold rate by target', data.targets.length ? data.targets.map((x) => `${x.target === 'clout' ? 'clout' : x.target.startsWith('b') || x.target === 'gold' ? x.target : `${x.dist} m`}: ${pct(x.golds, x.arrows)}`).join(' · ') : '–'],
        ['Bows this week', data.bows.length ? data.bows.map((b) => `${b.name} ${pct(b.arrows, data.arrows7d)}`).join(' · ') : '–'],
        ['Robin Hoods · balloons popped', `${data.robins7d} · ${data.pops7d} this week`],
        ['Gold balloons', `${data.gold7d} popped this week · ${n(data.goldBones)} Bones paid ever`],
        ...(volleys
          ? ([['Volleys this week', `${n(volleys.volleys7d)} by ${n(volleys.people7d)} archers · ${pct(volleys.volleyArrows7d, volleys.arrows7d)} of arrows`]] as [string, string][])
          : []),
      ]
    : [];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Bullseye</Text>
      <Text style={styles.footNote}>
        Archery on steps, for everyone. If the 70 and 90 m golds almost never come, the sway or the breeze may be too much for families; if the
        18 m gold is nearly every arrow, it may be too easy.
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
