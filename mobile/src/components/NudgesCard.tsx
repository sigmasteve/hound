import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CaretRightIcon, HandWavingIcon, XIcon } from 'phosphor-react-native';
import { Avatar } from './Avatar';
import { useTheme } from '../theme/ThemeContext';
import { font, TINT_N, withAlpha, type Palette } from '../theme/tokens';
import type { ReceivedNudge } from '../social/social';

function ago(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

// Today: who nudged you in the last day (0082_nudges_reactions.sql) — so
// a nudge still lands for anyone who can't get pushes. A nudge from a
// challenge opens it.
export function NudgesCard({
  nudges,
  onOpenChallenge,
  onDismiss,
}: {
  nudges: ReceivedNudge[];
  onOpenChallenge: (challengeId: string) => void;
  onDismiss: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <HandWavingIcon size={17} color={colors.accentActive} />
        <Text style={styles.title}>{nudges.length === 1 ? 'You got a nudge' : `You got ${nudges.length} nudges`}</Text>
        <Pressable onPress={onDismiss} hitSlop={10} accessibilityRole="button" accessibilityLabel="Hide nudges">
          <XIcon size={14} color={withAlpha(colors.text, 0.5)} />
        </Pressable>
      </View>
      {nudges.map((n) => {
        const content = (
          <>
            <Avatar
              initials={n.initials}
              tint={TINT_N}
              size={30}
              fontSize={11}
              frameId={n.frameId}
              backgroundId={n.backgroundId}
              iconId={n.iconId}
            />
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={styles.line} numberOfLines={2}>
                <Text style={styles.name}>{n.name}</Text>
                {n.challengeName ? ` nudged you in ${n.challengeName}` : ' nudged you to get moving'}
              </Text>
              <Text style={styles.when}>{ago(n.createdAt)}</Text>
            </View>
            {n.challengeId && <CaretRightIcon size={14} color={withAlpha(colors.text, 0.45)} />}
          </>
        );
        return n.challengeId ? (
          <Pressable key={n.fromUserId} style={styles.row} onPress={() => onOpenChallenge(n.challengeId!)}>
            {content}
          </Pressable>
        ) : (
          <View key={n.fromUserId} style={styles.row}>
            {content}
          </View>
        );
      })}
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    card: {
      gap: 8,
      padding: 14,
      borderRadius: 16,
      backgroundColor: withAlpha(colors.accent, 0.12),
      borderWidth: 1,
      borderColor: withAlpha(colors.accent, 0.4),
    },
    header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    title: { flex: 1, fontSize: 16, fontFamily: font.heading, color: colors.text },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
    line: { fontSize: 13.5, color: colors.text },
    name: { fontFamily: font.heading },
    when: { fontSize: 11.5, color: withAlpha(colors.text, 0.55) },
  });
}
