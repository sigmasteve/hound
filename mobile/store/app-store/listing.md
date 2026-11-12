# App Store listing: Hound: Fitness with Friends

The text for App Store Connect, kept here so it is versioned and can be
pushed with `asc.py` (needs the App Store Connect API key in the
environment: `ASC_ISSUER_ID`, `ASC_KEY_ID`, `ASC_PRIVATE_KEY`). Lengths
are Apple's limits; `asc.py --check` verifies them.

## App information (whole app)

- **Name** (30): `Hound: Fitness with Friends`
- **Subtitle** (30): `Step races, games & trash talk`
- **Primary category:** Health & Fitness · **Secondary:** Social Networking
- **Privacy policy URL:** https://houndchallenge.net/privacy
- **Support URL:** https://houndchallenge.net
- **Marketing URL:** https://houndchallenge.net
- **Age rating:** fill the questionnaire with *Unrestricted Web Access: No*,
  *User-generated content: Yes* (trash-talk wall, with report and mute),
  *In-app purchases: Yes*. Everything else No. Expect 12+ or 13+ from the
  UGC answer; Hound's own terms require 13+.

## Version information

### Promotional text (170, can change without a new version)

Bring your run club. Race friends in Step Races, Soccer, Baseball and
Bingo, take ground in Pack Wars, and raise a hound with a life of its own.

### Description (4,000)

Hound turns your steps and workouts into games with your friends and your
club. Every step counts automatically from Apple Health, so there is
nothing to log: just move, and your hound cheers you on.

PICK YOUR GAME
Fifteen ways to compete, all on real steps, miles and workouts.
• Step Race, Chase and Game of Tag: out-walk everyone, catch the runner, or
  don't get tagged.
• Journey: walk a famous course with your own miles, from the Golden Gate
  Bridge to Route 66, with a postcard at every stop.
• Soccer, Cricket and Baseball: a match on everyone's steps, a day at a
  time. Teams of 1 to 9, with friends or bots.
• Tic-Tac-Go, Bingo, Rally and Hound'opoly: board games and badminton on
  your steps.
• Daily Streak, Group Distance Target, 75 Day Challenge and
  Accountability: habits, kept together.

PACK FUN
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

ON YOUR WRIST
Hound on Apple Watch shows your goal rings and streak and adds water with
a tap, with complications for your watch face. Widgets for your Home
Screen and Lock Screen, and story-ready cards to share your wins.

Hound reads your activity from Apple Health and never writes to it. Bones
can be earned by playing or bought in packs; they have no cash value and
only buy things inside the app. Watching an ad for Bones is always your
choice.

Privacy policy: https://houndchallenge.net/privacy
Terms: https://houndchallenge.net/terms

### Keywords (100, comma-separated, no spaces, no repeats of the name)

steps,pedometer,walking,running,run club,hiking,challenge,leaderboard,bingo,streak,goals,dog,watch

### What's New (4,000)

Pack Fun: out walking, running or hiking together? Start a live session
for your pack. Puzzles drop as you move, anyone can start a quick race,
and a live map shows where everyone is, with bones to walk to. Your spot
is shared only with that pack, and only until it ends.

Your dog as your avatar: use a photo of your own dog, seen by your
friends, or have Hound dress your hound up to look like them. Tap your
avatar on the You tab to change it.

Plus fixes and smaller improvements.

## App Review notes (4,000)

Hound is a social fitness app. Notes for review:

- **Apple Health** is read-only. The app reads steps, distance and
  workouts to score challenges and goals, and heart rate and weight for
  challenge kinds still in development (not shown in this version). It
  never writes to Health. Background delivery keeps challenges current while closed.
- **Bones** are the in-app currency. They are earned by playing (goal
  days, finished challenges, a daily bonus) and also sold as consumable
  packs under You → Your look → Shop. Bones only buy cosmetic items,
  hound items, Streak Shields and entries into challenge pots. They
  cannot be cashed out or transferred, and only earned Bones can go into
  a pot. Purchases run through RevenueCat with StoreKit.
- **Rewarded ads** (Google AdMob, non-personalized only) are shown only
  when the user taps "Watch an ad" for Bones. A consent form appears in
  the EU/UK/Switzerland. There are no other ads.
- **User-generated content**: each challenge has a trash-talk wall limited
  to the challenge's members. Any message can be reported (reports go to
  the admin screen) and any member can be muted. Our terms state zero
  tolerance for abuse.
- **Location** (Pack Fun's live map, 1.2.0): used only during a Pack Fun
  the user joins, shown only to that group, and deleted when it ends.
  Background location continues only until that Pack Fun ends, with the
  blue indicator showing. Live steps during a Pack Fun use Motion.
- **Dog photos** (1.2.0): a photo of the user's own dog as their avatar,
  seen only by their friends. Each upload is checked automatically to be a
  dog and nothing objectionable; friends can report one, and reported
  photos are hidden until reviewed. Uploading can be blocked per user.
- **Sign in**: email, Google, Facebook, and Sign in with Apple.
- **Demo account**: [the existing App Review demo account's email and
  password]. It has friends, active challenges of several kinds and a
  Journey in progress, so every screen has data.

## App Privacy (the nutrition labels)

- Contact info: name, email (app functionality, account; linked).
- Health & fitness: fitness data (app functionality; linked; not tracking).
- User content: other user content, the trash-talk messages (app functionality; linked);
  photos, the dog photo used as an avatar (app functionality; linked; from 1.2.0).
- Location: precise location, Pack Fun's live map (app functionality; linked;
  not tracking; from 1.2.0).
- Identifiers: user ID (app functionality; linked); device ID (third-party
  advertising via AdMob; **tracking: No**).
- Purchases: purchase history (app functionality; linked).
- Usage data: product interaction (analytics, app functionality; linked).
- Diagnostics: crash data (app functionality; not linked).

## Screenshots

Apple needs the iPhone 6.9" set (1320 × 2868) and, while the build
supports iPad, the iPad 13" set (2064 × 2752). `frame.py` takes raw
screenshots and a caption and writes finished images into
`screenshots/out/`. Six, in this order, captions as given:

| # | Screen to capture | Caption |
|---|---|---|
| 1 | Today, with goals rings filled and the hound tile | Your steps, your goals, your hound. |
| 2 | A Step Race leaderboard with friends | Race your friends on real steps. |
| 3 | A Hound Bingo card with squares marked | Bingo, on workouts you actually did. |
| 4 | A Journey's map with a postcard open | Walk famous courses. Collect the postcards. |
| 5 | The Kennel, hound dressed up | Earn Bones. Spoil your hound. |
| 6 | A trash-talk wall with taunts | Talk a little trash. |

Raw screenshots go in `screenshots/raw/` named `1.png` … `6.png` (iPhone)
and `ipad-1.png` … `ipad-6.png` (iPad). Nothing in `raw/` is committed.
