// Push notifications for friend requests — a real gap found while
// reviewing the app, not a deliberate omission (see 0065's own
// comment): sending a request already emails via send-friend-request-email,
// but nothing pushed either side of a new request or an acceptance.
// Called from inside 0065_friend_push_notifications.sql's own
// friendships triggers via pg_net (friend_notify), same shape as
// send-tag-notification/send-tictacgo-notification:
//   'request'  the actor sent the recipient a friend request
//   'accepted' the actor (the original recipient) accepted the
//              recipient's (the original requester's) request
// A failure here never affects the friendship write: the calling side
// swallows it.
//
// Deploy with the Supabase CLI:
//   supabase functions deploy send-friend-push-notification

import { createClient } from 'jsr:@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

type Kind = 'request' | 'accepted';
const KINDS: Kind[] = ['request', 'accepted'];

interface RequestBody {
  kind: Kind;
  friendship_id: string;
  recipient_id: string;
  actor_id: string;
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

function messageFor(kind: Kind, actor: string): string {
  switch (kind) {
    case 'request':
      return `${actor} sent you a friend request.`;
    case 'accepted':
      return `${actor} accepted your friend request.`;
  }
}

Deno.serve(async (req) => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Postgres calls this with the service role key; a signed-in admin
  // can also fire it by hand for testing. Anyone else gets 401.
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
  if (!body?.friendship_id || !body?.recipient_id || !body?.actor_id || !KINDS.includes(body.kind)) {
    return new Response(JSON.stringify({ error: 'Missing or invalid fields' }), { status: 400 });
  }

  const [{ data: recipient }, { data: actor }] = await Promise.all([
    supabase
      .from('profiles')
      .select('name, username, use_username, notify_push_enabled')
      .eq('id', body.recipient_id)
      .single<ProfileRow>(),
    supabase
      .from('profiles')
      .select('name, username, use_username, notify_push_enabled')
      .eq('id', body.actor_id)
      .single<ProfileRow>(),
  ]);

  if (!recipient) {
    return new Response(JSON.stringify({ sent: false, reason: 'Profile not found' }), { status: 404 });
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

  const messageBody = messageFor(body.kind, actor ? displayName(actor) : 'Someone');
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
