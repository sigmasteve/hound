// Runs once a day on a schedule (see 0025_challenge_alerts.sql's pg_cron
// job, at 8pm UTC to match the toggle's own label) — no signed-in user
// drives this, so it authenticates with the service role key, same
// reasoning as send-login-reminders.
//
// For every still-running Step Race ('steps' kind — see
// 0001_challenges_schema.sql's challenge_kind enum), ranks participants
// by their total logged steps and pushes each one who has
// alert_daily_standings_enabled turned on their own rank. daily_standings_sent
// guards against sending the same challenge's standings twice in one
// day if this job is ever re-run.
//
// Deploy with the Supabase CLI:
//   supabase functions deploy send-daily-standings

import { createClient } from 'jsr:@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

interface ChallengeRow {
  id: string;
  name: string;
}

interface ParticipantRow {
  user_id: string;
  profiles: { alert_daily_standings_enabled: boolean } | null;
}

async function sendPushBatch(entries: { token: string; body: string }[]): Promise<void> {
  const messages = entries.map(({ token, body }) => ({ to: token, title: 'Hound', body, sound: 'default' }));
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

Deno.serve(async (req) => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Two callers, both explicit: the cron job itself (service role — see
  // 0025_challenge_alerts.sql), or a signed-in admin manually firing this
  // early to test it (SettingsScreen's dev-only "Developer tools" card,
  // via notifications/supabaseNotifications.ts's triggerDailyStandings —
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

  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  const { data: challenges, error: challengesError } = await supabase
    .from('challenges')
    .select('id, name')
    .eq('kind', 'steps')
    .gt('ends_at', now)
    .returns<ChallengeRow[]>();
  if (challengesError) {
    return new Response(JSON.stringify({ error: challengesError.message }), { status: 500 });
  }

  let challengesSent = 0;

  for (const challenge of challenges ?? []) {
    const [{ data: participants }, { data: snapshots }] = await Promise.all([
      supabase
        .from('challenge_participants')
        .select('user_id, profiles(alert_daily_standings_enabled)')
        .eq('challenge_id', challenge.id)
        .returns<ParticipantRow[]>(),
      supabase.from('progress_snapshots').select('user_id, steps').eq('challenge_id', challenge.id),
    ]);
    if (!participants || participants.length === 0) continue;

    const optedIn = participants.filter((p) => p.profiles?.alert_daily_standings_enabled);
    if (optedIn.length === 0) continue;

    // Insert-if-not-already-recorded — checked only now that there's
    // actually someone to notify, not before. A challenge with nobody
    // opted in yet shouldn't burn today's one attempt: if it did, opting
    // in later the same day would find the guard already tripped and
    // silently get skipped until tomorrow.
    const { error: guardError } = await supabase
      .from('daily_standings_sent')
      .insert({ challenge_id: challenge.id, day: today });
    if (guardError) continue;

    const totalsByUser = new Map<string, number>();
    for (const p of participants) totalsByUser.set(p.user_id, 0);
    for (const s of snapshots ?? []) {
      totalsByUser.set(s.user_id, (totalsByUser.get(s.user_id) ?? 0) + s.steps);
    }

    const ranked = [...totalsByUser.entries()].sort((a, b) => b[1] - a[1]);
    const rankByUser = new Map(ranked.map(([userId], i) => [userId, i + 1]));

    const { data: tokenRows } = await supabase
      .from('device_push_tokens')
      .select('user_id, expo_push_token')
      .in(
        'user_id',
        optedIn.map((p) => p.user_id),
      );
    const tokensByUser = new Map<string, string[]>();
    for (const row of tokenRows ?? []) {
      const existing = tokensByUser.get(row.user_id) ?? [];
      existing.push(row.expo_push_token);
      tokensByUser.set(row.user_id, existing);
    }

    const entries: { token: string; body: string }[] = [];
    for (const p of optedIn) {
      const rank = rankByUser.get(p.user_id) ?? participants.length;
      const steps = totalsByUser.get(p.user_id) ?? 0;
      const body = `You're #${rank} of ${participants.length} in "${challenge.name}" today — ${steps.toLocaleString()} steps so far.`;
      for (const token of tokensByUser.get(p.user_id) ?? []) entries.push({ token, body });
    }
    await sendPushBatch(entries);
    challengesSent += 1;
  }

  return new Response(JSON.stringify({ challengesSent }), { headers: { 'Content-Type': 'application/json' } });
});
