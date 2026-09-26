// Event-driven Tic-Tac-Go pushes, called from inside the game's own
// Postgres functions via pg_net (0057_tictacgo_game.sql's
// tictacgo_notify) — same shape as send-tag-notification:
//   - 'started'   the opponent joined; the recipient is X and moves first
//   - 'your_turn' the actor claimed a square; the recipient's move now
//   - 'timeout'   the actor's 24 hours ran out; the recipient's move now
//   - 'won'       the actor got three in a row (the recipient lost)
//   - 'draw'      the actor's move filled the board
// A failure here never affects the game: the calling side swallows it.
//
// Deploy with the Supabase CLI:
//   supabase functions deploy send-tictacgo-notification

import { createClient } from 'jsr:@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
// Mirrors TICTACGO_TURN_HOURS (src/challenges/tictacgo.ts) and the
// 24-hour interval in tictacgo_settle.
const TURN_HOURS = 24;

type Kind = 'started' | 'your_turn' | 'timeout' | 'won' | 'draw';
const KINDS: Kind[] = ['started', 'your_turn', 'timeout', 'won', 'draw'];

interface RequestBody {
  kind: Kind;
  challenge_id: string;
  recipient_id: string;
  actor_id?: string;
}

interface ProfileRow {
  name: string;
  username: string | null;
  use_username: boolean;
  notify_push_enabled: boolean;
}

// Same rule as send-tag-notification's own copy — Edge Functions can't
// import from mobile/src.
function displayName(p: { name: string; username: string | null; use_username: boolean }): string {
  return p.use_username && p.username ? p.username : p.name;
}

function messageFor(kind: Kind, actor: string, game: string): string {
  switch (kind) {
    case 'started':
      return `${actor} joined "${game}". You're X, so you go first — you have ${TURN_HOURS} hours.`;
    case 'your_turn':
      return `${actor} claimed a square in "${game}". Your move — you have ${TURN_HOURS} hours.`;
    case 'timeout':
      return `${actor} ran out of time in "${game}". Your move — you have ${TURN_HOURS} hours.`;
    case 'won':
      return `${actor} got three in a row and won "${game}".`;
    case 'draw':
      return `The board is full in "${game}" — it's a draw.`;
  }
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
  if (!body?.challenge_id || !body?.recipient_id || !KINDS.includes(body.kind)) {
    return new Response(JSON.stringify({ error: 'Missing or invalid fields' }), { status: 400 });
  }

  const [{ data: challenge }, { data: recipient }, { data: actor }] = await Promise.all([
    supabase.from('challenges').select('name').eq('id', body.challenge_id).single(),
    supabase
      .from('profiles')
      .select('name, username, use_username, notify_push_enabled')
      .eq('id', body.recipient_id)
      .single<ProfileRow>(),
    body.actor_id
      ? supabase.from('profiles').select('name, username, use_username, notify_push_enabled').eq('id', body.actor_id).single<ProfileRow>()
      : Promise.resolve({ data: null }),
  ]);

  if (!challenge || !recipient) {
    return new Response(JSON.stringify({ sent: false, reason: 'Challenge or profile not found' }), { status: 404 });
  }
  if (!recipient.notify_push_enabled) {
    return new Response(JSON.stringify({ sent: false, reason: 'Push disabled for this user' }));
  }

  const { data: tokenRows } = await supabase
    .from('device_push_tokens')
    .select('expo_push_token')
    .eq('user_id', body.recipient_id);
  const tokens = (tokenRows ?? []).map((r) => r.expo_push_token);
  if (tokens.length === 0) {
    return new Response(JSON.stringify({ sent: false, reason: 'No registered device' }));
  }

  const messageBody = messageFor(body.kind, actor ? displayName(actor) : 'Your opponent', challenge.name);
  const messages = tokens.map((to) => ({ to, title: 'Hound', body: messageBody, sound: 'default' }));
  await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(messages),
  }).catch(() => {
    // One failed send shouldn't surface as a 500 — same as the other jobs.
  });

  return new Response(JSON.stringify({ sent: true, recipients: tokens.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
