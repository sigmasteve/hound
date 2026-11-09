// 2.5D for the sports fields (Soccer, Baseball, and any sport after):
// the ground seen from behind the near end, the far end narrower and a
// little squeezed, with room above it for a stand. Draw on the ground in
// shares of its width (x) and length (y, 0 at the far end), and put
// every point (lines, players, the ball) through project(), so the art,
// the players and any replay all line up.

export interface Perspective {
  w: number;
  h: number;
  // Above the ground: the stand.
  stand: number;
  // The ground's far and near edges on screen, and its width up close.
  y0: number;
  y1: number;
  botW: number;
  // The far end's size (a), and how much the far end is squeezed (b;
  // 1 is not at all, a is true perspective).
  a: number;
  b: number;
}

export function perspective(
  w: number,
  h: number,
  { stand, near = h * 0.035, gap = h * 0.025, botW = w * 0.94, a = 0.66, b = 0.8 }: { stand: number; near?: number; gap?: number; botW?: number; a?: number; b?: number },
): Perspective {
  return { w, h, stand, y0: stand + gap, y1: h - near, botW, a, b };
}

// Ground to screen, with s the size of things there (a at the far end, 1
// up close).
export function project(v: Perspective, x: number, y: number): { x: number; y: number; s: number } {
  const u = (v.b * y) / (1 - y * (1 - v.b));
  const s = v.a + (1 - v.a) * u;
  return { x: v.w / 2 + (x - 0.5) * v.botW * s, y: v.y0 + u * (v.y1 - v.y0), s };
}

// How big something drawn at s is, from its size up close: the far end
// at 72%, so faces stay readable.
export function sizeAt(v: Perspective, s: number, full: number): number {
  return Math.round(full * (0.72 + 0.28 * ((s - v.a) / (1 - v.a))));
}

// An SVG path through ground points ([x, y] shares), projected.
export function groundPath(v: Perspective, pts: [number, number][], close = false): string {
  return (
    pts
      .map(([x, y], i) => {
        const p = project(v, x, y);
        return `${i ? 'L' : 'M'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
      })
      .join(' ') + (close ? ' Z' : '')
  );
}
