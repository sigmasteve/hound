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

### Bot opponents

Creating a challenge (`CreateScreen`'s "Bring friends" step) offers 4
preset bots — Casey (Casual), Micah (Active), Reese (Athletic), Blaze
(Elite) — for when there aren't enough real friends around to make a
challenge interesting. A bot never signs in and is never a real
`profiles`/`auth.users` row; it's just a name + fitness level saved to
`challenge_bots`. Its steps are never written anywhere — there's no job
simulating a bot one day at a time — instead `src/challenges/botSimulation.ts`
deterministically recomputes its whole trajectory on every read, seeded
from the bot's own row id and the number of days elapsed, so it shows the
same numbers on every screen and every reload without a backend to keep
in sync.

### Hunter & Hunted: real scoring and roles

CreateScreen's "Set the rules" step for a hunt has a real, functional
"What counts" picker now (it used to be two `RadioPill`s that never did
anything): **GPS distance from runs & walks**, **any logged workout**, or
**device step count**, saved as `challenges.scoring_method`. A hunt also
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
step count would otherwise read 0 and rank arbitrarily. The head-start
slider in "Set the rules" is still purely decorative — it was before
this pass too, and wiring it (delaying when the Hunted's log starts
counting) is a separate follow-up.

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
enabled in Supabase?") rather than crashing. Apple in particular: App
Store review expects native Sign in with Apple
(`expo-apple-authentication`) rather than the generic web-OAuth flow used
here — that's a follow-up, not done in this pass (see "What's not
implemented"). **Google uses a different, better path** — see "Google
Sign-In (native)" below.

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
Supabase unconfigured, the screen quietly stays on the sample fallback,
same as `src/health`'s pattern.

Tapping a real challenge card opens `ChallengeDetailScreen.tsx` — a
generic detail view (not tied to any one challenge kind, unlike Hunt)
showing the full participant list ranked by steps, defaulting to 0 for
anyone who hasn't logged anything. A `'steps'`-kind challenge is the one
case with an unambiguous real number to draw from (today's device step
count), so it auto-syncs from `useHealthProvider()` — once when the
screen loads and again on demand via its own "Sync now" — straight into
`recordProgress()`, no typing required; every other kind still uses the
manual "log your progress" form (there's no automatic sync from
HealthKit/Health Connect for those yet — see "What's not implemented").
Sample cards never open
this screen (`ChallengeCard.target` distinguishes 'hunt' / 'detail' /
not-tappable — see its comment in `sampleData.ts`), since they have no
real row behind them to fetch. The Hunt screen and the two static blocks
on the Challenges screen (the "Priya invited you…" card, the "Finished"
section) remain fully static regardless of any of this.

Whoever created a real challenge sees a "Delete challenge" action at the
bottom of its detail screen — anyone else in it doesn't (there's nothing
stopping a participant from leaving one they didn't create; that's a
separate, not-yet-built feature). Confirmed via a native `Alert.alert()`
before it actually deletes anything. `challenges.delete` is the only new
RLS policy this needs (`0005_challenges_delete_policy.sql`) — every child
table (`challenge_participants`, `challenge_bots`, `progress_snapshots`)
already references `challenges` with `on delete cascade`, so deleting the
one row removes everyone's participation and progress in it too.

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

1. `npm install -g eas-cli` (or just use `npx eas` — `eas-cli` is already
   a devDependency here, pinned in `package.json`).
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

The Challenges *list*, a real challenge's *detail* screen, and the Home
screen's hero/leaderboard card all read real data now (see "The backend
(Supabase)"), but the Hunt screen and Friends screen still render
`src/data/sampleData.ts`'s static content unconditionally, and are
unrelated to either. The Challenges screen's "Priya invited you…" card
and "Finished" section, and Home's "Theo's Pixel hasn't reported" card,
are also still static, on either data path — that one specifically needs
real cross-device staleness detection that doesn't exist yet, so it (and
the "Nudge" action that went with it) only shows up alongside the rest of
the sample content, never next to a real challenge. HealthKit/Health Connect only ever cover *your own*
metrics regardless — a `'steps'`-kind challenge auto-syncs *your* device
steps (see "The backend (Supabase)"), but every other kind, and every
other participant regardless of kind, still needs `progress_snapshots`
rows written by hand via `ChallengeDetailScreen.tsx`'s manual entry form.
Actually syncing a friend's steps *automatically* into a shared
leaderboard needs their own device writing those rows without them
opening the app and typing a number in, which nothing does yet — every
non-`'steps'` number on a real leaderboard is exactly what someone typed
in, nothing more.

Facebook/Apple sign-in is wired to real Supabase OAuth calls but needs
each provider configured in your Supabase dashboard (and, for Apple,
ideally replaced with the native `expo-apple-authentication` flow before
shipping to the App Store) before tapping those buttons does anything
but show an error. Google sign-in is wired natively
(`@react-native-google-signin/google-signin` + `signInWithIdToken`) but
needs three OAuth clients created in Google Cloud Console, one Info.plist
edit in `app.json`, and a native rebuild before it does anything either
— see "The backend (Supabase)" → "Google Sign-In (native)" for the full
checklist either way.
