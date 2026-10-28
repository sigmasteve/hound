# Google Play listing: Hound: Fitness with Friends

The text and answers for the Play Console, kept here so they are
versioned, alongside the App Store kit in `../app-store/`. Lengths are
Google's limits. Graphics: `play-assets.py` writes the 512 icon and the
feature graphic into `out/`; phone screenshots come from
`../app-store/frame.py` as `play-N.png` (same raws, Play's size).

## Create app

- **App name** (30): `Hound: Fitness with Friends`
- Default language English (United States) · App · Free
- Package name, from the first upload: `app.hound.mobile`
- Developer name shown on Play: Hound Challenge

## Store settings

- **Category:** Health & Fitness · **Tags:** Fitness, Social
- **Contact email:** [CONTACT EMAIL] · **Website:** https://houndchallenge.net
- **External marketing:** on

## Main store listing

### Short description (80)

Step races, Bingo and Journeys on real steps, with friends and a hound.

### Full description (4,000)

Hound turns your steps and workouts into games with your friends. Every
step counts automatically from Health Connect, so there is nothing to
log: just move, and your hound cheers you on.

PICK YOUR GAME
Ten ways to compete, all on real steps, miles and workouts.
• Step Race: most steps wins.
• Chase: the Chaser has to catch everyone before time runs out.
• Game of Tag: catch someone ahead of you, or stay It.
• Tic-Tac-Go: claim squares, three in a row wins.
• Bingo: real bingo with steps and workouts. First line wins.
• Journey: walk a famous course with your own miles, from the Golden Gate
  Bridge to the Appalachian Trail, with a postcard at every stop.
• Daily Streak: hit your goal every day.
• Group Distance Target: the group chases one shared total, or walks a
  course together.
• 75 Day Challenge: a daily checklist for 75 days.
• Accountability: your own daily checklist, kept with friends.

TALK TRASH
Every challenge has a trash-talk wall with ready-made taunts that use the
real standings. Nudge a friend who is slacking, react to their progress,
and cheer each other on. You can mute anyone and report any message.

HIT YOUR GOALS
Set goals for steps, miles and workouts and watch them fill as your phone
syncs. Keep your streak alive, collect a daily bonus, and get a nudge
from your hound when you are behind: choose Gentle, Playful, or Roast me
if you can take it.

RAISE A HOUND
Every goal day and finished challenge earns Bones and XP. Spend Bones in
the Kennel on hats, crowns, glasses and coats. Your hound grows with your
level, from Pup to Tracker, Hunter, Alpha and Legend, and can be your
avatar everywhere in the app.

SEE IT AT A GLANCE
Your goals, steps and hound on a home screen widget. Share story-ready
cards of your week, your goals and your wins, with a code that lets
friends add you in one scan.

PLAY WITH ANYONE
Add friends by name, code or QR, or join Global Hound Challenges open to
everyone on Hound. Friends on iPhone play the same games through Apple
Health.

Hound reads your activity from Health Connect and never writes to it.
Bones can be earned by playing or bought in packs; they have no cash
value and only buy things inside the app. Watching an ad for Bones is
always your choice.

Privacy policy: https://houndchallenge.net/privacy
Terms: https://houndchallenge.net/terms

### Graphics

| Asset | Size | From |
|---|---|---|
| App icon | 512 × 512 PNG | `out/icon-512.png` |
| Feature graphic | 1024 × 500 PNG | `out/feature-graphic.png` |
| Phone screenshots | 1080 × 2160, 2 to 8 | `../app-store/screenshots/out/play-1.png` … `play-6.png` |
| 7" and 10" tablet screenshots | optional | skip for now; Play only needs them to feature the app on tablets |

The six screenshots and their captions are the App Store's (see
`../app-store/listing.md`); `frame.py` writes the Play size from the
same raws.

### Release notes (500 per language)

First release on Google Play. Ten games on real steps and workouts, a
hound that grows with you, Journeys along famous courses with a postcard
at every stop, a home screen widget, and a trash-talk wall for every
challenge.

## Dashboard: "Set up your app"

### Privacy policy

https://houndchallenge.net/privacy

### App access

*All or some functionality is restricted*: sign-in is required. Add one
instruction set:

- Name: Reviewer account
- Username / password: [a dedicated test account's email and password;
  not the admin account]
- Any other information: "Sign in with the email option. The account has
  friends, challenges of several kinds and a Journey in progress, so
  every screen has data. Health Connect is optional; without it the
  progress can be typed in on a challenge."

### Ads

**Yes, my app contains ads.** Google AdMob, rewarded ads only, shown only
when the user taps "Watch an ad" for Bones; non-personalized.

### Content rating

Fill the IARC questionnaire as: Category *Utility, Productivity,
Communication, or Other*. Violence, sexuality, language, controlled
substances: none. **User interaction: yes, users can interact** (the
trash-talk wall; messages are limited to a challenge's members, any
message can be reported and any member muted). **Shares location: no.**
**Digital purchases: yes.** Expect Everyone or Teen.

### Target audience and content

Age groups: **13-15, 16-17, 18 and over**. Hound's terms require 13+. Not
designed for children; no, the app does not appeal to children. Store
presence: no ads of a kind that would be inappropriate for 13+.

### News apps

No.

### Data safety

Does the app collect or share user data: **Yes.** Data encrypted in
transit: **Yes.** Users can request deletion: **Yes**, in the app (You →
Settings → Delete account) and at https://houndchallenge.net/delete-account.

| Data type | Collected | Shared | Required | Purpose | Processed ephemerally |
|---|---|---|---|---|---|
| Personal info: Name | yes | no | yes | App functionality, account management | no |
| Personal info: Email address | yes | no | yes | App functionality, account management | no |
| Personal info: User IDs | yes | no | yes | App functionality, account management | no |
| Health and fitness: Fitness info (steps, distance, workouts, heart rate, weight, via Health Connect) | yes | no | no (optional) | App functionality | no |
| Messages: Other in-app messages (trash-talk wall) | yes | no | no | App functionality | no |
| Photos: none | | | | | |
| Financial info: Purchase history (Bones packs) | yes | no | no | App functionality | no |
| App activity: App interactions | yes | no | yes | Analytics, app functionality | no |
| App activity: Other user-generated content (hound name, username) | yes | no | yes | App functionality | no |
| App info and performance: Crash logs | yes | no | yes | Analytics | no |
| Device or other IDs: Device or other IDs (advertising ID, for AdMob) | yes | **yes, with Google AdMob** | no | Advertising or marketing | no |

Fitness data is read from Health Connect only, never written, and never
shared or sold. Nothing is used for third-party advertising except the
advertising ID AdMob uses to serve and count non-personalized ads.

### Government apps, Financial features

No, and none.

### Health apps (Health Connect declaration)

Hound requests five Health Connect read permissions. Declare each with
its use, under *Fitness and wellness* → *Fitness coaching / social fitness*:

| Permission | Why |
|---|---|
| READ_STEPS | Daily step goals, Step Race and Daily Streak challenges, the step rank. |
| READ_DISTANCE | Distance goals, Distance pools, Journeys along courses. |
| READ_EXERCISE | Workout goals, Bingo squares, Chase and Tag scoring, the 75 Day and Accountability checklists. |
| READ_HEART_RATE | A workout's average heart rate is kept with the member's workout history, for challenge kinds in development; not shown or scored yet. |
| READ_WEIGHT | Read for weight-based goals in development; not shown or scored yet. |

Confirm: the data is used only for the features above, never for
advertising, never sold, never shared with third parties; the privacy
policy's health-data section covers it; the app shows a permissions
rationale screen (the Health Connect plugin's rationale activity).

### Advertising ID

Yes, the app uses the advertising ID (AdMob). The AD_ID permission is in
the manifest via react-native-google-mobile-ads.

## Testing tracks

1. **Internal testing** first: upload the bundle, add testers by email
   (up to 100), share the link. Installs within minutes; use it to check
   the Play-installed build against the website APK.
2. **Closed testing**: a personal developer account must run a closed test
   with **at least 12 testers opted in for 14 continuous days** before
   it can apply for production. The Dashboard shows the exact count and
   the day counter. Invite the website APK testers; they can install over
   the APK since it is the same signing key.
3. **Apply for production access** when the Dashboard allows, answer its
   short questionnaire, then promote the release to **Production**.

## The build

```
cd mobile
npx eas-cli build --platform android --profile production
```

The `production` profile makes an app bundle (`.aab`) with the store
distribution and the remotely managed version code. Upload it by hand to
the track; the first upload enrols Play App Signing with EAS's keystore
as the upload key. Later uploads can go through `eas submit --platform
android` once a Google Cloud service account has been created and given
release access in the Play Console (Users and permissions → Invite new
user → the service account's email; `eas submit` asks for its JSON key
the first time).

Remember the Home banner for the new version (CLAUDE.md) and the release
steps in `supabase/STAGING.md` and issue #288.
