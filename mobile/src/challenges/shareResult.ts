import type { HuntLabels } from '../labels/types';

// One line summing up how a finished challenge went for the viewer, in
// the first person — the body of the "Share result" message. Each kind
// reads its own outcome, since "1st of 6" means nothing for a group pool
// or a Tag game (neither is ranked).
export type ResultOutcome =
  | { type: 'ranked'; rank: number; of: number; metric: string }
  | { type: 'hunter'; caught: number; of: number }
  | { type: 'hunted'; caught: boolean }
  | { type: 'streak'; survived: boolean; days: number }
  | { type: 'bingo'; filled: number; total: number; blackout: boolean }
  | { type: 'pool'; total: string; goalMet: boolean }
  | { type: 'tag'; goalMet: boolean }
  | { type: 'seventyfive'; longestStreak: number; days: number }
  | { type: 'tictacgo'; result: 'won' | 'lost' | 'draw' };

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function resultLine(challengeName: string, outcome: ResultOutcome, labels: HuntLabels): string {
  switch (outcome.type) {
    case 'ranked':
      return outcome.rank === 1
        ? `I won ${challengeName} with ${outcome.metric}! 🏆`
        : `I finished ${ordinal(outcome.rank)} of ${outcome.of} in ${challengeName} with ${outcome.metric}.`;
    case 'hunter':
      return outcome.caught === outcome.of
        ? `I was the ${labels.hunter} in ${challengeName} and caught every last ${labels.hunted}! 🏆`
        : `I was the ${labels.hunter} in ${challengeName} and caught ${outcome.caught} of ${outcome.of}.`;
    case 'hunted':
      return outcome.caught
        ? `The ${labels.hunter} caught me in ${challengeName} — rematch time.`
        : `I made it through ${challengeName} without getting caught by the ${labels.hunter}! 🏆`;
    case 'streak':
      return outcome.survived
        ? `I hit my goal every single day of ${challengeName}! 🔥`
        : `My streak lasted ${plural(outcome.days, 'day')} in ${challengeName}.`;
    case 'bingo':
      return outcome.blackout
        ? `I filled my whole card in ${challengeName} — blackout! 🏆`
        : `I filled ${outcome.filled} of ${outcome.total} squares in ${challengeName}.`;
    case 'pool':
      return outcome.goalMet
        ? `We hit our group target in ${challengeName} — ${outcome.total} together! 🎉`
        : `Our group covered ${outcome.total} together in ${challengeName}.`;
    case 'tag':
      return outcome.goalMet
        ? `We hit our group goal and wrapped up ${challengeName}! 🎉`
        : `We just wrapped up ${challengeName}.`;
    case 'seventyfive':
      return outcome.longestStreak >= outcome.days
        ? `I completed all ${outcome.days} days of ${challengeName}! 🔥`
        : `My longest streak in ${challengeName} was ${plural(outcome.longestStreak, 'day')}.`;
    case 'tictacgo':
      return outcome.result === 'won'
        ? `I won ${challengeName} on Tic-Tac-Go! 🏆`
        : outcome.result === 'draw'
          ? `${challengeName} ended in a draw on Tic-Tac-Go.`
          : `I lost ${challengeName} on Tic-Tac-Go — rematch time.`;
  }
}

// The full message handed to the OS share sheet: the result, then an
// invite link (the viewer's own friend code) when there is one.
export function shareMessage(line: string, inviteUrl: string | null): string {
  return inviteUrl ? `${line}\n\nChallenge me on Hound: ${inviteUrl}` : `${line}\n\nChallenge me on Hound!`;
}
