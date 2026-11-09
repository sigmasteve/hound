import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { FlagCheckeredIcon, FlagPennantIcon, HouseIcon, UsersThreeIcon } from 'phosphor-react-native';
import { getClubsBadge } from '../clubs/clubsApi';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';
import type { MainTab } from '../navigation/types';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from './Avatar';
import { getMyEquippedCosmetics, type EquippedCosmetics } from '../cosmetics/cosmeticsApi';
import { isSupabaseConfigured } from '../lib/supabase';

const TABS: { id: Exclude<MainTab, 'you'>; label: string; Icon: React.ComponentType<any> }[] = [
  { id: 'home', label: 'Today', Icon: HouseIcon },
  { id: 'challenges', label: 'Challenges', Icon: FlagCheckeredIcon },
  { id: 'clubs', label: 'Clubs', Icon: FlagPennantIcon },
  { id: 'friends', label: 'Friends', Icon: UsersThreeIcon },
];

// The five tabs, at the bottom where a thumb reaches them. "You" shows
// your own avatar (with whatever you've equipped in the Locker) instead
// of an icon. Clubs (0185) carries a count of new club challenges you
// haven't joined, the only place club news shows outside the tab (Today
// stays as it is).
export function TabBar({ active, onSelect }: { active: MainTab; onSelect: (tab: MainTab) => void }) {
  const { user } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Re-fetched whenever Main regains focus: the bar stays mounted while
  // the Locker is pushed on top, so a fetch-once would miss a change
  // made there.
  const [equipped, setEquipped] = useState<EquippedCosmetics | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (!isSupabaseConfigured || !user?.id) return;
      getMyEquippedCosmetics(user.id)
        .then(setEquipped)
        .catch(() => {
          // Keep the plain avatar.
        });
    }, [user?.id]),
  );

  // The Clubs badge: on focus, when the tab changes (opening Clubs and
  // a club clears it), and when the app comes back to the front.
  const [clubsNew, setClubsNew] = useState(0);
  const refreshClubs = useCallback(() => {
    if (!isSupabaseConfigured || !user?.id) return;
    getClubsBadge()
      .then(setClubsNew)
      .catch(() => {
        // No badge rather than a broken bar (also before 0185 is run).
      });
  }, [user?.id]);
  useFocusEffect(refreshClubs);
  useEffect(() => {
    refreshClubs();
  }, [active, refreshClubs]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') refreshClubs();
    });
    return () => sub.remove();
  }, [refreshClubs]);

  const youOn = active === 'you';
  return (
    <SafeAreaView edges={['bottom']} style={styles.safe}>
      <View style={styles.row}>
        {TABS.map(({ id, label, Icon }) => {
          const on = active === id;
          return (
            <Pressable
              key={id}
              onPress={() => onSelect(id)}
              style={styles.item}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected: on }}
            >
              <View>
                <Icon size={22} color={on ? colors.accentActive : withAlpha(colors.text, 0.6)} weight={on ? 'fill' : 'regular'} />
                {id === 'clubs' && clubsNew > 0 && (
                  <View style={styles.badge} accessibilityLabel={`${clubsNew} new`}>
                    <Text style={styles.badgeText}>{clubsNew > 9 ? '9+' : clubsNew}</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.label, on && styles.labelOn]} numberOfLines={1}>
                {label}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          onPress={() => onSelect('you')}
          style={styles.item}
          accessibilityRole="tab"
          accessibilityLabel="You"
          accessibilityState={{ selected: youOn }}
        >
          <View style={[styles.avatarRing, youOn && styles.avatarRingOn]}>
            <Avatar
              initials={user?.initials ?? ''}
              tint={colors.accent800}
              size={22}
              fontSize={9}
              frameId={equipped?.frameId}
              backgroundId={equipped?.backgroundId}
              iconId={equipped?.iconId}
            />
          </View>
          <Text style={[styles.label, youOn && styles.labelOn]} numberOfLines={1}>
            You
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    safe: {
      backgroundColor: withAlpha(colors.bg, 0.98),
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    row: { flexDirection: 'row', paddingHorizontal: 6, paddingTop: 6, paddingBottom: 4 },
    item: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', gap: 3, paddingVertical: 4 },
    label: { fontFamily: font.body, fontSize: 11, color: withAlpha(colors.text, 0.6) },
    labelOn: { fontFamily: font.headingSemibold, color: colors.accentActive },
    badge: { position: 'absolute', top: -4, right: -10, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, backgroundColor: '#e5484d', alignItems: 'center', justifyContent: 'center' },
    badgeText: { color: '#ffffff', fontSize: 10, fontFamily: font.headingSemibold },
    avatarRing: { borderRadius: 999, padding: 1, borderWidth: 1.5, borderColor: 'transparent' },
    avatarRingOn: { borderColor: colors.accentActive },
  });
}
