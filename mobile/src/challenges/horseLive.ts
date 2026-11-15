// H-O-R-S-E, call your shot (0209): the spots, the calls, and the window,
// mirrored from the server's formula so the meter moves the moment you
// change your call (horse_preview has the last word, and horse_shoot
// decides the shot). See 0209_horse_live.sql.
//
// The half court is seen from above half court, looking at the basket:
// u runs across (-1 the left sideline, 1 the right), v from the baseline
// (0) to half court (1). The basket is at v 0.112 (5.25 ft out).

export type HorseFarKind = 'stands' | 'rafters' | 'lot' | 'roof';
export type HorseSpot = { kind: 'floor'; u: number; v: number } | { kind: 'bench' } | { kind: HorseFarKind };
export type HorseCall = 'floor' | 'board' | 'glass' | 'billboard' | 'back' | 'net';

export const BASKET_V = 0.112;
// Up on the bench, along the right sideline.
export const BENCH = { u: 1.13, v: 0.6 };

export const HORSE_CALLS: { id: HorseCall; name: string; mult: number; scene: 'in' | 'out' | 'both' }[] = [
  { id: 'floor', name: 'Off the floor', mult: 0.65, scene: 'in' },
  { id: 'board', name: 'Off the scoreboard', mult: 0.5, scene: 'in' },
  { id: 'glass', name: 'Off the glass', mult: 0.9, scene: 'in' },
  { id: 'billboard', name: 'Off the billboard', mult: 0.6, scene: 'out' },
  { id: 'back', name: 'Behind the back', mult: 0.8, scene: 'both' },
  { id: 'net', name: 'Nothing but net', mult: 1, scene: 'both' },
];
// The order the ball goes through them.
export const CHAIN: HorseCall[] = ['floor', 'board', 'glass', 'billboard'];

export const HORSE_FAR: { kind: HorseFarKind; name: string; need: number; feet: number; base: number; out: boolean }[] = [
  { kind: 'stands', name: 'From the stands', need: 4000, feet: 48, base: 0.1, out: false },
  { kind: 'rafters', name: 'From the rafters', need: 7000, feet: 55, base: 0.09, out: false },
  { kind: 'lot', name: 'Parking lot, through the gym window', need: 10000, feet: 120, base: 0.085, out: true },
  { kind: 'roof', name: 'Rooftop across the street', need: 15000, feet: 160, base: 0.085, out: true },
];

export function farOf(kind: string) {
  return HORSE_FAR.find((f) => f.kind === kind) ?? null;
}

export function isOutside(spot: HorseSpot): boolean {
  return spot.kind === 'lot' || spot.kind === 'roof';
}

export function callFits(call: HorseCall, spot: HorseSpot): boolean {
  const c = HORSE_CALLS.find((x) => x.id === call);
  if (!c) return false;
  return c.scene === 'both' || c.scene === (isOutside(spot) ? 'out' : 'in');
}

// A spot's place on the floor (the bench and the floor; far spots have none).
export function floorOf(spot: HorseSpot): { u: number; v: number } | null {
  if (spot.kind === 'floor') return { u: spot.u, v: spot.v };
  if (spot.kind === 'bench') return BENCH;
  return null;
}

export function feetOf(spot: HorseSpot): number {
  const f = floorOf(spot);
  if (!f) return farOf(spot.kind)?.feet ?? 50;
  return Math.sqrt(Math.pow(25 * f.u, 2) + Math.pow(47 * (f.v - BASKET_V), 2));
}

// Does the straight line from the spot to the rim pass within 2.5 ft of
// today's obstacle (a chair in the lane)?
export function overChair(spot: HorseSpot, obstacle: { u: number; v: number } | null): boolean {
  const f = floorOf(spot);
  if (!f || !obstacle) return false;
  if (f.v <= obstacle.v + 0.02) return false;
  const ax = 25 * f.u;
  const ay = 47 * f.v;
  const bx = 0;
  const by = 47 * BASKET_V;
  const px = 25 * obstacle.u;
  const py = 47 * obstacle.v;
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(ax + t * dx - px, ay + t * dy - py) < 2.5;
}

export function steadyOf(stepsToday: number): number {
  return 0.85 + 0.3 * Math.min(1, stepsToday / 12000);
}

// The green's width, as a share of the meter.
export function windowOf(spot: HorseSpot, calls: HorseCall[], obstacle: { u: number; v: number } | null, steady: number): number {
  const far = farOf(spot.kind);
  let w = far ? far.base : Math.max(0.06, Math.min(0.4, 0.42 - 0.0085 * feetOf(spot)));
  if (spot.kind === 'bench') w *= 0.85;
  for (const c of HORSE_CALLS) if (calls.includes(c.id)) w *= c.mult;
  if (overChair(spot, obstacle)) w *= 0.85;
  return Math.max(0.025, w * steady);
}

export function starsOf(w: number): number {
  return w >= 0.28 ? 1 : w >= 0.2 ? 2 : w >= 0.13 ? 3 : w >= 0.08 ? 4 : 5;
}

export function starText(n: number): string {
  const k = Math.max(0, Math.min(5, Math.round(n)));
  return '★★★★★'.slice(0, k) + '☆☆☆☆☆'.slice(0, 5 - k);
}

// A name for a spot on the floor, as people would call it.
export function spotName(spot: HorseSpot): string {
  if (spot.kind === 'bench') return 'Up on the bench';
  const far = farOf(spot.kind);
  if (far) return far.name;
  if (spot.kind !== 'floor') return 'From the floor';
  const { u, v } = spot;
  const side = u < 0 ? 'left' : 'right';
  const ft = feetOf(spot);
  if (v >= 0.88) return 'From half court';
  if (ft < 5) return 'From under the hoop';
  if (Math.abs(u) <= 0.24 && v <= 0.42) {
    if (v >= 0.34) return 'From the free-throw line';
    if (Math.abs(u) < 0.12) return 'From the paint';
    return `From the ${side} block`;
  }
  const three = ft >= 23.75 || (Math.abs(u) >= 0.88 && v < 0.3);
  if (three) {
    if (v < 0.3) return `From the ${side} corner`;
    if (Math.abs(u) < 0.25) return v > 0.75 ? 'From way downtown' : 'From the top of the key';
    return `From the ${side} wing`;
  }
  if (v < 0.25) return `From the ${side} baseline`;
  if (Math.abs(u) <= 0.4 && v <= 0.5) return `From the ${side} elbow`;
  if (Math.abs(u) < 0.2) return 'From the top of the key';
  return `From the ${side} wing`;
}

// The call, in words, as the prototype says it: "From the top of the key,
// over the chair, off the floor, off the scoreboard, off the glass.
// Nothing but net."
export function describeShot(spot: HorseSpot, calls: HorseCall[], obstacle: { u: number; v: number } | null): string {
  const parts: string[] = [];
  if (overChair(spot, obstacle)) parts.push('over the chair');
  if (calls.includes('back')) parts.push('behind the back');
  for (const k of CHAIN) {
    if (calls.includes(k)) parts.push(HORSE_CALLS.find((c) => c.id === k)!.name.toLowerCase());
  }
  if (isOutside(spot)) parts.push('through the gym window');
  const lead = spotName(spot).replace(', through the gym window', '');
  return `${lead}${parts.length ? ', ' + parts.join(', ') : ''}${calls.includes('net') ? '. Nothing but net.' : '.'}`;
}

export function parseSpot(d: any): HorseSpot {
  const k = d?.kind;
  if (k === 'floor') return { kind: 'floor', u: Number(d.u ?? 0), v: Number(d.v ?? 0.5) };
  if (k === 'bench' || k === 'stands' || k === 'rafters' || k === 'lot' || k === 'roof') return { kind: k };
  return { kind: 'floor', u: 0, v: 0.66 };
}

export function parseCalls(d: any): HorseCall[] {
  const ok = new Set(HORSE_CALLS.map((c) => c.id));
  return ((Array.isArray(d) ? d : []) as any[]).filter((c) => ok.has(c)) as HorseCall[];
}

// "21h 14m" until a time; "0m" once it's passed.
export function timeLeft(endsAt: string | null, now: Date = new Date()): string {
  if (!endsAt) return '';
  const ms = Math.max(0, new Date(endsAt).getTime() - now.getTime());
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
