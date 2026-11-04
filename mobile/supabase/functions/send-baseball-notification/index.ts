// Baseball pushes, called from baseball_advance and
// baseball_pick_reminders (0167_baseball.sql) via pg_net — same shape as
// send-cricket-notification:
//   - 'day'    the score from the recipient's side after last night's
//              inning, and their line: "you went 2 for 3 with a homer"
//   - 'final'  the result, and their line
//   - 'pick'   midday: aim your swing (and, for the catcher, the shift;
//              for the pitcher, Power or Finesse)
// A failure here never affects the game: the calling side swallows it.
//
// Deploy with the Supabase CLI:
//   supabase functions deploy send-baseball-notification

import { createClient } from 'jsr:@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

type Kind = 'day' | 'final' | 'pick';
const KINDS: Kind[] = ['day', 'final', 'pick'];
type Team = 'a' | 'b';

interface RequestBody {
  kind: Kind;
  challenge_id: string;
  recipient_id: string;
  inning?: number;
  innings?: number;
  runs_a?: number;
  runs_b?: number;
  home_team?: Team;
  winner_team?: Team | null;
  status?: 'active' | 'final';
  team?: Team;
  ab?: number;
  h?: number;
  hr?: number;
  rbi?: number;
  catcher?: boolean;
  pitcher?: boolean;
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${s}`;
}

// "You went 2 for 3 with a homer and 2 RBIs." Empty with no at-bats.
function lineFor(b: RequestBody): string {
  const ab = b.ab ?? 0;
  if (ab === 0) return '';
  const extras: string[] = [];
  if ((b.hr ?? 0) > 0) extras.push(b.hr === 1 ? 'a homer' : `${b.hr} homers`);
  if ((b.rbi ?? 0) > 0) extras.push(b.rbi === 1 ? '1 RBI' : `${b.rbi} RBIs`);
  return ` You went ${b.h ?? 0} for ${ab}${extras.length ? ` with ${extras.join(' and ')}` : ''}.`;
}

function messageFor(body: RequestBody, team: Team, game: string): string {
  if (body.kind === 'pick') {
    const extra = body.catcher ? ' and call the shift' : body.pitcher ? ' and pick Power or Finesse' : '';
    return `"${game}": aim your swing for tonight's ${ordinal(body.inning ?? 1)} inning${extra}.`;
  }
  const us = team === 'a' ? body.runs_a ?? 0 : body.runs_b ?? 0;
  const them = team === 'a' ? body.runs_b ?? 0 : body.runs_a ?? 0;
  if (body.kind === 'final') {
    if (!body.winner_team) return `"${game}" ends in a ${us}–${them} tie after extra innings.${lineFor(body)}`;
    return body.winner_team === team
      ? `Your side won "${game}" ${us}–${them}! ⚾🏆${lineFor(body)}`
      : `"${game}" is over: you lost ${us}–${them}.${lineFor(body)} Rematch?`;
  }
  const after = ordinal(body.inning ?? 1);
  const where = us > them ? `You lead ${us}–${them}` : us < them ? `You trail ${us}–${them}` : `It's ${us}–${them}`;
  return `"${game}": ${where} after the ${after}.${lineFor(body)} Aim today's swing in the app.`;
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

  const [{ data: challenge }, { data: recipient }, { data: seat }] = await Promise.all([
    supabase.from('challenges').select('name').eq('id', body.challenge_id).single(),
    supabase.from('profiles').select('notify_push_enabled').eq('id', body.recipient_id).single<{ notify_push_enabled: boolean }>(),
    supabase.from('baseball_players').select('team').eq('challenge_id', body.challenge_id).eq('user_id', body.recipient_id).maybeSingle<{ team: Team }>(),
  ]);

  if (!challenge || !recipient || !seat) {
    return new Response(JSON.stringify({ sent: false, reason: 'Challenge, profile or seat not found' }), { status: 404 });
  }
  if (!recipient.notify_push_enabled) {
    return new Response(JSON.stringify({ sent: false, reason: 'Push disabled for this user' }));
  }

  const { data: tokenRows } = await supabase.from('device_push_tokens').select('expo_push_token').eq('user_id', body.recipient_id);
  const tokens = (tokenRows ?? []).map((r) => r.expo_push_token);
  if (tokens.length === 0) {
    return new Response(JSON.stringify({ sent: false, reason: 'No registered device' }));
  }

  const messageBody = messageFor(body, seat.team, challenge.name);
  const messages = tokens.map((to) => ({ to, title: 'Hound', body: messageBody, sound: 'default', data: { challengeId: body.challenge_id } }));
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
