import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeftIcon,
  BellIcon,
  BellSlashIcon,
  BoneIcon,
  LightningIcon,
  ListNumbersIcon,
  MapTrifoldIcon,
  PuzzlePieceIcon,
} from 'phosphor-react-native';
import { Text } from '../components/Text';
import { Button } from '../components/Button';
import { Avatar } from '../components/Avatar';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { useHealthProvider } from '../health/HealthContext';
import {
  answerTrail,
  cheer,
  clock,
  endPackFun,
  findBone,
  getPackFun,
  isLive,
  joinPackFun,
  mutePackFun,
  pingPackFun,
  startFlash,
  type PackFunMember,
  type PackFunState,
} from './packFunApi';
import {
  askLocation,
  currentSpot,
  hasLiveFeatures,
  isSharingInBackground,
  metres,
  pedometerStepsSince,
  startBackgroundSharing,
  stopBackgroundSharing,
  watchLiveSteps,
} from './packFunSensors';
import { PackFunMap, packCentre } from './PackFunMap';

// A Pack Fun (0192): the live board, the scent trail, flash challenges,
// cheers, the map, and the recap once it's over.

const TICK_MS = 10_000;
const CHEERS: { kind: 'go' | 'wait' | 'water' | 'nice'; label: string; said: string }[] = [
  { kind: 'go', label: '🐾 Let’s go', said: 'Let’s go!' },
  { kind: 'wait', label: '✋ Wait up', said: 'Wait up!' },
  { kind: 'water', label: '💧 Water', said: 'Water break' },
  { kind: 'nice', label: '🙌 Nice', said: 'Nice!' },
];

function ago(iso: string | null, now: number): string {
  if (!iso) return 'not yet';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} hr ago`;
}

export function PackFunScreen({ packId, myId, onBack }: { packId: string; myId: string; onBack: () => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const health = useHealthProvider();
  const [state, setState] = useState<PackFunState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [tab, setTab] = useState<'board' | 'map'>('board');
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  const [sharing, setSharing] = useState(false);
  const [flashOpen, setFlashOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Steps: the best of the motion chip (iPhone) and Health + the live counter.
  const healthBase = useRef<number | null>(null);
  const liveDelta = useRef(0);
  const myBest = useRef(0);
  const locAsked = useRef(false);

  const live = state ? isLive(state, now) : false;
  const mine = state?.members.find((m) => m.userId === myId) ?? null;

  const say = (t: string) => {
    setToast(t);
    setTimeout(() => setToast((x) => (x === t ? null : x)), 3500);
  };

  const measureSteps = useCallback(
    async (s: PackFunState): Promise<number> => {
      const start = new Date(s.startsAt);
      const chip = await pedometerStepsSince(start);
      if (healthBase.current === null) {
        healthBase.current = await health.getStepsSince(start).catch(() => 0);
        liveDelta.current = 0;
      }
      const best = Math.max(chip ?? 0, (healthBase.current ?? 0) + liveDelta.current, myBest.current);
      myBest.current = best;
      return best;
    },
    [health],
  );

  const tick = useCallback(async () => {
    setNow(Date.now());
    try {
      const s = state ?? (await getPackFun(packId));
      if (s.joined && isLive(s)) {
        let spot: { lat: number; lng: number } | null = null;
        if (s.mapOn && hasLiveFeatures()) {
          if (!locAsked.current) {
            locAsked.current = true;
            await askLocation();
          }
          spot = await currentSpot();
          setMe(spot);
        }
        const steps = await measureSteps(s);
        setState(await pingPackFun(packId, steps, AppState.currentState === 'active', spot));
      } else {
        setState(await getPackFun(packId));
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t reach Hound.');
    }
  }, [packId, state, measureSteps]);

  // One timer while the screen is focused; the ref keeps it on the latest tick.
  const tickRef = useRef(tick);
  tickRef.current = tick;
  useFocusEffect(
    useCallback(() => {
      tickRef.current();
      const t = setInterval(() => tickRef.current(), TICK_MS);
      const clockT = setInterval(() => setNow(Date.now()), 1000);
      return () => {
        clearInterval(t);
        clearInterval(clockT);
      };
    }, []),
  );

  // The live step counter while the screen's open.
  useEffect(() => {
    if (!state?.joined || !live) return;
    return watchLiveSteps((n) => {
      liveDelta.current = n;
    });
  }, [state?.joined, live]);

  // Background sharing: on while a map Pack Fun is live and you're in it.
  useEffect(() => {
    if (!state) return;
    let cancelled = false;
    (async () => {
      if (state.settled || (state.joined && !live && new Date(state.endsAt).getTime() <= Date.now())) {
        if (await isSharingInBackground()) await stopBackgroundSharing();
        if (!cancelled) setSharing(false);
        return;
      }
      if (state.mapOn && state.joined && live && hasLiveFeatures()) {
        const on = await isSharingInBackground();
        if (!cancelled) setSharing(on);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state?.settled, state?.joined, state?.mapOn, live, state?.endsAt, state]);

  const shareSpot = async () => {
    if (!state) return;
    if (sharing) {
      await stopBackgroundSharing();
      setSharing(false);
      return;
    }
    if (!(await askLocation())) {
      Alert.alert('Pack Fun', 'Allow location for Hound in Settings to share your spot with the pack.');
      return;
    }
    const ok = await startBackgroundSharing({ id: state.id, startsAt: state.startsAt, endsAt: state.endsAt, steps: myBest.current });
    setSharing(ok);
    if (!ok) say('Your spot updates while Pack Fun is open.');
  };

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      Alert.alert('Pack Fun', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!state) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <TopBar onBack={onBack} colors={colors} styles={styles} />
        <View style={styles.center}>
          {error ? <Text style={styles.note}>{error}</Text> : <ActivityIndicator color={colors.accent} />}
        </View>
      </SafeAreaView>
    );
  }

  const start = new Date(state.startsAt).getTime();
  const end = new Date(state.endsAt).getTime();
  const upcoming = !state.settled && now < start;
  const over = state.settled || now >= end;
  const nameOf = (id: string | null) => (id === myId ? 'You' : (state.members.find((m) => m.userId === id)?.name ?? 'Someone'));
  const joined = state.members.filter((m) => m.joined);
  const board = [...joined].sort((a, b) => b.steps - a.steps);
  const prev = state.nextTrailAt - state.trailEvery;
  const toNext = state.trailEvery > 0 ? Math.min(1, Math.max(0, (state.packSteps - prev) / state.trailEvery)) : 0;
  const centre = packCentre(state.members);
  const strays = centre ? joined.filter((m) => m.lat != null && m.lng != null && metres(centre, { lat: m.lat as number, lng: m.lng as number }) > 400) : [];
  const nearBone = me ? state.mapBones.find((b) => metres(me, b) <= 40) : undefined;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <TopBar
        onBack={onBack}
        colors={colors}
        styles={styles}
        right={
          state.joined && !over ? (
            <Pressable
              onPress={() => run(async () => {
                await mutePackFun(state.id, !state.muted);
                setState({ ...state, muted: !state.muted });
              })}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={state.muted ? 'Turn Pack Fun alerts on' : 'Mute Pack Fun alerts'}
            >
              {state.muted ? <BellSlashIcon size={22} color={colors.text} /> : <BellIcon size={22} color={colors.text} />}
            </Pressable>
          ) : null
        }
      />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Text style={text.h2} numberOfLines={2}>
              {state.name}
            </Text>
            <Text style={styles.note}>
              {over ? 'Finished' : upcoming ? `Starts in ${clock(start - now)}` : `${clock(end - now)} left`} · {joined.length}{' '}
              {joined.length === 1 ? 'in the pack' : 'in the pack'}
            </Text>
          </View>
          {live && (
            <View style={styles.livePill}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>LIVE</Text>
            </View>
          )}
        </View>

        {!state.joined && !over && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>You’re invited</Text>
            <Text style={styles.note}>
              Join to put your steps on the board, solve scent trails and race in flash challenges.
              {state.mapOn ? ' This one has a live map: your spot is shared with the pack only, until it ends.' : ''}
            </Text>
            <Button label={busy ? 'Joining…' : 'Join the pack'} variant="primary" block onPress={() => run(async () => {
              await joinPackFun(state.id);
              setState(await getPackFun(state.id));
            })} />
          </View>
        )}

        {over ? (
          <Recap state={state} board={board} myId={myId} styles={styles} colors={colors} />
        ) : (
          <>
            {/* Pack steps and the next scent trail. */}
            <View style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.big}>{state.packSteps.toLocaleString()}</Text>
                {joined.length >= 2 && <Text style={styles.badge}>Pack together</Text>}
              </View>
              <Text style={styles.small}>pack steps{mine?.joined ? ` · you ${Math.max(mine.steps, myBest.current).toLocaleString()}` : ''}</Text>
              {state.trailsOn && (
                <>
                  <View style={styles.bar}>
                    <View style={[styles.barFill, { width: `${Math.round(toNext * 100)}%` }]} />
                  </View>
                  <Text style={styles.small}>
                    Next scent trail at {state.nextTrailAt.toLocaleString()} pack steps
                  </Text>
                </>
              )}
              {state.joined && joined.length < 2 && (
                <Text style={styles.small}>Bones start once a second person joins.</Text>
              )}
            </View>

            {state.trail && state.joined && (
              <TrailCard
                state={state}
                now={now}
                nameOf={nameOf}
                styles={styles}
                colors={colors}
                onAnswer={(i) =>
                  run(async () => {
                    const r = await answerTrail(state.trail!.id, i);
                    say(r.correct ? (r.bones ? `Right! +${r.bones} Bones` : 'Right!') : 'Not that one');
                    setState(await getPackFun(state.id));
                  })
                }
              />
            )}

            {state.flashOn && state.joined && (
              <FlashCard
                state={state}
                now={now}
                myId={myId}
                nameOf={nameOf}
                open={flashOpen}
                setOpen={setFlashOpen}
                styles={styles}
                colors={colors}
                live={live}
                onStart={(kind, minutes, target) =>
                  run(async () => {
                    await startFlash(state.id, kind, minutes, target);
                    setFlashOpen(false);
                    setState(await getPackFun(state.id));
                  })
                }
              />
            )}

            {state.joined && live && (
              <View style={styles.cheerRow}>
                {CHEERS.map((c) => (
                  <Pressable
                    key={c.kind}
                    style={styles.cheer}
                    onPress={() => run(async () => {
                      await cheer(state.id, c.kind);
                      say('Sent to the pack');
                      setState(await getPackFun(state.id));
                    })}
                    accessibilityRole="button"
                  >
                    <Text style={styles.cheerText}>{c.label}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            {state.cheers.slice(0, 3).map((c, i) => (
              <Text key={`${c.userId}${c.at}${i}`} style={styles.small}>
                {nameOf(c.userId)}: {CHEERS.find((x) => x.kind === c.kind)?.said} · {ago(c.at, now)}
              </Text>
            ))}

            {state.mapOn && (
              <View style={styles.tabs}>
                <TabButton on={tab === 'board'} label="Board" icon={<ListNumbersIcon size={18} color={colors.text} />} onPress={() => setTab('board')} styles={styles} />
                <TabButton on={tab === 'map'} label="Map" icon={<MapTrifoldIcon size={18} color={colors.text} />} onPress={() => setTab('map')} styles={styles} />
              </View>
            )}

            {tab === 'map' && state.mapOn ? (
              <View style={{ gap: 10 }}>
                {strays.length > 0 && (
                  <View style={styles.regroup}>
                    <Text style={styles.regroupText}>
                      {strays.map((m) => nameOf(m.userId)).join(', ')} {strays.length === 1 ? 'is' : 'are'} drifting from the pack. Regroup?
                    </Text>
                  </View>
                )}
                <PackFunMap members={state.members} bones={state.mapBones} me={me} myId={myId} />
                {nearBone && (
                  <Button
                    label={`Pick up the bone (+${state.bones.boneFind})`}
                    variant="primary"
                    block
                    onPress={() => run(async () => {
                      const got = await findBone(nearBone.id, me!);
                      say(got ? `+${got} Bones` : 'Found it! (You’re at today’s Pack Fun cap)');
                      setState(await getPackFun(state.id));
                    })}
                  />
                )}
                <Text style={styles.small}>
                  {state.mapBones.length
                    ? `Walk to a bone to pick it up: ${state.bones.boneFind} Bones each.`
                    : 'Bones turn up near the pack as you walk.'}
                </Text>
                {state.joined && live && hasLiveFeatures() && (
                  <Button
                    label={sharing ? 'Stop sharing my spot in the background' : 'Keep sharing my spot when Hound’s closed'}
                    variant="secondary"
                    block
                    onPress={shareSpot}
                  />
                )}
              </View>
            ) : (
              <View style={styles.card}>
                {board.map((m, i) => (
                  <MemberRow key={m.userId} m={m} rank={i + 1} me={m.userId === myId} now={now} colors={colors} styles={styles} />
                ))}
                {state.members.filter((m) => !m.joined).length > 0 && (
                  <Text style={styles.small}>
                    Invited: {state.members.filter((m) => !m.joined).map((m) => m.name.split(' ')[0]).join(', ')}
                  </Text>
                )}
              </View>
            )}

            <Text style={styles.small}>
              Bones: first right answer {state.bones.trailFirst}, then {state.bones.trailAnswer} · flash win {state.bones.flashWin} · pack
              push {state.bones.pushBonus} each · finishing {state.bones.finish}. You’ve earned {state.myBones} here.
            </Text>

            {state.createdBy === myId && (
              <Button
                label="End it now"
                variant="secondary"
                block
                onPress={() =>
                  Alert.alert('End Pack Fun?', 'This finishes it for everyone and hands out the finish Bones.', [
                    { text: 'Keep going', style: 'cancel' },
                    {
                      text: 'End it',
                      style: 'destructive',
                      onPress: () => run(async () => {
                        await endPackFun(state.id);
                        await stopBackgroundSharing();
                        setState(await getPackFun(state.id));
                      }),
                    },
                  ])
                }
              />
            )}
          </>
        )}
        {error && <Text style={styles.small}>{error}</Text>}
      </ScrollView>
      {toast && (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function TopBar({ onBack, colors, styles, right }: { onBack: () => void; colors: Palette; styles: Styles; right?: React.ReactNode }) {
  return (
    <View style={styles.top}>
      <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
        <ArrowLeftIcon size={20} color={colors.accentActive} />
      </Pressable>
      {right}
    </View>
  );
}

function TabButton({ on, label, icon, onPress, styles }: { on: boolean; label: string; icon: React.ReactNode; onPress: () => void; styles: Styles }) {
  return (
    <Pressable onPress={onPress} style={[styles.tab, on && styles.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: on }}>
      {icon}
      <Text style={styles.tabText}>{label}</Text>
    </Pressable>
  );
}

function MemberRow({ m, rank, me, now, colors, styles, recap }: { m: PackFunMember; rank: number; me: boolean; now: number; colors: Palette; styles: Styles; recap?: boolean }) {
  return (
    <View style={styles.member}>
      <Text style={styles.rank}>{rank}</Text>
      <Avatar initials={m.initials} tint={colors.accent800} size={36} fontSize={12} iconId={m.iconId} frameId={m.frameId} backgroundId={m.backgroundId} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowText, me && { fontFamily: font.headingSemibold }]}>{me ? 'You' : m.name}</Text>
        <Text style={styles.small}>{recap ? `${m.bones} Bones` : m.live ? 'Live' : `Updated ${ago(m.stepsAt, now)}`}</Text>
      </View>
      <Text style={styles.steps}>{m.steps.toLocaleString()}</Text>
    </View>
  );
}

function TrailCard({
  state,
  now,
  nameOf,
  onAnswer,
  styles,
  colors,
}: {
  state: PackFunState;
  now: number;
  nameOf: (id: string | null) => string;
  onAnswer: (i: number) => void;
  styles: Styles;
  colors: Palette;
}) {
  const t = state.trail!;
  const left = new Date(t.closesAt).getTime() - now;
  const open = t.open && left > 0;
  const answered = t.myChoice != null;
  return (
    <View style={[styles.card, styles.trail]}>
      <View style={styles.rowBetween}>
        <View style={styles.rowGap}>
          <PuzzlePieceIcon size={18} color={colors.accentActive} weight="fill" />
          <Text style={styles.cardTitle}>Scent trail {t.seq}</Text>
        </View>
        <Text style={styles.small}>{open ? `${clock(left)} left` : 'Closed'}</Text>
      </View>
      <Text style={styles.question}>{t.question}</Text>
      <View style={{ gap: 8 }}>
        {t.choices.map((c, i) => {
          const right = t.answer === i;
          const picked = t.myChoice === i;
          return (
            <Pressable
              key={i}
              disabled={answered || !open}
              onPress={() => onAnswer(i)}
              style={[
                styles.choice,
                answered && right && { borderColor: colors.green, backgroundColor: withAlpha(colors.green, 0.15) },
                answered && picked && !right && { borderColor: '#e06c6c', backgroundColor: withAlpha('#e06c6c', 0.12) },
              ]}
              accessibilityRole="button"
            >
              <Text style={styles.choiceText}>{c}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.small}>
        {t.firstUser
          ? `${nameOf(t.firstUser)} sniffed it out first · ${t.answered.length} answered`
          : `First right answer: ${state.bones.trailFirst} Bones, then ${state.bones.trailAnswer}`}
      </Text>
    </View>
  );
}

function FlashCard({
  state,
  now,
  myId,
  nameOf,
  open,
  setOpen,
  onStart,
  styles,
  colors,
  live,
}: {
  state: PackFunState;
  now: number;
  myId: string;
  nameOf: (id: string | null) => string;
  open: boolean;
  setOpen: (v: boolean) => void;
  onStart: (kind: 'dash' | 'push', minutes: 5 | 10 | 15, target: number | null) => void;
  styles: Styles;
  colors: Palette;
  live: boolean;
}) {
  const [kind, setKind] = useState<'dash' | 'push'>('dash');
  const [minutes, setMinutes] = useState<5 | 10 | 15>(10);
  const [target, setTarget] = useState(1000);
  const f = state.flash;
  const running = f && !f.settled && new Date(f.endsAt).getTime() > now;

  if (f && (running || (f.settled && now - new Date(f.endsAt).getTime() < 10 * 60_000))) {
    const joined = state.members.filter((m) => m.joined);
    const gains = joined
      .map((m) => ({ m, gain: Math.max(0, m.steps - Number(f.startSteps[m.userId] ?? m.steps)) }))
      .sort((a, b) => b.gain - a.gain);
    const top = Math.max(1, ...gains.map((g) => g.gain));
    const total = gains.reduce((s, g) => s + g.gain, 0);
    return (
      <View style={[styles.card, styles.flash]}>
        <View style={styles.rowBetween}>
          <View style={styles.rowGap}>
            <LightningIcon size={18} color={colors.amber} weight="fill" />
            <Text style={styles.cardTitle}>{f.kind === 'dash' ? 'Dash' : 'Pack push'}</Text>
          </View>
          <Text style={styles.small}>{running ? `${clock(new Date(f.endsAt).getTime() - now)} left` : 'Done'}</Text>
        </View>
        <Text style={styles.small}>Started by {nameOf(f.startedBy)}</Text>
        {f.kind === 'push' ? (
          <>
            <View style={styles.bar}>
              <View style={[styles.barFill, { backgroundColor: colors.amber, width: `${Math.min(100, Math.round((total / Math.max(1, f.target ?? 1)) * 100))}%` }]} />
            </View>
            <Text style={styles.rowText}>
              {total.toLocaleString()} of {(f.target ?? 0).toLocaleString()} together
              {f.settled ? (f.result?.made_it ? ` · made it! +${state.bones.pushBonus} each` : ' · not this time') : ''}
            </Text>
          </>
        ) : (
          gains.map((g) => (
            <View key={g.m.userId} style={styles.raceRow}>
              <Text style={[styles.small, { width: 64 }]} numberOfLines={1}>
                {g.m.userId === myId ? 'You' : g.m.name.split(' ')[0]}
              </Text>
              <View style={[styles.bar, { flex: 1 }]}>
                <View style={[styles.barFill, { backgroundColor: colors.amber, width: `${Math.round((g.gain / top) * 100)}%` }]} />
              </View>
              <Text style={[styles.small, { width: 48, textAlign: 'right' }]}>{g.gain}</Text>
            </View>
          ))
        )}
        {f.settled && f.kind === 'dash' && (
          <Text style={styles.rowText}>
            {f.result?.winner ? `${nameOf(f.result.winner)} won · +${state.bones.flashWin} Bones` : 'No winner this time'}
          </Text>
        )}
      </View>
    );
  }

  if (!live) return null;
  if (!open) {
    return (
      <Button label="Start a flash challenge" variant="secondary" block onPress={() => setOpen(true)} />
    );
  }
  return (
    <View style={[styles.card, styles.flash]}>
      <Text style={styles.cardTitle}>Flash challenge</Text>
      <View style={styles.chips}>
        {(['dash', 'push'] as const).map((k) => (
          <Pressable key={k} onPress={() => setKind(k)} style={[styles.chip, kind === k && styles.chipOn]} accessibilityRole="button">
            <Text style={styles.chipText}>{k === 'dash' ? 'Dash: most steps wins' : 'Pack push: hit a total'}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.chips}>
        {([5, 10, 15] as const).map((m) => (
          <Pressable key={m} onPress={() => setMinutes(m)} style={[styles.chip, minutes === m && styles.chipOn]} accessibilityRole="button">
            <Text style={styles.chipText}>{m} min</Text>
          </Pressable>
        ))}
      </View>
      {kind === 'push' && (
        <View style={styles.chips}>
          {[500, 1000, 2000, 3000].map((t) => (
            <Pressable key={t} onPress={() => setTarget(t)} style={[styles.chip, target === t && styles.chipOn]} accessibilityRole="button">
              <Text style={styles.chipText}>{t.toLocaleString()} steps</Text>
            </Pressable>
          ))}
        </View>
      )}
      <Text style={styles.small}>
        {kind === 'dash' ? `Winner gets ${state.bones.flashWin} Bones.` : `Everyone gets ${state.bones.pushBonus} Bones if the pack makes it.`}
      </Text>
      <View style={styles.rowGap}>
        <View style={{ flex: 1 }}>
          <Button label="Not now" variant="secondary" block onPress={() => setOpen(false)} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Go" variant="primary" block onPress={() => onStart(kind, minutes, kind === 'push' ? target : null)} />
        </View>
      </View>
    </View>
  );
}

function Recap({ state, board, myId, styles, colors }: { state: PackFunState; board: PackFunMember[]; myId: string; styles: Styles; colors: Palette }) {
  const mins = Math.round((new Date(state.endsAt).getTime() - new Date(state.startsAt).getTime()) / 60000);
  return (
    <>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Pack Fun recap</Text>
        <View style={styles.stats}>
          <Stat n={state.packSteps.toLocaleString()} label="pack steps" styles={styles} />
          <Stat n={`${mins} min`} label="together" styles={styles} />
          <Stat n={String(state.trailsSolved)} label="trails solved" styles={styles} />
          <Stat n={String(state.bonesFound)} label="bones found" styles={styles} />
        </View>
        <View style={[styles.rowGap, { marginTop: 4 }]}>
          <BoneIcon size={18} color={colors.gold} weight="fill" />
          <Text style={styles.rowText}>You earned {state.myBones} Bones</Text>
        </View>
      </View>
      <View style={styles.card}>
        {board.map((m, i) => (
          <MemberRow key={m.userId} m={m} rank={i + 1} me={m.userId === myId} now={0} colors={colors} styles={styles} recap />
        ))}
      </View>
    </>
  );
}

function Stat({ n, label, styles }: { n: string; label: string; styles: Styles }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statN}>{n}</Text>
      <Text style={styles.small}>{label}</Text>
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    top: { paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 40 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    body: { padding: 16, gap: 12, paddingBottom: 64 },
    head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    note: { fontSize: 14.5, lineHeight: 20, color: withAlpha(colors.text, 0.7) },
    small: { fontSize: 12.5, lineHeight: 17, color: withAlpha(colors.text, 0.6) },
    livePill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: withAlpha('#e06c6c', 0.18), marginTop: 8 },
    liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#e06c6c' },
    liveText: { fontFamily: font.headingSemibold, fontSize: 12, color: '#e06c6c', letterSpacing: 0.5 },
    card: { borderRadius: 16, backgroundColor: colors.surface, padding: 14, gap: 8 },
    trail: { borderWidth: 1, borderColor: withAlpha(colors.accent, 0.5) },
    flash: { borderWidth: 1, borderColor: withAlpha(colors.amber, 0.6) },
    cardTitle: { fontFamily: font.headingSemibold, fontSize: 16, color: colors.text },
    rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    rowGap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    big: { fontFamily: font.headingSemibold, fontSize: 32, color: colors.text },
    badge: { fontSize: 12, fontFamily: font.headingSemibold, color: colors.green, backgroundColor: withAlpha(colors.green, 0.15), paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: 'hidden' },
    bar: { height: 8, borderRadius: 4, backgroundColor: withAlpha(colors.text, 0.1), overflow: 'hidden' },
    barFill: { height: 8, borderRadius: 4, backgroundColor: colors.accent },
    question: { fontSize: 17, lineHeight: 24, color: colors.text },
    choice: { minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: withAlpha(colors.text, 0.15), paddingHorizontal: 12, justifyContent: 'center' },
    choiceText: { fontSize: 15, color: colors.text },
    raceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { minHeight: 40, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: withAlpha(colors.text, 0.15), justifyContent: 'center' },
    chipOn: { borderWidth: 2, borderColor: colors.amber, backgroundColor: withAlpha(colors.amber, 0.12) },
    chipText: { fontFamily: font.headingSemibold, fontSize: 13.5, color: colors.text },
    cheerRow: { flexDirection: 'row', gap: 8 },
    cheer: { flex: 1, minHeight: 44, borderRadius: 12, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
    cheerText: { fontSize: 13, color: colors.text },
    tabs: { flexDirection: 'row', gap: 8, padding: 4, borderRadius: 12, backgroundColor: colors.surface },
    tab: { flex: 1, flexDirection: 'row', gap: 6, minHeight: 40, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
    tabOn: { backgroundColor: withAlpha(colors.accent, 0.22) },
    tabText: { fontFamily: font.headingSemibold, fontSize: 14, color: colors.text },
    member: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 },
    rank: { width: 18, textAlign: 'center', fontFamily: font.headingSemibold, color: withAlpha(colors.text, 0.5) },
    rowText: { fontSize: 15, color: colors.text },
    steps: { fontFamily: font.headingSemibold, fontSize: 16, color: colors.text },
    regroup: { borderRadius: 12, padding: 12, backgroundColor: withAlpha(colors.amber, 0.16) },
    regroupText: { fontSize: 14, color: colors.text },
    stats: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 10 },
    stat: { width: '50%' },
    statN: { fontFamily: font.headingSemibold, fontSize: 22, color: colors.text },
    toast: { position: 'absolute', left: 16, right: 16, bottom: 32, borderRadius: 12, padding: 12, backgroundColor: colors.accent800, alignItems: 'center' },
    toastText: { color: '#ffffff', fontFamily: font.headingSemibold },
  });
}


