import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Circle, Ellipse, Line, Path, Rect } from 'react-native-svg';
import { Text } from './Text';
import { AT, BASES, BaseballBall, FieldArt, Figure, HOME, HS, lerp, MOUND, P, PITCHER_COLOR, view, FH, FW, type Pt } from '../screens/BaseballBatScreen';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { buzz } from '../celebrate/feedback';
import { getBaseballLive, setBaseballStealJump, type BaseballLive, type BaseballStealJump } from '../challenges/baseballApi';

// The steal (0231; mockup claude.ai/artifact/HGso1dZWWMbsHBxMMfSxP5,
// board 3): your jump off first, once a day, for tonight. Baseball
// batting's view (behind home plate, every point through project()), you
// leading off first. Take your lead; the pitcher comes set. Tap GO the
// moment he kicks toward home (he's committed); go before it and he
// throws over: a pickoff. A quick throw to first instead is a pickoff
// move: stay put. Then Slide! as you reach second. The jump (ms after the
// kick) and the slide go to the server: if you're the lead runner with
// second open tonight, you're going, and the jump decides it. Once it's
// set, more runs are practice.

type Phase = 'ready' | 'set' | 'pickoff' | 'kick' | 'run' | 'done';
const LEAD = 0.14;
const TO_PLATE = 1300;
const RUN_MS = 3150;
const ME = '#4f7be0';
const HARD = ['plays itself', 'not playing', 'is over', "hasn't started", 'already played'];

const lp = (a: Pt, b: Pt, k: number): Pt => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) });
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export function BaseballStealMode({ challengeId, onBusy }: { challengeId: string; onBusy: (b: boolean) => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [live, setLive] = useState<BaseballLive | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('ready');
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [now, setNow] = useState(Date.now());
  const [msg, setMsg] = useState(
    'You’re leading off first. Tap GO the moment the pitcher kicks toward home: he’s committed. Go before it and he throws over. A quick throw to first is a pickoff move: stay put. Then tap Slide! as you reach second.',
  );
  const [banner, setBanner] = useState<{ text: string; good: boolean } | null>(null);
  const [log, setLog] = useState<{ text: string; good: boolean }[]>([]);
  const r = useRef({ moveAt: 0, pick: false, pickAt: 0, kickAt: 0, goAt: 0, slideAt: 0, pickoffs: 0, jump: 0, endAt: 0, backAt: 0, result: '' as '' | 'picked' | 'safe' | 'stay' });
  const sending = useRef(false);
  useEffect(() => onBusy(phase !== 'ready' && phase !== 'done'), [phase, onBusy]);

  const load = useCallback(async () => {
    try {
      setLive(await getBaseballLive(challengeId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the game.');
    }
  }, [challengeId]);
  useEffect(() => {
    load();
  }, [load]);

  const moving = phase !== 'ready' || !!banner;
  useEffect(() => {
    if (!moving) return;
    let raf = 0;
    const tick = () => {
      setNow(Date.now());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [moving]);

  const blocked = !live || !live.handsOn || (!!live.reason && HARD.some((h) => live.reason!.includes(h)));
  const practice = !!live?.stealJump;

  const record = async (jump: number, slide: BaseballStealJump['slide'], local: string) => {
    if (practice || sending.current) {
      setMsg(`${local}${practice ? ' Practice: tonight’s jump is already set.' : ''}`);
      return;
    }
    sending.current = true;
    try {
      const out = await setBaseballStealJump(challengeId, jump, slide);
      setMsg(`${local} ${out.message}`);
      load();
    } catch (e) {
      Alert.alert('Baseball', e instanceof Error ? e.message : 'Try again.');
    } finally {
      sending.current = false;
    }
  };

  const finish = (text: string, good: boolean) => {
    setBanner({ text, good });
    setLog((l) => [...l.slice(-5), { text, good }]);
    setTimeout(() => setBanner(null), 1600);
    setPhase('done');
  };

  const start = () => {
    const t = Date.now();
    const s = r.current;
    s.pickoffs = 0;
    s.goAt = 0;
    s.kickAt = 0;
    s.slideAt = 0;
    s.jump = 0;
    s.moveAt = t + rnd(900, 2600);
    s.pick = Math.random() < 0.28;
    s.result = '';
    setBanner(null);
    setPhase('set');
    setNow(t);
    setMsg('He’s set. Watch the front leg…');
  };

  // The clock: the move, the pickoff, the pitch, the run.
  useEffect(() => {
    const s = r.current;
    if (phase === 'set' && now >= s.moveAt) {
      if (s.pick && s.pickoffs < 2) {
        s.pickAt = now;
        setPhase('pickoff');
      } else {
        s.kickAt = now;
        setPhase('kick');
      }
    } else if (phase === 'pickoff' && now >= s.pickAt + 1100) {
      // Back in time; he comes set again.
      s.pickoffs += 1;
      s.moveAt = now + rnd(900, 2200);
      s.pick = Math.random() < 0.2;
      setMsg('Pickoff throw: you held, back in time. He’s set again…');
      setPhase('set');
    } else if (phase === 'kick' && now >= s.kickAt + TO_PLATE) {
      s.result = 'stay';
      finish('You stayed', false);
      setMsg('The pitch is in. The jump was there: tap GO as the leg kicks.');
    } else if (phase === 'run' && now - s.goAt > RUN_MS * 1.02 && !s.slideAt) {
      s.slideAt = now;
      slideDone('none');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, phase]);

  const slideDone = (slide: BaseballStealJump['slide']) => {
    const s = r.current;
    s.result = 'safe';
    s.endAt = Date.now();
    const jq = s.jump <= 200 ? 'a great jump' : s.jump <= 400 ? 'a decent jump' : 'a late jump';
    const sq = slide === 'perfect' ? 'a perfect hook slide' : slide === 'early' ? 'slid too early' : slide === 'late' ? 'slid late' : 'came in standing up';
    finish(slide === 'perfect' && s.jump <= 200 ? 'What a jump!' : 'Into second', slide === 'perfect' || s.jump <= 200);
    buzz(slide === 'perfect' ? 'success' : 'light');
    record(s.jump, slide, `You went ${s.jump} ms after the leg kick (${jq}) and ${sq}.`);
  };

  const go = () => {
    const s = r.current;
    const t = Date.now();
    if (phase === 'set' || phase === 'pickoff') {
      // Before the leg kick: he steps off and throws over.
      s.result = 'picked';
      s.jump = phase === 'set' ? -Math.max(50, Math.round(s.moveAt - t)) : -50;
      s.pickAt = t;
      s.endAt = t;
      finish('Picked off', false);
      buzz('warning');
      record(s.jump, 'none', 'You went before he committed: he threw over. Wait for the leg kick.');
      return;
    }
    if (phase === 'kick') {
      s.jump = t - s.kickAt;
      s.goAt = t;
      s.slideAt = 0;
      buzz('light');
      setPhase('run');
      setMsg('Running! Slide as you reach second.');
      return;
    }
    if (phase === 'run' && !s.slideAt) {
      s.slideAt = t;
      const k = (t - s.goAt) / RUN_MS;
      slideDone(k < 0.75 ? 'early' : k <= 0.93 ? 'perfect' : 'late');
    }
  };

  const v = useMemo(() => (size.w > 0 ? view(size.w, size.h) : null), [size.w, size.h]);

  if (!live) {
    return <View style={styles.center}>{error ? <Text style={styles.note}>{error}</Text> : <ActivityIndicator color={colors.accent} />}</View>;
  }

  // ── This frame ──
  const s = r.current;
  const first = BASES[0];
  const second = BASES[1];
  const lead = lp(first, second, LEAD);
  let runAt: Pt = lead;
  let pose: 'stand' | 'run' | 'slide' = 'stand';
  let pitcher: 'set' | 'windup' | 'thrown' = 'set';
  let ball: { x: number; y: number; d: number } | null = null;
  const hand = v ? (() => {
    const q = P(v, MOUND);
    return { x: q.x + FW * 0.25 * q.s, y: q.y - FH * 0.78 * q.s };
  })() : null;
  if (v && hand) {
    if (phase === 'pickoff' || (s.result === 'picked' && phase === 'done')) {
      const t0 = phase === 'pickoff' ? s.pickAt : s.pickAt;
      const k = Math.min(1, Math.max(0, (now - t0 - 250) / 380));
      pitcher = 'thrown';
      const glove = P(v, { x: first.x + 8, y: first.y - 4 });
      if (k > 0 && k < 1) ball = { x: lerp(hand.x, glove.x, k), y: lerp(hand.y, glove.y - 20 * glove.s, k), d: 10 * glove.s };
      if (phase === 'pickoff') {
        runAt = lp(lead, first, Math.min(1, Math.max(0, (now - t0 - 200) / 400)));
        pose = now - t0 > 200 ? 'slide' : 'stand';
      } else {
        runAt = lp(lead, second, 0.12);
        pose = 'run';
      }
    } else if (phase === 'kick' || phase === 'run' || (phase === 'done' && s.result !== 'picked' && s.kickAt)) {
      const m = now - s.kickAt;
      pitcher = m < TO_PLATE * 0.55 ? 'windup' : 'thrown';
      const home = P(v, HOME);
      const zone = { x: home.x, y: home.y - HS * home.s * 0.5 };
      const rel = TO_PLATE * 0.6;
      if (m > rel && m < TO_PLATE) {
        const k = (m - rel) / (TO_PLATE - rel);
        ball = { x: lerp(hand.x, zone.x, k), y: lerp(hand.y, zone.y, k), d: lerp(8, 20, k) * home.s };
      } else if (s.goAt && m >= TO_PLATE + 200 && m < TO_PLATE + 200 + 1900) {
        // The catcher's throw to second.
        const k = (m - TO_PLATE - 200) / 1900;
        const bag = P(v, second);
        ball = { x: lerp(zone.x, bag.x, k), y: lerp(zone.y, bag.y - 18 * bag.s, k) - 50 * Math.sin(Math.PI * k) * bag.s, d: lerp(16, 9, k) * bag.s };
      }
      if (s.goAt && (phase === 'run' || (phase === 'done' && s.result === 'safe'))) {
        const end = s.slideAt && phase === 'done' ? s.slideAt : now;
        runAt = lp(lead, second, Math.min(1, (Math.min(now, end + 400) - s.goAt) / RUN_MS));
        pose = s.slideAt ? 'slide' : 'run';
      }
    }
  }
  const ssAt = s.goAt && (phase === 'run' || phase === 'done') ? lp(AT.ss, { x: second.x - 10, y: second.y + 4 }, Math.min(1, (now - s.goAt) / 1400)) : AT.ss;
  const goLabel =
    phase === 'ready' || phase === 'done'
      ? blocked
        ? live.reason || 'Not today'
        : practice
          ? 'Practice your jump'
          : phase === 'done'
            ? 'Again'
            : 'Take your lead'
      : phase === 'run'
        ? s.slideAt
          ? 'Sliding…'
          : 'Slide!'
        : 'GO!';
  const goOn = !blocked && !(phase === 'run' && !!s.slideAt);
  const sj = live.stealJump;

  return (
    <>
      <View style={styles.fixed}>
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Text style={styles.kicker} numberOfLines={1}>
              BASEBALL · ON FIRST{practice ? ' · PRACTICE' : ' · ONCE A DAY'}
            </Text>
            <Text style={styles.title}>Steal second</Text>
          </View>
        </View>
        <View style={styles.bank}>
          <Text style={[styles.bankLabel, { color: '#a6e3b8' }]}>TONIGHT’S JUMP</Text>
          <Text style={styles.bankNote}>
            {sj
              ? sj.grade === 'picked'
                ? 'You went early: a pickoff if you try it tonight.'
                : `${sj.grade === 'great' ? 'A great jump' : sj.grade === 'good' ? 'A decent jump' : 'A late jump'} (${sj.jumpMs} ms), ${
                    sj.slide === 'perfect' ? 'a perfect slide' : sj.slide === 'none' ? 'no slide' : `slid ${sj.slide}`
                  }.${sj.used ? (sj.safe ? ' Used tonight: safe!' : ' Used tonight: thrown out.') : ' Used if you reach first with second open.'}`
              : 'Not set yet. Your first run today counts; after that it’s practice.'}
          </Text>
        </View>

        <View style={styles.field} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
          {v && (
            <>
              <FieldArt v={v} />
              {(['1b', '2b', '3b', 'lf', 'cf', 'rf'] as const).map((pos) => {
                const q = P(v, pos === '1b' ? { x: first.x + 12, y: first.y - 6 } : AT[pos]);
                return <Figure key={pos} x={q.x} y={q.y} s={q.s} color={PITCHER_COLOR} pose="ready" />;
              })}
              {(() => {
                const q = P(v, ssAt);
                return <Figure x={q.x} y={q.y} s={q.s} color={PITCHER_COLOR} pose={phase === 'done' && s.result === 'safe' ? 'catch' : 'ready'} />;
              })()}
              {(() => {
                const q = P(v, MOUND);
                return <Figure x={q.x} y={q.y} s={q.s} color={PITCHER_COLOR} pose={pitcher} />;
              })()}
              <Svg width={v.w} height={v.h} style={StyleSheet.absoluteFill} pointerEvents="none">
                {(() => {
                  const a = P(v, first);
                  const b = P(v, lead);
                  return <Line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#ffd27a" strokeWidth={2} strokeDasharray="3 3" opacity={0.8} />;
                })()}
              </Svg>
              <Runner at={P(v, runAt)} pose={pose} t={now} />
              {ball && (
                <View pointerEvents="none" style={{ position: 'absolute', left: ball.x - ball.d / 2, top: ball.y - ball.d / 2 }}>
                  <BaseballBall size={Math.max(4, ball.d)} />
                </View>
              )}
            </>
          )}
          <Text style={[styles.chip, { left: 10 }]} pointerEvents="none">
            {phase === 'ready' ? 'Leading off first' : phase === 'set' ? 'He’s set' : phase === 'pickoff' ? 'He spins…' : phase === 'kick' ? 'Leg kick!' : phase === 'run' ? 'Running!' : 'Lead: 12 ft'}
          </Text>
          {s.goAt > 0 && phase !== 'ready' && s.result !== 'picked' && phase !== 'set' && phase !== 'pickoff' && (
            <Text style={[styles.chip, { right: 10, color: '#161826', backgroundColor: s.jump <= 200 ? '#7fd39b' : s.jump <= 400 ? '#ffd27a' : '#e9e9ed' }]} pointerEvents="none">
              Jump {s.jump} ms
            </Text>
          )}
          {banner && (
            <View pointerEvents="none" style={[styles.banner, { backgroundColor: banner.good ? '#a6e3b8' : '#e9e9ed' }]}>
              <Text style={styles.bannerText}>{banner.text}</Text>
            </View>
          )}
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollBody}>
        <Text style={styles.msg}>{msg}</Text>
        {log.length > 0 && (
          <View style={styles.today}>
            {log.map((l, i) => (
              <Text key={i} style={[styles.pill, l.good && styles.pillGood]}>
                {l.text}
              </Text>
            ))}
          </View>
        )}
      </ScrollView>

      <View style={styles.pinned}>
        {/* Counted when the finger lands. */}
        <Pressable
          onPressIn={phase === 'set' || phase === 'pickoff' || phase === 'kick' || phase === 'run' ? go : undefined}
          onPress={phase === 'ready' || phase === 'done' ? start : undefined}
          disabled={!goOn}
          style={[
            styles.act,
            !goOn
              ? styles.actOff
              : phase === 'run'
                ? { backgroundColor: '#f0c24a' }
                : phase === 'set' || phase === 'pickoff' || phase === 'kick'
                  ? { backgroundColor: '#e05b5b' }
                  : { backgroundColor: '#f08a24' },
          ]}
          accessibilityRole="button"
        >
          <Text style={[styles.actText, !goOn && { color: withAlpha(colors.text, 0.6), fontSize: 14 }, (phase === 'set' || phase === 'pickoff' || phase === 'kick') && { color: '#ffffff' }]}>
            {goLabel}
          </Text>
        </Pressable>
      </View>
    </>
  );
}

// You on the basepaths: standing in your lead, running (legs going), or
// sliding in feet first.
function Runner({ at, pose, t }: { at: { x: number; y: number; s: number }; pose: 'stand' | 'run' | 'slide'; t: number }) {
  const h = 50 * at.s * 1.5;
  const w = h * 0.6;
  const stride = pose === 'run' ? Math.sin(t / 70) * 5 : 0;
  const rot = pose === 'slide' ? -70 : pose === 'run' ? -10 : 0;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: at.x - w / 2, top: at.y - h, width: w, height: h, transform: [{ rotate: `${rot}deg` }] }}>
      <Svg width={w} height={h} viewBox="0 0 30 50">
        <Ellipse cx={15} cy={48} rx={pose === 'slide' ? 13 : 8} ry={2.5} fill="rgba(0,0,0,0.25)" />
        <Line x1={12} y1={34} x2={12 + stride} y2={47} stroke="#e9e9ed" strokeWidth={4} strokeLinecap="round" />
        <Line x1={18} y1={34} x2={18 - stride} y2={47} stroke="#e9e9ed" strokeWidth={4} strokeLinecap="round" />
        <Rect x={8} y={17} width={14} height={19} rx={5} fill={ME} />
        <Circle cx={15} cy={11} r={7.5} fill="#c08a52" />
        <Path d="M 7.5 10 Q 15 0 22.5 10 Z" fill="#2f4fa0" />
      </Svg>
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    note: { fontSize: 14.5, color: withAlpha(colors.text, 0.7), textAlign: 'center' },
    fixed: { flex: 1, paddingHorizontal: 16, gap: 8 },
    head: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
    kicker: { fontFamily: font.headingSemibold, fontSize: 11.5, letterSpacing: 0.8, color: withAlpha(colors.text, 0.6) },
    title: { fontFamily: font.headingSemibold, fontSize: 22, color: colors.text },
    bank: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: colors.surface },
    bankLabel: { fontFamily: font.headingSemibold, fontSize: 11.5, letterSpacing: 0.6 },
    bankNote: { fontSize: 12, color: withAlpha(colors.text, 0.75), marginTop: 2 },
    field: { flex: 1, minHeight: 300, borderRadius: 16, overflow: 'hidden', backgroundColor: '#1d2133' },
    chip: {
      position: 'absolute',
      top: 10,
      backgroundColor: 'rgba(15,17,28,0.8)',
      color: '#fff',
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 4,
      fontSize: 11.5,
      fontFamily: font.headingSemibold,
      overflow: 'hidden',
    },
    banner: { position: 'absolute', alignSelf: 'center', top: '30%', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10 },
    bannerText: { fontFamily: font.headingSemibold, fontSize: 20, color: '#161826' },
    scroll: { flexGrow: 0, maxHeight: 100, marginTop: 8 },
    scrollBody: { paddingHorizontal: 16, gap: 6, paddingBottom: 6 },
    msg: { fontSize: 12.5, lineHeight: 18, color: withAlpha(colors.text, 0.75) },
    today: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
    pill: {
      fontSize: 11.5,
      fontFamily: font.headingSemibold,
      color: withAlpha(colors.text, 0.7),
      backgroundColor: colors.surface,
      borderRadius: 999,
      paddingHorizontal: 9,
      paddingVertical: 3,
      overflow: 'hidden',
    },
    pillGood: { color: '#161826', backgroundColor: '#a6e3b8' },
    pinned: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 8 },
    act: { minHeight: 58, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
    actOff: { backgroundColor: withAlpha(colors.text, 0.1) },
    actText: { fontFamily: font.headingSemibold, fontSize: 18, color: '#161826', textAlign: 'center' },
  });
}
