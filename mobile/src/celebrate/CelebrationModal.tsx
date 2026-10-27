import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Modal, StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import { PawPrintIcon, ShareNetworkIcon } from 'phosphor-react-native';
import { Button } from '../components/Button';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { HoundArt } from '../kennel/HoundArt';
import { levelProgressForXp } from '../challenges/leveling';
import { rankForLevel } from '../challenges/ranks';
import type { Kennel } from '../kennel/kennelApi';

// Today's two big moments: every goal done (your hound happy, with Share),
// and the morning after a missed day ("Oh snap…", your hound asleep by the
// door). The sound comes from useCelebrations; the confetti is drawn in
// here when there's a card, since a card covers everything behind it.
export function CelebrationModal({
  kind,
  title,
  body,
  kennel,
  onShare,
  onClose,
  confetti,
}: {
  kind: 'allDone' | 'missed';
  title: string;
  body: string;
  kennel: Kennel | null;
  onShare?: () => void;
  onClose: () => void;
  confetti?: React.ReactNode;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const pop = useRef(new Animated.Value(0)).current;
  const missed = kind === 'missed';

  useEffect(() => {
    Animated.spring(pop, { toValue: 1, friction: missed ? 7 : 4, tension: 70, useNativeDriver: true }).start();
  }, [pop, missed]);

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.card, missed ? styles.missedCard : styles.doneCard]}>
          <Animated.View
            style={{
              opacity: pop.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] }),
              transform: [
                { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) },
                // A happy hop; a missed day just droops in.
                { translateY: pop.interpolate({ inputRange: [0, 1], outputRange: [missed ? -10 : 30, 0] }) },
              ],
            }}
          >
            {kennel ? (
              <HoundArt
                rank={rankForLevel(levelProgressForXp(kennel.xpTotal).level).id}
                mood={missed ? 'sleepy' : 'happy'}
                neckId={kennel.neckId}
                headId={kennel.headId}
                faceId={kennel.faceId}
                coatId={kennel.coatId}
                ears={kennel.ears}
                tail={kennel.tail}
                markings={kennel.markings}
                size={130}
              />
            ) : (
              <PawPrintIcon size={72} color={colors.accent} weight="fill" />
            )}
          </Animated.View>

          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>{body}</Text>

          <View style={styles.buttons}>
            {onShare && (
              <Button label="Share" icon={<ShareNetworkIcon size={16} color={colors.text} />} onPress={onShare} />
            )}
            <Button label={missed ? "Let's go" : 'Nice!'} variant="primary" onPress={onClose} />
          </View>
        </View>
        {confetti}
      </View>
    </Modal>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    card: {
      width: '100%',
      maxWidth: 360,
      alignItems: 'center',
      gap: 10,
      padding: 24,
      borderRadius: 16,
      borderWidth: 1.5,
      backgroundColor: colors.surface,
    },
    doneCard: { borderColor: withAlpha(colors.green, 0.6) },
    missedCard: { borderColor: withAlpha(colors.amber, 0.6) },
    title: { fontFamily: font.headingSemibold, fontSize: 26, color: colors.text, textAlign: 'center' },
    body: { fontSize: 15, lineHeight: 21, color: withAlpha(colors.text, 0.75), textAlign: 'center' },
    buttons: { flexDirection: 'row', gap: 8, marginTop: 8 },
  });
}
