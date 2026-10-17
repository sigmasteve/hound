import { supabase } from '../lib/supabase';

// Bounties (0102_bounties.sql): put Bones on a step target for your
// friends; the first to reach it today gets them, and they come back if
// nobody does. The server checks everything; every call throws its
// message on failure.

export interface Bounty {
  id: string;
  mine: boolean;
  posterId: string;
  posterName: string;
  posterInitials: string;
  posterFrameId: string | null;
  posterBackgroundId: string | null;
  posterIconId: string | null;
  targetSteps: number;
  bones: number;
  endsAt: string;
  status: 'open' | 'claimed' | 'refunded';
  claimedByMe: boolean;
  claimerName: string | null;
  settledAt: string | null;
}

// What the poster can choose from. The server allows 2,000-60,000 steps
// and 10-100 Bones.
export const BOUNTY_STEP_CHOICES = [8000, 10000, 12500, 15000, 20000, 25000];
export const BOUNTY_BONES_CHOICES = [10, 25, 50, 100];

function client() {
  if (!supabase) throw new Error('Bounties need a connection to Hound.');
  return supabase;
}

export async function listBounties(): Promise<Bounty[]> {
  const { data, error } = await client().rpc('list_bounties');
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id,
    mine: r.mine,
    posterId: r.poster_id,
    posterName: r.poster_name,
    posterInitials: r.poster_initials ?? '?',
    posterFrameId: r.poster_frame_id,
    posterBackgroundId: r.poster_background_id,
    posterIconId: r.poster_icon_id,
    targetSteps: r.target_steps,
    bones: r.bones,
    endsAt: r.ends_at,
    status: r.status,
    claimedByMe: r.claimed_by_me,
    claimerName: r.claimer_name,
    settledAt: r.settled_at,
  }));
}

// The end of today on this phone: when a bounty posted now runs out.
export function endOfLocalDay(now = new Date()): Date {
  const end = new Date(now);
  end.setHours(24, 0, 0, 0);
  return end;
}

// The server wants at least 30 minutes; the phone asks for an hour so a
// bounty is worth chasing.
export function canPostToday(now = new Date()): boolean {
  return endOfLocalDay(now).getTime() - now.getTime() >= 60 * 60_000;
}

export async function postBounty(targetSteps: number, bones: number): Promise<string> {
  const { data, error } = await client().rpc('post_bounty', {
    p_target_steps: targetSteps,
    p_bones: bones,
    p_ends_at: endOfLocalDay().toISOString(),
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function cancelBounty(id: string): Promise<void> {
  const { error } = await client().rpc('cancel_bounty', { p_bounty_id: id });
  if (error) throw new Error(error.message);
}

export async function claimBounty(id: string, steps: number): Promise<{ claimed: boolean; bones: number }> {
  const { data, error } = await client().rpc('claim_bounty', { p_bounty_id: id, p_steps: steps }).single();
  if (error) throw new Error(error.message);
  const r = data as any;
  return { claimed: r.claimed, bones: r.bones };
}

// Friends' open bounties today's steps already reach.
export function claimable(bounties: Bounty[], stepsToday: number): Bounty[] {
  return bounties.filter((b) => !b.mine && b.status === 'open' && stepsToday >= b.targetSteps);
}
