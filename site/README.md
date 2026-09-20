# Hound web — houndchallenge.net

A small, static (no build step) landing page: real sign-up/log-in against
the same Supabase project the mobile app uses, plus the steps to become
an early iOS tester. Not a preview of the app — an account created here
is a real account, the same one the app signs in with once it's
installed.

Visually it borrows the app's own dark theme (`mobile/src/theme/tokens.ts`'s
color values) but is otherwise a completely separate, hand-written page —
no shared code with `mobile/`, deliberately kept lightweight rather than
reusing the Expo app's web build. See `mobile/README.md`'s own note on
this tradeoff if you're wondering why.

The Supabase client library (`vendor/supabase-js/`) is vendored locally
rather than loaded from a CDN, same as the root `vendor/` directory's fonts
— see `vendor/supabase-js/README.md` for how to update it.

## 1. Connect it to your Supabase project

Open `config.js` and replace both placeholders with your project's real
values (Supabase dashboard → **Project Settings → API**):

```js
window.HOUND_CONFIG = {
  supabaseUrl: 'https://xxxxxxxx.supabase.co',
  supabasePublishableKey: 'sb_publishable_...', // or the older "anon" key
};
```

These are the same two values `mobile/.env.example` asks for
(`EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) —
public, safe to ship in client-side JS (every table they can reach is
behind Row Level Security). **Never** put your `service_role` key here.

Until this is done, the page still renders — every button and form is
just disabled, with a note saying so, instead of throwing.

## 2. One Supabase dashboard setting: allow this domain

Supabase only lets email-confirmation links and OAuth redirects go back
to domains you've explicitly allowed. In the dashboard:
**Authentication → URL Configuration**, add:

- **Site URL**: `https://houndchallenge.net`
- **Redirect URLs**: `https://houndchallenge.net` (and
  `http://localhost:3000` too, if you want local testing to also work —
  see step 4)

Without this, email sign-up confirmation links and the Google/Facebook
buttons will fail or bounce to the wrong place.

## 3. Enable the providers you want live

- **Email/password** — on by default.
- **Google / Facebook** — each needs enabling under **Authentication →
  Providers** in the dashboard, same as the mobile app already needs
  (see `mobile/README.md`'s own "Facebook Sign-In" / "Google Sign-In"
  sections for the full per-provider checklist — the OAuth app
  credentials are shared between mobile and this site, only the
  redirect URL differs).

  **One extra step Google needs here that mobile's own setup doesn't
  cover**: mobile signs in with the native Google SDK
  (`signInWithIdToken`), which mobile's own README notes needs no
  redirect URI at all. This site instead uses Supabase's standard browser
  OAuth redirect (there's no native SDK on the web) — Google redirects to
  *Supabase's* callback URL first, not straight back to this site, so
  that URL has to be allow-listed on the Google OAuth client or you'll
  hit `Error 400: redirect_uri_mismatch`. In [Google Cloud
  Console](https://console.cloud.google.com/apis/credentials), open the
  **Web application** OAuth client (the one whose Client ID/Secret is
  entered into Supabase's Google provider) and add under **Authorized
  redirect URIs**:
  ```
  https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback
  ```
  (`YOUR_PROJECT_REF` is the subdomain in your `config.js`'s
  `supabaseUrl` — `/auth/v1/callback` is Supabase's fixed callback path,
  same for every provider.)
- **Apple** isn't wired up here — per `mobile/README.md`, it still needs
  its own provider configured in the Supabase dashboard first.

## 4. Try it locally

No build step — any static file server works:

```
cd site
python3 -m http.server 3000
```

then open `http://localhost:3000`. (Add `http://localhost:3000` to the
Redirect URLs in step 2 if you want the OAuth buttons to work locally
too, not just once deployed.)

## 5. Deploy to Vercel

From the repo root:

```
npx vercel --cwd site
```

or, in the Vercel dashboard: **New Project** → import this repo → set
**Root Directory** to `site` → deploy. No framework preset, no build
command, no output directory needed — it's plain static files.

Then, **Project Settings → Domains**, add `houndchallenge.net` and
follow Vercel's DNS instructions (a CNAME or A record at your
registrar) to point the domain at it.

## Friend-code invite links (`/f/<code>`)

`f.html`/`f.js` are what a friend code's QR/link (see the mobile app's
FriendsScreen and `mobile/supabase/migrations/0019_friend_codes.sql`)
actually points at — `houndchallenge.net/f/<code>`. `vercel.json`'s
`rewrites` maps that path to `f.html` without changing the URL the
browser shows, so `f.js` reads the code straight out of
`window.location.pathname`.

The page looks the inviter's name up via the `friend_code_owner_name`
RPC (anon-callable on purpose — most visitors have no session yet) and
either offers to add them directly (already signed in) or links to
`index.html?f=<code>#auth`, which redeems the code automatically the
moment sign-up/log-in succeeds (see `app.js`'s `redeemPendingFriendCode`)
rather than sending someone back to the link a second time. That
redemption path only fires on a session that resolves same-page —
if the Supabase project requires email confirmation, clicking the
confirmation email's own link goes through Supabase's redirect first,
which doesn't reliably preserve the `?f=` query param, so that specific
path (sign up with confirmation on, then confirm via email) can lose
the pending code. Confirmed working: an existing account logging in, or
a project with email confirmation off.

## What this page deliberately doesn't do

- **No app experience.** This is sign-up/log-in plus the tester
  instructions — not a web version of Home/Challenges/etc. Once
  signed in, it just confirms the account is ready; it doesn't try to
  show a leaderboard or any real challenge data.
- **No Apple sign-in**, for the same reason the mobile app's own Apple
  button doesn't work yet — see step 3.
- **No design system reuse from `mobile/`.** Colors were copied by
  value once, not imported — this page has no build step and doesn't
  depend on the Expo project at all, so a future palette change in the
  app won't automatically show up here.
