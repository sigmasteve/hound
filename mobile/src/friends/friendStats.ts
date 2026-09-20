import { supabase } from '../lib/supabase';
import { supabaseChallengesProvider } from '../challenges/supabaseChallenges';
import { buildBoard, headStartBaselineDayKey, huntEffectiveMetric, isChallengeFinished, withHuntCatches } from '../challenges/board';
import { boardSortFor } from '../challenges/scoring';

export interface HeadToHeadRecord {
  // Every challenge the two of you have both ever been a real
  // participant in, finished or still running.
  together: number;
  // Only ever counts a *finished* shared challenge — an in-progress one
  // has no result yet, so it contributes to `together` but not to
  // wins/losses/ties.
  wins: number;
  losses: number;
  ties: number;
}

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

async function requireUserId(): Promise<string> {
  const { data } = await requireClient().auth.getUser();
  if (!data.user) throw new Error('Sign in to do that.');
  return data.user.id;
}

// Every challenge_participants row for friendUserId that RLS lets the
// caller see at all — "Participants can view each other"
// (0001_challenges_schema.sql) only permits that when the caller is also
// a participant of the same challenge, so this is already exactly
// "challenges we're both in," not something this query has to filter
// for itself.
async function sharedChallengeIds(friendUserId: string): Promise<string[]> {
  const client = requireClient();
  const { data, error } = await client
    .from('challenge_participants')
    .select('challenge_id')
    .eq('user_id', friendUserId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => row.challenge_id as string);
}

export async function getHeadToHeadRecord(friendUserId: string): Promise<HeadToHeadRecord> {
  const myId = await requireUserId();
  const challengeIds = await sharedChallengeIds(friendUserId);
  const record: HeadToHeadRecord = { together: challengeIds.length, wins: 0, losses: 0, ties: 0 };

  for (const challengeId of challengeIds) {
    const challenge = await supabaseChallengesProvider.getChallenge(challengeId);
    const [participants, leaderboard] = await Promise.all([
      supabaseChallengesProvider.listParticipants(challengeId),
      supabaseChallengesProvider.getLeaderboard(challengeId),
    ]);

    // Built from *every* real participant, not just these two — a hunt
    // with more than one Hunted needs the whole group to correctly know
    // whether it's actually concluded (isChallengeFinished/
    // isHuntConcluded both check that every Hunted has been caught, not
    // just whichever one happens to be this friend). No bots: they're not
    // a real person a head-to-head record means anything against.
    const sortBy = boardSortFor(challenge);
    const headStartLeaderboard =
      challenge.kind === 'hunt' && challenge.headStartDays
        ? await supabaseChallengesProvider.getLeaderboard(challengeId, headStartBaselineDayKey(challenge))
        : [];
    const board = withHuntCatches(
      buildBoard(participants, leaderboard, [], 0, sortBy, challenge, headStartLeaderboard),
      sortBy,
      challenge,
    );

    if (!isChallengeFinished(challenge, board)) continue;

    const mine = board.find((r) => r.userId === myId);
    const theirs = board.find((r) => r.userId === friendUserId);
    if (!mine || !theirs) continue;

    // Same rule buildBoard's own sort uses (see that file's comment): a
    // caught Zombie lost outright, whatever the raw numbers say, before
    // anything else is compared.
    const mineCaught = mine.role === 'zombie';
    const theirsCaught = theirs.role === 'zombie';
    if (mineCaught !== theirsCaught) {
      if (mineCaught) record.losses++;
      else record.wins++;
      continue;
    }

    const myMetric = huntEffectiveMetric(mine, sortBy);
    const theirMetric = huntEffectiveMetric(theirs, sortBy);
    if (myMetric > theirMetric) record.wins++;
    else if (myMetric < theirMetric) record.losses++;
    else record.ties++;
  }

  return record;
}
