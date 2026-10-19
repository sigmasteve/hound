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

## Today screen order

Steve's agreed order for Today (`mobile/src/screens/HomeScreen.tsx`).
Keep it when adding or moving cards, and ask before changing a fixed
spot:

1. Goals card (or goal setup while it's open)
2. Kennel card
3. Global Hound Challenges, for ones not started yet. **Fixed: always
   directly under the Kennel card.**
4. Bone Dig, then Bounties
5. Needs you
6. Your challenges
7. Your week in review (Monday to Wednesday). **Fixed: always right
   above the pinned challenge and its heading.**
8. The pinned (highlighted) challenge: its heading, then its card
9. Nudges, the notifications ask, and Finish setting up
