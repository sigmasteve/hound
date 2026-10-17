import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { TargetIcon } from 'phosphor-react-native';
import { Avatar } from './Avatar';
import { Card } from './Card';
import { ProgressBar } from './ProgressBar';
import { useTheme } from '../theme/ThemeContext';
import { font, TINT_N, withAlpha, type Palette } from '../theme/tokens';
import type { Bounty } from '../bounties/bountiesApi';

function n(v: number): string {
  return v.toLocaleString('en-US');
}

function timeLeft(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.round((new Date(iso).getTime() - now) / 60_000));
  if (mins < 60) return `${mins}m left`;
  return `${Math.floor(mins / 60)}h left`;
}

// Today: your bounty and your friends' (0102_bounties.sql). A friend's
// bounty shows how close today's steps are; reaching it claims it
// (useBounties).
export function BountiesCard({
  bounties,
  stepsToday,
  currencyName,
  onPost,
  onCancel,
}: {
  bounties: Bounty[];
  stepsToday: number | null;
  currencyName: string;
  // Null while you already have one out, or it's too late today.
  onPost: (() => void) | null;
  onCancel: (b: Bounty) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const mine = bounties.filter((b) => b.mine);
  const friends = bounties.filter((b) => !b.mine);

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <View style={styles.header}>
        <TargetIcon size={18} color={colors.accentActive} weight="bold" />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.title}>Bounties</Text>
          {bounties.length === 0 && (
            <Text style={styles.subtitle}>
              Put {currencyName} on a step target. The first friend to hit it today gets them.
            </Text>
          )}
        </View>
        {onPost && (
          <Pressable onPress={onPost} hitSlop={8} accessibilityRole="button">
            <Text style={styles.action}>Post one</Text>
          </Pressable>
        )}
      </View>

      {mine.map((b) => (
        <View key={b.id} style={styles.mine}>
          <Text style={styles.line}>
            {b.status === 'open' ? (
              <>
                <Text style={styles.strong}>Your bounty:</Text> first to {n(b.targetSteps)} steps gets {b.bones}{' '}
                {currencyName}
              </>
            ) : b.status === 'claimed' ? (
              <>
                <Text style={styles.strong}>{b.claimerName ?? 'A friend'}</Text> hit {n(b.targetSteps)} steps and got
                your {b.bones} {currencyName}
              </>
            ) : (
              <>
                Nobody hit {n(b.targetSteps)} steps. Your {b.bones} {currencyName} are back.
              </>
            )}
          </Text>
          {b.status === 'open' && (
            <View style={styles.mineFoot}>
              <Text style={styles.detail}>{timeLeft(b.endsAt)}</Text>
              <Pressable onPress={() => onCancel(b)} hitSlop={8} accessibilityRole="button">
                <Text style={styles.cancel}>Take it back</Text>
              </Pressable>
            </View>
          )}
        </View>
      ))}

      {friends.map((b) => {
        const steps = stepsToday ?? 0;
        return (
          <View key={b.id} style={styles.row}>
            <Avatar
              initials={b.posterInitials}
              tint={TINT_N}
              size={32}
              fontSize={11}
              frameId={b.posterFrameId}
              backgroundId={b.posterBackgroundId}
              iconId={b.posterIconId}
            />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.line} numberOfLines={2}>
                {b.status === 'open' ? (
                  <>
                    <Text style={styles.strong}>{b.posterName}:</Text> first to {n(b.targetSteps)} steps gets {b.bones}{' '}
                    {currencyName}
                  </>
                ) : b.claimedByMe ? (
                  <>
                    You got <Text style={styles.strong}>{b.posterName}'s</Text> bounty: +{b.bones} {currencyName}
                  </>
                ) : (
                  <>
                    <Text style={styles.strong}>{b.claimerName ?? 'Someone'}</Text> got {b.posterName}'s{' '}
                    {n(b.targetSteps)}-step bounty
                  </>
                )}
              </Text>
              {b.status === 'open' && (
                <>
                  <ProgressBar pct={Math.min(100, (steps / b.targetSteps) * 100)} height={5} />
                  <Text style={styles.detail}>
                    {n(Math.min(steps, b.targetSteps))} of {n(b.targetSteps)} · {timeLeft(b.endsAt)}
                  </Text>
                </>
              )}
            </View>
          </View>
        );
      })}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    title: {
      fontFamily: font.headingSemibold,
      fontSize: 18,
      color: colors.text,
      marginTop: -2,
    },
    subtitle: { fontSize: 13, color: withAlpha(colors.text, 0.6) },
    action: {
      fontFamily: font.heading,
      fontSize: 14,
      color: colors.accentActive,
    },
    mine: {
      gap: 4,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 10,
      backgroundColor: withAlpha(colors.accent, 0.1),
    },
    mineFoot: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    line: { fontSize: 13.5, color: colors.text },
    strong: { fontFamily: font.heading },
    detail: { fontSize: 12, color: withAlpha(colors.text, 0.6) },
    cancel: {
      fontSize: 12.5,
      fontFamily: font.heading,
      color: withAlpha(colors.text, 0.6),
    },
  });
}
