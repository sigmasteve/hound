import React, { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { BoneIcon, XIcon } from 'phosphor-react-native';
import { Button } from './Button';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';

// Tapping Bones on the You tab: your balance, how you earn more and
// where they go, with a way into the two places that spend them.
export function BonesSheet({
  balance,
  currencyName,
  onClose,
  onOpenKennel,
  onOpenLook,
}: {
  balance: number;
  currencyName: string;
  onClose: () => void;
  onOpenKennel: () => void;
  onOpenLook: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const earn = [
    'Hit your daily goals. Streaks pay more.',
    'Finish challenges. Top places pay more.',
    'Dig for bones on Today.',
    'Win a challenge pot or a bounty.',
    'Watch a short ad, or add a pack, in Your look or the Kennel.',
  ];
  const spend = [
    'Kennel: outfits and treats for your hound.',
    'Your look: avatar frames, backgrounds and icons.',
    'Streak Shields on Today, to cover a missed goal day.',
    'Challenge pots and bounties.',
  ];

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close">
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.header}>
            <BoneIcon size={22} color={colors.accent} weight="fill" />
            <Text style={styles.title}>
              {balance.toLocaleString()} {currencyName}
            </Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <XIcon size={18} color={withAlpha(colors.text, 0.5)} />
            </Pressable>
          </View>

          <Text style={styles.heading}>HOW YOU EARN THEM</Text>
          {earn.map((line) => (
            <Text key={line} style={styles.line}>
              • {line}
            </Text>
          ))}

          <Text style={styles.heading}>WHERE THEY GO</Text>
          {spend.map((line) => (
            <Text key={line} style={styles.line}>
              • {line}
            </Text>
          ))}

          <View style={styles.buttons}>
            <View style={{ flex: 1 }}>
              <Button label="Kennel" variant="secondary" block onPress={onOpenKennel} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Your look" variant="primary" block onPress={onOpenLook} />
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      padding: 20,
      paddingBottom: 36,
      gap: 8,
    },
    header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
    title: { flex: 1, fontFamily: font.headingSemibold, fontSize: 20, color: colors.text },
    heading: {
      marginTop: 10,
      fontSize: 12,
      letterSpacing: 1,
      fontFamily: font.headingSemibold,
      color: withAlpha(colors.text, 0.55),
    },
    line: { fontSize: 14.5, lineHeight: 21, color: withAlpha(colors.text, 0.85) },
    buttons: { flexDirection: 'row', gap: 10, marginTop: 16 },
  });
}
