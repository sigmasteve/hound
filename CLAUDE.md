# Notes for Claude

## New app builds

Whenever a new native build is planned or made (a version bump in
`mobile/app.json`, or any `eas build` for the App Store or the Android APK),
remind Steve to set the **Home banner** (Admin → Home banner) so people on
older versions see where to get the new one. Template, with the new
version in place of `X.Y.Z`:

```
{if version=X.Y.Z}{else}Hound X.Y.Z is here. iPhone: update in the App Store at https://apps.apple.com/app/id6816764199 · Android: update on Google Play at https://play.google.com/store/apps/details?id=app.hound.mobile{/if}
```

- The banner matches versions exactly, so this shows to every version
  except the new one.
- Turn it on only once the builds are installable: released on the
  App Store (approved by Apple and released, not just uploaded), and
  released to production on Google Play (live since Nov 2026; the app is
  `app.hound.mobile`). The website's APK (`/downloads/hound.apk` in
  `site/vercel.json`, a Google Drive file) is now only the fallback under
  "Can't use Google Play?" on /get: update its Drive id and the version on
  `site/download.html`'s button when there's a new one.
- Remove it once most people have moved (Admin → App versions), or when
  the next version comes out.

While a new version is on its way, list the old one in
`mobile/scripts/also-publish.txt` so `npm run update:production` keeps
reaching it, and once the new one is out, Admin → App versions →
Minimum version moves everyone onto it ("A new native build, and moving
everyone onto it" in STAGING.md).

The rest of the release steps are in `mobile/supabase/STAGING.md` (build
profiles: Android testers get `npm run build:android:apk`, not
`--profile preview`) and issue #288.

## New features: engagement data on Admin

Every new feature ships with engagement numbers on the Admin screen
(Steve's standing ask): how many people have tried it, how many use it
now, and how. Build it in the same PR as the feature:

- An admin-only read on the server (`admin_<feature>_overview()`,
  security definer, checking `profiles.is_admin`, with pgTAP tests),
  like `admin_goals_overview` (0098) and `admin_water_overview` (0154).
- A fold on Admin → Overview with a one-line summary that shows without
  opening it (e.g. "12 with a water goal"), and a card inside with the
  detail, like `GoalsAdminCard` and `WaterAdminCard`. Overview has
  subtabs; put the fold in the one it belongs to: Status (Needs you,
  engagement, versions, maintenance, pushes, the Watch, holiday themes),
  Games (challenges, the games, sports bonuses, sponsors), Fitness (goals,
  water, logged workouts, Pack Activities, clubs) or Hound (the Kennel's
  walks, garden, growth, care, the house, together, dog photos, the shop).

## Maintenance

Before Steve changes the server (a compute upgrade, a restart): Admin →
Maintenance schedules the window (0190), and when he asks for
"maintenance on", open a PR setting `site/status.json` to
`{"maintenance": true, "message": "...", "until": "<UTC time it should be back>"}`,
then another setting it back to `{"maintenance": false}` afterwards. See
`site/README.md`.

## Pull requests

Steve merges fast, often before the next message. So, every time:

- **Before pushing anything to an existing branch, check its PR.** If
  the PR is merged or closed, do not push there: branch fresh from
  `origin/master`, cherry-pick the new commits onto it, and open a new
  PR. (`gh api "repos/sigmasteve/hound/pulls?head=sigmasteve:<branch>&state=all"`.)
- **Before opening a PR, check the branch merges cleanly** into
  `origin/master` (`git merge-tree --write-tree origin/master <branch>`).
- One PR per batch of work; a new batch starts from a fresh branch off
  `origin/master`, never on top of merged history.
- Keys and credentials never go in the repo or in chat. App Store
  Connect keys live in `ASC_ISSUER_ID`, `ASC_KEY_ID`, `ASC_PRIVATE_KEY`;
  the Play service account in `GPLAY_SERVICE_ACCOUNT_JSON`.

## Sports fields are 2.5D

Every sport's field is drawn in perspective, like Soccer's pitch and
Baseball's ballpark: seen from behind the near end, the far end narrower,
a stand of fans behind it, players with shadows that shrink with
distance, and the real ball (SoccerBall, not a dot). Use
`mobile/src/components/perspective.ts`: draw on the ground in shares of
its width and length and put every point (lines, players, the ball,
replays) through `project()`, so they all line up. New sports start this
way; mock it up first.

The one exception is Hoops: its full court is seen from the sideline,
like a TV broadcast (Steve's pick, Nov 2026), so a replay can run the
length of the floor. It's still `perspective.ts` and `project()`, with
x along the court and the stand behind the far sideline
(`HoopsCourt.tsx`).
Taking your own shots (0206, `HoopsShootScreen.tsx`) is the other way
round: seen from behind the shooter, facing the basket, still through
`perspective.ts` and `project()` (y from the baseline out to 32 ft). The
replays of those shots stay on the sideline court.

Baseball's batting screen (0207, `BaseballBatScreen.tsx`) is seen from
behind home plate, facing the mound: the Baseball card's ground (560 ×
400, home at the bottom middle) in a steeper perspective, so the plate
and your hound with the bat are big and the outfield and the stand
small. Every point still goes through `project()`.

H-O-R-S-E's own shots (0209, `HorseShootScreen.tsx`) are on the half
court seen from above half court, looking at the basket: u across (−1..1,
`0.5 + u/2` on the ground) and v from the baseline (0) to half court (1),
through `project()`, with the stand and the scoreboard (both players'
letters) behind the basket, the bench on the right sideline and the day's
chair in the lane. The parking lot and the rooftop have their own outside
scene (the street, a HOUND billboard, the gym's lit window). The court
never scrolls away: only the options under it scroll, and the meter and
Shoot stay pinned (Steve's ask).

Since 0231 batting is for real: the pitch crosses somewhere (px, py in
half-widths of the zone; `components/baseballSwing.tsx`) and you tap where
it crosses as it gets there, after a quick 3-2-1 (the Pitch button is
pinned at the bottom, so the countdown says look up). The Derby swings the
same way. The batting screen has three tabs: At bat, On the mound
(`BaseballMound.tsx`: seen from behind the mound facing home, its own
ground from the backstop (y 0) to the mound (y 1) through `project()`,
the zone and everyone at the plate sized to the zone so a thumb can aim)
and Steal (`BaseballSteal.tsx`: the batting view, you leading off first).

The Home Run Derby's at-bat (0211, `DerbyBatScreen.tsx`) reuses Baseball
batting's view and drawing (`FieldArt`, `Batter`, `Figure` and `P()`,
exported from `BaseballBatScreen.tsx`): behind home plate, facing the
mound, with the distance markers (330 / 375 / 410) and the sponsor's sign
on the center-field wall, and the outfielders playing deep. Like
H-O-R-S-E, the ballpark never scrolls away: only the message and today's
swings under it scroll, and the bar and Pitch / Swing! stay pinned.

A Most steps challenge is a race too (0233, `StepRace.tsx`): a straight
track seen from behind the start, one lane each, the finish under the
stand, through `perspective.ts` and `project()`. Its story (yesterday's
replay, the daily rival, bounties, checkpoints, the Blackout and the
finish) is worked out in the app from daily steps (`stepStory.ts`,
`StepStoryPanel.tsx`); the Distance pool's trail is `PoolTrail.tsx`.

Cricket by hand (0234, `CricketPlayScreen.tsx`) is seen from behind the
bowler, facing the batter: the pitch down the middle of its own ground
(x = 0.5 + line × 0.1, y from the bowler's end to the batter's) through
`project()`, with the sight screen and the stand behind the batter. It
reuses Baseball's `Batter` and `Figure`, and the 3-2-1 and tap marks from
`baseballSwing.tsx`. The match card's ground (`CricketGround`) stays
behind the batter.

Hound Roulette's wheel (0236, `RouletteScreen.tsx`) is a flat wheel, not
a field: the server picks the slot (`roulette_segment`, seeded) and the
wheel only turns to it, so the slots' order in `challenges/roulette.ts`
must match the server's. Points come only from doing tasks and leave only
as Bones and the Lucky Bandana at the end: nothing in it may take Bones or
money in (Steve, Nov 2026: playful, not gambling).

## Actions are on screen without scrolling

Steve's rule (Nov 2026): every action a user can take is seen when the
screen opens, without scrolling. On a challenge page, a game card with
something ready for you (Take your shots, your at-bats, your H-O-R-S-E
turn, your hole, the Derby) hands it to the page through
`usePinnedAction` (`mobile/src/components/PinnedAction.tsx`), which pins
it to the bottom; the card then leaves its own copy out. New games do the
same, and other screens keep their main action in view (pinned, or above
anything that scrolls).

## Today screen layout

Steve's agreed layout for Today (`mobile/src/screens/HomeScreen.tsx`,
tiles in `mobile/src/home/TodayTiles.tsx`). Keep it when adding or
moving anything, and ask before changing a fixed spot. Today is a grid
of tiles, each opening a sheet with the full cards; testers found the
old stack of cards too much at once.

Above the scrolling grid, outside it: "A new version of Hound is
ready" (UpdateReadyBanner), then the maintenance heads-up while an Admin
window is near (MaintenanceHeadsUp, 0190), then "Hound can't see your
steps" when Health has shown 0 steps for three days and today
(HealthZeroBanner, 0205; Fix it says how, x hides it until tomorrow), then
the announcement banner.

Inside the scroll, in order:

0. A holiday theme's countdown pill and garland, only while one is
   scheduled (Admin → Holiday themes, 0184). Decoration only: the tiles
   get a trim (snow, marigolds) and the Goals tile a corner piece, and
   snow / leaves / confetti drift over Today (off in Settings → Today,
   still with Reduce Motion).
1. For a new account, "You're in" (YoureInCard, 0222): the Global
   challenges it was put in (up to 3, once, on the first open after the
   welcome wizard), each with what to do now and Leave / Undo, until
   Got it. Then Global Hound Challenges you can still join
   (GlobalChallengesCard). **Fixed: above the tiles, so they're seen
   without opening anything.**
2. Goal setup, while it's open (GoalSetupCard); it takes the goals
   tile's place.
3. The tile grid:
   - Goals, full width across the top (rings or hound trails).
   - Needs you, full width, while anything is waiting (Steve's pick,
     Nov 2026; `src/home/NeedsYouTile.tsx`): the top two game actions,
     each with its own button that opens the game's own screen (the
     ring, the court, the plate; `src/home/needsYouActions.ts`), ranked
     what goes away tonight first, then turns someone's waiting on, the
     pinned challenge first among equals; then "+N more: ..." for the
     rest (invites, friend requests, Bone Dig...), which opens the sheet.
     With nothing waiting it's a small "All caught up" tile in the pairs
     below.
   - Then two to a row, an odd last one spanning the row as a slim
     strip (its number with its lines beside it, not a half tile's
     height stretched across; Steve, Nov 2026): your hound
     (when the Kennel has loaded), Needs you (only when caught up), Your
     challenges, and either Week in review (Monday to Wednesday) or
     today's Step rank (the rest of the week).
   - Journey, full width, when you're on one.
4. The notifications ask (PushAskCard), once you have a friend or a
   challenge.
5. Finish setting up (GetStartedCard), until the reward is claimed or
   it's dismissed.

What each sheet holds:

- Goals: the goals card with the streak, and under the streak the last
  seven days (tap one to see that day's numbers in the card); "Earlier"
  swaps the card for the four-week grid (GoalHistoryCard). All of it is
  scored on the phone from Health data (`src/home/GoalsSheet.tsx`). Under
  the card, today's workouts and "Log a workout" (0204, for people without
  a watch; logged ones marked "Logged by hand", with Undo for 15 minutes).
- Your hound: no sheet; the tile opens the Kennel straight away.
- Needs you: Pack Activities first, only when one is waiting on you (on
  now or coming up, with Join; Steve's ask, Nov 2026). No "Start a Pack
  Activity" here: that's on the Clubs tab and a club's page. Then
  invites and friend requests, then Bone Dig, nudges and bounties. The tile's "N
  waiting" counts all of them (a Pack Activity when you're invited, it's
  your club's, or it's live).
- Your challenges: the pinned (highlighted) challenge's headline and
  its game's own view (every kind has one: the court, the track, the
  map, the doors...; `src/home/PinnedViews.tsx` and the *Preview cards
  in HomeScreen), with one button for what you can do now; then one
  line per other active challenge, then "All challenges". The card
  doesn't repeat the headline.
- Week in review: last week's recap.

Pop-ups (a stop reached on a Journey, a level up, the daily bonus, an
achievement, a new record, the username ask) are gated to one per
open; the rest become toasts, at most four queued.
