import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CheckCircleIcon } from 'phosphor-react-native';
import { Button } from '../components/Button';
import { ProgressBar } from '../components/ProgressBar';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { levelProgressForXp } from '../challenges/leveling';
import { rankForLevel } from '../challenges/ranks';
import { houndLadder, RANK_GAINS, XP_SOURCES } from '../challenges/ladder';
import { HoundArt } from './HoundArt';
import { getKennel, type Kennel } from './kennelApi';

// Your hound's ladder: where you are, how XP is earned, and every level
// ahead with what it brings, the hound drawn at each rank so you can see
// it grow. Opened from the level chip in the top bar (then "Open the
// Kennel" takes you there) and from the Kennel's "What's next". Fetches
// the Kennel itself unless the caller already has it.
export function HoundLadderSheet({
  kennel: given,
  onClose,
  onOpenKennel,
}: {
  kennel?: Kennel | null;
  onClose: () => void;
  onOpenKennel?: () => void;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [fetched, setFetched] = useState<Kennel | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (given) return;
    let cancelled = false;
    getKennel()
      .then((k) => {
        if (!cancelled) setFetched(k);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load your hound.');
      });
    return () => {
      cancelled = true;
    };
  }, [given]);

  const kennel = given ?? fetched;
  const ladder = useMemo(houndLadder, []);
  const progress = kennel ? levelProgressForXp(kennel.xpTotal) : null;
  const rank = progress ? rankForLevel(progress.level) : null;
  const next = progress ? ladder.find((s) => s.level > progress.level) ?? null : null;

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {!kennel || !progress || !rank ? (
            <View style={styles.loading}>
              {error ? <Text style={styles.note}>{error}</Text> : <ActivityIndicator color={colors.accent} />}
            </View>
          ) : (
            <>
              <View style={styles.header}>
                <HoundArt
                  rank={rank.id}
                  mood={kennel.mood}
                  neckId={kennel.neckId}
                  headId={kennel.headId}
                  faceId={kennel.faceId}
                  coatId={kennel.coatId}
                  ears={kennel.ears}
                  tail={kennel.tail}
                  markings={kennel.markings}
                  size={96}
                  animate={false}
                />
                <View style={styles.headerText}>
                  <Text style={text.eyebrow}>YOUR HOUND</Text>
                  <Text style={styles.title}>
                    Level {progress.level} · <Text style={{ color: rank.color }}>{rank.name}</Text>
                  </Text>
                  <ProgressBar pct={progress.pctToNextLevel} fillColor={rank.color} height={6} />
                  <Text style={styles.note}>
                    {progress.xpToNextLevel.toLocaleString('en-US')} XP to level {progress.level + 1}
                    {next ? ` · ${(next.xp - kennel.xpTotal).toLocaleString('en-US')} to ${next.rank ? next.rank.name : next.unlocks[0]}` : ''}
                  </Text>
                </View>
              </View>
              <Text style={styles.earn}>{XP_SOURCES}</Text>

              <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
                {ladder.map((step) => {
                  const reached = progress.level >= step.level;
                  const isNext = next?.level === step.level;
                  const stepRank = rankForLevel(step.level);
                  return (
                    <View key={step.level} style={[styles.row, isNext && styles.rowNext]}>
                      <View style={styles.rowArt}>
                        <HoundArt
                          rank={stepRank.id}
                          mood="happy"
                          coatId={kennel.coatId}
                          ears={kennel.ears}
                          tail={kennel.tail}
                          markings={kennel.markings}
                          size={44}
                          animate={false}
                        />
                      </View>
                      <View style={styles.rowText}>
                        <View style={styles.rowTitle}>
                          <Text style={[styles.level, reached && styles.reached]}>Level {step.level}</Text>
                          {step.rank && (
                            <View style={[styles.rankChip, { backgroundColor: withAlpha(step.rank.color, 0.18) }]}>
                              <Text style={[styles.rankText, { color: step.rank.color }]}>{step.rank.name}</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.unlocks}>
                          {[step.rank ? `Your hound ${RANK_GAINS[step.rank.id]}` : null, ...step.unlocks]
                            .filter(Boolean)
                            .join(' · ')}
                        </Text>
                      </View>
                      <View style={styles.rowRight}>
                        {reached ? (
                          <CheckCircleIcon size={20} color={colors.green} weight="fill" />
                        ) : (
                          <Text style={[styles.xp, isNext && { color: colors.accent }]}>
                            {isNext
                              ? `${(step.xp - kennel.xpTotal).toLocaleString('en-US')} to go`
                              : `${step.xp.toLocaleString('en-US')} XP`}
                          </Text>
                        )}
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
            </>
          )}

          <View style={styles.buttons}>
            {onOpenKennel && <Button label="Open the Kennel" variant="primary" onPress={onOpenKennel} />}
            <Button label="Close" variant="ghost" onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16,
    },
    card: {
      width: '100%',
      maxWidth: 400,
      maxHeight: '88%',
      gap: 10,
      padding: 18,
      borderRadius: 16,
      backgroundColor: colors.surface,
    },
    loading: { paddingVertical: 32, alignItems: 'center' },
    header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    headerText: { flex: 1, gap: 6 },
    title: { fontFamily: font.heading, fontSize: 20, color: colors.text },
    note: { fontSize: 12.5, color: withAlpha(colors.text, 0.65) },
    earn: { fontSize: 12, color: withAlpha(colors.text, 0.55), textAlign: 'center' },
    list: { flexGrow: 0 },
    listContent: { gap: 2, paddingVertical: 4 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 6,
      paddingHorizontal: 8,
      borderRadius: 12,
    },
    rowNext: { backgroundColor: withAlpha(colors.accent, 0.1) },
    rowArt: { width: 44, height: 53, alignItems: 'center', justifyContent: 'flex-end' },
    rowText: { flex: 1, gap: 2 },
    rowTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    level: { fontFamily: font.headingSemibold, fontSize: 14, color: colors.text },
    reached: { color: withAlpha(colors.text, 0.55) },
    rankChip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
    rankText: { fontFamily: font.headingSemibold, fontSize: 11.5 },
    unlocks: { fontSize: 12.5, color: withAlpha(colors.text, 0.7) },
    rowRight: { minWidth: 64, alignItems: 'flex-end' },
    xp: { fontFamily: font.body, fontSize: 12, color: withAlpha(colors.text, 0.55) },
    buttons: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingTop: 4 },
  });
}
