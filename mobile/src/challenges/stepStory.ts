// The story of a Most steps challenge (0233; mockup
// claude.ai/artifact/17YoJpFbHGVeWq335R1hj1), worked out from everyone's
// totals at the end of each day of it: who's your rival today and how
// you did against yesterday's, the day's bounty and its stars, the
// checkpoints and who got there first, and what happened yesterday.
// Pure: the screen hands it totalsAt (from progress_snapshots and the
// bots' simulated steps) and draws the answers.
//
// totalsAt[k] is everyone's total at the end of challenge day k (k = 0
// the first day); the last entry is today, so far.

export type Totals = Map<string, number>;

export interface StoryPerson {
  id: string;
  name: string;
}

export type BountyKind = 'ten_k' | 'biggest' | 'beat_yesterday' | 'over_average';

export const BOUNTY_TEXT: Record<BountyKind, { title: string; line: string }> = {
  ten_k: { title: '10,000 steps today', line: 'Everyone who walks 10,000 today gets a star.' },
  biggest: { title: 'The biggest day', line: 'Whoever walks the most today gets a star.' },
  beat_yesterday: { title: 'Beat your yesterday', line: 'Walk more than you did yesterday for a star.' },
  over_average: { title: 'A tenth over your average', line: 'Beat your own daily average so far by a tenth for a star.' },
};

const ORDER: BountyKind[] = ['ten_k', 'biggest', 'beat_yesterday', 'over_average'];

// The day's bounty, the same for everyone; the first day can't compare
// with a day before, so it's always 10,000.
export function bountyFor(day: number): BountyKind {
  const k = ORDER[day % ORDER.length];
  return day === 0 && (k === 'beat_yesterday' || k === 'over_average') ? 'ten_k' : k;
}

// The course a Most steps race runs on: 10,000 a day.
export function courseFor(days: number): number {
  return Math.max(1, days) * 10_000;
}

export function stepsOn(totalsAt: Totals[], day: number, id: string): number {
  if (day < 0 || day >= totalsAt.length) return 0;
  return Math.max(0, (totalsAt[day].get(id) ?? 0) - (day > 0 ? (totalsAt[day - 1].get(id) ?? 0) : 0));
}

// Ids best first (ties by id, so it's stable).
export function standing(t: Totals, ids: string[]): string[] {
  return [...ids].sort((a, b) => (t.get(b) ?? 0) - (t.get(a) ?? 0) || (a < b ? -1 : 1));
}

export interface Rival {
  id: string;
  // Catch the one ahead; or, leading, hold off the one behind.
  mode: 'catch' | 'hold';
  // The gap when the day began.
  gap: number;
}

// Your rival on day k: from the standings when it began. None on day 0
// (everyone at 0) or alone.
export function rivalOn(totalsAt: Totals[], ids: string[], day: number, me: string): Rival | null {
  if (day < 1 || ids.length < 2 || !ids.includes(me)) return null;
  const before = totalsAt[day - 1];
  const order = standing(before, ids);
  const r = order.indexOf(me);
  const id = r > 0 ? order[r - 1] : order[1];
  return { id, mode: r > 0 ? 'catch' : 'hold', gap: Math.abs((before.get(id) ?? 0) - (before.get(me) ?? 0)) };
}

// Did you out-walk your rival on (completed) day k?
export function beatRival(totalsAt: Totals[], ids: string[], day: number, me: string): { rival: Rival; won: boolean } | null {
  const rival = rivalOn(totalsAt, ids, day, me);
  if (!rival) return null;
  return { rival, won: stepsOn(totalsAt, day, me) > stepsOn(totalsAt, day, rival.id) };
}

// Who won day k's bounty (k complete), or who's on for it so far today.
export function bountyWinners(totalsAt: Totals[], ids: string[], day: number): string[] {
  const kind = bountyFor(day);
  const s = (id: string, d: number) => stepsOn(totalsAt, d, id);
  if (kind === 'biggest') {
    const top = Math.max(0, ...ids.map((id) => s(id, day)));
    return top > 0 ? ids.filter((id) => s(id, day) === top) : [];
  }
  return ids.filter((id) => {
    const today = s(id, day);
    if (kind === 'ten_k') return today >= 10_000;
    if (kind === 'beat_yesterday') return today > s(id, day - 1);
    let sum = 0;
    for (let d = 0; d < day; d++) sum += s(id, d);
    const avg = day > 0 ? sum / day : 0;
    return avg > 0 && today >= avg * 1.1;
  });
}

// What you need today for the bounty, for its card: a target, or
// (biggest day) the one to beat.
export function bountyTarget(totalsAt: Totals[], ids: string[], day: number, me: string): { target: number | null; leaderId: string | null } {
  const kind = bountyFor(day);
  if (kind === 'ten_k') return { target: 10_000, leaderId: null };
  if (kind === 'beat_yesterday') return { target: stepsOn(totalsAt, day - 1, me) + 1, leaderId: null };
  if (kind === 'over_average') {
    let sum = 0;
    for (let d = 0; d < day; d++) sum += stepsOn(totalsAt, d, me);
    return { target: day > 0 ? Math.ceil((sum / day) * 1.1) : 10_000, leaderId: null };
  }
  const others = ids.filter((id) => id !== me);
  const lead = others.sort((a, b) => stepsOn(totalsAt, day, b) - stepsOn(totalsAt, day, a))[0] ?? null;
  return { target: lead ? stepsOn(totalsAt, day, lead) + 1 : null, leaderId: lead };
}

export interface Checkpoint {
  frac: number;
  label: string;
  at: number;
  // First there, and the day, once someone has.
  firstId: string | null;
  day: number | null;
}

// The checkpoints at a quarter, half and three quarters of the course:
// the first day anyone's total passed it, and of those, the furthest.
export function checkpoints(totalsAt: Totals[], ids: string[], course: number): Checkpoint[] {
  return [
    [0.25, '¼'],
    [0.5, '½'],
    [0.75, '¾'],
  ].map(([frac, label]) => {
    const at = course * (frac as number);
    for (let d = 0; d < totalsAt.length; d++) {
      const past = ids.filter((id) => (totalsAt[d].get(id) ?? 0) >= at);
      if (past.length) {
        const firstId = past.sort((a, b) => (totalsAt[d].get(b) ?? 0) - (totalsAt[d].get(a) ?? 0))[0];
        return { frac: frac as number, label: label as string, at, firstId, day: d };
      }
    }
    return { frac: frac as number, label: label as string, at, firstId: null, day: null };
  });
}

export interface PersonTally {
  stars: number;
  rivalWins: number;
  ribbons: number;
}

// Each person's stars (bounties won on completed days), rival wins and
// ribbons (checkpoints reached first). today = the index of today.
export function tallies(totalsAt: Totals[], ids: string[], today: number, opts: { rivals: boolean; bounties: boolean }, cps: Checkpoint[]): Map<string, PersonTally> {
  const out = new Map<string, PersonTally>(ids.map((id) => [id, { stars: 0, rivalWins: 0, ribbons: 0 }]));
  for (let d = 0; d < today; d++) {
    if (opts.bounties) for (const id of bountyWinners(totalsAt, ids, d)) out.get(id)!.stars += 1;
    if (opts.rivals)
      for (const id of ids) {
        const r = beatRival(totalsAt, ids, d, id);
        if (r?.won) out.get(id)!.rivalWins += 1;
      }
  }
  for (const c of cps) if (c.firstId && out.has(c.firstId)) out.get(c.firstId)!.ribbons += 1;
  return out;
}

export interface Yesterday {
  day: number;
  // "Maya passed Raj", in the order it happened (by who gained most).
  passes: { by: string; past: string }[];
  big: { id: string; steps: number } | null;
  rival: { rival: Rival; won: boolean } | null;
  bounty: { kind: BountyKind; winners: string[] } | null;
  checkpoints: Checkpoint[];
}

// What happened yesterday (the day before today), from where everyone
// stood when it began to where they stood when it ended.
export function yesterdayStory(totalsAt: Totals[], ids: string[], today: number, me: string, opts: { rivals: boolean; bounties: boolean }, cps: Checkpoint[]): Yesterday | null {
  const d = today - 1;
  if (d < 1) return null;
  const a = totalsAt[d - 1];
  const b = totalsAt[d];
  const passes: { by: string; past: string; gain: number }[] = [];
  for (const x of ids)
    for (const y of ids) {
      if (x === y) continue;
      if ((a.get(x) ?? 0) < (a.get(y) ?? 0) && (b.get(x) ?? 0) > (b.get(y) ?? 0)) passes.push({ by: x, past: y, gain: stepsOn(totalsAt, d, x) });
    }
  passes.sort((p, q) => q.gain - p.gain);
  const bigId = [...ids].sort((p, q) => stepsOn(totalsAt, d, q) - stepsOn(totalsAt, d, p))[0];
  return {
    day: d,
    passes: passes.map(({ by, past }) => ({ by, past })),
    big: bigId && stepsOn(totalsAt, d, bigId) > 0 ? { id: bigId, steps: stepsOn(totalsAt, d, bigId) } : null,
    rival: opts.rivals ? beatRival(totalsAt, ids, d, me) : null,
    bounty: opts.bounties ? { kind: bountyFor(d), winners: bountyWinners(totalsAt, ids, d) } : null,
    checkpoints: cps.filter((c) => c.day === d),
  };
}
