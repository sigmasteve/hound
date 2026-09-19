
## Hound

A fitness/health-data app for friend challenges — step races, streaks, and
a GPS-distance "Hunter & Hunted" chase.

**`mobile/`** is the real app: a cross-platform iOS/Android build (Expo +
React Native) that reads actual step/distance/heart-rate/weight data from
Apple HealthKit and Android Health Connect. See `mobile/README.md` for how
to run it — building/running the iOS and Android targets needs Xcode /
Android Studio respectively (or an EAS build), since HealthKit and Health
Connect are native-only APIs with no web equivalent.

The files at the repo root (`index.html`, `app.js`, `styles.css`,
`vendor/`) are the original static-web prototype the mobile app's design is
based on — a no-build-step HTML/CSS/JS page with sample data instead of
real health data. It still runs standalone:

```
python3 -m http.server 8000
```

then open http://localhost:8000 in a browser (or just open `index.html`
directly).

**`site/`** is the houndchallenge.net landing page: real sign-up/log-in
against the same Supabase project the app uses, plus how to become an
early tester — for people who want an account before the app is
installable. See `site/README.md` to configure and deploy it.

