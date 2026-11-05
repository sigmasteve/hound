// Pack Wars pushes, called from pack_push (0174_pack_wars.sql) via pg_net,
// one call per pack per live challenge with everyone it's for:
//   'morning'  how the pack did overnight: "Your Wolves took 2 territories
//              overnight and hold 7. Vote today's march."
//   'evening'  to those who haven't voted today: "Your pack marches
//              tonight. Vote before midnight or your steps sit this one out."
// A failure here never affects the game: the calling side swallows it.
//
// Deploy with the Supabase CLI:
//   supabase functions deploy send-packs-notification

import { createClient } from 'jsr:@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
// Expo takes up to 100 messages a request.
const BATCH = 100;

type Kind = 'morning' | 'evening';
const KINDS: Kind[] = ['morning', 'evening'];
type Pack = 'wolves' | 'goldens' | 'collies' | 'beagles';
const PACK_NAME: Record<Pack, string> = {
  wolves: 'Wolves',
  goldens: 'Golden Retrievers',
  collies: 'Border Collies',
  beagles: 'Beagles',
};

interface RequestBody {
  kind: Kind;
  challenge_id: string;
  pack: Pack;
  recipient_ids: string[];
  took?: number;
  lost?: number;
  held?: number;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function messageFor(b: RequestBody, game: string): string {
  const pack = PACK_NAME[b.pack] ?? 'pack';
  if (b.kind === 'evening') {
    return `"${game}": your ${pack} march tonight. Vote before midnight or your steps sit this one out.`;
  }
  const took = b.took ?? 0;
  const lost = b.lost ?? 0;
  const held = b.held ?? 0;
  const night =
    took > 0 && lost > 0
      ? `took ${plural(took, 'territory', 'territories')} and lost ${lost}`
      : took > 0
        ? `took ${plural(took, 'territory', 'territories')}`
        : lost > 0
          ? `lost ${plural(lost, 'territory', 'territories')}`
          : 'held the line';
  return `"${game}": your ${pack} ${night} overnight and hold ${held}. Vote today's march. 🐺`;
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
  if (!body?.challenge_id || !KINDS.includes(body.kind) || !Array.isArray(body.recipient_ids) || !PACK_NAME[body.pack]) {
    return new Response(JSON.stringify({ error: 'Missing or invalid fields' }), { status: 400 });
  }

  const { data: challenge } = await supabase.from('challenges').select('name').eq('id', body.challenge_id).single();
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

  const text = messageFor(body, challenge.name);
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
