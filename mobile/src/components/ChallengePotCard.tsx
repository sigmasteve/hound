import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { CoinsIcon, TrophyIcon, XIcon } from 'phosphor-react-native';
import { Button } from './Button';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { isSupabaseConfigured } from '../lib/supabase';
import { notifyBonesChanged } from '../bones/bonesChanged';
import { getChallengePot, getGlobalPrizes, joinChallengePot, type ChallengePot } from '../challenges/potApi';

// A challenge's Bones pot (0107_challenge_pot.sql): what's in it, who's
// in, a button to join while it's open, and how it ended. For a global
// challenge, the prizes for the top 3 instead. Shows nothing when there's
// neither.
export function ChallengePotCard({
  challengeId,
  isGlobal,
  names,
  myUserId,
  currencyName,
  allPrizes,
  allPrizesNote,
}: {
  challengeId: string;
  isGlobal: boolean;
  // userId → display name, for the winners line.
  names: Map<string, string>;
  myUserId: string | null;
  currencyName: string;
  // Every prize, for a global game that has more than the top 3 (the Home
  // Run Derby): adds "All prizes ›" to the banner, which opens them in a
  // sheet.
  allPrizes?: { label: string; value: string }[] | null;
  allPrizesNote?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [pot, setPot] = useState<ChallengePot | null>(null);
  const [prizes, setPrizes] = useState<[number, number, number] | null>(null);
  const [joining, setJoining] = useState(false);
  const [sheet, setSheet] = useState(false);

  const load = useCallback(() => {
    if (!isSupabaseConfigured) return;
    if (isGlobal) {
      getGlobalPrizes(challengeId)
        .then(setPrizes)
        .catch(() => {});
    } else {
      getChallengePot(challengeId)
        .then(setPot)
        .catch(() => {});
    }
  }, [challengeId, isGlobal]);

  useEffect(load, [load]);

  if (isGlobal) {
    if (!prizes) return null;
    const places = (['1st', '2nd', '3rd'] as const).map((p, i) => [p, prizes[i]] as const).filter(([, b]) => b > 0);
    return (
      <Card style={styles.card} elevated={false}>
        <View style={styles.row}>
          <TrophyIcon size={18} color={colors.amber} weight="fill" />
          <Text style={styles.title}>
            Prizes: {places.map(([p, b]) => `${p} ${b}`).join(' · ')} {currencyName}
          </Text>
          {!!allPrizes?.length && (
            <Pressable onPress={() => setSheet(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel="All prizes">
              <Text style={styles.all}>All prizes ›</Text>
            </Pressable>
          )}
        </View>
        <Text style={styles.note}>Paid by Hound when it ends. Ties share a place.</Text>
        {sheet && !!allPrizes?.length && (
          <Modal transparent animationType="slide" visible onRequestClose={() => setSheet(false)}>
            <View style={styles.backdrop}>
              <Pressable style={StyleSheet.absoluteFill} onPress={() => setSheet(false)} accessibilityLabel="Close" />
              <View style={styles.sheet}>
                <View style={styles.sheetHead}>
                  <TrophyIcon size={20} color={colors.amber} weight="fill" />
                  <Text style={styles.sheetTitle}>All prizes</Text>
                  <Pressable onPress={() => setSheet(false)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
                    <XIcon size={18} color={withAlpha(colors.text, 0.5)} />
                  </Pressable>
                </View>
                {allPrizes.map((r, i) => (
                  <View key={r.label} style={[styles.prizeRow, i < allPrizes.length - 1 && styles.prizeRule]}>
                    <Text style={styles.prizeLabel}>{r.label}</Text>
                    <Text style={styles.prizeValue}>{r.value}</Text>
                  </View>
                ))}
                <Text style={styles.note}>{allPrizesNote ?? 'Ties share the places they cover. Paid by Hound when it ends.'}</Text>
              </View>
            </View>
          </Modal>
        )}
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
    all: { fontFamily: font.headingSemibold, fontSize: 13, color: colors.amber },
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 36, gap: 4 },
    sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
    sheetTitle: { flex: 1, fontFamily: font.headingSemibold, fontSize: 20, color: colors.text },
    prizeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
    prizeRule: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: withAlpha(colors.text, 0.15) },
    prizeLabel: { flex: 1, fontSize: 15, color: colors.text },
    prizeValue: { fontFamily: font.headingSemibold, fontSize: 15, color: colors.text },
  });
}
