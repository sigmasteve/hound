import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Text } from '../components/Text';
import { Avatar } from '../components/Avatar';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { clockText, isLong, longestShort, stripStages, type FastingStage } from './fasting';
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
