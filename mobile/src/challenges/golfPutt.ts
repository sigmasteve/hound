import type { GolfHole, GolfSpot } from './golfApi';

// Putting (0214_golf_putting.sql): the pull sets the line, the pace meter
// sets the length, and a putt rolls exactly that far (it sends timing 0)
// while the green's break pulls it sideways. These mirror the server's
// golf_flight for a putter, so what the green shows is what happens.

// A putt drops when it stops within this many yards of the pin
// (golf_config.putt_cup, 0200).
export const PUTT_CUP_YD = 0.6;
// The shortest putt: a foot.
export const PUTT_MIN_YD = 1 / 3;
// The putter's longest (golf_club_max).
export const PUTT_MAX_YD = 30;

// How far the pace meter runs: twice the distance to the cup, so the cup
// sits halfway along it, but never less than 3 yards or more than the
// putter goes.
export function puttRange(toPinYd: number): number {
  return Math.min(PUTT_MAX_YD, Math.max(3, toPinYd * 2));
}

function heading(hole: GolfHole, ball: GolfSpot, aimDeg: number): number {
  return Math.atan2(hole.pin.lat - ball.lat, hole.pin.d - ball.d) + (aimDeg * Math.PI) / 180;
}

// Where a putt of `yards` along `aimDeg` (right is +) comes to rest.
export function puttRest(hole: GolfHole, ball: GolfSpot, aimDeg: number, yards: number): GolfSpot {
  const th = heading(hole, ball, aimDeg);
  return { d: ball.d + yards * Math.cos(th), lat: ball.lat + yards * Math.sin(th) + hole.green.break * yards };
}

// The roll, for drawing: along the line, the break taking hold as it slows.
export function puttPath(hole: GolfHole, ball: GolfSpot, aimDeg: number, yards: number, n = 20): GolfSpot[] {
  const th = heading(hole, ball, aimDeg);
  const brk = hole.green.break * yards;
  return Array.from({ length: n + 1 }, (_, i) => {
    const s = i / n;
    return { d: ball.d + yards * s * Math.cos(th), lat: ball.lat + yards * s * Math.sin(th) + brk * s * s };
  });
}

export function puttDrops(hole: GolfHole, ball: GolfSpot, aimDeg: number, yards: number): boolean {
  const r = puttRest(hole, ball, aimDeg, yards);
  return Math.hypot(r.d - hole.pin.d, r.lat - hole.pin.lat) <= PUTT_CUP_YD;
}

// The lengths on this line that drop, as shares of the meter (0 to 1), or
// null when this line can't drop at any pace (the aim's off).
export function dropBand(hole: GolfHole, ball: GolfSpot, aimDeg: number, range: number): { from: number; to: number } | null {
  let lo: number | null = null;
  let hi: number | null = null;
  const step = range / 400;
  for (let y = 0; y <= range; y += step) {
    if (puttDrops(hole, ball, aimDeg, y)) {
      if (lo === null) lo = y;
      hi = y;
    }
  }
  return lo === null || hi === null ? null : { from: lo / range, to: hi / range };
}

// Yards as feet, for the meter's labels.
export function feetText(yards: number): string {
  const ft = Math.round(yards * 3);
  return `${ft} ft`;
}

// Just off the green (0253, golf_fringe): fairway or rough within 3 yards
// of the green's edge, not in the trees. The putter plays from here as
// well as the green (and the other clubs still do).
export const FRINGE_YD = 3;
export function golfFringe(hole: GolfHole, ball: GolfSpot, lie: string): boolean {
  if (lie !== 'fairway' && lie !== 'rough') return false;
  const inTrees = hole.hazards.some(
    (z) => z.type === 'trees' && ((ball.d - z.d) / z.rd) ** 2 + ((ball.lat - z.lat) / z.rl) ** 2 <= 1,
  );
  return !inTrees && Math.hypot(ball.d - hole.green.d, ball.lat - hole.green.lat) <= hole.green.r + FRINGE_YD;
}
