// Event-driven, not scheduled — unlike the other three notification jobs
// (send-login-reminders, send-stale-data-alerts, send-daily-standings),
// there's no cron job here. This fires the instant It actually changes
// hands in a Game of Tag round, called directly from inside the two
// RPCs that make that happen (0048_tag_push_notifications.sql):
//   - tag_check_catch, the moment a real catch lands — kind: 'caught'
//   - tag_settle_timeout, the moment a stalled round times out and It
//     passes to someone at random — kind: 'timeout'
// Both call this via pg_net's net.http_post from inside their own
// PL/pgSQL body, the same "Postgres calls an Edge Function directly"
// shape 0010_login_reminders.sql's own cron.schedule already uses, just
// triggered by a state change instead of a clock. Wrapped in a plpgsql
// exception handler on the calling side — a failure to notify must
// never roll back the actual game state change.
//
// Deploy with the Supabase CLI:
//   supabase functions deploy send-tag-notification

import { createClient } from 'jsr:@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
// Mirrors tagApi.ts's own TAG_TIME_LIMIT_MINUTES and
// tag_settle_timeout's own hardcoded 15-minute interval — no single
// source of truth for this number exists across the stack yet (a
// pre-existing gap, not introduced here).
const TAG_TIME_LIMIT_MINUTES = 15;

interface RequestBody {
  kind: 'caught' | 'timeout';
  challenge_id: string;
  new_it_user_id: string;
  // Only meaningful for kind: 'caught' — who actually did the tagging.
  tagger_id?: string;
}

interface ProfileRow {
  name: string;
  username: string | null;
  use_username: boolean;
  notify_push_enabled: boolean;
}

// Same "username instead of real name once someone's set one" rule
// send-stale-data-alerts' own displayName duplicates too — Edge
// Functions are deployed independently and can't import from mobile/src.
function displayName(p: { name: string; username: string | null; use_username: boolean }): string {
  return p.use_username && p.username ? p.username : p.name;
}

Deno.serve(async (req) => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Same two-caller shape every other function here uses: the real
  // caller is Postgres itself (via pg_net, using the service role key
  // straight from vault — see 0048's own comment), with a signed-in
  // admin able to fire this by hand for testing, same "check the
  // caller's own JWT against profiles.is_admin" pattern admin-delete
  // -user uses. Anyone else gets 401.
  const authHeader = req.headers.get('Authorization') ?? '';
  const isServiceRole = authHeader === `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`;
  if (!isServiceRole) {
    const callerClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user: caller },
    } = await callerClient.auth.getUser();
    const { data: callerProfile } = caller
      ? await supabase.from('profiles').select('is_admin').eq('id', caller.id).single()
      : { data: null };
    if (!callerProfile?.is_admin) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }
  }

  const body = (await req.json()) as RequestBody;
  if (!body?.challenge_id || !body?.new_it_user_id || (body.kind !== 'caught' && body.kind !== 'timeout')) {
    return new Response(JSON.stringify({ error: 'Missing or invalid fields' }), { status: 400 });
  }

  const [{ data: challenge }, { data: newItProfile }, { data: taggerProfile }] = await Promise.all([
    supabase.from('challenges').select('name').eq('id', body.challenge_id).single(),
    supabase
      .from('profiles')
      .select('name, username, use_username, notify_push_enabled')
      .eq('id', body.new_it_user_id)
      .single<ProfileRow>(),
    body.tagger_id
      ? supabase.from('profiles').select('name, username, use_username, notify_push_enabled').eq('id', body.tagger_id).single<ProfileRow>()
      : Promise.resolve({ data: null }),
  ]);

  if (!challenge || !newItProfile) {
    return new Response(JSON.stringify({ sent: false, reason: 'Challenge or profile not found' }), { status: 404 });
  }
  if (!newItProfile.notify_push_enabled) {
    return new Response(JSON.stringify({ sent: false, reason: 'Push disabled for this user' }));
  }

  const messageBody =
    body.kind === 'caught'
      ? `${taggerProfile ? displayName(taggerProfile) : 'Someone'} tagged you in "${challenge.name}"! You're It — pick who to tag within ${TAG_TIME_LIMIT_MINUTES} minutes.`
      : `Time ran out in "${challenge.name}" — you're It now! You have ${TAG_TIME_LIMIT_MINUTES} minutes to pick who to tag.`;

  const { data: tokenRows } = await supabase
    .from('device_push_tokens')
    .select('expo_push_token')
    .eq('user_id', body.new_it_user_id);
  const tokens = (tokenRows ?? []).map((r) => r.expo_push_token);
  if (tokens.length === 0) {
    return new Response(JSON.stringify({ sent: false, reason: 'No registered device' }));
  }

  const messages = tokens.map((to) => ({ to, title: 'Hound', body: messageBody, sound: 'default' }));
  await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(messages),
  }).catch(() => {
    // Same "one failed send shouldn't surface as a 500" reasoning the
    // other three notification jobs' own sendPushBatch already uses.
  });

  return new Response(JSON.stringify({ sent: true, recipients: tokens.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
