import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
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

// "10k", "12.5k": short enough for a one-line result.
function k(steps: number): string {
  return `${Math.round(steps / 100) / 10}k`;
}

// One line on how a settled bounty went.
function result(b: Bounty, currencyName: string): string {
  if (b.mine) {
    return b.status === 'claimed'
      ? `${b.claimerName ?? 'A friend'} won your ${k(b.targetSteps)} bounty`
      : `Nobody won your ${k(b.targetSteps)} bounty · ${b.bones} ${currencyName} back`;
  }
  return b.claimedByMe
    ? `You won ${b.posterName}'s bounty · +${b.bones} ${currencyName}`
    : `${b.claimerName ?? 'Someone'} won ${b.posterName}'s ${k(b.targetSteps)} bounty`;
}

// Today: your bounty and your friends' (0102_bounties.sql). A friend's
// bounty shows how close today's steps are; reaching it claims it
// (useBounties). With nothing open, it's one slim line: the latest
// result (or what bounties are) and Post one. Settled ones under open
// ones are a line each.
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
  const open = bounties.filter((b) => b.status === 'open');
  const settled = bounties.filter((b) => b.status !== 'open');
  const mine = open.filter((b) => b.mine);
  const friends = open.filter((b) => !b.mine);
  const postLink = onPost && (
    <Pressable onPress={onPost} hitSlop={8} accessibilityRole="button">
      <Text style={styles.action}>Post one</Text>
    </Pressable>
  );

  if (open.length === 0) {
    return (
      <Card elevated={false}>
        <View style={styles.slim}>
          <TargetIcon size={16} color={withAlpha(colors.text, 0.6)} weight="bold" />
          <Text style={styles.slimText} numberOfLines={1}>
            {settled.length > 0 ? result(settled[0], currencyName) : `Bounties: put ${currencyName} on a step target`}
          </Text>
          {postLink}
        </View>
      </Card>
    );
  }

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <View style={styles.header}>
        <TargetIcon size={18} color={colors.accentActive} weight="bold" />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.title}>Bounties</Text>
        </View>
        {postLink}
      </View>

      {mine.map((b) => (
        <View key={b.id} style={styles.mine}>
          <Text style={styles.line}>
            <Text style={styles.strong}>Your bounty:</Text> first to {n(b.targetSteps)} steps gets {b.bones}{' '}
            {currencyName}
          </Text>
          <View style={styles.mineFoot}>
            <Text style={styles.detail}>{timeLeft(b.endsAt)}</Text>
            <Pressable onPress={() => onCancel(b)} hitSlop={8} accessibilityRole="button">
              <Text style={styles.cancel}>Take it back</Text>
            </Pressable>
          </View>
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
                <Text style={styles.strong}>{b.posterName}:</Text> first to {n(b.targetSteps)} steps gets {b.bones}{' '}
                {currencyName}
              </Text>
              <ProgressBar pct={Math.min(100, (steps / b.targetSteps) * 100)} height={5} />
              <Text style={styles.detail}>
                {n(Math.min(steps, b.targetSteps))} of {n(b.targetSteps)} · {timeLeft(b.endsAt)}
              </Text>
            </View>
          </View>
        );
      })}

      {settled.map((b) => (
        <Text key={b.id} style={styles.detail} numberOfLines={1}>
          {result(b, currencyName)}
        </Text>
      ))}
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
    slim: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    slimText: { flex: 1, fontFamily: font.heading, fontSize: 13.5, color: withAlpha(colors.text, 0.8) },
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
