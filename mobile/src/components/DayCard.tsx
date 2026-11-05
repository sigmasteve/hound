import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { CaretDownIcon, CaretRightIcon, PlayIcon } from 'phosphor-react-native';
import { Text } from './Text';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';

// One day of a game's report, folded to its headline: the day, its score,
// a one-line summary and a Replay button. Tap the header to unfold the
// detail. Shared by the sports and board games so their reports read the
// same and stay short.
export function DayCard({
  title,
  score,
  summary,
  defaultOpen = false,
  onReplay,
  replaying,
  children,
}: {
  title: string;
  score?: string;
  summary?: string;
  defaultOpen?: boolean;
  onReplay?: () => void;
  // This day is the one being replayed now.
  replaying?: boolean;
  children?: React.ReactNode;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [open, setOpen] = useState(defaultOpen);
  const Caret = open ? CaretDownIcon : CaretRightIcon;
  return (
    <View style={[styles.card, replaying && styles.cardOn]}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={styles.head}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${title}${score ? `, ${score}` : ''}. ${open ? 'Fold' : 'Unfold'}`}
        hitSlop={4}
      >
        <Caret size={13} color={withAlpha(colors.text, 0.55)} weight="bold" />
        <Text style={styles.title}>{title}</Text>
        {score ? <Text style={styles.score}>{score}</Text> : null}
      </Pressable>
      {(summary || onReplay) && (
        <View style={styles.summaryRow}>
          {summary ? (
            <Text style={styles.summary} numberOfLines={open ? undefined : 2}>
              {summary}
            </Text>
          ) : (
            <View style={{ flex: 1 }} />
          )}
          {onReplay && (
            <Pressable onPress={onReplay} style={styles.replay} accessibilityRole="button" accessibilityLabel={`Replay ${title}`} hitSlop={6}>
              <PlayIcon size={11} color={colors.accent} weight="fill" />
              <Text style={styles.replayText}>Replay</Text>
            </Pressable>
          )}
        </View>
      )}
      {open && children ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

// "You saved Micah's shot ×2": the same line once, with how many times.
export function groupLines(lines: string[]): string[] {
  const counts = new Map<string, number>();
  for (const l of lines) counts.set(l, (counts.get(l) ?? 0) + 1);
  return [...counts.entries()].map(([l, n]) => (n > 1 ? `${l.replace(/\.$/, '')} ×${n}` : l));
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    card: { gap: 4, padding: 10, borderRadius: 10, backgroundColor: withAlpha(colors.accent, 0.08), borderWidth: 1.5, borderColor: 'transparent' },
    cardOn: { borderColor: withAlpha(colors.accent, 0.5) },
    head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    title: { flex: 1, fontFamily: font.heading, fontSize: 13.5, color: colors.text },
    score: { fontFamily: font.heading, fontSize: 13.5, color: colors.accentActive, fontVariant: ['tabular-nums'] },
    summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 19 },
    summary: { flex: 1, fontSize: 12.5, lineHeight: 17, color: withAlpha(colors.text, 0.72) },
    replay: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingVertical: 5,
      paddingHorizontal: 10,
      borderRadius: 999,
      backgroundColor: withAlpha(colors.accent, 0.14),
    },
    replayText: { fontFamily: font.headingSemibold, fontSize: 12, color: colors.accent },
    body: { gap: 3, paddingLeft: 19, paddingTop: 4 },
  });
}
