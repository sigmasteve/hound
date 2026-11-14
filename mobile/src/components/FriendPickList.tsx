import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { MagnifyingGlassIcon, XIcon } from 'phosphor-react-native';
import { Text } from './Text';
import { TextField } from './TextField';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';

// The friend list every "pick friends" screen shares (Create, inviting to
// a challenge, a Pack Activity, a club). Each screen still draws its own
// row; this only decides how the list holds up with lots of friends:
// past `scrollAfter` it scrolls inside its own box (about six rows tall)
// with the picked ones shown as chips above it, so you can see who's in
// without scrolling back; past `searchAfter` it gets a search field.
export function FriendPickList<T extends { userId: string; name: string }>({
  items,
  renderItem,
  pickedIds,
  onUnpick,
  rowHeight = 58,
  gap = 8,
  scrollAfter = 10,
  searchAfter = 20,
}: {
  items: T[];
  renderItem: (item: T) => React.ReactNode;
  // Who's picked, for the chips over a long list (and tapping one's ×).
  pickedIds?: Iterable<string>;
  onUnpick?: (userId: string) => void;
  rowHeight?: number;
  gap?: number;
  scrollAfter?: number;
  searchAfter?: number;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [query, setQuery] = useState('');
  const long = items.length > scrollAfter;
  const searchable = items.length > searchAfter;
  const q = query.trim().toLowerCase();
  const shown = searchable && q ? items.filter((f) => f.name.toLowerCase().includes(q)) : items;
  const picked = useMemo(() => {
    const ids = new Set(pickedIds ?? []);
    return items.filter((f) => ids.has(f.userId));
  }, [items, pickedIds]);

  const rows = shown.map((f) => <React.Fragment key={f.userId}>{renderItem(f)}</React.Fragment>);
  const none = searchable && q && shown.length === 0 ? <Text style={styles.note}>No friends match “{query.trim()}”.</Text> : null;

  return (
    <View style={{ gap }}>
      {searchable && (
        <TextField
          label=""
          value={query}
          onChangeText={setQuery}
          placeholder={`Search ${items.length} friends`}
          icon={<MagnifyingGlassIcon size={16} color={withAlpha(colors.text, 0.5)} />}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
      )}
      {long && picked.length > 0 && (
        <View style={styles.chips}>
          <Text style={styles.pickedLabel}>{picked.length} picked</Text>
          {picked.map((f) => (
            <Pressable
              key={f.userId}
              onPress={onUnpick ? () => onUnpick(f.userId) : undefined}
              disabled={!onUnpick}
              style={styles.chip}
              accessibilityRole="button"
              accessibilityLabel={onUnpick ? `Remove ${f.name}` : f.name}
            >
              <Text style={styles.chipText} numberOfLines={1}>
                {f.name.split(' ')[0]}
              </Text>
              {onUnpick ? <XIcon size={11} color={withAlpha(colors.text, 0.6)} weight="bold" /> : null}
            </Pressable>
          ))}
        </View>
      )}
      {long ? (
        <View style={styles.box}>
          <ScrollView
            style={{ maxHeight: rowHeight * 6.5 + gap * 6 }}
            contentContainerStyle={{ gap, padding: 6 }}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
          >
            {rows}
            {none}
          </ScrollView>
        </View>
      ) : (
        <>
          {rows}
          {none}
        </>
      )}
      {long && !q && (
        <Text style={styles.note}>
          {items.length} friends · scroll for more{searchable ? ', or search' : ''}
        </Text>
      )}
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    box: {
      borderRadius: 14,
      borderWidth: 1,
      borderColor: withAlpha(colors.text, 0.1),
      backgroundColor: withAlpha(colors.text, 0.02),
      overflow: 'hidden',
    },
    chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
    pickedLabel: { fontFamily: font.headingSemibold, fontSize: 12.5, color: withAlpha(colors.text, 0.65), marginRight: 2 },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      minHeight: 30,
      paddingHorizontal: 10,
      borderRadius: 15,
      backgroundColor: withAlpha(colors.accent, 0.14),
      borderWidth: 1,
      borderColor: withAlpha(colors.accent, 0.35),
    },
    chipText: { fontFamily: font.headingSemibold, fontSize: 12.5, color: colors.text, maxWidth: 110 },
    note: { fontSize: 12, color: withAlpha(colors.text, 0.6) },
  });
}
