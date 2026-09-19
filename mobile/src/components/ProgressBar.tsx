import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

export function ProgressBar({
  pct,
  fillColor,
  height = 4,
  trackColor,
}: {
  pct: number; // 0-100
  fillColor?: string;
  height?: number;
  trackColor?: string;
}) {
  const { colors } = useTheme();
  const fill = fillColor ?? colors.accent;
  // ring.md (a mid neutral, picked to sit subtly against that theme's own
  // surface color — see tokens.ts) rather than a fixed dark gray: a
  // caller that doesn't override this explicitly used to get a track
  // that was only ever tuned to look subtle on a dark surface, and would
  // read as a near-black bar on Light mode's white cards otherwise.
  const track = trackColor ?? colors.ring.md;

  return (
    <View style={[styles.track, { height, backgroundColor: track, borderRadius: height / 2 }]}>
      <View
        style={{
          height: '100%',
          width: `${Math.max(0, Math.min(100, pct))}%`,
          backgroundColor: fill,
          borderRadius: height / 2,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { overflow: 'hidden', width: '100%' },
});
