import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { Card } from './Card';
import { ProgressBar } from './ProgressBar';
import { TagRadar, type TagRadarMember } from './TagRadar';
import { useTheme } from '../theme/ThemeContext';
import { font, TINT_N, withAlpha, type Palette } from '../theme/tokens';
import { formatTagTime, type TagMember } from '../challenges/tagApi';
import type { TagRound } from '../challenges/types';

// Game of Tag's live card on the challenge screen: the radar, and what
// to do now. Each round counts from its start (0168): everyone begins
// the round at 0, It may pick anyone (but whoever tagged them last,
// unless it's just the two of them), and tags them by logging more than
// them from the moment of the pick.
export function TagStatusCard({
  round,
  members,
  myUserId,
  gainOf,
  formatMetric,
  minutesLeft,
  roundMinutes,
  actionError,
  selectingTargetId,
  onPick,
}: {
  round: TagRound;
  members: TagMember[];
  myUserId: string | undefined;
  // A player's steps (or miles) in this round.
  gainOf: (userId: string) => number;
  formatMetric: (value: number) => string;
  minutesLeft: number;
  // The round's length: 60, 90 or 120.
  roundMinutes: number;
  actionError: string | null;
  selectingTargetId: string | null;
  onPick: (userId: string) => void;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Under a fifth of the round left reads as urgent, like the radar's ring.
  const clockColor = minutesLeft / roundMinutes > 0.2 ? colors.green : colors.amber;
  const iAmIt = round.itUserId === myUserId;
  const myLastTaggedBy = members.find((m) => m.userId === myUserId)?.lastTaggedBy ?? null;
  // No tag-backs, unless it's just the two of you.
  const targetable = members.filter(
    (m) => m.userId !== myUserId && (m.userId !== myLastTaggedBy || members.length === 2),
  );
  const itMember = members.find((m) => m.userId === round.itUserId);
  const targetMember = round.targetUserId ? members.find((m) => m.userId === round.targetUserId) : undefined;
  const myGain = myUserId ? gainOf(myUserId) : 0;
  const itGain = gainOf(round.itUserId);
  // The chase counts from the pick: each side's steps since then.
  const itChase = Math.max(0, itGain - (round.itSnapshotMetric ?? 0));
  const targetChase = round.targetUserId ? Math.max(0, gainOf(round.targetUserId) - (round.targetSnapshotMetric ?? 0)) : 0;
  // The bar fills as It closes in on the target, and is full once ahead.
  const catchPct = targetChase > 0 ? Math.min(100, (itChase / targetChase) * 100) : itChase > 0 ? 100 : 0;

  // Each member's distance from It on the radar: the gap between their
  // steps in the round, or for the target, since the pick.
  const radarMembers: TagRadarMember[] = members
    .filter((m) => m.userId !== round.itUserId)
    .map((m) => {
      const isTarget = round.targetUserId === m.userId;
      const theirGain = gainOf(m.userId);
      return {
        userId: m.userId,
        initials: m.initials,
        name: m.userId === myUserId ? 'You' : m.name,
        distance: isTarget ? Math.max(0, targetChase - itChase) : Math.abs(theirGain - itGain),
        isTarget,
        isMe: m.userId === myUserId,
        frameId: m.frameId,
        backgroundId: m.backgroundId,
        iconId: m.iconId,
      };
    });

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={text.h4}>Tag status</Text>
        <Text style={[styles.footNote, { color: clockColor, fontFamily: font.heading }]}>
          {minutesLeft > 0 ? `${formatTagTime(minutesLeft)} left` : 'time’s up'}
        </Text>
      </View>
      <TagRadar
        itInitials={itMember?.initials ?? '?'}
        itName={itMember?.name ?? 'Someone'}
        itFrameId={itMember?.frameId}
        itBackgroundId={itMember?.backgroundId}
        itIconId={itMember?.iconId}
        isMeIt={iAmIt}
        members={radarMembers}
        colors={colors}
        formatDistance={formatMetric}
        minutesLeft={minutesLeft}
        timeLimitMinutes={roundMinutes}
      />
      {iAmIt && !round.targetUserId ? (
        <>
          <Text style={styles.footNote}>
            You&rsquo;re It — pick who to tag.{' '}
            {minutesLeft > 0 ? `${formatTagTime(minutesLeft)} left to pick and catch them.` : 'Time’s almost up.'}
          </Text>
          {actionError && <Text style={styles.loadError}>{actionError}</Text>}
          {targetable.length === 0 ? (
            <Text style={styles.footNote}>
              Nobody to tag yet — wait for more people to join.
            </Text>
          ) : (
            <>
              <Text style={styles.footNote}>
                The chase starts when you pick: log more than them from then on to tag them.
              </Text>
              {targetable.map((m) => (
                <View key={m.userId} style={styles.row}>
                  <Avatar
                    initials={m.initials}
                    tint={TINT_N}
                    size={30}
                    fontSize={11}
                    frameId={m.frameId}
                    backgroundId={m.backgroundId}
                    iconId={m.iconId}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{m.name}</Text>
                    <Text style={styles.footNote}>{formatMetric(gainOf(m.userId))} this round</Text>
                  </View>
                  <Button
                    label={selectingTargetId === m.userId ? 'Picking…' : 'Tag'}
                    small
                    disabled={selectingTargetId !== null}
                    onPress={() => onPick(m.userId)}
                  />
                </View>
              ))}
            </>
          )}
        </>
      ) : round.targetUserId ? (
        <>
          <Text style={styles.footNote}>
            {iAmIt
              ? `Chasing ${targetMember?.name ?? 'someone'} — `
              : `${itMember?.name ?? 'Someone'} is It, chasing ${round.targetUserId === myUserId ? 'you' : (targetMember?.name ?? 'someone')} — `}
            {minutesLeft > 0 ? `${formatTagTime(minutesLeft)} left.` : 'time’s almost up.'}
          </Text>
          <ProgressBar pct={catchPct} fillColor={colors.accent} height={6} />
          <Text style={styles.footNote}>
            Since the pick: {iAmIt ? 'you' : (itMember?.name ?? 'It')} {formatMetric(itChase)},{' '}
            {round.targetUserId === myUserId ? 'you' : (targetMember?.name ?? 'them')} {formatMetric(targetChase)}.{' '}
            {iAmIt
              ? itChase > targetChase
                ? 'You’re ahead — tagging them…'
                : `Get past ${formatMetric(targetChase)} to tag them.`
              : round.targetUserId === myUserId
                ? 'Keep moving to stay ahead.'
                : ''}
          </Text>
        </>
      ) : (
        <Text style={styles.footNote}>
          {itMember?.name ?? 'Someone'} is It and hasn’t picked a target yet. You&rsquo;ve logged {formatMetric(myGain)} this round.
        </Text>
      )}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    footNote: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    name: { fontSize: 14, color: colors.text, fontFamily: font.body },
    loadError: { fontSize: 12.5, color: colors.amber, textAlign: 'center' },
  });
}
