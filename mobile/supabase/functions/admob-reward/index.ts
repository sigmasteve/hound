// AdMob's server-side verification (SSV) for rewarded ads (0114_rewarded_ads.sql).
// When someone finishes a rewarded ad, Google calls this URL with the
// details and a signature. We check the signature against Google's public
// keys, then pay the Bones through credit_ad_reward_verified, which pays
// once per Google transaction and respects the daily cap.
//
// The app passes its user id and local date with each ad
// (serverSideVerificationOptions), and Google signs them along with the
// rest, so nobody can claim an ad for someone else or invent one.
//
// Set this function's URL as the rewarded ad unit's "Server-side
// verification" callback in AdMob, then turn on "Google confirms each ad"
// in Admin → Rewarded ads. Google's test ads never call it.
//
// Deploy with the Supabase CLI (staging deploys from CI):
//   supabase functions deploy admob-reward
// Called by Google, not the app, so it takes no Supabase JWT (config.toml).

import { createClient } from 'jsr:@supabase/supabase-js@2';

const KEYS_URL = 'https://www.gstatic.com/admob/reward/verifier-keys.json';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Google rotates its keys rarely; keep them for a day.
let keyCache: { at: number; keys: Map<string, CryptoKey> } | null = null;

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const normal = b64.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normal + '='.repeat((4 - (normal.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function verifierKeys(): Promise<Map<string, CryptoKey>> {
  if (keyCache && Date.now() - keyCache.at < 24 * 60 * 60 * 1000) return keyCache.keys;
  const res = await fetch(KEYS_URL);
  if (!res.ok) throw new Error(`Couldn't fetch Google's keys (${res.status})`);
  const body = (await res.json()) as { keys: { keyId: number | string; base64: string }[] };
  const keys = new Map<string, CryptoKey>();
  for (const k of body.keys) {
    const key = await crypto.subtle.importKey(
      'spki',
      base64ToBytes(k.base64),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    keys.set(String(k.keyId), key);
  }
  keyCache = { at: Date.now(), keys };
  return keys;
}

// Google signs in DER; WebCrypto wants the two 32-byte numbers side by side.
function derToRaw(der: Uint8Array): Uint8Array<ArrayBuffer> {
  if (der[0] !== 0x30) throw new Error('Not a DER signature');
  let i = 2;
  if (der[1] & 0x80) i = 2 + (der[1] & 0x7f);
  const readInt = () => {
    if (der[i] !== 0x02) throw new Error('Bad DER integer');
    const len = der[i + 1];
    let bytes = der.slice(i + 2, i + 2 + len);
    i += 2 + len;
    while (bytes.length > 32 && bytes[0] === 0) bytes = bytes.slice(1);
    const out = new Uint8Array(32);
    out.set(bytes, 32 - bytes.length);
    return out;
  };
  const r = readInt();
  const s = readInt();
  const raw = new Uint8Array(64);
  raw.set(r, 0);
  raw.set(s, 32);
  return raw;
}

function reply(status: number, message: string) {
  return new Response(JSON.stringify({ message }), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  // Everything before &signature= is what Google signed, exactly as sent.
  const raw = url.search.startsWith('?') ? url.search.slice(1) : url.search;
  const sigAt = raw.indexOf('&signature=');
  if (sigAt < 0) return reply(400, 'No signature');
  const message = raw.slice(0, sigAt);
  const params = url.searchParams;
  const signature = params.get('signature');
  const keyId = params.get('key_id');
  if (!signature || !keyId) return reply(400, 'No signature');

  let valid = false;
  try {
    const key = (await verifierKeys()).get(keyId);
    if (!key) return reply(400, 'Unknown key');
    valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      derToRaw(base64ToBytes(signature)),
      new TextEncoder().encode(message),
    );
  } catch (e) {
    return reply(500, e instanceof Error ? e.message : 'Verification failed');
  }
  if (!valid) return reply(400, 'Bad signature');

  const userId = params.get('user_id') ?? '';
  const transactionId = params.get('transaction_id') ?? '';
  const customData = params.get('custom_data') ?? '';
  // AdMob's "Verify URL" test sends no user: a valid signature is all it
  // checks for.
  if (!UUID_RE.test(userId) || !transactionId) return reply(200, 'Verified, nothing to pay');

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data, error } = await supabase
    .rpc('credit_ad_reward_verified', {
      p_user: userId,
      p_transaction_id: transactionId,
      p_ad_unit: params.get('ad_unit'),
      p_local_date: DATE_RE.test(customData) ? customData : null,
    })
    .single();
  // A failure here gets retried by Google; a refusal (cap reached) doesn't
  // need to be.
  if (error) return reply(500, error.message);
  return reply(200, (data as { awarded: boolean }).awarded ? 'Paid' : 'Not paid (cap or repeat)');
});
