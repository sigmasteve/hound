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

Step races, Soccer, Bingo and run clubs on real steps, with a hound of your own.

### Full description (4,000)

Hound turns your steps and workouts into games with your friends and your
club. Every step counts automatically from Health Connect, so there is
nothing to log: just move, and your hound cheers you on.

PICK YOUR GAME
Seventeen ways to compete, all on real steps, miles and workouts.
• Step Race, Chase and Game of Tag: out-walk everyone, catch the runner, or
  don't get tagged.
• Journey: walk a famous course with your own miles, from the Golden Gate
  Bridge to Route 66, with a postcard at every stop.
• Soccer, Cricket, Baseball and Hoops: a match on everyone's steps, a day
  at a time. Teams of 1 to 9, with friends or bots.
• Tic-Tac-Go, Bingo, Rally, H-O-R-S-E and Hound'opoly: board games,
  badminton and a shootout on your steps.
• Daily Streak, Group Distance Target, 75 Day Challenge and
  Accountability: habits, kept together.

PACK ACTIVITIES
Out walking, running or hiking together? Start a live session for your
pack. Puzzles drop as you move, anyone can start a quick race, and a live
map shows where everyone is, with bones to walk to. Your spot is shared
only with that pack, and only until it ends.

CLUBS
Bring your run club, cycling group or walking crew. Post challenges to
the club, see the miles you all put in this week, and find public clubs
by name, city or sport.

EVERYONE ON HOUND
Join Global Hound Challenges right from Today: Pack Wars, where four packs
fight over a neighborhood map, Daily Doors, with a task behind a new door
every day, and weekly races open to all.

TALK TRASH
Every challenge has a trash-talk wall with ready-made taunts that use the
real standings. Nudge a friend who is slacking and react to their
progress. You can mute anyone and report any message.

HIT YOUR GOALS
Set goals for steps, miles and workouts, log water with one tap, and
watch them fill as your phone syncs. Keep your streak alive, collect a
daily bonus, and get a nudge from your hound when you are behind: choose
Gentle, Playful, or Roast me if you can take it.

RAISE A HOUND
Every goal day and finished challenge earns Bones and XP. Dress your
hound up, move it into a house with a porch and a hot tub, and watch it
live: walks that turn up finds, a garden that grows with your steps,
bath day, playdates at the dog park and a birthday every year. Use your
hound as your avatar, or a photo of your own dog.

SEE IT AT A GLANCE
Your goals, steps and hound on a home screen widget. Share story-ready
cards of your week, your goals and your wins, with a code that lets
friends add you in one scan. Friends on iPhone play the same games
through Apple Health.

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

Hound on Google Play: seventeen games on real steps and workouts, from Step
Races to Soccer and Hoops. Clubs for your run club, Pack Activities for
walks together, Pack Wars and Daily Doors with everyone on Hound, and a
hound with a life of its own.

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
message can be reported and any member muted). **Shares location: yes** (a Pack Activity's live map, with that Pack Activity's members only, until it ends).
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
| Location: Precise location (a Pack Activity's live map, only during a Pack Activity the user joins; deleted when it ends) | yes | no | no (optional) | App functionality | no |
| Photos and videos: Photos (a photo of the user's dog as their avatar, seen by friends) | yes | no | no (optional) | App functionality | no |
| Financial info: Purchase history (Bones packs) | yes | no | no | App functionality | no |
| App activity: App interactions | yes | no | yes | Analytics, app functionality | no |
| App activity: Other user-generated content (hound name, username) | yes | no | yes | App functionality | no |
| App info and performance: Crash logs | yes | no | yes | Analytics | no |
| Device or other IDs: Device or other IDs (advertising ID, for AdMob) | yes | **yes, with Google AdMob** | no | Advertising or marketing | no |

Fitness data is read from Health Connect only, never written, and never
shared or sold. Nothing is used for third-party advertising except the
advertising ID AdMob uses to serve and count non-personalized ads.

### Location and foreground service (from 1.2.0)

1.2.0 adds `ACCESS_FINE_LOCATION`, a location foreground service and
`ACTIVITY_RECOGNITION`, all for Pack Activities. In App content →
*Foreground service permissions*, declare **Location**: "During a Pack
Fun the user joins and chooses to keep sharing, their spot keeps updating
on that group's map while the phone is locked, with a notification
showing, until the Pack Activity ends." There is no background location
permission, so no background-location declaration is needed. Activity
recognition counts live steps during a Pack Activity.

### Government apps, Financial features

No, and none.

### Health apps (Health Connect declaration)

Hound requests seven Health Connect read permissions (hydration and sleep
from the 1.1.0 build). Declare each with
its use, under *Fitness and wellness* → *Fitness coaching / social fitness*:

| Permission | Why |
|---|---|
| READ_STEPS | Daily step goals, Step Race and Daily Streak challenges, the step rank. |
| READ_DISTANCE | Distance goals, Distance pools, Journeys along courses. |
| READ_EXERCISE | Workout goals, Bingo squares, Chase and Tag scoring, the 75 Day and Accountability checklists. |
| READ_HEART_RATE | A workout's average heart rate is kept with the member's workout history, for challenge kinds in development; not shown or scored yet. |
| READ_WEIGHT | Read for weight-based goals in development; not shown or scored yet. |
| READ_HYDRATION | Water goals: water other apps log in Health Connect counts toward the member's daily water goal, with Hound's own taps. |
| READ_SLEEP | Read for the hound's bedtime in development: the hound sleeps when the member does. Not shown or scored yet. |

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
