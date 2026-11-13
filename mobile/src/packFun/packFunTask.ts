import * as TaskManager from 'expo-task-manager';
import { pingPackFun } from './packFunApi';
import { PACK_FUN_LOCATION_TASK, getActivePackFun, pedometerStepsSince, setActivePackFun, stopBackgroundSharing } from './packFunSensors';

// Pack Activities' background location (packFunSensors.ts): each update while
// a Pack Activities' map is on reports where you are (and, on iPhone, your
// steps since the start) to the pack. Defined when the app starts
// (index.ts), as background tasks must be.
TaskManager.defineTask(PACK_FUN_LOCATION_TASK, async ({ data, error }) => {
  if (error) return;
  const active = await getActivePackFun();
  if (!active) {
    await stopBackgroundSharing();
    return;
  }
  if (Date.now() >= new Date(active.endsAt).getTime()) {
    await stopBackgroundSharing();
    return;
  }
  const locations = (data as { locations?: { coords: { latitude: number; longitude: number } }[] } | undefined)?.locations ?? [];
  const last = locations[locations.length - 1];
  if (!last) return;
  try {
    const counted = await pedometerStepsSince(new Date(active.startsAt));
    const steps = Math.max(active.steps, counted ?? 0);
    const state = await pingPackFun(active.id, steps, false, { lat: last.coords.latitude, lng: last.coords.longitude });
    if (state.settled) await stopBackgroundSharing();
    else await setActivePackFun({ ...active, steps });
  } catch {
    // Offline for a moment: the next update tries again.
  }
});
