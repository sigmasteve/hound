# Notes for Claude

## New app builds

Whenever a new native build is planned or made (a version bump in
`mobile/app.json`, or any `eas build` for the App Store or the Android APK),
remind Steve to set the **Home banner** (Admin → Home banner) so people on
older versions see where to get the new one. Template, with the new
version in place of `X.Y.Z`:

```
{if version=X.Y.Z}{else}Hound X.Y.Z is here. iPhone: update in the App Store at https://apps.apple.com/app/id6816764199 · Android: download it at https://houndchallenge.net/get{/if}
```

- The banner matches versions exactly, so this shows to every version
  except the new one.
- Turn it on only once the builds are installable: released on the
  App Store (approved by Apple and released, not just uploaded), and the
  new APK live behind the website's download link
  (`/downloads/hound.apk` in `site/vercel.json` points at the Google
  Drive file; update its id if the APK is a new Drive file, and the
  version on `site/download.html`'s button).
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
  detail, like `GoalsAdminCard` and `WaterAdminCard`.

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

## Today screen layout

Steve's agreed layout for Today (`mobile/src/screens/HomeScreen.tsx`,
tiles in `mobile/src/home/TodayTiles.tsx`). Keep it when adding or
moving anything, and ask before changing a fixed spot. Today is a grid
of tiles, each opening a sheet with the full cards; testers found the
old stack of cards too much at once.

Above the scrolling grid, outside it: "A new version of Hound is
ready" (UpdateReadyBanner), then the maintenance heads-up while an Admin
window is near (MaintenanceHeadsUp, 0190), then the announcement banner.

Inside the scroll, in order:

0. A holiday theme's countdown pill and garland, only while one is
   scheduled (Admin → Holiday themes, 0184). Decoration only: the tiles
   get a trim (snow, marigolds) and the Goals tile a corner piece, and
   snow / leaves / confetti drift over Today (off in Settings → Today,
   still with Reduce Motion).
1. Global Hound Challenges you can still join (GlobalChallengesCard).
   **Fixed: above the tiles, so it's seen without opening anything.**
2. Goal setup, while it's open (GoalSetupCard); it takes the goals
   tile's place.
3. The tile grid:
   - Goals, full width across the top (rings or hound trails).
   - Then two to a row, an odd last one spanning the row: your hound
     (when the Kennel has loaded), Needs you, Your challenges, and
     either Week in review (Monday to Wednesday) or today's Step rank
     (the rest of the week).
   - Journey, full width, when you're on one.
4. The notifications ask (PushAskCard), once you have a friend or a
   challenge.
5. Finish setting up (GetStartedCard), until the reward is claimed or
   it's dismissed.

What each sheet holds:

- Goals: the goals card with the streak, and under the streak the last
  seven days (tap one to see that day's numbers in the card); "Earlier"
  swaps the card for the four-week grid (GoalHistoryCard). All of it is
  scored on the phone from Health data (`src/home/GoalsSheet.tsx`).
- Your hound: no sheet; the tile opens the Kennel straight away.
- Needs you: Pack Activities first (on now or coming up, with Join,
  and Start a Pack Activity; Steve's ask, Nov 2026), then invites and
  friend requests, then Bone Dig, nudges and bounties. The tile's "N
  waiting" counts all of them (a Pack Activity when you're invited, it's
  your club's, or it's live).
- Your challenges: the pinned (highlighted) challenge's headline and
  board, then one line per other active challenge, then "All
  challenges".
- Week in review: last week's recap.

Pop-ups (a stop reached on a Journey, a level up, the daily bonus, an
achievement, a new record, the username ask) are gated to one per
open; the rest become toasts, at most four queued.
