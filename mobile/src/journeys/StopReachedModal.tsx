import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, Modal, StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { Confetti } from '../celebrate/Confetti';
import { buzz, playSound } from '../celebrate/feedback';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { CheeringCrowd } from './CheeringCrowd';
import { JourneyMap } from './JourneyMap';
import { formatMiles, pointAt, type Course, type CourseStop } from './courses';
import { stopNote, stopPicture } from './stopNotes';

// The moment you reach a stop on your Journey: a postcard from it (its
// picture, or a map of where it is until there's one), what's there, who
// among your friends got there first, and a crowd cheering you in. Shown
// on Today the first time it opens after you've passed the stop
// (celebrate: confetti, the party horn, a buzz), and again from the
// Journey's list of stops without the fuss. The finish gets the big one.
// The start (mile 0) is only ever opened from the list, as "THE START":
// its postcard, with no word on who got there first. A challenge on a
// course uses the same card for the group reaching a stop, and for a
// look at a stop ahead (eyebrow, line and button set by the caller).
export function StopReachedModal({
  course,
  stop,
  celebrate,
  friendsHere,
  cheerFor,
  eyebrow,
  line,
  buttonLabel,
  onClose,
}: {
  course: Course;
  stop: CourseStop;
  celebrate: boolean;
  // Names of friends on this course who are already past this stop.
  friendsHere: string[];
  // Your initials, for the sign in the crowd.
  cheerFor?: string | null;
  // Instead of "YOU REACHED": "WE REACHED", "UP AHEAD".
  eyebrow?: string;
  // Instead of the friends line; null for none.
  line?: string | null;
  buttonLabel?: string;
  onClose: () => void;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const isFinish = stop.mi >= course.miles;
  const isStart = stop.mi === 0;
  const picture = stopPicture(course, stop);
  const note = stopNote(course, stop);
  const [pictureWidth, setPictureWidth] = useState(0);
  const [confetti, setConfetti] = useState(celebrate);
  const pop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(pop, { toValue: 1, friction: 5, tension: 60, useNativeDriver: true }).start();
    if (celebrate) {
      playSound('party');
      buzz('success');
    }
  }, [pop, celebrate]);

  // How much of the course the map shows around the stop: a mile or so
  // of a bridge, a few miles of a city, a region of a trail.
  const focusMiles = course.miles <= 5 ? 0.8 : course.miles <= 50 ? 3 : course.miles <= 300 ? 30 : 200;
  const pictureHeight = Math.round(pictureWidth * 0.68);
  const friendsLine =
    friendsHere.length === 0
      ? isFinish
        ? 'First of your friends to finish.'
        : 'First of your friends to get here.'
      : friendsHere.length === 1
        ? `${friendsHere[0]} got here before you.`
        : friendsHere.length === 2
          ? `${friendsHere[0]} and ${friendsHere[1]} got here before you.`
          : `${friendsHere[0]}, ${friendsHere[1]} and ${friendsHere.length - 2} more got here before you.`;

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={text.eyebrow}>{eyebrow ?? (isFinish ? 'YOU FINISHED 🏅' : isStart ? 'THE START' : 'YOU REACHED')}</Text>
          <Animated.View
            style={[
              styles.postcard,
              {
                opacity: pop.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] }),
                transform: [
                  { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) },
                  { rotate: pop.interpolate({ inputRange: [0, 1], outputRange: ['-6deg', '-1.5deg'] }) },
                ],
              },
            ]}
          >
            <View style={styles.pictureBox} onLayout={(e) => setPictureWidth(Math.round(e.nativeEvent.layout.width))}>
              {pictureWidth > 0 &&
                (picture ? (
                  <Image source={picture.source} style={{ width: pictureWidth, height: pictureHeight }} resizeMode="cover" />
                ) : (
                  <JourneyMap
                    course={course}
                    width={pictureWidth}
                    height={pictureHeight}
                    miles={stop.mi}
                    labels="none"
                    focus={{ at: pointAt(course, stop.mi), miles: focusMiles }}
                  />
                ))}
            </View>
            <View style={styles.captionRow}>
              <Text style={styles.caption} numberOfLines={1}>
                {course.name.toUpperCase()} · {course.place.toUpperCase()}
              </Text>
              <View style={styles.postmark}>
                <Text style={styles.postmarkText}>MI</Text>
                <Text style={styles.postmarkMile}>{formatMiles(stop.mi)}</Text>
              </View>
            </View>
            {picture?.credit && <Text style={styles.credit}>{picture.credit}</Text>}
          </Animated.View>

          <Text style={styles.title}>{stop.name}</Text>
          {isFinish ? (
            <Text style={styles.sub}>
              The whole {course.name}, {formatMiles(course.miles)} miles. {note ?? ''}
            </Text>
          ) : (
            note && <Text style={styles.sub}>{note}</Text>
          )}
          {line !== null && (line !== undefined ? <Text style={styles.friends}>{line}</Text> : !isStart && <Text style={styles.friends}>{friendsLine}</Text>)}

          <CheeringCrowd sign={cheerFor ? `GO ${cheerFor}!` : 'GO!'} />

          <Button label={buttonLabel ?? (isFinish ? 'Take a bow' : 'Keep going')} variant="primary" onPress={onClose} />
        </View>
        {confetti && <Confetti big={isFinish} onDone={() => setConfetti(false)} />}
      </View>
    </Modal>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    card: {
      width: '100%',
      maxWidth: 360,
      alignItems: 'center',
      gap: 8,
      padding: 20,
      paddingBottom: 16,
      borderRadius: 16,
      backgroundColor: colors.surface,
    },
    // A postcard: white border, a little tilt, a shadow.
    postcard: {
      alignSelf: 'stretch',
      padding: 8,
      paddingBottom: 6,
      backgroundColor: '#fffdf8',
      borderRadius: 6,
      shadowColor: '#000',
      shadowOpacity: 0.25,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
      elevation: 4,
      marginVertical: 6,
    },
    pictureBox: { borderRadius: 3, overflow: 'hidden', backgroundColor: '#e8e9ee' },
    captionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, gap: 8 },
    caption: { flexShrink: 1, fontFamily: font.headingSemibold, fontSize: 10.5, letterSpacing: 1, color: '#6b5a3e' },
    postmark: {
      width: 36,
      height: 36,
      borderRadius: 18,
      borderWidth: 1.5,
      borderColor: '#b3473f',
      alignItems: 'center',
      justifyContent: 'center',
      transform: [{ rotate: '8deg' }],
    },
    postmarkText: { fontFamily: font.headingSemibold, fontSize: 7, letterSpacing: 1, color: '#b3473f', lineHeight: 8 },
    postmarkMile: { fontFamily: font.headingSemibold, fontSize: 11, color: '#b3473f', lineHeight: 13 },
    credit: { fontSize: 9, color: '#9a8c74', marginTop: 2 },
    title: { fontFamily: font.headingSemibold, fontSize: 26, color: colors.text, textAlign: 'center' },
    sub: { fontSize: 14, lineHeight: 19, color: withAlpha(colors.text, 0.75), textAlign: 'center' },
    friends: { fontSize: 12.5, color: colors.accentActive, textAlign: 'center' },
  });
}
