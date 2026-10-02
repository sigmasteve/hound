# Staging and tests

Hound has two Supabase projects:

| | Production | Staging |
|---|---|---|
| Project ref | `vaypjksgpuuopqvurcus` | `quglaamzzhebqrlhvfuc` |
| Who uses it | Testers and real users | The team, with test accounts |
| How changes arrive | By hand in the SQL Editor (for now) | Automatically, when CI passes on `master` |

Every change goes to staging first. Production only gets what has passed there.

## What runs on every pull request

`.github/workflows/ci.yml` runs four checks. A pull request should not be merged until all four pass.

- **App typecheck:** `tsc --noEmit` in `mobile/`.
- **Edge functions typecheck:** `deno check` on every function.
- **Website syntax:** `node --check` on the site's scripts.
- **Migrations and database tests:**
  1. Start Supabase's own Postgres image.
  2. Apply every migration from `0001`, each file as one transaction (the way `supabase db push` does).
  3. Run the tests in `tests/`.

When a pull request merges to `master` and all four pass, the **Deploy to staging** job applies any new migrations to staging (`supabase db push`) and deploys every edge function there.

## Running the database tests yourself

You need Docker.

```
mobile/supabase/tests/setup-db.sh
PSQL="docker exec -i hounddb psql -U postgres" mobile/supabase/tests/run.sh
```

- **The tests:** each file in `tests/` is a [pgTAP](https://pgtap.org) test that runs in its own transaction and rolls back.
- **Helpers:** `tests.new_user('Name')` signs up a user, and `tests.sign_in(id)` followed by `set local role authenticated;` acts as them.
- **When to add one:** with every migration that changes who can do what, or how scores are paid.

## One-time setup

### 1. GitHub secrets, so CI can deploy to staging

In the repository's **Settings → Secrets and variables → Actions → New repository secret**:

| Name | Where to get it |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | supabase.com → your avatar → **Account preferences → Access Tokens → Generate new token** |
| `STAGING_DB_PASSWORD` | The database password you chose when creating hound-staging. If you've lost it, reset it under the staging project's **Project Settings → Database**. |

The next merge to `master` creates every table, function and scheduled job on staging, and deploys the edge functions. To deploy without waiting for a merge, go to **Actions → CI → Run workflow** on `master`.

### 2. Staging's own secrets, in staging's SQL Editor

Run once, after the first deploy:

```sql
select vault.create_secret('https://quglaamzzhebqrlhvfuc.supabase.co', 'project_url');
select vault.create_secret('<staging service_role key>', 'service_role_key');
```

The service-role key is in the staging project's **Project Settings → API Keys**. Until both exist, staging skips push notifications and scheduled emails; nothing else is affected. Production got its `project_url` automatically from 0093.

### 3. Edge function secrets on staging

In staging's **Edge Functions → Secrets**:

- `RESEND_API_KEY`: leave it unset if staging shouldn't send real email.
- `REVENUECAT_WEBHOOK_SECRET`: any value of 32 or more characters (`openssl rand -hex 32`). It's only used if a RevenueCat sandbox webhook points at staging.

### 4. Sign-in on staging

In staging's **Authentication**:

- **URL Configuration:** use the same Site URL and redirect URLs as production.
- **Providers:** turn on Google and Facebook with the same client IDs as production. Then add staging's callback, `https://quglaamzzhebqrlhvfuc.supabase.co/auth/v1/callback`, to the Google Cloud OAuth client and to the Facebook app.

### 5. App builds: one profile per environment

| Build profile | Who installs it | Update channel → branch | Supabase |
|---|---|---|---|
| `production` | TestFlight, App Store, Play Store | `production` → `production` | Production |
| `production-apk` | Android testers, from the website's APK | `production` → `production` | Production |
| `staging` | The team: **Hound Staging**, installs next to the real app | `staging` → `staging` | Staging |
| `preview` | Older Android testers only, until they move to `production-apk` | `preview` → `production` for now | Production for now |
| `development` | The team, with the dev client | none | Staging |

**Moving the Android testers off `preview`.** The APK on the download page was built with `preview`. So that it would get production updates, the `preview` channel was pointed at the `production` branch (`eas channel:edit preview --branch production`). To undo that cleanly:

1. Build a production APK with `npm run build:android:apk`. It's the same app and signing key, so it installs over the old one and testers stay signed in.
2. Replace the APK behind the website's download link with this build, and ask the Android testers to install it.
3. Watch **Admin → App versions** until no Android tester is left on the old build number.
4. Point the `preview` channel back at its own branch: `eas channel:edit preview --branch preview`.

Anyone still on the old APK at step 4 stops getting updates until they install the new one. Their app keeps working and still talks to production.

**Pointing preview and development at staging.** In expo.dev → the Hound project → **Environment variables**, set these for the **preview** and **development** environments:

- `EXPO_PUBLIC_SUPABASE_URL` → `https://quglaamzzhebqrlhvfuc.supabase.co`
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` → staging's publishable key, from **Project Settings → API Keys**

Leave **production** as it is. These values are baked in when an app is built or an update is published, so existing installs aren't affected. Only builds made, or updates published with `--environment preview`, after the change use staging. Staging updates go out with:

```
eas update --branch preview --environment preview
```

### 6. Hound Staging on your iPhone

Hound Staging is a second app on the same phone. It has its own name, its own bundle ID (`app.hound.mobile.staging`) and its own URL scheme (`hound-staging`), and it talks to the staging project. `app.config.js` builds it only when `APP_VARIANT=staging`; every other build is the real Hound, exactly as `app.json` describes it.

1. **Point the preview environment at staging.** In expo.dev → Hound → **Environment variables**, set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for **preview** to staging's values (step 5 above). Hound Staging builds and updates use the preview environment.
2. **Register your iPhone.** Staging uses internal distribution, so Apple only lets it install on registered devices. From `mobile/`, run `npx eas-cli device:create` and follow the link on your phone. Do this once per phone.
3. **Build it.** From `mobile/`, run `npm run build:ios:staging`.
   - EAS asks to create the App ID `app.hound.mobile.staging` and a provisioning profile: say yes.
   - For push notifications, reuse the existing Apple push key.
4. **Install it** from the link or QR code EAS shows at the end. It appears as **Hound Staging**, next to Hound.
5. **Sign in with email.** Staging has its own accounts, so create one. Google Sign-In on iOS is tied to the bundle ID, so it won't work in Hound Staging until staging has its own iOS OAuth client: set the preview environment's `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` and a `GOOGLE_IOS_URL_SCHEME_STAGING` build variable to it, then rebuild.
6. **Send it JavaScript changes over the air** with `npm run update:staging` (from `mobile/`). Always use this script rather than a bare `eas update`. It sets `APP_VARIANT=staging`, so the update keeps the `hound-staging` scheme, and it publishes to the `staging` branch, which only Hound Staging listens to.

None of this touches the real Hound: its bundle ID, channel (`production`) and environment are unchanged. Hound Staging never receives production updates, and production never receives staging updates.

## Releasing to production

Until production's migration history is recorded (below), it stays manual, in this order:

1. Merge to `master`. CI passes and deploys to staging.
2. Run the release checklist on staging.
3. Run the new migration files in production's SQL Editor, in number order.
4. Deploy the changed edge functions to production.
5. Publish the update with `eas update --branch production --environment production`.

### Recording production's history (later)

Production's migrations were pasted in by hand, so the CLI doesn't know which have run. To switch production to `supabase db push`:

1. Link the CLI to production.
2. Mark everything that has already run as applied:
   ```
   supabase migration repair --status applied 0001 0002 ... 0093
   ```
3. From then on, `supabase db push` only applies what's new.

Don't do this while a migration is deliberately waiting, as 0092 is now: `db push` would apply it straight away.
