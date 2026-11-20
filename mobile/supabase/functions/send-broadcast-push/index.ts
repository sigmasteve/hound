// Send a push (0228_broadcast_push.sql): one admin-written push to the
// recipients admin_send_broadcast snapshotted, called from that function
// via pg_net with the broadcast's id. Sends through Expo in batches of 100
// to every phone each recipient has registered, then marks the broadcast
// sent with how many pushes Expo took (or failed, with why).
//
// The push's data lets the app open the right screen and count the tap
// (src/notifications/notificationTaps.ts): type 'broadcast', the
// broadcast's id, and the challenge it invites to, if any.
//
// Deploy with the Supabase CLI:
//   supabase functions deploy send-broadcast-push

import { createClient } from 'jsr:@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
// .in() lists go in the URL: keep each one short.
const USER_CHUNK = 200;
const EXPO_CHUNK = 100;

Deno.serve(async (req) => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Only Postgres calls this, with the service role key.
  const authHeader = req.headers.get('Authorization') ?? '';
  if (authHeader !== `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const { broadcast_id: id } = (await req.json()) as { broadcast_id?: string };
  if (!id) return new Response(JSON.stringify({ error: 'broadcast_id is required' }), { status: 400 });

  const { data: b, error: bErr } = await supabase
    .from('push_broadcasts')
    .select('id, title, message, challenge_id, status')
    .eq('id', id)
    .single<{ id: string; title: string; message: string; challenge_id: string | null; status: string }>();
  if (bErr || !b) return new Response(JSON.stringify({ error: 'Broadcast not found' }), { status: 404 });
  // Sent once: a retried call does nothing.
  if (b.status !== 'sending') return new Response(JSON.stringify({ sent: false, reason: `Already ${b.status}` }));

  try {
    // Every recipient, a page at a time.
    const users: string[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('push_broadcast_recipients')
        .select('user_id')
        .eq('broadcast_id', id)
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      users.push(...(data ?? []).map((r: { user_id: string }) => r.user_id));
      if (!data || data.length < 1000) break;
    }

    const tokens: string[] = [];
    for (let i = 0; i < users.length; i += USER_CHUNK) {
      const { data, error } = await supabase
        .from('device_push_tokens')
        .select('expo_push_token')
        .in('user_id', users.slice(i, i + USER_CHUNK));
      if (error) throw new Error(error.message);
      tokens.push(...(data ?? []).map((r: { expo_push_token: string }) => r.expo_push_token));
    }

    const data = { type: 'broadcast', broadcastId: b.id, challengeId: b.challenge_id };
    const messages = tokens.map((to) => ({ to, title: b.title, body: b.message, sound: 'default', data }));
    let delivered = 0;
    const problems: string[] = [];
    for (let i = 0; i < messages.length; i += EXPO_CHUNK) {
      try {
        const res = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(messages.slice(i, i + EXPO_CHUNK)),
        });
        const json = (await res.json().catch(() => null)) as { data?: { status: string; message?: string }[] } | null;
        for (const t of json?.data ?? []) {
          if (t.status === 'ok') delivered++;
          else if (t.message && problems.length < 5) problems.push(t.message);
        }
      } catch (e) {
        if (problems.length < 5) problems.push(e instanceof Error ? e.message : String(e));
      }
    }

    await supabase
      .from('push_broadcasts')
      .update({
        status: delivered > 0 || messages.length === 0 ? 'sent' : 'failed',
        sent_at: new Date().toISOString(),
        delivered,
        error: problems.length > 0 ? problems.join(' · ').slice(0, 500) : null,
      })
      .eq('id', id);
    return new Response(JSON.stringify({ sent: true, phones: messages.length, delivered }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await supabase.from('push_broadcasts').update({ status: 'failed', error: message.slice(0, 500) }).eq('id', id);
    return new Response(JSON.stringify({ sent: false, error: message }), { status: 500 });
  }
});
