import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import { Text } from "../components/Text";
import { Button } from "../components/Button";
import { useTheme } from "../theme/ThemeContext";
import { font, withAlpha, type Palette } from "../theme/tokens";
import {
  BURN_SECS,
  BURN_ZONE,
  CLARITY_EARLY_MS,
  CRAVING_CARDS,
  REFEED_SECS,
  burnDrag,
  clarityRounds,
  cravingDeck,
  cravingMs,
  pourLines,
  refeedFoods,
  type GameKind,
} from "./fastingGames";

// The five phase games (0269). Each is built from the day's seed, so
// everyone plays the same run, and hands back its numbers (the server
// scores them) plus a couple of lines for the result.

export type FinishLines = [string, string][];
export interface GameProps {
  seed: number;
  accent: string;
  onFinish: (stats: Record<string, number>, lines: FinishLines) => void;
}

export function GamePlay({ game, ...p }: GameProps & { game: GameKind }) {
  switch (game) {
    case "craving":
      return <CravingControl {...p} />;
    case "pour":
      return <SteadyPour {...p} />;
    case "burn":
      return <BurnZone {...p} />;
    case "clarity":
      return <Clarity {...p} />;
    case "refeed":
      return <Refeed {...p} />;
  }
}

function useStyles() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return { colors, styles };
}

function Hud({ items }: { items: [string, string][] }) {
  const { styles } = useStyles();
  return (
    <View style={styles.hud}>
      {items.map(([k, v]) => (
        <Text key={k} style={styles.hudLabel}>
          {k} <Text style={styles.hudValue}>{v}</Text>
        </Text>
      ))}
    </View>
  );
}

// ── Craving Control (Settling) ──

function Cup({ color }: { color: string }) {
  return (
    <Svg width={50} height={50} viewBox="0 0 54 54">
      <Path
        d="M14 14h26l-3 30a4 4 0 0 1-4 4H21a4 4 0 0 1-4-4z"
        fill="none"
        stroke={color}
        strokeWidth={3}
      />
      <Path d="M16.6 26h20.8l-1.8 18H18.4z" fill={withAlpha(color, 0.45)} />
    </Svg>
  );
}

function CravingControl({ seed, accent, onFinish }: GameProps) {
  const { colors, styles } = useStyles();
  const deck = useMemo(() => cravingDeck(seed), [seed]);
  const [phase, setPhase] = useState<"ready" | "play">("ready");
  const [i, setI] = useState(0);
  const [frac, setFrac] = useState(1);
  const [flash, setFlash] = useState<null | boolean>(null);
  const st = useRef({ i: 0, right: 0, streak: 0, best: 0, t0: 0, busy: false });
  const [hud, setHud] = useState({ right: 0, streak: 0 });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const answer = (saidKeeps: boolean | null) => {
    const s = st.current;
    if (s.busy || s.i >= CRAVING_CARDS) return;
    s.busy = true;
    if (timer.current) clearInterval(timer.current);
    const ok = saidKeeps === deck[s.i].keeps;
    if (ok) {
      s.right += 1;
      s.streak += 1;
      s.best = Math.max(s.best, s.streak);
    } else s.streak = 0;
    setFlash(ok);
    setHud({ right: s.right, streak: s.streak });
    setTimeout(() => {
      setFlash(null);
      s.i += 1;
      s.busy = false;
      if (s.i >= CRAVING_CARDS) {
        onFinish({ right: s.right, streak: s.best }, [
          [`${s.right}/20`, "sorted right"],
          [`${s.best}`, "best streak"],
        ]);
        return;
      }
      setI(s.i);
      run();
    }, 220);
  };

  const run = () => {
    const s = st.current;
    s.t0 = Date.now();
    const ms = cravingMs(s.i);
    setFrac(1);
    timer.current = setInterval(() => {
      const f = 1 - (Date.now() - s.t0) / ms;
      setFrac(Math.max(0, f));
      if (f <= 0) answer(null);
    }, 40);
  };

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );

  const touchX = useRef<number | null>(null);
  const card = deck[Math.min(i, CRAVING_CARDS - 1)];
  return (
    <View style={styles.flex}>
      <Hud
        items={[
          ["Card", `${Math.min(i + (phase === "play" ? 1 : 0), 20)}/20`],
          ["Right", `${hud.right}`],
          ["Streak", `${hud.streak}`],
        ]}
      />
      <View
        style={styles.arena}
        onTouchStart={(e) => (touchX.current = e.nativeEvent.pageX)}
        onTouchEnd={(e) => {
          if (phase !== "play" || touchX.current === null) return;
          const dx = e.nativeEvent.pageX - touchX.current;
          touchX.current = null;
          if (Math.abs(dx) > 40) answer(dx > 0);
        }}
      >
        {phase === "ready" ? (
          <Text style={styles.msg}>
            20 cards. 2.4 seconds each at first, under a second by the end.
          </Text>
        ) : (
          <>
            <Text style={[styles.side, { left: 10 }]}>‹ breaks it</Text>
            <Text style={[styles.side, { right: 10 }]}>keeps it ›</Text>
            <View
              style={[
                styles.card,
                flash !== null && {
                  backgroundColor: withAlpha(
                    flash ? colors.green : "#e06c6c",
                    0.22,
                  ),
                },
              ]}
            >
              <Cup color={withAlpha(colors.text, 0.7)} />
              <Text style={styles.cardName}>{card.name}</Text>
              <Text style={styles.cardDetail}>{card.detail}</Text>
            </View>
            <View
              style={[
                styles.tbar,
                { width: `${frac * 100}%`, backgroundColor: accent },
              ]}
            />
          </>
        )}
      </View>
      <View style={styles.controls}>
        {phase === "ready" ? (
          <Button
            label="Start"
            variant="primary"
            block
            onPress={() => {
              setPhase("play");
              run();
            }}
          />
        ) : (
          <View style={styles.row2}>
            <Button
              label="‹ Breaks it"
              block
              style={{ flex: 1 }}
              onPress={() => answer(false)}
            />
            <Button
              label="Keeps it ›"
              block
              style={{ flex: 1 }}
              onPress={() => answer(true)}
            />
          </View>
        )}
      </View>
    </View>
  );
}

// ── Steady Pour (Settling, the other day) ──

function SteadyPour({ seed, onFinish }: GameProps) {
  const { colors, styles } = useStyles();
  const lines = useMemo(() => pourLines(seed), [seed]);
  const [n, setN] = useState(0);
  const [level, setLevel] = useState(0);
  const [offs, setOffs] = useState<number[]>([]);
  const lvl = useRef(0);
  const pouring = useRef(false);
  const raf = useRef<number | null>(null);
  const last = useRef(0);
  const finished = useRef(false);

  const tick = (t: number) => {
    if (!pouring.current) return;
    const dt = last.current ? Math.min(0.05, (t - last.current) / 1000) : 0.016;
    last.current = t;
    lvl.current = Math.min(100, lvl.current + (33 + lvl.current * 0.36) * dt);
    setLevel(lvl.current);
    raf.current = requestAnimationFrame(tick);
  };
  const down = () => {
    if (finished.current || n >= 3) return;
    lvl.current = 0;
    last.current = 0;
    pouring.current = true;
    raf.current = requestAnimationFrame(tick);
  };
  const up = () => {
    if (!pouring.current) return;
    pouring.current = false;
    if (raf.current) cancelAnimationFrame(raf.current);
    const off = Math.abs(lvl.current - lines[n]);
    const next = [...offs, off];
    setOffs(next);
    if (next.length >= 3) {
      finished.current = true;
      const avg = next.reduce((a, b) => a + b, 0) / 3;
      setTimeout(
        () =>
          onFinish({ off: Math.round(avg * 100) / 100 }, [
            [`${avg.toFixed(1)}%`, "average off"],
            [`${Math.min(...next).toFixed(1)}%`, "closest"],
          ]),
        600,
      );
    } else {
      setTimeout(() => {
        setN(next.length);
        setLevel(0);
      }, 700);
    }
  };
  useEffect(
    () => () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    },
    [],
  );

  const avg = offs.length
    ? offs.reduce((a, b) => a + b, 0) / offs.length
    : null;
  return (
    <View style={styles.flex}>
      <Hud
        items={[
          ["Glass", `${Math.min(n + 1, 3)}/3`],
          ["Last", offs.length ? `${offs[offs.length - 1].toFixed(1)}%` : "—"],
          ["Avg off", avg === null ? "—" : `${avg.toFixed(1)}%`],
        ]}
      />
      <View
        style={[
          styles.arena,
          {
            alignItems: "center",
            justifyContent: "flex-end",
            paddingBottom: 24,
          },
        ]}
      >
        <View
          style={[styles.glass, { borderColor: withAlpha(colors.text, 0.45) }]}
        >
          <View style={[styles.water, { height: `${level}%` }]} />
          <View
            style={[
              styles.mark,
              {
                bottom: `${lines[Math.min(n, 2)]}%`,
                borderColor: withAlpha(colors.text, 0.75),
              },
            ]}
          />
        </View>
      </View>
      <View style={styles.controls}>
        <Pressable
          onPressIn={down}
          onPressOut={up}
          style={({ pressed }) => [
            styles.holdBtn,
            { backgroundColor: pressed ? colors.accentActive : colors.accent },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Hold to pour"
        >
          <Text style={styles.holdText}>Hold to pour</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ── Burn Zone (Fat burning) ──

function BurnZone({ seed, accent, onFinish }: GameProps) {
  const { colors, styles } = useStyles();
  const drag = useMemo(() => burnDrag(seed), [seed]);
  const [phase, setPhase] = useState<"ready" | "play">("ready");
  const [view, setView] = useState({ v: 0, left: BURN_SECS, pct: 0 });
  const s = useRef({ v: 20, vel: 0, inZ: 0, tot: 0, t0: 0, last: 0 });
  const raf = useRef<number | null>(null);

  const frame = (t: number) => {
    const g = s.current;
    const dt = Math.min(0.05, (t - g.last) / 1000);
    g.last = t;
    const el = (t - g.t0) / 1000;
    const d = drag[Math.min(drag.length - 1, Math.floor(el))];
    g.vel -= d * 22 * dt;
    g.v = Math.max(0, Math.min(100, g.v + g.vel * dt * 10));
    g.vel *= 0.96;
    if (g.v >= BURN_ZONE[0] && g.v <= BURN_ZONE[1]) g.inZ += dt;
    g.tot += dt;
    const pct = (g.inZ / Math.max(g.tot, 0.01)) * 100;
    setView({ v: g.v, left: Math.max(0, BURN_SECS - el), pct });
    if (el >= BURN_SECS) {
      const p = Math.round(pct * 10) / 10;
      onFinish({ pct: p }, [
        [`${Math.round(p)}%`, "time in the zone"],
        [`${g.inZ.toFixed(1)} s`, "held"],
      ]);
      return;
    }
    raf.current = requestAnimationFrame(frame);
  };
  useEffect(
    () => () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    },
    [],
  );
  const push = () => {
    if (phase === "play") s.current.vel += 3.4;
  };
  const inZone = view.v >= BURN_ZONE[0] && view.v <= BURN_ZONE[1];
  return (
    <View style={styles.flex}>
      <Hud
        items={[
          ["Time", view.left.toFixed(1)],
          ["In zone", `${Math.round(view.pct)}%`],
        ]}
      />
      <Pressable
        style={styles.arena}
        onPressIn={push}
        accessibilityLabel="Tap to push the needle up"
      >
        <View style={styles.zread}>
          <Text style={[styles.zbig, inZone && { color: accent }]}>
            {Math.round(view.v)}
          </Text>
          <Text style={styles.small}>output</Text>
        </View>
        <View style={styles.gauge}>
          <View
            style={[
              styles.zone,
              {
                left: `${BURN_ZONE[0]}%`,
                width: `${BURN_ZONE[1] - BURN_ZONE[0]}%`,
                borderColor: accent,
                backgroundColor: withAlpha(accent, 0.14),
              },
            ]}
          />
          <View
            style={[
              styles.needle,
              {
                left: `${view.v}%`,
                backgroundColor: inZone ? accent : colors.text,
              },
            ]}
          />
        </View>
        <View style={styles.ticks}>
          {["0", "25", "50", "75", "100"].map((t) => (
            <Text key={t} style={styles.small}>
              {t}
            </Text>
          ))}
        </View>
      </Pressable>
      <View style={styles.controls}>
        {phase === "ready" ? (
          <Button
            label="Start"
            variant="primary"
            block
            onPress={() => {
              const now = performance.now();
              s.current = { v: 20, vel: 0, inZ: 0, tot: 0, t0: now, last: now };
              setPhase("play");
              raf.current = requestAnimationFrame(frame);
            }}
          />
        ) : (
          <Pressable
            onPressIn={push}
            style={[styles.holdBtn, { backgroundColor: colors.accent }]}
            accessibilityRole="button"
          >
            <Text style={styles.holdText}>Tap</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

// ── Clarity (Ketosis) ──

function Clarity({ seed, accent, onFinish }: GameProps) {
  const { styles } = useStyles();
  const rounds = useMemo(() => clarityRounds(seed), [seed]);
  const [phase, setPhase] = useState<"ready" | "wait" | "go" | "done">("ready");
  const [r, setR] = useState(0);
  const [times, setTimes] = useState<(number | null)[]>([]);
  const t0 = useRef(0);
  const wait = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useRef({
    phase: "ready" as string,
    r: 0,
    times: [] as (number | null)[],
  });

  const round = (k: number) => {
    live.current.phase = "wait";
    setPhase("wait");
    wait.current = setTimeout(() => {
      live.current.phase = "go";
      setPhase("go");
      t0.current = performance.now();
    }, rounds[k].delayMs);
  };
  useEffect(
    () => () => {
      if (wait.current) clearTimeout(wait.current);
    },
    [],
  );

  const tap = (_e?: GestureResponderEvent) => {
    const L = live.current;
    if (L.phase !== "wait" && L.phase !== "go") return;
    let ms: number | null;
    if (L.phase === "wait") {
      if (wait.current) clearTimeout(wait.current);
      ms = null;
    } else ms = performance.now() - t0.current;
    L.times = [...L.times, ms];
    L.r += 1;
    setTimes(L.times);
    setR(L.r);
    if (L.r >= 5) {
      L.phase = "done";
      setPhase("done");
      const vals = L.times.map((x) => (x === null ? CLARITY_EARLY_MS : x));
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      const best = Math.min(...vals);
      onFinish({ ms: Math.round(avg) }, [
        [`${Math.round(avg)} ms`, "average"],
        [`${Math.round(best)} ms`, "best"],
      ]);
    } else {
      L.phase = "between";
      setPhase("wait");
      setTimeout(() => round(L.r), 350);
    }
  };

  const vals = times.map((x) => (x === null ? CLARITY_EARLY_MS : x));
  const avg = vals.length
    ? vals.reduce((a, b) => a + b, 0) / vals.length
    : null;
  const k = Math.min(r, 4);
  return (
    <View style={styles.flex}>
      <Hud
        items={[
          ["Round", `${r}/5`],
          ["Average", avg === null ? "—" : `${Math.round(avg)} ms`],
          ["Best", vals.length ? `${Math.round(Math.min(...vals))} ms` : "—"],
        ]}
      />
      <Pressable
        style={styles.arena}
        onPressIn={tap}
        accessibilityLabel="Tap when the target appears"
      >
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {phase === "go" ? (
            <View
              style={[
                styles.dot,
                {
                  left: `${rounds[k].x * 100}%`,
                  top: `${rounds[k].y * 100}%`,
                  backgroundColor: accent,
                  shadowColor: accent,
                },
              ]}
            />
          ) : (
            <Text style={styles.msg}>
              {phase === "ready"
                ? "A reaction test. Tap the arena the moment the target shows."
                : phase === "wait"
                  ? "Wait for it…"
                  : ""}
            </Text>
          )}
        </View>
      </Pressable>
      <View style={styles.splits}>
        {times.map((t, j) => (
          <Text
            key={j}
            style={[styles.split, t === null && { color: "#e06c6c" }]}
          >
            {t === null ? "early" : Math.round(t)}
          </Text>
        ))}
      </View>
      <View style={styles.controls}>
        <Button
          label={phase === "ready" ? "Start" : "Tap the arena when it appears"}
          variant="primary"
          block
          disabled={phase !== "ready"}
          onPress={() => {
            live.current = { phase: "wait", r: 0, times: [] };
            round(0);
          }}
        />
      </View>
    </View>
  );
}

// ── Refeed (Goal) ──

function Refeed({ seed, onFinish }: GameProps) {
  const { colors, styles } = useStyles();
  const foods = useMemo(() => refeedFoods(seed), [seed]);
  const [phase, setPhase] = useState<"ready" | "play" | "done">("ready");
  const [picks, setPicksState] = useState<number[]>([]);
  const picksRef = useRef<number[]>([]);
  const setPicks = (p: number[]) => {
    picksRef.current = p;
    setPicksState(p);
  };
  const [left, setLeft] = useState(REFEED_SECS);
  const t0 = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const done = useRef(false);

  const end = (p: number[]) => {
    if (done.current) return;
    done.current = true;
    if (timer.current) clearInterval(timer.current);
    setPhase("done");
    const l = Math.max(0, REFEED_SECS - (Date.now() - t0.current) / 1000);
    const pts = p.reduce((a, k) => a + foods[k].pts, 0);
    const gentle = p.filter((k) => foods[k].pts > 0).length;
    onFinish({ pts, left: Math.round(l * 10) / 10 }, [
      [`${gentle}/4`, "gentle picks"],
      [`${l.toFixed(1)} s`, "to spare"],
    ]);
  };
  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );

  return (
    <View style={styles.flex}>
      <Hud
        items={[
          ["Picked", `${picks.length}/4`],
          ["Time", left.toFixed(1)],
        ]}
      />
      <View style={[styles.arena, { padding: 10 }]}>
        <View style={styles.plate}>
          {foods.map((f, k) => {
            const on = picks.includes(k);
            const col = f.pts > 0 ? colors.green : "#e06c6c";
            return (
              <Pressable
                key={f.name}
                disabled={phase !== "play"}
                onPress={() => {
                  const next = on
                    ? picks.filter((x) => x !== k)
                    : picks.length < 4
                      ? [...picks, k]
                      : picks;
                  setPicks(next);
                  if (next.length === 4) setTimeout(() => end(next), 250);
                }}
                style={[
                  styles.food,
                  on && {
                    borderColor: col,
                    backgroundColor: withAlpha(col, 0.14),
                  },
                  phase === "ready" && { opacity: 0.55 },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <Text style={styles.foodName}>{f.name}</Text>
                <Text style={styles.small}>{f.detail || " "}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={styles.controls}>
        <Button
          label={phase === "ready" ? "Start" : "Picking…"}
          variant="primary"
          block
          disabled={phase !== "ready"}
          onPress={() => {
            setPhase("play");
            t0.current = Date.now();
            timer.current = setInterval(() => {
              const l = REFEED_SECS - (Date.now() - t0.current) / 1000;
              setLeft(Math.max(0, l));
              if (l <= 0) end(picksRef.current);
            }, 50);
          }}
        />
      </View>
    </View>
  );
}

function makeStyles(colors: Palette) {
  const surface2 = withAlpha(colors.text, 0.07);
  return StyleSheet.create({
    flex: { flex: 1, gap: 8 },
    hud: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingHorizontal: 2,
    },
    hudLabel: {
      fontSize: 12.5,
      color: withAlpha(colors.text, 0.6),
      fontFamily: font.headingSemibold,
    },
    hudValue: {
      fontSize: 15,
      color: colors.text,
      fontFamily: font.headingSemibold,
    },
    arena: {
      flex: 1,
      minHeight: 300,
      borderRadius: 18,
      backgroundColor: colors.surface,
      overflow: "hidden",
    },
    msg: {
      position: "absolute",
      left: 20,
      right: 20,
      top: "42%",
      textAlign: "center",
      fontSize: 15,
      lineHeight: 21,
      color: withAlpha(colors.text, 0.62),
    },
    controls: { paddingTop: 4 },
    row2: { flexDirection: "row", gap: 10 },
    small: { fontSize: 11.5, color: withAlpha(colors.text, 0.58) },
    // craving
    card: {
      position: "absolute",
      left: "15%",
      right: "15%",
      top: "24%",
      borderRadius: 18,
      paddingVertical: 22,
      paddingHorizontal: 14,
      alignItems: "center",
      backgroundColor: surface2,
      gap: 4,
    },
    cardName: {
      fontSize: 20,
      fontFamily: font.headingSemibold,
      color: colors.text,
      textAlign: "center",
      marginTop: 6,
    },
    cardDetail: {
      fontSize: 13,
      color: withAlpha(colors.text, 0.6),
      textAlign: "center",
    },
    side: {
      position: "absolute",
      top: 10,
      fontSize: 12,
      color: withAlpha(colors.text, 0.5),
      fontFamily: font.headingSemibold,
    },
    tbar: { position: "absolute", left: 0, bottom: 0, height: 4 },
    // pour
    glass: {
      width: 120,
      height: 230,
      borderWidth: 3,
      borderTopWidth: 0,
      borderBottomLeftRadius: 22,
      borderBottomRightRadius: 22,
      overflow: "visible",
    },
    water: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "#4f9fe0",
      borderBottomLeftRadius: 18,
      borderBottomRightRadius: 18,
    },
    mark: {
      position: "absolute",
      left: -14,
      right: -14,
      height: 0,
      borderTopWidth: 2,
      borderStyle: "dashed",
    },
    holdBtn: {
      minHeight: 52,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
    },
    holdText: { color: "#fff", fontSize: 16, fontFamily: font.headingSemibold },
    // burn
    zread: {
      position: "absolute",
      left: 0,
      right: 0,
      top: "18%",
      alignItems: "center",
    },
    zbig: {
      fontSize: 44,
      fontFamily: font.headingSemibold,
      color: colors.text,
      fontVariant: ["tabular-nums"],
    },
    gauge: {
      position: "absolute",
      left: 24,
      right: 24,
      top: "52%",
      height: 26,
      borderRadius: 13,
      backgroundColor: surface2,
    },
    zone: {
      position: "absolute",
      top: -6,
      bottom: -6,
      borderWidth: 2,
      borderRadius: 8,
    },
    needle: {
      position: "absolute",
      top: -14,
      width: 4,
      height: 54,
      marginLeft: -2,
      borderRadius: 2,
    },
    ticks: {
      position: "absolute",
      left: 24,
      right: 24,
      top: "52%",
      marginTop: 36,
      flexDirection: "row",
      justifyContent: "space-between",
    },
    // clarity
    dot: {
      position: "absolute",
      width: 64,
      height: 64,
      marginLeft: -32,
      marginTop: -32,
      borderRadius: 32,
      shadowOpacity: 0.5,
      shadowRadius: 12,
    },
    splits: {
      flexDirection: "row",
      justifyContent: "center",
      gap: 10,
      minHeight: 18,
    },
    split: {
      fontSize: 12.5,
      fontFamily: font.headingSemibold,
      color: withAlpha(colors.text, 0.62),
    },
    // refeed
    plate: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    food: {
      width: "31.5%",
      minHeight: 66,
      borderRadius: 12,
      borderWidth: 2,
      borderColor: "transparent",
      backgroundColor: surface2,
      alignItems: "center",
      justifyContent: "center",
      padding: 6,
    },
    foodName: {
      fontSize: 13,
      color: colors.text,
      fontFamily: font.headingSemibold,
      textAlign: "center",
    },
  });
}
