import { botInitials, daysElapsedFraction, simulateBotDistance, simulateBotSteps } from './botSimulation';
import type { Challenge, ChallengeBot, HuntRole, LeaderboardEntry, Participant } from './types';

export interface BoardEntry {
  userId: string;
  name: string;
  initials: string;
  totalSteps: number;
  totalDistanceMi: number;
  isBot: boolean;
  role: HuntRole | null;
  // Only meaningful for the Hunter in a hunt with a head start — their
  // own total(s) at the exact moment the Hunted's head start ended, so
  // huntEffectiveMetric can measure how much the Hunter has closed
  // *since* the head start rather than from zero (see that function and
  // withHuntCatches). Always 0 when there's no head start to credit, not
  // just for a Hunted row — the Hunted's own total is never adjusted, so
  // these fields are simply unused for them.
  huntBaselineSteps: number;
  huntBaselineDistanceMi: number;
}

// Merges real participants (joined with whatever they've actually logged)
// and bots (whose steps are simulated, never logged) into one ranked list.
// Shared by ChallengeDetailScreen and HomeScreen so "how do we combine
// these two very different kinds of rows" only has one implementation.
// `sortBy` matters for a hunt scored on workout distance rather than
// steps (see ChallengeDetailScreen's syncFromDevice) — everyone's
// totalSteps is 0 in that case, so ranking by steps would leave the board
// in an arbitrary order instead of by who's covered the most ground.
// `daysElapsed` should be daysElapsedFraction(challenge)
// (src/challenges/botSimulation.ts) so bots accumulate through the
// current day instead of jumping to a full day's steps the instant it
// starts.
//
// `challenge` and `headStartLeaderboard` only matter for a hunt with a
// head start — omit them (or pass `[]`) for anything else and every
// `huntBaselineSteps`/`huntBaselineDistanceMi` below comes out 0, which
// is exactly correct: no head start means nothing to credit. When they
// do matter, `headStartLeaderboard` has to be a *separate* fetch —
// `ChallengesProvider.getLeaderboard(challengeId, headStartBaselineDayKey(challenge))`
// — not the regular one, since it needs each real participant's total as
// of one specific past day, not their current running total (see
// ChallengeDetailScreen/HomeScreen's data loading for where that extra
// fetch happens, and only when it's actually needed).
export function buildBoard(
  participants: Participant[],
  leaderboard: LeaderboardEntry[],
  bots: ChallengeBot[],
  daysElapsed: number,
  sortBy: 'steps' | 'distance' = 'steps',
  challenge?: Challenge,
  headStartLeaderboard: LeaderboardEntry[] = [],
): BoardEntry[] {
  const headStartDays = challenge?.headStartDays ?? 0;
  const rows: BoardEntry[] = [
    ...participants.map((p) => {
      const entry = leaderboard.find((l) => l.userId === p.userId);
      const baseline = headStartLeaderboard.find((l) => l.userId === p.userId);
      return {
        userId: p.userId,
        name: p.name,
        initials: p.initials,
        totalSteps: entry?.totalSteps ?? 0,
        totalDistanceMi: entry?.totalDistanceMi ?? 0,
        isBot: false,
        role: p.role,
        huntBaselineSteps: baseline?.totalSteps ?? 0,
        huntBaselineDistanceMi: baseline?.totalDistanceMi ?? 0,
      };
    }),
    ...bots.map((b) => ({
      userId: b.id,
      name: b.name,
      initials: botInitials(b.name),
      totalSteps: simulateBotSteps(b.id, b.fitnessLevel, daysElapsed),
      totalDistanceMi: simulateBotDistance(b.id, b.fitnessLevel, daysElapsed),
      isBot: true,
      role: b.role,
      // No fetch to make for a bot — its baseline is exactly the same
      // deterministic simulation as its running total, just evaluated at
      // headStartDays elapsed instead of "now."
      huntBaselineSteps: headStartDays > 0 ? simulateBotSteps(b.id, b.fitnessLevel, headStartDays) : 0,
      huntBaselineDistanceMi: headStartDays > 0 ? simulateBotDistance(b.id, b.fitnessLevel, headStartDays) : 0,
    })),
  ];
  // Ranked by huntEffectiveMetric, not the raw totals — for anyone but a
  // Hunter that's the same number either way (it only ever subtracts a
  // baseline for role === 'hunter'), but for the Hunter it's what
  // actually counts toward a catch. Sorting by raw totals instead would
  // let the Hunter's real, already-logged-during-the-head-start total
  // outrank a Hunted participant on this list despite withHuntCatches
  // correctly treating that same total as 0 progress — a leaderboard
  // that visually contradicts its own game's catch condition.
  //
  // A caught Zombie gets demoted below everyone still in it first,
  // regardless of that comparison — huntEffectiveMetric never adjusts a
  // non-Hunter row at all, so a Zombie's raw total (whatever real steps
  // they logged before being caught) would otherwise keep ranking them
  // by a number the game itself no longer counts for anything. Being
  // caught is a strictly worse state than still being chased, no matter
  // how many steps got them there — the exact same principle that
  // already demoted the Hunter's own pre-head-start steps.
  return rows.sort((a, b) => {
    const aCaught = a.role === 'zombie';
    const bCaught = b.role === 'zombie';
    if (aCaught !== bCaught) return aCaught ? 1 : -1;
    return huntEffectiveMetric(b, sortBy) - huntEffectiveMetric(a, sortBy);
  });
}

// True once the Hunted's head start (challenge.headStartDays, set at
// creation — see CreateScreen's "Head start for the hunted" slider) has
// run out and the Hunter's own total starts counting toward a catch. A
// hunt created before this existed, or a non-hunt challenge, has
// headStartDays === null, which is always "already elapsed" — there was
// never a head start to wait out.
export function hasHeadStartElapsed(challenge: Challenge): boolean {
  return daysElapsedFraction(challenge) >= (challenge.headStartDays ?? 0);
}

// Whole days left before a hunt's head start elapses, or 0 once it has
// (or if there was never one to begin with, or this isn't a hunt) — the
// one place this ceiling/clamp math lives, so ChallengeDetailScreen's
// leaderboard note and the Challenges list's own row badge (via
// toChallengeCard) can't drift out of sync the way the "board.length
// === 2" concluded-hunt check once did between two separate copies of
// similar logic.
export function headStartDaysLeft(challenge: Challenge): number {
  if (challenge.kind !== 'hunt' || hasHeadStartElapsed(challenge)) return 0;
  return Math.max(1, Math.ceil((challenge.headStartDays ?? 0) - daysElapsedFraction(challenge)));
}

// The calendar day a caller needs in order to fetch "everyone's total as
// of head start ending" via
// ChallengesProvider.getLeaderboard(challengeId, headStartBaselineDayKey(challenge))
// (see buildBoard's headStartLeaderboard param) — deliberately the day
// *before* the head start actually ends, not the day it ends on.
// progress_snapshots has one row per (challenge, user, day), continuously
// upserted as new steps sync in throughout that day — a head start
// almost never ends exactly at local midnight, so using that day's own
// key would make `day <= asOfDay` include that same still-being-updated
// row. A real Hunter's baseline would then track their current total
// for the entire day the head start ends on (never freezing), making
// huntEffectiveMetric read 0 no matter how many new steps they log that
// day — it would only start crediting them the day after. Using the day
// before instead gives a hard boundary nothing will ever upsert into
// again, at the cost of also crediting whatever the Hunter logged
// earlier on the head-start-end day itself, before the exact cutoff —
// an acceptable rounding error given progress_snapshots' day-level
// granularity (there's no per-sync timestamp to slice more precisely),
// and far better than the credit not applying until a full day late. A
// bot Hunter never had this problem — see buildBoard's own comment for
// why its baseline is a separate, deterministic simulation with no
// underlying row to upsert into in the first place.
// Local-calendar, matching progress_snapshots.day's own convention (see
// supabaseChallenges.ts's localDateKey).
export function headStartBaselineDayKey(challenge: Challenge): string {
  const headStartDays = challenge.headStartDays ?? 0;
  const end = new Date(new Date(challenge.startsAt).getTime() + headStartDays * 86_400_000);
  // Only shift back a day when there's an actual head start ending —
  // with none, this is never called in practice (see needsHeadStart's
  // own !!headStartDays guard on every caller), so there's no real end
  // day to step back from.
  const baseline = headStartDays > 0 ? new Date(end.getTime() - 86_400_000) : end;
  return `${baseline.getFullYear()}-${String(baseline.getMonth() + 1).padStart(2, '0')}-${String(baseline.getDate()).padStart(2, '0')}`;
}

// What actually counts toward a catch for this entry — for the Hunter,
// their total *since the head start ended* (their own total minus their
// huntBaselineSteps/huntBaselineDistanceMi snapshot from that moment),
// so a head start is a true, permanent advantage: whatever the Hunter
// racked up in real life while the Hunted was logging alone doesn't
// carry over the instant it ends, they start that count at zero right on
// schedule. Everyone else's raw total already *is* what counts — a
// Hunted participant's own total is never adjusted.
export function huntEffectiveMetric(entry: BoardEntry, sortBy: 'steps' | 'distance'): number {
  const total = sortBy === 'distance' ? entry.totalDistanceMi : entry.totalSteps;
  if (entry.role !== 'hunter') return total;
  const baseline = sortBy === 'distance' ? entry.huntBaselineDistanceMi : entry.huntBaselineSteps;
  // Clamped at 0, not left negative — a bot Hunter's baseline is
  // simulated against the *full* head start duration (buildBoard's own
  // simulateBotSteps(..., headStartDays) call) the instant the challenge
  // is created, while its actual running total only reflects real
  // elapsed time so far, which is still less than headStartDays for as
  // long as the head start hasn't ended yet. total - baseline is
  // genuinely negative during that whole window; there's no real sense
  // in which the Hunter has "negative progress," so this reads as 0
  // (exactly where they started) until real elapsed time catches up.
  return Math.max(0, total - baseline);
}

// Once the Hunter's own *effective* total (huntEffectiveMetric — their
// real total, minus whatever they'd already logged before the Hunted's
// head start ended) reaches a Hunted participant's, that Hunted row
// displays as 'zombie' — caught, no longer being chased. Nobody can be
// caught before the head start runs out (hasHeadStartElapsed) — the
// Hunter's real, already-logged total still displays normally everywhere
// else (this never fabricates or hides a real number), it just doesn't
// count toward a catch yet, matching CreateScreen's own description:
// "the hunted logs alone... then the hunter starts tallying."
//
// A real participant's 'zombie' role, once it appears here, gets
// persisted permanently by the caught person's own client (see
// ChallengeDetailScreen's catch-detection effect and
// ChallengesProvider.markCaught) — so for them this function is really
// "notice it," not "decide it fresh every time." A bot has no client of
// its own to persist anything through, so its 'zombie' status here is
// simply recomputed from scratch on every call instead, the same way
// every other bot number in this file already is.
export function withHuntCatches(board: BoardEntry[], sortBy: 'steps' | 'distance', challenge: Challenge): BoardEntry[] {
  if (!hasHeadStartElapsed(challenge)) return board;
  const hunter = board.find((r) => r.role === 'hunter');
  if (!hunter) return board;
  const hunterMetric = huntEffectiveMetric(hunter, sortBy);
  return board.map((r) => {
    if (r.role !== 'hunted') return r;
    const metric = sortBy === 'distance' ? r.totalDistanceMi : r.totalSteps;
    // `metric > 0` matters at the very start of a hunt, before anyone's
    // logged anything: both totals are 0 there, and 0 <= 0 would
    // otherwise catch every Hunted participant the instant the hunt is
    // created.
    return metric > 0 && metric <= hunterMetric ? { ...r, role: 'zombie' as const } : r;
  });
}

// A hunt with nobody left to chase — every Hunted participant (there has
// to be at least one) is already a Zombie. Requires `board` to already
// have gone through withHuntCatches; doesn't check challenge.kind itself
// since a non-hunt board never has any 'hunted'/'zombie' roles to find in
// the first place, so this is naturally false for one.
export function isHuntConcluded(board: BoardEntry[]): boolean {
  const hunted = board.filter((r) => r.role === 'hunted' || r.role === 'zombie');
  return hunted.length > 0 && hunted.every((r) => r.role === 'zombie');
}

// Which challenge Home actually shows as its hero/leaderboard card —
// shared so ChallengesScreen can mark that exact same one in its list
// (see "Add a visual indicator to highlight the challenge is displayed
// on the Today screen") instead of guessing at a parallel copy of this
// same fallback that could quietly drift out of sync with it. Whichever
// challenge the user explicitly highlighted (ChallengeDetailScreen's
// "Highlight on Home" toggle) wins, as long as it hasn't ended yet;
// otherwise the most recently created still-active one. `challenges`
// must already be in `listMyChallenges`' own
// `order('created_at', { ascending: false })` — this never re-sorts it,
// matching HomeScreen's own `.find(...)` doing the same.
export function pickPrimaryChallenge(challenges: Challenge[], highlighted: Challenge | null): Challenge | null {
  if (highlighted && new Date(highlighted.endsAt).getTime() > Date.now()) return highlighted;
  return challenges.find((c) => new Date(c.endsAt).getTime() > Date.now()) ?? null;
}

// The one "is this challenge over" check shared by toChallengeCard
// (src/challenges/present.ts, for the Challenges screen's Finished
// section) and HomeScreen's hero card (for switching from "your
// standing" to "who won") — a hunt ends the moment isHuntConcluded is
// true, however many scheduled days are left; anything else just runs
// out its clock.
export function isChallengeFinished(challenge: Challenge, board: BoardEntry[]): boolean {
  if (challenge.kind === 'hunt' && isHuntConcluded(board)) return true;
  return new Date(challenge.endsAt).getTime() <= Date.now();
}
