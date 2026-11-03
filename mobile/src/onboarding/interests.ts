import { supabase } from '../lib/supabase';

// What someone's working toward (K-08), asked in onboarding and editable
// in Settings (0151_badge_milestones_interests.sql). Private: only its
// owner can read it. It's for personalising which challenges Hound
// suggests, and is never shown to anyone else.

export type Interest = 'athlete' | 'sports' | 'gym' | 'weight_loss' | 'general';

export const INTERESTS: { id: Interest; name: string; detail: string }[] = [
  { id: 'athlete', name: 'Training as an athlete', detail: 'Running, cycling, swimming, races' },
  { id: 'sports', name: 'Playing a sport', detail: 'Football, cricket, badminton and more' },
  { id: 'gym', name: 'Gym & strength', detail: 'Lifting, classes, getting stronger' },
  { id: 'weight_loss', name: 'Losing weight', detail: 'Moving more, eating better' },
  { id: 'general', name: 'General fitness', detail: 'Feeling better, staying active' },
];

// Null when it can't be read (before 0151 has run, or offline).
export async function getMyInterests(): Promise<Interest[] | null> {
  if (!supabase) return null;
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return null;
  const { data, error } = await supabase.from('profile_interests').select('interests').eq('user_id', uid).maybeSingle();
  if (error) return null;
  return ((data?.interests as string[] | undefined) ?? []) as Interest[];
}

// Returns what was saved (unknown ids are dropped).
export async function saveMyInterests(interests: Interest[]): Promise<Interest[]> {
  if (!supabase) throw new Error('Interests need a connection to Hound.');
  const { data, error } = await supabase.rpc('save_my_interests', { p_interests: interests });
  if (error) throw new Error(error.message);
  return ((data as string[] | null) ?? []) as Interest[];
}
