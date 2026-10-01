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

### 5. Point development builds at staging

In expo.dev → the Hound project → **Environment variables**, change these for the **development** environment only:

- `EXPO_PUBLIC_SUPABASE_URL` → `https://quglaamzzhebqrlhvfuc.supabase.co`
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` → staging's publishable key, from **Project Settings → API Keys**

Leave **preview** and **production** as they are for now. Preview builds use internal distribution, so the Android APK on the download page may be a preview build. Pointing preview at staging would move those testers onto the test database. Decide that once you know which profile built the APK.

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
