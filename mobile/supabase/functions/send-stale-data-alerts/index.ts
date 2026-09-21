// Runs once a day on a schedule (see 0025_challenge_alerts.sql's pg_cron
// job) — no signed-in user drives this, so it authenticates with the
// service role key, same reasoning as send-login-reminders.
//
// For every challenge still running, finds any participant who hasn't
// recorded progress in it for over STALE_HOURS (or never has, if the
// challenge itself has been running that long), and notifies every
// OTHER participant who has push and/or email enabled for this alert
// (0026_alert_email_channels.sql) with a "so-and-so hasn't synced"
// nudge. stale_data_alerts_sent guards against sending the same
// (challenge, stale participant) fact twice in one day if this job is
// ever re-run.
//
// Deploy with the Supabase CLI:
//   supabase functions deploy send-stale-data-alerts

import { createClient } from 'jsr:@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const STALE_MS = 24 * 60 * 60 * 1000;

interface ChallengeRow {
  id: string;
  name: string;
  starts_at: string;
}

interface ParticipantRow {
  user_id: string;
  profiles: {
    name: string;
    email: string;
    alert_stale_data_push_enabled: boolean;
    alert_stale_data_email_enabled: boolean;
  } | null;
}

async function sendPushBatch(tokens: string[], body: string): Promise<void> {
  if (tokens.length === 0) return;
  const messages = tokens.map((to) => ({ to, title: 'Hound', body, sound: 'default' }));
  for (let i = 0; i < messages.length; i += 100) {
    await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages.slice(i, i + 100)),
    }).catch(() => {
      // Same "a batch failing shouldn't stop the rest" reasoning
      // send-login-reminders' own sendPushBatch uses.
    });
  }
}

async function sendAlertEmail(resendApiKey: string, email: string, body: string): Promise<void> {
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Hound <alerts@houndchallenge.net>',
      to: [email],
      subject: 'Hound alert',
      html: `<p>${body}</p>`,
    }),
  }).catch(() => {
    // Same "one failed send shouldn't stop the rest" reasoning
    // send-login-reminders' own sendReminderEmail uses.
  });
}

Deno.serve(async (req) => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Two callers, both explicit: the cron job itself (service role — see
  // 0025_challenge_alerts.sql), or a signed-in admin manually firing this
  // early to test it (SettingsScreen's dev-only "Developer tools" card,
  // via notifications/supabaseNotifications.ts's triggerStaleDataAlerts —
  // same "check the caller's own JWT against profiles.is_admin" pattern
  // admin-delete-user uses, not a second copy of the service-role key
  // anywhere near the client). Anyone else gets 401.
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

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const resendApiKey = Deno.env.get('RESEND_API_KEY');

  const { data: challenges, error: challengesError } = await supabase
    .from('challenges')
    .select('id, name, starts_at')
    .gt('ends_at', now.toISOString())
    .returns<ChallengeRow[]>();
  if (challengesError) {
    return new Response(JSON.stringify({ error: challengesError.message }), { status: 500 });
  }

  let alertsSent = 0;

  for (const challenge of challenges ?? []) {
    // A challenge younger than the stale window itself has nobody
    // who's had time to go stale yet — nothing to flag.
    if (now.getTime() - new Date(challenge.starts_at).getTime() < STALE_MS) continue;

    const [{ data: participants }, { data: snapshots }] = await Promise.all([
      supabase
        .from('challenge_participants')
        .select('user_id, profiles(name, email, alert_stale_data_push_enabled, alert_stale_data_email_enabled)')
        .eq('challenge_id', challenge.id)
        .returns<ParticipantRow[]>(),
      supabase.from('progress_snapshots').select('user_id, recorded_at').eq('challenge_id', challenge.id),
    ]);
    if (!participants || participants.length < 2) continue;

    const lastSyncedByUser = new Map<string, string>();
    for (const s of snapshots ?? []) {
      const existing = lastSyncedByUser.get(s.user_id);
      if (!existing || s.recorded_at > existing) lastSyncedByUser.set(s.user_id, s.recorded_at);
    }

    for (const participant of participants) {
      const lastSynced = lastSyncedByUser.get(participant.user_id);
      const staleMs = lastSynced ? now.getTime() - new Date(lastSynced).getTime() : STALE_MS;
      if (staleMs < STALE_MS) continue;

      const recipients = participants.filter(
        (p) =>
          p.user_id !== participant.user_id &&
          (p.profiles?.alert_stale_data_push_enabled || p.profiles?.alert_stale_data_email_enabled),
      );
      if (recipients.length === 0) continue;

      // Insert-if-not-already-recorded — checked only now that there's
      // actually someone to notify, not before. Nobody opted in yet
      // shouldn't burn today's one attempt at this (challenge, stale
      // participant) fact: if it did, opting in later the same day
      // would find the guard already tripped and silently get skipped
      // until tomorrow.
      const { error: guardError } = await supabase
        .from('stale_data_alerts_sent')
        .insert({ challenge_id: challenge.id, stale_user_id: participant.user_id, day: today });
      if (guardError) continue; // 23505 (already sent) or any other failure — skip either way

      const staleName = participant.profiles?.name ?? 'A friend';
      const body = `${staleName} hasn't synced progress in "${challenge.name}" for over a day.`;

      const pushRecipients = recipients.filter((r) => r.profiles?.alert_stale_data_push_enabled);
      const emailRecipients = recipients.filter((r) => r.profiles?.alert_stale_data_email_enabled);

      const sends: Promise<void>[] = [];
      if (pushRecipients.length > 0) {
        sends.push(
          supabase
            .from('device_push_tokens')
            .select('expo_push_token')
            .in(
              'user_id',
              pushRecipients.map((r) => r.user_id),
            )
            .then(({ data: tokenRows }) => sendPushBatch((tokenRows ?? []).map((t) => t.expo_push_token), body)),
        );
      }
      if (resendApiKey) {
        for (const r of emailRecipients) {
          if (r.profiles?.email) sends.push(sendAlertEmail(resendApiKey, r.profiles.email, body));
        }
      }
      await Promise.all(sends);
      alertsSent += 1;
    }
  }

  return new Response(JSON.stringify({ alertsSent }), { headers: { 'Content-Type': 'application/json' } });
});
