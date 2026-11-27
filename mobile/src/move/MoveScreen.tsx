import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeftIcon, BarbellIcon, CheckSquareIcon, FootprintsIcon, PlayIcon, PlusIcon, SquareIcon, UsersThreeIcon } from 'phosphor-react-native';
import { Avatar } from '../components/Avatar';
import { FriendPickList } from '../components/FriendPickList';
import { supabaseFriendsProvider } from '../friends/supabaseFriends';
import type { Friend } from '../friends/types';
import { SNACK_WINDOWS, getMySnacks, setSnackSettings, startMovePack, type MySnacks, type SnackWindow } from './moveApi';
import { saveSnackNudges } from './snackNudges';
import { useAuth } from '../auth/AuthContext';
import { askForPush, getPushPermission } from '../notifications/pushPermission';
import { Text } from '../components/Text';
import { Button } from '../components/Button';
import { TileSheet } from '../home/TodayTiles';
import { useHealthProvider } from '../health/HealthContext';
import { LogWorkoutSheet } from '../workouts/LogWorkoutSheet';
import { invalidateLoggedSamples } from '../workouts/loggedWorkouts';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { ACTIVITY_LABEL, ROUTINES, TEMPLATES, fmtPts, isStrength, routineById, routineMinutes } from './move';
import { emptyMove, getMyMove, setStrengthTarget, type MoveItem, type MyMove } from './moveApi';
import { offlineEnabled } from '../offline/offlineConfig';
import { isNetworkError } from '../offline/network';
import { ActivityIcon, StrengthWeeks, activityColor } from './MoveParts';
import { OfflineStrip } from '../offline/OfflineStrip';
import { onSynced } from '../offline/outbox';

// Move (0270): today's Move points by where they came from (your phone's
// steps, workouts from a watch, logged by hand, timed in Hound), what's
// left of the 2 hours by hand, your strength goal, and the three ways in,
// pinned: Start a routine, Log strength, Log an activity.

// 'friends': picking who to move with (Move together, 0275); 'snacks':
// Movement snacks' settings.
type Sheet = null | 'routine' | 'strength' | 'goal' | 'friends' | 'snacks';

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
  onSnack,
  onOpenTogether,
  openLog = false,
}: {
  onBack: () => void;
  onStartRoutine: (routineId: string) => void;
  onStartStrength: (templateId: string) => void;
  // Movement snacks and Move together (0275).
  onSnack: () => void;
  onOpenTogether: (packId: string) => void;
  // Opened from a widget's "Log activity" (1.3.0): the log sheet first.
  openLog?: boolean;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const health = useHealthProvider();
  const { user } = useAuth();
  const [me, setMe] = useState<MyMove | null | undefined>(undefined);
  const [steps, setSteps] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Offline, with no copy of today's numbers kept yet.
  const [noCopy, setNoCopy] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [logOpen, setLogOpen] = useState(openLog);
  useEffect(() => {
    if (openLog) setLogOpen(true);
  }, [openLog]);
  const [goalPick, setGoalPick] = useState(2);
  const [saving, setSaving] = useState(false);
  // Movement snacks (0275): null before 0275 is run.
  const [snacks, setSnacks] = useState<MySnacks | null>(null);
  // Move together (0275): routines start with friends; which routine, and who.
  const [together, setTogether] = useState(false);
  const [togetherRoutine, setTogetherRoutine] = useState<string | null>(null);
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => {
    if (sheet === 'friends' && friends === null) {
      supabaseFriendsProvider
        .listFriends()
        .then((f) => setFriends(f.filter((x) => x.status === 'accepted')))
        .catch(() => setFriends([]));
    }
  }, [sheet, friends]);

  const saveSnacks = async (enabled: boolean, windows: SnackWindow[]) => {
    if (!snacks) return;
    const next = { ...snacks, enabled, windows };
    setSnacks(next);
    try {
      await setSnackSettings(enabled, windows);
      // Nudges are the phone's own notifications: ask once, when turning on.
      if (enabled && user?.id && (await getPushPermission().catch(() => null)) === 'undetermined') await askForPush(user.id).catch(() => {});
      await saveSnackNudges(next);
    } catch (e) {
      setSnacks(snacks);
      Alert.alert('Movement snacks', e instanceof Error ? e.message : 'Could not save that.');
    }
  };

  const startTogether = async () => {
    const r = togetherRoutine ? routineById(togetherRoutine) : undefined;
    if (!r || picked.length === 0) return;
    setSaving(true);
    try {
      const packId = await startMovePack(r.id, r.name, routineMinutes(r), picked);
      setSheet(null);
      setPicked([]);
      onOpenTogether(packId);
    } catch (e) {
      Alert.alert('Move together', e instanceof Error ? e.message : 'Could not start it.');
    } finally {
      setSaving(false);
    }
  };

  const load = useCallback(() => {
    getMyMove()
      .then((m) => {
        setMe(m);
        setNoCopy(false);
        setError(null);
      })
      .catch((e) => {
        // Offline with nothing kept from before (0271): open anyway, so you
        // can still start a routine, log strength or log an activity.
        if (offlineEnabled() && isNetworkError(e)) {
          setMe(emptyMove());
          setNoCopy(true);
          setError(null);
        } else setError(e instanceof Error ? e.message : 'Could not load Move.');
      });
    health
      .getSnapshot()
      .then((s) => setSteps(Math.round(s.stepsToday)))
      .catch(() => setSteps(null));
    getMySnacks()
      .then((m) => {
        setSnacks(m);
        if (m) saveSnackNudges(m).catch(() => {});
      })
      .catch(() => {});
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
        {noCopy && (
          <View style={styles.card}>
            <Text style={styles.strong}>No connection</Text>
            <Text style={styles.small}>
              Today’s Move points show once you’re back online. You can still start a routine, log strength or log an activity: they’re saved on
              your phone and sync later.
            </Text>
          </View>
        )}
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

            {snacks && (
              <View style={[styles.card, styles.snack]}>
                <Pressable style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }} onPress={() => setSheet('snacks')} accessibilityRole="button">
                  <FootprintsIcon size={22} color={colors.accentActive} weight="fill" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.strong}>Movement snacks</Text>
                    <Text style={styles.small} numberOfLines={1}>
                      {snacks.enabled && snacks.windows.length > 0
                        ? `${snacks.windows.map((w) => SNACK_WINDOWS.find((x) => x.id === w)?.label).join(', ')} · ${snacks.today.paid} of ${snacks.maxDay} today`
                        : `${snacks.steps} steps in ${snacks.minutes} min, +${snacks.bones} Bones · nudges off`}
                    </Text>
                  </View>
                </Pressable>
                <Button label="Take one" small variant="primary" onPress={onSnack} />
              </View>
            )}

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
                    <Text style={styles.small} numberOfLines={i.effort ? 2 : 1}>
                      {i.minutes} min · {itemTag(i)}
                      {i.prs > 0 ? ` · ${i.prs} new best` : ''}
                      {i.effort
                        ? ` · ${i.effort.walk} min walking (steps count), ${i.effort.hr} by heart rate`
                        : i.steps > 0
                          ? ` · ${fmtPts(i.steps)} steps already counted`
                          : ''}
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
          {/* Move together (0275): the same routine with friends. */}
          <View style={styles.tseg}>
            {[false, true].map((t) => (
              <Pressable
                key={String(t)}
                style={[styles.tsegBtn, together === t && styles.tsegOn]}
                onPress={() => setTogether(t)}
                accessibilityRole="button"
                accessibilityState={{ selected: together === t }}
              >
                {t && <UsersThreeIcon size={15} color={together ? '#fff' : colors.accentActive} weight="fill" />}
                <Text style={[styles.tsegText, together === t && { color: '#fff' }]}>{t ? 'With friends' : 'Just me'}</Text>
              </Pressable>
            ))}
          </View>
          {together && (
            <Text style={styles.small}>
              Pick a routine, then who. Each of you does it on your own phone; when everyone who joins finishes, you each get Bones.
            </Text>
          )}
          {ROUTINES.map((r) => (
            <Pressable
              key={r.id}
              style={styles.pick}
              onPress={() => {
                if (together) {
                  setTogetherRoutine(r.id);
                  setSheet('friends');
                  return;
                }
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
      {sheet === 'friends' && (
        <TileSheet title={`Move together: ${routineById(togetherRoutine ?? '')?.short ?? 'routine'}`} onClose={() => setSheet(null)}>
          <Text style={styles.small}>Friends get a notification and an hour to join. You can start as soon as you like.</Text>
          {friends === null ? (
            <ActivityIndicator color={colors.accent} />
          ) : friends.length === 0 ? (
            <Text style={styles.small}>Add friends to move together.</Text>
          ) : (
            <FriendPickList
              items={friends}
              pickedIds={picked}
              onUnpick={(id) => setPicked((p) => p.filter((x) => x !== id))}
              renderItem={(f) => {
                const on = picked.includes(f.userId);
                return (
                  <Pressable
                    style={styles.friend}
                    onPress={() => setPicked((p) => (on ? p.filter((x) => x !== f.userId) : p.length >= 10 ? p : [...p, f.userId]))}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                  >
                    {on ? <CheckSquareIcon size={22} color={colors.accentActive} weight="fill" /> : <SquareIcon size={22} color={withAlpha(colors.text, 0.4)} />}
                    <Avatar initials={f.initials} tint={colors.accent800} size={32} fontSize={12} frameId={f.frameId} backgroundId={f.backgroundId} iconId={f.iconId} />
                    <Text style={[styles.strong, { flex: 1 }]} numberOfLines={1}>
                      {f.name}
                    </Text>
                  </Pressable>
                );
              }}
            />
          )}
          <Button
            label={saving ? 'Inviting…' : picked.length ? `Invite ${picked.length} and open the lobby` : 'Pick friends to invite'}
            variant="primary"
            block
            disabled={saving || picked.length === 0}
            onPress={startTogether}
          />
        </TileSheet>
      )}
      {sheet === 'snacks' && snacks && (
        <TileSheet title="Movement snacks" onClose={() => setSheet(null)}>
          <Text style={styles.small}>
            A nudge now and then: {snacks.steps} steps in the next {snacks.minutes} minutes, counted by your phone. +{snacks.bones} Bones each, up to{' '}
            {snacks.maxDay} a day.
          </Text>
          <View style={styles.between}>
            <Text style={styles.strong}>Nudge me</Text>
            <Switch
              value={snacks.enabled}
              onValueChange={(v) => saveSnacks(v, v && snacks.windows.length === 0 ? ['midday', 'afternoon'] : snacks.windows)}
              trackColor={{ true: colors.accent }}
            />
          </View>
          {snacks.enabled && (
            <>
              <Text style={styles.label}>WHEN (ONE NUDGE IN EACH)</Text>
              <View style={styles.chips}>
                {SNACK_WINDOWS.map((w) => {
                  const on = snacks.windows.includes(w.id);
                  return (
                    <Pressable
                      key={w.id}
                      style={[styles.chip, on && styles.chipOn]}
                      onPress={() => saveSnacks(true, on ? snacks.windows.filter((x) => x !== w.id) : [...snacks.windows, w.id])}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                    >
                      <Text style={[styles.chipText, on && { color: '#fff' }]}>{w.label}</Text>
                      <Text style={[styles.chipSub, on && { color: 'rgba(255,255,255,0.8)' }]}>
                        {w.from > 12 ? w.from - 12 : w.from}–{w.to > 12 ? w.to - 12 : w.to}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}
          <Text style={styles.small}>
            Today: {snacks.today.done} done · {snacks.today.paid} of {snacks.maxDay} with Bones.
          </Text>
          <Button
            label="Take one now"
            variant="primary"
            block
            onPress={() => {
              setSheet(null);
              onSnack();
            }}
          />
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
    snack: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
    tseg: { flexDirection: 'row', borderRadius: 12, backgroundColor: withAlpha(colors.text, 0.06), padding: 3, gap: 3 },
    tsegBtn: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', borderRadius: 10, paddingVertical: 8 },
    tsegOn: { backgroundColor: colors.accent },
    tsegText: { fontSize: 13.5, fontFamily: font.headingSemibold, color: colors.accentActive },
    friend: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 50 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: withAlpha(colors.text, 0.06), alignItems: 'center' },
    chipOn: { backgroundColor: colors.accent },
    chipText: { fontSize: 13.5, fontFamily: font.headingSemibold, color: colors.text },
    chipSub: { fontSize: 11, color: withAlpha(colors.text, 0.55) },
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
