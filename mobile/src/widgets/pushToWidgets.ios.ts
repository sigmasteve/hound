import { createWidget } from 'expo-widgets';
import { forNow, type WidgetData } from './widgetModel';
import { HoundFastingLayout, HoundGoalsLayout, HoundStepsLayout } from './ios/layouts';

// Creating a widget hands its layout to the widget (it's kept in the app
// group), so this runs every time the app starts: imported from index.ts,
// it also brings a new layout from an OTA update. The names match
// app.json's expo-widgets plugin.
const goalsWidget = createWidget<WidgetData>('HoundGoals', HoundGoalsLayout as any);
const stepsWidget = createWidget<WidgetData>('HoundSteps', HoundStepsLayout as any);
// 1.3.0.
const fastingWidget = createWidget<WidgetData>('HoundFasting', HoundFastingLayout as any);

function nextMidnight(now: Date): Date {
  const d = new Date(now);
  d.setHours(24, 0, 0, 0);
  return d;
}

// Now, and from midnight the same numbers with today's goals back at zero,
// so the widget doesn't show yesterday's steps all night.
export async function pushToWidgets(data: WidgetData): Promise<void> {
  const now = new Date();
  const midnight = nextMidnight(now);
  const entries = [
    { date: now, props: forNow(data, now) },
    { date: midnight, props: forNow(data, midnight) },
  ];
  goalsWidget.updateTimeline(entries);
  stepsWidget.updateTimeline(entries);
  // The Fasting widget also changes when the goal's reached.
  const open = data.fasting?.open;
  const goalAt = open ? new Date(new Date(open.startedAt).getTime() + open.goalHours * 3600000) : null;
  const fastEntries =
    goalAt && goalAt > now
      ? [...entries, { date: goalAt, props: forNow(data, goalAt) }].sort((a, b) => a.date.getTime() - b.date.getTime())
      : entries;
  fastingWidget.updateTimeline(fastEntries);
}
