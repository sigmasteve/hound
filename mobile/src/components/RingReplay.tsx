import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { PlayIcon } from 'phosphor-react-native';
import { Text } from './Text';
import { Boxer, Referee, RingArt, ringView, useClock, type BoxerAct } from './BoutRing';
import { project } from './perspective';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';
import type { BoutPunch } from '../challenges/boutApi';

// A scored round (Hound Bout) or fight (the Title Bout), replayed as a
// fight (0230; prototype claude.ai/artifact/UhZUFuQSocRai4ekSoXXy4): both
// hounds move around the ring between exchanges, the attacker steps in and
// throws the combination, the other slips the way they slipped, blocks or
// takes it, counters come back, and a knockdown brings the ref's count.
// Combinations cut to a closer ringside camera. Everything stands on the
// canvas through project().

const APPROACH = 450;
const BEAT = 520;
const DOWN = 1900;
const BACK = 400;
const FOOT = 650;

interface Beat {
  start: number;
  end: number;
  p: BoutPunch;
  mine: boolean;
}
interface Group {
  start: number;
  end: number;
  beats: Beat[];
  mine: boolean;
  combo: boolean;
}

function plan(punches: BoutPunch[], me: string): { groups: Group[]; total: number } {
  const groups: Group[] = [];
  let t = 500;
  let i = 0;
  while (i < punches.length) {
    const key = punches[i].exchange;
    const list: BoutPunch[] = [];
    if (key == null) list.push(punches[i++]);
    else while (i < punches.length && punches[i].exchange === key) list.push(punches[i++]);
    const g: Group = { start: t, end: 0, beats: [], mine: list[0].by === me, combo: list.filter((p) => !p.counter).length >= 2 };
    t += APPROACH;
    for (const p of list) {
      const len = BEAT + (p.knockdown ? DOWN : 0);
      g.beats.push({ start: t, end: t + len, p, mine: p.by === me });
      t += len;
    }
    t += BACK;
    g.end = t;
    t += FOOT;
    groups.push(g);
  }
  return { groups, total: t + 300 };
}

const NAME: Record<string, string> = { jab: 'Jab', hook: 'Hook', up: 'Uppercut' };

function beatLine(p: BoutPunch, who: string): string {
  const name = p.counter ? 'Counter' : NAME[p.punch] ?? 'Punch';
  if (p.quality === 'miss') return `${who}: ${name.toLowerCase()} misses`;
  if (p.countered) return `${who}: jab caught by the counter guard, +1 back`;
  if (p.blocked) return `${who}: ${name.toLowerCase()}, blocked`;
  if (p.slip === 'slipped') return `${who}: ${name.toLowerCase()}, slipped ${p.slipDir === 'duck' ? '(ducked)' : p.slipDir === 'back' ? '(leaned back)' : ''}`.trim();
  return `${who}: ${p.star ? 'STAR PUNCH ' : ''}${name.toLowerCase()} lands, +${p.points}${p.knockdown ? '. Down!' : ''}`;
}

export function RingReplay({
  punches,
  me,
  meName = 'You',
  oppName,
  apron,
  label,
}: {
  punches: BoutPunch[];
  me: string;
  meName?: string;
  oppName: string;
  apron: string;
  label: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [w, setW] = useState(0);
  const H = 290;
  const rv = useMemo(() => (w > 0 ? ringView(w, H) : null), [w]);
  const sched = useMemo(() => plan(punches, me), [punches, me]);
  const [startAt, setStartAt] = useState<number>(Date.now());
  useEffect(() => setStartAt(Date.now()), [punches]);
  const playing = Date.now() - startAt < sched.total;
  const now = useClock(playing);
  const t = now - startAt;

  if (!rv) return <View style={[styles.ring, { height: H }]} onLayout={(e) => setW(e.nativeEvent.layout.width)} />;

  const g = sched.groups.find((x) => t >= x.start && t < x.end + FOOT) ?? null;
  const beat = g?.beats.find((b) => t >= b.start && t < b.end) ?? null;
  // How far stepped in: in during the approach, out after the combination.
  let inK = 0;
  if (g) {
    if (t < g.start + APPROACH) inK = (t - g.start) / APPROACH;
    else if (t < g.end - BACK) inK = 1;
    else if (t < g.end) inK = 1 - (t - (g.end - BACK)) / BACK;
  }
  inK = Math.max(0, Math.min(1, inK));
  // Footwork: both bounce and drift around the middle.
  const oppPt = project(rv.v, 0.5 + 0.1 * Math.sin(t / 820), 0.46 + 0.14 * inK + 0.03 * Math.sin(t / 530));
  const mePt = { x: rv.me.x + w * 0.09 * Math.sin(t / 960 + 1), y: rv.v.h * 1.14 - rv.v.h * 0.04 * inK };
  const bob = (k: number) => Math.sin(t / 150 + k) * 2;

  let meAct: BoxerAct = { pose: 'idle', k: 0 };
  let oppAct: BoxerAct = { pose: 'idle', k: 0 };
  let counting: number | null = null;
  let line = t < 500 ? 'The bell. Both hounds come out and circle.' : t >= sched.total - 300 ? 'That’s the round.' : '';
  let star = false;
  if (beat) {
    const k = (t - beat.start) / BEAT;
    const throwK = Math.min(1, k / 0.45);
    const reactK = Math.max(0, Math.min(1, (k - 0.3) / 0.6));
    const p = beat.p;
    const attacker: BoxerAct = { pose: p.counter ? 'jab' : p.punch, k: throwK };
    let defender: BoxerAct;
    if (p.quality === 'miss') defender = { pose: 'slip', k: reactK * 0.5, dir: 'left' };
    else if (p.blocked || p.countered) defender = { pose: 'block', k: reactK };
    else if (p.slip === 'slipped') defender = { pose: 'slip', k: reactK, dir: (p.slipDir as BoxerAct['dir']) ?? 'left' };
    else defender = { pose: 'hit', k: reactK };
    if (p.knockdown && t - beat.start > BEAT * 0.6) {
      const dk = (t - beat.start - BEAT * 0.6) / DOWN;
      defender = { pose: 'down', k: dk < 0.85 ? Math.min(1, dk * 2) : Math.max(0, 1 - (dk - 0.85) / 0.15) };
      counting = Math.min(8, 1 + Math.floor(dk * 8));
    }
    if (beat.mine) {
      meAct = attacker;
      oppAct = defender;
    } else {
      meAct = defender;
      oppAct = attacker;
    }
    star = p.star && p.quality !== 'miss' && !p.blocked && p.slip !== 'slipped' && t - beat.start < BEAT;
    line = beatLine(p, beat.mine ? meName : oppName);
  } else if (g && t < g.start + APPROACH) {
    line = `${g.mine ? meName : oppName} steps in…`;
  }
  // Ringside for a combination.
  let z = 0;
  if (g?.combo) {
    if (t < g.start + APPROACH) z = (t - g.start) / APPROACH;
    else if (t < g.end - BACK) z = 1;
    else if (t < g.end) z = 1 - (t - (g.end - BACK)) / BACK;
  }
  z = Math.max(0, Math.min(1, z));
  const zs = 1 + 0.32 * z;
  const mx = (oppPt.x + mePt.x) / 2;
  const my = (oppPt.y + mePt.y) / 2 - rv.v.h * 0.25;
  const cam = [{ translateX: zs * (w / 2 - mx) * z }, { translateY: zs * (H / 2 - my) * z }, { scale: zs }];

  // The score so far.
  let mine = 0;
  let theirs = 0;
  for (const gr of sched.groups)
    for (const b of gr.beats) {
      if (b.start + BEAT * 0.5 > t) break;
      const p = b.p;
      const lands = p.quality !== 'miss' && !p.blocked && !p.countered && p.slip !== 'slipped';
      if (lands) {
        if (b.mine) mine += p.points;
        else theirs += p.points;
      }
      if (p.countered) {
        if (b.mine) theirs += 1;
        else mine += 1;
      }
    }
  const done = t >= sched.total;
  return (
    <View style={{ gap: 8 }}>
      <View style={[styles.ring, { height: H }]} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        <View style={[StyleSheet.absoluteFill, { transform: cam }]}>
          <RingArt rv={rv} apron={apron} compact />
          <Referee rv={rv} counting={counting} />
          <View style={[StyleSheet.absoluteFill, { transform: [{ translateY: bob(2) }] }]} pointerEvents="none">
            <Boxer at={oppPt} height={rv.v.h * 0.46 * oppPt.s} facing="front" trunks="#e05b5b" gloves="#c2410c" act={oppAct} />
          </View>
          <View style={[StyleSheet.absoluteFill, { transform: [{ translateY: bob(0) }] }]} pointerEvents="none">
            <Boxer at={mePt} height={rv.v.h * 0.44} facing="back" trunks="#4f7be0" gloves="#4f7be0" coat="#c08a52" act={meAct} />
          </View>
        </View>
        <Text style={styles.cam}>{z > 0.5 ? 'RINGSIDE' : 'MAIN CAMERA'}</Text>
        <Text style={styles.score}>
          {meName} {mine} – {theirs} {oppName}
        </Text>
        {star && <Text style={styles.star}>STAR PUNCH!</Text>}
        {punches.length === 0 && <Text style={styles.line}>Nobody threw a punch this round.</Text>}
        {!!line && punches.length > 0 && <Text style={styles.line}>{line}</Text>}
      </View>
      <View style={styles.rowBetween}>
        <Text style={styles.small}>
          {label} · {punches.length} {punches.length === 1 ? 'punch' : 'punches'}
        </Text>
        {done && (
          <Pressable onPress={() => setStartAt(Date.now())} hitSlop={8} accessibilityRole="button" style={styles.again}>
            <PlayIcon size={13} color={colors.accentActive} weight="fill" />
            <Text style={styles.link}>Watch again</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function makeStyles(colors: Palette) {
  const chip = {
    position: 'absolute' as const,
    backgroundColor: 'rgba(15,17,28,0.84)',
    color: '#fff',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontSize: 11.5,
    fontFamily: font.headingSemibold,
    overflow: 'hidden' as const,
  };
  return StyleSheet.create({
    ring: { borderRadius: 14, overflow: 'hidden', backgroundColor: '#1d2133' },
    cam: { ...chip, left: 8, top: 8 },
    score: { ...chip, right: 8, top: 8, fontSize: 12 },
    star: { position: 'absolute', alignSelf: 'center', top: '30%', backgroundColor: '#f0c24a', color: '#161826', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, fontSize: 20, fontFamily: font.headingSemibold, overflow: 'hidden' },
    line: { ...chip, left: 8, right: 8, bottom: 8, borderRadius: 10, paddingVertical: 6, textAlign: 'center', fontSize: 13 },
    rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    small: { fontSize: 12, lineHeight: 17, color: withAlpha(colors.text, 0.62) },
    again: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32 },
    link: { fontFamily: font.headingSemibold, fontSize: 13, color: colors.accentActive },
  });
}
