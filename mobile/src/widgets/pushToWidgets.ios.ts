import { createWidget } from 'expo-widgets';
import { forNow, type WidgetData } from './widgetModel';
import { HoundGoalsLayout, HoundStepsLayout } from './ios/layouts';

// Creating a widget hands its layout to the widget (it's kept in the app
// group), so this runs every time the app starts: imported from index.ts,
// it also brings a new layout from an OTA update. The names match
// app.json's expo-widgets plugin.
const goalsWidget = createWidget<WidgetData>('HoundGoals', HoundGoalsLayout as any);
const stepsWidget = createWidget<WidgetData>('HoundSteps', HoundStepsLayout as any);

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
}
