import React, { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { BoneIcon, CheckCircleIcon, CircleIcon, FlagCheckeredIcon, PlugsIcon, UserPlusIcon, XIcon } from 'phosphor-react-native';
import { Button } from './Button';
import { ProgressBar } from './ProgressBar';
import { useTheme } from '../theme/ThemeContext';
import { color, font, withAlpha, type Palette } from '../theme/tokens';
import { onboardingDoneCount, type OnboardingStatus } from '../onboarding/onboardingApi';

// Today's new-user checklist (0074_onboarding_checklist.sql). Each open
// step has a "Go" that jumps to the tab where it happens; once all three
// are done, the card turns into a one-tap reward claim.
export function GetStartedCard({
  status,
  currencyName,
  claiming,
  onConnect,
  onAddFriend,
  onJoinChallenge,
  onClaim,
  onDismiss,
}: {
  status: OnboardingStatus;
  currencyName: string;
  claiming: boolean;
  onConnect: () => void;
  onAddFriend: () => void;
  onJoinChallenge: () => void;
  onClaim: () => void;
  onDismiss: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const done = onboardingDoneCount(status);
  const allDone = done === 3;

  const steps = [
    {
      key: 'health',
      Icon: PlugsIcon,
      title: 'Connect your health app',
      note: 'Done once your first steps sync.',
      done: status.healthConnected,
      onGo: onConnect,
    },
    {
      key: 'friend',
      Icon: UserPlusIcon,
      title: 'Add a friend',
      note: 'Search for them, share your code, or enter theirs.',
      done: status.hasFriend,
      onGo: onAddFriend,
    },
    {
      key: 'challenge',
      Icon: FlagCheckeredIcon,
      title: 'Join or start a challenge',
      note: 'Accept an invite or create your own.',
      done: status.joinedChallenge,
      onGo: onJoinChallenge,
    },
  ];

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.title}>Get started</Text>
          <Text style={styles.subtitle}>
            {allDone
              ? 'All done — your reward is ready.'
              : `${done} of 3 done · finish all three for ${status.rewardBones} ${currencyName}`}
          </Text>
        </View>
        {!allDone && (
          <Pressable onPress={onDismiss} hitSlop={10} accessibilityRole="button" accessibilityLabel="Hide the Get started checklist">
            <XIcon size={14} color={withAlpha(colors.text, 0.5)} />
          </Pressable>
        )}
      </View>
      <ProgressBar pct={(done / 3) * 100} fillColor={color.accent} height={5} />

      {steps.map(({ key, Icon, title, note, done: stepDone, onGo }) => (
        <View key={key} style={styles.row}>
          {stepDone ? (
            <CheckCircleIcon size={20} color={colors.green} weight="fill" />
          ) : (
            <CircleIcon size={20} color={withAlpha(colors.text, 0.35)} />
          )}
          <View style={{ flex: 1, gap: 1 }}>
            <Text style={[styles.stepTitle, stepDone && styles.stepTitleDone]}>{title}</Text>
            {!stepDone && <Text style={styles.stepNote}>{note}</Text>}
          </View>
          {!stepDone && (
            <Button label="Go" small icon={<Icon size={13} color={colors.text} />} onPress={onGo} />
          )}
        </View>
      ))}

      {allDone && (
        <Pressable
          style={({ pressed }) => [styles.claim, pressed && { opacity: 0.8 }]}
          onPress={onClaim}
          disabled={claiming}
          accessibilityRole="button"
        >
          {claiming ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <BoneIcon size={16} color="#fff" weight="fill" />
              <Text style={styles.claimText}>
                Claim {status.rewardBones} {currencyName}
              </Text>
            </>
          )}
        </Pressable>
      )}
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    card: {
      gap: 10,
      padding: 14,
      borderRadius: 16,
      backgroundColor: withAlpha(colors.accent, 0.12),
      borderWidth: 1,
      borderColor: withAlpha(colors.accent, 0.4),
    },
    header: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    title: { fontSize: 16, fontFamily: font.heading, color: colors.text },
    subtitle: { fontSize: 12.5, color: withAlpha(colors.text, 0.65) },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 2 },
    stepTitle: { fontSize: 14, color: colors.text, fontFamily: font.heading },
    stepTitleDone: { color: withAlpha(colors.text, 0.55), textDecorationLine: 'line-through' },
    stepNote: { fontSize: 12, color: withAlpha(colors.text, 0.55) },
    claim: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      height: 44,
      borderRadius: 12,
      backgroundColor: color.accent,
      marginTop: 2,
    },
    claimText: { fontSize: 15, color: '#fff', fontFamily: font.heading },
  });
}
