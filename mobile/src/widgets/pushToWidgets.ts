import type { WidgetData } from './widgetModel';

// Web has no widgets (pushToWidgets.ios.ts and .android.tsx do the work).
export async function pushToWidgets(_data: WidgetData): Promise<void> {}
