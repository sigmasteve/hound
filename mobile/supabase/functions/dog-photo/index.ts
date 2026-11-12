// Your dog as your avatar (0191_dog_photos.sql): checks a photo with
// Claude and stores the ones that pass.
//
//   { action: 'check', image: <base64 JPEG, square, ~256-512 px>,
//     coats: [{ id, name }], breeds: [{ id, name }] }
//     → { ok: true, photoId, breed, look } or { ok: false, reason, limit? }
//     Asks Claude whether it's a dog and fine to show friends, and which
//     Kennel coat, ears, tail, markings and breed it looks most like (the
//     app sends its own coat and breed lists, so new ones work without a
//     change here). A photo that passes is stored as pending; "Use as my
//     avatar" (dog_photo_use) shows it to friends.
//   { action: 'purge', userId? } → deletes files no longer needed: the
//     caller's own, or (admins) someone else's after a removal.
//
// The caller is always taken from their sign-in token. Uploads and
// deletes use the service role; the bucket is private.
//
// Needs the secret ANTHROPIC_API_KEY (Supabase → Edge Functions →
// Secrets). Deploy with:
//   supabase functions deploy dog-photo

import { createClient } from 'jsr:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0';

// The user chose the cheap, fast model for this check (fractions of a
// cent a photo); change it here if needed.
const MODEL = 'claude-haiku-5-5';
const BUCKET = 'dog-photos';
const MAX_BASE64 = 700_000; // ~512 KB of JPEG

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

type Option = { id: string; name: string };

function cleanOptions(v: unknown): Option[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((o) => o && typeof o.id === 'string' && typeof o.name === 'string' && /^[a-z0-9_]{1,40}$/.test(o.id))
    .slice(0, 40)
    .map((o) => ({ id: o.id, name: String(o.name).slice(0, 40) }));
}

const SYSTEM = `You check photos people pick as their avatar in Hound, a fitness app where a cartoon hound is everyone's mascot. Friends see the photo next to their name.

Decide:
- verdict "dog": a real dog or puppy is clearly the subject. People, other pets or things may also be in it, as long as the dog is clearly there.
- verdict "not_dog": no dog, the dog is too small or unclear to recognize, a drawing or cartoon, a screenshot, or mostly text.
- verdict "inappropriate": nudity, sexual content, violence, gore, hate symbols, drugs or weapons, or anything else unfit for a friendly app, whether or not a dog is in it.

For a dog, also pick the closest choice in each list for the hound drawing, and give a short breed guess (or "mixed breed").`;

async function checkPhoto(anthropic: Anthropic, image: string, coats: Option[], breeds: Option[]) {
  const coatIds = ['none', ...coats.map((c) => c.id)];
  const breedIds = ['none', ...breeds.map((b) => b.id)];
  const schema = {
    type: 'object',
    properties: {
      verdict: { type: 'string', enum: ['dog', 'not_dog', 'inappropriate'] },
      breed_guess: { type: 'string' },
      coat: { type: 'string', enum: coatIds },
      ears: { type: 'string', enum: ['floppy', 'perky', 'short'] },
      tail: { type: 'string', enum: ['wavy', 'curly', 'stubby'] },
      markings: { type: 'string', enum: ['none', 'eye_patch', 'spots'] },
      breed: { type: 'string', enum: breedIds },
    },
    required: ['verdict', 'breed_guess', 'coat', 'ears', 'tail', 'markings', 'breed'],
    additionalProperties: false,
  };
  const lists =
    `Coats (pick "none" for a plain light-brown hound): ${coats.map((c) => `${c.id} = ${c.name}`).join('; ') || 'none'}.\n` +
    `Breeds (pick "none" unless the dog clearly looks like one of these): ${breeds.map((b) => `${b.id} = ${b.name}`).join('; ') || 'none'}.\n` +
    'Ears: floppy (hang down), perky (stand up), short. Tail: wavy, curly (curls over the back), stubby. Markings: none, eye_patch, spots.';

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM,
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
          { type: 'text', text: `Check this avatar photo.\n${lists}` },
        ],
      },
    ],
  } as Anthropic.MessageCreateParamsNonStreaming);

  if (response.stop_reason === 'refusal') return null;
  const text = response.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') return null;
  try {
    return JSON.parse(text.text) as {
      verdict: 'dog' | 'not_dog' | 'inappropriate';
      breed_guess: string;
      coat: string;
      ears: string;
      tail: string;
      markings: string;
      breed: string;
    };
  } catch {
    return null;
  }
}

// deno-lint-ignore no-explicit-any
async function purge(admin: any, userId: string) {
  const { data } = await admin.rpc('dog_photo_take_purgeable', { p_user: userId });
  const paths = ((data ?? []) as unknown[]).map((p) => (typeof p === 'string' ? p : (p as any)?.dog_photo_take_purgeable)).filter(Boolean);
  if (paths.length > 0) await admin.storage.from(BUCKET).remove(paths);
  return paths.length;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const callerClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const {
      data: { user },
    } = await callerClient.auth.getUser();
    if (!user) return json({ error: 'Sign in to do that.' }, 401);
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    if (body?.action === 'purge') {
      let target = user.id;
      if (typeof body.userId === 'string' && body.userId !== user.id) {
        const { data: me } = await admin.from('profiles').select('is_admin').eq('id', user.id).maybeSingle();
        if (!me?.is_admin) return json({ error: 'not authorized' }, 403);
        target = body.userId;
      }
      return json({ purged: await purge(admin, target) });
    }

    if (body?.action !== 'check') return json({ error: 'Unknown action.' }, 400);
    const image = typeof body.image === 'string' ? body.image.replace(/^data:image\/\w+;base64,/, '') : '';
    if (!image || image.length > MAX_BASE64 || !/^[A-Za-z0-9+/=]+$/.test(image)) {
      return json({ ok: false, reason: 'That photo is too big. Try another.' });
    }

    const { data: stop, error: tryError } = await admin.rpc('dog_photo_may_try', { p_user: user.id });
    if (tryError) {
      console.error('dog_photo_may_try failed', tryError.message);
      return json({ ok: false, reason: 'Photos aren’t available right now.' });
    }
    if (stop) return json({ ok: false, reason: stop, limit: true });

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      console.error('ANTHROPIC_API_KEY is not set');
      return json({ ok: false, reason: 'Photos aren’t available right now.' });
    }
    const coats = cleanOptions(body.coats);
    const breeds = cleanOptions(body.breeds);

    let result: Awaited<ReturnType<typeof checkPhoto>> = null;
    try {
      result = await checkPhoto(new Anthropic({ apiKey }), image, coats, breeds);
    } catch (e) {
      console.error('photo check failed', e instanceof Error ? e.message : e);
      return json({ ok: false, reason: 'We couldn’t check that photo just now. Try again in a minute.' });
    }

    if (!result || result.verdict !== 'dog') {
      const reason = !result ? 'unchecked' : result.verdict;
      await admin.rpc('dog_photo_checked', { p_user: user.id, p_ok: false, p_reason: reason, p_path: null, p_checked: null });
      return json({
        ok: false,
        verdict: reason,
        reason:
          reason === 'inappropriate'
            ? 'That photo can’t be used. Avatars are for dogs and puppies.'
            : reason === 'unchecked'
              ? 'We couldn’t check that photo. Try another.'
              : 'That doesn’t look like a dog. Try another photo.',
      });
    }

    const path = `${user.id}/${crypto.randomUUID()}.jpg`;
    const bytes = Uint8Array.from(atob(image), (c) => c.charCodeAt(0));
    const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
    if (uploadError) {
      console.error('upload failed', uploadError.message);
      return json({ ok: false, reason: 'We couldn’t save that photo. Try again.' });
    }
    const look = {
      coat: result.coat === 'none' ? null : result.coat,
      ears: result.ears,
      tail: result.tail,
      markings: result.markings,
      breed: result.breed === 'none' ? null : result.breed,
    };
    const { data: photoId, error: savedError } = await admin.rpc('dog_photo_checked', {
      p_user: user.id,
      p_ok: true,
      p_reason: null,
      p_path: path,
      p_checked: { breed_guess: result.breed_guess.slice(0, 60), look, model: MODEL },
    });
    if (savedError || !photoId) {
      console.error('dog_photo_checked failed', savedError?.message);
      await admin.storage.from(BUCKET).remove([path]);
      return json({ ok: false, reason: 'We couldn’t save that photo. Try again.' });
    }
    // Earlier photos this person no longer uses.
    purge(admin, user.id).catch(() => {});
    return json({ ok: true, photoId, breed: result.breed_guess.slice(0, 60), look });
  } catch (e) {
    console.error('dog-photo failed', e);
    return json({ error: 'Unexpected error.' }, 500);
  }
});
