import React, { useEffect, useRef, useState } from 'react';
import { AppState, Animated, Easing, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { Text } from '../components/Text';
import type { Rank } from '../challenges/ranks';
import { HoundArt, type HoundMood } from './HoundArt';
import type { HoundEars, HoundMarkings, HoundTail } from './kennelItems';
import { YARD_SIZES, yardItemById, type TrophyKind, type YardSpot } from './yardItems';
import type { Yard } from './yardApi';
import { isTrick, trickById, type TrickId } from './tricks';

// The Yard (0148_yard.sql), drawn in code like the hound. One 540-wide
// world with every spot in a fixed place; a yard shows the part of it
// its size takes in (YARD_SIZES), so ranking up opens the view out and
// new spots come into it. The sky follows the time of day, and the
// hound goes where its mood puts it: zoomies when happy, by the house
// when okay, napping in bed when sleepy (and at night), by the bowl
// when hungry. Tap it for a word; press and hold to pet it; flick the
// toy and it fetches. The yard dresses up for the season on its own
// (yardSeason): leaves and pumpkins in the autumn, a jack-o'-lantern and
// bats for Halloween, snow and a wreath in winter.

const INK = '#2b1d14';

// Where each spot's item stands: the middle of its base, in world units.
const SPOT_AT: Record<YardSpot, { x: number; y: number }> = {
  house: { x: 175, y: 212 },
  plant_left: { x: 105, y: 230 },
  tree: { x: 62, y: 192 },
  bowl: { x: 346, y: 270 },
  toy: { x: 392, y: 286 },
  bed: { x: 268, y: 268 },
  fence: { x: 280, y: 122 },
  ground: { x: 196, y: 290 },
  plant_right: { x: 462, y: 236 },
  pond: { x: 500, y: 292 },
};

const TROPHY_Y = 190;
const trophyX = (i: number) => 357 + i * 34;

// The hound's spot for each pose, and how big it's drawn per yard size.
const HOUND_AT: Record<'zoomies' | 'house' | 'bed' | 'bowl', { x: number; y: number }> = {
  zoomies: { x: 300, y: 260 },
  house: { x: 196, y: 252 },
  bed: { x: 268, y: 264 },
  bowl: { x: 318, y: 266 },
};
const HOUND_SIZE = [92, 100, 108, 116, 124];
const GUEST_AT = { x: 358, y: 264 };

// Height for width: the same shape at every size.
export const YARD_ASPECT = 0.75;
const GROUND_Y = 172;
const WORLD_BOTTOM = 300;

export type YardTime = 'day' | 'evening' | 'night';
export type YardSeason = 'halloween' | 'autumn' | 'winter' | null;

// By the phone's own date: October, November, then December to mid-January.
export function yardSeason(d: Date = new Date()): YardSeason {
  const m = d.getMonth() + 1;
  if (m === 10) return 'halloween';
  if (m === 11) return 'autumn';
  if (m === 12 || (m === 1 && d.getDate() <= 15)) return 'winter';
  return null;
}

export function yardTime(d: Date = new Date()): YardTime {
  const h = d.getHours();
  if (h >= 21 || h < 6) return 'night';
  if (h >= 18 || h < 7) return 'evening';
  return 'day';
}

const SKY: Record<YardTime, [string, string]> = {
  day: ['#8fc3f0', '#f6d7a8'],
  evening: ['#3d4a8f', '#f0a77a'],
  night: ['#151a3d', '#4a3f7a'],
};
const GRASS: Record<YardTime, [string, string]> = {
  day: ['#6dbb73', '#5aa862'],
  evening: ['#4f9a5d', '#448a51'],
  night: ['#2e4a3a', '#263f31'],
};
const SNOW: Record<YardTime, [string, string]> = {
  day: ['#e9eff7', '#d7e0ec'],
  evening: ['#c9d3e6', '#b7c2d8'],
  night: ['#4a5272', '#3f4663'],
};
const FENCE: Record<YardTime, [string, string]> = {
  day: ['#e9dcc4', '#cdbb99'],
  evening: ['#c9b9a4', '#ab9a80'],
  night: ['#5c5373', '#463e5c'],
};

export interface YardHound {
  name: string;
  rank: Rank['id'];
  mood: HoundMood;
  neckId?: string | null;
  headId?: string | null;
  faceId?: string | null;
  coatId?: string | null;
  breedId?: string | null;
  bodyId?: string | null;
  feetId?: string | null;
  ears?: HoundEars;
  tail?: HoundTail;
  markings?: HoundMarkings;
}

// Where something is in a scene this wide, in pixels: a spot's item, or
// the hound where its mood puts it. For the Kennel's zoom while you pick.
export function yardFocusPoint(
  yard: Yard,
  width: number,
  target: YardSpot | 'hound',
  mood: HoundMood,
  time?: YardTime,
): { x: number; y: number; height: number } {
  const size = Math.max(0, Math.min(YARD_SIZES.length - 1, yard.size));
  const { left, width: W } = YARD_SIZES[size];
  const H = W * YARD_ASPECT;
  const top = WORLD_BOTTOM - H;
  const k = width / W;
  const night = (time ?? yardTime()) === 'night';
  let p: { x: number; y: number };
  if (target === 'hound') {
    const pose: keyof typeof HOUND_AT = night || mood === 'sleepy' ? 'bed' : mood === 'hungry' ? 'bowl' : mood === 'happy' ? 'zoomies' : 'house';
    p = { x: HOUND_AT[pose].x, y: HOUND_AT[pose].y - 48 };
  } else {
    const at = SPOT_AT[target];
    p = { x: at.x, y: at.y - (target === 'house' || target === 'tree' ? 50 : 14) };
  }
  return { x: (p.x - left) * k, y: (p.y - top) * k, height: H * k };
}

export function YardScene({
  yard,
  hound,
  width,
  animate = true,
  lines,
  time,
  season,
  guest,
  onGesture,
  water,
  tricks,
  trick,
}: {
  // Tricks owned (0158): a double-tap on the hound does the next one.
  tricks?: string[];
  // Do this one now (a preview in the shop); n goes up each time.
  trick?: { id: TrickId; n: number } | null;
  // Today's water as a share of the water goal (0153): the bowl fills
  // through the day. Undefined or null: the bowl as it's drawn.
  water?: number | null;
  yard: Yard;
  hound: YardHound;
  width: number;
  animate?: boolean;
  // What the hound says when tapped, in turn. None: tapping just wags.
  lines?: string[];
  time?: YardTime;
  // Undefined: today's (yardSeason). Null: none.
  season?: YardSeason;
  // A second hound in the yard: a friend's over to play (0150), or yours
  // tagging along on a visit. label is the tag over it; line what it
  // says when tapped.
  guest?: { hound: YardHound; label: string; line?: string } | null;
  // True while a finger is throwing the toy: the screen should stop its
  // ScrollView scrolling until it's false again, or a flick scrolls the
  // page instead.
  onGesture?: (active: boolean) => void;
}) {
  const size = Math.max(0, Math.min(YARD_SIZES.length - 1, yard.size));
  const { left, width: W } = YARD_SIZES[size];
  const H = W * YARD_ASPECT;
  const top = WORLD_BOTTOM - H;
  const k = width / W;
  const t = time ?? yardTime();
  const night = t === 'night';
  const sn = season === undefined ? yardSeason() : season;
  const grass = sn === 'winter' ? SNOW[t] : GRASS[t];

  // Only while the app is in front.
  const [awake, setAwake] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAwake(s === 'active'));
    return () => sub.remove();
  }, []);
  const moving = animate && awake;

  const pose: keyof typeof HOUND_AT =
    night || hound.mood === 'sleepy' ? 'bed' : hound.mood === 'hungry' ? 'bowl' : hound.mood === 'happy' ? 'zoomies' : 'house';
  const artMood: HoundMood = night ? 'sleepy' : hound.mood;
  const houndW = HOUND_SIZE[size] * k;
  // In bed it lies down; a hammock holds it up off the ground.
  const bedId = yard.spots.bed ?? 'bed_cushion';
  const inHammock = pose === 'bed' && bedId === 'bed_hammock';
  const at = inHammock ? { x: HOUND_AT.bed.x, y: HOUND_AT.bed.y - 14 } : HOUND_AT[pose];
  const houndLeft = (at.x - left) * k - houndW / 2;
  const houndTop = (at.y - top) * k - houndW * 1.2 * 0.98;
  // Over by the trophies; in zoomies it runs the other way, so the two
  // chase each other. At night everyone's gone home.
  const showGuest = !!guest && !night;
  const guestLeft = (GUEST_AT.x - left) * k - houndW / 2;
  const guestTop = (GUEST_AT.y - top) * k - houndW * 1.2 * 0.98;

  // Fetch: the hound's run out and back, on top of anything else.
  const [fetching, setFetching] = useState(false);
  const fetchingRef = useRef(false);
  const chase = useRef(new Animated.Value(0)).current;
  const toyPos = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  // Zoomies: a dash one way, then the other, then a breather.
  const run = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!moving || pose !== 'zoomies' || fetching) {
      run.setValue(0);
      return;
    }
    const dash = (to: number, ms: number) =>
      Animated.timing(run, { toValue: to, duration: ms, easing: Easing.inOut(Easing.quad), useNativeDriver: true });
    const loop = Animated.loop(Animated.sequence([dash(1, 650), dash(-1, 1100), dash(0, 600), Animated.delay(2600)]));
    loop.start();
    return () => loop.stop();
  }, [moving, pose, run, fetching]);

  // A stroll (the shop design's "walking"): every 20 to 40 seconds in the
  // day, over to the toy, the bowl, a plant or the pond, a sniff, and
  // back. A trot while it goes. Not while it's in bed, doing zoomies or
  // fetching.
  const strollX = useRef(new Animated.Value(0)).current;
  const strollY = useRef(new Animated.Value(0)).current;
  const step = useRef(new Animated.Value(0)).current;
  const spotsKey = JSON.stringify(yard.spots);
  useEffect(() => {
    if (!moving || pose === 'bed' || pose === 'zoomies' || fetching) {
      strollX.setValue(0);
      strollY.setValue(0);
      step.setValue(0);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const trot = Animated.loop(
      Animated.sequence([
        Animated.timing(step, { toValue: 1, duration: 170, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(step, { toValue: 0, duration: 170, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]),
    );
    const places = (['toy', 'bowl', 'plant_left', 'plant_right', 'pond', 'tree'] as YardSpot[]).filter(
      (sp) => yard.spots[sp] && SPOT_AT[sp].x > left + 40 && SPOT_AT[sp].x < left + W - 40,
    );
    const walkTo = (x: number, y: number, done: (ok: boolean) => void) => {
      const dx = (x - at.x) * k;
      const dy = (y - at.y) * k;
      const ms = Math.max(900, (Math.hypot(dx, dy) / (55 * k)) * 1000);
      trot.start();
      Animated.parallel([
        Animated.timing(strollX, { toValue: dx, duration: ms, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(strollY, { toValue: dy, duration: ms, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]).start(({ finished }) => {
        trot.stop();
        step.setValue(0);
        done(finished && !cancelled);
      });
    };
    const next = (first: boolean) => {
      timer = setTimeout(
        () => {
          if (cancelled || places.length === 0) return;
          const sp = places[Math.floor(Math.random() * places.length)];
          const to = SPOT_AT[sp];
          // Beside it, not on top of it.
          const side = to.x > at.x ? -1 : 1;
          walkTo(to.x + side * 34, Math.min(WORLD_BOTTOM - 8, to.y + 2), (ok) => {
            if (!ok) return;
            timer = setTimeout(() => walkTo(at.x, at.y, (back) => back && next(false)), 4000 + Math.random() * 4000);
          });
        },
        first ? 6000 + Math.random() * 6000 : 20000 + Math.random() * 20000,
      );
    };
    next(true);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      trot.stop();
      strollX.stopAnimation();
      strollY.stopAnimation();
      strollX.setValue(0);
      strollY.setValue(0);
      step.setValue(0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moving, pose, fetching, spotsKey, left, W, k]);

  // The hammock sways with the hound in it.
  const sway = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!moving || !inHammock) {
      sway.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sway, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(sway, { toValue: -1, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [moving, inHammock, sway]);

  // A tap: a hop and a word. Press and hold: hearts.
  const hop = useRef(new Animated.Value(0)).current;
  const [said, setSaid] = useState<string | null>(null);
  // Whose bubble it is.
  const [saidBy, setSaidBy] = useState<'host' | 'guest'>('host');
  const lineIx = useRef(0);
  const hearts = useRef(new Animated.Value(0)).current;
  const [petting, setPetting] = useState(false);
  useEffect(() => {
    if (!said) return;
    const id = setTimeout(() => setSaid(null), 2600);
    return () => clearTimeout(id);
  }, [said]);

  const onTap = (line?: string) => {
    setSaidBy('host');
    hop.setValue(0);
    Animated.sequence([
      Animated.timing(hop, { toValue: 1, duration: 140, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.spring(hop, { toValue: 0, friction: 4, useNativeDriver: true }),
    ]).start();
    // At night it's asleep whatever its mood.
    const say = night && lines && lines.length > 0 ? ['Zzz…', 'It’s bedtime. See you in the morning!'] : lines;
    if (line) {
      sayNow(line);
    } else if (say && say.length > 0) {
      setSaid(say[lineIx.current % say.length]);
      lineIx.current += 1;
    }
  };
  const onTapRef = useRef<((line?: string) => void) | null>(null);
  onTapRef.current = onTap;
  const sayNow = (line: string) => {
    setSaid(null);
    setTimeout(() => setSaid(line), 0);
  };

  // Tricks (0158): a double-tap does the next one owned; the shop's
  // preview asks for one by id.
  const trickAnim = useRef(new Animated.Value(0)).current;
  const [doing, setDoing] = useState<TrickId | null>(null);
  const doingRef = useRef(false);
  const perform = (id: TrickId) => {
    if (fetchingRef.current || doingRef.current) return;
    doingRef.current = true;
    setDoing(id);
    setSaid(null);
    trickAnim.setValue(0);
    Animated.timing(trickAnim, {
      toValue: 1,
      duration: id === 'trick_playdead' ? 2200 : id === 'trick_highfive' ? 1300 : 1000,
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: true,
    }).start(() => {
      doingRef.current = false;
      setDoing(null);
      trickAnim.setValue(0);
      const t = trickById(id);
      if (t) sayNow(t.line);
    });
  };
  useEffect(() => {
    if (trick) perform(trick.id);
    // A new request only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trick?.n]);
  const lastTap = useRef(0);
  const trickIx = useRef(0);
  const press = () => {
    const now = Date.now();
    const owned = (tricks ?? []).filter(isTrick);
    if (now - lastTap.current < 330 && owned.length > 0) {
      lastTap.current = 0;
      if (night) {
        sayNow('Zzz… tricks in the morning.');
        return;
      }
      perform(owned[trickIx.current % owned.length]);
      trickIx.current += 1;
      return;
    }
    lastTap.current = now;
    onTap();
  };

  // Flick the toy (or tap it): it flies, the hound runs it down and
  // brings it back. flick is how far the finger went, in pixels; 0 throws
  // it a random way.
  const toyId = yard.spots.toy ?? null;
  const toyAt = SPOT_AT.toy;
  const toyPxX = (toyAt.x - left) * k;
  const toyPxY = (toyAt.y - top) * k;
  const throwToy = (flick: number) => {
    if (fetchingRef.current || !toyId) return;
    if (night) {
      sayNow('Zzz… fetch in the morning.');
      return;
    }
    fetchingRef.current = true;
    setFetching(true);
    setSaid(null);
    const way = flick === 0 ? (Math.random() < 0.5 ? -1 : 1) * (90 + Math.random() * 70) : (flick / k) * 2.5;
    const landX = Math.max(left + 34, Math.min(left + W - 34, toyAt.x + way));
    const landY = 262 + Math.random() * 22;
    const dx = (landX - toyAt.x) * k;
    const dy = (landY - toyAt.y) * k;
    const chaseTo = (landX - at.x) * k - Math.sign(landX - at.x) * houndW * 0.15;
    const runMs = 260 + Math.abs(chaseTo / k) * 4;
    const mouth = (c: number) => ({
      x: houndLeft + houndW / 2 + c - toyPxX,
      y: houndTop + houndW * 1.2 * 0.62 - toyPxY,
    });
    const ease = (v: Animated.Value, to: number, ms: number, easing = Easing.inOut(Easing.quad)) =>
      Animated.timing(v, { toValue: to, duration: ms, easing, useNativeDriver: true });
    Animated.sequence([
      Animated.parallel([
        ease(toyPos.x, dx, 650, Easing.out(Easing.quad)),
        Animated.sequence([ease(toyPos.y, Math.min(dy, 0) - 70 * k, 300, Easing.out(Easing.quad)), ease(toyPos.y, dy, 380, Easing.bounce)]),
        Animated.sequence([Animated.delay(250), ease(chase, chaseTo, runMs)]),
      ]),
      // Picks it up, and trots back with it.
      Animated.parallel([ease(toyPos.x, mouth(chaseTo).x, 160), ease(toyPos.y, mouth(chaseTo).y, 160)]),
      Animated.parallel([ease(chase, 0, runMs + 200), ease(toyPos.x, mouth(0).x, runMs + 200), ease(toyPos.y, mouth(0).y, runMs + 200)]),
      Animated.parallel([ease(toyPos.x, 0, 320, Easing.out(Easing.quad)), ease(toyPos.y, 0, 320, Easing.bounce)]),
    ]).start(() => {
      fetchingRef.current = false;
      setFetching(false);
      onTapRef.current?.(['Again! Again!', 'Got it!', 'One more?'][Math.floor(Math.random() * 3)]);
    });
  };
  const throwRef = useRef(throwToy);
  throwRef.current = throwToy;
  const gestureRef = useRef(onGesture);
  gestureRef.current = onGesture;
  // A touch on the toy is the toy's from the start: the page holds still
  // until the finger lifts.
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => gestureRef.current?.(true),
      onPanResponderTerminationRequest: () => false,
      onPanResponderRelease: (_, g) => {
        gestureRef.current?.(false);
        throwRef.current(Math.abs(g.dx) + Math.abs(g.dy) < 8 ? 0 : g.dx + g.vx * 120);
      },
      onPanResponderTerminate: () => gestureRef.current?.(false),
    }),
  ).current;
  // The yard is a play area: a touch anywhere on it is the yard's (taps
  // on a hound or the toy still go to them, which claim theirs first),
  // so swiping inside it never scrolls the page. A swipe throws the toy
  // that way; straight up or down throws it a random way; a tap on the
  // grass does nothing.
  const sweep = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => gestureRef.current?.(true),
      onPanResponderTerminationRequest: () => false,
      onPanResponderRelease: (_, g) => {
        gestureRef.current?.(false);
        if (Math.abs(g.dx) + Math.abs(g.dy) < 12) return;
        throwRef.current(Math.abs(g.dx) > Math.abs(g.dy) * 0.5 ? g.dx + g.vx * 120 : 0);
      },
      onPanResponderTerminate: () => gestureRef.current?.(false),
    }),
  ).current;

  const guestHop = useRef(new Animated.Value(0)).current;
  const onGuestTap = () => {
    guestHop.setValue(0);
    Animated.sequence([
      Animated.timing(guestHop, { toValue: 1, duration: 140, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.spring(guestHop, { toValue: 0, friction: 4, useNativeDriver: true }),
    ]).start();
    if (guest?.line) {
      setSaidBy('guest');
      sayNow(guest.line);
    }
  };

  const onPet = () => {
    setPetting(true);
    hearts.setValue(0);
    Animated.timing(hearts, { toValue: 1, duration: 1400, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(() =>
      setPetting(false),
    );
  };

  const runPx = 46 * k;
  const houndStyle = {
    position: 'absolute' as const,
    left: houndLeft,
    top: houndTop,
    width: houndW,
    height: houndW * 1.2,
    transform: [
      {
        translateX: Animated.add(
          Animated.add(run.interpolate({ inputRange: [-1, 1], outputRange: [-runPx, runPx] }), chase),
          Animated.add(strollX, sway.interpolate({ inputRange: [-1, 1], outputRange: [-3 * k, 3 * k] })),
        ),
      },
      {
        translateY: Animated.add(
          Animated.add(hop.interpolate({ inputRange: [0, 1], outputRange: [0, -houndW * 0.18] }), strollY),
          step.interpolate({ inputRange: [0, 1], outputRange: [0, -houndW * 0.05] }),
        ),
      },
      { rotate: Animated.add(step, sway).interpolate({ inputRange: [-1, 0, 1], outputRange: ['-2deg', '0deg', '3deg'] }) },
      // The trick being done, if any.
      {
        translateY:
          doing === 'trick_rollover' || doing === 'trick_spin'
            ? trickAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, -houndW * 0.22, 0] })
            : doing === 'trick_playdead'
              ? trickAnim.interpolate({ inputRange: [0, 0.15, 0.85, 1], outputRange: [0, houndW * 0.2, houndW * 0.2, 0] })
              : doing === 'trick_highfive'
                ? trickAnim.interpolate({ inputRange: [0, 0.2, 0.8, 1], outputRange: [0, -houndW * 0.06, -houndW * 0.06, 0] })
                : 0,
      },
      {
        rotate:
          doing === 'trick_rollover'
            ? trickAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] })
            : doing === 'trick_playdead'
              ? trickAnim.interpolate({ inputRange: [0, 0.15, 0.85, 1], outputRange: ['0deg', '90deg', '90deg', '0deg'] })
              : doing === 'trick_highfive'
                ? trickAnim.interpolate({ inputRange: [0, 0.2, 0.8, 1], outputRange: ['0deg', '-7deg', '-7deg', '0deg'] })
                : '0deg',
      },
      { scaleX: doing === 'trick_spin' ? trickAnim.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [1, -1, 1, -1, 1] }) : 1 },
    ],
  };

  const spots = yard.spots;
  const place = (spot: YardSpot) => {
    const id = spots[spot];
    if (!id) return null;
    const p = SPOT_AT[spot];
    const fill = spot === 'bowl' && water != null ? Math.max(0, Math.min(1, water)) : 0;
    return (
      <G key={spot} transform={`translate(${p.x} ${p.y})`}>
        <YardItemArt id={id} name={hound.name} time={t} />
        {fill > 0 && (
          <G>
            <Ellipse cx={0} cy={-10 + (1 - fill) * 1.5} rx={6 + 6.5 * fill} ry={1.6 + 2 * fill} fill={night ? '#3a86b8' : '#5ec8f2'} />
            <Ellipse cx={-3 * fill} cy={-11 + (1 - fill) * 1.5} rx={3 * fill} ry={0.8 * fill} fill="#ffffff" opacity={0.6} />
          </G>
        )}
      </G>
    );
  };

  return (
    <View style={{ width, height: H * k, overflow: 'hidden', borderRadius: 14 }} {...(toyId ? sweep.panHandlers : {})}>
      <Svg width={width} height={H * k} viewBox={`${left} ${top} ${W} ${H}`}>
        <Defs>
          <LinearGradient id="yardSky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={SKY[t][0]} />
            <Stop offset="1" stopColor={SKY[t][1]} />
          </LinearGradient>
        </Defs>
        <Rect x={left} y={top} width={W} height={GROUND_Y - top + 4} fill="url(#yardSky)" />
        <SkyThings time={t} left={left} top={top} width={W} />

        {place('tree')}
        <Fence time={t} left={left} width={W} />
        <Rect x={left} y={GROUND_Y} width={W} height={WORLD_BOTTOM - GROUND_Y} fill={grass[0]} />
        <Rect x={left} y={GROUND_Y} width={W} height={10} fill={grass[1]} />
        {sn && <SeasonBack season={sn} left={left} width={W} top={top} time={t} />}
        {size < YARD_SIZES.length - 1 && <Hedges left={left} width={W} night={night} />}

        {yard.shown.slice(0, size + 1).map((kind, i) => (
          <G key={kind} transform={`translate(${trophyX(i)} ${TROPHY_Y})`}>
            <TrophyArt kind={kind} />
          </G>
        ))}
        {place('house')}
        {place('ground')}
        {place('plant_left')}
        {place('plant_right')}
        {place('pond')}
        {place('bowl')}
        {place('bed')}
        {sn && <SeasonFront season={sn} left={left} width={W} top={top} time={t} hasHouse={!!spots.house} />}
        {yard.pawprints > 0 && <Pawprints n={Math.min(6, yard.pawprints)} left={left} />}
        {night && <Rect x={left} y={top} width={W} height={H} fill="#0b0d2a" opacity={0.28} />}
        {place('fence')}
      </Svg>

      {showGuest && guest && (
        <Animated.View
          style={{
            position: 'absolute',
            left: guestLeft,
            top: guestTop,
            width: houndW,
            height: houndW * 1.2,
            transform: [
              { translateX: Animated.multiply(run.interpolate({ inputRange: [-1, 1], outputRange: [-runPx, runPx] }), -1) },
              { translateY: guestHop.interpolate({ inputRange: [0, 1], outputRange: [0, -houndW * 0.18] }) },
            ],
          }}
        >
          <Pressable onPress={onGuestTap} hitSlop={8} accessibilityRole="button" accessibilityLabel={guest.label}>
            <HoundArt
              rank={guest.hound.rank}
              mood={guest.hound.mood}
              neckId={guest.hound.neckId}
              headId={guest.hound.headId}
              faceId={guest.hound.faceId}
              coatId={guest.hound.coatId}
              breedId={guest.hound.breedId}
              bodyId={guest.hound.bodyId}
              feetId={guest.hound.feetId}
              ears={guest.hound.ears}
              tail={guest.hound.tail}
              markings={guest.hound.markings}
              size={houndW}
              animate={moving}
            />
          </Pressable>
          <View pointerEvents="none" style={styles.guestTag}>
            <Text style={styles.guestTagText} numberOfLines={1}>
              {guest.label}
            </Text>
          </View>
        </Animated.View>
      )}

      <Animated.View style={houndStyle}>
        <Pressable
          onPress={press}
          onLongPress={onPet}
          delayLongPress={350}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`${hound.name}. Tap to say hi, press and hold to pet${(tricks ?? []).some(isTrick) ? ', double-tap for a trick' : ''}.`}
        >
          <HoundArt
            rank={hound.rank}
            mood={doing === 'trick_playdead' ? 'sleepy' : artMood}
            wave={doing === 'trick_highfive'}
            neckId={hound.neckId}
            headId={hound.headId}
            faceId={hound.faceId}
            coatId={hound.coatId}
            breedId={hound.breedId}
            bodyId={hound.bodyId}
            feetId={hound.feetId}
            pose={pose === 'bed' ? 'lie' : 'sit'}
            ears={hound.ears}
            tail={hound.tail}
            markings={hound.markings}
            size={houndW}
            animate={moving}
          />
        </Pressable>
      </Animated.View>

      {/* The front of the bed over the hound, so it's lying in it: the
          donut's rim, or the hammock's near edge. */}
      {pose === 'bed' && (bedId === 'bed_donut' || inHammock) && (
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            inHammock && { transform: [{ translateX: sway.interpolate({ inputRange: [-1, 1], outputRange: [-3 * k, 3 * k] }) }] },
          ]}
        >
          <Svg width={width} height={H * k} viewBox={`${left} ${top} ${W} ${H}`}>
            <G transform={`translate(${SPOT_AT.bed.x} ${SPOT_AT.bed.y})`}>
              {inHammock ? (
                <Path d="M-40 -26 Q0 4 40 -26 L38 -20 Q0 10 -38 -20 Z" fill="#e0a94f" />
              ) : (
                <Path d="M-37 -12 Q-37 1 0 1 Q37 1 37 -12 Q30 -4 0 -4 Q-30 -4 -37 -12 Z" fill="#5d5294" />
              )}
            </G>
          </Svg>
        </Animated.View>
      )}

      {toyId && (
        <Animated.View
          {...pan.panHandlers}
          hitSlop={{ top: 18, bottom: 18, left: 18, right: 18 }}
          accessible
          accessibilityRole="button"
          accessibilityLabel={`Throw the ${yardItemById(toyId)?.name ?? 'toy'}`}
          onAccessibilityTap={() => throwToy(0)}
          style={{
            position: 'absolute',
            left: toyPxX - 36 * k,
            top: toyPxY - 40 * k,
            width: 72 * k,
            height: 48 * k,
            transform: toyPos.getTranslateTransform(),
          }}
        >
          <Svg width={72 * k} height={48 * k} viewBox="-36 -40 72 48">
            <YardItemArt id={toyId} />
          </Svg>
        </Animated.View>
      )}

      {petting && (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill]}>
          {[-0.22, 0.05, 0.3].map((dx, i) => (
            <Animated.Text
              key={i}
              style={{
                position: 'absolute',
                left: houndLeft + houndW / 2 + dx * houndW - 7,
                top: houndTop + houndW * 0.15,
                fontSize: 16,
                color: '#e8737a',
                opacity: hearts.interpolate({ inputRange: [0, 0.15, 0.75, 1], outputRange: [0, 1, 1, 0] }),
                transform: [{ translateY: hearts.interpolate({ inputRange: [0, 1], outputRange: [0, -houndW * (0.45 + i * 0.12)] }) }],
              }}
            >
              ♥
            </Animated.Text>
          ))}
        </View>
      )}

      {said && (
        <View
          pointerEvents="none"
          style={[
            styles.bubble,
            {
              left: Math.max(6, Math.min(width - 186, (saidBy === 'guest' && showGuest ? guestLeft - houndW * 0.6 : houndLeft + houndW * 0.55))),
              top: Math.max(6, (saidBy === 'guest' && showGuest ? guestTop : houndTop) - 8),
            },
          ]}
        >
          <Text style={styles.bubbleText} numberOfLines={2}>
            {said}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    position: 'absolute',
    maxWidth: 180,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  bubbleText: { color: '#1b1d29', fontSize: 12.5, fontWeight: '600' },
  guestTag: {
    position: 'absolute',
    top: -2,
    alignSelf: 'center',
    maxWidth: 120,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  guestTagText: { color: '#ffffff', fontSize: 10.5, fontWeight: '600' },
});

// Seasonal dressing behind the house and trophies: snow on the fence and
// along its foot,
// and Halloween's bats in an evening or night sky.
function SeasonBack({ season, left, width, top, time }: { season: NonNullable<YardSeason>; left: number; width: number; top: number; time: YardTime }) {
  if (season === 'winter') {
    const flakes = [];
    for (let i = 0; i < 26; i++) {
      const fx = ((i * 37) % 100) / 100;
      const fy = ((i * 53) % 100) / 100;
      flakes.push(<Circle key={i} cx={left + fx * width} cy={top + 6 + fy * (GROUND_Y - top - 10)} r={i % 3 === 0 ? 1.8 : 1.2} fill="#ffffff" opacity={0.85} />);
    }
    const caps = [];
    const start = Math.floor(left / 20) * 20;
    for (let x = start; x < left + width; x += 20) {
      caps.push(<Path key={x} d={`M${x + 1} 121 L${x + 10} 111 L${x + 19} 121 Q${x + 10} 117 ${x + 1} 121 Z`} fill="#ffffff" />);
    }
    return (
      <G>
        {flakes}
        {caps}
        <Rect x={left} y={130} width={width} height={3} rx={1.5} fill="#ffffff" />
        <Rect x={left} y={158} width={width} height={3} rx={1.5} fill="#ffffff" />
        {[0.1, 0.32, 0.55, 0.78, 0.95].map((f) => (
          <Ellipse key={f} cx={left + f * width} cy={182} rx={30} ry={6} fill="#ffffff" opacity={0.9} />
        ))}
      </G>
    );
  }
  if (season === 'halloween' && time !== 'day') {
    const bat = (x: number, y: number, s: number) => (
      <Path
        key={`${x}`}
        transform={`translate(${x} ${y}) scale(${s})`}
        d="M0 0 Q-4 -4 -8 -2 Q-12 -6 -18 -2 Q-13 0 -12 4 Q-8 2 -5 5 Q-2 2 0 4 Q2 2 5 5 Q8 2 12 4 Q13 0 18 -2 Q12 -6 8 -2 Q4 -4 0 0 Z"
        fill="#1b1d29"
      />
    );
    return (
      <G>
        {bat(left + width * 0.28, top + 34, 0.9)}
        {bat(left + width * 0.42, top + 52, 0.7)}
        {bat(left + width * 0.6, top + 28, 0.6)}
      </G>
    );
  }
  return null;
}

// Seasonal dressing in front: autumn leaves and pumpkins, a jack-o'-
// lantern, snow drifts and a wreath on the house.
function SeasonFront({
  season,
  left,
  width,
  time,
  hasHouse,
}: {
  season: NonNullable<YardSeason>;
  left: number;
  width: number;
  top: number;
  time: YardTime;
  hasHouse: boolean;
}) {
  const house = SPOT_AT.house;
  if (season === 'autumn') {
    const leaves = [];
    const colors = ['#e07b2a', '#c94a2a', '#e0a94f', '#a3402a'];
    for (let i = 0; i < 34; i++) {
      const x = left + (((i * 61) % 100) / 100) * width;
      const y = 184 + ((i * 29) % 110);
      leaves.push(
        <Ellipse key={i} cx={x} cy={y} rx={3.2} ry={1.8} fill={colors[i % colors.length]} transform={`rotate(${(i * 47) % 180} ${x} ${y})`} />,
      );
    }
    return (
      <G>
        {leaves}
        <G transform={`translate(${house.x + 58} ${house.y + 2})`}>
          <Pumpkin x={0} s={1} />
          <Pumpkin x={13} s={0.7} />
        </G>
      </G>
    );
  }
  if (season === 'halloween') {
    const lit = time !== 'day';
    return (
      <G transform={`translate(${house.x + 60} ${house.y + 2})`}>
        {lit && <Circle cx={0} cy={-9} r={16} fill="#f2c84b" opacity={0.25} />}
        <Pumpkin x={0} s={1.2} />
        <Path d="M-6 -12 L-3 -15 L0 -12 Z M2 -12 L5 -15 L8 -12 Z" fill={lit ? '#ffe28a' : '#5e2314'} transform="translate(-1 0)" />
        <Path d="M-6 -6 Q1 -2 8 -6 L6 -4 Q1 -1 -4 -4 Z" fill={lit ? '#ffe28a' : '#5e2314'} />
      </G>
    );
  }
  // Winter: snow on the roof, and a wreath over the door.
  return (
    <G>
      {hasHouse && (
        <G transform={`translate(${house.x} ${house.y})`}>
          <Path d="M-53 -60 L0 -105 L53 -60 L47 -58 L0 -97 L-47 -58 Z" fill="#ffffff" />
          <Circle cx={0} cy={-60} r={7} fill="none" stroke="#3f9a57" strokeWidth={4} />
          <Path d="M-4 -54 L0 -57 L4 -54 L2 -51 L0 -53 L-2 -51 Z" fill="#d94a4a" />
        </G>
      )}
    </G>
  );
}

// Friends' pawprints by the gate, one trail mark per friend.
function Pawprints({ n, left }: { n: number; left: number }) {
  const marks = [];
  for (let i = 0; i < n; i++) {
    const x = left + 26 + i * 16;
    const y = 292 - (i % 2) * 7;
    marks.push(
      <G key={i} transform={`translate(${x} ${y}) rotate(-12)`} fill="#ffffff" opacity={0.7}>
        <Ellipse cx={0} cy={2} rx={3.6} ry={3} />
        <Circle cx={-3.6} cy={-2.2} r={1.4} />
        <Circle cx={-1.2} cy={-3.8} r={1.4} />
        <Circle cx={1.5} cy={-3.8} r={1.4} />
        <Circle cx={3.9} cy={-2.2} r={1.4} />
      </G>,
    );
  }
  return <G>{marks}</G>;
}

function Pumpkin({ x, s }: { x: number; s: number }) {
  return (
    <G transform={`translate(${x} 0) scale(${s})`}>
      <Ellipse cx={0} cy={-8} rx={11} ry={8} fill="#e07b2a" />
      <Path d="M-4 -15 Q-6 -8 -4 -1 M4 -15 Q6 -8 4 -1" stroke="#b85d1c" strokeWidth={1.2} fill="none" />
      <Rect x={-1.2} y={-19} width={2.4} height={4} fill="#3f9a57" />
    </G>
  );
}

function SkyThings({ time, left, top, width }: { time: YardTime; left: number; top: number; width: number }) {
  const sx = left + width - 52;
  const sy = top + 40;
  if (time === 'night') {
    const stars = [
      [0.06, 0.2], [0.17, 0.45], [0.3, 0.15], [0.42, 0.55], [0.52, 0.25], [0.63, 0.5], [0.72, 0.12], [0.86, 0.6], [0.94, 0.3],
    ];
    const skyH = GROUND_Y - 60 - top;
    return (
      <G>
        {stars.map(([fx, fy], i) => (
          <Circle key={i} cx={left + fx * width} cy={top + 8 + fy * skyH} r={1.4} fill="#ffffff" opacity={0.8} />
        ))}
        <Circle cx={sx} cy={sy} r={17} fill="#f4efd8" />
        <Circle cx={sx - 8} cy={sy - 6} r={16} fill="#1e2350" />
      </G>
    );
  }
  return (
    <G>
      <Circle cx={sx} cy={sy} r={30} fill={time === 'day' ? '#ffe9a8' : '#ffb27a'} opacity={0.3} />
      <Circle cx={sx} cy={sy} r={19} fill={time === 'day' ? '#ffe9a8' : '#ffb27a'} />
      <G fill="#ffffff" opacity={time === 'day' ? 0.85 : 0.35}>
        <Ellipse cx={left + 60} cy={top + 34} rx={24} ry={8} />
        <Ellipse cx={left + 76} cy={top + 28} rx={15} ry={9} />
        <Ellipse cx={left + width * 0.5} cy={top + 62} rx={20} ry={6} />
      </G>
    </G>
  );
}

function Fence({ time, left, width }: { time: YardTime; left: number; width: number }) {
  const [c, d] = FENCE[time];
  const posts = [];
  const start = Math.floor(left / 20) * 20;
  for (let x = start; x < left + width; x += 20) {
    posts.push(<Path key={x} d={`M${x + 2} 180 L${x + 2} 120 L${x + 10} 112 L${x + 18} 120 L${x + 18} 180 Z`} fill={c} />);
  }
  return (
    <G>
      <Rect x={left} y={132} width={width} height={6} fill={d} />
      <Rect x={left} y={160} width={width} height={6} fill={d} />
      {posts}
    </G>
  );
}

// A low hedge at each side: the edge of a yard that can still grow.
function Hedges({ left, width, night }: { left: number; width: number; night: boolean }) {
  const fill = night ? '#22382b' : '#3f8a4f';
  const side = (x: number) => (
    <G key={x}>
      <Rect x={x - 7} y={150} width={14} height={WORLD_BOTTOM - 150} fill={fill} />
      {[154, 176, 198, 220, 242, 264, 286].map((y) => (
        <Circle key={y} cx={x} cy={y} r={9} fill={fill} />
      ))}
    </G>
  );
  return (
    <G>
      {side(left + 4)}
      {side(left + width - 4)}
    </G>
  );
}

// One yard item, drawn around the middle of its base (0, 0).
export function YardItemArt({ id, name, time = 'day' }: { id: string; name?: string; time?: YardTime }) {
  switch (id) {
    case 'house_classic':
    case 'house_barn':
    case 'house_cabin':
    case 'house_gingerbread':
    case 'house_igloo':
    case 'house_bungalow':
    case 'house_glass':
    case 'house_treehouse':
    case 'house_castle':
    case 'house_mansion':
      return <House id={id} name={name} time={time} />;
    case 'bed_cushion':
      return (
        <G>
          <Rect x={-36} y={-20} width={72} height={20} rx={9} fill="#b84a4a" />
          <Path d="M-24 -20 V0 M-8 -20 V0 M8 -20 V0 M24 -20 V0 M-36 -13 H36 M-36 -6 H36" stroke="#e8c26b" strokeWidth={2} opacity={0.55} />
        </G>
      );
    case 'bed_donut':
      return (
        <G>
          <Ellipse cx={0} cy={-12} rx={37} ry={13} fill="#5d5294" />
          <Ellipse cx={0} cy={-15} rx={26} ry={7} fill="#b5abfc" />
        </G>
      );
    case 'bed_hammock':
      return (
        <G>
          <Path d="M-38 0 V-36 M38 0 V-36" stroke="#7a4a24" strokeWidth={3.5} />
          <Path d="M-38 -30 Q0 -2 38 -30" stroke="#e0a94f" strokeWidth={8} fill="none" />
        </G>
      );
    case 'bowl_classic':
    case 'bowl_gold': {
      const gold = id === 'bowl_gold';
      return (
        <G>
          <Ellipse cx={0} cy={-10} rx={13} ry={4} fill="#9a5c2e" />
          <Path d="M-16 -10 L16 -10 L12 0 L-12 0 Z" fill={gold ? '#f2c84b' : '#e0a94f'} />
          {gold && <Path d="M-10 -7 L-7 -2" stroke="#fff6d0" strokeWidth={2} strokeLinecap="round" />}
          {!gold && (
            <SvgText x={0} y={-2.5} fontSize={5.5} fontWeight="bold" textAnchor="middle" fill="#7a4a24">
              HOUND
            </SvgText>
          )}
        </G>
      );
    }
    case 'toy_ball':
      return (
        <G>
          <Circle cx={0} cy={-7} r={7} fill="#d7e84b" />
          <Path d="M-6 -10 Q0 -5 6 -10 M-6 -3 Q0 -8 6 -3" stroke="#ffffff" strokeWidth={1.4} fill="none" />
        </G>
      );
    case 'toy_rope':
      return (
        <G>
          <Path d="M-16 -5 Q-8 -11 0 -5 Q8 1 16 -5" stroke="#e8737a" strokeWidth={5} fill="none" strokeLinecap="round" />
          <Path d="M-16 -5 Q-8 -11 0 -5 Q8 1 16 -5" stroke="#ffffff" strokeWidth={1.5} strokeDasharray="3 3" fill="none" />
          <Circle cx={-18} cy={-5} r={4} fill="#e8737a" />
          <Circle cx={18} cy={-5} r={4} fill="#e8737a" />
        </G>
      );
    case 'toy_duck':
      return (
        <G>
          <Ellipse cx={0} cy={-6} rx={10} ry={6} fill="#f2c84b" />
          <Circle cx={6} cy={-14} r={5} fill="#f2c84b" />
          <Path d="M10 -14 L15 -13 L10 -11 Z" fill="#e07b2a" />
          <Circle cx={7} cy={-15} r={1} fill={INK} />
        </G>
      );
    case 'plant_fern':
      return (
        <G>
          <Path
            d="M0 -14 Q-16 -32 -20 -46 M0 -14 Q-4 -40 -2 -56 M0 -14 Q10 -36 18 -48 M0 -14 Q16 -26 24 -32"
            stroke="#57b56c"
            strokeWidth={6}
            fill="none"
            strokeLinecap="round"
          />
          <Rect x={-12} y={-16} width={24} height={16} rx={3} fill="#9184d9" />
        </G>
      );
    case 'plant_sunflower':
      return (
        <G>
          <Path d="M0 -14 L0 -56" stroke="#3f9a57" strokeWidth={3} />
          <Ellipse cx={-7} cy={-32} rx={8} ry={4} fill="#57b56c" transform="rotate(-30 -7 -32)" />
          <G transform="translate(0 -60)">
            {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
              <Ellipse key={a} cx={0} cy={-8} rx={4} ry={7} fill="#f2c84b" transform={`rotate(${a})`} />
            ))}
            <Circle r={6} fill="#7a4a24" />
          </G>
          <Rect x={-11} y={-16} width={22} height={16} rx={3} fill="#c46b4a" />
        </G>
      );
    case 'plant_cactus':
      return (
        <G>
          <Rect x={-6} y={-50} width={12} height={38} rx={6} fill="#4f9a5d" />
          <Path d="M-6 -28 H-13 V-40" stroke="#4f9a5d" strokeWidth={7} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <Path d="M6 -34 H12 V-44" stroke="#4f9a5d" strokeWidth={7} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <Circle cx={0} cy={-52} r={3} fill="#e8737a" />
          <Rect x={-11} y={-16} width={22} height={16} rx={3} fill="#e0a94f" />
        </G>
      );
    case 'fence_bunting': {
      const colors = ['#e0a94f', '#9184d9', '#7fd39b', '#e8737a', '#7fb4d9'];
      return (
        <G>
          <Path d="M-48 0 Q0 12 48 0" stroke="#5d4a3a" strokeWidth={1.2} fill="none" />
          {colors.map((c, i) => {
            const f = (i + 0.5) / colors.length;
            const x = -48 + f * 96;
            const y = 12 * 4 * f * (1 - f) * 0.75;
            return <Path key={c} d={`M${x - 6} ${y} L${x + 6} ${y} L${x} ${y + 11} Z`} fill={c} />;
          })}
        </G>
      );
    }
    case 'fence_lights':
      return (
        <G>
          <Path d="M-48 0 Q0 10 48 0" stroke="#463e5c" strokeWidth={1} fill="none" />
          {[-40, -24, -8, 8, 24, 40].map((x, i) => {
            const y = 7 * Math.sin(((x + 48) / 96) * Math.PI);
            const c = ['#ffd76b', '#ffb3c6', '#b5abfc'][i % 3];
            return (
              <G key={x}>
                <Circle cx={x} cy={y} r={time === 'day' ? 0 : 7} fill="#ffd76b" opacity={0.18} />
                <Circle cx={x} cy={y} r={3} fill={c} />
              </G>
            );
          })}
        </G>
      );
    case 'ground_stones':
      return (
        <G>
          {[-39, -13, 13, 39].map((x, i) => (
            <Ellipse key={x} cx={x} cy={i % 2 ? -2 : -5} rx={11} ry={4.5} fill="#c8c3b4" />
          ))}
        </G>
      );
    case 'ground_flowers':
      return (
        <G>
          <Rect x={-50} y={-9} width={100} height={9} rx={4.5} fill="#7a4a24" />
          {[-42, -30, -18, -6, 6, 18, 30, 42].map((x, i) => (
            <G key={x}>
              <Path d={`M${x} -8 V-15`} stroke="#3f9a57" strokeWidth={1.5} />
              <Circle cx={x} cy={-17} r={3.5} fill={['#e8737a', '#f2c84b', '#b5abfc', '#ffffff'][i % 4]} />
            </G>
          ))}
        </G>
      );
    case 'tree_oak':
    case 'tree_cherry': {
      const cherry = id === 'tree_cherry';
      const a = cherry ? '#f2a7c3' : '#3f9a57';
      const b = cherry ? '#fbd0e0' : '#57b56c';
      return (
        <G>
          <Rect x={-6} y={-62} width={12} height={62} rx={3} fill="#7a4a24" />
          <Circle cx={-16} cy={-74} r={20} fill={a} />
          <Circle cx={16} cy={-76} r={20} fill={a} />
          <Circle cx={0} cy={-96} r={24} fill={b} />
          <Circle cx={-6} cy={-80} r={16} fill={b} />
          {cherry && [[-20, -70], [12, -90], [18, -70], [-4, -104]].map(([x, y]) => <Circle key={`${x}${y}`} cx={x} cy={y} r={2} fill="#ffffff" />)}
        </G>
      );
    }
    case 'tree_lit':
      // An evergreen with coloured lights and a star; brighter at night.
      return (
        <G>
          <Rect x={-6} y={-22} width={12} height={22} rx={2} fill="#7a4a24" />
          <Path d="M-40 -20 L0 -64 L40 -20 Z" fill="#2f7a4a" />
          <Path d="M-32 -50 L0 -88 L32 -50 Z" fill="#3a8f57" />
          <Path d="M-24 -78 L0 -110 L24 -78 Z" fill="#45a265" />
          {[
            [-24, -28],
            [10, -34],
            [26, -26],
            [-12, -58],
            [16, -60],
            [-6, -86],
            [8, -94],
            [-30, -24],
          ].map(([x, y], i) => (
            <Circle
              key={`${x}${y}`}
              cx={x}
              cy={y}
              r={time === 'night' ? 3.4 : 2.6}
              fill={['#f2c84b', '#e8737a', '#7fd0f6', '#b5abfc'][i % 4]}
              opacity={time === 'night' ? 1 : 0.85}
            />
          ))}
          <Path d="M0 -122 L4 -112 L14 -112 L6 -106 L9 -96 L0 -102 L-9 -96 L-6 -106 L-14 -112 L-4 -112 Z" fill="#f2c84b" />
        </G>
      );
    case 'pond_lily':
      return (
        <G>
          <Ellipse cx={0} cy={-8} rx={34} ry={10} fill="#9aa0ab" />
          <Ellipse cx={0} cy={-8} rx={30} ry={8} fill="#5fa8d3" />
          <Ellipse cx={-10} cy={-9} rx={6} ry={2.5} fill="#57b56c" />
          <Ellipse cx={12} cy={-7} rx={5} ry={2} fill="#57b56c" />
          <Circle cx={-9} cy={-10} r={1.8} fill="#f2a7c3" />
        </G>
      );
    case 'pond_fountain':
      return (
        <G>
          <Ellipse cx={0} cy={-8} rx={30} ry={9} fill="#cfd3e5" />
          <Ellipse cx={0} cy={-9} rx={25} ry={6} fill="#7fb4d9" />
          <Rect x={-3} y={-30} width={6} height={22} fill="#cfd3e5" />
          <Path d="M0 -32 Q-12 -44 -18 -14 M0 -32 Q12 -44 18 -14" stroke="#a9d4f0" strokeWidth={2} fill="none" />
        </G>
      );
    case 'ground_pumpkins':
      return (
        <G>
          <Rect x={-44} y={-8} width={88} height={8} rx={3} fill="#e4c062" />
          <Pumpkin x={-28} s={1.1} />
          <Pumpkin x={0} s={1.4} />
          <Pumpkin x={27} s={0.9} />
        </G>
      );
    case 'ground_snowman':
      return (
        <G>
          <Circle cx={0} cy={-13} r={13} fill="#ffffff" />
          <Circle cx={0} cy={-34} r={10} fill="#ffffff" />
          <Circle cx={0} cy={-51} r={8} fill="#ffffff" />
          <Circle cx={-3} cy={-53} r={1.2} fill={INK} />
          <Circle cx={3} cy={-53} r={1.2} fill={INK} />
          <Path d="M0 -50 L8 -48 L0 -47 Z" fill="#e07b2a" />
          <Rect x={-9} y={-44} width={18} height={4} rx={2} fill="#d94a4a" />
          <Rect x={4} y={-44} width={4} height={10} rx={2} fill="#d94a4a" />
          <Rect x={-7} y={-66} width={14} height={8} fill="#1b1d29" />
          <Rect x={-10} y={-59} width={20} height={2.5} fill="#1b1d29" />
          <Path d="M-10 -36 L-22 -44 M10 -36 L22 -44" stroke="#7a4a24" strokeWidth={1.8} strokeLinecap="round" />
        </G>
      );
    case 'fence_garland':
      return (
        <G>
          <Path d="M-48 0 Q-24 12 0 2 Q24 12 48 0" stroke="#3f9a57" strokeWidth={6} fill="none" strokeLinecap="round" />
          {[-48, 0, 48].map((x) => (
            <Path key={x} d={`M${x - 5} ${x === 0 ? 0 : -2} L${x} ${x === 0 ? 4 : 2} L${x + 5} ${x === 0 ? 0 : -2} L${x + 3} ${x === 0 ? 6 : 4} L${x} ${x === 0 ? 4 : 2} L${x - 3} ${x === 0 ? 6 : 4} Z`} fill="#d94a4a" />
          ))}
          {[-34, -16, 16, 34].map((x, i) => (
            <Circle key={x} cx={x} cy={7} r={2.2} fill={['#f2c84b', '#d94a4a'][i % 2]} />
          ))}
        </G>
      );
    default:
      // fence_plain, ground_grass, or one this build doesn't know.
      return null;
  }
}

function House({ id, name, time = 'day' }: { id: string; name?: string; time?: YardTime }) {
  // Windows glow in the evening and at night.
  const lit = time !== 'day';
  const glass = lit ? '#ffd98a' : '#bfe3f5';
  const plate = (name ?? '').toUpperCase().slice(0, 9);
  const nameplate = plate ? (
    <G>
      <Rect x={-20} y={-84} width={40} height={12} rx={3} fill="#f3e3c3" />
      <SvgText x={0} y={-75} fontSize={7.5} fontWeight="bold" textAnchor="middle" fill="#5d5294">
        {plate}
      </SvgText>
    </G>
  ) : null;
  if (id === 'house_barn') {
    return (
      <G>
        <Rect x={-44} y={-66} width={88} height={66} fill="#b84a3a" />
        <Path d="M-50 -62 L-40 -86 L0 -104 L40 -86 L50 -62 Z" fill="#7a2e24" />
        <Rect x={-18} y={-38} width={36} height={38} fill="#7a2e24" />
        <Path d="M-18 -38 L18 0 M18 -38 L-18 0" stroke="#f3e3c3" strokeWidth={2.5} />
        <Rect x={-18} y={-38} width={36} height={38} fill="none" stroke="#f3e3c3" strokeWidth={2.5} />
        {nameplate}
      </G>
    );
  }
  if (id === 'house_bungalow') {
    // A beach hut: planked walls, a thatched roof, a lantern.
    return (
      <G>
        <Rect x={-46} y={-62} width={92} height={62} fill="#7cc7c4" />
        {[-50, -38, -26, -14].map((y) => (
          <Line key={y} x1={-46} y1={y} x2={46} y2={y} stroke="#5aa6a3" strokeWidth={2} />
        ))}
        <Rect x={-36} y={-48} width={18} height={16} rx={2} fill={glass} />
        <Rect x={18} y={-48} width={18} height={16} rx={2} fill={glass} />
        <Path d="M-60 -58 L0 -104 L60 -58 Z" fill="#d9b35f" />
        <Path d="M-60 -58 L-54 -50 L-48 -58 L-42 -50 L-36 -58 L-30 -50 L-24 -58 L-18 -50 L-12 -58 L-6 -50 L0 -58 L6 -50 L12 -58 L18 -50 L24 -58 L30 -50 L36 -58 L42 -50 L48 -58 L54 -50 L60 -58 Z" fill="#c49a45" />
        <Path d="M-18 0 L-18 -30 Q0 -46 18 -30 L18 0 Z" fill="#2b5f6b" />
        <Path d="M40 -58 V-48" stroke="#7a4a24" strokeWidth={1.5} />
        <Rect x={36} y={-48} width={8} height={11} rx={2} fill={lit ? '#ffd23f' : '#e8c26b'} />
        {lit && <Circle cx={40} cy={-42} r={12} fill="#ffd23f" opacity={0.25} />}
        <Path d="M-58 0 Q-64 -30 -54 -58 Q-48 -30 -52 0 Z" fill="#e8737a" />
        {nameplate}
      </G>
    );
  }
  if (id === 'house_glass') {
    // A modern box: big windows, a timber panel, a flat roof.
    return (
      <G>
        <Rect x={-54} y={-72} width={108} height={72} fill="#2e3245" />
        <Rect x={-50} y={-66} width={62} height={62} fill={glass} />
        <Path d="M-19 -66 V-4 M-50 -35 H12" stroke="#2e3245" strokeWidth={3} />
        {lit && <Rect x={-50} y={-66} width={62} height={62} fill="#ffb347" opacity={0.2} />}
        <Rect x={16} y={-66} width={34} height={66} fill="#b5743c" />
        {[-58, -50, -42, -34, -26, -18, -10].map((y) => (
          <Line key={y} x1={16} y1={y} x2={50} y2={y} stroke="#8f5a2c" strokeWidth={1.5} />
        ))}
        <Rect x={24} y={-30} width={18} height={30} rx={1} fill="#1c1a2b" />
        <Rect x={-62} y={-80} width={124} height={9} fill="#1c1e2b" />
        <G transform="translate(-22 4)">{nameplate}</G>
      </G>
    );
  }
  if (id === 'house_treehouse') {
    // A little house up a tree, with a ladder down.
    return (
      <G>
        <Rect x={-9} y={-70} width={18} height={70} rx={3} fill="#7a4a24" />
        <Circle cx={-34} cy={-118} r={24} fill="#3f9a57" />
        <Circle cx={34} cy={-120} r={24} fill="#3f9a57" />
        <Circle cx={0} cy={-138} r={28} fill="#57b56c" />
        <Rect x={-46} y={-74} width={92} height={8} fill="#8f5a2c" />
        <Rect x={-36} y={-116} width={72} height={42} fill="#c98a4b" />
        <Path d="M-44 -114 L0 -142 L44 -114 Z" fill="#a8452e" />
        <Rect x={-26} y={-106} width={16} height={14} rx={2} fill={glass} />
        <Rect x={8} y={-104} width={16} height={30} rx={2} fill="#1c1a2b" />
        <Path d="M30 -66 L40 0 M44 -66 L54 0 M32 -54 L46 -54 M34 -40 L48 -40 M36 -26 L50 -26 M38 -12 L52 -12" stroke="#7a4a24" strokeWidth={3} strokeLinecap="round" />
        <G transform="translate(0 -36)">{nameplate}</G>
      </G>
    );
  }
  if (id === 'house_castle') {
    // Stone walls with battlements, two towers, a flag with the name.
    const flag = (name ?? '').slice(0, 8);
    return (
      <G>
        <Rect x={-62} y={-96} width={26} height={96} fill="#9aa0ab" />
        <Rect x={36} y={-96} width={26} height={96} fill="#9aa0ab" />
        <Path d="M-66 -96 L-49 -126 L-32 -96 Z M32 -96 L49 -126 L66 -96 Z" fill="#5d5294" />
        <Rect x={-36} y={-70} width={72} height={70} fill="#b0b5bf" />
        {[-36, -20, -4, 12, 28].map((x) => (
          <Rect key={x} x={x} y={-80} width={10} height={12} fill="#b0b5bf" />
        ))}
        {[-58, -46, -34].map((y) => (
          <Line key={y} x1={-36} y1={y} x2={36} y2={y} stroke="#9aa0ab" strokeWidth={1.5} />
        ))}
        <Rect x={-54} y={-80} width={8} height={14} rx={4} fill={glass} />
        <Rect x={46} y={-80} width={8} height={14} rx={4} fill={glass} />
        <Path d="M-18 0 L-18 -32 Q0 -52 18 -32 L18 0 Z" fill="#5a3a24" />
        <Path d="M-18 -10 H18 M-18 -20 H18" stroke="#3f2818" strokeWidth={1.5} />
        <Path d="M49 -126 V-150" stroke="#4a3a30" strokeWidth={2} />
        <Path d="M49 -150 L80 -144 L49 -138 Z" fill="#e0b84f" />
        {!!flag && (
          <SvgText x={62} y={-142} fontSize={5} fontWeight="bold" textAnchor="middle" fill="#5d5294">
            {flag.toUpperCase()}
          </SvgText>
        )}
      </G>
    );
  }
  if (id === 'house_mansion') {
    // Two floors, white columns, a gold door, a chandelier lit at night.
    return (
      <G>
        <Rect x={-66} y={-110} width={132} height={110} fill="#f3ede2" />
        <Path d="M-74 -108 L0 -142 L74 -108 Z" fill="#5d5294" />
        <Path d="M-40 -112 L0 -134 L40 -112 Z" fill="#f3ede2" />
        <Rect x={-70} y={-58} width={140} height={6} fill="#ddd4c4" />
        {[-54, -30, 22, 46].map((x) => (
          <G key={x}>
            <Rect x={x} y={-98} width={14} height={26} rx={2} fill={glass} />
            <Rect x={x} y={-44} width={14} height={26} rx={2} fill={glass} />
          </G>
        ))}
        <Rect x={-9} y={-100} width={18} height={30} rx={9} fill={glass} />
        {lit && (
          <G>
            <Path d="M0 -100 V-92 M-6 -86 Q0 -92 6 -86" stroke="#e0b84f" strokeWidth={1.5} fill="none" />
            <Circle cx={-6} cy={-85} r={1.8} fill="#fff3c4" />
            <Circle cx={0} cy={-88} r={1.8} fill="#fff3c4" />
            <Circle cx={6} cy={-85} r={1.8} fill="#fff3c4" />
            <Circle cx={0} cy={-86} r={13} fill="#ffd98a" opacity={0.3} />
          </G>
        )}
        {[-34, -22, 14, 26].map((x) => (
          <Rect key={x} x={x} y={-52} width={8} height={52} fill="#ffffff" />
        ))}
        <Path d="M-12 0 L-12 -30 Q0 -42 12 -30 L12 0 Z" fill="#e0b84f" />
        <Circle cx={7} cy={-14} r={1.8} fill="#8a6a1c" />
        <Rect x={-28} y={-2} width={56} height={4} fill="#ddd4c4" />
        <G transform="translate(0 -36)">{nameplate}</G>
      </G>
    );
  }
  if (id === 'house_igloo') {
    // Snow blocks in a dome, a round doorway, icicles.
    return (
      <G>
        <Path d="M-52 0 Q-52 -78 0 -80 Q52 -78 52 0 Z" fill="#eef4fb" />
        <Path d="M-50 -20 H50 M-44 -40 H44 M-30 -60 H30" stroke="#c9d8ea" strokeWidth={2} />
        <Path d="M-30 0 V-20 M10 -20 V-40 M-18 -40 V-60 M22 -60 V-74 M30 0 V-20 M-40 -20 V-40 M36 -20 V-40" stroke="#c9d8ea" strokeWidth={2} />
        <Path d="M-20 0 L-20 -16 Q0 -36 20 -16 L20 0 Z" fill="#3d4a66" />
        <Path d="M-24 -18 Q0 -42 24 -18" stroke="#ffffff" strokeWidth={5} fill="none" />
        {nameplate}
      </G>
    );
  }
  if (id === 'house_gingerbread') {
    return (
      <G>
        <Rect x={-44} y={-66} width={88} height={66} fill="#a8683a" />
        <Path d="M-50 -62 L0 -102 L50 -62 Z" fill="#7a4a24" />
        <Path d="M-50 -62 L-44 -66 L-38 -62 L-32 -66 L-26 -62 L-20 -66 L-14 -62 L-8 -66 L-2 -62 L4 -66 L10 -62 L16 -66 L22 -62 L28 -66 L34 -62 L40 -66 L46 -62" stroke="#ffffff" strokeWidth={2.5} fill="none" />
        <Path d="M-46 -64 L0 -100 L46 -64" stroke="#ffffff" strokeWidth={3} fill="none" strokeDasharray="4 3" />
        <Path d="M-20 0 L-20 -32 Q0 -54 20 -32 L20 0 Z" fill="#d94a4a" />
        <Path d="M-20 -26 H20 M-20 -16 H20 M-20 -6 H20" stroke="#ffffff" strokeWidth={2} />
        {[-34, 34].map((x) => (
          <Circle key={x} cx={x} cy={-30} r={6} fill="#ffffff" />
        ))}
        {[-34, 34].map((x) => (
          <Path key={`p${x}`} d={`M${x - 6} -30 A6 6 0 0 1 ${x} -36 L${x} -30 Z M${x} -30 L${x + 6} -30 A6 6 0 0 1 ${x} -24 Z`} fill="#d94a4a" />
        ))}
        {nameplate}
      </G>
    );
  }
  if (id === 'house_cabin') {
    return (
      <G>
        <Rect x={-44} y={-66} width={88} height={66} fill="#9a6236" />
        {[-56, -44, -32, -20, -8].map((y) => (
          <Line key={y} x1={-44} y1={y} x2={44} y2={y} stroke="#7a4a24" strokeWidth={2} />
        ))}
        <Path d="M-52 -60 L0 -102 L52 -60 Z" fill="#4a3a30" />
        <Path d="M-20 0 L-20 -32 Q0 -54 20 -32 L20 0 Z" fill="#1c1a2b" />
        {nameplate}
      </G>
    );
  }
  return (
    <G>
      <Rect x={-44} y={-66} width={88} height={66} fill="#9184d9" />
      <Path d="M-50 -62 L0 -102 L50 -62 Z" fill="#5d5294" />
      <Rect x={-44} y={-66} width={88} height={5} fill="#000000" opacity={0.15} />
      <Path d="M-20 0 L-20 -32 Q0 -54 20 -32 L20 0 Z" fill="#1c1a2b" />
      {nameplate}
    </G>
  );
}

// A trophy, drawn around the middle of its base, about 30 wide.
export function TrophyArt({ kind }: { kind: TrophyKind }) {
  switch (kind) {
    case 'steps':
      return (
        <G>
          <Rect x={-9} y={-5} width={18} height={5} rx={1} fill="#7a4a24" />
          <Rect x={-2} y={-12} width={4} height={8} fill="#e0b84f" />
          <Path d="M-10 -28 H10 Q10 -12 0 -12 Q-10 -12 -10 -28 Z" fill="#f2c84b" />
          <Path d="M-10 -25 Q-16 -25 -14 -19 Q-12 -15 -8 -16 M10 -25 Q16 -25 14 -19 Q12 -15 8 -16" stroke="#f2c84b" strokeWidth={2} fill="none" />
        </G>
      );
    case 'houndopoly':
      return (
        <G>
          <Ellipse cx={0} cy={-3} rx={13} ry={3.5} fill="#1b1d29" />
          <Rect x={-8} y={-24} width={16} height={21} rx={2} fill="#1b1d29" />
          <Rect x={-8} y={-9} width={16} height={4} fill="#d94a4a" />
        </G>
      );
    case 'soccer':
      return (
        <G>
          <Path d="M-16 0 V-24 H16 V0" stroke="#ffffff" strokeWidth={2.5} fill="none" />
          <G stroke="#ffffff" strokeWidth={0.7} opacity={0.6}>
            {[-18, -12, -6].map((y) => <Line key={y} x1={-16} y1={y} x2={16} y2={y} />)}
            {[-8, 0, 8].map((x) => <Line key={x} x1={x} y1={-24} x2={x} y2={0} />)}
          </G>
          <Circle cx={10} cy={-4} r={4} fill="#ffffff" stroke={INK} strokeWidth={0.6} />
        </G>
      );
    case 'rally':
      return (
        <G transform="rotate(14)">
          <Ellipse cx={0} cy={-26} rx={7} ry={10} fill="none" stroke="#9184d9" strokeWidth={2.2} />
          <G stroke="#ffffff" strokeWidth={0.6} opacity={0.75}>
            <Line x1={-5} y1={-30} x2={5} y2={-30} />
            <Line x1={-6} y1={-25} x2={6} y2={-25} />
            <Line x1={-5} y1={-20} x2={5} y2={-20} />
            <Line x1={-2.5} y1={-35} x2={-2.5} y2={-17} />
            <Line x1={2.5} y1={-35} x2={2.5} y2={-17} />
          </G>
          <Rect x={-1.3} y={-16} width={2.6} height={16} fill="#5d5294" />
        </G>
      );
    case 'cricket':
      return (
        <G>
          {[-7, 0, 7].map((x) => (
            <Rect key={x} x={x - 1.6} y={-26} width={3.2} height={26} rx={1} fill="#f1d7b0" />
          ))}
          <Rect x={-9} y={-28} width={8.5} height={2.2} rx={1} fill="#c98a4b" />
          <Rect x={0.5} y={-28} width={8.5} height={2.2} rx={1} fill="#c98a4b" />
        </G>
      );
    case 'tictacgo':
      return (
        <G>
          <Rect x={-12} y={-26} width={24} height={24} rx={3} fill="#f3e3c3" />
          <Path d="M-4 -26 V-2 M4 -26 V-2 M-12 -18 H12 M-12 -10 H12" stroke="#7a4a24" strokeWidth={1} />
          <Path d="M-10 -24 L-6 -20 M-6 -24 L-10 -20" stroke="#d94a4a" strokeWidth={1.4} />
          <Circle cx={0} cy={-14} r={2.4} fill="none" stroke="#4f8fe0" strokeWidth={1.4} />
          <Path d="M6 -8 L10 -4 M10 -8 L6 -4" stroke="#d94a4a" strokeWidth={1.4} />
          <Rect x={-1} y={-2} width={2} height={2} fill="#7a4a24" />
        </G>
      );
    case 'bingo':
      return (
        <G>
          <Rect x={-1} y={-8} width={2} height={8} fill="#7a4a24" />
          <Rect x={-12} y={-32} width={24} height={26} rx={2} fill="#ffffff" />
          <Rect x={-12} y={-32} width={24} height={6} rx={2} fill="#9184d9" />
          {[0, 1, 2].flatMap((r) =>
            [0, 1, 2].map((c) => <Circle key={`${r}${c}`} cx={-7 + c * 7} cy={-21 + r * 6} r={2} fill={r === c ? '#e0a94f' : '#e4e7f5'} />),
          )}
        </G>
      );
    case 'streak':
      return (
        <G>
          <Path d="M-3 0 L-4 -18 H4 L3 0 Z" fill="#7a4a24" />
          <Path d="M0 -36 Q10 -26 6 -20 Q4 -16 0 -18 Q-4 -16 -6 -20 Q-10 -26 0 -36 Z" fill="#e07b2a" />
          <Path d="M0 -29 Q5 -24 3 -21 Q0 -19 -3 -21 Q-5 -24 0 -29 Z" fill="#f2c84b" />
        </G>
      );
    case 'journey':
      return (
        <G>
          <Rect x={-1} y={-10} width={2} height={10} fill="#7a4a24" />
          <G transform="translate(-13 -30) rotate(-6)">
            <Rect x={0} y={0} width={26} height={18} rx={1.5} fill="#fff8ec" />
            <Rect x={2} y={2} width={12} height={14} fill="#7fb4d9" />
            <Path d="M2 14 L6 8 L9 12 L11 9 L14 14 Z" fill="#3f6b4c" />
            <Line x1={16} y1={6} x2={24} y2={6} stroke="#bbbbbb" strokeWidth={1} />
            <Line x1={16} y1={10} x2={24} y2={10} stroke="#bbbbbb" strokeWidth={1} />
          </G>
        </G>
      );
    default:
      return null;
  }
}

// A square tile of one item or trophy, for pickers.
export function YardThumb({ id, trophy, size = 56 }: { id?: string; trophy?: TrophyKind; size?: number }) {
  // Each kind's own box: tall things (houses, trees) need more room.
  const slot = id?.split('_')[0];
  const box = trophy
    ? '-22 -40 44 44'
    : id === 'house_treehouse' || id === 'house_castle' || id === 'house_mansion' || id === 'tree_lit'
      ? '-82 -170 164 174'
      : slot === 'house' || slot === 'tree'
        ? '-60 -112 120 116'
      : slot === 'fence'
        ? '-52 -20 104 44'
        : slot === 'plant' || id === 'ground_snowman'
          ? '-36 -70 72 72'
          : slot === 'pond'
            ? '-38 -40 76 44'
            : slot === 'bowl' || slot === 'toy'
              ? '-26 -26 52 30'
              : '-42 -36 84 40';
  return (
    <Svg width={size} height={size} viewBox={box}>
      {id === 'fence_plain' ? (
        <G>
          <Rect x={-52} y={-2} width={104} height={4} fill="#cdbb99" />
          {[-44, -24, -4, 16, 36].map((x) => (
            <Path key={x} d={`M${x} 22 L${x} -12 L${x + 6} -18 L${x + 12} -12 L${x + 12} 22 Z`} fill="#e9dcc4" />
          ))}
        </G>
      ) : id === 'ground_grass' ? (
        <G>
          {[-24, -4, 16].map((x) => (
            <Path key={x} d={`M${x} 0 L${x + 3} -14 L${x + 6} 0 M${x + 5} 0 L${x + 10} -10 L${x + 11} 0`} fill="#3f9a57" />
          ))}
        </G>
      ) : id ? (
        <YardItemArt id={id} />
      ) : trophy ? (
        <TrophyArt kind={trophy} />
      ) : null}
    </Svg>
  );
}
