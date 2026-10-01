# Hound

Hound is a fitness app for challenges between friends. You connect Apple Health or Android Health Connect, pick a challenge, invite people, and Hound keeps score from the steps, miles and workouts your phone already records.

- **App:** iOS and Android, built with Expo and React Native ([`mobile/`](mobile/))
- **Website:** [houndchallenge.net](https://houndchallenge.net), with sign-up, invite links and tester downloads ([`site/`](site/))
- **Backend:** Supabase (Postgres, auth, edge functions), with RevenueCat for purchases

Current version: **0.10.0**. Testers install it through TestFlight on iOS and an APK from the website on Android.

---

## Challenge types

| Challenge | How it works |
|---|---|
| **Chase** | One runner gets a head start. The other has to catch them on logged miles before time runs out. Caught runners become Zombies. |
| **Game of Tag** | One person is "IT" and has to catch someone before time runs out. No ranking, just don't get caught. |
| **Step Race** | Most steps during the challenge, everyone against everyone. |
| **Group Distance Target** | The whole group adds miles (or steps) toward one shared target. |
| **Daily Streak** | Hit a daily goal every day. One miss and you're out. |
| **Variety Bingo** | Log different kinds of workouts to fill your own card: variety, strength or sports cards. |
| **Tic-Tac-Go** | Two players, one board. Hit a square's goal to claim it, then it's their move. Three in a row wins. |
| **75 Day Challenge** | A daily checklist: two workouts (one outdoors), diet, water, reading and a progress photo. |

Challenges start Today, Now or Tomorrow in each person's local time. They can be friends-only, organization-wide, or global challenges published by Hound admins for everyone. Finished challenges can be rematched and shared as a result card.

## Around the challenges

- **Today:** your active challenges, anything waiting on you (your Tic-Tac-Go move, a 75 Day check-in, a Tag target), a weekly recap, and live leaderboards with rank movement.
- **Hound Score, XP and levels:** finishing challenges earns XP and raises your Hound Score.
- **Bones:** an in-app currency. You earn it from challenge results and a daily bonus, or buy it in the shop. Some challenge types unlock after you've earned enough Bones. Organizations can rename the currency.
- **Locker:** avatar frames, backgrounds and icons to buy with Bones and equip. They show wherever your avatar appears.
- **Achievements** and **personal records** (best step day, 10k streak, farthest day, longest workout), with a celebration when you set one.
- **Friends:**
  - Friend codes, invite by email, invite links, and Find people search with suggestions.
  - Nudges and reactions on leaderboards.
  - A trash-talk wall for each challenge, with a word filter, mute and report.
- **Notifications:** push for friend requests, your Tic-Tac-Go turn, Tag catches, nudges and reactions. Optional daily standings, stale-data alerts and login reminders, by push or email, sent in your local time.
- **Data tab:** steps, distance, heart rate and weight from your phone, plus manual entry.
- **Organizations:** schools and companies get their own member lists, admins, invite codes, challenge labels and currency name.
- **Admin tools:** user directory, bans, global challenges, unlock gates, daily bonus amounts, push reach, sign-up alerts and app versions.
- **Account:** sign in with email, Google or Facebook. Light and dark mode. Delete your account from Settings.

---

## Repository layout

```
mobile/                  The app (Expo SDK 57, React Native, TypeScript)
  src/screens/           Today, Challenges, Data, Friends, Settings, Admin, ...
  src/challenges/        Scoring and API code for each challenge type
  src/health/            HealthKit / Health Connect / mock data providers
  supabase/migrations/   Database schema, numbered 0001 onward; run in order
  supabase/functions/    Edge functions (emails, push, purchases, account deletion)
site/                    houndchallenge.net, static HTML/JS deployed by Vercel
index.html, app.js, ...  The original static prototype the app's design came from
```

## Running the app

```
cd mobile
npm install
cp .env.example .env     # add your Supabase, Google and RevenueCat keys
npx expo start           # Expo Go: screens and navigation with sample health data
npx expo start --web     # quickest way to look at the UI in a browser
```

HealthKit and Health Connect are native modules, so real health data needs a native build, from either:
- a development build: `eas build --profile development`
- local native projects: `npx expo prebuild`, then `npx expo run:ios` (Xcode) or `npx expo run:android` (Android Studio)

Details on iOS, Android, Google sign-in, push credentials and EAS are in [`mobile/README.md`](mobile/README.md).

## Backend

- **Database:** run each file in `mobile/supabase/migrations/` once, in number order, in the Supabase SQL Editor. Each file explains what it does at the top.
- **Edge functions:** each function in `mobile/supabase/functions/` is a single file that can be deployed from the Supabase dashboard or with `supabase functions deploy <name>`. They need these secrets:
  - `RESEND_API_KEY` for email.
  - `REVENUECAT_WEBHOOK_SECRET`, at least 32 characters.
- **Scheduled jobs:** daily standings, stale-data alerts, login reminders and trash-talk cleanup run through `pg_cron`. They're set up by the migrations that add them.
- **Website:** `site/` deploys to Vercel automatically on every merge to `master`. See [`site/README.md`](site/README.md) to configure it.

## Shipping updates

- **JavaScript-only changes** go out over the air to every build of the same app version:
  ```
  eas update --branch production --environment production
  ```
- **Native changes** need a new app version and store build: new native modules, permissions, or anything in `app.json` that touches the native project. See issue #288 for the checklist.
- **App and database together:** when a release needs both, the app falls back to the old behavior until the new database functions exist, so the update and the migrations can go out in either order.

## Security

A full security review by Roshan Trivedi (October 2026) was addressed in migrations 0090–0092 and the edge functions alongside them. `0092_hide_private_profile_columns.sql` hides email addresses and friend codes from other users. Run it only once most people have the 0.10 update that shipped with it. After 0092, any new column on `profiles` must be granted to signed-in users before the app can read it:

```sql
grant select (new_column) on public.profiles to authenticated;
```
