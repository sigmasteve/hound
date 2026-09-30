// Pushes for nudges and challenge reactions (0082_nudges_reactions.sql),
// called from inside send_nudge / toggle_reaction via pg_net
// (social_notify):
//   'nudge'     "Jordan nudged you 👋"
//   'reaction'  "Jordan reacted 🔥 to your progress in Week Race"
// The RPC has already checked who can nudge or react, and that the
// recipient has these pushes on; a failure here never undoes the nudge
// or reaction — the calling side swallows it.
//
// Deploy with the Supabase CLI:
//   supabase functions deploy send-social-push

import { createClient } from 'jsr:@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EMOJI = ['🔥', '💪', '👏', '😮'];

type Kind = 'nudge' | 'reaction';

interface RequestBody {
  kind: Kind;
  from_user: string;
  to_user: string;
  challenge_id: string | null;
  emoji?: string;
}

interface ProfileRow {
  name: string;
  initials: string;
  username: string | null;
  use_username: boolean;
  alert_social_push_enabled: boolean;
  equipped_frame_id: string | null;
  equipped_background_id: string | null;
  equipped_icon_id: string | null;
}

const PROFILE_COLUMNS =
  'name, initials, username, use_username, alert_social_push_enabled, equipped_frame_id, equipped_background_id, equipped_icon_id';

// Same rule as send-tag-notification's own copy — Edge Functions can't
// import from mobile/src.
function displayName(p: { name: string; username: string | null; use_username: boolean }): string {
  return p.use_username && p.username ? p.username : p.name;
}

Deno.serve(async (req) => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Only Postgres calls this — with the service role key.
  const authHeader = req.headers.get('Authorization') ?? '';
  if (authHeader !== `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const body = (await req.json()) as RequestBody;
  if (
    !body?.from_user ||
    !body?.to_user ||
    (body.kind !== 'nudge' && body.kind !== 'reaction') ||
    (body.kind === 'reaction' && (!body.challenge_id || !EMOJI.includes(body.emoji ?? '')))
  ) {
    return new Response(JSON.stringify({ error: 'Missing or invalid fields' }), { status: 400 });
  }

  const [{ data: recipient }, { data: sender }, { data: challenge }] = await Promise.all([
    supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', body.to_user).single<ProfileRow>(),
    supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', body.from_user).single<ProfileRow>(),
    body.challenge_id
      ? supabase.from('challenges').select('name').eq('id', body.challenge_id).single<{ name: string }>()
      : Promise.resolve({ data: null }),
  ]);

  if (!recipient || !sender) {
    return new Response(JSON.stringify({ sent: false, reason: 'Profile not found' }), { status: 404 });
  }
  if (!recipient.alert_social_push_enabled) {
    return new Response(JSON.stringify({ sent: false, reason: 'Turned off by the recipient' }));
  }

  const { data: tokenRows } = await supabase
    .from('device_push_tokens')
    .select('expo_push_token')
    .eq('user_id', body.to_user);
  const tokens = (tokenRows ?? []).map((r) => r.expo_push_token);
  if (tokens.length === 0) {
    return new Response(JSON.stringify({ sent: false, reason: 'No registered device' }));
  }

  const name = displayName(sender);
  const challengeName = challenge?.name ?? null;
  const messageBody =
    body.kind === 'nudge'
      ? challengeName
        ? `${name} nudged you in ${challengeName} 👋 Time to get moving!`
        : `${name} nudged you 👋 Time to get moving!`
      : `${name} reacted ${body.emoji} to your progress${challengeName ? ` in ${challengeName}` : ''}.`;

  // Lets the app open the right screen when the push is tapped
  // (src/notifications/notificationTaps.ts): the challenge it came from,
  // or the sender's profile for a nudge from their friend page.
  const data = {
    type: body.kind,
    challengeId: body.challenge_id,
    fromUserId: body.from_user,
    fromName: name,
    fromInitials: sender.initials ?? '?',
    fromFrameId: sender.equipped_frame_id,
    fromBackgroundId: sender.equipped_background_id,
    fromIconId: sender.equipped_icon_id,
  };
  const messages = tokens.map((to) => ({ to, title: 'Hound', body: messageBody, sound: 'default', data }));
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
