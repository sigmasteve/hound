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
  TestFlight, and the new APK uploaded over the Google Drive file behind
  the website's download link.
- Remove it once most testers have moved (Admin → App versions), or when
  the next version comes out.

The rest of the release steps are in `mobile/supabase/STAGING.md` (build
profiles: Android testers get `npm run build:android:apk`, not
`--profile preview`) and issue #288.
