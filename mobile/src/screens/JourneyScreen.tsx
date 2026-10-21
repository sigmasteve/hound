import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Switch, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeftIcon, ArrowsLeftRightIcon, CheckCircleIcon, CircleIcon } from 'phosphor-react-native';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ProgressBar } from '../components/ProgressBar';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { useAuth } from '../auth/AuthContext';
import { JourneyMap, type MapPerson } from '../journeys/JourneyMap';
import { courseById, formatMiles, nextStop } from '../journeys/courses';
import {
  endJourney,
  friendsOnCourse,
  getMyJourney,
  setJourneyCountAll,
  type FriendOnCourse,
  type MyJourney,
} from '../journeys/journeyApi';

// Friends on the map, in the order they're listed.
const FRIEND_COLORS = ['#f4a7b9', '#7fd39b', '#8fc1ff', '#e0a94f', '#c9a7f4', '#f49b7a'];

// Your Journey up close: the course with you (and any friends on it), how
// far you've come, the stops, and the settings for it.
export function JourneyScreen({ onBack, onPick }: { onBack: () => void; onPick: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  const { width: screenWidth } = useWindowDimensions();
  const mapWidth = Math.min(screenWidth, 600) - 32;

  const [journey, setJourney] = useState<MyJourney | null | undefined>(undefined);
  const [friends, setFriends] = useState<FriendOnCourse[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    getMyJourney()
      .then((j) => {
        setJourney(j);
        if (j) friendsOnCourse(j.courseId).then(setFriends).catch(() => setFriends([]));
      })
      .catch(() => setJourney(null));
  }, []);
  useFocusEffect(load);

  const course = journey ? courseById(journey.courseId) : undefined;

  if (journey === undefined || !journey || !course) {
    return (
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <View style={styles.container}>
          <Button label="Back" variant="ghost" small icon={<ArrowLeftIcon size={13} color={colors.accent} />} onPress={onBack} />
          {journey === undefined ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
          ) : (
            <Card style={{ gap: 12 }} elevated={false}>
              <Text style={styles.title}>No Journey yet</Text>
              <Text style={styles.sub}>Pick a course and your walks and runs move you along it.</Text>
              <Button label="Pick a course" variant="primary" onPress={onPick} />
            </Card>
          )}
        </View>
      </SafeAreaView>
    );
  }

  const miles = Math.min(journey.miles, journey.courseMiles);
  const finished = !!journey.finishedAt;
  const next = nextStop(course, miles);

  // You plus friends when there are any; on your own, the map's paw.
  const people: MapPerson[] =
    friends.length === 0
      ? []
      : [
          ...friends.map((f, i) => ({
            id: f.userId,
            miles: f.miles,
            initials: f.initials,
            color: FRIEND_COLORS[i % FRIEND_COLORS.length],
          })),
          { id: 'me', miles, initials: user?.initials ?? 'Me', color: colors.accent },
        ];

  const toggleCountAll = (on: boolean) => {
    setJourney({ ...journey, countAllMiles: on });
    setJourneyCountAll(on)
      .then(load)
      .catch((e) => {
        setJourney({ ...journey });
        Alert.alert('Couldn’t change that', e instanceof Error ? e.message : String(e));
      });
  };

  const confirmEnd = () =>
    Alert.alert('End this Journey?', `Your ${formatMiles(miles)} miles on the ${course.name} won’t carry over.`, [
      { text: 'Keep going', style: 'cancel' },
      {
        text: 'End it',
        style: 'destructive',
        onPress: () => {
          setBusy(true);
          endJourney()
            .then(onBack)
            .catch((e) => Alert.alert('Couldn’t end it', e instanceof Error ? e.message : String(e)))
            .finally(() => setBusy(false));
        },
      },
    ]);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.container}>
        <Button label="Back" variant="ghost" small icon={<ArrowLeftIcon size={13} color={colors.accent} />} onPress={onBack} />

        <View style={{ gap: 2 }}>
          <Text style={styles.eyebrow}>{finished ? 'FINISHED 🏅' : course.place.toUpperCase()}</Text>
          <Text style={styles.title}>{course.name}</Text>
        </View>

        <JourneyMap course={course} width={mapWidth} height={Math.round(mapWidth * 0.75)} miles={miles} people={people} labels="few" />

        <Card style={{ gap: 8 }} elevated={false}>
          <View style={styles.milesRow}>
            <Text style={styles.miles}>
              {formatMiles(miles)} <Text style={styles.ofMiles}>of {formatMiles(journey.courseMiles)} mi</Text>
            </Text>
            <Text style={styles.pct}>{Math.floor((miles / journey.courseMiles) * 100)}%</Text>
          </View>
          <ProgressBar pct={(miles / journey.courseMiles) * 100} fillColor={colors.accent} height={6} />
          <Text style={styles.sub}>
            {finished
              ? `You walked the whole thing. ${journey.finishedCount} ${journey.finishedCount === 1 ? 'course' : 'courses'} finished so far.`
              : next
                ? `Next: ${next.name}, ${formatMiles(next.mi - miles)} mi away. ${formatMiles(journey.courseMiles - miles)} mi to the finish.`
                : `${formatMiles(journey.courseMiles - miles)} mi to the finish.`}
          </Text>
          {finished && <Button label="Pick your next course" variant="primary" onPress={onPick} />}
        </Card>

        {friends.length > 0 && (
          <>
            <Text style={styles.groupTitle}>FRIENDS ON THIS COURSE</Text>
            <Card style={{ paddingVertical: 4 }} elevated={false}>
              {friends.map((f, i) => (
                <View key={f.userId} style={[styles.row, i > 0 && styles.rowDivider]}>
                  <View style={[styles.dot, { backgroundColor: FRIEND_COLORS[i % FRIEND_COLORS.length] }]} />
                  <Avatar
                    initials={f.initials}
                    tint={colors.accent800}
                    size={30}
                    fontSize={11}
                    frameId={f.frameId}
                    backgroundId={f.backgroundId}
                    iconId={f.iconId}
                  />
                  <Text style={styles.rowLabel} numberOfLines={1}>
                    {f.name}
                  </Text>
                  <Text style={styles.rowDetail}>{f.finishedAt ? 'Finished 🏅' : `${formatMiles(f.miles)} mi`}</Text>
                </View>
              ))}
            </Card>
          </>
        )}

        <Text style={styles.groupTitle}>STOPS</Text>
        <Card style={{ paddingVertical: 4 }} elevated={false}>
          {course.stops.map((s, i) => {
            const passed = s.mi <= miles && (s.mi > 0 || miles > 0);
            return (
              <View key={s.mi} style={[styles.row, i > 0 && styles.rowDivider]}>
                {passed ? (
                  <CheckCircleIcon size={18} color={colors.gold} weight="fill" />
                ) : (
                  <CircleIcon size={18} color={withAlpha(colors.text, 0.35)} />
                )}
                <Text style={[styles.rowLabel, !passed && { color: withAlpha(colors.text, 0.7) }]} numberOfLines={1}>
                  {s.name}
                </Text>
                <Text style={styles.rowDetail}>mi {formatMiles(s.mi)}</Text>
              </View>
            );
          })}
        </Card>

        {!finished && (
          <>
            <Text style={styles.groupTitle}>WHICH MILES COUNT</Text>
            <Card style={{ gap: 6 }} elevated={false}>
              <View style={styles.switchRow}>
                <Text style={[styles.rowLabel, { flex: 1 }]}>Count every walking & running mile</Text>
                <Switch
                  value={journey.countAllMiles}
                  onValueChange={toggleCountAll}
                  // The off track too: iOS's default light grey vanishes
                  // against a white card in light mode.
                  trackColor={{ false: withAlpha(colors.text, 0.22), true: colors.accent }}
                  ios_backgroundColor={withAlpha(colors.text, 0.22)}
                  accessibilityLabel="Count every walking and running mile"
                />
              </View>
              <Text style={styles.sub}>
                {journey.countAllMiles
                  ? 'Every mile your phone counts, workout or not.'
                  : 'Only walks, runs and hikes you log as workouts. Turn on to count all the miles your phone counts.'}{' '}
                Miles count from the day you started ({journey.startedOn}).
              </Text>
            </Card>

            <View style={styles.actions}>
              <Button
                label="Switch course"
                icon={<ArrowsLeftRightIcon size={14} color={colors.text} />}
                onPress={onPick}
                style={{ flex: 1 }}
              />
              <Button label="End Journey" variant="ghost" onPress={confirmEnd} disabled={busy} style={{ flex: 1 }} />
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    container: { padding: 16, gap: 16, paddingBottom: 48 },
    eyebrow: { fontSize: 12, letterSpacing: 1, fontFamily: font.headingSemibold, color: colors.accentActive },
    title: { fontFamily: font.heading, fontSize: 26, color: colors.text },
    sub: { fontSize: 13.5, color: withAlpha(colors.text, 0.65), lineHeight: 19 },
    milesRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    miles: { fontFamily: font.headingSemibold, fontSize: 28, color: colors.text },
    ofMiles: { fontFamily: font.body, fontSize: 15, color: withAlpha(colors.text, 0.6) },
    pct: { fontFamily: font.headingSemibold, fontSize: 16, color: colors.accentActive },
    groupTitle: {
      marginBottom: -8,
      marginLeft: 4,
      fontSize: 12,
      letterSpacing: 1,
      fontFamily: font.headingSemibold,
      color: withAlpha(colors.text, 0.55),
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11 },
    rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
    rowLabel: { flexShrink: 1, fontFamily: font.heading, fontSize: 15, color: colors.text },
    rowDetail: { flex: 1, textAlign: 'right', fontSize: 13, color: withAlpha(colors.text, 0.55) },
    dot: { width: 8, height: 8, borderRadius: 4 },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    actions: { flexDirection: 'row', gap: 10 },
  });
}
