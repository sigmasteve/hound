import { requestWidgetUpdate } from 'react-native-android-widget';
import { forNow, type WidgetData } from './widgetModel';
import { HoundGoalsWidget } from './android/HoundGoalsWidget';

// Redraws every Hound widget on the home screen with the new numbers.
// The name matches app.json's react-native-android-widget plugin.
export async function pushToWidgets(data: WidgetData): Promise<void> {
  await requestWidgetUpdate({
    widgetName: 'HoundGoals',
    renderWidget: (info) => HoundGoalsWidget({ data: forNow(data), width: info.width }),
  });
}
