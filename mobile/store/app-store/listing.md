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

Walk, run and hike against your friends in step races, chases, Bingo and
real-course Journeys. Hit daily goals, earn Bones, and raise a hound.

### Description (4,000)

Hound turns your steps and workouts into games with your friends. Every
step counts automatically from Apple Health, so there is nothing to log:
just move, and your hound cheers you on.

PICK YOUR GAME
Nine ways to compete, all on real steps, miles and workouts.
• Step Race: most steps wins.
• Chase: the Chaser has to catch everyone before time runs out.
• Game of Tag: catch someone ahead of you, or stay It.
• Tic-Tac-Go: claim squares, three in a row wins.
• Bingo: real bingo with steps and workouts. First line wins.
• Journey: walk a famous course with your own miles, from the Golden Gate
  Bridge to the Appalachian Trail, with a postcard at every stop.
• Daily Streak: hit your goal every day.
• Group Distance Target: the group chases one shared total.
• 75 Day Challenge: a daily checklist for 75 days.

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
Your goals, steps and hound on your Home Screen and Lock Screen widgets.
Share story-ready cards of your week, your goals and your wins, with a
code that lets friends add you in one scan.

PLAY WITH ANYONE
Add friends by name, code or QR, or join Global Hound Challenges open to
everyone on Hound. Friends on Android play the same games through Health
Connect.

Hound reads your activity from Apple Health and never writes to it. Bones
can be earned by playing or bought in packs; they have no cash value and
only buy things inside the app. Watching an ad for Bones is always your
choice.

Privacy policy: https://houndchallenge.net/privacy
Terms: https://houndchallenge.net/terms

### Keywords (100, comma-separated, no spaces, no repeats of the name)

steps,pedometer,walking,running,pup,walk,challenge,leaderboard,bingo,streak,goals,dog,social

### What's New (4,000)

First App Store release. Nine games on real steps and workouts, a hound
that grows with you, Journeys along famous courses with a postcard at
every stop, Home Screen widgets, and a trash-talk wall for every
challenge.

## App Review notes (4,000)

Hound is a social fitness app. Notes for review:

- **Apple Health** is read-only. The app reads steps, distance, workouts,
  heart rate and weight to score challenges and goals. It never writes to
  Health. Background delivery keeps challenges current while closed.
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
- **Sign in**: email, Google, Facebook, and Sign in with Apple.
- **Demo account**: [the existing App Review demo account's email and
  password]. It has friends, active challenges of several kinds and a
  Journey in progress, so every screen has data.

## App Privacy (the nutrition labels)

- Contact info: name, email (app functionality, account; linked).
- Health & fitness: fitness data (app functionality; linked; not tracking).
- User content: other user content, the trash-talk messages (app functionality; linked).
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
