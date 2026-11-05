// Daily Doors pushes, called from doors_push (0172_doors.sql) via pg_net,
// one call per live challenge with everyone it's for:
//   'open'  morning: "Knock knock! Door 6 is open in Knock Knock, Hound."
//   'shut'  early evening, to those who haven't opened today's: "Door 6
//           is still shut. Open it before midnight for your point."
// A failure here never affects the game: the calling side swallows it.
//
// Deploy with the Supabase CLI:
//   supabase functions deploy send-doors-notification

import { createClient } from 'jsr:@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
// Expo takes up to 100 messages a request.
const BATCH = 100;

type Kind = 'open' | 'shut';
const KINDS: Kind[] = ['open', 'shut'];

interface RequestBody {
  kind: Kind;
  challenge_id: string;
  door_no: number;
  recipient_ids: string[];
}

function messageFor(kind: Kind, door: number, last: boolean, game: string): string {
  if (kind === 'shut') {
    return `Door ${door} in "${game}" is still shut. Open it before midnight for your point.`;
  }
  return last
    ? `Knock knock! The last door in "${game}" is open, with a prize behind it. 🚪`
    : `Knock knock! Door ${door} is open in "${game}". See what's behind it. 🚪`;
}

Deno.serve(async (req) => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Postgres calls this with the service role key; a signed-in admin can
  // also fire it by hand for testing. Anyone else gets 401.
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
  if (!body?.challenge_id || !KINDS.includes(body.kind) || !Array.isArray(body.recipient_ids) || !body.door_no) {
    return new Response(JSON.stringify({ error: 'Missing or invalid fields' }), { status: 400 });
  }

  const { data: challenge } = await supabase.from('challenges').select('name, duration_days').eq('id', body.challenge_id).single();
  if (!challenge) {
    return new Response(JSON.stringify({ sent: false, reason: 'Challenge not found' }), { status: 404 });
  }

  // Only people with pushes on, and their devices.
  const ids = body.recipient_ids.slice(0, 5000);
  const { data: allowed } = await supabase.from('profiles').select('id').in('id', ids).eq('notify_push_enabled', true);
  const allowedIds = (allowed ?? []).map((r: { id: string }) => r.id);
  if (allowedIds.length === 0) {
    return new Response(JSON.stringify({ sent: false, reason: 'Nobody with pushes on' }));
  }
  const { data: tokenRows } = await supabase.from('device_push_tokens').select('expo_push_token').in('user_id', allowedIds);
  const tokens = (tokenRows ?? []).map((r: { expo_push_token: string }) => r.expo_push_token);

  const text = messageFor(body.kind, body.door_no, body.door_no === challenge.duration_days, challenge.name);
  const messages = tokens.map((to) => ({ to, title: 'Hound', body: text, sound: 'default', data: { challengeId: body.challenge_id } }));
  for (let i = 0; i < messages.length; i += BATCH) {
    await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages.slice(i, i + BATCH)),
    }).catch(() => {
      // One failed batch shouldn't stop the rest.
    });
  }

  return new Response(JSON.stringify({ sent: true, devices: tokens.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
