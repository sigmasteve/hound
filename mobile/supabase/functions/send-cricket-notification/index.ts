// Cricket pushes, called from cricket_advance (0147_cricket.sql) via
// pg_net once overs have been played — same shape as
// send-soccer-notification:
//   - 'day'    the score from the recipient's side, and who's on today:
//              "you're on strike against Blaze" or "you're bowling to Ann"
//   - 'final'  the result
// A failure here never affects the match: the calling side swallows it.
//
// Deploy with the Supabase CLI:
//   supabase functions deploy send-cricket-notification

import { createClient } from 'jsr:@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

type Kind = 'day' | 'final';
const KINDS: Kind[] = ['day', 'final'];
type Team = 'a' | 'b';

interface RequestBody {
  kind: Kind;
  challenge_id: string;
  recipient_id: string;
  innings: number;
  runs_a: number;
  wickets_a: number;
  balls_a: number;
  runs_b: number;
  wickets_b: number;
  balls_b: number;
  target: number | null;
  winner_team: Team | null;
  result: 'chased' | 'defended' | 'tie' | null;
  batting_first: Team;
  batter_id: string | null;
  bowler_id: string | null;
  over_no: number | null;
}

const overs = (balls: number) => `${Math.floor(balls / 6)}.${balls % 6}`;

function displayName(p: { name: string; username: string | null; use_username: boolean }): string {
  return p.use_username && p.username ? p.username : p.name;
}

function messageFor(body: RequestBody, team: Team, game: string, nameOf: (id: string | null) => string): string {
  const mine = (t: Team) => (t === 'a' ? `${body.runs_a}/${body.wickets_a} (${overs(body.balls_a)})` : `${body.runs_b}/${body.wickets_b} (${overs(body.balls_b)})`);
  if (body.kind === 'final') {
    if (body.result === 'tie') return `"${game}" is a tie, scores level. What a finish.`;
    const won = body.winner_team === team;
    const margin = body.result === 'defended' ? ` by ${(body.target ?? 0) - 1 - (body.winner_team === 'a' ? body.runs_b : body.runs_a)} runs` : ' chasing it down';
    return won ? `Your side won "${game}"${margin}! 🏏🏆` : `"${game}" is over: the other side won${margin}. Rematch?`;
  }
  const chasing = body.innings === 2 && body.target != null;
  const batting: Team = body.innings === 1 ? body.batting_first : body.batting_first === 'a' ? 'b' : 'a';
  const score =
    chasing
      ? `${batting === team ? 'You' : 'They'}'re ${mine(batting)}, chasing ${body.target}.`
      : `${batting === team ? 'You' : 'They'}'re ${mine(batting)}.${batting === team ? '' : ` You chase next.`}`;
  let duty = '';
  if (body.batter_id === body.recipient_id) duty = ` Today you're on strike against ${nameOf(body.bowler_id)}: out-walk them.`;
  else if (body.bowler_id === body.recipient_id) duty = ` Today you're bowling to ${nameOf(body.batter_id)}: out-walk them for wickets.`;
  return `"${game}": ${score}${duty}`;
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

  const ids = [body.batter_id, body.bowler_id].filter((x): x is string => !!x);
  const [{ data: challenge }, { data: recipient }, { data: seat }, { data: people }, { data: bots }] = await Promise.all([
    supabase.from('challenges').select('name').eq('id', body.challenge_id).single(),
    supabase.from('profiles').select('notify_push_enabled').eq('id', body.recipient_id).single<{ notify_push_enabled: boolean }>(),
    supabase.from('cricket_players').select('team').eq('challenge_id', body.challenge_id).eq('user_id', body.recipient_id).maybeSingle<{ team: Team }>(),
    ids.length ? supabase.from('profiles').select('id, name, username, use_username').in('id', ids) : Promise.resolve({ data: [] }),
    supabase.from('challenge_bots').select('id, name').eq('challenge_id', body.challenge_id),
  ]);

  if (!challenge || !recipient || !seat) {
    return new Response(JSON.stringify({ sent: false, reason: 'Challenge, profile or seat not found' }), { status: 404 });
  }
  if (!recipient.notify_push_enabled) {
    return new Response(JSON.stringify({ sent: false, reason: 'Push disabled for this user' }));
  }

  const nameOf = (id: string | null) => {
    if (!id) return 'them';
    const p = ((people ?? []) as { id: string; name: string; username: string | null; use_username: boolean }[]).find((x) => x.id === id);
    if (p) return displayName(p);
    return ((bots ?? []) as { id: string; name: string }[]).find((b) => b.id === id)?.name ?? 'them';
  };

  const { data: tokenRows } = await supabase.from('device_push_tokens').select('expo_push_token').eq('user_id', body.recipient_id);
  const tokens = (tokenRows ?? []).map((r) => r.expo_push_token);
  if (tokens.length === 0) {
    return new Response(JSON.stringify({ sent: false, reason: 'No registered device' }));
  }

  const messageBody = messageFor(body, seat.team, challenge.name, nameOf);
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
