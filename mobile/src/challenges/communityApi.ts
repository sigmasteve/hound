import { supabase } from '../lib/supabase';
import type { ChallengeKind } from '../data/sampleData';

// Community challenges (K-04, 0152_community_challenges.sql): members
// publish challenges anyone with the code, link or QR code can join.
// Listed nowhere unless an admin features one. Every call throws its
// message on failure, except where it says otherwise.

function client() {
  if (!supabase) throw new Error('Community challenges need a connection to Hound.');
  return supabase;
}

export const COMMUNITY_KINDS: ChallengeKind[] = ['steps', 'streak', 'distance', 'bingo', 'seventyfive', 'journey', 'checklist', 'houndopoly'];

export const SITE = 'https://houndchallenge.net';

// "HND7K2Q" → "HND-7K2Q", for reading out.
export function formatCode(code: string): string {
  const c = normCode(code);
  return c.length > 3 ? `${c.slice(0, 3)}-${c.slice(3)}` : c;
}

// What the server compares: letters and digits, upper case.
export function normCode(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

export function codeLink(code: string): string {
  return `${SITE}/c/${normCode(code)}`;
}

// A code out of anything pasted or scanned: the code itself, the
// houndchallenge.net/c/ link, or the app's hound://c/ link.
export function codeFrom(text: string): string | null {
  const t = text.trim();
  const m = /\/c\/([A-Za-z0-9-]{5,12})/.exec(t);
  const raw = m ? m[1] : t;
  const c = normCode(raw);
  return /^[A-Z0-9]{7}$/.test(c) ? c : null;
}

export interface CommunityStatus {
  enabled: boolean;
  // Null when you can publish; otherwise why not, in a sentence.
  publishProblem: string | null;
  ageGate: boolean;
  ageOk: boolean;
  preReview: boolean;
}

// Null before 0152 has run (or offline): the app shows none of it.
export async function getCommunityStatus(): Promise<CommunityStatus | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('my_community_status');
  if (error || !data) return null;
  const r = data as any;
  return {
    enabled: !!r.enabled,
    publishProblem: r.publish_problem ?? null,
    ageGate: !!r.age_gate,
    ageOk: !!r.age_ok,
    preReview: !!r.pre_review,
  };
}

export async function confirmCommunityAge(): Promise<void> {
  const { error } = await client().rpc('confirm_community_age');
  if (error) throw new Error(error.message);
}

export interface PublishCommunityInput {
  name: string;
  description: string | null;
  kind: ChallengeKind;
  durationDays: number;
  startsAt: Date;
  joinClosesAt: Date;
  orgOnly: boolean;
  dailyGoalSteps?: number;
  distanceGoalUnit?: 'miles' | 'steps';
  distanceGoalMi?: number;
  distanceGoalSteps?: number;
  bingoCardType?: string;
  // A hound card's size (0179).
  bingoSize?: 3 | 4 | 5;
  courseId?: string;
  distanceSource?: string;
}

export interface Published {
  id: string;
  code: string;
  // 'pending' while pre-review is on: the code works once approved.
  state: 'pending' | 'listed';
}

export async function publishCommunityChallenge(input: PublishCommunityInput): Promise<Published> {
  const { data, error } = await client()
    .rpc('publish_community_challenge', {
      p_name: input.name,
      p_description: input.description,
      p_kind: input.kind,
      p_duration_days: input.durationDays,
      p_starts_at: input.startsAt.toISOString(),
      p_join_closes_at: input.joinClosesAt.toISOString(),
      p_org_only: input.orgOnly,
      p_daily_goal_steps: input.dailyGoalSteps ?? null,
      p_distance_goal_unit: input.distanceGoalUnit ?? null,
      p_distance_goal_mi: input.distanceGoalMi ?? null,
      p_distance_goal_steps: input.distanceGoalSteps ?? null,
      p_bingo_card_type: input.bingoCardType ?? null,
      p_course_id: input.courseId ?? null,
      p_distance_source: input.distanceSource ?? null,
      ...(input.bingoSize ? { p_bingo_size: input.bingoSize } : {}),
    })
    .single();
  if (error) throw new Error(error.message);
  const r = data as any;
  return { id: r.id, code: r.join_code, state: r.review_state };
}

export interface CodePreview {
  id: string;
  name: string;
  description: string | null;
  kind: ChallengeKind;
  creator: string | null;
  participantCount: number;
  durationDays: number;
  startsAt: string;
  endsAt: string;
  joinClosesAt: string;
  joined: boolean;
  // Null: you can join. 'age': confirm 13+ first. 'username': pick one
  // first. Anything else: why you can't, in a sentence.
  problem: string | null;
}

// Null when no challenge has that code.
export async function previewByCode(code: string): Promise<CodePreview | null> {
  const { data, error } = await client().rpc('preview_by_code', { p_code: code });
  if (error) throw new Error(error.message);
  const r = (Array.isArray(data) ? data[0] : data) as any;
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    kind: r.kind,
    creator: r.creator ?? null,
    participantCount: r.participant_count ?? 0,
    durationDays: r.duration_days,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    joinClosesAt: r.join_closes_at,
    joined: !!r.joined,
    problem: r.problem ?? null,
  };
}

// The challenge's id, or null when no challenge has that code.
export async function joinByCode(code: string): Promise<string | null> {
  const { data, error } = await client().rpc('join_by_code', { p_code: code });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

// A community challenge's own details, for its screen. Null for any
// other challenge (or before 0152 has run).
export interface CommunityInfo {
  code: string | null;
  description: string | null;
  state: 'pending' | 'listed' | 'hidden' | 'removed';
  codeOff: boolean;
  featured: boolean;
  createdBy: string | null;
}

export async function getCommunityInfo(challengeId: string): Promise<CommunityInfo | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('challenges')
    .select('community, join_code, description, review_state, code_off, featured, created_by')
    .eq('id', challengeId)
    .maybeSingle();
  if (error || !data || !(data as any).community) return null;
  const r = data as any;
  return {
    code: r.join_code ?? null,
    description: r.description ?? null,
    state: r.review_state,
    codeOff: !!r.code_off,
    featured: !!r.featured,
    createdBy: r.created_by ?? null,
  };
}

// 'off' | 'on' | 'new'. Returns the code as it now stands.
export async function setCommunityCode(challengeId: string, action: 'off' | 'on' | 'new'): Promise<string> {
  const { data, error } = await client().rpc('set_community_code', { p_challenge_id: challengeId, p_action: action });
  if (error) throw new Error(error.message);
  return data as string;
}

export type ReportReason = 'offensive' | 'spam' | 'misleading' | 'other';

export async function reportCommunityChallenge(challengeId: string, reason: ReportReason): Promise<void> {
  const { error } = await client().rpc('report_community_challenge', { p_challenge_id: challengeId, p_reason: reason });
  if (error) throw new Error(error.message);
}

export async function cancelCommunityChallenge(challengeId: string): Promise<void> {
  const { error } = await client().rpc('cancel_community_challenge', { p_challenge_id: challengeId });
  if (error) throw new Error(error.message);
}

// ── Admin ────────────────────────────────────────────────────────────

export interface AdminCommunityRow {
  id: string;
  name: string;
  description: string | null;
  kind: ChallengeKind;
  creator: string;
  creatorId: string;
  state: CommunityInfo['state'];
  featured: boolean;
  codeOff: boolean;
  code: string;
  participantCount: number;
  reportCount: number;
  reasons: string[];
  startsAt: string;
  endsAt: string;
  createdAt: string;
}

export async function adminListCommunity(filter: 'review' | 'all'): Promise<AdminCommunityRow[]> {
  const { data, error } = await client().rpc('admin_list_community', { p_filter: filter });
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    kind: r.kind,
    creator: r.creator ?? 'Someone',
    creatorId: r.creator_id,
    state: r.review_state,
    featured: !!r.featured,
    codeOff: !!r.code_off,
    code: r.join_code,
    participantCount: r.participant_count ?? 0,
    reportCount: r.report_count ?? 0,
    reasons: r.reasons ?? [],
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    createdAt: r.created_at,
  }));
}

export type AdminCommunityAction = 'approve' | 'restore' | 'remove' | 'feature' | 'unfeature';

export async function adminReviewCommunity(challengeId: string, action: AdminCommunityAction): Promise<void> {
  const { error } = await client().rpc('admin_review_community', { p_challenge_id: challengeId, p_action: action });
  if (error) throw new Error(error.message);
}

export interface CommunityConfig {
  enabled: boolean;
  pre_review: boolean;
  age_gate: boolean;
  min_level: number;
  min_account_days: number;
  max_live: number;
  max_per_week: number;
  max_players: number;
  max_joined: number;
  report_threshold: number;
  wrong_codes_per_hour: number;
}

export async function getCommunityConfig(): Promise<CommunityConfig | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('community_config').select('*').maybeSingle();
  if (error || !data) return null;
  return data as CommunityConfig;
}

export async function adminSetCommunityConfig(patch: Partial<CommunityConfig>): Promise<void> {
  const { error } = await client().rpc('admin_set_community_config', { p: patch });
  if (error) throw new Error(error.message);
}
