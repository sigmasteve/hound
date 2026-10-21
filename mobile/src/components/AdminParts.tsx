import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CaretDownIcon, CaretRightIcon } from 'phosphor-react-native';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';

// Pieces of the Admin screen's layout (AdminScreen.tsx): the row of
// section pills, a card that's one line until tapped open, and a note
// that shows its first sentence with "More" for the rest.

export function AdminTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string; badge?: number }[];
  value: T;
  onChange: (id: T) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.tabs}>
      {tabs.map((t) => {
        const on = t.id === value;
        return (
          <Pressable
            key={t.id}
            onPress={() => onChange(t.id)}
            style={[styles.tab, on && styles.tabOn]}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t.badge ? `${t.label}, ${t.badge} waiting` : t.label}
          >
            <Text
              style={[styles.tabLabel, on && styles.tabLabelOn]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.75}
              maxFontSizeMultiplier={1.2}
            >
              {t.label}
            </Text>
            {!!t.badge && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{t.badge}</Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

// One line (title, a short summary, a caret) until tapped; then the full
// card underneath. Pass `open`/`onOpenChange` to open it from elsewhere
// (Overview's "Needs you").
export function AdminFold({
  title,
  icon,
  summary,
  open: openProp,
  onOpenChange,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  summary?: string | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const toggle = () => {
    setOpenState(!open);
    onOpenChange?.(!open);
  };
  return (
    <View style={{ gap: 8 }}>
      <Pressable onPress={toggle} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <Card style={styles.foldRow} elevated={false}>
          {icon}
          <Text style={styles.foldTitle}>{title}</Text>
          <Text style={styles.foldSummary} numberOfLines={1}>
            {summary ?? ''}
          </Text>
          {open ? (
            <CaretDownIcon size={14} color={withAlpha(colors.text, 0.45)} />
          ) : (
            <CaretRightIcon size={14} color={withAlpha(colors.text, 0.45)} />
          )}
        </Card>
      </Pressable>
      {open && children}
    </View>
  );
}

// The first sentence up front, the rest behind "More".
export function AdminNote({ short, more }: { short: string; more?: React.ReactNode }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  return (
    <Text style={styles.note}>
      {short}
      {more ? (
        open ? (
          <>
            {' '}
            {more}{' '}
            <Text style={styles.more} onPress={() => setOpen(false)}>
              Less
            </Text>
          </>
        ) : (
          <Text style={styles.more} onPress={() => setOpen(true)}>
            {' '}
            More ›
          </Text>
        )
      ) : null}
    </Text>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    // One row: each tab as wide as its label, sharing what's left over,
    // so all five fit on a phone.
    tabs: { flexDirection: 'row', gap: 4 },
    tab: {
      flexGrow: 1,
      flexShrink: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      paddingHorizontal: 7,
      paddingVertical: 7,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: withAlpha(colors.text, 0.15),
    },
    tabOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    tabLabel: { flexShrink: 1, fontSize: 12.5, fontFamily: font.heading, color: withAlpha(colors.text, 0.8) },
    tabLabelOn: { color: '#161826', fontFamily: font.headingSemibold },
    badge: {
      minWidth: 16,
      height: 16,
      paddingHorizontal: 4,
      borderRadius: 9,
      backgroundColor: colors.amber,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeText: { fontSize: 11, fontFamily: font.headingSemibold, color: '#1b1d29' },
    foldRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14 },
    foldTitle: { fontSize: 15, fontFamily: font.heading, color: colors.text },
    foldSummary: { flex: 1, textAlign: 'right', fontSize: 13, color: withAlpha(colors.text, 0.55) },
    note: { fontSize: 12.5, lineHeight: 17.5, color: withAlpha(colors.text, 0.55) },
    more: { color: colors.accent400, fontFamily: font.heading },
  });
}
