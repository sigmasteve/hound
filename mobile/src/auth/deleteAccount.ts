import { supabase } from '../lib/supabase';
import { forgetThisDevice } from '../notifications/pushToken';

// Settings → Delete account (H8 in Roshan Trivedi's security review; Apple
// requires it in apps that create accounts). The server deletes the
// signed-in person's own account — see supabase/functions/delete-my-account
// — and this phone is then signed out locally, since the sign-in no longer
// exists on the server.
export async function deleteMyAccount(): Promise<void> {
  if (!supabase) throw new Error('Not available in preview mode.');
  await forgetThisDevice();
  const { error } = await supabase.functions.invoke('delete-my-account', { body: { confirm: 'DELETE' } });
  if (error) {
    let message = 'Your account could not be deleted right now. Try again later.';
    try {
      const body = await (error as { context?: { json?: () => Promise<{ error?: string }> } }).context?.json?.();
      if (body?.error) message = body.error;
    } catch {
      // Keep the general message.
    }
    throw new Error(message);
  }
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
}
