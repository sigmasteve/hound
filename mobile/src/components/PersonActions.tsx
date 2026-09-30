import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { HandWavingIcon } from 'phosphor-react-native';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { REACTION_EMOJI, type ReactionEmoji, type ReactionSummary } from '../social/social';

// Under a leaderboard row (0082_nudges_reactions.sql): today's reactions
// to that person, and — once their row is tapped — a bar to react or
// nudge. Tapping an existing reaction adds or takes back your own, like
// any chat app.
export function PersonActions({
  summary,
  canReact,
  expanded,
  nudge,
  note,
  onReact,
  onNudge,
  indent = 0,
}: {
  summary: ReactionSummary[];
  // False on your own row: you see what you got, but can't react to it.
  canReact: boolean;
  expanded: boolean;
  // Omitted when nudging isn't offered for this person here.
  nudge?: { waitLabel: string | null; busy: boolean };
  // A line under the bar — e.g. how the nudge was delivered.
  note?: string | null;
  onReact: (emoji: ReactionEmoji) => void;
  onNudge: () => void;
  // Lines it up under the name in the row above.
  indent?: number;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const showBar = expanded && canReact;
  // Once nudged, when they can nudge again.
  const line = note ?? (showBar ? nudge?.waitLabel : null);
  if (summary.length === 0 && !showBar && !line) return null;

  const mine = new Set(summary.filter((s) => s.mine).map((s) => s.emoji));

  return (
    <View style={[styles.wrap, { paddingLeft: indent }]}>
      {summary.length > 0 && (
        <View style={styles.chips}>
          {summary.map((s) => (
            <Pressable
              key={s.emoji}
              disabled={!canReact}
              onPress={() => onReact(s.emoji)}
              style={[styles.chip, s.mine && styles.chipMine]}
              accessibilityRole={canReact ? 'button' : undefined}
              accessibilityLabel={`${s.emoji} from ${s.names.join(', ')}`}
            >
              <Text style={styles.chipEmoji}>{s.emoji}</Text>
              <Text style={[styles.chipCount, s.mine && styles.chipCountMine]}>{s.count}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {showBar && (
        <View style={styles.bar}>
          {REACTION_EMOJI.map((emoji) => (
            <Pressable
              key={emoji}
              onPress={() => onReact(emoji)}
              style={[styles.emojiButton, mine.has(emoji) && styles.emojiButtonOn]}
              accessibilityRole="button"
              accessibilityLabel={mine.has(emoji) ? `Take back ${emoji}` : `React ${emoji}`}
            >
              <Text style={styles.emoji}>{emoji}</Text>
            </Pressable>
          ))}
          {nudge && (
            <Pressable
              onPress={onNudge}
              disabled={nudge.busy || !!nudge.waitLabel}
              style={[styles.nudgeButton, (nudge.busy || !!nudge.waitLabel) && styles.nudgeButtonDone]}
              accessibilityRole="button"
            >
              <HandWavingIcon size={14} color={nudge.waitLabel ? withAlpha(colors.text, 0.5) : colors.accentActive} />
              <Text style={[styles.nudgeLabel, !!nudge.waitLabel && styles.nudgeLabelDone]} numberOfLines={1}>
                {nudge.busy ? 'Nudging…' : nudge.waitLabel ? 'Nudged' : 'Nudge'}
              </Text>
            </Pressable>
          )}
        </View>
      )}
      {!!line && <Text style={styles.note}>{line}</Text>}
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    wrap: { gap: 8, paddingTop: 2, paddingBottom: 8 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: withAlpha(colors.text, 0.12),
      backgroundColor: withAlpha(colors.text, 0.04),
    },
    chipMine: { borderColor: withAlpha(colors.accent, 0.6), backgroundColor: withAlpha(colors.accent, 0.14) },
    chipEmoji: { fontSize: 13 },
    chipCount: { fontSize: 12, fontFamily: font.heading, color: withAlpha(colors.text, 0.7) },
    chipCountMine: { color: colors.accentActive },
    bar: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
    emojiButton: {
      width: 34,
      height: 34,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: withAlpha(colors.text, 0.12),
      backgroundColor: withAlpha(colors.text, 0.04),
    },
    emojiButtonOn: { borderColor: withAlpha(colors.accent, 0.7), backgroundColor: withAlpha(colors.accent, 0.18) },
    emoji: { fontSize: 17 },
    nudgeButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      height: 34,
      paddingHorizontal: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: withAlpha(colors.accent, 0.6),
      backgroundColor: withAlpha(colors.accent, 0.12),
      flexShrink: 1,
    },
    nudgeButtonDone: { borderColor: withAlpha(colors.text, 0.12), backgroundColor: 'transparent' },
    nudgeLabel: { fontSize: 13, fontFamily: font.heading, color: colors.accentActive },
    nudgeLabelDone: { color: withAlpha(colors.text, 0.5), fontFamily: font.body },
    note: { fontSize: 12, color: withAlpha(colors.text, 0.6) },
  });
}
