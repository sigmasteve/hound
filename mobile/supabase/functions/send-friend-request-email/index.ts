// Sends a "so-and-so wants to be your friend" email via Resend, reusing
// the same setup as send-invite-email and send-challenge-invite-email —
// this one covers the one remaining gap those two didn't: inviteByEmail
// (src/friends/supabaseFriends.ts) only ever emails anyone when the
// address it looked up has *no* matching profile yet (the
// pending_invites/send-invite-email path). The moment a profile *is*
// found, it just inserts a `friendships` row and stops — silently, with
// no email at all, even though the recipient is a real Hound user who'd
// otherwise only ever notice the request by opening the Friends tab on
// their own. This is the same gap send-challenge-invite-email closed
// for challenge invites, just on the friend-request side.
//
// Called from the client via supabase.functions.invoke(
//   'send-friend-request-email', { body: { friendshipId } }
// ) right after that insert succeeds — see inviteByEmail's "found a
// matching profile" branch. Best-effort, same reasoning as the other
// two: a failed send here never blocks or surfaces as an error, since
// the friendship row is already durably written either way.
//
// Authenticates with the caller's own JWT, not the service role — same
// as the other two, and safe for the same reason: every row this needs
// to read (the friendship itself, both profiles) is already something
// the requester's own RLS lets them see — "Users can view their own
// friendships" (0007, since requester_id = auth.uid()) and "Profiles
// are viewable by any signed-in user" (0001, which is also where the
// recipient's email comes from).
//
// Deploy with the Supabase CLI once you have a project linked:
//   supabase functions deploy send-friend-request-email
// Reuses the same RESEND_API_KEY secret the other two need — nothing
// new to configure if either of those is already set up.
//
// Not yet done, same as the other two: a verified sending domain, and a
// real deep link into the Friends tab rather than just Hound's front
// door.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const HOUND_SIGNUP_URL = 'https://houndchallenge.net';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

interface FriendshipRow {
  id: string;
  requester: { name: string } | null;
  recipient: { name: string; email: string } | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  try {
    const { friendshipId } = await req.json();
    if (typeof friendshipId !== 'string' || !friendshipId) {
      return new Response(JSON.stringify({ error: 'friendshipId is required.' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Scoped to the caller's own JWT (forwarded automatically by
    // supabase.functions.invoke) — see the file comment for why every
    // row this reads is already something the requester's own RLS lets
    // them see.
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Sign in to do that.' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const { data, error } = await supabase
      .from('friendships')
      .select(
        'id, ' +
          'requester:profiles!friendships_requester_id_fkey(name), ' +
          'recipient:profiles!friendships_recipient_id_fkey(name, email)',
      )
      .eq('id', friendshipId)
      .single<FriendshipRow>();
    if (error || !data || !data.recipient) {
      return new Response(JSON.stringify({ error: error?.message ?? 'Friendship not found.' }), {
        status: 404,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const requesterName = data.requester?.name ?? 'Someone';

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Hound <invites@houndchallenge.net>',
        to: [data.recipient.email],
        subject: `${requesterName} wants to be your friend on Hound`,
        html:
          `<p>Hey ${data.recipient.name},</p>` +
          `<p>${requesterName} wants to be your friend on Hound.</p>` +
          `<p><a href="${HOUND_SIGNUP_URL}">Open Hound</a> and look for the request on the Friends tab.</p>`,
      }),
    });

    if (!resendResponse.ok) {
      const detail = await resendResponse.text();
      return new Response(JSON.stringify({ error: `Resend rejected the send: ${detail}` }), {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ sent: true }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unexpected error.' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
