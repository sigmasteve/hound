// Runs once a day on a schedule (see 0010_login_reminders.sql's pg_cron
// job) — no signed-in user drives this, so unlike send-invite-email it
// authenticates with the service role key, not a caller's JWT.
//
// For every profile that hasn't been active since UTC midnight and has
// at least one reminder channel turned on, sends:
//   - a push notification, via Expo's push API, to every device token
//     registered for that user (see device_push_tokens / src/notifications)
//   - an email, via Resend, reusing the same setup as send-invite-email
//
// last_login_reminder_sent_at guards against sending twice if the cron
// job is ever re-run the same day (a retry after a transient failure,
// for instance) — it's set right after a user is processed, and the
// query below skips anyone already marked for today.
//
// Deploy with the Supabase CLI:
//   supabase functions deploy send-login-reminders
// The service role key is itself a signed JWT, so it passes the
// platform's default verification like any other caller — the explicit
// check below on top of that is what actually restricts this to the
// scheduled job rather than any signed-in user's own JWT.
//
// TODO(timezone): this fires once, at whatever UTC hour 0010's cron
// schedule uses, for every user regardless of their own local time. See
// that migration's TODO for what per-user timezone support needs.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const HOUND_SIGNUP_URL = 'https://houndchallenge.net';

interface ProfileRow {
  id: string;
  name: string;
  email: string;
  notify_push_enabled: boolean;
  notify_email_enabled: boolean;
}

interface PushTokenRow {
  user_id: string;
  expo_push_token: string;
}

function startOfUtcDay(): string {
  return new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z';
}

async function sendPushBatch(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  const messages = tokens.map((to) => ({
    to,
    title: 'Hound',
    body: "You haven't logged in today — check in before the day's over.",
    sound: 'default',
  }));
  // Expo's push API accepts up to 100 messages per request.
  for (let i = 0; i < messages.length; i += 100) {
    await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages.slice(i, i + 100)),
    }).catch(() => {
      // A batch failing shouldn't stop the rest, and there's no per-user
      // UI to report a push failure to anyway — same "never break,
      // quietly skip" fallback the rest of the app uses.
    });
  }
}

async function sendReminderEmail(resendApiKey: string, name: string, email: string): Promise<void> {
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Hound <reminders@houndchallenge.net>',
      to: [email],
      subject: "Don't lose your streak — log in to Hound today",
      html:
        `<p>Hey ${name},</p>` +
        `<p>You haven't opened Hound today. Log in before the day's over so your progress keeps counting.</p>` +
        `<p><a href="${HOUND_SIGNUP_URL}">Open Hound</a></p>`,
    }),
  }).catch(() => {
    // Same reasoning as sendPushBatch — one failed email shouldn't stop
    // the rest of the run.
  });
}

Deno.serve(async (req) => {
  const expectedAuth = `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`;
  if (req.headers.get('Authorization') !== expectedAuth) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const todayStart = startOfUtcDay();

  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, name, email, notify_push_enabled, notify_email_enabled')
    .or('notify_push_enabled.eq.true,notify_email_enabled.eq.true')
    .or(`last_active_at.is.null,last_active_at.lt.${todayStart}`)
    .or(`last_login_reminder_sent_at.is.null,last_login_reminder_sent_at.lt.${todayStart}`)
    .returns<ProfileRow[]>();

  if (profilesError) {
    return new Response(JSON.stringify({ error: profilesError.message }), { status: 500 });
  }
  if (!profiles || profiles.length === 0) {
    return new Response(JSON.stringify({ processed: 0 }), { headers: { 'Content-Type': 'application/json' } });
  }

  const pushRecipients = profiles.filter((p) => p.notify_push_enabled);
  let tokensByUser = new Map<string, string[]>();
  if (pushRecipients.length > 0) {
    const { data: tokenRows } = await supabase
      .from('device_push_tokens')
      .select('user_id, expo_push_token')
      .in('user_id', pushRecipients.map((p) => p.id))
      .returns<PushTokenRow[]>();
    for (const row of tokenRows ?? []) {
      const existing = tokensByUser.get(row.user_id) ?? [];
      existing.push(row.expo_push_token);
      tokensByUser.set(row.user_id, existing);
    }
  }

  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  const allTokens: string[] = [];
  const emailSends: Promise<void>[] = [];

  for (const profile of profiles) {
    if (profile.notify_push_enabled) {
      allTokens.push(...(tokensByUser.get(profile.id) ?? []));
    }
    if (profile.notify_email_enabled && resendApiKey) {
      emailSends.push(sendReminderEmail(resendApiKey, profile.name, profile.email));
    }
  }

  await Promise.all([sendPushBatch(allTokens), ...emailSends]);

  await supabase
    .from('profiles')
    .update({ last_login_reminder_sent_at: new Date().toISOString() })
    .in('id', profiles.map((p) => p.id));

  return new Response(JSON.stringify({ processed: profiles.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
