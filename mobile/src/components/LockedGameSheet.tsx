import React, { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { ArrowUpIcon, FlagIcon, LockSimpleIcon, ShovelIcon, TargetIcon, XIcon } from 'phosphor-react-native';
import { Button } from './Button';
import { useTheme } from '../theme/ThemeContext';
import { color, font, withAlpha, type Palette } from '../theme/tokens';
import { earnedGreen, unlockShare } from '../challenges/unlockProgress';

// Tapping a locked game in "Pick the game": how close you are, the ways
// to earn, and that a friend who has it open can invite you.
export function LockedGameSheet({
  name,
  tagline,
  bones,
  earned,
  currencyName,
  onClose,
}: {
  name: string;
  tagline: string;
  bones: number;
  earned: number;
  currencyName: string;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const share = unlockShare(earned, bones);
  const ways: { icon: React.ReactNode; text: string }[] = [
    { icon: <TargetIcon size={20} color={earnedGreen(colors)} />, text: 'Finish your daily goals' },
    { icon: <FlagIcon size={20} color={earnedGreen(colors)} />, text: 'Play and finish challenges' },
    { icon: <ArrowUpIcon size={20} color={earnedGreen(colors)} />, text: 'Level up' },
    { icon: <ShovelIcon size={20} color={earnedGreen(colors)} />, text: 'Dig on Bone Dig' },
  ];

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.lock}>
              <LockSimpleIcon size={22} color={colors.accentActive} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.title}>{name}</Text>
              <Text style={styles.sub}>{tagline}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <XIcon size={18} color={withAlpha(colors.text, 0.5)} />
            </Pressable>
          </View>

          <View style={styles.progress}>
            <View style={styles.progressTop}>
              <Text style={styles.progressText}>
                Opens at <Text style={styles.bold}>{bones.toLocaleString()}</Text> {currencyName} earned
              </Text>
              <Text style={styles.toGo}>{Math.max(0, bones - earned).toLocaleString()} to go</Text>
            </View>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.round(share * 100)}%` }]} />
            </View>
            <Text style={styles.progressNote}>
              You&rsquo;ve earned {earned.toLocaleString()} by playing. Bought {currencyName} don&rsquo;t count.
            </Text>
          </View>

          <Text style={styles.heading}>Ways to earn</Text>
          {ways.map((w, i) => (
            <View key={w.text} style={[styles.way, i > 0 && styles.wayLine]}>
              {w.icon}
              <Text style={styles.wayText}>{w.text}</Text>
            </View>
          ))}

          <Text style={styles.note}>Want to play now? A friend who has {name} open can invite you.</Text>
          <Button label="Got it" variant="primary" block onPress={onClose} />
        </View>
      </View>
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
      gap: 12,
    },
    header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    lock: {
      width: 46,
      height: 46,
      borderRadius: 14,
      backgroundColor: withAlpha(colors.text, 0.07),
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: { fontFamily: font.headingSemibold, fontSize: 20, color: colors.text },
    sub: { fontSize: 13, color: withAlpha(colors.text, 0.6) },
    progress: {
      gap: 8,
      padding: 14,
      borderRadius: 14,
      backgroundColor: withAlpha(color.green, 0.1),
      borderWidth: 1,
      borderColor: withAlpha(color.green, 0.3),
    },
    progressTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
    progressText: { flex: 1, fontSize: 14, color: colors.text },
    bold: { fontFamily: font.headingSemibold },
    toGo: { fontFamily: font.headingSemibold, fontSize: 13.5, color: earnedGreen(colors) },
    track: { height: 8, borderRadius: 4, backgroundColor: withAlpha(colors.text, 0.1), overflow: 'hidden' },
    fill: { height: 8, borderRadius: 4, backgroundColor: color.green },
    progressNote: { fontSize: 12.5, color: withAlpha(colors.text, 0.65) },
    heading: { fontFamily: font.headingSemibold, fontSize: 15, color: colors.text, marginTop: 2 },
    way: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9 },
    wayLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(colors.text, 0.1) },
    wayText: { fontSize: 14.5, color: colors.text },
    note: { fontSize: 13, color: withAlpha(colors.text, 0.6) },
  });
}
