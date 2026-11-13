// Hoops and H-O-R-S-E pushes, called from hoops_advance / horse_advance
// (0195_hoops.sql, 0196_horse.sql) via pg_net once a day has been played,
// and from hoops_pick_reminders in the afternoon:
//   - 'quarter'       a Hoops quarter's report: the score, the day's best play
//   - 'final'         the end of a Hoops game: who won, or a tie
//   - 'pick'          afternoon, to a player who hasn't picked a shot or voted
//   - 'horse_result'  a H-O-R-S-E day: made, matched, or a letter
//   - 'horse_final'   the end of a H-O-R-S-E game
// Every push carries { type: 'hoops' | 'horse', challengeId } so a tap opens
// the game. A failure here never affects the game: the caller swallows it.
//
// Deploy with the Supabase CLI:
//   supabase functions deploy send-hoops-notification

import { createClient } from 'jsr:@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

type Kind = 'quarter' | 'final' | 'pick' | 'horse_result' | 'horse_final';
const KINDS: Kind[] = ['quarter', 'final', 'pick', 'horse_result', 'horse_final'];

interface RequestBody {
  kind: Kind;
  challenge_id: string;
  recipient_id: string;
  // Hoops.
  label?: string;
  home_name?: string;
  away_name?: string;
  score_home?: number;
  score_away?: number;
  today_home?: number;
  today_away?: number;
  winner_team?: 'home' | 'away' | null;
  highlight?: string | null;
  shot?: 'drive' | 'mid' | 'three';
  // H-O-R-S-E.
  word?: string;
  setter_id?: string;
  matcher_id?: string;
  setter_name?: string;
  matcher_name?: string;
  shot_name?: string;
  target?: number;
  made?: boolean;
  matched?: boolean | null;
  letter_to?: string | null;
  letters?: Record<string, number>;
  winner?: string | null;
  next_setter?: string;
}

const SHOT_NAME = { drive: 'driving', mid: 'shooting mid-range', three: 'shooting threes' } as const;

function spell(word: string, n: number): string {
  return n <= 0 ? 'no letters' : word.slice(0, n).split('').join('-');
}

function hoopsMessage(body: RequestBody, team: 'home' | 'away', game: string): string {
  if (body.kind === 'pick') {
    const how = body.shot ? SHOT_NAME[body.shot] : 'driving';
    return `${body.label ?? 'Today'} in "${game}": you're ${how}. Pick your shot and vote on defense before midnight.`;
  }
  const mine = team === 'home';
  const us = (mine ? body.score_home : body.score_away) ?? 0;
  const them = (mine ? body.score_away : body.score_home) ?? 0;
  const ourName = (mine ? body.home_name : body.away_name) ?? 'You';
  const theirName = (mine ? body.away_name : body.home_name) ?? 'them';
  const usToday = (mine ? body.today_home : body.today_away) ?? 0;
  const themToday = (mine ? body.today_away : body.today_home) ?? 0;
  const highlight = body.highlight ? ` ${body.highlight}` : '';
  if (body.kind === 'final') {
    if (body.winner_team == null) return `Final in "${game}": ${us}–${them}, a tie.${highlight}`;
    return body.winner_team === team
      ? `Final: the ${ourName} win "${game}" ${us}–${them}! 🏆${highlight}`
      : `Final: the ${theirName} take "${game}" ${them}–${us}. Rematch?${highlight}`;
  }
  const standing = us > them ? `${ourName} lead ${us}–${them}` : us < them ? `${ourName} trail ${us}–${them}` : `Level at ${us}–${them}`;
  return `${body.label ?? 'Last night'} in "${game}": ${usToday}–${themToday}. ${standing}.${highlight}`;
}

function horseMessage(body: RequestBody, me: string, game: string): string {
  const word = body.word ?? 'HORSE';
  const letters = body.letters ?? {};
  const mine = letters[me] ?? 0;
  const otherId = me === body.setter_id ? body.matcher_id : body.setter_id;
  const theirs = otherId ? (letters[otherId] ?? 0) : 0;
  const shot = body.shot_name ?? 'shot';
  const iSet = me === body.setter_id;
  const other = iSet ? body.matcher_name : body.setter_name;
  let what: string;
  if (!body.made) {
    what = iSet ? `Your ${shot} missed. ${other} sets the next one.` : `${other}'s ${shot} missed. You set the next one.`;
  } else if (body.matched) {
    what = iSet ? `${other} matched your ${shot}.` : `You matched ${other}'s ${shot}.`;
  } else {
    what = body.letter_to === me ? `You couldn't match ${other}'s ${shot}: a letter.` : `${other} couldn't match your ${shot}: a letter.`;
  }
  if (body.kind === 'horse_final') {
    const result = body.winner == null ? "It's a tie." : body.winner === me ? 'You win! 🏆' : `${other} wins.`;
    return `"${game}" is over. ${what} ${result}`;
  }
  return `"${game}": ${what} You're on ${spell(word, mine)}, ${other} on ${spell(word, theirs)}.`;
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
  const horse = body.kind === 'horse_result' || body.kind === 'horse_final';

  const [{ data: challenge }, { data: recipient }] = await Promise.all([
    supabase.from('challenges').select('name').eq('id', body.challenge_id).single(),
    supabase.from('profiles').select('notify_push_enabled').eq('id', body.recipient_id).single<{ notify_push_enabled: boolean }>(),
  ]);
  if (!challenge || !recipient) {
    return new Response(JSON.stringify({ sent: false, reason: 'Challenge or profile not found' }), { status: 404 });
  }
  if (!recipient.notify_push_enabled) {
    return new Response(JSON.stringify({ sent: false, reason: 'Push disabled for this user' }));
  }

  let messageBody: string;
  if (horse) {
    messageBody = horseMessage(body, body.recipient_id, challenge.name);
  } else {
    const { data: seat } = await supabase
      .from('hoops_players')
      .select('team')
      .eq('challenge_id', body.challenge_id)
      .eq('user_id', body.recipient_id)
      .maybeSingle<{ team: 'home' | 'away' }>();
    if (!seat) {
      return new Response(JSON.stringify({ sent: false, reason: 'No seat in this game' }), { status: 404 });
    }
    messageBody = hoopsMessage(body, seat.team, challenge.name);
  }

  const { data: tokenRows } = await supabase.from('device_push_tokens').select('expo_push_token').eq('user_id', body.recipient_id);
  const tokens = (tokenRows ?? []).map((r: { expo_push_token: string }) => r.expo_push_token);
  if (tokens.length === 0) {
    return new Response(JSON.stringify({ sent: false, reason: 'No registered device' }));
  }

  const data = { type: horse ? 'horse' : 'hoops', challengeId: body.challenge_id };
  const messages = tokens.map((to) => ({ to, title: horse ? 'H-O-R-S-E' : 'Hoops', body: messageBody, sound: 'default', data }));
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
