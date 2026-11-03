import type { WaterGoal } from './water';

// The latest water goal and day totals, for code outside React that ticks
// challenge items on water days (challenges/deviceSync.ts). WaterContext
// keeps it current. Empty in a background refresh that never ran the
// app: nothing ticks from water then, and it catches up on the next open.

export interface WaterSnapshot {
  goal: WaterGoal | null;
  // Each local day's total in ml (Hound plus Health).
  byDay: Map<string, number>;
}

let snapshot: WaterSnapshot = { goal: null, byDay: new Map() };

export function setWaterSnapshot(next: WaterSnapshot): void {
  snapshot = next;
}

export function getWaterSnapshot(): WaterSnapshot {
  return snapshot;
}
