# Notes for Claude

## New app builds

Whenever a new native build is planned or made (a version bump in
`mobile/app.json`, or any `eas build` for TestFlight or the Android APK),
remind Steve to set the **Home banner** (Admin → Home banner) so people on
older versions see where to get the new one. Template, with the new
version in place of `X.Y.Z`:

```
{if version=X.Y.Z}{else}Hound X.Y.Z is here. iPhone: update in TestFlight at https://testflight.apple.com/join/1UAWscQs · Android: download it at https://houndchallenge.net/get{/if}
```

- The banner matches versions exactly, so this shows to every version
  except the new one.
- Turn it on only once the builds are installable: available in
  TestFlight, and the new APK live behind the website's download link
  (`/downloads/hound.apk` in `site/vercel.json` points at the Google
  Drive file; update its id if the APK is a new Drive file, and the
  version on `site/download.html`'s button).
- Remove it once most testers have moved (Admin → App versions), or when
  the next version comes out.

The rest of the release steps are in `mobile/supabase/STAGING.md` (build
profiles: Android testers get `npm run build:android:apk`, not
`--profile preview`) and issue #288.

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

## Today screen layout

Steve's agreed layout for Today (`mobile/src/screens/HomeScreen.tsx`,
tiles in `mobile/src/home/TodayTiles.tsx`). Keep it when adding or
moving anything, and ask before changing a fixed spot. Today is a grid
of tiles, each opening a sheet with the full cards; testers found the
old stack of cards too much at once.

Above the scrolling grid, outside it: "A new version of Hound is
ready" (UpdateReadyBanner), then the announcement banner.

Inside the scroll, in order:

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
- Your hound: the Kennel card.
- Needs you: invites and friend requests, then Bone Dig, nudges and
  bounties. The tile's "N waiting" counts all of them.
- Your challenges: the pinned (highlighted) challenge's headline and
  board, then one line per other active challenge, then "All
  challenges".
- Week in review: last week's recap.

Pop-ups (a stop reached on a Journey, a level up, the daily bonus, an
achievement, a new record, the username ask) are gated to one per
open; the rest become toasts, at most four queued.
