import React from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../theme/ThemeContext';
import { useWater } from './WaterContext';
import { waterColors } from './WaterGlass';

// A small blue drop on a day the water goal was met, for the Goals sheet's
// week strip and four-week grid. Water days sit beside goal days, never
// in them. With a water goal, a day that wasn't met keeps the space
// (`reserve`), so the strip stays lined up.
export function WaterDayDrop({ day, size = 7, reserve = false }: { day: string; size?: number; reserve?: boolean }) {
  const { mode } = useTheme();
  const water = useWater();
  if (!water.goal) return null;
  const met = (water.byDay.get(day) ?? 0) >= water.goal.targetMl;
  const h = size * 1.35;
  if (!met) return reserve ? <View style={{ width: size, height: h }} /> : null;
  return (
    <Svg width={size} height={h} viewBox="0 0 11 15" accessibilityLabel="Water goal met">
      <Path d="M5.5 0 C 7.5 3.5 11 6.5 11 9.2 A 5.5 5.5 0 0 1 0 9.2 C 0 6.5 3.5 3.5 5.5 0 Z" fill={waterColors(mode).water} />
    </Svg>
  );
}
