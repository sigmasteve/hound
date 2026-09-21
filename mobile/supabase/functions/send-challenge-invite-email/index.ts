// Sends a "you've been invited to a challenge" email via Resend, reusing
// the same setup as send-invite-email — the difference is who it's for:
// send-invite-email is for someone who isn't on Hound yet (invited by
// email address, from src/friends), this one is for an existing Hound
// user who just got a challenge_invites row (from
// src/challenges/supabaseChallenges.ts's inviteFriendToChallenge, either
// from ChallengeDetailScreen's "Invite a friend" card or CreateScreen's
// "Bring friends" step) — so it's the invite's id, not a raw email
// address, that identifies who to notify.
//
// Called from the client via supabase.functions.invoke(
//   'send-challenge-invite-email', { body: { inviteId } }
// ) right after that insert succeeds — see inviteFriendToChallenge.
// Best-effort: a failed send here never blocks or surfaces as "could not
// invite that friend," same reasoning CreateScreen's own invite calls
// already use Promise.allSettled for.
//
// Authenticates with the caller's own JWT, not the service role —
// exactly like send-invite-email, and for the same reason it's safe to:
// every row this needs to read (the invite itself, its challenge, and
// both profiles involved) is already something the inviter's own RLS
// policies let them see — "Users can view invites they sent or
// received" (0009), "Participants can view their challenges" (0001, the
// inviter has to already be a participant to send this invite at all —
// see 0009's own insert policy), and "Profiles are viewable by any
// signed-in user" (0001) for both names and the invitee's email.
//
// Deploy with the Supabase CLI once you have a project linked:
//   supabase functions deploy send-challenge-invite-email
// Reuses the same RESEND_API_KEY secret send-invite-email/
// send-login-reminders already need — nothing new to configure if
// either of those is already set up.
//
// Not yet done, same as send-invite-email: a verified sending domain,
// and a real deep link into a specific challenge — HOUND_SIGNUP_URL
// below just opens the app's marketing/download page, not this
// invitee's own pending-invite card.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const HOUND_SIGNUP_URL = 'https://houndchallenge.net';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

interface InviteRow {
  id: string;
  challenges: { name: string; kind: string } | null;
  inviter: { name: string; username: string | null; use_username: boolean } | null;
  invitee: { name: string; email: string } | null;
}

// Same rule src/profiles/displayName.ts applies on the client, duplicated
// here since Edge Functions can't import from mobile/src — the inviter's
// name is exactly the "challenge context revealing someone else's
// identity" case that rule covers.
function displayName(p: { name: string; username: string | null; use_username: boolean }): string {
  return p.use_username && p.username ? p.username : p.name;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  try {
    const { inviteId } = await req.json();
    if (typeof inviteId !== 'string' || !inviteId) {
      return new Response(JSON.stringify({ error: 'inviteId is required.' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Scoped to the caller's own JWT (forwarded automatically by
    // supabase.functions.invoke) — see the file comment for why every
    // row this reads is already something the inviter's own RLS lets
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
      .from('challenge_invites')
      .select(
        'id, challenges(name, kind), ' +
          'inviter:profiles!challenge_invites_inviter_id_fkey(name, username, use_username), ' +
          'invitee:profiles!challenge_invites_invitee_id_fkey(name, email)',
      )
      .eq('id', inviteId)
      .single<InviteRow>();
    if (error || !data || !data.challenges || !data.invitee) {
      return new Response(JSON.stringify({ error: error?.message ?? 'Invite not found.' }), {
        status: 404,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const inviterName = data.inviter ? displayName(data.inviter) : 'Someone';
    const challengeName = data.challenges.name;

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Hound <invites@houndchallenge.net>',
        to: [data.invitee.email],
        subject: `${inviterName} invited you to "${challengeName}" on Hound`,
        html:
          `<p>Hey ${data.invitee.name},</p>` +
          `<p>${inviterName} invited you to join &ldquo;${challengeName}&rdquo; on Hound.</p>` +
          `<p><a href="${HOUND_SIGNUP_URL}">Open Hound</a> and look for the invite on the Challenges tab.</p>`,
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
