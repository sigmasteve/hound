import { BOT_PRESETS } from './botSimulation';
import type {
  BingoCardType,
  Challenge,
  ChallengeBot,
  ChallengeKind,
  DistanceGoalUnit,
  Participant,
  ScoringMethod,
} from './types';
import type { Friend } from '../friends/types';

// Everything CreateScreen needs to start a new challenge that mirrors a
// finished one — same game, same rules, same length, same people. Plain
// data only (it rides along as a navigation param), and every field is
// just a starting value: the wizard stays fully editable.
export interface RematchDraft {
  sourceName: string;
  kind: ChallengeKind;
  name: string;
  durationDays: number;
  scoringMethod: ScoringMethod | null;
  headStartDays: number | null;
  distanceGoalUnit: DistanceGoalUnit | null;
  distanceGoalMi: number | null;
  distanceGoalSteps: number | null;
  dailyGoalSteps: number | null;
  bingoCardType: BingoCardType | null;
  organizationId: string | null;
  // Accepted friends only — anyone else from the old challenge can't be
  // invited from Create (it only lists friends), so they're left out
  // rather than silently dropped at save time.
  invitedUserIds: string[];
  // BOT_PRESETS ids, matched by name.
  botPresetIds: string[];
  // Hunt only: 'me', a friend's userId, or a BOT_PRESETS id — same shape
  // as CreateScreen's own hunterId.
  hunterId: string;
  // How many people from the old challenge couldn't be carried over
  // because they aren't the viewer's friends.
  skippedCount: number;
}

const REMATCH_SUFFIX = ' (Rematch)';

export function rematchName(name: string): string {
  const base = name.endsWith(REMATCH_SUFFIX) ? name.slice(0, -REMATCH_SUFFIX.length) : name;
  return `${base}${REMATCH_SUFFIX}`;
}

export function buildRematchDraft({
  challenge,
  participants,
  bots,
  friends,
  myUserId,
}: {
  challenge: Challenge;
  participants: Participant[];
  bots: ChallengeBot[];
  friends: Friend[];
  myUserId: string;
}): RematchDraft {
  const friendIds = new Set(friends.filter((f) => f.status === 'accepted').map((f) => f.userId));
  const others = participants.filter((p) => p.userId !== myUserId);
  const invitedUserIds = others.filter((p) => friendIds.has(p.userId)).map((p) => p.userId);
  const botPresetIds = bots
    .map((b) => BOT_PRESETS.find((preset) => preset.name === b.name)?.id)
    .filter((id): id is string => !!id);

  let hunterId = 'me';
  if (challenge.kind === 'hunt') {
    const hunterParticipant = participants.find((p) => p.role === 'hunter');
    const hunterBot = bots.find((b) => b.role === 'hunter');
    if (hunterParticipant && hunterParticipant.userId !== myUserId && invitedUserIds.includes(hunterParticipant.userId)) {
      hunterId = hunterParticipant.userId;
    } else if (!hunterParticipant && hunterBot) {
      hunterId = BOT_PRESETS.find((preset) => preset.name === hunterBot.name)?.id ?? 'me';
    }
  }

  return {
    sourceName: challenge.name,
    kind: challenge.kind,
    name: rematchName(challenge.name),
    durationDays: challenge.durationDays,
    scoringMethod: challenge.scoringMethod,
    headStartDays: challenge.headStartDays,
    distanceGoalUnit: challenge.distanceGoalUnit,
    distanceGoalMi: challenge.distanceGoalMi,
    distanceGoalSteps: challenge.distanceGoalSteps,
    dailyGoalSteps: challenge.dailyGoalSteps,
    bingoCardType: challenge.bingoCardType,
    organizationId: challenge.organizationId,
    // Tic-Tac-Go is strictly 1v1.
    invitedUserIds: challenge.kind === 'tictacgo' ? invitedUserIds.slice(0, 1) : invitedUserIds,
    botPresetIds,
    hunterId,
    skippedCount: others.length - invitedUserIds.length,
  };
}
