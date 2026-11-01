// Event-driven Rally pushes, called from inside the game's own Postgres
// functions via pg_net (0139_rally.sql's rally_notify) — same shape as
// send-tictacgo-notification:
//   - 'started'     the opponent joined; the shuttle is on the recipient's
//                   side (or they served, when the recipient is the creator)
//   - 'your_shot'   the actor returned; the recipient's return now
//   - 'smashed'     the actor landed a smash; the recipient's target doubled
//   - 'point_lost'  the recipient missed a return; they receive the next serve
//   - 'point_won'   the actor missed; a point to the recipient
//   - 'game_lost' / 'game_won'   the same, and the game ended on it
//   - 'match_over'  two games to one team; winner_team says which
//   - 'time_up'     the challenge ran out; winner_team, or null for a draw
// In doubles, point and game pushes go to both partners; returner_id
// says which of them the return now sits with.
// A failure here never affects the game: the calling side swallows it.
//
// Deploy with the Supabase CLI:
//   supabase functions deploy send-rally-notification

import { createClient } from 'jsr:@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

type Kind = 'started' | 'your_shot' | 'smashed' | 'point_lost' | 'point_won' | 'game_lost' | 'game_won' | 'match_over' | 'time_up';
const KINDS: Kind[] = ['started', 'your_shot', 'smashed', 'point_lost', 'point_won', 'game_lost', 'game_won', 'match_over', 'time_up'];

interface RequestBody {
  kind: Kind;
  challenge_id: string;
  recipient_id: string;
  actor_id?: string | null;
  target_steps?: number;
  due_at?: string;
  walked?: number;
  points_a?: number;
  points_b?: number;
  games_a?: number;
  games_b?: number;
  winner_team?: 'a' | 'b' | null;
  returner_id?: string | null;
}

interface ProfileRow {
  name: string;
  username: string | null;
  use_username: boolean;
  notify_push_enabled: boolean;
  time_zone: string | null;
}

// Same rule as send-tag-notification's own copy — Edge Functions can't
// import from mobile/src.
function displayName(p: { name: string; username: string | null; use_username: boolean }): string {
  return p.use_username && p.username ? p.username : p.name;
}

// "by 4:30 PM", or "by 4:30 PM tomorrow", in the recipient's own time zone.
function byWhen(dueAt: string | undefined, timeZone: string | null): string {
  if (!dueAt) return '';
  const due = new Date(dueAt);
  const tz = timeZone ?? 'UTC';
  const time = due.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
  const dayOf = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: tz });
  const tomorrow = dayOf(due) !== dayOf(new Date());
  return ` by ${time}${tomorrow ? ' tomorrow' : ''}`;
}

function messageFor(body: RequestBody, actor: string, game: string, recipient: ProfileRow, recipientTeam: 'a' | 'b' | null, returner: string | null): string {
  const steps = (n: number | undefined) => `${(n ?? 0).toLocaleString('en-US')} steps`;
  const due = byWhen(body.due_at, recipient.time_zone);
  const score = body.points_a != null && body.points_b != null ? ` ${body.points_a}–${body.points_b}.` : '';
  const games = body.games_a != null && body.games_b != null ? `${body.games_a}–${body.games_b}` : '';
  const won = body.winner_team != null && body.winner_team === recipientTeam;
  // In doubles the return may sit with the recipient's partner.
  const mine = !body.returner_id || body.returner_id === body.recipient_id;
  const whose = mine ? 'Your shot' : `${returner ?? 'Your partner'}'s shot`;
  switch (body.kind) {
    case 'started':
      return `${actor} is in "${game}". The rally is on: ${mine ? 'you return' : `${returner ?? 'your partner'} returns`} the serve with ${steps(body.target_steps)}${due}.`;
    case 'your_shot':
      return `${actor} returned in "${game}" with ${steps(body.walked)}. Your shot: ${steps(body.target_steps)}${due}.`;
    case 'smashed':
      return `Smash! ${actor} doubled your return in "${game}": ${steps(body.target_steps)}${due}.`;
    case 'point_lost':
      return `Point to ${actor} in "${game}".${score} ${whose}: ${steps(body.target_steps)}${due}.`;
    case 'point_won':
      return `${actor} missed in "${game}". Point to you.${score}`;
    case 'game_lost':
      return `${actor} took game ${(body.games_a ?? 0) + (body.games_b ?? 0)} in "${game}". Next game, ${whose.toLowerCase()}: ${steps(body.target_steps)}${due}.`;
    case 'game_won':
      return `You took game ${(body.games_a ?? 0) + (body.games_b ?? 0)} in "${game}"! Games ${games}.`;
    case 'match_over':
      return won ? `You won "${game}" ${games} in games! 🏆` : `${actor} won "${game}" ${games} in games. Rematch?`;
    case 'time_up':
      return body.winner_team == null
        ? `Time's up in "${game}" — a draw.`
        : won
          ? `Time's up in "${game}" — your side was ahead and wins! 🏆`
          : `Time's up in "${game}" — ${actor}'s side was ahead.`;
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

  const profileCols = 'name, username, use_username, notify_push_enabled, time_zone';
  const [{ data: challenge }, { data: recipient }, { data: actor }, { data: players }, { data: returnerRow }, { data: bots }] = await Promise.all([
    supabase.from('challenges').select('name').eq('id', body.challenge_id).single(),
    supabase.from('profiles').select(profileCols).eq('id', body.recipient_id).single<ProfileRow>(),
    body.actor_id
      ? supabase.from('profiles').select(profileCols).eq('id', body.actor_id).maybeSingle<ProfileRow>()
      : Promise.resolve({ data: null }),
    supabase.from('rally_players').select('user_id, team').eq('challenge_id', body.challenge_id),
    body.returner_id && body.returner_id !== body.recipient_id
      ? supabase.from('profiles').select(profileCols).eq('id', body.returner_id).maybeSingle<ProfileRow>()
      : Promise.resolve({ data: null }),
    // The actor or the returner may be a bot (0140_rally_bots.sql), which
    // has a name but no profile.
    supabase.from('challenge_bots').select('id, name').eq('challenge_id', body.challenge_id),
  ]);
  const botName = (id: string | null | undefined) => ((bots ?? []) as { id: string; name: string }[]).find((b) => b.id === id)?.name ?? null;
  const recipientTeam = ((players ?? []) as { user_id: string; team: 'a' | 'b' }[]).find((p) => p.user_id === body.recipient_id)?.team ?? null;

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

  const messageBody = messageFor(
    body,
    actor ? displayName(actor) : (botName(body.actor_id) ?? 'Your opponent'),
    challenge.name,
    recipient,
    recipientTeam,
    returnerRow ? displayName(returnerRow) : botName(body.returner_id),
  );
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
