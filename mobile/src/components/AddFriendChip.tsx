import React, { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { CheckIcon, UserPlusIcon } from 'phosphor-react-native';
import { useTheme } from '../theme/ThemeContext';
import { withAlpha, type Palette } from '../theme/tokens';

// Where the viewer stands with someone on a shared leaderboard who isn't
// already their friend: nothing yet ('add'), they asked the viewer first
// ('accept'), or the viewer already asked them ('requested').
export type AddFriendChipState = 'add' | 'accept' | 'requested';

// A compact, inline pill for a leaderboard row — small enough to sit
// beside a name and its role/streak tags without pushing the row's own
// numbers around.
export function AddFriendChip({
  state,
  busy,
  onPress,
}: {
  state: AddFriendChipState;
  busy?: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  if (state === 'requested') {
    return (
      <View style={[styles.chip, styles.chipMuted]} accessibilityLabel="Friend request sent">
        <CheckIcon size={11} color={withAlpha(colors.text, 0.55)} weight="bold" />
        <Text style={[styles.label, styles.labelMuted]}>Requested</Text>
      </View>
    );
  }

  const accept = state === 'accept';
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={accept ? 'Accept friend request' : 'Add friend'}
      style={({ pressed }) => [styles.chip, accept ? styles.chipAccept : styles.chipAdd, pressed && { opacity: 0.7 }]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={colors.accent} style={{ transform: [{ scale: 0.6 }] }} />
      ) : (
        <UserPlusIcon size={12} color={accept ? colors.text : colors.accent} weight="bold" />
      )}
      <Text style={[styles.label, accept ? styles.labelAccept : styles.labelAdd]}>{accept ? 'Accept' : 'Add'}</Text>
    </Pressable>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      height: 22,
      paddingHorizontal: 8,
      borderRadius: 11,
      alignSelf: 'center',
    },
    chipAdd: { borderWidth: 1, borderColor: withAlpha(colors.accent, 0.6) },
    chipAccept: { backgroundColor: withAlpha(colors.accent, 0.35), borderWidth: 1, borderColor: colors.accent },
    chipMuted: { borderWidth: 1, borderColor: colors.divider },
    label: { fontSize: 11, letterSpacing: 0.2 },
    labelAdd: { color: colors.accent },
    labelAccept: { color: colors.text },
    labelMuted: { color: withAlpha(colors.text, 0.55) },
  });
}
