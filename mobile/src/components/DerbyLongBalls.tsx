import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Ellipse } from 'react-native-svg';
import { Text } from './Text';
import { font } from '../theme/tokens';
import { perspective } from './perspective';
import { FieldArt, P } from '../screens/BaseballBatScreen';
import { MARKERS, WALL_H, onFence } from '../screens/DerbyBatScreen';
import type { DerbyRow } from '../challenges/derbyApi';

// The Home Run Derby's ballpark (the at-bat's view from behind home plate,
// 0211), small, for the pinned card on Today: the Top 5's longest home runs
// landed in the stands beyond the wall, deeper the longer they went, each
// with its hitter's initials and the distance. Yours in cream.

const ME = '#ffd8b0';
const BALL_COLOR = '#ffffff';
// Where along the fence each place's ball lands: the leader dead center,
// then alternating out toward the lines.
const SPREAD = [0.5, 0.3, 0.7, 0.14, 0.86];

export function DerbyLongBalls({ rows, height = 190 }: { rows: DerbyRow[]; height?: number }) {
  const [w, setW] = useState(0);
  // The at-bat's view, with a deeper stand: that's where the balls land.
  const v = useMemo(
    () => (w > 0 ? perspective(w, height, { stand: height * 0.42, gap: height * 0.02, near: 0, botW: w * 3.2, a: 0.3, b: 0.3 }) : null),
    [w, height],
  );
  const balls = useMemo(() => {
    if (!v) return [];
    return rows.slice(0, 5).filter((r) => r.longestFt > 0).map((r, i) => {
      const t = SPREAD[i];
      const wall = P(v, onFence(t));
      const top = wall.y - WALL_H * wall.s;
      // Deeper into the stand the longer it went: 330 ft just over the
      // wall, 500 ft at the back (kept low enough for its tag to show).
      const k = Math.max(0, Math.min(1, (r.longestFt - 330) / 170));
      return { r, x: wall.x, y: Math.max(40, top - 8 - k * (top - 48)), s: wall.s };
    });
  }, [v, rows, height]);
  const markers = useMemo(() => {
    if (!v) return [];
    return MARKERS.map((m) => {
      const q = P(v, onFence(m.t));
      return { ft: m.ft, x: q.x, y: q.y - WALL_H * q.s };
    });
  }, [v]);

  return (
    <View style={[styles.box, { height }]} onLayout={(e) => setW(Math.floor(e.nativeEvent.layout.width))}>
      {v ? (
        <>
          <FieldArt v={v} />
          {markers.map((m, i) => (
            <Text key={i} style={[styles.marker, { left: m.x - 14, top: m.y + 1 }]} maxFontSizeMultiplier={1}>
              {m.ft}
            </Text>
          ))}
          <Svg width={w} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
            {balls.map((b) => (
              <React.Fragment key={b.r.userId}>
                <Ellipse cx={b.x} cy={b.y + 3} rx={4} ry={1.5} fill="rgba(0,0,0,0.35)" />
                <Circle cx={b.x} cy={b.y} r={3.6} fill={BALL_COLOR} stroke={b.r.isMe ? ME : 'rgba(0,0,0,0.35)'} strokeWidth={b.r.isMe ? 1.6 : 0.6} />
              </React.Fragment>
            ))}
          </Svg>
          {balls.map((b) => (
            <View key={`tag${b.r.userId}`} pointerEvents="none" style={[styles.tag, { left: b.x - 23, top: b.y - 38 }, b.r.isMe && styles.tagMe]}>
              <Text style={[styles.tagName, b.r.isMe && styles.tagNameMe]} numberOfLines={1} maxFontSizeMultiplier={1}>
                {b.r.isMe ? 'You' : b.r.initials}
              </Text>
              <Text style={[styles.tagFt, b.r.isMe && styles.tagNameMe]} numberOfLines={1} maxFontSizeMultiplier={1}>
                {b.r.longestFt} ft
              </Text>
            </View>
          ))}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: '100%', borderRadius: 14, overflow: 'hidden', backgroundColor: '#1d2133' },
  marker: { position: 'absolute', width: 28, textAlign: 'center', fontSize: 9, fontFamily: font.headingSemibold, color: 'rgba(255,255,255,0.85)' },
  tag: {
    position: 'absolute',
    width: 46,
    alignItems: 'center',
    paddingVertical: 2,
    borderRadius: 7,
    backgroundColor: 'rgba(22,24,38,0.82)',
  },
  tagMe: { backgroundColor: ME },
  tagName: { fontSize: 10, fontFamily: font.headingSemibold, color: '#ffffff' },
  tagFt: { fontSize: 9, color: 'rgba(255,255,255,0.8)' },
  tagNameMe: { color: '#161826' },
});
