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
same way. Since 0245 that's a choice: "Swing with" over the button picks
the timing meter (the default, timing only, no countdown) or tapping the
ball, kept on the phone (`useSwingMode` in `baseballSwing.tsx`) and shared
by the at-bat and the Derby (Steve, Nov 2026: tapping felt too hard). The batting screen has three tabs: At bat, On the mound
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

Paw Slots (0242, `SlotsScreen.tsx`) is a machine, not a field: the server
picks where the reels stop (`slots_spin`, random) and pays every line; the
reels only turn to it, so the strips in `challenges/slots.ts` must match
`slots_strip`, in the same order (the order also sets how often 3 and 5
lines win: Steve's 3 in 8, 7 in 9 and 17 in 20). Spins come from steps, a
workout and Paw Coins only; Paw Coins leave only as the pool paid by place
at the end: nothing in it may take Bones or money in.

Long Shot (0247, `LongShotScreen.tsx`) is a range seen from behind your
bench (`LongShotRange.tsx`: the lane from the far berm (y 0) to the bench
(y 1) through `perspective.ts` and `project()`, plates at `plateY()`), with
the gallery beside the firing line, not behind the plates (that's where
the rounds go). The server flies every round (`longshot_fly`, G7 drag) and
sets each day's air and wind (`longshot_conditions`, the same for
everyone); the app draws the flags and the reticle's sway with the same
formulas (`longshotFlagWind`, `longshotSway` in `longshotApi.ts`, mirroring
`longshot_wind_at` and `longshot_sway`), so change them together. Nothing
in it takes money or Bones in.

Bullseye (0249, `BullseyeScreen.tsx`) is archery on the same idea, for
families: a meadow seen from behind the shooting line (`BullseyeField.tsx`,
targets at `targetY()` through `project()`, families beside the line), the
arrow's flight drawn as a slow-motion chase behind it. The server flies
each arrow (`bullseye_fly`: drag a = k v^2, the sight mark from
`bullseye_mark`) and shares Long Shot's wind (`longshot_wind_at`); the app
mirrors `bullseye_sway` and `bullseye_balloon` (`bullseyeApi.ts`), so
change them together.

Hound Chess (0238, `ChessScreen.tsx`) is a board, but drawn like a field:
seen from behind your side through `perspective.ts` and `project()` (the
board on the ground with a small margin, the stand past the far end), the
pieces drawn as hounds standing on their squares and hit-tested before the
square under them. The server holds the rules (`chess_legal`, a PL/pgSQL
engine checked against the standard perft counts in test 128) and sends
the moves you may make; the app never decides what's legal.

## Move points

Move points (0270, `src/move/`) count every kind of movement: 1 point =
1 step's worth, a workout earns its minutes × its activity's rate
(`move_rates`, Admin → Bones → Move points; walking, running and hiking
are 0, their steps count). Everything comes from `workout_history`: a
watch's workouts in full, Log a workout's ('manual') up to
`move_config.hand_cap_min` a day (since 0276 that's also the limit on
logging: `log_workout` refuses what would go past it, and there's no count
limit unless Admin sets `workout_log_config.per_day`; Steve, Nov 2026), and Hound's own timed sessions ('hound':
guided routines and strength logs, timed by `move_session_start` /
`_finish`) in full unless a watch workout covers the same time. Each
workout keeps the activity and rate it was recorded with, so rate changes
apply forward. A workout's own steps come off its points, never below 0
(0277, Steve: they're already in the day's steps): `steps_during`, sent
by the phone from Health for the last 3 days' workouts when Today syncs
them, or a hand log's `phone_steps`. A Most steps challenge with `counts = 'move'` gets the
day's points added server-side (`progress_snapshots.raw_steps` +
`move_pts` = `steps`), so its board, results and prizes need nothing
special. Strength goals (1 to 5 a week) are each person's own.

Movement snacks and Move together (0275, the second batch). A snack is
"250 steps in 10 minutes" (`MoveSnackScreen.tsx`), counted by the phone's
own step counter (`packFunSensors.ts`); the server times it and pays
Bones up to the day's paid snacks (`move_snack_start` / `_finish`). The
nudges are the phone's own notifications, off by default, one in each
window you pick (`snackNudges.ts`, topped up from Today with no server
call). Move together is a guided routine with friends (Start a routine →
With friends): a pack like a pack fast (`move_pack_*`), each member's
timed session linked to it so the lobby (`MoveTogetherScreen.tsx`) and the
strip on the routine show everyone's progress; when two or more have
finished and no one who joined is still going, each who finished gets the
bonus. Invites are in Needs you; pushes are `send-social-push`'s 'move'
kind. All the numbers are Admin's (Bones → Move points).

## Welcome wizard: what you'll use Hound for

The welcome wizard (`src/onboarding/SetupWizardScreen.tsx`) is Connect
Health, About you (name and username, only when missing), "What will you
use Hound for?" (0272), Jump in, notifications and Meet your hound. The
checkboxes (`src/onboarding/UsesStep.tsx`: Steps, Intermittent fasting,
Workouts, Activities with no watch, Strength training with its days a
week, Water, Games with friends) save in `profiles.hound_uses` and set
each part up on "Set up": a step goal if missing, a workout goal (3 a
week), Move's strength goal, a water goal; Intermittent fasting puts the
Fasting tile on Today (Fasting asks the age question on the first open).
Settings has the same checkboxes, and Discover ranks by them
(`interestsFromUses` in `myUses.ts`; K-08's interests folded in). When a
new part of Hound ships, add it here: a checkbox, what ticking it sets up,
and its tried / now numbers in `admin_uses_overview` (Admin → Overview →
Status → What people use Hound for).

## Widgets and the Watch

Phone widgets (`src/widgets/`, iPhone layouts in `ios/layouts.tsx`
through expo-widgets, Android in `android/`): Hound (your hound and
goals; the medium iPhone one and the wide Android one have "Log activity",
`hound://move/log`, which opens Move's Log an activity) and Hound steps
(Lock Screen). A widget's layout changes over the air; a new widget, or
anything in `targets/` (the Apple Watch app, 0189, and its complications),
needs a new native build. The app hands widgets everything
(`updateWidgets`). Widget links go through `useChallengeCodeLinks`
(`codeLinks.ts`), which notes each tap (`note_widget_tap`, 0274). Each
watch call is `watch_*` acting as its person (`watch_act_as`). Admin →
Overview → Status → Apple Watch & widgets has the numbers.

Waiting for the next native build (Steve, Nov 2026: not yet), on the
branch `next-build-watch-fasting`: the Hound fasting widget (iPhone home
and Lock Screen, Android), the watch's Fasting and Log activity pages and
its Hound fasting complication, and the version bump. Their server side
(`watch_fasting_start` / `_end`, `watch_log_activity`, fasting in
`watch_today`, 0274) is already in. Rebase that branch onto master and
bring it in with the next build.

## Offline mode

Offline mode (0271, `src/offline/`, Admin → Overview → Status → Offline
mode, off by default) keeps Hound working with no connection. A blip
must not count (Steve): `network.ts` only calls it offline after the
server hasn't answered three checks over ~10 seconds, and comes back on
the first answer. Actions that can wait (a routine or strength log timed
on the phone, Log a workout, a fast's start and end, water) go through
`runOrQueue` in `outbox.ts`: done now if possible, else kept on the
phone in order and sent through `offline_apply`, which applies each
client id once and answers a rule's refusal as `{error}` (shown on the
strip, kept for Admin). Reads that matter offline go through
`cachedRead` in `cache.ts` (last-known copy, "last updated" on the
strip). Since the second batch the Challenges tab, a challenge's page,
Friends and the Kennel read through it too (your challenges, a
challenge's details, people, board and bots, friends, your hound and its
yard); a challenge's game extras fall back to empty offline (`offlineOr`
in `cache.ts`) instead of failing the page. Once the phone is known to
be offline, `cachedRead` and `offlineOr` don't try the network at all
(each try waited on the sign-in refresh's retries: 10 seconds a screen).
A game card's own read that has a board (the Shootout, the Derby, the
Open) keeps a copy too, and a card's load error says "No connection" in
plain words (`errorText`). A new action that should work offline joins `offline_apply`'s
ops and uses `runOrQueue`. With offline mode on, the "Hound can't reach its
server" screen (MaintenanceGate) lets people in instead of blocking
(planned maintenance still blocks), and sign-in uses the profile kept on
the phone (`auth/userCache.ts`) when it can't read it or refresh the
session; signing out forgets it.

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

Above the scrolling grid, outside it: the offline strip (OfflineStrip,
0271, only with offline mode on in Admin: no connection, things waiting
to sync, or one that couldn't), then "A new version of Hound is
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
   - Goals, full width across the top (rings or hound trails). Once
     you've started a fast it swipes sideways to the Fasting card (Steve,
     Nov 2026; `src/home/TodayFastingCard.tsx`): the ring with the clock,
     the stage, what's left to your goal and the next stage (or the phase
     game that's open, 0269), or between fasts your plan, the week and
     your last fast; along its bottom the numbers at a glance (streak,
     this week, Fast Points, longest). It's the Goals tile's height
     (Steve: 90% of people see this, no white space), so no game slots
     here; they're on the Fasting screen. Dots under it; the
     phone remembers which was showing (`useTodayTopCard` in
     `home/todayPrefs.ts`), and tapping it opens Fasting.
   - Needs you, full width, while anything is waiting (Steve's pick,
     Nov 2026; `src/home/NeedsYouTile.tsx`): the top two game actions,
     each with its own button that opens the game's own screen (the
     ring, the court, the plate; `src/home/needsYouActions.ts`), ranked
     what goes away tonight first, then turns someone's waiting on, the
     pinned challenge first among equals; then "+N more: ..." for the
     rest (invites, friend requests, Bone Dig...), which opens the sheet.
     With nothing waiting it's a small "All caught up" tile in the pairs
     below. Its bell-off button mutes it for 2 hours, 4 hours, half a day
     or till morning (Steve, Nov 2026; this phone only, `home/needsYouMute.ts`,
     logged for Admin by 0240): while muted it's the small tile ("Muted",
     how many are waiting, when it's back) and the sheet has Unmute.
     Pushes aren't muted.
   - Then two to a row, an odd last one spanning the row as a slim
     strip (its number with its lines beside it, not a half tile's
     height stretched across; Steve, Nov 2026): your hound
     (when the Kennel has loaded), Needs you (only when caught up or muted), Your
     challenges, Fasting (once you've started a fast, 0261, or before a
     first fast if you ticked Intermittent fasting in the welcome wizard,
     0272: the live clock while fasting, else Start; left out while the
     Fasting card is showing across the top), and either Week in review (Monday
     until Tuesday noon, local) or today's Step rank (the rest of the week).
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
  a watch; logged ones marked "Logged by hand", with Undo for 15 minutes,
  Hound's timed ones "✓ Timed in Hound"). Since 0270 the button reads "Log a
  workout / activity" and opens Move (log an activity, start a routine,
  log strength).
- Your hound: no sheet; the tile opens the Kennel straight away.
- Needs you: Pack Activities first, only when one is waiting on you (on
  now or coming up, with Join; Steve's ask, Nov 2026). No "Start a Pack
  Activity" here: that's on the Clubs tab and a club's page. Then
  invites and friend requests, pack fast invites (0261), then club games you can still join (posted
  to one of your clubs; Join or Not now, 0252), then Bone Dig, nudges and
  bounties. The tile's "N
  waiting" counts all of them (a Pack Activity when you're invited, it's
  your club's, or it's live).
- Your challenges: the pinned (highlighted) challenge's headline and
  its game's own view (every kind has one: the court, the track, the
  map, the doors...; `src/home/PinnedViews.tsx` and the *Preview cards
  in HomeScreen), with one button for what you can do now; then one
  line per other active challenge, then "All challenges". The card
  doesn't repeat the headline.
- Fasting: no sheet; the tile opens the Fasting screen. Before a first
  fast the way in is "Try intermittent fasting" at the bottom of the Goals
  sheet (hidden for anyone who said they're under 16).
- Week in review: last week's recap.

Pop-ups (a stop reached on a Journey, a level up, the daily bonus, an
achievement, a new record, the username ask) are gated to one per
open; the rest become toasts, at most four queued. A level up that
reaches a new rank plays its moon form's cut scene first (0264,
`kennel/MoonScene.tsx`), then the level-up card, as one pop-up; ranks
reached before the scenes shipped get a one-time "Your hound has changed
under the moon" (MoonCatchupModal), also one pop-up. Every scene can be
watched again from the Kennel's Moon forms.
