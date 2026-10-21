import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Course, CourseStop } from './courses';
import type { MyJourney } from './journeyApi';

// Which stops you've been shown reaching (StopReachedModal), per
// journey, on this phone: the furthest one's mile. The sync's own
// notification is separate (journeySync.ts's NOTIFIED_KEY); this is
// about the moment on Today.

const KEY = (journeyId: string) => `journey:celebrated:${journeyId}`;

// The latest stop you've reached that hasn't had its moment yet, or null.
// Several passed at once collapse into the furthest; the start never
// counts; the finish does once the journey is finished.
export async function pendingStopMoment(journey: MyJourney, course: Course): Promise<CourseStop | null> {
  const shown = Number((await AsyncStorage.getItem(KEY(journey.id)).catch(() => null)) ?? '0');
  const miles = journey.finishedAt ? course.miles : Math.min(journey.miles, course.miles);
  const reached = course.stops.filter((s) => s.mi > 0 && s.mi <= miles && s.mi > shown);
  // The finish only once it's really finished (the server decides).
  const eligible = reached.filter((s) => s.mi < course.miles || journey.finishedAt);
  return eligible[eligible.length - 1] ?? null;
}

export async function markStopMomentShown(journeyId: string, stop: CourseStop): Promise<void> {
  await AsyncStorage.setItem(KEY(journeyId), String(stop.mi)).catch(() => {});
}
