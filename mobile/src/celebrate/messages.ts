import type { CelebrateTone } from './prefs';

// What Hound says when you finish your goals, finish one, or miss a day,
// in the tone picked in Settings: Playful (the default) teases a little,
// never guilt; Roast me is for people who like it more competitive.

export function allDoneMessage(tone: CelebrateTone, houndName: string, streak: number) {
  const streakLine = streak > 1 ? ` That's ${streak} days in a row.` : '';
  return tone === 'roast'
    ? { title: 'Finally! 🎉', body: `${houndName} was starting to worry.${streakLine} Do it again tomorrow.` }
    : { title: 'All goals done! 🎉', body: `${houndName} is doing zoomies.${streakLine}` };
}

export function oneDoneMessage(tone: CelebrateTone, goalTitle: string) {
  return tone === 'roast' ? `${goalTitle}: done. Don't stop there.` : `${goalTitle}: done ✅`;
}

export function manyDoneMessage(tone: CelebrateTone, count: number) {
  return tone === 'roast' ? `${count} goals done. Keep going.` : `${count} goals done ✅`;
}

// shielded: a Streak Shield covers yesterday once today's goals are done.
export function missedMessage(tone: CelebrateTone, houndName: string, streakLost: number, shielded: boolean) {
  if (shielded) {
    return tone === 'roast'
      ? {
          title: 'Oh snap! 😬',
          body: `You skipped yesterday and ${houndName} noticed. Finish today's goals and your Streak Shield bails you out. Just this once.`,
        }
      : {
          title: 'Oh snap…',
          body: `Yesterday got away from you. Finish today's goals and a Streak Shield saves your ${streakLost}-day streak 🛡️`,
        };
  }
  return tone === 'roast'
    ? {
        title: 'Oh snap! 😬',
        body: `${houndName} saw that. 0 for yesterday${streakLost > 1 ? `, and there goes your ${streakLost}-day streak` : ''}. Redemption starts now.`,
      }
    : {
        title: 'Oh snap…',
        body: `${houndName} waited by the door all day 🐾${streakLost > 1 ? ` Your ${streakLost}-day streak reset.` : ''} Today's a fresh start.`,
      };
}
