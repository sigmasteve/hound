import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { CoinsIcon, TrophyIcon } from 'phosphor-react-native';
import { Button } from './Button';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { isSupabaseConfigured } from '../lib/supabase';
import { notifyBonesChanged } from '../bones/bonesChanged';
import { getChallengePot, getGlobalPrizes, joinChallengePot, type ChallengePot } from '../challenges/potApi';
import { getChallengeSponsor, type ChallengeSponsor } from '../challenges/globalChallenges';
import { SponsorLine } from './SponsorLine';

// A challenge's Bones pot (0107_challenge_pot.sql): what's in it, who's
// in, a button to join while it's open, and how it ended. For a global
// challenge, the prizes for the top 3 and its sponsor (0111) instead.
// Shows nothing when there's none of those.
export function ChallengePotCard({
  challengeId,
  isGlobal,
  names,
  myUserId,
  currencyName,
}: {
  challengeId: string;
  isGlobal: boolean;
  // userId → display name, for the winners line.
  names: Map<string, string>;
  myUserId: string | null;
  currencyName: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [pot, setPot] = useState<ChallengePot | null>(null);
  const [prizes, setPrizes] = useState<[number, number, number] | null>(null);
  const [sponsor, setSponsor] = useState<ChallengeSponsor | null>(null);
  const [joining, setJoining] = useState(false);

  const load = useCallback(() => {
    if (!isSupabaseConfigured) return;
    if (isGlobal) {
      getGlobalPrizes(challengeId)
        .then(setPrizes)
        .catch(() => {});
      getChallengeSponsor(challengeId)
        .then(setSponsor)
        .catch(() => {});
    } else {
      getChallengePot(challengeId)
        .then(setPot)
        .catch(() => {});
    }
  }, [challengeId, isGlobal]);

  useEffect(load, [load]);

  if (isGlobal) {
    if (!prizes && !sponsor) return null;
    const places = (['1st', '2nd', '3rd'] as const).map((p, i) => [p, prizes?.[i] ?? 0] as const).filter(([, b]) => b > 0);
    return (
      <Card style={styles.card} elevated={false}>
        {places.length > 0 && (
          <>
            <View style={styles.row}>
              <TrophyIcon size={18} color={colors.amber} weight="fill" />
              <Text style={styles.title}>
                Prizes: {places.map(([p, b]) => `${p} ${b}`).join(' · ')} {currencyName}
              </Text>
            </View>
            <Text style={styles.note}>Paid by Hound when it ends. Ties share a place.</Text>
          </>
        )}
        {sponsor && <SponsorLine sponsor={sponsor} />}
      </Card>
    );
  }

  if (!pot || pot.potBones === null) return null;

  const join = () => {
    Alert.alert(
      `Join the pot?`,
      `${pot.potBones} ${currencyName} from your balance. Only ${currencyName} you’ve earned by playing can go in.`,
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: `Put in ${pot.potBones}`,
          onPress: () => {
            setJoining(true);
            joinChallengePot(challengeId)
              .then(() => {
                notifyBonesChanged();
                load();
              })
              .catch((e: Error) => Alert.alert("Couldn't join the pot", e.message))
              .finally(() => setJoining(false));
          },
        },
      ],
    );
  };

  const who = (ids: string[]) => ids.map((id) => (id === myUserId ? 'You' : (names.get(id) ?? 'Someone'))).join(' & ');
  const players = pot.players.length;

  let line: string;
  if (pot.settled) {
    line = pot.refunded
      ? `No winner in the pot, so everyone got their ${currencyName} back.`
      : `${who(pot.winners)} won the pot: ${pot.total} ${currencyName}${pot.winners.length > 1 ? ', split' : ''}.`;
  } else if (players === 0) {
    line = pot.open ? `Nobody’s in yet. ${pot.potBones} ${currencyName} each.` : 'Nobody joined the pot.';
  } else {
    line = `${players} in${pot.iAmIn ? ', you included' : ''} · ${pot.potBones} ${currencyName} each`;
  }

  return (
    <Card style={styles.card} elevated={false}>
      <View style={styles.row}>
        <CoinsIcon size={18} color={colors.amber} weight="fill" />
        <Text style={styles.title}>
          Pot: {pot.total} {currencyName}
        </Text>
        {pot.open && !pot.iAmIn && (
          <Button label={joining ? '…' : `Join · ${pot.potBones}`} variant="primary" small disabled={joining} onPress={join} />
        )}
      </View>
      <Text style={styles.note}>{line}</Text>
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    card: {
      gap: 6,
      borderWidth: 1,
      borderColor: withAlpha(colors.amber, 0.45),
      backgroundColor: withAlpha(colors.amber, 0.07),
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    title: { flex: 1, fontFamily: font.heading, fontSize: 15, color: colors.text },
    note: { fontSize: 13, color: withAlpha(colors.text, 0.7) },
  });
}
