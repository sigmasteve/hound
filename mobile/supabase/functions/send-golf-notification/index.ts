// Golf pushes, called from 0200_golf.sql via pg_net (golf_notify):
//   - 'birdie'    someone else in your game made a birdie or better
//                 ("Ann birdied the 3rd at Seaside Links")
//   - 'ace'       someone else in your game made a hole in one
//   - 'reminder'  early evening, once a day, when you've 300+ yards banked
//                 and a hole you can play today (golf_reminders)
//   - 'skin'      you won a skin (golf_settle_skins)
//   - 'final'     the round's over: who won, and your score
//   - 'top10'     a Global Golf (the Hound Open): you've moved into the top
//                 10, once (0202's golf_strike, once the field's 20+)
// Every push carries { type: 'golf', challengeId } so a tap opens the game.
// A failure here never affects the game: the caller swallows it.
//
// Deploy with the Supabase CLI:
//   supabase functions deploy send-golf-notification

import { createClient } from 'jsr:@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

type Kind = 'birdie' | 'ace' | 'reminder' | 'skin' | 'final' | 'top10';
const KINDS: Kind[] = ['birdie', 'ace', 'reminder', 'skin', 'final', 'top10'];

interface RequestBody {
  kind: Kind;
  challenge_id: string;
  recipient_id: string;
  course_name?: string;
  // birdie / ace
  player_id?: string;
  player_name?: string;
  hole?: number;
  to_par?: number;
  score?: number;
  // reminder
  yards?: number;
  // skin
  bones?: number;
  // final
  winner_id?: string | null;
  winner_name?: string | null;
  total?: number;
  // top10
  pos?: number;
  tied?: boolean;
  thru?: number;
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

function toPar(n: number): string {
  return n === 0 ? 'even par' : n > 0 ? `${n} over par` : `${-n} under par`;
}

function made(toParOnHole: number): string {
  if (toParOnHole <= -3) return 'made an albatross on';
  if (toParOnHole === -2) return 'eagled';
  return 'birdied';
}

function message(body: RequestBody, me: string, game: string): { title: string; text: string } {
  const at = body.course_name ? ` at ${body.course_name}` : '';
  const hole = body.hole ? `the ${ordinal(body.hole)}` : 'a hole';
  const who = body.player_name ?? 'Someone';
  switch (body.kind) {
    case 'ace':
      return { title: 'Hole in one!', text: `${who} made a hole in one on ${hole}${at}! ⛳️ ("${game}")` };
    case 'birdie':
      return { title: 'Golf', text: `${who} ${made(body.to_par ?? -1)} ${hole}${at}. ("${game}")` };
    case 'reminder': {
      const yards = (body.yards ?? 0).toLocaleString('en-US');
      return { title: 'Golf', text: `${yards} yards banked in "${game}". Hole ${body.hole ?? 1} is waiting.` };
    }
    case 'skin':
      return { title: 'Skins', text: `You won the skin on ${hole} in "${game}": ${body.bones ?? 0} Bones.` };
    case 'top10': {
      const place = `${body.tied ? 'T' : ''}${body.pos ?? 10}`;
      const thru = body.thru ? ` after ${body.thru} ${body.thru === 1 ? 'hole' : 'holes'}` : '';
      return { title: game, text: `You're into the top 10: ${place}${thru}. Keep going.` };
    }
    case 'final': {
      const score = body.total != null && body.to_par != null ? ` You shot ${body.total} (${toPar(body.to_par)}).` : '';
      if (!body.winner_id) return { title: 'Golf', text: `"${game}" is over: it's a tie.${score}` };
      if (body.winner_id === me) return { title: 'Golf', text: `You win "${game}"! 🏆${score}` };
      return { title: 'Golf', text: `${body.winner_name ?? 'Someone'} wins "${game}".${score}` };
    }
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
    const { data: callerProfile } = caller ? await supabase.from('profiles').select('is_admin').eq('id', caller.id).single() : { data: null };
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
    supabase.from('golf_players').select('joined').eq('challenge_id', body.challenge_id).eq('user_id', body.recipient_id).maybeSingle<{ joined: boolean }>(),
  ]);
  if (!challenge || !recipient) {
    return new Response(JSON.stringify({ sent: false, reason: 'Challenge or profile not found' }), { status: 404 });
  }
  if (!seat?.joined) {
    return new Response(JSON.stringify({ sent: false, reason: 'Not playing in this game' }), { status: 404 });
  }
  if (!recipient.notify_push_enabled) {
    return new Response(JSON.stringify({ sent: false, reason: 'Push disabled for this user' }));
  }

  const { title, text } = message(body, body.recipient_id, challenge.name);

  const { data: tokenRows } = await supabase.from('device_push_tokens').select('expo_push_token').eq('user_id', body.recipient_id);
  const tokens = (tokenRows ?? []).map((r: { expo_push_token: string }) => r.expo_push_token);
  if (tokens.length === 0) {
    return new Response(JSON.stringify({ sent: false, reason: 'No registered device' }));
  }

  const data = { type: 'golf', challengeId: body.challenge_id };
  const messages = tokens.map((to) => ({ to, title, body: text, sound: 'default', data }));
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
