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

  const authHeader = req.headers.get('Authorization') ?? '';
  if (authHeader !== `Bearer ${Deno.env.get('REVENUECAT_WEBHOOK_SECRET')}`) {
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
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  } else if (REFUND_EVENT_TYPES.has(eventType)) {
    const { error } = await supabase.rpc('refund_bones_purchase', {
      p_store: store,
      p_transaction_id: transactionId,
    });
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
});
