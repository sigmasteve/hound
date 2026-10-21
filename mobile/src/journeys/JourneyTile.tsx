import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CaretRightIcon } from 'phosphor-react-native';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { JourneyMap } from './JourneyMap';
import { courseById, formatMiles, nextStop } from './courses';
import type { MyJourney } from './journeyApi';

// Today's Journey, under the two-by-two: one slim row, so it still fits
// above the tab bar on a phone without scrolling — a small map with you
// on it, the course's name, how far you've come and what's next. Tapping
// it opens the Journey (the whole map). Only shown while you have a
// journey; picking one lives on the You tab.
const MAP_HEIGHT = 56;

export function JourneyTile({ journey, onOpen }: { journey: MyJourney; onOpen: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const course = courseById(journey.courseId);
  if (!course) return null;

  const miles = Math.min(journey.miles, journey.courseMiles);
  const pct = Math.floor((miles / journey.courseMiles) * 100);
  const next = nextStop(course, miles);
  const finished = !!journey.finishedAt;
  // The thumbnail takes the course's own shape, within reason: tall for
  // Chicago, wide for Route 66.
  const lats = course.path.map((p) => p[0]);
  const lngs = course.path.map((p) => p[1]);
  const latSpan = Math.max(...lats) - Math.min(...lats) || 0.001;
  const lngSpan = (Math.max(...lngs) - Math.min(...lngs) || 0.001) * Math.cos((((Math.max(...lats) + Math.min(...lats)) / 2) * Math.PI) / 180);
  const mapWidth = Math.round(Math.max(44, Math.min(96, MAP_HEIGHT * (lngSpan / latSpan))));
  const line = finished
    ? 'Finished 🏅 · tap to pick your next course'
    : `${formatMiles(miles)} of ${formatMiles(journey.courseMiles)} mi · ${pct}%${next ? ` · Next: ${next.name}` : ''}`;

  return (
    <Pressable
      onPress={onOpen}
      style={({ pressed }) => [styles.tile, pressed && { opacity: 0.75 }]}
      accessibilityRole="button"
      accessibilityLabel={`Your Journey, ${journey.courseName}, ${formatMiles(miles)} of ${formatMiles(journey.courseMiles)} miles. Open`}
    >
      <View style={styles.map}>
        <JourneyMap course={course} width={mapWidth} height={MAP_HEIGHT} miles={miles} labels="none" compact />
      </View>
      <View style={styles.text}>
        <Text style={styles.label}>Your Journey</Text>
        <Text style={styles.value} numberOfLines={1}>
          {journey.courseName}
        </Text>
        <Text style={styles.line} numberOfLines={1}>
          {line}
        </Text>
      </View>
      <CaretRightIcon size={14} color={withAlpha(colors.text, 0.4)} />
    </Pressable>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    // The same surface as the other tiles (TodayTiles.tsx), a little less
    // padding, and everything in one row: about 80 points tall.
    tile: {
      backgroundColor: colors.surface,
      borderRadius: 18,
      paddingVertical: 12,
      paddingHorizontal: 13,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      overflow: 'hidden',
    },
    map: { borderRadius: 10, overflow: 'hidden' },
    text: { flex: 1, minWidth: 0, gap: 1 },
    label: {
      fontFamily: font.headingSemibold,
      fontSize: 11.5,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      color: withAlpha(colors.text, 0.55),
    },
    value: { fontFamily: font.headingSemibold, fontSize: 17, color: colors.text },
    line: { fontSize: 12.5, lineHeight: 16, color: withAlpha(colors.text, 0.6) },
  });
}
