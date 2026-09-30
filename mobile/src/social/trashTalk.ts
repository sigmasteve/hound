import { supabase } from '../lib/supabase';

// Trash talk: a short message wall on each challenge (0083_trash_talk.sql).

export const TRASH_TALK_MAX_LENGTH = 140;
// How often an open wall checks for new messages (and for the admin's
// free-text switch).
export const TRASH_TALK_REFRESH_MS = 15_000;

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

export interface TrashTalkMessage {
  id: string;
  userId: string;
  name: string;
  initials: string;
  frameId: string | null;
  backgroundId: string | null;
  iconId: string | null;
  kind: 'taunt' | 'text';
  body: string;
  createdAt: string;
}

// Why free text isn't offered: the admin switch is off, it's a global
// challenge, or the challenge is over.
export type FreeTextOffReason = 'off' | 'global' | 'ended' | null;

export interface TrashTalkStatus {
  canPost: boolean;
  freeTextAllowed: boolean;
  freeTextReason: FreeTextOffReason;
  readOnly: boolean;
  retentionDays: number;
  // The caller turned off trash-talk pushes for this challenge.
  pushesMuted: boolean;
}

export async function getTrashTalkStatus(challengeId: string): Promise<TrashTalkStatus> {
  const { data, error } = await requireClient().rpc('trash_talk_status', { p_challenge_id: challengeId });
  if (error) throw new Error(error.message);
  const r = (Array.isArray(data) ? data[0] : data) as any;
  return {
    canPost: !!r?.can_post,
    freeTextAllowed: !!r?.free_text_allowed,
    freeTextReason: (r?.free_text_reason ?? null) as FreeTextOffReason,
    readOnly: !!r?.read_only,
    retentionDays: Number(r?.retention_days ?? 7),
    pushesMuted: !!r?.pushes_muted,
  };
}

export async function listTrashTalk(challengeId: string): Promise<TrashTalkMessage[]> {
  const { data, error } = await requireClient().rpc('list_trash_talk', { p_challenge_id: challengeId, p_limit: 50 });
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id,
    userId: r.user_id,
    name: r.name,
    initials: r.initials,
    frameId: r.frame_id,
    backgroundId: r.background_id,
    iconId: r.icon_id,
    kind: r.kind,
    body: r.body,
    createdAt: r.created_at,
  }));
}

export async function postTrashText(challengeId: string, body: string): Promise<void> {
  const { error } = await requireClient().rpc('post_trash_talk', { p_challenge_id: challengeId, p_body: body });
  if (error) throw new Error(error.message);
}

export async function postTaunt(challengeId: string, taunt: TauntChip): Promise<void> {
  const { error } = await requireClient().rpc('post_trash_talk', {
    p_challenge_id: challengeId,
    p_taunt: taunt.id,
    p_target: taunt.targetId ?? null,
    p_n: taunt.n ?? null,
    p_unit: taunt.unit ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function deleteTrashTalk(messageId: string): Promise<void> {
  const { error } = await requireClient().rpc('delete_trash_talk', { p_message_id: messageId });
  if (error) throw new Error(error.message);
}

export async function reportTrashTalk(messageId: string, reason?: string): Promise<void> {
  const { error } = await requireClient().rpc('report_trash_talk', { p_message_id: messageId, p_reason: reason ?? null });
  if (error) throw new Error(error.message);
}

export async function setTrashTalkMute(userId: string, muted: boolean): Promise<void> {
  const { error } = await requireClient().rpc('set_trash_talk_mute', { p_user: userId, p_muted: muted });
  if (error) throw new Error(error.message);
}

// No trash-talk pushes from this one challenge (its wall still shows
// everything).
export async function setTrashTalkChallengeMuted(challengeId: string, muted: boolean): Promise<void> {
  const { error } = await requireClient().rpc('set_trash_talk_challenge_muted', {
    p_challenge_id: challengeId,
    p_muted: muted,
  });
  if (error) throw new Error(error.message);
}

export async function myTrashTalkMutes(): Promise<{ userId: string; name: string }[]> {
  const { data, error } = await requireClient().rpc('my_trash_talk_mutes');
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map((r) => ({ userId: r.user_id, name: r.name }));
}

// ── Taunt chips ──────────────────────────────────────────────────────

export type TauntUnit = 'steps' | 'mi' | 'squares' | 'days';

export interface TauntChip {
  id: 'catch_me' | 'rearview' | 'all_you_got' | 'couch' | 'warming_up' | 'coming_for' | 'ahead_by' | 'behind_by' | 'wake_up';
  // What the chip shows — post_trash_talk builds the same text on the
  // server.
  label: string;
  targetId?: string;
  n?: number;
  unit?: TauntUnit;
}

export interface Standing {
  userId: string;
  name: string;
  value: number;
}

function firstName(name: string): string {
  return name.split(' ')[0] || name;
}

export function formatAmount(n: number, unit: TauntUnit): string {
  if (unit === 'mi') return `${n.toFixed(1)} mi`;
  const whole = Math.round(n);
  const word = unit === 'squares' ? 'square' : unit === 'days' ? 'day' : 'step';
  return `${whole.toLocaleString('en-US')} ${word}${whole === 1 ? '' : 's'}`;
}

// The chips for the caller, built from where everyone stands: the
// numbers come straight from the leaderboard they're looking at.
export function tauntChips(standings: Standing[] | null, myId: string | undefined, unit: TauntUnit | null): TauntChip[] {
  const chips: TauntChip[] = [];
  const board = standings && myId ? [...standings].sort((a, b) => b.value - a.value) : [];
  const me = board.findIndex((s) => s.userId === myId);

  if (me >= 0 && board.length > 1 && unit) {
    const mine = board[me];
    const above = me > 0 ? board[me - 1] : null;
    const below = me < board.length - 1 ? board[me + 1] : null;
    const last = board[board.length - 1];
    if (below && mine.value - below.value > 0) {
      const n = unit === 'mi' ? Math.round((mine.value - below.value) * 10) / 10 : Math.round(mine.value - below.value);
      if (n > 0) {
        chips.push({ id: 'ahead_by', label: `I'm ${formatAmount(n, unit)} ahead of ${firstName(below.name)} 😏`, targetId: below.userId, n, unit });
      }
    }
    if (above && above.value - mine.value > 0) {
      const n = unit === 'mi' ? Math.round((above.value - mine.value) * 10) / 10 : Math.round(above.value - mine.value);
      if (n > 0) {
        chips.push({ id: 'behind_by', label: `Only ${formatAmount(n, unit)} behind ${firstName(above.name)}… for now 😤`, targetId: above.userId, n, unit });
      }
    }
    if (me > 0) {
      const leader = board[0];
      chips.push({ id: 'coming_for', label: `${firstName(leader.name)}, I'm coming for you 👀`, targetId: leader.userId });
    }
    if (last.userId !== myId && last.userId !== board[0].userId) {
      chips.push({ id: 'wake_up', label: `Wake up, ${firstName(last.name)}! ⏰`, targetId: last.userId });
    }
    if (me < board.length - 1) chips.push({ id: 'rearview', label: 'See you in my rearview 👋' });
  }
  // Leading, or no standings to go on.
  if (me <= 0) chips.push({ id: 'catch_me', label: 'Catch me if you can 🐾' });
  chips.push({ id: 'all_you_got', label: 'Is that all you got?' });
  chips.push({ id: 'warming_up', label: "I'm just warming up 🔥" });
  chips.push({ id: 'couch', label: "Somebody's couch is getting comfy 🛋️" });
  return chips;
}

// "2m", "3h", "Tue".
export function messageTime(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short' });
}

// ── Admin ────────────────────────────────────────────────────────────

export interface TrashTalkConfig {
  freeTextEnabled: boolean;
  filterProfanity: boolean;
  retentionDays: 0 | 3 | 7 | 30;
}

export const RETENTION_OPTIONS: TrashTalkConfig['retentionDays'][] = [0, 3, 7, 30];

// Null if it can't be read (e.g. before 0083 has run).
export async function getTrashTalkConfig(): Promise<TrashTalkConfig | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('trash_talk_config')
    .select('free_text_enabled, filter_profanity, retention_days')
    .maybeSingle();
  if (error || !data) return null;
  return {
    freeTextEnabled: data.free_text_enabled,
    filterProfanity: data.filter_profanity,
    retentionDays: data.retention_days,
  };
}

// Takes effect at once: the server checks it on every post and every
// wall read.
export async function setTrashTalkConfig(patch: Partial<TrashTalkConfig>): Promise<void> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.freeTextEnabled !== undefined) row.free_text_enabled = patch.freeTextEnabled;
  if (patch.filterProfanity !== undefined) row.filter_profanity = patch.filterProfanity;
  if (patch.retentionDays !== undefined) row.retention_days = patch.retentionDays;
  const { error } = await requireClient().from('trash_talk_config').update(row).eq('id', true);
  if (error) throw new Error(error.message);
}

export interface TrashTalkReport {
  messageId: string;
  body: string;
  kind: 'taunt' | 'text';
  authorName: string;
  challengeName: string;
  postedAt: string;
  reportCount: number;
  reasons: string[];
}

export async function listTrashTalkReports(): Promise<TrashTalkReport[]> {
  const { data, error } = await requireClient().rpc('admin_trash_talk_reports');
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map((r) => ({
    messageId: r.message_id,
    body: r.body,
    kind: r.kind,
    authorName: r.author_name,
    challengeName: r.challenge_name,
    postedAt: r.posted_at,
    reportCount: r.report_count,
    reasons: r.reasons ?? [],
  }));
}

export async function resolveTrashTalkReport(messageId: string, remove: boolean): Promise<void> {
  const { error } = await requireClient().rpc('admin_resolve_trash_talk', { p_message_id: messageId, p_remove: remove });
  if (error) throw new Error(error.message);
}
