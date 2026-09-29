import { supabase } from '../lib/supabase';

// An admin's own signup-alert choices — see 0077_admin_signup_alerts.sql
// and supabase/functions/send-admin-signup-alerts.

export interface SignupAlertPrefs {
  instant: boolean;
  digest: boolean;
}

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

export async function getSignupAlertPrefs(userId: string): Promise<SignupAlertPrefs> {
  const { data, error } = await requireClient()
    .from('profiles')
    .select('admin_signup_push, admin_signup_digest')
    .eq('id', userId)
    .single();
  if (error) throw new Error(error.message);
  return { instant: !!data.admin_signup_push, digest: !!data.admin_signup_digest };
}

export async function setSignupAlertPrefs(userId: string, prefs: SignupAlertPrefs): Promise<void> {
  const { error } = await requireClient()
    .from('profiles')
    .update({ admin_signup_push: prefs.instant, admin_signup_digest: prefs.digest })
    .eq('id', userId);
  if (error) throw new Error(error.message);
}

// Sends one alert to this admin's own devices, to check it all works.
export async function sendTestSignupAlert(): Promise<{ sent: boolean; reason?: string }> {
  const { data, error } = await requireClient().functions.invoke('send-admin-signup-alerts', { body: { kind: 'test' } });
  if (error) {
    const context = (error as { context?: Response }).context;
    const detail = await context
      ?.clone()
      .json()
      .then((b) => (typeof b?.error === 'string' ? b.error : null))
      .catch(() => null);
    throw new Error(detail ?? error.message);
  }
  return (data as { sent: boolean; reason?: string }) ?? { sent: false };
}
