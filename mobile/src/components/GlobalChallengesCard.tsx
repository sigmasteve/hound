import React, { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { CaretRightIcon, CheckCircleIcon, GlobeHemisphereWestIcon, UsersThreeIcon } from 'phosphor-react-native';
import { useTheme } from '../theme/ThemeContext';
import { color, font, withAlpha, type Palette } from '../theme/tokens';
import { CHALLENGE_TYPES } from '../data/sampleData';
import { CHALLENGE_KIND_ICON, DEFAULT_CHALLENGE_ICON } from '../data/challengeIcons';
import { canJoin, globalTimingLine, joinDeadlineLine, type GlobalChallenge } from '../challenges/globalChallenges';

// Today's "Global Hound Challenges" — challenges an admin published to
// everyone (0075_global_challenges.sql). Each row is either joinable
// (a Join button) or already joined (tap to open it). Ones the viewer
// can no longer join, and never did, are left out by the caller.
export function GlobalChallengesCard({
  challenges,
  joiningId,
  onJoin,
  onOpen,
}: {
  challenges: GlobalChallenge[];
  joiningId: string | null;
  onJoin: (c: GlobalChallenge) => void;
  onOpen: (c: GlobalChallenge) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <GlobeHemisphereWestIcon size={17} color={colors.accentActive} />
        <Text style={styles.title}>Global Hound Challenges</Text>
      </View>
      <Text style={styles.subtitle}>Open to everyone on Hound — jump in and see how you stack up.</Text>

      {challenges.map((c) => {
        const KindIcon = CHALLENGE_KIND_ICON[c.kind] ?? DEFAULT_CHALLENGE_ICON;
        const typeName = CHALLENGE_TYPES.find((t) => t.id === c.kind)?.name ?? 'Challenge';
        const joinable = canJoin(c);
        const deadline = joinable ? joinDeadlineLine(c) : null;
        const body = (
          <>
            <View style={styles.kindIcon}>
              <KindIcon size={18} color={colors.text} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.name} numberOfLines={1}>
                {c.name}
              </Text>
              <Text style={styles.meta} numberOfLines={1}>
                {typeName} · {c.durationDays} days
              </Text>
              <View style={styles.metaRow}>
                <UsersThreeIcon size={12} color={withAlpha(colors.text, 0.55)} />
                <Text style={[styles.meta, { flexShrink: 1 }]}>
                  {globalTimingLine(c)} · {c.participantCount.toLocaleString()} joined
                </Text>
              </View>
              {deadline && <Text style={styles.deadline}>{deadline}</Text>}
            </View>
          </>
        );
        if (c.joined) {
          return (
            <Pressable
              key={c.id}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.8 }]}
              onPress={() => onOpen(c)}
              accessibilityRole="button"
              accessibilityLabel={`Open ${c.name}`}
            >
              {body}
              <View style={styles.joinedPill}>
                <CheckCircleIcon size={13} color={colors.green} weight="fill" />
                <Text style={styles.joinedText}>Joined</Text>
              </View>
              <CaretRightIcon size={14} color={withAlpha(colors.text, 0.4)} />
            </Pressable>
          );
        }
        return (
          <View key={c.id} style={styles.row}>
            {body}
            <Pressable
              style={({ pressed }) => [styles.joinButton, pressed && { opacity: 0.8 }]}
              onPress={() => onJoin(c)}
              disabled={joiningId !== null}
              accessibilityRole="button"
              accessibilityLabel={`Join ${c.name}`}
            >
              {joiningId === c.id ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.joinText}>Join</Text>}
            </Pressable>
          </View>
        );
      })}
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
    header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    title: { fontSize: 16, fontFamily: font.heading, color: colors.text },
    subtitle: { fontSize: 12.5, color: withAlpha(colors.text, 0.65) },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingTop: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: withAlpha(colors.text, 0.1),
    },
    kindIcon: {
      width: 36,
      height: 36,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: withAlpha(colors.text, 0.08),
    },
    name: { fontSize: 14.5, fontFamily: font.heading, color: colors.text },
    meta: { fontSize: 12, color: withAlpha(colors.text, 0.6) },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    deadline: { fontSize: 12, color: colors.amber, fontFamily: font.heading },
    joinButton: {
      minWidth: 64,
      height: 34,
      paddingHorizontal: 14,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: color.accent,
    },
    joinText: { fontSize: 14, color: '#fff', fontFamily: font.heading },
    joinedPill: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    joinedText: { fontSize: 12.5, color: colors.green, fontFamily: font.heading },
  });
}
