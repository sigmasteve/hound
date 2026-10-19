import AsyncStorage from '@react-native-async-storage/async-storage';
import type { GoalStreak } from '../goals/goalStreakApi';
import { EMPTY_WIDGET_DATA, type WidgetData } from './widgetModel';
import { pushToWidgets } from './pushToWidgets';

// Where the widgets' numbers are kept between updates (widgetModel.ts
// says what they are).
const STORAGE_KEY = 'widgetData';

export async function readWidgetData(): Promise<WidgetData> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? { ...EMPTY_WIDGET_DATA, ...JSON.parse(raw) } : EMPTY_WIDGET_DATA;
  } catch {
    return EMPTY_WIDGET_DATA;
  }
}

// One save at a time: Today's numbers and your hound's picture can arrive
// together, and each save builds on the last one.
let queue: Promise<void> = Promise.resolve();

// Saves what changed on top of what the widget had (background sync knows
// the numbers but not your hound's picture, Today knows both) and redraws
// the widgets, only when something actually changed: iPhone allows a
// widget a limited number of redraws a day.
export function updateWidgets(
  changes: Omit<Partial<WidgetData>, 'streak'> & { streak?: GoalStreak | number | null },
): Promise<void> {
  queue = queue.then(() => save(changes));
  return queue;
}

async function save(changes: Parameters<typeof updateWidgets>[0]): Promise<void> {
  try {
    const { streak, ...rest } = changes;
    const before = await readWidgetData();
    const next: WidgetData = {
      ...before,
      ...rest,
      ...(streak === undefined || streak === null
        ? {}
        : { streak: typeof streak === 'number' ? streak : streak.streak }),
      ready: true,
    };
    const json = JSON.stringify(next);
    if (json === JSON.stringify(before)) return;
    await AsyncStorage.setItem(STORAGE_KEY, json);
    await pushToWidgets(next);
  } catch {
    // A widget that's a little behind is fine; never let it break the app.
  }
}
