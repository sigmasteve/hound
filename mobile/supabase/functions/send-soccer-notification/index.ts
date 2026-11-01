// Soccer pushes, called from soccer_advance (0142_soccer.sql) via pg_net
// once a day has been resolved — same shape as send-rally-notification:
//   - 'day'    a day's report: the score, today's goals, shots and saves
//   - 'final'  the last day: who won, or a draw
// Scores arrive as team A / team B; the recipient's own side is looked up
// so the message reads from their point of view. A failure here never
// affects the match: the calling side swallows it.
//
// Deploy with the Supabase CLI:
//   supabase functions deploy send-soccer-notification

import { createClient } from 'jsr:@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

type Kind = 'day' | 'final';
const KINDS: Kind[] = ['day', 'final'];

interface RequestBody {
  kind: Kind;
  challenge_id: string;
  recipient_id: string;
  day_no: number;
  days: number;
  goals_a: number;
  goals_b: number;
  today_a: number;
  today_b: number;
  shots_a: number;
  shots_b: number;
  on_target_a: number;
  on_target_b: number;
  saves_a: number;
  saves_b: number;
  winner_team?: 'a' | 'b' | null;
}

interface ProfileRow {
  notify_push_enabled: boolean;
}

function messageFor(body: RequestBody, team: 'a' | 'b', game: string): string {
  const mine = team === 'a';
  const us = mine ? body.goals_a : body.goals_b;
  const them = mine ? body.goals_b : body.goals_a;
  const usToday = mine ? body.today_a : body.today_b;
  const themToday = mine ? body.today_b : body.today_a;
  const ourShots = mine ? body.shots_a : body.shots_b;
  const ourOn = mine ? body.on_target_a : body.on_target_b;
  const ourSaves = mine ? body.saves_a : body.saves_b;
  const clock = Math.round((90 * body.day_no) / Math.max(1, body.days));
  const standing = us > them ? `You lead ${us}–${them}` : us < them ? `You trail ${us}–${them}` : `Level at ${us}–${them}`;
  const today = `Today ${usToday}–${themToday}: ${ourShots} shot${ourShots === 1 ? '' : 's'}, ${ourOn} on target, ${ourSaves} save${ourSaves === 1 ? '' : 's'} at your end.`;
  if (body.kind === 'final') {
    const result = body.winner_team == null ? `"${game}" ends ${us}–${them}, a draw.` : body.winner_team === team ? `You won "${game}" ${us}–${them}! 🏆` : `"${game}" ends ${us}–${them}. Rematch?`;
    return `Full time. ${result}`;
  }
  return `${clock}' in "${game}". ${standing}. ${today}`;
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
    supabase.from('profiles').select('notify_push_enabled').eq('id', body.recipient_id).single<ProfileRow>(),
    supabase.from('soccer_players').select('team').eq('challenge_id', body.challenge_id).eq('user_id', body.recipient_id).maybeSingle<{ team: 'a' | 'b' }>(),
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
