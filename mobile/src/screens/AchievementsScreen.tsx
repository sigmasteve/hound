import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeftIcon, BoneIcon, CheckCircleIcon, ShareNetworkIcon } from 'phosphor-react-native';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { LoadingView } from '../components/LoadingView';
import { ProgressBar } from '../components/ProgressBar';
import { useTheme } from '../theme/ThemeContext';
import { color, font, withAlpha, type Palette } from '../theme/tokens';
import { useAuth } from '../auth/AuthContext';
import { useCurrencyName } from '../organizations/useCurrencyName';
import { achievementIcon } from '../achievements/achievementIcons';
import {
  FINISH_MILESTONES,
  getFinishProgress,
  listAchievements,
  listEarnedAchievements,
  type Achievement,
} from '../achievements/achievementsApi';
import { ShareSheet } from '../share/ShareSheet';
import type { ShareContent } from '../share/ShareCard';

function formatEarned(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function AchievementsScreen({ onBack }: { onBack: () => void }) {
  const { user } = useAuth();
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const currencyName = useCurrencyName();
  const [catalog, setCatalog] = useState<Achievement[] | null>(null);
  const [earned, setEarned] = useState<Map<string, string>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);
  // Finishes toward the milestone badges (0151), for "26 of 50".
  const [finishes, setFinishes] = useState<number | null>(null);
  // The badge being shared as a picture (K-06).
  const [sharing, setSharing] = useState<ShareContent | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!user?.id) return;
      Promise.all([listAchievements(), listEarnedAchievements(user.id)])
        .then(([all, mine]) => {
          setCatalog(all);
          setEarned(mine);
          setLoadError(null);
        })
        .catch((e) => setLoadError(e instanceof Error ? e.message : 'Could not load achievements.'));
      getFinishProgress().then(setFinishes);
    }, [user?.id]),
  );

  const earnedCount = catalog ? catalog.filter((a) => earned.has(a.id)).length : 0;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.container}>
        <Button label="Back" variant="ghost" small icon={<ArrowLeftIcon size={13} color={colors.accent} />} onPress={onBack} />
        <Text style={text.h2}>Achievements</Text>

        {loadError && <Text style={styles.errorNote}>{loadError}</Text>}

        {catalog === null ? (
          !loadError && <LoadingView />
        ) : (
          <>
            <Card style={{ gap: 8 }} elevated={false}>
              <Text style={styles.progressLabel}>
                {earnedCount} of {catalog.length} earned
              </Text>
              <ProgressBar pct={catalog.length ? (earnedCount / catalog.length) * 100 : 0} fillColor={color.gold} height={6} />
              <Text style={styles.footNote}>
                Each one pays {currencyName} once, the moment you earn it. Tap one you've earned to share it.
              </Text>
            </Card>

            <Card style={{ gap: 2 }} elevated={false}>
              {catalog.map((a, i) => {
                const earnedAt = earned.get(a.id);
                const Icon = achievementIcon(a.id);
                const target = FINISH_MILESTONES[a.id];
                const progress = !earnedAt && target && finishes !== null ? Math.min(finishes, target) : null;
                return (
                  <Pressable
                    key={a.id}
                    style={[styles.row, i > 0 && styles.rowDivider]}
                    disabled={!earnedAt}
                    onPress={() =>
                      earnedAt &&
                      setSharing({ kind: 'badge', id: a.id, name: a.name, description: a.description, earnedAt })
                    }
                    accessibilityRole={earnedAt ? 'button' : undefined}
                    accessibilityLabel={earnedAt ? `${a.name}, earned. Share it` : `${a.name}, not earned yet. ${a.description}`}
                  >
                    <View style={[styles.badge, earnedAt ? styles.badgeEarned : styles.badgeLocked]}>
                      <Icon size={20} color={earnedAt ? color.gold : withAlpha(colors.text, 0.35)} weight={earnedAt ? 'fill' : 'regular'} />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={[styles.name, !earnedAt && styles.nameLocked]}>{a.name}</Text>
                      <Text style={styles.description}>{a.description}</Text>
                      {progress !== null && (
                        <View style={{ gap: 4, marginTop: 4 }}>
                          <ProgressBar pct={(progress / target) * 100} fillColor={color.gold} height={4} />
                          <Text style={styles.progressText}>
                            {progress} of {target}. Counts challenges that ran 3 days or more, or had someone else in them.
                          </Text>
                        </View>
                      )}
                    </View>
                    {earnedAt ? (
                      <View style={{ alignItems: 'flex-end', gap: 4 }}>
                        <View style={styles.earnedTag}>
                          <CheckCircleIcon size={14} color={colors.green} weight="fill" />
                          <Text style={styles.earnedText}>{formatEarned(earnedAt)}</Text>
                        </View>
                        <View style={styles.earnedTag}>
                          <ShareNetworkIcon size={14} color={colors.accentActive} />
                          <Text style={[styles.earnedText, { color: colors.accentActive }]}>Share</Text>
                        </View>
                      </View>
                    ) : (
                      <View style={styles.rewardTag}>
                        <BoneIcon size={12} color={color.accent} weight="fill" />
                        <Text style={styles.rewardText}>+{a.bones}</Text>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </Card>
          </>
        )}
      </ScrollView>
      {sharing && <ShareSheet content={sharing} onClose={() => setSharing(null)} />}
    </SafeAreaView>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    container: { padding: 16, gap: 16, paddingBottom: 48 },
    errorNote: { fontSize: 12.5, color: colors.amber },
    footNote: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
    progressLabel: { fontSize: 15, fontFamily: font.heading, color: colors.text },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
    rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
    badge: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    badgeEarned: { backgroundColor: withAlpha(color.gold, 0.16), borderWidth: 1, borderColor: withAlpha(color.gold, 0.5) },
    badgeLocked: { borderWidth: 1, borderStyle: 'dashed', borderColor: withAlpha(colors.text, 0.2) },
    name: { fontSize: 14.5, color: colors.text, fontFamily: font.heading },
    nameLocked: { color: withAlpha(colors.text, 0.75) },
    description: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
    earnedTag: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    earnedText: { fontSize: 11.5, color: withAlpha(colors.text, 0.6) },
    rewardTag: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    progressText: { fontSize: 11.5, color: withAlpha(colors.text, 0.55) },
    rewardText: { fontSize: 12.5, color: withAlpha(colors.text, 0.7), fontFamily: font.heading },
  });
}
