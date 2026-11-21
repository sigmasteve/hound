import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { BellRingingIcon, BellSlashIcon, CaretRightIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { CHALLENGE_KIND_ICON, DEFAULT_CHALLENGE_ICON } from '../data/challengeIcons';
import type { PendingAction } from '../challenges/pendingActions';
import { Tile } from './TodayTiles';
import { ACTION_VERB, actionLine } from './needsYouActions';

// Today's Needs you, full width while anything's waiting (Steve's pick,
// Nov 2026; mockup claude.ai/artifact/Rzv9E8vZATjdcauU5sUkor): the top two
// game actions, each with a button that opens the game's own screen, then
// "+N more: …" for the rest, which opens the sheet. With only invites,
// requests and the like waiting, their lines show without buttons.

const ORANGE = '#f08a24';

export function NeedsYouWideTile({
  count,
  actions,
  lines,
  more,
  onAct,
  onOpen,
  onMute,
}: {
  // Everything waiting, for the badge.
  count: number;
  // Up to two, already ranked.
  actions: PendingAction[];
  // Other things waiting, shown (without a button) when there are fewer
  // than two actions.
  lines: string[];
  // "+3 more: an invite, a friend request, Bone Dig", or null.
  more: string | null;
  onAct: (a: PendingAction) => void;
  onOpen: () => void;
  // Mute it for a while (Steve, Nov 2026): the tile shrinks to the small one.
  onMute?: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.ring}>
      <Tile
        label="Needs you"
        badge={count}
        wide
        onPress={onOpen}
        accessibilityLabel={`Needs you, ${count} waiting. Open`}
        accessory={
          onMute ? (
            <Pressable
              onPress={onMute}
              hitSlop={10}
              style={({ pressed }) => [styles.mute, pressed && { opacity: 0.6 }]}
              accessibilityRole="button"
              accessibilityLabel="Mute Needs you for a while"
            >
              <BellSlashIcon size={18} color={withAlpha(colors.text, 0.55)} />
            </Pressable>
          ) : undefined
        }
      >
        {actions.map((a, i) => {
          const Icon = (a.challengeKind && CHALLENGE_KIND_ICON[a.challengeKind]) || DEFAULT_CHALLENGE_ICON;
          return (
            <View key={`${a.challengeId}-${a.kind}`} style={[styles.row, i > 0 && styles.divider]}>
              <View style={styles.icon}>
                <Icon size={20} color="#1b1d29" weight="bold" />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.title} numberOfLines={1}>
                  {a.challengeName}
                </Text>
                <Text style={styles.sub} numberOfLines={1}>
                  {actionLine(a)}
                </Text>
              </View>
              <Pressable
                onPress={() => onAct(a)}
                hitSlop={4}
                style={({ pressed }) => [styles.act, pressed && { opacity: 0.75 }]}
                accessibilityRole="button"
                accessibilityLabel={`${ACTION_VERB[a.kind]}: ${a.label}`}
              >
                <Text style={styles.actText}>{ACTION_VERB[a.kind]}</Text>
              </Pressable>
            </View>
          );
        })}
        {lines.map((l, i) => (
          <View key={`line-${i}`} style={[styles.row, (actions.length > 0 || i > 0) && styles.divider]}>
            <View style={[styles.icon, styles.iconQuiet]}>
              <BellRingingIcon size={18} color={colors.text} weight="fill" />
            </View>
            <Text style={[styles.title, { flex: 1 }]} numberOfLines={2}>
              {l}
            </Text>
          </View>
        ))}
        {more && (
          <Pressable onPress={onOpen} style={[styles.more, styles.divider]} accessibilityRole="button">
            <Text style={styles.moreText} numberOfLines={2}>
              {more}
            </Text>
            <CaretRightIcon size={16} color={colors.accentActive} />
          </Pressable>
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
    more: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 40 },
    moreText: { flex: 1, fontFamily: font.headingSemibold, fontSize: 13, color: colors.accentActive },
  });
}
