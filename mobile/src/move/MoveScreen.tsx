import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeftIcon, BarbellIcon, PlayIcon, PlusIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { Button } from '../components/Button';
import { TileSheet } from '../home/TodayTiles';
import { useHealthProvider } from '../health/HealthContext';
import { LogWorkoutSheet } from '../workouts/LogWorkoutSheet';
import { invalidateLoggedSamples } from '../workouts/loggedWorkouts';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { ACTIVITY_LABEL, ROUTINES, TEMPLATES, fmtPts, isStrength, routineById, routineMinutes } from './move';
import { getMyMove, setStrengthTarget, type MoveItem, type MyMove } from './moveApi';
import { ActivityIcon, StrengthWeeks, activityColor } from './MoveParts';
import { OfflineStrip } from '../offline/OfflineStrip';
import { onSynced } from '../offline/outbox';

// Move (0270): today's Move points by where they came from (your phone's
// steps, workouts from a watch, logged by hand, timed in Hound), what's
// left of the 2 hours by hand, your strength goal, and the three ways in,
// pinned: Start a routine, Log strength, Log an activity.

type Sheet = null | 'routine' | 'strength' | 'goal';

const GOAL_NOTES: Record<number, string> = {
  1: 'One strength session a week. Every bit counts.',
  2: 'A good start: two days of strength, with rest between.',
  3: 'The usual advice for steady progress.',
  4: 'Four a week: split the body across days.',
  5: 'Five a week: keep the hard days apart.',
};

function itemTag(i: MoveItem): string {
  switch (i.kind) {
    case 'hound':
      return '✓ Timed';
    case 'hand':
      return i.countedMin < i.minutes ? `Logged by hand · ${i.countedMin} of ${i.minutes} min count` : 'Logged by hand';
    case 'covered':
      return 'Your watch counted this one';
    default:
      return 'From your watch or Health';
  }
}

export function MoveScreen({
  onBack,
  onStartRoutine,
  onStartStrength,
}: {
  onBack: () => void;
  onStartRoutine: (routineId: string) => void;
  onStartStrength: (templateId: string) => void;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const health = useHealthProvider();
  const [me, setMe] = useState<MyMove | null | undefined>(undefined);
  const [steps, setSteps] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [goalPick, setGoalPick] = useState(2);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    getMyMove()
      .then((m) => {
        setMe(m);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load Move.'));
    health
      .getSnapshot()
      .then((s) => setSteps(Math.round(s.stepsToday)))
      .catch(() => setSteps(null));
  }, [health]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  // Something saved offline just synced (0271): show the real numbers.
  useEffect(() => onSynced(() => load()), [load]);

  const items = (me?.items ?? []).filter((i) => i.activity !== 'steps' || i.pts > 0);
  const strengthPts = items.filter((i) => isStrength(i.activity)).reduce((a, i) => a + i.pts, 0);
  const otherPts = (me?.pts ?? 0) - strengthPts;
  const total = (steps ?? 0) + (me?.pts ?? 0);
  const parts = [
    { label: 'Steps', value: steps ?? 0, color: activityColor('steps', colors) },
    { label: 'Strength', value: strengthPts, color: colors.accent },
    { label: 'Other activity', value: otherPts, color: colors.amber },
  ].filter((p) => p.value > 0);
  const g = me?.strength;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.top}>
        <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <ArrowLeftIcon size={20} color={colors.accentActive} />
        </Pressable>
        <Text style={[text.h4, { flex: 1, textAlign: 'center' }]}>Move</Text>
        <View style={{ width: 20 }} />
      </View>
      <OfflineStrip cacheKeys={['move:my', 'move:rates']} />
      <ScrollView contentContainerStyle={styles.body}>
        {me === undefined && !error && <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />}
        {error && <Text style={styles.small}>{error}</Text>}
        {me === null && (
          <View style={styles.card}>
            <Text style={styles.strong}>Move points are on their way</Text>
            <Text style={styles.small}>Routines, strength logs and Move points open once Hound’s server is updated.</Text>
          </View>
        )}
        {me && (
          <>
            <View style={styles.card}>
              <View style={styles.between}>
                <Text style={styles.label}>TODAY</Text>
                {g && (
                  <Text style={[styles.small, { color: colors.amber, fontFamily: font.headingSemibold }]}>
                    🔥 {g.thisWeek} of {g.target} strength this week
                  </Text>
                )}
              </View>
              <Text style={styles.big}>
                {fmtPts(total)} <Text style={styles.bigUnit}>Move points</Text>
              </Text>
              {total > 0 && (
                <>
                  <View style={styles.stack}>
                    {parts.map((p) => (
                      <View key={p.label} style={{ flex: p.value, backgroundColor: p.color }} />
                    ))}
                  </View>
                  <View style={styles.key}>
                    {parts.map((p) => (
                      <View key={p.label} style={styles.keyItem}>
                        <View style={[styles.keyDot, { backgroundColor: p.color }]} />
                        <Text style={styles.small}>
                          {p.label} {fmtPts(p.value)}
                        </Text>
                      </View>
                    ))}
                  </View>
                </>
              )}
            </View>

            <View style={[styles.card, { paddingVertical: 4 }]}>
              <View style={styles.row}>
                <ActivityIcon activity="steps" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.strong}>Steps</Text>
                  <Text style={styles.small}>{steps === null ? 'Health isn’t connected' : 'From your phone or watch'}</Text>
                </View>
                <Text style={styles.pts}>{steps === null ? '—' : fmtPts(steps)}</Text>
              </View>
              {items.map((i) => (
                <View key={i.sourceId} style={styles.row}>
                  <ActivityIcon activity={i.activity} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.strong} numberOfLines={1}>
                      {i.ref ? (routineById(i.ref)?.name ?? TEMPLATES.find((t) => t.id === i.ref)?.name ?? ACTIVITY_LABEL[i.activity]) : (ACTIVITY_LABEL[i.activity] ?? i.name)}
                    </Text>
                    <Text style={styles.small} numberOfLines={1}>
                      {i.minutes} min · {itemTag(i)}
                      {i.prs > 0 ? ` · ${i.prs} new best` : ''}
                    </Text>
                  </View>
                  <Text style={styles.pts}>{fmtPts(i.pts)}</Text>
                </View>
              ))}
              {items.length === 0 && <Text style={[styles.small, { paddingVertical: 10 }]}>No workouts yet today. Start a routine or log one below.</Text>}
            </View>

            <View style={{ gap: 4, paddingHorizontal: 4 }}>
              <Text style={styles.small}>
                Logged by hand today: {Math.min(me.handMin, me.handCapMin)} of {me.handCapMin} min count
              </Text>
              <View style={styles.bar}>
                <View style={{ width: `${Math.min(100, (me.handMin / Math.max(me.handCapMin, 1)) * 100)}%`, backgroundColor: colors.amber, borderRadius: 4 }} />
              </View>
            </View>

            {g && (
              <Pressable
                style={styles.card}
                onPress={() => {
                  setGoalPick(g.target);
                  setSheet('goal');
                }}
                accessibilityRole="button"
              >
                <View style={styles.between}>
                  <Text style={styles.strong}>Your strength goal</Text>
                  <Text style={styles.link}>{g.target} a week ›</Text>
                </View>
                <StrengthWeeks goal={g} />
                <Text style={styles.small}>
                  {g.streak > 0 ? `Week streak: ${g.streak}. ` : ''}
                  {g.thisWeek >= g.target ? 'This week’s done. ' : `${g.target - g.thisWeek} to go this week. `}A week counts when you reach your goal.
                </Text>
              </Pressable>
            )}
            <Text style={[styles.small, { paddingHorizontal: 4 }]}>
              Workouts earn points by how hard they are (Help explains). Walks and runs earn their steps. Timed in Hound, or from a watch, counts in full; by hand, up to {me.handCapMin} minutes a day.
            </Text>
          </>
        )}
      </ScrollView>
      {me && (
        <View style={styles.pinned}>
          <Pressable style={styles.act} onPress={() => setSheet('routine')} accessibilityRole="button">
            <PlayIcon size={20} color={colors.accentActive} weight="fill" />
            <Text style={styles.actText}>Start a routine</Text>
          </Pressable>
          <Pressable style={styles.act} onPress={() => setSheet('strength')} accessibilityRole="button">
            <BarbellIcon size={20} color={colors.accentActive} weight="bold" />
            <Text style={styles.actText}>Log strength</Text>
          </Pressable>
          <Pressable style={styles.act} onPress={() => setLogOpen(true)} accessibilityRole="button">
            <PlusIcon size={20} color={colors.accentActive} weight="bold" />
            <Text style={styles.actText}>Log an activity</Text>
          </Pressable>
        </View>
      )}

      {sheet === 'routine' && (
        <TileSheet title="Start a routine" onClose={() => setSheet(null)}>
          {ROUTINES.map((r) => (
            <Pressable
              key={r.id}
              style={styles.pick}
              onPress={() => {
                setSheet(null);
                onStartRoutine(r.id);
              }}
              accessibilityRole="button"
            >
              <ActivityIcon activity={r.id.startsWith('stretch') ? 'stretching' : 'strength_light'} size={38} />
              <View style={{ flex: 1 }}>
                <Text style={styles.strong}>{r.name}</Text>
                <Text style={styles.small}>
                  {r.gear} · {r.moves.length} moves{r.rounds > 1 ? ` × ${r.rounds}` : ''} · {r.workSec} s on, {r.restSec} s rest
                </Text>
              </View>
              <Text style={styles.small}>{routineMinutes(r)} min</Text>
            </Pressable>
          ))}
          <Text style={styles.small}>Hound times it, so it counts in full: ✓ Timed.</Text>
        </TileSheet>
      )}
      {sheet === 'strength' && (
        <TileSheet title="Log strength" onClose={() => setSheet(null)}>
          {TEMPLATES.map((t) => (
            <Pressable
              key={t.id}
              style={styles.pick}
              onPress={() => {
                setSheet(null);
                onStartStrength(t.id);
              }}
              accessibilityRole="button"
            >
              <ActivityIcon activity="strength_light" size={38} />
              <View style={{ flex: 1 }}>
                <Text style={styles.strong}>{t.name}</Text>
                <Text style={styles.small} numberOfLines={1}>
                  {t.exercises.length ? t.exercises.join(', ') : 'Add your own exercises'}
                </Text>
              </View>
            </Pressable>
          ))}
          <Text style={styles.small}>It times you while it’s open. Tick sets as you go; weights are optional.</Text>
        </TileSheet>
      )}
      {sheet === 'goal' && (
        <TileSheet title="Your strength goal" onClose={() => setSheet(null)}>
          <Text style={styles.label}>STRENGTH SESSIONS A WEEK</Text>
          <Text style={[styles.big, { textAlign: 'center', fontSize: 52, lineHeight: 58 }]}>{goalPick}</Text>
          <Text style={[styles.small, { textAlign: 'center' }]}>{GOAL_NOTES[goalPick]}</Text>
          <View style={styles.seg}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable
                key={n}
                onPress={() => setGoalPick(n)}
                style={[styles.segBtn, goalPick === n && styles.segOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: goalPick === n }}
              >
                <Text style={[styles.segText, goalPick === n && { color: colors.text }]}>{n}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.small}>A routine, a strength log, or strength from your watch or logged by hand. One a day counts toward the week.</Text>
          <Button
            label={saving ? 'Saving…' : 'Save'}
            variant="primary"
            block
            disabled={saving}
            onPress={async () => {
              setSaving(true);
              try {
                const s = await setStrengthTarget(goalPick);
                setMe((m) => (m ? { ...m, strength: s } : m));
                setSheet(null);
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Could not save.');
              } finally {
                setSaving(false);
              }
            }}
          />
        </TileSheet>
      )}
      <LogWorkoutSheet
        visible={logOpen}
        onClose={() => setLogOpen(false)}
        onChanged={() => {
          invalidateLoggedSamples();
          load();
        }}
      />
    </SafeAreaView>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, gap: 12 },
    body: { padding: 16, gap: 12, paddingBottom: 24 },
    card: { borderRadius: 16, backgroundColor: colors.surface, padding: 12, gap: 6 },
    between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 9,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: withAlpha(colors.text, 0.08),
    },
    label: { fontSize: 11, letterSpacing: 0.7, color: withAlpha(colors.text, 0.55), fontFamily: font.headingSemibold },
    big: { fontSize: 34, lineHeight: 40, fontFamily: font.headingSemibold, color: colors.text, fontVariant: ['tabular-nums'] },
    bigUnit: { fontSize: 14, fontFamily: font.body, color: withAlpha(colors.text, 0.6) },
    stack: { flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden', backgroundColor: withAlpha(colors.text, 0.06), gap: 2 },
    key: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    keyItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    keyDot: { width: 8, height: 8, borderRadius: 2 },
    strong: { fontSize: 14.5, fontFamily: font.headingSemibold, color: colors.text },
    small: { fontSize: 12.5, lineHeight: 17, color: withAlpha(colors.text, 0.6) },
    pts: { fontSize: 15, fontFamily: font.headingSemibold, color: colors.text, fontVariant: ['tabular-nums'] },
    bar: { height: 8, borderRadius: 4, backgroundColor: withAlpha(colors.text, 0.08), overflow: 'hidden', flexDirection: 'row' },
    link: { fontSize: 13.5, fontFamily: font.headingSemibold, color: colors.accentActive },
    pinned: {
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: withAlpha(colors.text, 0.1),
    },
    act: { flex: 1, minHeight: 64, borderRadius: 14, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', gap: 4, padding: 6 },
    actText: { fontSize: 12.5, fontFamily: font.headingSemibold, color: colors.text, textAlign: 'center' },
    pick: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: withAlpha(colors.text, 0.08),
    },
    seg: { flexDirection: 'row', backgroundColor: withAlpha(colors.text, 0.06), borderRadius: 12, padding: 4, gap: 4 },
    segBtn: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center' },
    segOn: { backgroundColor: colors.surface },
    segText: { fontSize: 15, fontFamily: font.headingSemibold, color: withAlpha(colors.text, 0.55) },
  });
}
