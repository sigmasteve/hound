// Signup alerts for admins — see 0077_admin_signup_alerts.sql.
//   'signup'  one new user just signed up (from the profiles trigger)
//   'digest'  everyone who signed up in the last 24 hours (pg_cron,
//             once a day; sends nothing if there were none)
//   'test'    a signed-in admin checking alerts reach their own phone
//             (Admin → Signup alerts → Send me a test)
// Each admin chooses which of the first two they get
// (profiles.admin_signup_push / admin_signup_digest). A failure here
// never affects the signup itself: the calling side swallows it.
//
// Deploy with the Supabase CLI:
//   supabase functions deploy send-admin-signup-alerts

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const DIGEST_WINDOW_MS = 24 * 60 * 60 * 1000;
const DIGEST_NAMES_SHOWN = 5;

type Kind = 'signup' | 'digest' | 'test';
const KINDS: Kind[] = ['signup', 'digest', 'test'];

interface PushMessage {
  title: string;
  body: string;
  data: Record<string, unknown>;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function tokensFor(supabase: SupabaseClient, userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const { data } = await supabase.from('device_push_tokens').select('expo_push_token').in('user_id', userIds);
  return (data ?? []).map((r: { expo_push_token: string }) => r.expo_push_token);
}

async function adminsWith(supabase: SupabaseClient, column: 'admin_signup_push' | 'admin_signup_digest'): Promise<string[]> {
  const { data } = await supabase.from('profiles').select('id').eq('is_admin', true).eq(column, true);
  return (data ?? []).map((r: { id: string }) => r.id);
}

async function send(tokens: string[], message: PushMessage): Promise<void> {
  const messages = tokens.map((to) => ({ to, sound: 'default', ...message }));
  for (let i = 0; i < messages.length; i += 100) {
    await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages.slice(i, i + 100)),
    }).catch(() => {
      // One failed batch shouldn't stop the rest — same as the other jobs.
    });
  }
}

function listNames(names: string[]): string {
  const shown = names.slice(0, DIGEST_NAMES_SHOWN);
  const rest = names.length - shown.length;
  if (rest > 0) return `${shown.join(', ')} and ${rest} more`;
  if (shown.length <= 2) return shown.join(' and ');
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

async function totalUsers(supabase: SupabaseClient): Promise<number | null> {
  const { count } = await supabase.from('profiles').select('id', { count: 'exact', head: true });
  return count ?? null;
}

Deno.serve(async (req) => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Postgres calls this with the service role key; a signed-in admin
  // can call it too (the test button). Anyone else gets 401.
  const authHeader = req.headers.get('Authorization') ?? '';
  const isServiceRole = authHeader === `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`;
  let callerAdminId: string | null = null;
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
    if (!caller || !callerProfile?.is_admin) return json({ error: 'Unauthorized' }, 401);
    callerAdminId = caller.id;
  }

  const body = (await req.json().catch(() => ({}))) as { kind?: Kind; user_id?: string };
  if (!body.kind || !KINDS.includes(body.kind)) return json({ error: 'Missing or invalid kind' }, 400);

  if (body.kind === 'test') {
    if (!callerAdminId) return json({ error: 'The test is sent to the signed-in admin who asks for it.' }, 400);
    const tokens = await tokensFor(supabase, [callerAdminId]);
    if (tokens.length === 0) return json({ sent: false, reason: 'No registered device for your account' });
    await send(tokens, {
      title: 'Hound admin',
      body: 'Signup alerts are working — you’ll get one like this when someone new joins.',
      data: { type: 'admin_signup_digest' },
    });
    return json({ sent: true, recipients: tokens.length });
  }

  if (body.kind === 'signup') {
    if (!body.user_id) return json({ error: 'Missing user_id' }, 400);
    const { data: newUser } = await supabase
      .from('profiles')
      .select('id, name, initials, email, created_at')
      .eq('id', body.user_id)
      .single<{ id: string; name: string; initials: string; email: string; created_at: string }>();
    if (!newUser) return json({ sent: false, reason: 'Profile not found' }, 404);

    const admins = (await adminsWith(supabase, 'admin_signup_push')).filter((id) => id !== newUser.id);
    const tokens = await tokensFor(supabase, admins);
    if (tokens.length === 0) return json({ sent: false, reason: 'No admin devices with signup alerts on' });

    const total = await totalUsers(supabase);
    await send(tokens, {
      title: 'New Hound user 🎉',
      body: `${newUser.name} (${newUser.email}) just signed up${total ? ` — that’s ${total.toLocaleString('en-US')} users` : ''}.`,
      // Enough for the app to open this person's Admin page straight
      // from the notification (RootNavigator's notification handler).
      data: {
        type: 'admin_signup',
        userId: newUser.id,
        name: newUser.name,
        initials: newUser.initials,
        email: newUser.email,
        createdAt: newUser.created_at,
      },
    });
    return json({ sent: true, recipients: tokens.length });
  }

  // digest
  const since = new Date(Date.now() - DIGEST_WINDOW_MS).toISOString();
  const { data: recent } = await supabase
    .from('profiles')
    .select('name')
    .gte('created_at', since)
    .order('created_at', { ascending: true });
  const names = (recent ?? []).map((r: { name: string }) => r.name);
  if (names.length === 0) return json({ sent: false, reason: 'No signups in the last day' });

  const tokens = await tokensFor(supabase, await adminsWith(supabase, 'admin_signup_digest'));
  if (tokens.length === 0) return json({ sent: false, reason: 'No admin devices with the daily summary on' });

  const total = await totalUsers(supabase);
  await send(tokens, {
    title: names.length === 1 ? '1 new Hound user in the last day' : `${names.length} new Hound users in the last day`,
    body: `${listNames(names)}${total ? ` · ${total.toLocaleString('en-US')} users in all` : ''}.`,
    data: { type: 'admin_signup_digest' },
  });
  return json({ sent: true, recipients: tokens.length, signups: names.length });
});
