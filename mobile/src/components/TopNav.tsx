import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BoneIcon, BuildingsIcon, PawPrintIcon, ShieldCheckIcon } from 'phosphor-react-native';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../auth/AuthContext';
import { isSupabaseConfigured } from '../lib/supabase';
import { getMyHoundScore } from '../challenges/scoreApi';
import { levelProgressForXp } from '../challenges/leveling';
import { rankForLevel } from '../challenges/ranks';
import { onBonesChanged } from '../bones/bonesChanged';
import { useCurrencyName } from '../organizations/useCurrencyName';

// 980, 1,240, then 12.4k so the chip stays small.
function shortCount(n: number): string {
  if (n < 10_000) return n.toLocaleString('en-US');
  return `${(Math.floor(n / 100) / 10).toLocaleString('en-US')}k`;
}

// The slim bar above every tab: the Hound mark (tap it to go to Today),
// and the two management icons for the people who have something to
// manage. Everything else
// that used to live up here (Help, Locker, your name for Settings) is on
// the You tab, and the tabs themselves are at the bottom (TabBar). Your
// level and rank sit up here too, on every tab, and your Bones balance,
// which pops when it goes up; tap either for the Locker. With the
// management icons there too, the "Hound" name gives them the room.
export function TopNav({
  tab,
  onHome,
  onOpenLevel,
  onAdmin,
  onOrgManagement,
}: {
  // Re-reads your level whenever the tab changes, so a level-up shows.
  tab: string;
  onHome: () => void;
  onOpenLevel: () => void;
  onAdmin: () => void;
  // Passed the caller's own org id when they're only an org admin (not a
  // platform admin) — MainScreen uses that to skip straight to
  // OrgDetailScreen for their one org. Omitted (undefined) for a
  // platform admin, who lands on the OrgManagementScreen hub instead.
  onOrgManagement: (organizationId?: string) => void;
}) {
  const { user } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const canManageOrgs = !!user?.isAdmin || user?.orgRole === 'admin';
  const currencyName = useCurrencyName();
  const [xpTotal, setXpTotal] = useState<number | null>(null);
  const [bones, setBones] = useState<number | null>(null);
  const lastBones = useRef<number | null>(null);
  const pop = useRef(new Animated.Value(0)).current;

  const refreshLevel = useCallback(() => {
    if (!isSupabaseConfigured || !user?.id) return;
    getMyHoundScore(user.id)
      .then((s) => {
        setXpTotal(s.xpTotal);
        setBones(s.bonesBalance);
      })
      .catch(() => {
        // The bar just goes without it.
      });
  }, [user?.id]);

  useEffect(() => onBonesChanged(refreshLevel), [refreshLevel]);

  // A little pop when the balance goes up (not on first load).
  useEffect(() => {
    if (bones !== null && lastBones.current !== null && bones > lastBones.current) {
      pop.setValue(0);
      Animated.sequence([
        Animated.timing(pop, { toValue: 1, duration: 160, useNativeDriver: true }),
        Animated.spring(pop, { toValue: 0, friction: 4, tension: 120, useNativeDriver: true }),
      ]).start();
    }
    lastBones.current = bones;
  }, [bones, pop]);

  useEffect(refreshLevel, [refreshLevel, tab]);
  useFocusEffect(refreshLevel);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshLevel();
    });
    return () => sub.remove();
  }, [refreshLevel]);

  const level = xpTotal === null ? null : levelProgressForXp(xpTotal).level;
  const rank = level === null ? null : rankForLevel(level);

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={styles.brandRow}>
        <Pressable
          style={({ pressed }) => [styles.brandLink, pressed && { opacity: 0.7 }]}
          onPress={onHome}
          hitSlop={6}
          accessibilityRole="link"
          accessibilityLabel="Hound, go to Today"
        >
          <View style={styles.brandMark}>
            <PawPrintIcon size={16} color={colors.accent} weight="fill" />
          </View>
          {!canManageOrgs && !user?.isAdmin && <Text style={styles.brandName}>Hound</Text>}
        </Pressable>
        <View style={styles.pushRight} />
        {level !== null && rank && (
          <Pressable
            style={({ pressed }) => [
              styles.levelChip,
              { borderColor: withAlpha(rank.color, 0.6), backgroundColor: withAlpha(rank.color, 0.14) },
              pressed && { opacity: 0.7 },
            ]}
            onPress={onOpenLevel}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`Level ${level}, ${rank.name}. Open the Locker`}
          >
            <Text style={[styles.levelNumber, { color: rank.color }]}>Lv {level}</Text>
            <Text style={styles.rankName}>{rank.name}</Text>
          </Pressable>
        )}
        {bones !== null && (
          <Animated.View style={{ transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }) }] }}>
            <Pressable
              style={({ pressed }) => [styles.bonesChip, pressed && { opacity: 0.7 }]}
              onPress={onOpenLevel}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`${bones} ${currencyName}. Open the Locker`}
            >
              <BoneIcon size={15} color={colors.amber} weight="fill" />
              <Text style={styles.bonesCount}>{shortCount(bones)}</Text>
            </Pressable>
          </Animated.View>
        )}
        {canManageOrgs && (
          <Pressable
            style={styles.iconButton}
            onPress={() => onOrgManagement(user?.isAdmin ? undefined : user?.organizationId ?? undefined)}
            accessibilityLabel="Organizations"
          >
            <BuildingsIcon size={16} color={colors.accent} />
          </Pressable>
        )}
        {user?.isAdmin && (
          <Pressable style={styles.iconButton} onPress={onAdmin} accessibilityLabel="Admin">
            <ShieldCheckIcon size={16} color={colors.accent} />
          </Pressable>
        )}
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
      paddingTop: 8,
      paddingBottom: 8,
      minHeight: 48,
    },
    // The mark and name together, as one tap target, gapped like the row.
    brandLink: { flexDirection: 'row', alignItems: 'center', gap: 9 },
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
    pushRight: { flex: 1 },
    levelChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      height: 32,
      paddingHorizontal: 12,
      borderRadius: 16,
      borderWidth: 1,
    },
    levelNumber: { fontFamily: font.headingSemibold, fontSize: 13.5 },
    rankName: { fontFamily: font.heading, fontSize: 13.5, color: colors.text },
    bonesChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      height: 32,
      paddingHorizontal: 10,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: withAlpha(colors.amber, 0.55),
      backgroundColor: withAlpha(colors.amber, 0.12),
    },
    bonesCount: { fontFamily: font.headingSemibold, fontSize: 13.5, color: colors.text },
    iconButton: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
    },
  });
}
