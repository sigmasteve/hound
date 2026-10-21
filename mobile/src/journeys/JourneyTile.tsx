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
  const mapWidth = Math.round(width * 0.44);
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
            <JourneyMap course={course} width={mapWidth} height={104} miles={miles} labels="none" compact />
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
