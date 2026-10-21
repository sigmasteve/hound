import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Tile } from '../home/TodayTiles';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { JourneyMap } from './JourneyMap';
import { courseById, formatMiles, nextStop } from './courses';
import type { MyJourney } from './journeyApi';

// Today's Journey tile, under the two-by-two: your course with you on it
// and how far you've come. Tapping it opens the Journey (the whole map).
// Only shown while you have a journey; picking one lives on the You tab.
export function JourneyTile({ journey, onOpen }: { journey: MyJourney; onOpen: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [width, setWidth] = useState(0);
  const course = courseById(journey.courseId);
  if (!course) return null;

  const miles = Math.min(journey.miles, journey.courseMiles);
  const pct = Math.floor((miles / journey.courseMiles) * 100);
  const next = nextStop(course, miles);
  const finished = !!journey.finishedAt;
  // The thumbnail takes the course's own shape: a tall course (Chicago,
  // the Golden Gate) gets a tall box and a long one (Route 66) a wide
  // one, so the line fills it instead of sitting in a sliver of water.
  const lats = course.path.map((p) => p[0]);
  const lngs = course.path.map((p) => p[1]);
  const latSpan = Math.max(...lats) - Math.min(...lats) || 0.001;
  const lngSpan = (Math.max(...lngs) - Math.min(...lngs) || 0.001) * Math.cos((((Math.max(...lats) + Math.min(...lats)) / 2) * Math.PI) / 180);
  const aspect = lngSpan / latSpan;
  const maxWidth = Math.round(width * 0.44);
  let mapHeight = 132;
  let mapWidth = Math.round(mapHeight * aspect);
  if (mapWidth > maxWidth) {
    mapWidth = maxWidth;
    mapHeight = Math.round(mapWidth / aspect);
  }
  mapWidth = Math.max(72, Math.min(mapWidth, maxWidth));
  mapHeight = Math.max(72, Math.min(mapHeight, 132));
  const line = finished
    ? 'Tap to pick your next course'
    : next
      ? `Next: ${next.name} · ${formatMiles(next.mi - miles)} mi`
      : `${formatMiles(journey.courseMiles - miles)} mi to go`;

  return (
    <Tile
      label={finished ? 'Journey finished 🏅' : 'Your Journey'}
      wide
      onPress={onOpen}
      accessibilityLabel={`Your Journey, ${journey.courseName}, ${formatMiles(miles)} of ${formatMiles(journey.courseMiles)} miles. Open`}
    >
      <View style={styles.row} onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}>
        {mapWidth > 0 && (
          <View style={styles.map}>
            <JourneyMap course={course} width={mapWidth} height={mapHeight} miles={miles} labels="none" compact />
          </View>
        )}
        <View style={styles.text}>
          <Text style={styles.value} numberOfLines={1}>
            {journey.courseName}
          </Text>
          <Text style={styles.line} numberOfLines={1}>
            {formatMiles(miles)} of {formatMiles(journey.courseMiles)} mi · {pct}%
          </Text>
          <Text style={styles.line} numberOfLines={1}>
            {line}
          </Text>
        </View>
      </View>
    </Tile>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
    map: { borderRadius: 12, overflow: 'hidden' },
    text: { flex: 1, minWidth: 0 },
    value: { fontFamily: font.headingSemibold, fontSize: 20, color: colors.text },
    line: { fontSize: 12.5, lineHeight: 17, color: withAlpha(colors.text, 0.6) },
  });
}
