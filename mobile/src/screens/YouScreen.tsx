import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  BoneIcon,
  CaretRightIcon,
  ChartLineUpIcon,
  CoatHangerIcon,
  DogIcon,
  GearSixIcon,
  HeartbeatIcon,
  QuestionIcon,
  TargetIcon,
  TrophyIcon,
} from 'phosphor-react-native';
import { Avatar } from '../components/Avatar';
import { Card } from '../components/Card';
import { ProgressBar } from '../components/ProgressBar';
import { useTheme } from '../theme/ThemeContext';
import { color, font, withAlpha, type Palette } from '../theme/tokens';
import { useAuth } from '../auth/AuthContext';
import { useHealthProvider } from '../health/HealthContext';
import { isSupabaseConfigured } from '../lib/supabase';
import { getMyHoundScore, type HoundScore } from '../challenges/scoreApi';
import { levelProgressForXp } from '../challenges/leveling';
import { rankForLevel } from '../challenges/ranks';
import { getMyEquippedCosmetics, type EquippedCosmetics } from '../cosmetics/cosmeticsApi';
import { listAchievements, listEarnedAchievements } from '../achievements/achievementsApi';
import { useCurrencyName } from '../organizations/useCurrencyName';
import { useGoals } from '../goals/GoalsContext';
import { HOUND_LEVELS } from '../goals/hound';

// The You tab: who you are and how you're doing (level, Hound Score,
// Bones), then one row for each place that's about you. Everything here
// used to be spread across Settings, the Data and Connect tabs, and icons
// in the top bar.
export function YouScreen({
  onOpenGoals,
  onOpenStats,
  onOpenAchievements,
  onOpenLocker,
  onOpenKennel,
  onOpenHealthData,
  onOpenSettings,
  onOpenHelp,
}: {
  onOpenGoals: () => void;
  onOpenStats: () => void;
  onOpenAchievements: () => void;
  onOpenLocker: () => void;
  onOpenKennel: () => void;
  onOpenHealthData: () => void;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
}) {
  const { user } = useAuth();
  const health = useHealthProvider();
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const currencyName = useCurrencyName();
  const { goals, houndLevel } = useGoals();

  // Null until loaded (or if it fails): the numbers just don't show,
  // rather than a guessed 0.
  const [houndScore, setHoundScore] = useState<HoundScore | null>(null);
  const [equipped, setEquipped] = useState<EquippedCosmetics | null>(null);
  const [achievementCounts, setAchievementCounts] = useState<{ earned: number; total: number } | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (!isSupabaseConfigured || !user?.id) return;
      const userId = user.id;
      getMyHoundScore(userId)
        .then(setHoundScore)
        .catch(() => setHoundScore(null));
      getMyEquippedCosmetics(userId)
        .then(setEquipped)
        .catch(() => setEquipped(null));
      Promise.all([listAchievements(), listEarnedAchievements(userId)])
        .then(([all, mine]) => setAchievementCounts({ earned: all.filter((a) => mine.has(a.id)).length, total: all.length }))
        .catch(() => setAchievementCounts(null));
    }, [user?.id]),
  );

  const level = houndScore ? levelProgressForXp(houndScore.xpTotal) : null;
  const healthSource =
    health.platform === 'ios' ? 'Apple Health' : health.platform === 'android' ? 'Health Connect' : 'Sample data';

  const rows: { label: string; Icon: React.ComponentType<any>; detail?: string | null; onPress: () => void }[] = [
    {
      label: 'Goals',
      Icon: TargetIcon,
      detail: `${goals.length} ${goals.length === 1 ? 'goal' : 'goals'} · ${HOUND_LEVELS.find((l) => l.id === houndLevel)?.name ?? ''}`,
      onPress: onOpenGoals,
    },
    { label: 'Stats & records', Icon: ChartLineUpIcon, onPress: onOpenStats },
    {
      label: 'Achievements',
      Icon: TrophyIcon,
      detail: achievementCounts ? `${achievementCounts.earned} of ${achievementCounts.total}` : null,
      onPress: onOpenAchievements,
    },
    { label: 'Locker', Icon: CoatHangerIcon, detail: 'Frames, backgrounds, icons', onPress: onOpenLocker },
    { label: 'Kennel', Icon: DogIcon, detail: 'Your hound', onPress: onOpenKennel },
    { label: 'Health data', Icon: HeartbeatIcon, detail: healthSource, onPress: onOpenHealthData },
    { label: 'Settings', Icon: GearSixIcon, detail: 'Notifications, goals, account', onPress: onOpenSettings },
    { label: 'Help', Icon: QuestionIcon, onPress: onOpenHelp },
  ];

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.profileRow}>
        <Avatar
          initials={user?.initials ?? ''}
          tint={colors.accent800}
          size={56}
          fontSize={20}
          frameId={equipped?.frameId}
          backgroundId={equipped?.backgroundId}
          iconId={equipped?.iconId}
          level={level?.level}
        />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[text.h2, { fontSize: 24 }]} numberOfLines={1}>
            {user?.name ?? 'You'}
          </Text>
          {level && (
            <Text style={styles.levelLine}>
              Level {level.level} · <Text style={{ color: rankForLevel(level.level).color }}>{rankForLevel(level.level).name}</Text>
            </Text>
          )}
        </View>
      </View>

      {houndScore && level && (
        <Card style={{ gap: 12 }} elevated={false}>
          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>Hound Score</Text>
              <Text style={styles.statValue}>{houndScore.houndScore.toLocaleString()}</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>{currencyName}</Text>
              <View style={styles.bonesValue}>
                <BoneIcon size={16} color={color.accent} weight="fill" />
                <Text style={styles.statValue}>{houndScore.bonesBalance.toLocaleString()}</Text>
              </View>
            </View>
          </View>
          <View style={{ gap: 4 }}>
            <ProgressBar pct={level.pctToNextLevel} fillColor={color.accent} height={5} />
            <Text style={styles.footNote}>
              {level.xpIntoLevel.toLocaleString()} / {(level.xpIntoLevel + level.xpToNextLevel).toLocaleString()} XP to
              level {level.level + 1}
            </Text>
          </View>
        </Card>
      )}

      <Card style={{ paddingVertical: 4 }} elevated={false}>
        {rows.map(({ label, Icon, detail, onPress }, i) => (
          <Pressable
            key={label}
            style={({ pressed }) => [styles.row, i > 0 && styles.rowDivider, pressed && { opacity: 0.7 }]}
            onPress={onPress}
            accessibilityRole="button"
          >
            <View style={styles.rowIcon}>
              <Icon size={18} color={colors.accentActive} />
            </View>
            <Text style={styles.rowLabel}>{label}</Text>
            {detail ? (
              <Text style={styles.rowDetail} numberOfLines={1}>
                {detail}
              </Text>
            ) : (
              <View style={{ flex: 1 }} />
            )}
            <CaretRightIcon size={14} color={withAlpha(colors.text, 0.4)} />
          </Pressable>
        ))}
      </Card>
    </ScrollView>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    container: { padding: 16, gap: 16, paddingBottom: 32 },
    profileRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingTop: 4 },
    levelLine: { fontFamily: font.heading, fontSize: 13.5, color: colors.accentActive },
    statsRow: { flexDirection: 'row', gap: 12 },
    stat: { flex: 1, gap: 2 },
    statLabel: { fontSize: 12, letterSpacing: 0.4, color: withAlpha(colors.text, 0.55) },
    statValue: { fontFamily: font.headingSemibold, fontSize: 24, color: colors.text },
    bonesValue: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    footNote: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
    rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
    rowIcon: {
      width: 30,
      height: 30,
      borderRadius: 9,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: withAlpha(colors.accent, 0.14),
    },
    rowLabel: { fontFamily: font.heading, fontSize: 15, color: colors.text },
    rowDetail: { flex: 1, textAlign: 'right', fontSize: 13, color: withAlpha(colors.text, 0.55) },
  });
}
