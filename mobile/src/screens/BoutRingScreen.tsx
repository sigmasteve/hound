import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeftIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { buzz } from '../celebrate/feedback';
import { getChallengeSponsor, type ChallengeSponsor } from '../challenges/globalChallenges';
import { Boxer, Referee, RingArt, ringView, useClock, type BoxerAct } from '../components/BoutRing';
import {
  getBoutLive,
  PUNCHES,
  punchName,
  slipPunch,
  throwPunch,
  type BoutKind,
  type BoutLive,
  type BoutPunchKind,
} from '../challenges/boutApi';

// Hound Bout (0225), in the ring: Throw (pick a punch, Throw! as the
// marker crosses the green) and Incoming (their punches that got through:
// Slip! in the green, or Take it). The ring, from behind your corner
// (BoutRing, through perspective.ts), never scrolls away: only the message
// and today's punches under it scroll, and the meter and the buttons stay
// pinned at the bottom (as every game we've built).

const SWEEP_MS = 900;
const ACT_MS = 700;
const ME_COLOR = '#ffd8b0';
const GREEN = '#7fd39b';

function meterAt(ms: number): number {
  const p = (ms / SWEEP_MS) % 2;
  return (p <= 1 ? p : 2 - p) * 100;
}

type Mode = 'throw' | 'slip';
type Anim = { me: BoxerAct['pose']; opp: BoxerAct['pose']; startAt: number; banner: { text: string; good: boolean } };

// The Title Bout (0227) fights here too: kind 'titlebout' reads and acts
// through its own functions, against the day's ladder opponent (or a
// sparring hound), or in the title fight.
export function BoutRingScreen({
  challengeId,
  initialMode,
  kind = 'bout',
  onBack,
}: {
  challengeId: string;
  initialMode?: Mode;
  kind?: BoutKind;
  onBack: () => void;
}) {
  const gameName = kind === 'titlebout' ? 'Title Bout' : 'Hound Bout';
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [live, setLive] = useState<BoutLive | null>(null);
  const [sponsor, setSponsor] = useState<ChallengeSponsor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(initialMode ?? 'throw');
  const [punch, setPunch] = useState<BoutPunchKind | null>(null);
  const [meterFrom, setMeterFrom] = useState<number | null>(null);
  const [mark, setMark] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [anim, setAnim] = useState<Anim | null>(null);
  const [today, setToday] = useState<{ text: string; good: boolean }[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const load = useCallback(async () => {
    try {
      const l = await getBoutLive(challengeId, kind);
      setLive(l);
      setError(null);
      return l;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the fight.');
      return null;
    }
  }, [challengeId, kind]);
  useEffect(() => {
    load();
    getChallengeSponsor(challengeId)
      .then(setSponsor)
      .catch(() => {});
  }, [load, challengeId]);

  // Opened straight onto Incoming (Slip N incoming): start the slip meter
  // as soon as the fight's loaded, as switching to the tab does.
  const startedSlip = useRef(false);
  useEffect(() => {
    if (startedSlip.current || !live || mode !== 'slip') return;
    startedSlip.current = true;
    if (live.canAct && live.incoming.length > 0) setMeterFrom(Date.now());
  }, [live, mode]);

  const now = useClock(meterFrom != null || anim != null);
  const rv = useMemo(() => (size.w > 0 ? ringView(size.w, size.h) : null), [size.w, size.h]);
  const incoming = live?.incoming[0] ?? null;
  const oppName = live?.opponent ? (live.opponent.id ? live.opponent.name.split(' ')[0] : 'The sparring hound') : 'Your opponent';

  useEffect(() => {
    if (!live || msg) return;
    setMsg(
      !live.canAct
        ? (live.reason ?? '')
        : mode === 'slip'
          ? `${oppName} has ${live.incoming.length} ${live.incoming.length === 1 ? 'punch' : 'punches'} waiting for you. Slip! in the green and it misses; take it and it lands tonight.`
          : `Pick a punch. Jabs are easy to land; uppercuts score 3 but the green is narrow. ${oppName} has a guard up: find out what it stops.`,
    );
  }, [live, mode, msg, oppName]);

  // Start the meter for a punch, or for the next incoming one.
  const startMeter = () => {
    setMark(null);
    setAnim(null);
    setMeterFrom(Date.now());
  };
  const pick = (p: BoutPunchKind) => {
    if (busy || !live?.canAct) return;
    setPunch(p);
    setMsg('Tap Throw! as the marker crosses the green.');
    startMeter();
    buzz('light');
  };
  const switchMode = (m: Mode) => {
    if (busy) return;
    setMode(m);
    setMeterFrom(m === 'slip' && live?.canAct && live.incoming.length > 0 ? Date.now() : null);
    setMark(null);
    setAnim(null);
    setPunch(null);
    setMsg(
      m === 'slip'
        ? live && live.incoming.length > 0
          ? 'Tap Slip! as the marker crosses the green. Jabs are quick: the hardest to slip.'
          : `Nothing coming at you right now. ${oppName}'s punches wait here until the round's scored.`
        : 'Pick a punch.',
    );
  };

  const doThrow = async () => {
    if (!live || !punch || meterFrom == null || busy) return;
    const pos = meterAt(Date.now() - meterFrom);
    setMark(pos);
    setMeterFrom(null);
    setBusy(true);
    buzz('light');
    try {
      const r = await throwPunch(challengeId, punch, pos, kind);
      const landed = r.quality !== 'miss' && !r.blocked;
      setAnim({
        me: punch,
        opp: r.quality === 'miss' ? 'slip' : r.blocked ? 'block' : 'hit',
        startAt: Date.now(),
        banner: {
          text: r.quality === 'miss' ? 'Missed' : r.countered ? 'Countered' : r.blocked ? 'Blocked' : `${punchName(punch)} +${r.points}`,
          good: landed,
        },
      });
      if (landed) buzz('success');
      setMsg(r.message);
      setToday((t) => [{ text: r.quality === 'miss' ? `${punchName(punch)}: miss` : r.blocked ? `${punchName(punch)}: blocked` : `${punchName(punch)} +${r.points}`, good: landed }, ...t].slice(0, 10));
      timers.current.push(
        setTimeout(() => {
          setAnim(null);
          setBusy(false);
          load().then((l) => {
            if (l?.canAct && punch) startMeter();
          });
        }, ACT_MS + 900),
      );
    } catch (e) {
      setBusy(false);
      Alert.alert(gameName, e instanceof Error ? e.message : 'Try again.');
      load();
    }
  };

  const doSlip = async (take: boolean) => {
    if (!live || !incoming || busy) return;
    const pos = take || meterFrom == null ? null : meterAt(Date.now() - meterFrom);
    setMark(pos);
    setMeterFrom(null);
    setBusy(true);
    buzz('light');
    try {
      const r = await slipPunch(challengeId, incoming.id, pos, kind);
      setAnim({
        me: r.slip === 'slipped' ? 'slip' : 'hit',
        opp: incoming.punch,
        startAt: Date.now(),
        banner: { text: r.slip === 'slipped' ? 'Slipped!' : r.slip === 'taken' ? 'Taken' : 'Caught it', good: r.slip === 'slipped' },
      });
      if (r.slip === 'slipped') buzz('success');
      setMsg(r.message);
      setToday((t) => [{ text: `${oppName}'s ${punchName(incoming.punch).toLowerCase()}: ${r.slip === 'slipped' ? 'slipped' : 'lands tonight'}`, good: r.slip === 'slipped' }, ...t].slice(0, 10));
      timers.current.push(
        setTimeout(() => {
          setAnim(null);
          setBusy(false);
          load().then((l) => {
            if (l && l.incoming.length > 0 && l.canAct) setMeterFrom(Date.now());
            else if (l) setMsg(l.incoming.length === 0 ? `That's everything ${oppName} has thrown so far. More may come before midnight.` : (l.reason ?? ''));
          });
        }, ACT_MS + 900),
      );
    } catch (e) {
      setBusy(false);
      Alert.alert(gameName, e instanceof Error ? e.message : 'Try again.');
      load();
    }
  };

  if (!live) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.top}>
          <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
            <ArrowLeftIcon size={20} color={colors.accentActive} />
          </Pressable>
        </View>
        <View style={styles.center}>{error ? <Text style={styles.note}>{error}</Text> : <ActivityIndicator color={colors.accent} />}</View>
      </SafeAreaView>
    );
  }

  // ── This frame ──
  const ak = anim ? Math.min(1, (now - anim.startAt) / ACT_MS) : 0;
  const meAct: BoxerAct = anim ? { pose: anim.me, k: anim.me === 'slip' || anim.me === 'hit' ? Math.max(0, (ak - 0.3) / 0.7) : ak } : { pose: 'idle', k: 0 };
  const oppAct: BoxerAct = anim ? { pose: anim.opp, k: anim.opp === 'slip' || anim.opp === 'hit' || anim.opp === 'block' ? Math.max(0, (ak - 0.3) / 0.7) : ak } : { pose: 'idle', k: 0 };
  const liveMark = meterFrom != null ? meterAt(now - meterFrom) : mark;
  const half =
    mode === 'throw' ? (punch ? live.widths[punch] : null) : incoming ? live.slipWidths[incoming.punch] : null;
  const perfect = mode === 'throw' && half != null ? half * live.widths.perfectShare : null;
  const canThrow = mode === 'throw' && live.canAct && !!punch && meterFrom != null && !busy;
  const canSlip = mode === 'slip' && live.canAct && !!incoming && meterFrom != null && !busy;
  const canTake = mode === 'slip' && !!incoming && !busy && live.status === 'active';
  const actLabel =
    mode === 'throw'
      ? busy
        ? '…'
        : !live.canAct
          ? live.reason ?? 'No actions'
          : punch
            ? 'Throw!'
            : 'Pick a punch'
      : busy
        ? '…'
        : !incoming
          ? 'Nothing incoming'
          : !live.canAct
            ? live.reason ?? 'No actions to slip with'
            : 'Slip!';
  const shirtApron = sponsor?.name ?? gameName;
  const tb = live.titleBout;
  const kicker = !tb
    ? `HOUND BOUT · ROUND ${Math.max(1, Math.min(live.rounds, live.round))} OF ${live.rounds}`
    : tb.title
      ? `TITLE FIGHT · ROUND ${live.round} OF 2`
      : `TITLE BOUT · DAY ${Math.max(1, tb.dayNo)} OF 7${tb.opponentIsBot ? ' · SPARRING' : ''}`;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.fixed}>
        <View style={styles.head}>
          <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back" style={styles.back}>
            <ArrowLeftIcon size={20} color={colors.accentActive} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.kicker} numberOfLines={1}>
              {kicker}
            </Text>
            <Text style={styles.title}>{mode === 'throw' ? 'In the ring' : 'Incoming'}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }} accessible accessibilityLabel={`Today so far: you ${live.tally.mine}, ${oppName} ${live.tally.theirs}`}>
            <Text style={[styles.title, { color: ME_COLOR }]}>
              {live.tally.mine}–{live.tally.theirs}
            </Text>
            <Text style={styles.small}>you – {oppName}, today</Text>
          </View>
        </View>

        <View style={styles.banks}>
          <View style={styles.bank}>
            <Text style={[styles.bankLabel, { color: '#a6e3b8' }]}>ACTIONS</Text>
            <Text style={styles.bankValue}>{live.day.left}</Text>
            <Text style={styles.bankNote} numberOfLines={1}>
              1 per 1,000{live.day.cardio ? ' · +2 cardio' : ''}
            </Text>
          </View>
          <Pressable style={styles.bank} onPress={() => switchMode('slip')} accessibilityRole="button" accessibilityLabel={`Incoming: ${live.incoming.length}`}>
            <Text style={[styles.bankLabel, { color: '#f0a37a' }]}>INCOMING</Text>
            <Text style={styles.bankValue}>{live.incoming.length}</Text>
            <Text style={styles.bankNote} numberOfLines={1}>
              to slip
            </Text>
          </Pressable>
          <View style={styles.bank}>
            <Text style={[styles.bankLabel, { color: '#b4aaf0' }]}>POWER RUN</Text>
            <Text style={styles.bankValue}>
              {Math.min(live.day.kdNeeds, live.run)} of {live.day.kdNeeds}
            </Text>
            <Text style={styles.bankNote} numberOfLines={1}>
              to a knockdown
            </Text>
          </View>
        </View>

        <View style={styles.ring} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
          {rv && (
            <>
              <RingArt rv={rv} apron={shirtApron} />
              <Referee rv={rv} counting={null} />
              <Boxer at={rv.opp} height={rv.v.h * 0.46 * rv.opp.s} facing="front" trunks="#e05b5b" gloves="#c2410c" act={oppAct} />
              <Boxer at={{ x: rv.me.x, y: rv.v.h + rv.v.h * 0.05 }} height={rv.v.h * 0.5} facing="back" trunks="#4f7be0" gloves="#4f7be0" coat="#c08a52" act={meAct} />
            </>
          )}
          <Text style={[styles.chip, { left: 10, top: 10 }]}>
            {mode === 'slip' && incoming ? `${oppName} throws a ${punchName(incoming.punch).toLowerCase()} (+${incoming.points})` : `${oppName}’s guard: work it out`}
          </Text>
          {tb?.title && <Text style={[styles.chip, { right: 10, top: 10, color: '#f0c24a' }]}>For the belt</Text>}
          {(live.day.camp || live.day.strength) && (
            <Text style={[styles.chip, { right: 10, top: 40, color: ME_COLOR }]}>
              {[live.day.camp ? 'Fight camp: wider green' : null, live.day.strength ? `Power: ${live.day.kdNeeds} for a knockdown` : null].filter(Boolean).join(' · ')}
            </Text>
          )}
          {anim && ak > 0.35 && (
            <View style={[styles.banner, { backgroundColor: anim.banner.good ? GREEN : '#e9e9ed' }]}>
              <Text style={styles.bannerText}>{anim.banner.text}</Text>
            </View>
          )}
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollBody}>
        <Text style={styles.msg}>{msg}</Text>
        {today.length > 0 && (
          <View style={styles.pills}>
            {today.map((t, i) => (
              <Text key={i} style={[styles.pill, t.good && styles.pillGood]}>
                {t.text}
              </Text>
            ))}
          </View>
        )}
        <Text style={styles.small}>
          {live.day.steps.toLocaleString()} steps today · {live.day.earned} actions
          {live.day.nextAt != null ? ` · next at ${live.day.nextAt.toLocaleString()}` : ''}. The round is scored tomorrow morning.
        </Text>
      </ScrollView>

      <View style={styles.pinned}>
        <View style={styles.tabs} accessibilityRole="tablist">
          {(['throw', 'slip'] as Mode[]).map((m) => {
            const on = mode === m;
            return (
              <Pressable key={m} onPress={() => switchMode(m)} style={[styles.tab, on && styles.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: on }}>
                <Text style={[styles.tabText, on && styles.tabTextOn]}>{m === 'throw' ? 'Throw' : `Incoming · ${live.incoming.length}`}</Text>
              </Pressable>
            );
          })}
        </View>
        {mode === 'throw' && (
          <View style={styles.punches}>
            {PUNCHES.map((p) => {
              const on = punch === p.id;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => pick(p.id)}
                  disabled={!live.canAct || busy}
                  style={[styles.punch, on && styles.punchOn, (!live.canAct || busy) && { opacity: 0.5 }]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${p.name}, ${p.points} ${p.points === 1 ? 'point' : 'points'}`}
                >
                  <Text style={[styles.punchName, on && { color: ME_COLOR }]}>{p.name}</Text>
                  <Text style={[styles.punchSub, on && { color: ME_COLOR }]}>
                    {p.points} · {p.id === 'jab' ? 'wide green' : p.id === 'hook' ? 'beats a body guard' : 'beats a high guard'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
        <View style={styles.meter} accessibilityLabel={half != null ? `Timing: the green is ${Math.round(50 - half)} to ${Math.round(50 + half)}` : 'Timing meter'}>
          <View style={[styles.band, { backgroundColor: '#c2504f', left: 0, width: '100%' }]} />
          {half != null && <View style={[styles.band, { backgroundColor: '#b9e6c6', left: `${50 - half}%`, width: `${2 * half}%` }]} />}
          {perfect != null && <View style={[styles.band, { backgroundColor: '#3f9a6b', left: `${50 - perfect}%`, width: `${2 * perfect}%` }]} />}
          <Text style={[styles.meterWord, { left: 10 }]}>EARLY</Text>
          <Text style={[styles.meterWord, { right: 10 }]}>LATE</Text>
          {liveMark != null && <View style={[styles.markerBar, { left: `${Math.max(1, Math.min(99, liveMark))}%` }, meterFrom == null && { borderColor: ME_COLOR }]} />}
        </View>
        {/* A timing tap counts when the finger lands (as Hoops and the Shootout). */}
        {mode === 'throw' ? (
          <Pressable onPressIn={canThrow ? doThrow : undefined} disabled={!canThrow} style={[styles.act, canThrow ? { backgroundColor: '#f08a24' } : styles.actOff]} accessibilityRole="button">
            <Text style={[styles.actText, !canThrow && styles.actTextOff]}>{actLabel}</Text>
          </Pressable>
        ) : (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable onPress={() => doSlip(true)} disabled={!canTake} style={[styles.take, !canTake && { opacity: 0.4 }]} accessibilityRole="button">
              <Text style={styles.takeText}>Take it</Text>
            </Pressable>
            <Pressable onPressIn={canSlip ? () => doSlip(false) : undefined} disabled={!canSlip} style={[styles.act, { flex: 2 }, canSlip ? { backgroundColor: '#f08a24' } : styles.actOff]} accessibilityRole="button">
              <Text style={[styles.actText, !canSlip && styles.actTextOff]}>{actLabel}</Text>
            </Pressable>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    top: { paddingHorizontal: 16, paddingVertical: 6, minHeight: 36 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    fixed: { flex: 1, paddingHorizontal: 16, paddingTop: 4, gap: 8 },
    back: { paddingRight: 2, paddingBottom: 4 },
    note: { fontSize: 14.5, color: withAlpha(colors.text, 0.7), textAlign: 'center' },
    head: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
    kicker: { fontFamily: font.headingSemibold, fontSize: 11.5, letterSpacing: 0.8, color: withAlpha(colors.text, 0.6) },
    title: { fontFamily: font.headingSemibold, fontSize: 22, color: colors.text },
    small: { fontSize: 12, lineHeight: 17, color: withAlpha(colors.text, 0.6) },
    banks: { flexDirection: 'row', gap: 8 },
    bank: { flex: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: colors.surface },
    bankLabel: { fontFamily: font.headingSemibold, fontSize: 10.5, letterSpacing: 0.6 },
    bankValue: { fontFamily: font.headingSemibold, fontSize: 17, color: colors.text },
    bankNote: { fontSize: 10.5, color: withAlpha(colors.text, 0.6) },
    ring: { flex: 1, minHeight: 280, borderRadius: 16, overflow: 'hidden', backgroundColor: '#1d2133' },
    chip: {
      position: 'absolute',
      backgroundColor: 'rgba(15,17,28,0.82)',
      color: '#fff',
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 4,
      fontSize: 11.5,
      fontFamily: font.headingSemibold,
      overflow: 'hidden',
    },
    banner: { position: 'absolute', alignSelf: 'center', top: '42%', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10 },
    bannerText: { fontFamily: font.headingSemibold, fontSize: 20, color: '#161826' },
    scroll: { flexGrow: 0, maxHeight: 110, marginTop: 8 },
    scrollBody: { paddingHorizontal: 16, gap: 6, paddingBottom: 6 },
    msg: { fontSize: 13, lineHeight: 18, color: withAlpha(colors.text, 0.78) },
    pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    pill: { fontSize: 11.5, fontFamily: font.headingSemibold, color: withAlpha(colors.text, 0.65), backgroundColor: colors.surface, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, overflow: 'hidden' },
    pillGood: { color: '#a6e3b8', backgroundColor: withAlpha(GREEN, 0.16) },
    pinned: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 8, gap: 8 },
    tabs: { flexDirection: 'row', gap: 6, padding: 3, borderRadius: 12, backgroundColor: colors.surface },
    tab: { flex: 1, minHeight: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
    tabOn: { backgroundColor: colors.text },
    tabText: { fontFamily: font.headingSemibold, fontSize: 13.5, color: withAlpha(colors.text, 0.75) },
    tabTextOn: { color: colors.bg },
    punches: { flexDirection: 'row', gap: 8 },
    punch: { flex: 1, minHeight: 54, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.surface },
    punchOn: { borderColor: ME_COLOR, backgroundColor: withAlpha(ME_COLOR, 0.14) },
    punchName: { fontFamily: font.headingSemibold, fontSize: 15, color: colors.text },
    punchSub: { fontSize: 10.5, color: withAlpha(colors.text, 0.65), textAlign: 'center' },
    meter: { height: 32, borderRadius: 16, overflow: 'hidden', position: 'relative' },
    band: { position: 'absolute', top: 0, bottom: 0 },
    meterWord: { position: 'absolute', top: 8, fontSize: 11, fontFamily: font.headingSemibold, color: '#ffffff' },
    markerBar: { position: 'absolute', top: 0, bottom: 0, width: 6, marginLeft: -3, borderRadius: 3, backgroundColor: '#161826', borderWidth: 2, borderColor: '#ffffff' },
    act: { flex: 1, minHeight: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
    actOff: { backgroundColor: withAlpha(colors.text, 0.1) },
    actText: { fontFamily: font.headingSemibold, fontSize: 17, color: '#161826', textAlign: 'center' },
    actTextOff: { color: withAlpha(colors.text, 0.6), fontSize: 14 },
    take: { flex: 1, minHeight: 52, borderRadius: 14, borderWidth: 1, borderColor: withAlpha(colors.text, 0.2), alignItems: 'center', justifyContent: 'center' },
    takeText: { fontFamily: font.headingSemibold, fontSize: 15, color: colors.text },
  });
}
