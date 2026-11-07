import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { BoneIcon, CheckCircleIcon, CircleIcon, RocketLaunchIcon, XIcon } from 'phosphor-react-native';
import { Button } from './Button';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { onboardingDoneCount, type OnboardingStatus } from '../onboarding/onboardingApi';

// Today, for anyone who hasn't finished getting started
// (0074_onboarding_checklist.sql): one line with how far they are.
// "Continue" opens the three things right here, each ticked or with a
// button that goes to it. (It used to reopen the welcome wizard, which no
// longer has a friend or challenge page, so it closed straight away.)
// Once all three are done it turns into a one-tap reward claim.
export function GetStartedCard({
  status,
  currencyName,
  claiming,
  onConnectHealth,
  onAddFriend,
  onFindChallenge,
  onClaim,
  onDismiss,
}: {
  status: OnboardingStatus;
  currencyName: string;
  claiming: boolean;
  onConnectHealth: () => void;
  onAddFriend: () => void;
  onFindChallenge: () => void;
  onClaim: () => void;
  onDismiss: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  const done = onboardingDoneCount(status);
  const allDone = done === 3;
  const items: { label: string; done: boolean; action: string; onPress: () => void }[] = [
    { label: 'Connect your health data', done: status.healthConnected, action: 'Connect', onPress: onConnectHealth },
    { label: 'Add a friend', done: status.hasFriend, action: 'Add', onPress: onAddFriend },
    { label: 'Join a challenge', done: status.joinedChallenge, action: 'Find one', onPress: onFindChallenge },
  ];

  return (
    <View style={styles.wrap}>
    <View style={styles.card}>
      {allDone ? (
        <BoneIcon size={18} color={colors.accentActive} weight="fill" />
      ) : (
        <RocketLaunchIcon size={18} color={colors.accentActive} />
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={1}>
          {allDone ? 'All set up!' : 'Finish setting up'}
        </Text>
        <Text style={styles.note} numberOfLines={1}>
          {allDone ? `Claim your ${status.rewardBones} ${currencyName}` : `${done} of 3 done · earn ${status.rewardBones} ${currencyName}`}
        </Text>
      </View>
      {allDone ? (
        <Button label={claiming ? 'Claiming…' : 'Claim'} variant="primary" small disabled={claiming} onPress={onClaim} />
      ) : (
        <Button label={open ? 'Hide' : 'Continue'} variant={open ? 'secondary' : 'primary'} small onPress={() => setOpen((o) => !o)} />
      )}
      {!allDone && (
        <Pressable onPress={onDismiss} hitSlop={10} accessibilityRole="button" accessibilityLabel="Hide finish setting up">
          <XIcon size={14} color={withAlpha(colors.text, 0.5)} />
        </Pressable>
      )}
    </View>
    {open && !allDone && (
      <View style={styles.list}>
        {items.map((it) => (
          <View key={it.label} style={styles.row}>
            {it.done ? (
              <CheckCircleIcon size={20} color={colors.accent} weight="fill" />
            ) : (
              <CircleIcon size={20} color={withAlpha(colors.text, 0.35)} />
            )}
            <Text style={it.done ? styles.rowDone : styles.rowText}>{it.label}</Text>
            {!it.done && <Button label={it.action} variant="secondary" small onPress={it.onPress} />}
          </View>
        ))}
      </View>
    )}
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    wrap: { gap: 6 },
    list: {
      gap: 10,
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: 16,
      backgroundColor: withAlpha(colors.accent, 0.06),
      borderWidth: 1,
      borderColor: withAlpha(colors.accent, 0.2),
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 36 },
    rowText: { flex: 1, fontSize: 14, fontFamily: font.heading, color: colors.text },
    rowDone: { flex: 1, fontSize: 14, color: withAlpha(colors.text, 0.55), textDecorationLine: 'line-through' },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: 16,
      backgroundColor: withAlpha(colors.accent, 0.12),
      borderWidth: 1,
      borderColor: withAlpha(colors.accent, 0.4),
    },
    title: { fontSize: 15, fontFamily: font.heading, color: colors.text },
    note: { fontSize: 12.5, color: withAlpha(colors.text, 0.65) },
  });
}
