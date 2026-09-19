// Hound web — Supabase connection config.
//
// These are the exact same two public values mobile/.env.example asks
// for (EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY):
// your project's URL and its publishable ("anon") key. Both are safe to
// ship in client-side JS — every table they can reach is behind Row
// Level Security (see mobile/supabase/migrations/0001_challenges_schema.sql).
// This is not a secret key; never put your service_role key here.
//
// Find them in the Supabase dashboard: Project Settings -> API.
// An account created here, with real values filled in, is the same real
// account the mobile app signs in with — same project, same `profiles`
// row.
window.HOUND_CONFIG = {
  supabaseUrl: 'YOUR_SUPABASE_PROJECT_URL',
  supabasePublishableKey: 'YOUR_SUPABASE_PUBLISHABLE_KEY',
};
