import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ChartLineUpIcon,
  FlagCheckeredIcon,
  HouseIcon,
  PawPrintIcon,
  PlugsIcon,
  UsersThreeIcon,
} from 'phosphor-react-native';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';
import type { MainTab } from '../navigation/types';
import { useAuth } from '../auth/AuthContext';

const NAV: { id: MainTab; label: string; Icon: React.ComponentType<any> }[] = [
  { id: 'home', label: 'Today', Icon: HouseIcon },
  { id: 'challenges', label: 'Challenges', Icon: FlagCheckeredIcon },
  { id: 'metrics', label: 'Data', Icon: ChartLineUpIcon },
  { id: 'friends', label: 'Friends', Icon: UsersThreeIcon },
  { id: 'connect', label: 'Connect', Icon: PlugsIcon },
];

export function TopNav({
  active,
  onSelect,
  onProfile,
}: {
  active: MainTab | 'hunt' | 'create';
  onSelect: (tab: MainTab) => void;
  onProfile: () => void;
}) {
  const { user } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // First name only — the header's too narrow for "Stephen Washington
  // Jr" alongside the nav row, and every other screen that shows the
  // full name (Settings' account card) is right there one tap away via
  // onProfile.
  const firstName = user?.name.split(' ')[0] ?? '';

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={styles.brandRow}>
        <View style={styles.brandMark}>
          <PawPrintIcon size={16} color={colors.accent} weight="fill" />
        </View>
        <Text style={styles.brandName}>Hound</Text>
        <Pressable style={styles.profile} onPress={onProfile}>
          <View style={styles.profileAvatar}>
            <Text style={styles.profileInitials}>{user?.initials ?? ''}</Text>
          </View>
          <Text style={styles.profileName}>{firstName}</Text>
        </Pressable>
      </View>
      {/* Icon-only, evenly split across the full width (flex: 1 per item)
          instead of the old horizontal-scrolling row of icon+label pills
          — that layout let a 5th tab (Connect) scroll off-screen with no
          visible affordance hinting it was there at all. Every item still
          carries its label as an accessibilityLabel, just not rendered,
          so this isn't a real loss for screen readers. */}
      <View style={styles.navRow}>
        {NAV.map(({ id, label, Icon }) => {
          const on = active === id || (id === 'challenges' && (active === 'hunt' || active === 'create'));
          return (
            <Pressable
              key={id}
              onPress={() => onSelect(id)}
              style={[styles.navItem, on && styles.navItemOn]}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected: on }}
            >
              <Icon size={21} color={on ? colors.accentActive : withAlpha(colors.text, 0.68)} weight={on ? 'fill' : 'regular'} />
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    safe: {
      backgroundColor: withAlpha(colors.bg, 0.96),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    brandRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 6,
    },
    brandMark: {
      width: 28,
      height: 28,
      borderRadius: 9,
      borderWidth: 1,
      borderColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    brandName: { fontFamily: font.headingSemibold, fontSize: 17, color: colors.text, letterSpacing: 0.2 },
    profile: {
      marginLeft: 'auto',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 4,
      paddingLeft: 4,
      paddingRight: 10,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
    },
    profileAvatar: {
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: colors.accent800,
      alignItems: 'center',
      justifyContent: 'center',
    },
    profileInitials: { fontFamily: font.headingSemibold, fontSize: 11, color: colors.accent100 },
    profileName: { fontFamily: font.body, fontSize: 13, color: colors.text },
    navRow: { flexDirection: 'row', paddingHorizontal: 10, paddingBottom: 10, gap: 4 },
    navItem: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 9,
      borderRadius: 8,
    },
    navItemOn: {
      backgroundColor: withAlpha(colors.accent, 0.16),
      borderWidth: 1,
      borderColor: colors.accent,
    },
  });
}
