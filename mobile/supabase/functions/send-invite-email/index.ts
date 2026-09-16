// Sends the "you've been invited to Hound" email via Resend
// (https://resend.com). This has to be server-side — the Resend API key
// authorizes sending mail on your domain's behalf, and any secret shipped
// inside the mobile app bundle can be pulled back out of it, the same
// reason no service_role key ever appears in src/.
//
// Called from the client via supabase.functions.invoke('send-invite-email',
// { body: { email } }) — see src/friends/supabaseFriends.ts's
// inviteByEmail(). The caller's own JWT (attached automatically by
// supabase-js) is what authorizes this function to look up their name;
// nothing here trusts a client-supplied inviter name.
//
// Deploy with the Supabase CLI once you have a project linked:
//   supabase functions deploy send-invite-email
//   supabase secrets set RESEND_API_KEY=re_your_key_here
// Get RESEND_API_KEY from https://resend.com/api-keys. The `from` address
// below needs a domain verified in Resend before it'll actually deliver —
// until then Resend's API will reject the send with a clear error, which
// this function surfaces rather than swallows.
//
// Not yet done: a verified sending domain, and a real link for the email
// to point to — HOUND_SIGNUP_URL below is a placeholder (just the bare
// houndchallenge.net domain) until there's an app to download or a
// hosted sign-up page. Swap it for whatever that ends up being.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const HOUND_SIGNUP_URL = 'https://houndchallenge.net';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

function isPlausibleEmail(value: unknown): value is string {
  return typeof value === 'string' && value.includes('@') && value.trim().length > 3;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  try {
    const { email } = await req.json();
    if (!isPlausibleEmail(email)) {
      return new Response(JSON.stringify({ error: 'A valid email is required.' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Scoped to the caller's own JWT (forwarded automatically by
    // supabase.functions.invoke), not the service role — this can only
    // ever read what the calling user could already read themselves.
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

    const { data: profile } = await supabase.from('profiles').select('name').eq('id', user.id).single();
    const inviterName = profile?.name ?? 'Someone';

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Hound <invites@houndchallenge.net>',
        to: [email],
        subject: `${inviterName} invited you to Hound`,
        html:
          `<p>${inviterName} wants to race you on Hound.</p>` +
          `<p><a href="${HOUND_SIGNUP_URL}">Join Hound</a> to connect — you'll already be friends once you sign up with this address.</p>`,
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
