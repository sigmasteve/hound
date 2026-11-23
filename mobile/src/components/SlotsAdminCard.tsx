import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from './Text';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getSlotsOverview, type SlotsOverview } from '../challenges/slotsApi';
import { autoShare, getAutoPlayOverview, type AutoPlayOverview } from '../challenges/autoPlayApi';

// Admin → Paw Slots (0242): who plays, how (lines and bets), how often it
// pays, spins bought with Paw Coins, and the Bones paid at the end.
export function SlotsAdminCard({ onChanged }: { onChanged?: (o: SlotsOverview) => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<SlotsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Auto (0256): spins on Auto.
  const [auto, setAuto] = useState<AutoPlayOverview | null>(null);

  useFocusEffect(
    useCallback(() => {
      getAutoPlayOverview()
        .then(setAuto)
        .catch(() => setAuto(null));
      getSlotsOverview()
        .then((d) => {
          setData(d);
          setError(null);
          onChanged?.(d);
        })
        .catch((e) =>
          setError(
            e instanceof Error && /admin_slots_overview/.test(e.message)
              ? 'Run 0241 and 0242 to see these numbers.'
              : e instanceof Error
                ? e.message
                : 'Could not load the Paw Slots numbers.',
          ),
        );
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const n = (v: number) => v.toLocaleString('en-US');
  const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '–');
  const s = data?.settings ?? {};
  const rows: [string, string][] = data
    ? [
        ['Games', `${data.live} live (${data.liveGlobal} Global) · ${data.all} ever · ${data.teamGames} in packs`],
        ['Players', `${n(data.players7d)} this week · ${n(data.playedEver)} ever played · ${n(data.joined)} ever joined`],
        ['Presses this week', `${n(data.presses7d)} (${n(data.spinsUsed7d)} spins) · ${pct(data.hits7d, data.presses7d)} won something`],
        ...(auto
          ? ([
              [
                'On Auto',
                `${n(auto.slotsAuto7d)} spins this week (${autoShare(auto.slotsAuto7d, auto.slotsAll7d)}) by ${n(auto.slotsAutoPeople7d)} · ${n(auto.slotsAutoPeopleEver)} have used it`,
              ],
            ] as [string, string][])
          : []),
        ['Lines', `1: ${n(data.byLines7d.l1)} · 3: ${n(data.byLines7d.l3)} · 5: ${n(data.byLines7d.l5)}`],
        ['Bets', `×1: ${n(data.byBet7d.b1)} · ×2: ${n(data.byBet7d.b2)} · ×3: ${n(data.byBet7d.b3)} · ×5: ${n(data.byBet7d.b5)}`],
        ['Wins this week', `${n(data.coinsWon7d)} Paw Coins · ${data.bigWins7d} big (50+) · ${data.jackpots7d} ${data.jackpots7d === 1 ? 'jackpot' : 'jackpots'}`],
        ['Bought with Paw Coins', `${data.buyers7d} ${data.buyers7d === 1 ? 'hound' : 'hounds'} · ${n(data.bought7d)} spins for ${n(data.coinsSpent7d)} coins`],
        ['Carried over', `${n(data.carried7d)} spins this week`],
        ['Bones paid at the end', n(data.bonesPaid)],
        [
          'Most presses this week',
          data.topPlayers7d.length ? data.topPlayers7d.map((p) => `${p.name} ${p.presses} (${n(p.coins)})`).join(' · ') : '–',
        ],
        [
          'Settings',
          `${s.steps_per_spin ?? 500} steps a spin, up to ${s.max_step_spins ?? 20} · ${s.buy_price ?? 3} coins a bought spin, up to ${s.buy_cap ?? 10} · pool ${n(
            s.big_pool ?? 2500,
          )} at ${s.big_pool_players ?? 11}+, else ${s.per_player_bones ?? 200} a hound`,
        ],
      ]
    : [];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Paw Slots</Text>
      <Text style={styles.footNote}>
        Spins from steps (and Paw Coins), a pool paid by place. If most presses are on 5 lines at ×5, people are chasing the jackpot; if few buy spins,
        the price may be too high.
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
