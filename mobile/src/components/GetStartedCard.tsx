import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { BoneIcon, RocketLaunchIcon, XIcon } from 'phosphor-react-native';
import { Button } from './Button';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { onboardingDoneCount, type OnboardingStatus } from '../onboarding/onboardingApi';

// Today, for anyone who hasn't finished getting started
// (0074_onboarding_checklist.sql): one line with how far they are.
// "Continue" reopens the setup wizard on the steps still left; once all
// three are done it turns into a one-tap reward claim.
export function GetStartedCard({
  status,
  currencyName,
  claiming,
  onContinue,
  onClaim,
  onDismiss,
}: {
  status: OnboardingStatus;
  currencyName: string;
  claiming: boolean;
  onContinue: () => void;
  onClaim: () => void;
  onDismiss: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const done = onboardingDoneCount(status);
  const allDone = done === 3;

  return (
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
        <Button label="Continue" variant="primary" small onPress={onContinue} />
      )}
      {!allDone && (
        <Pressable onPress={onDismiss} hitSlop={10} accessibilityRole="button" accessibilityLabel="Hide finish setting up">
          <XIcon size={14} color={withAlpha(colors.text, 0.5)} />
        </Pressable>
      )}
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
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
