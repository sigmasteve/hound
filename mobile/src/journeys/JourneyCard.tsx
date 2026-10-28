import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import { CaretRightIcon, MapTrifoldIcon } from 'phosphor-react-native';
import { Card } from '../components/Card';
import { ProgressBar } from '../components/ProgressBar';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { JourneyMap } from './JourneyMap';
import { courseById, formatMiles, nextStop } from './courses';
import type { MyJourney } from './journeyApi';

// The You tab's Journey: your course with you on it, how far you've come
// and what's next. With no journey, an invitation to pick one.
export function JourneyCard({
  journey,
  onOpen,
  onPick,
}: {
  journey: MyJourney | null;
  onOpen: () => void;
  onPick: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [width, setWidth] = useState(0);
  const course = journey ? courseById(journey.courseId) : courseById('windy-city');

  if (!journey || !course) {
    return (
      <Pressable onPress={onPick} accessibilityRole="button" style={({ pressed }) => pressed && { opacity: 0.8 }}>
        <Card style={styles.card} elevated={false}>
          <View style={styles.headRow}>
            <MapTrifoldIcon size={16} color={colors.accentActive} />
            <Text style={styles.eyebrow}>JOURNEYS</Text>
          </View>
          <View style={styles.emptyRow}>
            {course && (
              <View style={styles.thumb}>
                <JourneyMap course={course} width={84} height={84} miles={null} labels="none" />
              </View>
            )}
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.title}>Walk a famous course</Text>
              <Text style={styles.sub}>
                Windy City 26.2, Route 66, the Appalachian Trail… Your walks and runs move you along the map.
              </Text>
            </View>
          </View>
          <View style={styles.cta}>
            <Text style={styles.ctaText}>Start a Journey</Text>
            <CaretRightIcon size={13} color={colors.accentActive} />
          </View>
        </Card>
      </Pressable>
    );
  }

  const miles = Math.min(journey.miles, journey.courseMiles);
  const next = nextStop(course, miles);
  const finished = !!journey.finishedAt;

  return (
    <Pressable onPress={onOpen} accessibilityRole="button" style={({ pressed }) => pressed && { opacity: 0.8 }}>
      <Card style={styles.card} elevated={false}>
        <View style={styles.headRow}>
          <MapTrifoldIcon size={16} color={colors.accentActive} />
          <Text style={styles.eyebrow}>{finished ? 'JOURNEY FINISHED 🏅' : 'YOUR JOURNEY'}</Text>
          <View style={{ flex: 1 }} />
          <CaretRightIcon size={14} color={withAlpha(colors.text, 0.4)} />
        </View>
        <Text style={styles.title}>{journey.courseName}</Text>
        <View onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}>
          {width > 0 && <JourneyMap course={course} width={width} height={Math.round(width * 0.5)} miles={miles} labels="none" />}
        </View>
        <View style={{ gap: 6 }}>
          <View style={styles.milesRow}>
            <Text style={styles.miles}>
              {formatMiles(miles)} <Text style={styles.ofMiles}>of {formatMiles(journey.courseMiles)} mi</Text>
            </Text>
            <Text style={styles.pct}>{Math.floor((miles / journey.courseMiles) * 100)}%</Text>
          </View>
          <ProgressBar pct={(miles / journey.courseMiles) * 100} fillColor={colors.accent} height={5} />
          <Text style={styles.sub} numberOfLines={1}>
            {finished
              ? 'Tap to pick your next course.'
              : next
                ? `Next: ${next.name} · ${formatMiles(next.mi - miles)} mi`
                : `${formatMiles(journey.courseMiles - miles)} mi to go`}
          </Text>
        </View>
      </Card>
    </Pressable>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    card: { gap: 10 },
    headRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    eyebrow: { fontSize: 12, letterSpacing: 1, fontFamily: font.headingSemibold, color: colors.accentActive },
    title: { fontFamily: font.heading, fontSize: 18, color: colors.text },
    sub: { fontSize: 13, color: withAlpha(colors.text, 0.6), lineHeight: 18 },
    emptyRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    thumb: { borderRadius: 12, overflow: 'hidden' },
    cta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    ctaText: { fontFamily: font.headingSemibold, fontSize: 14, color: colors.accentActive },
    milesRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    miles: { fontFamily: font.headingSemibold, fontSize: 22, color: colors.text },
    ofMiles: { fontFamily: font.body, fontSize: 14, color: withAlpha(colors.text, 0.6) },
    pct: { fontFamily: font.headingSemibold, fontSize: 14, color: colors.accentActive },
  });
}
