import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg';
import { DropIcon, FireIcon, FlagCheckeredIcon, ForkKnifeIcon, LightningIcon, SparkleIcon, WarningIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { Avatar } from '../components/Avatar';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { STAGES, STAGE_COLOR, clockText, isLong, longestShort, stageAt, stripStages, type FastingStage } from './fasting';
import type { FastingPerson } from './fastingApi';

// Pieces the Fasting screens share: the ring, the stage strip, a person's
// avatar, and the longest fast that reads "24 h+" until tapped.

export function FastRing({
  size,
  hours,
  goal,
  done,
  children,
}: {
  size: number;
  hours: number;
  goal: number;
  done?: boolean;
  children?: React.ReactNode;
}) {
  const { colors } = useTheme();
  const stroke = Math.round(size * 0.075);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = done ? 1 : Math.min(1, hours / Math.max(goal, 1));
  const color = done || pct >= 1 ? colors.green : colors.accent;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={withAlpha(colors.text, 0.12)} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {children}
    </View>
  );
}

// The stages up to the goal as a strip, filled as far as you've got.
export function StageStrip({ hours, goal }: { hours: number; goal: number }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const stages = stripStages(goal);
  const end = Math.max(goal, stages[stages.length - 1].to === Infinity ? goal : Math.min(stages[stages.length - 1].to, 24));
  const span = (s: FastingStage) => Math.max(1, Math.min(s.to, end) - s.from);
  return (
    <View style={{ gap: 4 }}>
      <View style={styles.strip}>
        {stages.map((s) => {
          const fill = Math.max(0, Math.min(1, (hours - s.from) / span(s)));
          return (
            <View key={s.key} style={[styles.seg, { flex: span(s) }]}>
              <View style={[styles.segFill, { width: `${fill * 100}%` }]} />
            </View>
          );
        })}
      </View>
      <View style={styles.strip}>
        {stages.map((s) => (
          <Text key={s.key} style={[styles.segLabel, { flex: span(s) }]} numberOfLines={1}>
            {s.short}
          </Text>
        ))}
      </View>
    </View>
  );
}

export function PersonAvatar({ p, size = 30 }: { p: FastingPerson; size?: number }) {
  const { colors } = useTheme();
  return (
    <Avatar
      initials={p.initials}
      tint={colors.accent800}
      size={size}
      fontSize={Math.round(size * 0.38)}
      iconId={p.iconId}
      frameId={p.frameId}
      backgroundId={p.backgroundId}
    />
  );
}

// A longest fast: the time, or "24 h+" that shows the time when tapped.
export function LongestText({ hours, style }: { hours: number; style?: any }) {
  const { colors } = useTheme();
  const [shown, setShown] = useState(false);
  if (!isLong(hours)) return <Text style={style}>{longestShort(hours)}</Text>;
  return (
    <Pressable
      onPress={() => setShown((s) => !s)}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={shown ? `Longest ${clockText(hours)}` : 'Longest 24 hours or more. Tap to see'}
    >
      <Text style={[style, { color: colors.accentActive, textDecorationLine: shown ? 'none' : 'underline' }]}>
        {shown ? clockText(hours) : '24 h+'}
      </Text>
    </Pressable>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    strip: { flexDirection: 'row', gap: 3 },
    seg: { height: 6, borderRadius: 3, backgroundColor: withAlpha(colors.text, 0.12), overflow: 'hidden' },
    segFill: { height: 6, backgroundColor: colors.accent },
    segLabel: { fontSize: 10, color: withAlpha(colors.text, 0.55), fontFamily: font.body },
  });
}

// ── The dial (Steve, Nov 2026: "an icon or arrow or some indicator for
// Fed/Settling/Fat Burn/Ketosis... see what is coming up") ──

const STAGE_ICON: Record<string, React.ComponentType<any>> = {
  fed: ForkKnifeIcon,
  settling: DropIcon,
  fatburn: FireIcon,
  ketosis: LightningIcon,
  deep: SparkleIcon,
  prolonged: WarningIcon,
};

export function StageIcon({ stageKey, size = 16, color }: { stageKey: string; size?: number; color: string }) {
  const Icon = STAGE_ICON[stageKey] ?? SparkleIcon;
  return <Icon size={size} color={color} weight="fill" />;
}

// The fast as a dial: the ring split into the stages up to your goal,
// each in its own colour, filled as you go; a badge with the stage's icon
// where each one starts (lit once reached, the current one pulsing), its
// hour beside it, a flag at the goal and an arrowhead where you are now,
// pointing the way the fast is going (Steve, Nov 2026: "hard to know where
// I'm at"). What's done is drawn thick and bright over a thin, pale track
// for what's to go, with a stronger track and glow in light mode, where
// the pale colours washed out.
export function FastDial({ size, hours, goal, children }: { size: number; hours: number; goal: number; children?: React.ReactNode }) {
  const { colors, mode } = useTheme();
  const light = mode === 'light';
  // Fed's grey reads as "off" on a light page; a deeper slate there.
  const col = (key: string) => (light && key === 'fed' ? '#6b7394' : STAGE_COLOR[key]);
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const c = size / 2;
  const stroke = Math.round(size * 0.055);
  const track = Math.round(stroke * 0.62);
  const fill = Math.round(stroke * 1.15);
  const R = c - 36;
  const C = 2 * Math.PI * R;
  const done = hours >= goal;
  const frac = Math.min(1, hours / goal);
  const current = stageAt(hours);
  const segs = STAGES.filter((s) => s.from < goal).map((s) => ({ s, a: s.from / goal, b: Math.min(s.to, goal) / goal }));
  const at = (f: number, r: number) => {
    const th = f * 2 * Math.PI - Math.PI / 2;
    return { x: c + Math.cos(th) * r, y: c + Math.sin(th) * r };
  };
  const gap = 3;
  const arc = (a: number, b: number) => ({
    strokeDasharray: `${Math.max(0, (b - a) * C - gap)} ${C}`,
    transform: `rotate(${a * 360 - 90 + (gap / C) * 180} ${c} ${c})`,
  });
  // You are here: what's done ends in an arrowhead, its point exactly at
  // now, its body bent along the ring and wider than it, pointing the way
  // the fast is going. The filled arc stops under the arrowhead so its
  // rounded end never pokes past the point.
  const polar = (f: number, r: number) => {
    const p = at(f, r);
    return `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  };
  const behind = (px: number) => frac - px / C;
  const arrow = `M ${polar(frac, R)} L ${polar(behind(fill * 1.55), R - fill * 0.85)} L ${polar(behind(fill * 1.0), R)} L ${polar(behind(fill * 1.55), R + fill * 0.85)} Z`;
  const fillTo = behind(fill * 1.3);
  const badge = 30;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="dialGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0.55" stopColor={STAGE_COLOR[current.key]} stopOpacity="0" />
            <Stop offset="0.8" stopColor={STAGE_COLOR[current.key]} stopOpacity={light ? '0.24' : '0.16'} />
            <Stop offset="1" stopColor={STAGE_COLOR[current.key]} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Circle cx={c} cy={c} r={c - 2} fill="url(#dialGlow)" />
        {segs.map(({ s, a, b }) => (
          <Circle
            key={`t-${s.key}`}
            cx={c}
            cy={c}
            r={R}
            stroke={withAlpha(col(s.key), light ? 0.3 : 0.22)}
            strokeWidth={track}
            strokeLinecap="round"
            fill="none"
            {...arc(a, b)}
          />
        ))}
        {segs
          .filter(({ a }) => (done ? frac : fillTo) > a)
          .map(({ s, a, b }) => (
            <Circle
              key={`p-${s.key}`}
              cx={c}
              cy={c}
              r={R}
              stroke={done ? colors.green : col(s.key)}
              strokeWidth={fill}
              strokeLinecap="round"
              fill="none"
              {...arc(a, Math.min(b, done ? frac : fillTo))}
            />
          ))}
      </Svg>

      {/* A badge where each stage starts, and the goal's flag at the top. */}
      {segs
        .filter(({ s }) => s.from > 0)
        .map(({ s, a }) => {
          const p = at(a, R);
          const label = at(a, R + 27);
          const reached = hours >= s.from;
          const isNow = current.key === s.key;
          const sc = col(s.key);
          return (
            <React.Fragment key={`b-${s.key}`}>
              {isNow && !done && (
                <Animated.View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    left: p.x - badge / 2,
                    top: p.y - badge / 2,
                    width: badge,
                    height: badge,
                    borderRadius: badge / 2,
                    backgroundColor: sc,
                    opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
                    transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.8] }) }],
                  }}
                />
              )}
              <View
                style={{
                  position: 'absolute',
                  left: p.x - badge / 2,
                  top: p.y - badge / 2,
                  width: badge,
                  height: badge,
                  borderRadius: badge / 2,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: reached ? sc : colors.surface,
                  borderWidth: 2,
                  borderColor: sc,
                }}
                accessibilityLabel={`${s.name} from ${s.from} hours${reached ? ', reached' : ''}`}
              >
                <StageIcon stageKey={s.key} size={15} color={reached ? '#fff' : sc} />
              </View>
              <Text
                style={{
                  position: 'absolute',
                  left: label.x - 22,
                  top: label.y - 8,
                  width: 44,
                  textAlign: 'center',
                  fontSize: 10.5,
                  fontFamily: font.headingSemibold,
                  color: reached ? sc : withAlpha(colors.text, 0.5),
                }}
              >
                {s.from} h
              </Text>
            </React.Fragment>
          );
        })}
      <View
        style={{
          position: 'absolute',
          left: c - badge / 2,
          top: c - R - badge / 2,
          width: badge,
          height: badge,
          borderRadius: badge / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: done ? colors.green : colors.surface,
          borderWidth: 2,
          borderColor: done ? colors.green : withAlpha(colors.text, 0.35),
        }}
        accessibilityLabel={`Goal, ${goal} hours`}
      >
        <FlagCheckeredIcon size={14} color={done ? '#fff' : colors.text} weight="fill" />
      </View>
      <Text
        style={{
          position: 'absolute',
          left: c - 50,
          top: c - R - badge / 2 - 18,
          width: 100,
          textAlign: 'center',
          fontSize: 10.5,
          fontFamily: font.headingSemibold,
          color: done ? colors.green : withAlpha(colors.text, 0.6),
        }}
        numberOfLines={1}
      >
        Goal {goal} h
      </Text>
      {/* You are here, over the badges so one never hides it. */}
      {!done && (
        <Svg width={size} height={size} style={StyleSheet.absoluteFill} pointerEvents="none">
          <Path d={arrow} transform="translate(0 1.5)" fill={withAlpha('#000000', light ? 0.14 : 0.35)} />
          <Path d={arrow} fill={col(current.key)} stroke={light ? '#fff' : colors.bg} strokeWidth={2} strokeLinejoin="round" />
        </Svg>
      )}
      {children}
    </View>
  );
}
