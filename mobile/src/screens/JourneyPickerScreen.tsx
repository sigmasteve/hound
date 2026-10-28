import React, { Fragment, useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeftIcon } from 'phosphor-react-native';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { JourneyMap } from '../journeys/JourneyMap';
import { COURSES, COURSE_KIND_LABEL, formatMiles, type Course, type CourseKind } from '../journeys/courses';
import { friendsCourseCounts, getMyJourney, startJourney, type MyJourney } from '../journeys/journeyApi';
import { todayMiles } from '../journeys/journeySync';
import { useHealthProvider } from '../health/HealthContext';
import { useAuth } from '../auth/AuthContext';

const KIND_ORDER: CourseKind[] = ['landmark', 'city', 'ultra', 'trail'];

// Pick a course to walk. Starting one ends the Journey you're on.
export function JourneyPickerScreen({ onBack, onStarted }: { onBack: () => void; onStarted: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const health = useHealthProvider();
  const { user } = useAuth();
  const [current, setCurrent] = useState<MyJourney | null>(null);
  const [busy, setBusy] = useState(false);
  const [friendCounts, setFriendCounts] = useState<Map<string, number>>(new Map());

  useFocusEffect(
    useCallback(() => {
      getMyJourney()
        .then(setCurrent)
        .catch(() => setCurrent(null));
      friendsCourseCounts()
        .then(setFriendCounts)
        .catch(() => setFriendCounts(new Map()));
    }, []),
  );
  const active = current && !current.finishedAt ? current : null;

  const start = (course: Course) => {
    const go = () => {
      setBusy(true);
      // The day's miles so far stay with the course you're leaving.
      (user?.id ? todayMiles(user.id, health) : Promise.resolve(null))
        .then((today) => startJourney(course, today))
        .then(onStarted)
        .catch((e) => Alert.alert('Couldn’t start it', e instanceof Error ? e.message : String(e)))
        .finally(() => setBusy(false));
    };
    if (active) {
      Alert.alert(
        `Switch to the ${course.name}?`,
        `You'll leave the ${active.courseName} at mile ${formatMiles(active.miles)}. Your new course starts from now.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Switch', onPress: go },
        ],
      );
    } else {
      go();
    }
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.container}>
        <Button label="Back" variant="ghost" small icon={<ArrowLeftIcon size={13} color={colors.accent} />} onPress={onBack} />
        <View style={{ gap: 6 }}>
          <Text style={styles.title}>Pick a Journey</Text>
          <Text style={styles.sub}>
            Walk a famous course with your own miles. Your walks, runs and hikes move you along the map, starting today. Friends on the same course show up on your map.
          </Text>
        </View>

        {KIND_ORDER.map((kind) => (
          <Fragment key={kind}>
            <Text style={styles.groupTitle}>{COURSE_KIND_LABEL[kind].toUpperCase()}</Text>
            {COURSES.filter((c) => c.kind === kind).map((course) => {
              const isCurrent = active?.courseId === course.id;
              const friends = friendCounts.get(course.id) ?? 0;
              return (
                <Pressable
                  key={course.id}
                  onPress={() => (isCurrent ? onBack() : start(course))}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={`${course.name}, ${formatMiles(course.miles)} miles`}
                  style={({ pressed }) => pressed && { opacity: 0.8 }}
                >
                  <Card style={isCurrent ? [styles.courseCard, styles.currentCard] : styles.courseCard} elevated={false}>
                    <View style={styles.thumb}>
                      <JourneyMap course={course} width={88} height={88} miles={null} labels="none" />
                    </View>
                    <View style={{ flex: 1, gap: 3 }}>
                      <View style={styles.nameRow}>
                        <Text style={styles.name} numberOfLines={1}>
                          {course.name}
                        </Text>
                        {isCurrent && <Text style={styles.chip}>ON IT</Text>}
                      </View>
                      <Text style={styles.meta}>
                        {course.place} · {formatMiles(course.miles)} mi
                        {friends > 0 && <Text style={styles.friends}>{` · ${friends} ${friends === 1 ? 'friend' : 'friends'}`}</Text>}
                      </Text>
                      <Text style={styles.blurb} numberOfLines={3}>
                        {course.blurb}
                      </Text>
                    </View>
                  </Card>
                </Pressable>
              );
            })}
          </Fragment>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    container: { padding: 16, gap: 14, paddingBottom: 48 },
    title: { fontFamily: font.heading, fontSize: 26, color: colors.text },
    sub: { fontSize: 14, color: withAlpha(colors.text, 0.65), lineHeight: 20 },
    groupTitle: {
      marginTop: 6,
      marginBottom: -6,
      marginLeft: 4,
      fontSize: 12,
      letterSpacing: 1,
      fontFamily: font.headingSemibold,
      color: withAlpha(colors.text, 0.55),
    },
    courseCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    currentCard: { borderWidth: 1.5, borderColor: colors.accent },
    thumb: { borderRadius: 12, overflow: 'hidden' },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    name: { flexShrink: 1, fontFamily: font.heading, fontSize: 16, color: colors.text },
    chip: {
      fontSize: 10,
      letterSpacing: 0.8,
      fontFamily: font.headingSemibold,
      color: colors.accentActive,
      backgroundColor: withAlpha(colors.accent, 0.16),
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 6,
      overflow: 'hidden',
    },
    meta: { fontSize: 12.5, fontFamily: font.headingSemibold, color: colors.accentActive },
    friends: { color: colors.green },
    blurb: { fontSize: 13, color: withAlpha(colors.text, 0.65), lineHeight: 18 },
  });
}
