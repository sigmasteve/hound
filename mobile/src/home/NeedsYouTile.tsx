import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { BellRingingIcon, BellSlashIcon, CaretRightIcon, PlayIcon, TimerIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { CHALLENGE_KIND_ICON, DEFAULT_CHALLENGE_ICON } from '../data/challengeIcons';
import type { PendingAction } from '../challenges/pendingActions';
import { Tile } from './TodayTiles';
import { ACTION_VERB, actionLine, isLiveClock } from './needsYouActions';

// Today's Up next (the streamlining, Steve Nov 2026; it was Needs you):
// the one most urgent turn, with its button that opens the game's own
// screen, live-clock games first. With two or more games waiting, "Play
// your turns" opens each one after another. Everything else (invites,
// friend requests, Bone Dig...) folds into "+N more", which opens the
// sheet. With only those waiting, their first lines show without buttons.

const ORANGE = '#f08a24';

export function UpNextTile({
  count,
  next,
  turns,
  lines,
  more,
  onAct,
  onPlay,
  onOpen,
  onMute,
}: {
  // Everything waiting, for the badge.
  count: number;
  // The top turn, or null when no game is waiting (or they're quieted).
  next: PendingAction | null;
  // Games waiting (one turn each), for Play your turns.
  turns: number;
  // Other things waiting, shown (without a button) when no game is.
  lines: string[];
  // "+3 more: an invite, a friend request, Bone Dig", or null.
  more: string | null;
  onAct: (a: PendingAction) => void;
  onPlay: () => void;
  onOpen: () => void;
  // Mute it for a while (Steve, Nov 2026): the tile shrinks to the small one.
  onMute?: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const Icon = next ? (next.challengeKind && CHALLENGE_KIND_ICON[next.challengeKind]) || DEFAULT_CHALLENGE_ICON : null;
  return (
    <View style={styles.ring}>
      <Tile
        label={turns > 1 ? `Up next · ${turns} games waiting` : 'Up next'}
        badge={count}
        wide
        onPress={onOpen}
        accessibilityLabel={`Up next, ${count} waiting. Open`}
        accessory={
          onMute ? (
            <Pressable
              onPress={onMute}
              hitSlop={10}
              style={({ pressed }) => [styles.mute, pressed && { opacity: 0.6 }]}
              accessibilityRole="button"
              accessibilityLabel="Mute Up next for a while"
            >
              <BellSlashIcon size={18} color={withAlpha(colors.text, 0.55)} />
            </Pressable>
          ) : undefined
        }
      >
        {next && Icon && (
          <View style={styles.row}>
            <View style={styles.icon}>
              <Icon size={20} color="#1b1d29" weight="bold" />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={styles.subRow}>
                <Text style={[styles.title, { flexShrink: 1 }]} numberOfLines={1}>
                  {next.challengeName}
                </Text>
                {isLiveClock(next.kind) && (
                  <View style={styles.clock}>
                    <TimerIcon size={11} color={ORANGE} weight="bold" />
                    <Text style={styles.clockText}>On the clock</Text>
                  </View>
                )}
              </View>
              <Text style={styles.sub} numberOfLines={1}>
                {actionLine(next)}
              </Text>
            </View>
            <Pressable
              onPress={() => onAct(next)}
              hitSlop={4}
              style={({ pressed }) => [styles.act, pressed && { opacity: 0.75 }]}
              accessibilityRole="button"
              accessibilityLabel={`${ACTION_VERB[next.kind]}: ${next.label}`}
            >
              <Text style={styles.actText}>{ACTION_VERB[next.kind]}</Text>
            </Pressable>
          </View>
        )}
        {!next &&
          lines.map((l, i) => (
            <View key={`line-${i}`} style={[styles.row, i > 0 && styles.divider]}>
              <View style={[styles.icon, styles.iconQuiet]}>
                <BellRingingIcon size={18} color={colors.text} weight="fill" />
              </View>
              <Text style={[styles.title, { flex: 1 }]} numberOfLines={2}>
                {l}
              </Text>
            </View>
          ))}
        {(turns > 1 || more) && (
          <View style={[styles.foot, styles.divider]}>
            {turns > 1 && (
              <Pressable
                onPress={onPlay}
                hitSlop={4}
                style={({ pressed }) => [styles.play, pressed && { opacity: 0.75 }]}
                accessibilityRole="button"
                accessibilityLabel={`Play your turns: ${turns} games, one after another`}
              >
                <PlayIcon size={14} color={ORANGE} weight="fill" />
                <Text style={styles.playText}>Play your turns ({turns})</Text>
              </Pressable>
            )}
            {more && (
              <Pressable onPress={onOpen} style={styles.more} accessibilityRole="button" hitSlop={6}>
                <Text style={styles.moreText} numberOfLines={turns > 1 ? 1 : 2}>
                  {turns > 1 ? more.replace(/:.*$/, '') : more}
                </Text>
                <CaretRightIcon size={16} color={colors.accentActive} />
              </Pressable>
            )}
          </View>
        )}
      </Tile>
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    mute: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha(colors.text, 0.06) },
    ring: { borderRadius: 19.5, borderWidth: 1.5, borderColor: withAlpha('#f0a35a', 0.45) },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(colors.text, 0.14) },
    icon: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#f0c24a', alignItems: 'center', justifyContent: 'center' },
    iconQuiet: { backgroundColor: withAlpha(colors.text, 0.08) },
    title: { fontFamily: font.headingSemibold, fontSize: 14.5, color: colors.text },
    sub: { fontSize: 12.5, lineHeight: 17, color: withAlpha(colors.text, 0.65) },
    act: { minWidth: 72, minHeight: 44, borderRadius: 12, paddingHorizontal: 12, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center' },
    actText: { fontFamily: font.headingSemibold, fontSize: 14, color: '#1b1d29' },
    subRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    clock: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8, backgroundColor: withAlpha(ORANGE, 0.14) },
    clockText: { fontSize: 11, fontFamily: font.headingSemibold, color: ORANGE },
    foot: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 8 },
    play: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1.5, borderColor: ORANGE },
    playText: { fontFamily: font.headingSemibold, fontSize: 13.5, color: ORANGE },
    more: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6, minHeight: 40 },
    moreText: { flexShrink: 1, fontFamily: font.headingSemibold, fontSize: 13, color: colors.accentActive, textAlign: 'right' },
  });
}
