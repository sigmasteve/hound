// Server-to-server half of Bones purchase crediting — RevenueCat calls
// this directly on every purchase/refund event, independent of whether
// the client's own sync-purchase call ever happens (app killed right
// after purchase, a flaky connection, etc). credit_bones_purchase's
// unique (store, transaction_id) constraint (0064_bones_purchases.sql)
// makes processing the same purchase from both paths harmless.
//
// Configure in the RevenueCat dashboard: Project Settings > Integrations
// > Webhooks, with this function's URL and an Authorization header value
// matching the REVENUECAT_WEBHOOK_SECRET function secret below — that
// shared secret is what stops anyone else from POSTing fake events here.
//
// event.type values and the exact refund-event shape have shifted across
// RevenueCat API versions — confirm CREDIT_EVENT_TYPES/REFUND_EVENT_TYPES
// below against RevenueCat's current webhook docs before relying on this
// in production; both a dedicated REFUND type and a CANCELLATION-based
// one are handled defensively in the meantime.
//
// Deploy with the Supabase CLI:
//   supabase functions deploy revenuecat-webhook
// Requires the REVENUECAT_WEBHOOK_SECRET function secret.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CREDIT_EVENT_TYPES = new Set(['INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE']);
const REFUND_EVENT_TYPES = new Set(['REFUND', 'CANCELLATION']);

// Compares two strings without stopping at the first difference, so the
// time it takes does not reveal how much of a guess was right. Both sides
// are hashed first so the lengths always match.
async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeStore(store: unknown): 'app_store' | 'play_store' | null {
  switch (store) {
    case 'APP_STORE':
      return 'app_store';
    case 'PLAY_STORE':
      return 'play_store';
    default:
      // STRIPE, MAC_APP_STORE, AMAZON, PROMOTIONAL, RC_BILLING, etc —
      // Bones aren't sold through any of these, so an event for one is
      // ignored rather than erroring.
      return null;
  }
}

function ignored(reason: string) {
  return new Response(JSON.stringify({ ok: true, reason }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  // Fail closed. If the secret is missing, the old check compared the
  // header to the text "Bearer undefined", which anyone can send.
  const secret = Deno.env.get('REVENUECAT_WEBHOOK_SECRET') ?? '';
  if (secret.length < 32) {
    console.error('REVENUECAT_WEBHOOK_SECRET is missing or shorter than 32 characters');
    return new Response('Webhook is not configured', { status: 500 });
  }
  const provided = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!(await safeEqual(provided, secret))) {
    return new Response('Unauthorized', { status: 401 });
  }

  let body: { event?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return ignored('Body was not JSON');
  }

  const event = body?.event;
  const eventType = typeof event?.type === 'string' ? event.type : null;
  const appUserId = typeof event?.app_user_id === 'string' ? event.app_user_id : null;
  const productId = typeof event?.product_id === 'string' ? event.product_id : null;
  const transactionId =
    typeof event?.transaction_id === 'string' ? event.transaction_id : typeof event?.id === 'string' ? event.id : null;

  if (!eventType || !appUserId || !productId || !transactionId) {
    return ignored('Missing required fields on event');
  }

  const store = normalizeStore(event?.store);
  if (!store) return ignored('Unsupported store');

  // RevenueCat's anonymous ids ("$RCAnonymousID:...") are not user ids.
  // Answering 500 would make RevenueCat retry them forever, so answer 200.
  if (!UUID_RE.test(appUserId)) return ignored('Not a Hound user id');

  // TestFlight and Play test purchases arrive as SANDBOX. While the app is
  // in beta they should still credit, so this is off by default. Set
  // REVENUECAT_IGNORE_SANDBOX=true when the app goes live to the public.
  if (Deno.env.get('REVENUECAT_IGNORE_SANDBOX') === 'true' && event?.environment === 'SANDBOX') {
    return ignored('Sandbox purchase');
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  if (CREDIT_EVENT_TYPES.has(eventType)) {
    // Assumes Purchases.configure({ appUserID: <supabase user id> }) on
    // the client, so app_user_id here is already a real profiles.id.
    const { error } = await supabase.rpc('credit_bones_purchase', {
      p_user_id: appUserId,
      p_store: store,
      p_product_id: productId,
      p_transaction_id: transactionId,
    });
    // A non-2xx response here makes RevenueCat retry delivery — exactly
    // what's wanted if the failure is something transient or fixable
    // (e.g. the product hasn't been added to bones_products yet), rather
    // than silently dropping a real purchase.
    if (error) {
      console.error('credit_bones_purchase failed', error.message);
      return new Response(JSON.stringify({ error: 'Could not credit this purchase' }), { status: 500 });
    }
  } else if (REFUND_EVENT_TYPES.has(eventType)) {
    const { error } = await supabase.rpc('refund_bones_purchase', {
      p_store: store,
      p_transaction_id: transactionId,
    });
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
});
