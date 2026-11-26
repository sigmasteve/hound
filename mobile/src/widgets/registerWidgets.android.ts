import { registerWidgetTaskHandler } from 'react-native-android-widget';
import { readWidgetData } from './widgetData';
import { forNow } from './widgetModel';
import { HoundGoalsWidget } from './android/HoundGoalsWidget';
import { HoundFastingWidget } from './android/HoundFastingWidget';

// Android asks the app to draw the widget when it's added, resized, and
// every 30 minutes (app.json), even with Hound closed: it draws whatever
// the app last saved, reset to zero on a new day. Taps open the app
// (OPEN_APP), or Hound at a link (OPEN_URI: Fasting, logging an
// activity), so there's nothing else to handle.
export function registerWidgets(): void {
  registerWidgetTaskHandler(async ({ widgetInfo, widgetAction, renderWidget }) => {
    if (widgetAction === 'WIDGET_DELETED' || widgetAction === 'WIDGET_CLICK') return;
    const data = await readWidgetData();
    renderWidget(
      widgetInfo.widgetName === 'HoundFasting'
        ? HoundFastingWidget({ data: forNow(data) })
        : HoundGoalsWidget({ data: forNow(data), width: widgetInfo.width }),
    );
  });
}
