import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { XIcon } from 'phosphor-react-native';
import { Text } from './Text';
import { SlotsHowItWorks, SlotsMachinePicture } from './SlotsPromo';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getSlots } from '../challenges/slotsApi';

// Before joining a Paw Slots Global (0242): what you're about to do. The
// machine, the game in three steps, the pool and how it's paid, then
// Join or Not now. Joining happens only from here.
export function SlotsJoinSheet({
  challengeId,
  name,
  when,
  joining,
  onJoin,
  onClose,
}: {
  challengeId: string;
  name: string;
  // "Starts Sat", "3 days left"... (globalTimingLine).
  when: string;
  joining: boolean;
  onJoin: () => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { width } = useWindowDimensions();
  const [pool, setPool] = useState<number | null>(null);
  const [teams, setTeams] = useState(0);
  useEffect(() => {
    getSlots(challengeId)
      .then((g) => {
        setPool(g.pool);
        setTeams(g.teams);
      })
      .catch(() => {});
  }, [challengeId]);
  const pct = (n: number) => (pool != null ? Math.floor((pool * n) / 100).toLocaleString('en-US') : `${n}%`);

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.kicker}>PAW SLOTS · {when.toUpperCase()}</Text>
              <Text style={styles.title}>{name}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <XIcon size={18} color={withAlpha(colors.text, 0.5)} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ gap: 14, paddingBottom: 6 }} style={{ flexGrow: 0 }}>
            <View style={{ alignItems: 'center' }}>
              <SlotsMachinePicture width={Math.min(320, width - 64)} />
            </View>
            <Text style={styles.lead}>A slot machine you play with your steps.</Text>
            <SlotsHowItWorks pool={pool} />
            <View style={styles.prize}>
              <Text style={styles.prizeHead}>{pool != null ? `${pool.toLocaleString('en-US')} Bones` : 'The prize pool'}, paid when it ends</Text>
              <Text style={styles.prizeBody}>
                {teams >= 2
                  ? `Played in ${teams} packs (teams), filled evenly as people join. The pack with the most Paw Coins per hound takes ${pct(60)}, then ${pct(26)} and ${pct(14)}, shared by what each hound won.`
                  : `1st ${pct(30)}, 2nd ${pct(18)}, 3rd ${pct(12)}, 4th to 10th ${pct(4)} each, and the rest shared by everyone who plays on 5 days.`}
              </Text>
            </View>
          </ScrollView>
          <Pressable onPress={onJoin} disabled={joining} style={[styles.join, joining && { opacity: 0.6 }]} accessibilityRole="button">
            <Text style={styles.joinText} numberOfLines={1}>
              {joining ? 'Joining…' : `Join ${name}`}
            </Text>
          </Pressable>
          <Pressable onPress={onClose} style={styles.later} accessibilityRole="button">
            <Text style={styles.laterText}>Not now</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
    sheet: { maxHeight: '92%', borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: colors.bg, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 28, gap: 12 },
    header: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    kicker: { fontFamily: font.headingSemibold, fontSize: 11.5, letterSpacing: 0.8, color: withAlpha(colors.text, 0.6) },
    title: { fontFamily: font.headingSemibold, fontSize: 22, color: colors.text },
    lead: { fontFamily: font.headingSemibold, fontSize: 16, color: colors.text },
    prize: { borderRadius: 14, padding: 12, gap: 4, backgroundColor: withAlpha('#f0c24a', 0.12), borderWidth: 1, borderColor: withAlpha('#f0c24a', 0.35) },
    prizeHead: { fontFamily: font.headingSemibold, fontSize: 14.5, color: '#c99a1a' },
    prizeBody: { fontSize: 12.5, lineHeight: 18, color: withAlpha(colors.text, 0.75) },
    join: { minHeight: 52, borderRadius: 14, backgroundColor: '#f08a24', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
    joinText: { fontFamily: font.headingSemibold, fontSize: 16.5, color: '#161826' },
    later: { alignItems: 'center', paddingVertical: 4 },
    laterText: { fontFamily: font.headingSemibold, fontSize: 14, color: withAlpha(colors.text, 0.6) },
  });
}
