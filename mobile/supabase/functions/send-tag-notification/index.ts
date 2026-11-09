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
// The daily chase (0181) sends two more, the morning a day settles
// (tag_chase_advance): kind 'chase_it' to whoever is IT today, and kind
// 'chase_tagged' to each hound IT caught (tagger_id is IT, margin how
// many steps short they were). new_it_user_id is who it goes to.
//
// Deploy with the Supabase CLI:
//   supabase functions deploy send-tag-notification

import { createClient } from 'jsr:@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
// The round's length is the creator's pick (challenges.tag_round_minutes,
// 0168), an hour when empty. Same wording as tagApi.ts's formatTagTime.
function formatRound(minutes: number): string {
  if (minutes % 60 === 0) return minutes === 60 ? '1 hour' : `${minutes / 60} hours`;
  if (minutes % 60 === 30) return `${Math.floor(minutes / 60)}½ hours`;
  return `${minutes} minutes`;
}

interface RequestBody {
  kind: 'caught' | 'timeout' | 'chase_it' | 'chase_tagged';
  challenge_id: string;
  new_it_user_id: string;
  // Only meaningful for kind: 'caught' — who actually did the tagging.
  tagger_id?: string;
  // The chase: how many steps short a tagged hound was, and the head start.
  margin?: number;
  head_start?: number;
}

const KINDS = ['caught', 'timeout', 'chase_it', 'chase_tagged'];

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
  if (!body?.challenge_id || !body?.new_it_user_id || !KINDS.includes(body.kind)) {
    return new Response(JSON.stringify({ error: 'Missing or invalid fields' }), { status: 400 });
  }

  const [{ data: challenge }, { data: newItProfile }, { data: taggerProfile }] = await Promise.all([
    supabase.from('challenges').select('name, tag_round_minutes').eq('id', body.challenge_id).single(),
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

  const roundLength = formatRound(challenge.tag_round_minutes ?? 60);
  const tagger = taggerProfile ? displayName(taggerProfile) : 'IT';
  const headStart = (body.head_start ?? 2000).toLocaleString('en-US');
  const messageBody =
    body.kind === 'chase_it'
      ? `You're IT today in "${challenge.name}" 🏃 Out-walk anyone by more than their ${headStart}-step head start to tag them.`
      : body.kind === 'chase_tagged'
        ? `${tagger} tagged you in "${challenge.name}"${body.margin ? ` by ${body.margin.toLocaleString('en-US')} steps` : ''}. Watch last night's chase.`
        : body.kind === 'caught'
          ? `${tagger === 'IT' ? 'Someone' : tagger} tagged you in "${challenge.name}"! You're It — pick who to tag within ${roundLength}.`
          : `Time ran out in "${challenge.name}" — you're It now! You have ${roundLength} to pick who to tag.`;

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
