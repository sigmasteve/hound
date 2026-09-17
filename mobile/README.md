# Hound (mobile)

Cross-platform iOS/Android rebuild of Hound — a friend-challenge fitness app
(step races, streaks, and a GPS-distance "Hunter & Hunted" chase) that reads
real step/distance/heart-rate/weight data from **Apple HealthKit** on iOS and
**Health Connect** on Android.

Built with Expo (React Native + TypeScript). The visual design (colors,
type, spacing, card/button language) is ported from the original static-web
prototype at the repo root — see `../styles.css` for the source tokens,
mirrored in `src/theme/tokens.ts`.

## Why a rewrite, not a wrapper

The original prototype was plain HTML/CSS/JS. HealthKit and Health Connect
have no web API at all — they're native-only (Swift/Kotlin), so a browser
build fundamentally cannot read them. This app is a from-scratch React
Native rebuild for that reason, following the same look and information
architecture as the original.

## Project layout

```
src/
  theme/        design tokens ported from the web app's CSS variables
  components/   shared UI primitives (Button, Card, Tag, Avatar, TextField, …)
  navigation/   React Navigation stack — gates on auth status (see below),
                then Main (tab-style content switcher, matching the web's
                persistent top nav) + Hunt/Create as pushed detail screens
  screens/      one file per screen (Home, Hunt, Challenges, Create wizard,
                Metrics, Friends, Settings, Connect)
  screens/auth/ Welcome, Login, SignUp screens (see "The auth layer")
  auth/         the sign-in abstraction (see below)
  health/       the HealthKit/Health Connect abstraction (see below)
  challenges/   the challenge/competition data-access layer (see "The
                backend (Supabase)")
  lib/          third-party client setup — currently just supabase.ts
  data/         sample data for the social layer (challenges, friends) —
                still what most screens render; see "What's not implemented"
supabase/
  migrations/   SQL to run against your own Supabase project — nothing in
                this repo runs it for you, see "The backend (Supabase)"
```

## The backend (Supabase)

Challenge/competition data (challenges, who's in them, daily progress) and
real sign-in both live in a [Supabase](https://supabase.com) project —
Postgres, auth, and realtime behind one client library, chosen so the app
doesn't need a server of its own. **No project is included** — you point
the app at your own:

1. Create a free project at [supabase.com](https://supabase.com).
2. Project Settings → API Keys: copy the **Project URL** and
   **Publishable key** (Supabase's current name for the client-safe key;
   a project created before ~November 2025 may instead label it "anon" /
   "anon public" — same purpose, older key format, and Supabase is
   retiring that name during 2026).
3. `cp .env.example .env` in `mobile/` and paste them in as
   `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
   Expo inlines `EXPO_PUBLIC_*` vars into the JS bundle at build/start
   time — restart `expo start` after editing `.env`, since it's only read
   once at startup.
4. SQL Editor → New query → paste in
   `supabase/migrations/0001_challenges_schema.sql` → Run. This creates
   `profiles`, `challenges`, `challenge_participants`, and
   `progress_snapshots`, all with Row Level Security policies scoping each
   table to "am I a participant of this challenge" — see the comments in
   that file for the exact policies.
5. Same thing again with `0002_fix_challenge_participants_recursion.sql`
   — a follow-up fix for a real bug in 0001's policies (see that file's
   comment for the postmortem). Run both, in order, on every project,
   including one where 0001 already ran.
6. Same thing again with `0003_challenge_bots.sql` — adds `challenge_bots`
   (see "Bot opponents" below).
7. Same thing again with `0004_hunt_scoring_and_roles.sql` — adds
   `challenges.scoring_method` and `challenge_bots.role` (see "Hunter &
   Hunted: real scoring and roles" below).
8. Same thing again with `0005_challenges_delete_policy.sql` — lets a
   challenge's creator delete it from `ChallengeDetailScreen`.
9. Same thing again with `0006_challenge_highlight.sql` — adds
   `challenge_participants.highlighted`, so Home can headline a specific
   challenge instead of always defaulting to the most recently created
   one (see "Home" below).

### Bot opponents

Creating a challenge (`CreateScreen`'s "Bring friends" step) offers 4
preset bots — Casey (Casual), Micah (Active), Reese (Athletic), Blaze
(Elite) — for when there aren't enough real friends around to make a
challenge interesting. A bot never signs in and is never a real
`profiles`/`auth.users` row; it's just a name + fitness level saved to
`challenge_bots`. Its steps are never written anywhere — there's no job
simulating a bot one day at a time — instead `src/challenges/botSimulation.ts`
deterministically recomputes its whole trajectory on every read, seeded
from the bot's own row id and the day number. Every *complete* day counts
in full; the current, still-in-progress day is scaled by
`daysElapsedFraction()`'s fraction of a day elapsed, so a bot's steps
climb through the day the way a real synced count would, rather than
jumping to a full day's total the instant the day starts — and it still
shows the same numbers on every screen and every reload (down to the
minute) without a backend to keep in sync.

### Hunter & Hunted: real scoring and roles

CreateScreen's "Set the rules" step for a hunt has a real, functional
"What counts" picker now (it used to be two `RadioPill`s that never did
anything): **GPS distance from runs & walks**, **any logged workout**, or
**device step count** — the last one defaults selected now, since it's
the only option that needs nothing from the creator beyond having
HealthKit/Health Connect connected (the other two need workouts actually
logged that day) — saved as `challenges.scoring_method`. A hunt also
always has exactly one Hunter and one or more Hunted — "Bring friends"
step 3 has a "Who's the Hunter?" picker (you, or any bot you've added;
real friend invites aren't wired to a role, same limitation as
elsewhere) that sets `challenge_participants.role` /
`challenge_bots.role` accordingly.

`ChallengeDetailScreen.tsx` reads both back: a hunt scored on
`device_steps` auto-syncs the same way a `'steps'`-kind challenge does
(see below). `gps_distance` and `any_workout` instead sum today's
logged workouts' distance via `useHealthProvider().getRecentWorkouts()`
— the health abstraction has no true GPS-verified flag, so
`gps_distance` is approximated as any workout whose name matches
`/run|walk|jog|hike/i`; a treadmill session or a mislabeled walk can
still slip through or be excluded incorrectly, a real limitation, not a
hidden bug. Either way `recordProgress()` is called with `steps: 0` and
the summed distance, so the leaderboard (`src/challenges/board.ts`'s
`buildBoard`) sorts by distance instead of steps for these — everyone's
step count would otherwise read 0 and rank arbitrarily.

The head-start slider in "Set the rules" is real now too, saved as
`challenges.head_start_days` (`0011_hunt_head_start.sql`). Two things
have to both be true for it to be a *real* advantage, not just a
countdown: nobody can be caught while it's running
(`hasHeadStartElapsed`, `src/challenges/board.ts`, gated on the same
fractional-day clock bots use, `daysElapsedFraction`), **and**, once it
ends, whatever the Hunter racked up in real life during those days stops
counting toward closing the gap. That second part is the whole point —
a Hunter doesn't stop moving just because the game hasn't started
tallying them yet, so a plain on/off gate alone would let their
real-world total silently carry over the instant it lifts, quietly
erasing the head start's benefit. Instead, each Hunter gets a
`huntBaselineSteps`/`huntBaselineDistanceMi` snapshot — their own total
at the *exact* moment the head start ended — and `huntEffectiveMetric`
(`src/challenges/board.ts`) is their current total minus that snapshot,
not their raw total. `withHuntCatches` and every place that shows the
Hunter's progress (`HomeScreen`'s hero card, `ChallengeDetailScreen`'s
leaderboard note) reads through this function, so the Hunter's own
displayed row still shows their honest full total — nothing about it is
hidden — but the number that decides a catch, and the number this
screen's "lead" copy is built from, both start counting from zero the
moment the gate opens, not from wherever the Hunter's real life happened
to leave them.

A real Hunter's baseline can't come from anything already in memory — it
needs their total as of one specific past day, which the regular
leaderboard fetch (a running total, no day breakdown) can't answer. So
`ChallengesProvider.getLeaderboard` grew an optional `asOfDay` parameter
that filters `progress_snapshots` to `day <= asOfDay` before summing, and
`ChallengesScreen`/`ChallengeDetailScreen`/`HomeScreen` each make one
extra `getLeaderboard(challengeId, headStartEndDayKey(challenge))` fetch
— only for a hunt that actually has a head start, everything else skips
it — and hand the result into `buildBoard`'s new `headStartLeaderboard`
param, which is where a real participant's baseline actually gets read
from. Recomputed fresh on every load rather than written anywhere, so it
comes out correct however late someone opens the app relative to when
the head start actually ended — there's no "the app happened to be
closed at the exact moment, so the recorded value is stale" failure mode
to worry about. A bot Hunter needs no such fetch: its baseline is just
`simulateBotSteps` evaluated at `head_start_days` elapsed instead of
"now," deterministic like every other bot number in this file. A hunt
with no head start at all (`head_start_days: null`, including every hunt
created before this migration) gets a baseline of 0 for everyone,
which — since `huntEffectiveMetric` only ever subtracts it from the
Hunter — is exactly the original, pre-head-start behavior.

### Distance Pool: a real group target, in miles or steps

`CHALLENGE_TYPES` describes "Distance Pool" as "Add every mile the group
covers toward one shared target" — but CreateScreen's "Set the rules"
step had no field to actually set that target, the same "decorative
slider" gap the head-start one had before `0011_hunt_head_start.sql`.
Same fix, same pattern: a "Group target" block that only shows for
`draftType === 'distance'`, saved as `challenges.distance_goal_mi`
(`0012_distance_pool_goal.sql`, nullable — a distance pool created
before that migration just has none).

The target can be set in **miles** (10–1000, step 10) or **steps**
(50,000–2,000,000, step 50,000) — most people know their daily step
count better than their mileage — via a `SegmentedControl` and
`challenges.distance_goal_unit`/`distance_goal_steps`
(`0013_distance_pool_unit.sql`, both nullable and purely additive; a
pool with `distance_goal_unit` unset, from before this second
migration, is read as `'miles'` in `rowToChallenge` — exactly what a
lone `distance_goal_mi` already meant on its own).

Unlike every other kind, a distance pool with a goal set isn't ranked at
all — `toChallengeCard` (`src/challenges/present.ts`) sums every
participant's and bot's total (steps or miles, whichever the goal is
in) into one group total and shows that against the goal (`"142.3" / "of
500 mi goal"` or `"320,000" / "of 500,000 steps goal"`) instead of this
user's own rank, on both the Challenges list card and a dedicated "Group
progress" card (with a real `<ProgressBar>`) on
`ChallengeDetailScreen.tsx`. A distance pool with no goal set at all
falls back to the exact same per-person rank framing every other kind
already had.

The unit picker also closed a loose end the first pass of this feature
left open and flagged rather than quietly worked around: a miles-goal
pool's own leaderboard used to rank by steps regardless
(`boardSortFor`/`usesWorkoutDistance` only special-cased `kind ===
'hunt'`), a real inconsistency for a kind that's supposed to be
entirely about distance. New `usesDistanceRanking`
(`src/challenges/scoring.ts`) folds a miles-goal distance pool into the
same "rank by distance" bucket a workout-distance hunt already used —
requiring an actual goal value, not just the unit flag, so a pool with
no goal at all still correctly ranks by steps like before. A steps-goal
pool was always correct here (steps *is* its ranking metric) and needed
no change. `ChallengeDetailScreen.tsx`'s own `scoredByDistance` (which
decides whether leaderboard rows show "X mi" or "X steps") now reads
through the same function, so the per-row units always match what the
group-progress card above them is measuring. Still unchanged, and still
a real, separate gap: a distance pool of either unit still uses the
manual "Log your progress" form rather than auto-syncing from device
data — that one's untouched by either pass of this feature.

Verified locally: a `toChallengeCard` unit check (a miles goal sums
every participant's miles into the group total and labels it with the
real goal; a steps goal does the same with steps; no goal set falls
back to the old per-person rank framing exactly as before; a
non-distance kind with `distanceGoalMi` somehow set is never misread as
a group-goal card) plus a `boardSortFor`/`usesDistanceRanking` check (a
miles-goal pool ranks by distance; a steps-goal pool, and a pool with no
goal at all, still rank by steps) — and, against a local throwaway
Postgres, that `distance_goal_mi`/`distance_goal_steps`/`distance_goal_unit`
insert and read back correctly under the existing insert/select
policies with no new RLS needed, and that the check constraint on
`distance_goal_unit` rejects anything other than `'miles'`/`'steps'`.

### Getting caught turns a Hunted participant into a Zombie

`HuntRole` gained a third value: `'zombie'` (`src/challenges/types.ts`).
It's a one-way transition, never assigned at creation — a Hunted
participant becomes a Zombie once the Hunter's own *effective* total
(see above — their real total minus their head-start baseline) reaches
theirs, and stays one for the rest of the challenge. The condition
itself (`withHuntCatches`, `src/challenges/board.ts`) runs against
whichever number the hunt is actually scored on (steps or distance, same
as everywhere else in this file) and respects the Hunted's head start
both ways — nobody can be caught while it's running, and once it ends
the Hunter starts from zero, not from their real total.

The trickier part was RLS, not the math: only a participant's *own* row
is theirs to update (`0006_challenge_highlight.sql`'s policy), so the
Hunter's client can never flip the Hunted's role directly — no new
migration adds that, on purpose, since a "the Hunter can edit anyone
else's row" policy is real attack surface for one line of gameplay logic.
Instead, `ChallengeDetailScreen.tsx` has each Hunted participant's own
client notice they've been caught (their computed board entry now reads
`'zombie'`, but their stored `role` still says `'hunted'`) and persist it
themselves via the new `ChallengesProvider.markCaught()` — the same
"you write your own row" shape `recordProgress`/`setHighlighted` already
use, just automatic instead of a button press. A bot has no client to do
this from, so a caught bot's `'zombie'` status is never written anywhere
— it's simply recomputed fresh every time `withHuntCatches` runs, the
same way every other bot number in this app already is.

`ChallengeDetailScreen`'s leaderboard shows a "Zombie" tag once caught
(`HUNT_ROLE_LABEL`/`HUNT_ROLE_TAG_VARIANT`, `src/challenges/present.ts`).
For a two-person hunt specifically, `HomeScreen.tsx`'s hero headline and
`LiveHuntCard` both treat a catch as the hunt ending — "X caught you" or
"You caught X," instead of an ongoing lead/behind readout — since with
exactly one Hunter and one Hunted, being caught is the whole game. A hunt
with more than one Hunted keeps going for whoever's left; only the
caught person's own row changes, so the Hunter (and the leaderboard) can
tell a Zombie apart from someone still being chased. There's no
"Zombies join the Hunter's side" escalation — being caught here just
means the chase for that person is over, not a new deliverable.

A hunt with nobody left to chase also now moves to ChallengesScreen's
"Finished" section instead of lingering in the active list —
`toChallengeCard` (`src/challenges/present.ts`) computes a `finished`
flag per card: `huntConcluded` (every Hunted participant is now a Zombie
— not "the board has exactly two people," which only covers a one-on-one
hunt and was this feature's own first-pass bug: a 5-person hunt where
the Hunter had caught all four Hunted still showed as active) or the
challenge's `endsAt` has simply passed, whichever comes first. This
is the first time any *real* challenge here has a "finished" state at
all — before this, the Finished section was 100% the hardcoded "February
Step Race" placeholder regardless of what any real challenge had
actually done, and a past-end-date challenge just stayed in the active
list forever. `ChallengesScreen.tsx` now splits `liveCards` into
`liveActive`/`liveFinished` by that flag; the placeholder row only shows
while `liveCards` itself is still `null` (Supabase not configured, or the
fetch hasn't resolved) — once real data loads, real finished challenges
(tappable, same as an active row) replace it, or "Nothing finished yet."
if there aren't any.

Each finished row's medal icon is colored by placement now —
`medalColorFor` (`ChallengesScreen.tsx`) maps the card's own `stat`
(`toChallengeCard`'s exact `'1st'`/`'2nd'`/`'3rd'`/… ordinal string) to
`color.gold`/`silver`/`bronze` for the top three, falling back to the
plain `neutral500` every medal used before this for 4th place and
worse, or for the no-data `'—'` case. The three new tokens live in
`src/theme/tokens.ts` alongside every other color in the app, not
hardcoded in the screen, matching that file's own "never hardcode a hex
value" rule.

A hunt still serving its head start also gets its own badge in the
active list — a filled amber "Head start · Nd left" tag next to the
existing Hunter & Hunted one, using a new `amber` `<Tag>` variant
(`src/components/Tag.tsx`) chosen specifically so it doesn't just blend
into the accent-purple kind tag already on the same row. The day count
is `headStartDaysLeft` (`src/challenges/board.ts`) — the same ceiling
math `ChallengeDetailScreen`'s leaderboard note already used, pulled out
into one shared function instead of `toChallengeCard` growing a second
copy of it (`ChallengeDetailScreen.tsx` now calls the shared version
too). The badge disappears the moment the head start elapses; nothing
shows for a hunt with no head start at all, or for any non-hunt kind.

The Challenges screen itself used to flash its sample content (the
"Priya invited you" card, the sample active list, the sample "February
Step Race" finished row) for a beat on every visit, even against a
configured Supabase backend, simply because the real fetch hadn't
resolved yet. `challengesLoading`/`invitesLoading` are derived from the
existing `liveCards`/`liveInvites` state instead of adding new
`useState` — `null && isSupabaseConfigured` — so a spinner shows only
while `isSupabaseConfigured` is true and that first fetch is still in
flight; once it resolves, `liveCards`/`liveInvites` are never reset back
to `null`, so a later `useFocusEffect` refetch on returning to the tab
never re-shows the spinner.

That sample content itself is gone now, though — it made an
unconfigured backend look like a real account with a real invite and a
real history, which is worse than no data at all. With no backend
configured, `liveCards`/`liveInvites` stay `null` forever, and the
screen now treats that exactly like a configured backend that resolved
to nothing: `challenges`/`finishedChallenges` default to `[]`, invites
default to `[]`, and the same "No challenges yet — start one above." /
"Nothing finished yet." empty-state text a real, freshly signed-up user
would see is what renders — no fabricated Priya invite, no fabricated
February Step Race. `src/data/sampleData.ts`'s `CHALLENGES` export is no
longer imported here at all (the Hunt screen is still the exception —
see "What's not implemented").

### Home's getting-started cards

Home had the exact same problem, one level worse: whenever there was no
real challenge to headline — a brand-new user with nothing yet, or
Supabase unconfigured — it fell back to a fully hardcoded "Marcus is 7.4
mi behind you" hero line, a fake "Theo's Pixel hasn't reported" staleness
alert, a static "Jordan vs Marcus" hunt card, and a static "March Step
Race" leaderboard — a complete, specific chase that read exactly like
this user's own real progress, with nothing marking it as sample. A
brand-new Facebook sign-up landing on this screen had no way to tell it
apart from a real account's real history.

That fallback is gone. `heroCopy`'s null case is now an honest "Start a
challenge to see your progress here." with a "New challenge" button that
opens the Challenges tab (`onGoTab('challenges')`) instead of the old
"Open the chase" button, which used to open the hardcoded Hunt demo
screen as if it were this user's own. The stale-Pixel alert is gone
outright — it never had anything real behind it. In their place,
`GettingStartedCards` renders three real, non-fake cards: **Ways to
compete** (the actual `CHALLENGE_TYPES` list — Hunter & Hunted, Step
Race, Daily Streak, Distance Pool — each with its real one-line
description and icon, plus a "New challenge" button), **Your data syncs
automatically** (what connecting Apple Health/Health Connect actually
does — backfills and keeps updating step-based challenges with no manual
logging), and **Bring your friends in** (a pointer to the real
email-lookup invite flow — see "Inviting a friend to a specific
challenge"). All three buttons land on an existing tab
(`onGoTab('challenges' | 'metrics' | 'friends')`); nothing new was wired
up to build this, since every capability it describes already exists
elsewhere in the app.

Home's own metric tiles were also trimmed from four down to Steps and
Distance — Resting HR and Weight are gone from Today entirely, not just
moved. `MetricsScreen.tsx` (the Data tab) already has its own dedicated
"Heart rate" and "Weight" segmented-control views with real 7-day
charts (`getHeartRateSeries`/`getWeightSeries`), so Today's two extra
tiles were a second, flatter rendering of exactly the same numbers,
each with its own hardcoded caption ("Down 3 bpm over 30 days," "Last
entry Sunday · Withings") that never actually reflected the underlying
data. Both tiles already linked to `onGoTab('metrics')` before removal,
so nothing that pointed at them loses its destination.

Verified locally: a `withHuntCatches` unit check (day-0 zero/zero
doesn't instantly catch anyone, a real gap does, ties count, an
already-zombie row stays zombie even if its total climbs back past the
Hunter's, multi-Hunted only catches whoever's actually been passed,
distance-scored hunts ignore steps entirely, nobody is caught while the
head start is still running even with a real gap already open, catches
resume the moment it elapses, and `head_start_days: null` behaves
exactly like before head start existed) and, against a local throwaway
Postgres, that the new `head_start_days` column inserts/reads back
under the existing insert/select policies with no new RLS needed, and
that the Hunter's own client cannot update the
Hunted's `challenge_participants` row (0 rows affected) while the
Hunted's own client, running the exact statement `markCaught()` sends,
succeeds. A `toChallengeCard` unit check separately covers `finished`
itself: an ongoing hunt with the Hunted still ahead stays active, a
caught two-person hunt finishes despite a future end date, a plain
challenge finishes purely on a past end date (and not before), a
multi-Hunted hunt finishes once every one of them has been caught, and a
multi-Hunted hunt with at least one still uncaught does *not* finish
just because some of the others got caught. The catch mechanic itself
(not this finished-list follow-up specifically) has been confirmed
working against real device data and a real Supabase project.

The accumulating-credit redesign above has its own unit coverage:
`huntEffectiveMetric` subtracts a Hunter's baseline from their total and
leaves everyone else's alone even if a baseline happens to be present;
`headStartEndDayKey` computes the right calendar day from `startsAt` +
`head_start_days`; `buildBoard` sources a real Hunter's baseline from a
`headStartLeaderboard` argument (not their current running total),
defaults a Hunter missing from it to 0 rather than `NaN`, resimulates a
bot Hunter's baseline deterministically at exactly `head_start_days`
elapsed, and gives everyone a 0 baseline when there's no head start at
all. One check reproduces the exact scenario this redesign was written
for: a Hunter with a real life who logs 15,000 steps over 3 days while
serving a 2-day head start, 10,000 of which happened before the head
start ended — their effective count for catching up is only the 5,000
logged since, not their full 15,000, correctly leaving them nowhere near
a Hunted total of 20,300; a second check confirms the catch *does* fire
once the Hunter has genuinely earned that much since the head start
ended. Against a local throwaway Postgres: a day-filtered
`progress_snapshots` sum (the same query `getLeaderboard`'s new
`asOfDay` runs) correctly returns only the partial total for rows on or
before that day, under a fellow participant's existing read access, with
no new RLS policy. A separate `headStartDaysLeft` unit check covers the
active-list badge's own math: the full count on day one, a rounded-up
partial count partway through, 0 once elapsed, 0 with no head start
configured, and 0 for a non-hunt kind regardless of what `head_start_days`
happens to hold.

`isHuntConcluded`/`isChallengeFinished` (`src/challenges/board.ts`) are
that same "is this hunt over" check pulled out into one shared place,
rather than `toChallengeCard` and `HomeScreen.tsx`'s hero card each
recomputing their own copy of it — the kind of duplication that let the
board.length === 2 bug above happen in the first place. `HomeScreen.tsx`
uses it too: once a highlighted challenge is finished, the hero headline
switches from "your standing" ("You're 2nd of 5 in Me and IAM.") to
"who won" ("Blaze won Me and IAM." / "You won Me and IAM!") — before
this it kept reporting your live rank forever, even after there was
nothing left to rank. A two-person hunt that ends by an actual catch
keeps its own more personal wording ("Blaze caught you. The hunt's
over.") instead of the generic announcement; a two-person hunt that
somehow reaches its scheduled end without either side ever being caught
falls through to the generic one, same as any other finished challenge
kind. `board[0]` (already sorted by whichever metric the challenge is
scored on) is "the winner" — no separate Hunter lookup needed, since a
concluded hunt's Hunter is, by definition, tied with or ahead of every
Hunted they've caught.

### Device sync backfills the whole challenge, not just today

`ChallengeDetailScreen.tsx`'s `syncFromDevice` (triggered on load and via
its "Sync now" button, for any challenge that auto-syncs — a `'steps'`-kind
challenge, or a hunt scored on `device_steps`, `gps_distance`, or
`any_workout`) writes one `progress_snapshots` row per calendar day from
`challenge.startsAt` through today, not only today's. That covers two
gaps a "just write today" sync would leave open: joining a challenge that
already started (every earlier day would otherwise permanently read 0 —
`getLeaderboard()` has no per-day backfill of its own, it just sums
whatever rows exist), and picking the app back up after missing a few
days of opening it.

The two scoring paths pull history differently because their underlying
device APIs shape it differently. Step-scored challenges call the new
`HealthProvider.getDailyStepsSince(since)` (real HealthKit
`queryStatisticsCollectionForQuantity` day buckets on iOS, a sequential
per-day `readRecords` loop on Android — both generalize the existing
`getWeeklySteps()` from a fixed trailing week to an arbitrary start date),
which returns one `{date, steps, distanceMi}` entry per day already. The
two workout-scored paths instead call `getRecentWorkouts()` (it takes a
count, not a date range, so this over-fetches up to 200 and filters
client-side to `when >= challenge.startsAt`), bucket the matching workouts
by day, and sum each day's distance — today always gets an explicit
(possibly zero) row even with no matching workout yet, so a quiet day
doesn't look unsynced. Every day — from either path — is clamped to
`[startDayKey, endCap]` (the challenge's own start and end day, both as
local-calendar keys, same as `getDailyStepsSince`'s own dates) rather than
trusting whatever range a provider hands back, so a device quirk can't
backfill a day before the challenge existed or after it ended. A step-scored
day outside today with no real device data (0 steps and 0 distance) is
dropped instead of written as an explicit zero — "nothing recorded" isn't
the same as "recorded a zero" — except today, which always gets a row so
the screen doesn't read as unsynced before you've taken a step yet.
`recordProgress()` grew an optional `day` parameter for this (`'YYYY-MM-DD'`,
defaulting to today's local date when omitted, matching every other day
key in the app) — it upserts on `(challenge_id, user_id, day)`, so
re-running a full backfill on every sync is deliberate and harmless rather
than a "first sync only" special case.

### Friends: a real friend graph

FriendsScreen used to render `src/data/sampleData.ts`'s `FRIENDS` list
unconditionally — a fixed cast of five people with invented sync
statuses ("Synced 22m ago", "Stale · 2 days") that never changed no
matter what you did. It now follows the same "real data replaces the
sample list once it loads, falls back to it on any failure or when
Supabase isn't configured" pattern as ChallengesScreen, backed by a new
`friendships` table (`0007_friendships.sql`): one row per pair of users,
`status` `'pending'` or `'accepted'`, with a unique index on
`(least(requester_id, recipient_id), greatest(...))` so a request and
its (potential) mirror in the other direction can never both exist as
separate rows.

"Invite by email" (`src/friends/supabaseFriends.ts`'s `inviteByEmail`)
looks the address up in `profiles` (visible to any signed-in user
already, via 0001's "Profiles are viewable by any signed-in user"
policy). If that person already has a Hound account, this creates a
`friendships` row same as before — or, if they already invited *you*,
accepts theirs instead of creating a second pending row for the same
pair (the unique index would reject it anyway; the app checks first so
that race resolves as "you're now friends" rather than an error). RLS
only lets the *recipient* flip a row to `'accepted'` (`friendships`'s
update policy) — the requester can't befriend someone by editing their
own pending row. Declining a pending invite and unfriending an existing
friend are the same `DELETE`, since there's only ever one row per pair
regardless of status. If nobody's signed up with that email yet, see
"Inviting someone who isn't on Hound yet" below instead of an error.

**Deliberately still fake:** the old per-friend "Synced 22m ago" /
"Stale · 2 days" line. That needs each friend's *own* device pushing a
sync event somewhere this app can read, which doesn't exist for
anyone's data but your own (see "What's not implemented"), so a real
friend row simply doesn't show a sync status rather than inventing one.
The "Send one link" / "Copy" shareable-link card is also unchanged and
still decorative — real invites here go through the email lookup above,
not a link; wiring an actual `hound.app/u/...` deep link to auto-add a
friend on open is a separate follow-up. The "Challenge" button next to
each sample friend has no equivalent yet either — jumping from a real
friend straight into a pre-filled Create flow with them invited isn't
wired up.

A gap only surfaced by testing the "someone already has an account"
branch specifically: `inviteByEmail` finding a matching profile and
inserting a `friendships` row used to notify nobody at all — silent
until the recipient happened to open the Friends tab on their own.
Concretely: user1 invites user2 (not on Hound yet) — `pending_invites` +
`send-invite-email` fire, real email, covered above. User2 signs up,
`handle_new_user()` auto-friends them with user1. Now user3, someone
user2 has never interacted with, invites user2 by email — a matching
profile exists this time, so it's the `friendships`-insert branch, which
had no email of its own. New Edge Function
`send-challenge-invite-email`'s sibling for this, `send-friend-request-email`,
closes it: same Resend setup, same `RESEND_API_KEY` secret, called right
after that insert with just the new friendship's `id` — it looks up the
requester's name and the recipient's own name/email itself
server-side, the same reasoning `send-challenge-invite-email` uses (every
row it reads is already something the requester's own RLS lets them
see: "Users can view their own friendships," "Profiles are viewable by
any signed-in user"). Same best-effort call site pattern as the other
two: the `friendships` row is already durably written either way, so a
failed send never surfaces as "could not send that invite." Verified the
same way: the query's RLS visibility directly against a local throwaway
Postgres; the actual Resend send is unverified from this sandbox, same
as the other two. Deliberately narrow in scope to exactly this gap —
accepting a friend request still notifies nobody, which is a separate,
not-yet-requested follow-up, not an oversight.

#### Inviting someone who isn't on Hound yet

`inviteByEmail`'s "no matching profile" case (`0008_pending_invites.sql`)
doesn't just error anymore. It inserts a `pending_invites` row
(`inviter_id`, `email`) and calls a new Supabase Edge Function,
`supabase/functions/send-invite-email`, to actually send them a "you've
been invited" email via [Resend](https://resend.com). The moment that
email signs up, `handle_new_user()` (redefined in this migration —
Postgres has no "alter function body", only a full replace) checks
`pending_invites` for their address and inserts an already-`'accepted'`
`friendships` row for every match before deleting the consumed
invite(s) — so accepting the email and becoming friends happen in the
same step, not two.

This is the first piece of server-side code in this project — everything
else is client + Postgres/RLS. It has to be: whatever key authorizes
sending mail through Resend can't live in the client app, the same
reason no `service_role` key appears anywhere in `src/`. The function
reads the *caller's* name server-side from their own JWT (forwarded
automatically by `supabase.functions.invoke()`) rather than trusting a
client-supplied name, and calling it is best-effort from the app's side
— a failed send (function not deployed, Resend rejecting the domain,
whatever) doesn't fail `inviteByEmail()`, because the `pending_invites`
row is already durably written either way and the friendship still
completes on signup even if the email itself never arrives.

**Not done, and can't be from inside this sandbox:** actually deploying
the function or sending a real email. Both need steps only you can do —
create a [Resend](https://resend.com) account and API key, verify a
sending domain (until then Resend's API rejects the send with a clear
error rather than silently dropping it), then:

```
supabase functions deploy send-invite-email
supabase secrets set RESEND_API_KEY=re_your_key_here
```

The email's link (`HOUND_SIGNUP_URL` in the function) is a bare
`https://houndchallenge.net` placeholder — there's no App Store listing
or hosted sign-up page yet for it to point at, so swap it for whatever
that ends up being. This was verified the same way as 0007's `friendships` table —
applying 0001 through 0008 against a local throwaway Postgres and
exercising the trigger directly (a real sign-up auto-creates the
accepted friendship, consumes the pending invite, and a manufactured
self-invite edge case doesn't break it) — never against a real Supabase
project or Resend account, which this sandbox can't reach.

### Inviting a friend to a specific challenge

Separate from the friend graph above: ChallengesScreen used to show a
hardcoded "Priya invited you to 'Sunrise Streak'" card whose Join/Decline
buttons had no `onPress` at all — not wired to any data, real or sample.
`challenge_invites` (`0009_challenge_invites.sql`) makes it real: one row
per `(challenge_id, invitee_id)` — the unique constraint means a person
can only have one pending invite to a given challenge regardless of who
sent it, so a second friend inviting them to the same challenge doesn't
produce a second card.

Deliberately simpler than `friendships`: there's no durable "accepted"
state to keep. Accepting (`ChallengesProvider.acceptChallengeInvite`)
just inserts a real `challenge_participants` row (the same table
`createChallenge()` already writes to for the creator) and deletes the
invite — once you're a participant there's nothing left for the invite
to represent. Declining is the same `DELETE`, no state change first.
Only a current participant of a challenge can invite someone to it
(`0009`'s insert policy checks `challenge_participants`), and RLS
required one more addition: 0001's "Participants can view their
challenges" policy doesn't cover someone who's been invited but hasn't
joined yet, so `0009` adds a second, independent SELECT policy on
`challenges` for "you have a pending invite to this one" — an *additional*
permissive policy rather than editing the existing one, since Postgres
ORs multiple permissive policies for the same command together, and
editing challenge_participants' own policies was exactly how
`0002_fix_challenge_participants_recursion.sql` had to clean up a
self-referential recursion bug earlier in this project. This new policy
references a different table (`challenge_invites`), not `challenges`
itself, so it doesn't reintroduce that class of bug.

`ChallengeDetailScreen.tsx` gained an "Invite a friend" card listing your
accepted friends (from `src/friends`) who aren't already in the
challenge — inviting is a self-contained action that doesn't check
whether they'll actually see it in time, mirroring how `inviteByEmail`
doesn't wait to find out an email arrived. Verified the same way as
`friendships` and `pending_invites`: applied 0001 through 0009 against a
local throwaway Postgres and confirmed directly — a real participant can
invite someone, a non-participant can't, an invitee can read the
challenge's name before joining (the new policy's whole reason for
existing), joining removes the invite and adds a real participant row,
and an uninvolved third party can neither see nor delete someone else's
invite.

That local verification used a plain insert for the join step, which is
exactly why it missed a real bug this one caught: `acceptChallengeInvite`
had since grown an `.upsert(..., { onConflict: 'challenge_id,user_id',
ignoreDuplicates: true })` (to make a retry after a failed delete
idempotent instead of hitting the unique constraint as a hard error) —
`.upsert()` compiles to `INSERT ... ON CONFLICT DO NOTHING`, and Postgres
RLS requires the executing role to satisfy the table's SELECT policy for
the conflict-arbiter check itself, even when no conflict actually
exists. An invitee accepting for the first time isn't a participant yet
— that's exactly what this insert is trying to make them — so
"Participants can view each other" always evaluated to false for them,
and Postgres rejected the whole statement as an RLS violation before it
ever got to check whether a real conflict existed. Tapping "Join" against
a real Supabase project did nothing, with no error surfaced anywhere
(`ChallengesScreen.tsx`'s `respondToInvite` deliberately swallows any
failure here — "a stale invite silently stops responding rather than
crashing" — which is exactly why this one produced no visible error at
all instead of a wrong one). Fixed by going back to a plain `insert()`
and catching Postgres's `23505` (unique_violation) directly for the
retry case, the same pattern `inviteFriendToChallenge` already uses for
"Already invited." — a plain insert has no conflict-arbiter SELECT
requirement, so it isn't exposed to this class of bug at all. Verified
directly against a local throwaway Postgres: the exact failure
reproduces with the old `.upsert()` call, and the fixed plain `insert()`
succeeds for a first-time accept and correctly falls through to the
unique-constraint path (not an RLS error) on a simulated retry.

`inviteFriendToChallenge` now also emails the invitee, via a new Edge
Function, `supabase/functions/send-challenge-invite-email` — the same
Resend setup `send-invite-email` already uses, reusing the same
`RESEND_API_KEY` secret, no new configuration needed if that's already
deployed. The difference from `send-invite-email`: that one is for
someone who isn't on Hound yet, addressed by a raw email string this
project has no account for; this one is for an existing user who just
got a real `challenge_invites` row, so the function takes that row's
`id` and looks up everything else itself — the challenge's name, the
inviter's name, and the invitee's name/email from `profiles` — rather
than trusting anything the client sends beyond which invite this is
about. Authenticates with the *caller's* JWT, not the service role,
same as `send-invite-email` and for the same reason it's safe to: every
row this reads (the invite itself, its challenge, both profiles) is
already something the inviter's own RLS already lets them see —
"Users can view invites they sent or received" (0009), "Participants
can view their challenges" (0001 — sending this invite at all already
required being a participant), and "Profiles are viewable by any
signed-in user" (0001, which is also where the invitee's email comes
from). Called right after the invite insert succeeds, and deliberately
best-effort exactly like `inviteFriendToChallenge`'s own callers
already treat *it* — a failed send never blocks or surfaces as
"could not invite that friend," since the in-app invite card the
invitee sees on their next visit works regardless of whether this email
ever arrives. Same two things not done, and can't be from inside this
sandbox, as `send-invite-email`: a verified sending domain, and (this
one specifically) a real deep link into the invitee's own pending
invite rather than just Hound's front door.

The Create wizard's own "Bring friends" step (step 3) had the exact same
"looks real, isn't" problem `ChallengesScreen`'s Priya card had: it
listed `sampleData.ts`'s hardcoded `FRIENDS`, and tapping one to "invite"
them just toggled a local checkbox that `start()` never read — a brand
new user picking real people they know off a fake list, with taps that
did nothing either way. It now lists real accepted friends
(`supabaseFriendsProvider.listFriends()`, filtered to `status ===
'accepted'`, same as `ChallengeDetailScreen`'s own invite card), with the
same honest empty state ("Add friends from the Friends tab, then invite
them here.") every other real-data screen this session settled on rather
than falling back to `FRIENDS`. Picking someone now does something real:
once `createChallenge()` returns, `start()` calls
`inviteFriendToChallenge(created.id, friendUserId)` for each selected
friend — the exact same call `ChallengeDetailScreen`'s "Invite a friend"
card makes after the fact, just fired immediately instead of on a later
visit. Deliberately `Promise.allSettled`, not `Promise.all`: the
challenge itself has already saved successfully by that point, so one
bad invite shouldn't surface as "could not save that challenge."

A hunt's "Who's the Hunter?" picker still only offers bots, not real
friends — unchanged by this fix, and already documented above ("Hunter
& Hunted: real scoring and roles") as its own, separate limitation: a
role has to be assigned before the invitee has even accepted, which
this pass didn't attempt to solve. The static `hound.app/j/hunt-4kq9`
"Copy invite link" box on this same step is also still decorative —
narrower scope than what was actually asked for here, but worth naming
rather than leaving it looking finished by association now that the
list right above it is real.

### Login reminders: nudging people who haven't opened the app today

`0010_login_reminders.sql` adds what the rest of this feature is built on:
`profiles.last_active_at`, touched by the client (`src/notifications/
supabaseNotifications.ts`'s `touchLastActive`, called from
`AuthContext.tsx`) on every app open with a valid session — not just a
fresh sign-in, since a Supabase session can stay valid for weeks without
anyone seeing a sign-in screen again, and "did they enter credentials
today" would badly undercount who's actually using the app.

Two independent channels, each with its own per-user on/off switch
(`profiles.notify_push_enabled` / `notify_email_enabled`, both default
`true`), toggled from Settings → Data & account → "Login reminders":

- **Push**: `device_push_tokens` holds one row per registered device (a
  user with two phones gets nudged on both). Turning the toggle on walks
  through the real flow — request OS permission, get an Expo push token
  (needs `extra.eas.projectId` in `app.json`, already set), upsert it —
  and throws (leaving the preference untouched, same as any other action
  in this app that can fail) if there's no physical device to register or
  permission is denied, rather than silently flipping a switch that won't
  do anything.
- **Email**: reuses the exact Resend setup `send-invite-email` already
  has (same `RESEND_API_KEY` secret, same "server-side only" reasoning).

`send-login-reminders` (the Edge Function) runs with no signed-in user
behind it — a service-role client, not a caller's JWT — so it can query
every profile, not just one person's own row. It picks anyone with at
least one channel on who hasn't been active since UTC midnight and hasn't
already been reminded today (`last_login_reminder_sent_at` guards against
a double-send if the schedule below ever fires twice), sends push via
Expo's push API and/or email via Resend depending on which channels that
person has on, then stamps `last_login_reminder_sent_at`.

**Scheduling** uses `pg_cron` + `pg_net` (both enabled by `0010` itself) —
Postgres calling the Edge Function on a timer, the pattern Supabase's own
docs use for this. It needs two things `0010`'s own comments call out
rather than baking into the repo: your project's ref in the function URL,
and the service-role key stored once via `select
vault.create_secret('...', 'service_role_key')` in the SQL Editor (never
committed — same reasoning as `RESEND_API_KEY` never shipping in the app
bundle).

**Known limitation, on purpose for now**: the schedule fires at one fixed
UTC hour (9pm) for everyone, not "before the end of each user's own day."
Doing that properly needs a per-user timezone — captured from the device
alongside `device_push_tokens.platform` — and an hourly schedule instead
of a daily one. Flagged as `TODO(timezone)` in both `0010` and the Edge
Function; not done in this pass.

Verified locally the same way as every other migration this project
ships: applied `0001` through `0010` (the `pg_cron`/`pg_net`/schedule
statements aside — that local Postgres doesn't have those extensions
installed, only Supabase's managed Postgres does) against a throwaway
database, then confirmed as two simulated users that each can register
and see only their own push tokens, insert-for-someone-else on
`device_push_tokens` is rejected, and each can update their own
`notify_push_enabled`/`last_active_at` but not the other's. The push
send, email send, and cron schedule itself were never exercised against a
real project or a real device — this sandbox has no network path to
Expo's push service, Resend, or a live Supabase project.

With those two env vars unset (the default — nothing above is required to
run the app), everything falls back to what it did before: mock auth
(`src/auth/mockAuth.ts`) and static sample data. This is the same
fallback pattern `src/health` uses for a native module that isn't linked —
`isSupabaseConfigured` (`src/lib/supabase.ts`) is the single switch every
caller checks.

**Email/password auth is fully wired** (`src/auth/supabaseAuth.ts`) — sign
up and log in for real once a project is configured, no further setup
needed. **Facebook and Apple are wired in code but need provider setup
you have to do yourself**: each requires creating an OAuth app in that
provider's own developer console (Meta for Developers, Apple Developer —
separate accounts Claude can't create on your behalf) and pasting the
resulting client ID/secret into Supabase's Authentication → Providers
page. Until a given provider is enabled there, tapping its button fails
with a clear error ("Sign-in did not return a session — is this provider
enabled in Supabase?") rather than crashing. Facebook's checklist below
has been run end-to-end for real (see "Facebook Sign-In"); Apple's
equivalent hasn't been set up yet, and App Store review expects native
Sign in with Apple (`expo-apple-authentication`) rather than the generic
web-OAuth flow used here regardless — that's a follow-up, not done in
this pass (see "What's not implemented"). **Google uses a different,
better path** — see "Google Sign-In (native)" below.

### Facebook Sign-In

There's no separate "create account with Facebook" flow — the one
"Continue with Facebook" button on `WelcomeScreen.tsx` does both:
`signInWithOAuth` creates the `auth.users` row (and, via the trigger in
`0001_challenges_schema.sql`, the matching `profiles` row) the first time
a given Facebook account completes it, then signs that same session in
on every visit after — the exact behavior the Google and Apple buttons
already have. All of it is code-complete already; what's left is entirely
in two consoles you have to click through yourself, since both need
accounts/credentials Claude has no access to:

1. [Meta for Developers](https://developers.facebook.com/apps) → **Create
   App** → any use case that includes **Facebook Login** (e.g.
   "Authenticate and request data from users with Facebook Login") →
   add the **Facebook Login** product to it.
2. In that app's **Facebook Login → Settings**, add one **Valid OAuth
   Redirect URI**: `https://<your-project-ref>.supabase.co/auth/v1/callback`
   — Supabase's own hosted callback, not this app's `hound://` scheme.
   Facebook redirects here first; Supabase is the one that redirects back
   into the app afterward (next step), which is why this app's own scheme
   never needs to be registered with Facebook at all. `<your-project-ref>`
   is the subdomain in `EXPO_PUBLIC_SUPABASE_URL` (`.env`).
3. App **Settings → Basic**: copy the **App ID** and **App Secret**.
4. Supabase dashboard → **Authentication → Providers → Facebook**: paste
   those two in, enable.
5. Supabase dashboard → **Authentication → URL Configuration → Redirect
   URLs**: add `hound://auth/callback` (`app.json`'s `scheme` +
   `signInWithWebOAuth`'s `Linking.createURL('auth/callback')` in
   `supabaseAuth.ts`) — Supabase refuses to bounce back into any
   `redirectTo` that isn't on this allowlist. Testing in Expo Go or a dev
   client instead of a standalone build needs its own `exp://…` redirect
   added here too (printed by the dev server at startup); that one
   changes per machine/tunnel, so it's not worth hardcoding into these
   steps as a fixed value.
6. While the Facebook app is in **development mode** (the default for a
   brand new app), Facebook Login only works for that app's own admins,
   developers, and testers (**App roles** in the developer console) —
   add any account you want to test with there, or submit the app for
   Meta's App Review (asking for the `public_profile`/`email`
   permissions this flow uses) before real users outside your team can
   use it.

Until steps 1-5 are done, tapping "Continue with Facebook" fails with
the same clear "is this provider enabled in Supabase?" error every other
unconfigured provider shows — never a crash, and nothing else in the app
depends on this being set up.

**Confirmed working end-to-end against a real Supabase project**: this
checklist, followed exactly as written above, took a real Facebook
account through the full "Continue with Facebook" button all the way to
a new row in `auth.users` with `provider` correctly set to `facebook` —
the one thing this sandbox could never exercise itself (no network path
to a live Supabase project or Facebook's OAuth servers), so this is the
first of the three providers verified against the real thing rather than
just read against the SDKs' docs.

### Google Sign-In (native)

Google's button uses the real native Google account picker
(`@react-native-google-signin/google-signin`) rather than Facebook/Apple's
generic web-OAuth redirect — better UX, and it's what Google's own docs
recommend for mobile apps. The trade-off is more setup, all in [Google
Cloud Console](https://console.cloud.google.com/apis/credentials):

1. Create (or pick) a project, then **Create Credentials → OAuth client
   ID** three times, once each for:
   - **Web application** — no redirect URI needed. Copy its **Client
     ID**; this is what audiences the ID token Google issues, so both
     the app and Supabase have to agree on it.
   - **iOS** — Bundle ID `app.hound.mobile` (`app.json`'s
     `ios.bundleIdentifier`). Copy its **Client ID** — you need it in
     *two* different forms, in two different places:
     - Reversed (`1234-abc.apps.googleusercontent.com` →
       `com.googleusercontent.apps.1234-abc`) into `app.json`'s
       `plugins` entry for `@react-native-google-signin/google-signin`,
       replacing the `REPLACE_WITH_YOUR_IOS_CLIENT_ID` placeholder. This
       is a static app.json edit, not an env var — it has to exist
       before `expo prebuild` runs. It registers the URL scheme iOS
       uses for the sign-in redirect to come back into the app.
     - Plain, as `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` in `.env` (step 2
       below). The native SDK's `configure()` call needs this directly
       — without it, iOS throws `RNGoogleSignin: failed to determine
       clientID` the moment you tap the button, since there's no
       `GoogleService-Info.plist` (a Firebase artifact) for it to read
       instead.
   - **Android** — package name `app.hound.mobile` plus your signing
     certificate's SHA-1 fingerprint (`keytool -list -v -keystore
     ~/.android/debug.keystore` for a debug build; get release's from
     wherever you manage that keystore, or from EAS Build's credentials
     if you use it). Nothing from this one goes into `.env` or
     `app.json` — Android's native SDK looks the client up from the
     package name + SHA-1 you registered, not from anything the app
     passes it.
2. In `.env`: `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (the **Web** client ID)
   and `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` (the **iOS** client ID, plain
   form — see above). Both are required on iOS; Android only needs the
   Web one.
3. Supabase dashboard → Authentication → Providers → Google: paste in
   the **Web** client ID plus its client secret, enable. (The iOS client
   ID doesn't go here — Supabase only ever sees the Web one, since
   that's what audiences the ID token.)
4. Needs a native rebuild either way (`npx expo prebuild --clean` +
   `expo run:ios` / `expo run:android`) — this is a native module, so it
   doesn't exist in Expo Go and can't be picked up by just reloading JS.

Without `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` set (either platform) or
`EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` (iOS only), tapping Google shows a
clear "needs this env var" error (`src/auth/googleSignIn.ts`) rather than
crashing or silently falling back — this is independent of whether
Supabase itself is configured, since the token exchange
(`supabase.auth.signInWithIdToken`) needs both sides. On the web preview
(`expo start --web`) Google always shows "isn't available in the web
preview" — the underlying package's web implementation is a paid-sponsor
feature this project doesn't have, so it's a real limitation, not
something worth working around.

**Challenge data**: `src/challenges/supabaseChallenges.ts` implements
`listMyChallenges`, `getChallenge`, `listParticipants`, `getLeaderboard`,
`createChallenge`, and `recordProgress` against the schema above.
`CreateScreen.tsx`'s "Start the challenge" button calls `createChallenge`
(creating a real row + joining yourself as a participant, when a project
is configured), and — once it lands you back on the Challenges tab —
`ChallengesScreen.tsx` calls `listMyChallenges` + `listParticipants` +
`getLeaderboard` per challenge and renders the result through
`src/challenges/present.ts`, a formatter that turns those raw rows into
the same display shape (`ChallengeCard`: colors, "Day 9 of 21", per-person
avatar tints) `src/data/sampleData.ts` hand-authors for its static
content — so `<ChallengeRow>` doesn't care which one it's rendering. Once
Supabase is configured and that fetch succeeds, it fully replaces the
sample list rather than merging with it (a real backend shouldn't leave
fake demo challenges sitting next to real ones); on any failure, or with
Supabase unconfigured, the screen quietly stays on an honest empty state
("No challenges yet — start one above.") rather than fabricating sample
challenges to fill the gap.

Tapping a real challenge card opens `ChallengeDetailScreen.tsx` — a
generic detail view (not tied to any one challenge kind, unlike Hunt)
showing the full participant list ranked by steps, defaulting to 0 for
anyone who hasn't logged anything. A `'steps'`-kind challenge is the one
case with an unambiguous real number to draw from (device step count), so
it auto-syncs from `useHealthProvider()` — once when the
screen loads and again on demand via its own "Sync now" — straight into
`recordProgress()`, no typing required, backfilling every day since the
challenge started rather than only today (see "Device sync backfills the
whole challenge, not just today"); every other kind still uses the
manual "log your progress" form (there's no automatic sync from
HealthKit/Health Connect for those yet — see "What's not implemented").
Sample cards never open
this screen (`ChallengeCard.target` distinguishes 'hunt' / 'detail' /
not-tappable — see its comment in `sampleData.ts`), since they have no
real row behind them to fetch. The Hunt screen is the one static
holdout left — the Challenges screen's active list, "Finished" section,
and invite card all read real data (or an honest empty state) now; none
of them fall back to fabricated sample content anymore.

Whoever created a real challenge sees a "Delete challenge" action at the
bottom of its detail screen — anyone else in it doesn't (there's nothing
stopping a participant from leaving one they didn't create; that's a
separate, not-yet-built feature). Confirmed via a native `Alert.alert()`
before it actually deletes anything. `challenges.delete` is the only new
RLS policy this needs (`0005_challenges_delete_policy.sql`) — every child
table (`challenge_participants`, `challenge_bots`, `progress_snapshots`)
already references `challenges` with `on delete cascade`, so deleting the
one row removes everyone's participation and progress in it too.

Every real challenge's detail screen also has a "Highlight on Today
screen" toggle — whichever one a user turns on is what `HomeScreen`
headlines, instead of always defaulting to whichever challenge was
created most recently (falling back to that default if nothing's
highlighted, or if the highlighted one has ended). It lives on
`challenge_participants.highlighted`
(`0006_challenge_highlight.sql`) rather than on `challenges` itself,
since it's a per-participant preference — two people in the same
challenge can highlight different ones on their own Home screens.
`setHighlighted()` clears whatever the current user had highlighted
before turning a new one on, so at most one stays on per user.

## The auth layer

`RootNavigator.tsx` renders either the auth screens (Welcome → Login/SignUp)
or the main app, switched on `useAuth().status` — the standard React
Navigation pattern for gating an app behind sign-in (swapping which
`Stack.Screen`s are mounted, rather than navigating within one shared
stack, so there's no back button into Welcome once you're signed in).
`useAuth().initializing` covers the brief async gap while a Supabase
session is being restored from storage on cold start; `RootNavigator`
shows a spinner rather than flashing Welcome first.

- `src/auth/AuthContext.tsx` — `useAuth()` exposes `status`, `user`,
  `initializing`, and `signInWithGoogle` / `signInWithFacebook` /
  `signInWithApple` / `signInWithEmail` / `signUpWithEmail` / `signOut`.
  It picks `supabaseAuth.ts` or `mockAuth.ts` once, at import time, based
  on `isSupabaseConfigured` — every screen calls the same functions
  either way.
- `src/auth/supabaseAuth.ts` — real Supabase Auth, used whenever a
  project is configured (see "The backend (Supabase)" above).
- `src/auth/mockAuth.ts` — used otherwise. The three provider buttons
  resolve to a fake profile after a simulated delay, with no real
  Google/Facebook/Apple SDK involved. Email sign-in/sign-up do basic
  client-side validation plus a couple of deliberately-reachable failure
  paths (a known email, a password under 6 characters) so the error
  states aren't purely theoretical.
- Session persistence: real, but only on the Supabase path — it stores
  the session in `AsyncStorage` and restores it on cold start
  (`AuthContext.tsx`'s `useEffect`). Mock auth never persisted anything
  and still doesn't; signing out or reloading the app while unconfigured
  always resets to signed-out.

## The health data layer

`src/health/types.ts` defines a platform-agnostic `HealthProvider` interface.
Screens only ever call `useHealthProvider()` (`src/health/HealthContext.tsx`) —
they never import a platform SDK directly.

- `src/health/iosProvider.ts` — real HealthKit calls via `@kingstinct/react-native-healthkit`.
- `src/health/androidProvider.ts` — real Health Connect calls via `react-native-health-connect`.
- `src/health/mockProvider.ts` — sample data, used automatically whenever the
  native module isn't linked (Expo Go, web, or this repo's dev sandbox) or
  `isAvailable()` returns false. This is what makes the app runnable without
  a device at all.

`resolveHealthProvider()` in `src/health/index.ts` tries the real platform
provider first and falls back to mock on *any* failure — it never throws, so
a screen always has something to render.

## Running it

```
npm install
npx expo start          # Expo Go — screens, navigation, mock health data
npx expo start --web    # fastest way to eyeball the UI in a browser
```

**Expo Go / `--web` only exercise the mock provider.** HealthKit and Health
Connect are native modules and are not present in Expo Go. To actually pull
real device data:

```
npx expo prebuild        # generates ios/ and android/ native projects
npx expo run:ios         # needs Xcode, so needs a Mac
npx expo run:android     # needs Android Studio / the Android SDK
```

or build a dev client with EAS (`eas build --profile development`) if you'd
rather not install the native toolchains locally.

### iOS specifics
- Needs a Mac with Xcode — there is no way around this, it's an Apple
  platform requirement, not a project limitation.
- `app.json`'s `ios.entitlements` already requests the HealthKit capability
  and `ios.infoPlist` carries the required usage-description strings. EAS
  Build can provision the HealthKit capability automatically; a local
  `expo run:ios` build needs it enabled once in Xcode's Signing &
  Capabilities tab (should be enabled by `expo prebuild` and then be picked up automatically after that).
- Test on a real device or the iOS Simulator (the Simulator has *no* real
  health data — seed some in the Simulator's Health app first, or leave it
  empty to see the app's own "no data" paths).
- Uses `@kingstinct/react-native-healthkit` (backed by
  `react-native-nitro-modules`), not the older `react-native-health`.
  React Native removed Old Architecture support from its own Podfile
  tooling as of RN 0.82 (`pod install` now always forces
  `RCT_NEW_ARCH_ENABLED=1` — see `warn_if_new_arch_disabled` in
  `react_native_pods.rb` — so `newArchEnabled: false` in app.json is a
  no-op on current React Native and can't be used to opt out). This
  project's RN version is 0.86.3, well past that point.
  `react-native-health`@1.19.0 (its latest release) is a legacy
  (non-Turbo) native module that predates the New Architecture; under
  bridgeless mode its native module never registered with the JS bridge
  at all, so every call on it — starting with `isAvailable()` — threw
  `TypeError: undefined is not a function` at runtime, and the app
  silently fell back to mock data with no crash and no permission prompt.
  `@kingstinct/react-native-healthkit` is a Nitro Module, i.e. built for
  the New Architecture from the ground up, which avoids that whole class
  of interop bug instead of patching around it. Its config plugin
  (referenced by bare package name in `app.json`'s `plugins`, since unlike
  Health Connect's it's plain JS and Expo's auto-discovery resolves it
  fine) sets the HealthKit entitlement; `{ "background": false }` opts out
  of the background-delivery entitlement the plugin would otherwise add by
  default, since this app doesn't use background delivery.
- HealthKit's read-authorization status is deliberately unreliable by
  design — `authorizationStatusFor()` distinguishes "never asked" from
  everything else, but not "granted" from "denied" for *read* types (Apple
  never reports that back to the calling app, for privacy). `iosProvider.ts`
  treats "not determined" as the only meaningful distinct status.
- If the Simulator fails at launch with `Library not loaded:
  @rpath/React.framework/React`, referenced from
  `ExpoModulesWorklets.framework` (a dyld error, not a JS crash — it
  happens before any app code runs), that's Expo SDK 57's precompiled
  native module binaries getting out of sync with a from-source React
  Native build (the same class of bug as expo/expo#49948:
  `expo-modules-core`'s worklets integration ships a precompiled dynamic
  framework that expects a precompiled `React.framework` alongside it, but
  a stale local `Pods`/DerivedData state can end up building React Native
  itself from source instead, so that framework is never produced).
  `app.json` now sets `expo-build-properties`'s
  `ios.buildReactNativeFromSource: true`, which forces every native module
  to build from source consistently and avoids the mismatch. After pulling
  this change, do a full clean rebuild once (stale `ios/`/Pods/DerivedData
  from before this flag won't fix themselves):
  `rm -rf ios android node_modules && npm install && npx expo prebuild --clean && npx expo run:ios`.

### Android specifics
- Needs the Health Connect app. Android 14+ ships it in-box; earlier
  versions need it installed from Play. The Android emulator's default
  system image usually does **not** include it — use a Google Play system
  image, or install the Health Connect APK manually.
- `app.json`'s `expo-build-properties` plugin sets `android.minSdkVersion: 26`.
  Expo/RN's own default for this project was 24, but
  `androidx.health.connect:connect-client` (pulled in transitively by
  `react-native-health-connect`) declares `minSdkVersion 26` in its own
  manifest — Health Connect itself only exists on API 26+ (Android 8.0), so
  Gradle's manifest merger fails the build (`uses-sdk:minSdkVersion 24
  cannot be smaller than version 26 declared in library
  [androidx.health.connect:connect-client:1.1.0]`) unless the project's own
  floor is raised to match, rather than forced past it with
  `tools:overrideLibrary` (Gradle's own suggestion for that option warns it
  "may lead to runtime failures"). Practically this means Hound for Android
  no longer installs on anything older than Android 8.0 — not a real-world
  constraint given Health Connect's own requirement.
- `app.json`'s `android.permissions` already lists the
  `android.permission.health.READ_*` entries `react-native-health-connect`
  needs.
- `app.json`'s config-plugins list references `./plugins/withHealthConnect.js`
  instead of the bare `"react-native-health-connect"` package name. That
  file is a vendored copy of the package's own `app.plugin.js` (same
  AndroidManifest mod, byte-for-byte at the time it was copied) — Expo's
  auto-discovery of that file inside the package has failed with
  `PluginError: Unexpected token 'typeof'` on at least one real machine
  (not reproducible in the sandbox this project was originally built in,
  so the exact trigger is unconfirmed). Referencing the mod by a local path
  sidesteps that resolution entirely. If you upgrade
  `react-native-health-connect`, diff its new `app.plugin.js` against
  `plugins/withHealthConnect.js` and port any changes.

### EAS Build: internal distribution and TestFlight

HealthKit/Health Connect are real native modules — Expo Go can't run
them, and neither can the web preview this sandbox used for everything
else in this README. A real build is the only way to actually see this
app read real health data on a real device, whether that's an internal
build you install directly or one submitted to TestFlight. `eas.json`
defines three profiles (`development`/`preview`/`production`); none of
the steps below can run in this sandbox — they need your own Expo and
Apple accounts, so this is written for you to run on your own machine.

1. `npm install -g eas-cli`, or just use `npx eas-cli` for every command
   below (what `npm run build:ios:preview` etc. do internally) —
   `eas-cli` deliberately isn't a project devDependency. Expo's own
   `expo-doctor` flags a locally-installed `eas-cli` as a real problem,
   not a style nit: it pulls its own dependency tree (including a nested
   `typescript`) into your lockfile, which is exactly what caused a
   confusing `npm ci` failure on EAS Build earlier in this project's
   history (two different npm versions disagreed about whether that
   nested entry needed to be explicit in the lockfile).
2. `eas login` — your own Expo account. (If you'd rather not type a
   password somewhere, an access token from expo.dev → Account settings
   → Access tokens works too, exported as `EXPO_TOKEN`.)
3. `eas init` from `mobile/` — links this project to your account and
   writes an `extra.eas.projectId` into `app.json`. Commit that.
4. `eas build --platform ios --profile preview` (or `npm run
   build:ios:preview`) for **internal distribution** — installs directly
   on registered test devices via a link/QR code, no App Store Connect or
   Apple review involved. First run prompts you through:
   - Logging into your Apple ID (Apple Developer Program membership
     required — HealthKit needs a paid account, not a free one).
   - Registering test devices (`eas device:create`, or the prompt links
     you to a page that does it from the device itself).
   - Generating a provisioning profile with the HealthKit capability —
     EAS's automatic credentials manager reads `app.json`'s
     `ios.entitlements` and enables matching capabilities on the App ID
     it registers. If the App ID already existed from before this
     project turned HealthKit on, you may need to enable the HealthKit
     capability on it manually once, in the Apple Developer portal's
     Certificates, Identifiers & Profiles → Identifiers page.
5. For **TestFlight**: `eas build --platform ios --profile production`
   (or `npm run build:ios:production`), then `eas submit --platform ios`
   (or `npm run submit:ios`) once it finishes. This needs an app record
   in [App Store Connect](https://appstoreconnect.apple.com) first
   (bundle ID `app.hound.mobile`, matching `app.json`) — `eas submit`
   prompts you through picking or creating one. Internal testers (up to
   100, your own Apple Developer team) don't need Apple's review; external
   testers do.

### What this sandbox could and couldn't verify

This app was built in a container with no iOS Simulator, no Android
emulator, and no physical device attached. What *was* verified here:
- `npx tsc --noEmit` — clean, no type errors.
- `npx expo prebuild --platform ios` / `--platform android` — both generate
  native projects cleanly; the iOS entitlements and Info.plist keys the
  HealthKit and Google Sign-In config plugins are supposed to add
  (including the reversed `iosUrlScheme` — see "Google Sign-In (native)")
  were checked in the generated `ios/` output.
- `npx expo export --platform ios` and `--platform android` — both bundle
  cleanly (4,200+ modules resolve, including `@kingstinct/react-native-healthkit`,
  `react-native-health-connect`, and `@react-native-google-signin/google-signin`),
  so there's no import/resolution error waiting to surface on a real build.
- The full UI, every screen, and every interaction (wizard steps, slider,
  toggles, tab switches, navigation, the full sign-in flow, the Create
  wizard) — visually verified end-to-end via `expo start --web` in a real
  browser, running against mock health data and mock auth (no Supabase
  project configured).
- `ChallengeDetailScreen.tsx`'s render and error-handling paths
  specifically: temporarily pointed one sample card's `target` at
  `'detail'` (reverted before committing — sample cards never really do
  this, see `sampleData.ts`'s comment on `target`) to navigate there with
  Supabase unconfigured, confirming the loading state resolves cleanly
  into a visible error ("Supabase is not configured.") with a working
  back button, rather than a crash — real navigation, real component
  lifecycle, just not a real data-loaded state.

What was **not** verified, because it requires things this sandbox doesn't
have: an actual HealthKit or Health Connect permission prompt, real device
sensor data flowing through `iosProvider.ts` / `androidProvider.ts`, native
builds (`expo run:ios` / `expo run:android` / EAS), and — new since the
Supabase integration — anything on the real Supabase code path at all.
`supabaseAuth.ts` and `supabaseChallenges.ts` are written carefully against
Supabase's documented client API and the schema in
`supabase/migrations/0001_challenges_schema.sql` (which the two are kept
consistent with), and `tsc` and the bundler both accept them, but there is
no live Supabase project in this sandbox to run a single query against —
treat both files, and the OAuth redirect flow in particular, as unverified
until someone runs them against a real project. This is exactly why
0001's self-referential RLS policy on `challenge_participants` shipped
uncaught in the first place: `tsc`/the bundler have no way to catch a
Postgres-only bug like "infinite recursion detected in policy," since
neither ever runs the SQL. The fix
(`0002_fix_challenge_participants_recursion.sql`) *was* verified this
way, after the fact — this sandbox has a local Postgres, so it's
possible to stand up a throwaway database with a hand-rolled stand-in for
just the pieces of Supabase our migrations touch (an `auth.users` table,
`auth.uid()` reading a session variable instead of a real JWT,
`authenticated`/`anon` roles) and actually run 0001 against it (reproduced
the exact "infinite recursion detected in policy for relation
'challenge_participants'" error from three separate queries), then 0002
(all three succeeded, and a non-participant still correctly saw zero
rows). That stand-in is deliberately not part of this repo — it's not a
substitute for testing against the genuine Supabase stack (PostgREST,
real JWTs, the actual `auth` schema Supabase ships) — but it's a strictly
stronger check than reasoning about the SQL never running at all, and
it's why this specific fix is trusted more than the rest of the
Supabase-dependent code in this section. Same story for
`src/auth/googleSignIn.ts`: no Google Cloud project or physical device
either, so the only things actually exercised here are the "not
configured" and "web preview" error paths (confirmed via `expo start
--web` — the Google button still resolves through mock auth exactly as
before, and the new native import doesn't break bundling for anyone who
isn't using it). The real native sign-in call, the ID-token exchange, and
`app.json`'s reversed `iosUrlScheme` are unverified beyond "the plugin
generates the Info.plist entry it says it will."

## What's not implemented

The Challenges *list*, a real challenge's *detail* screen, the Home
screen's hero/leaderboard card, Friends' friend graph, and challenge
invites all read real data now (see "The backend (Supabase)", "Friends:
a real friend graph", and "Inviting a friend to a specific challenge"),
but the Hunt screen still renders `src/data/sampleData.ts`'s static
content unconditionally, unrelated to any of it. Neither the Challenges
screen nor Home has any sample-content path left at all — see "The
backend (Supabase)" → "Home's getting-started cards" above. Real
cross-device staleness detection (the kind the old, now-removed "Theo's
Pixel hasn't reported" card gestured at) and the "Nudge" action that
went with it still don't exist — a genuine gap, just no longer papered
over with a fake alert. HealthKit/Health Connect only ever cover *your own*
metrics regardless — a `'steps'`-kind challenge backfills and auto-syncs
*your* device steps (see "Device sync backfills the whole challenge, not
just today"), but every other kind, and every
other participant regardless of kind, still needs `progress_snapshots`
rows written by hand via `ChallengeDetailScreen.tsx`'s manual entry form.
Actually syncing a friend's steps *automatically* into a shared
leaderboard needs their own device writing those rows without them
opening the app and typing a number in, which nothing does yet — every
non-`'steps'` number on a real leaderboard is exactly what someone typed
in, nothing more. Same reason Friends' per-friend sync status is gone
entirely for a real friendship rather than faked: there's no per-friend
device data to show yet. Friends' "Send one link" card and the
"Challenge" button next to a sample friend are also still decorative —
real invites go through the email lookup instead, and there's no
prefilled-Create-flow-from-a-friend shortcut yet.

Facebook sign-in has been confirmed end-to-end against a real Supabase
project — see "Facebook Sign-In" above for the full setup checklist.
Apple sign-in goes through the same generic Supabase OAuth call but
still needs its own provider configured in your Supabase dashboard
(and, for Apple specifically, ideally replaced with the native
`expo-apple-authentication` flow before shipping to the App Store) —
until then, tapping it does nothing but show an error. Google sign-in
is wired natively
(`@react-native-google-signin/google-signin` + `signInWithIdToken`) but
needs three OAuth clients created in Google Cloud Console, one Info.plist
edit in `app.json`, and a native rebuild before it does anything either
— see "The backend (Supabase)" → "Google Sign-In (native)" for the full
checklist either way.
