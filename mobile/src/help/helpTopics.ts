import { CHALLENGE_TYPES } from '../data/sampleData';
import type { HuntLabels } from '../labels/types';

// The Help screen's how-to guide, as plain data — kept out of the screen
// itself so the copy can be edited (or a topic added) without touching
// any layout code. Every string here describes what the app actually
// does today; when a feature changes, its topic here should too.

export type HelpSectionId = 'basics' | 'challenges' | 'rewards' | 'friends' | 'settings';

export interface HelpTopic {
  id: string;
  section: HelpSectionId;
  title: string;
  // One line shown under the title while collapsed.
  summary: string;
  // Numbered when `numbered`, otherwise bulleted.
  steps: string[];
  numbered?: boolean;
  tip?: string;
}

export const HELP_SECTIONS: { id: HelpSectionId; label: string }[] = [
  { id: 'basics', label: 'The basics' },
  { id: 'challenges', label: 'Challenges' },
  { id: 'rewards', label: 'Score & rewards' },
  { id: 'friends', label: 'Friends' },
  { id: 'settings', label: 'Settings & account' },
];

// Words that vary per viewer: an org can rename Bones and the Chase
// roles, so the guide uses the same names the rest of the app shows them.
export function buildHelpTopics({ currency, labels }: { currency: string; labels: HuntLabels }): HelpTopic[] {
  return [
    {
      id: 'navigating',
      section: 'basics',
      title: 'Getting around',
      summary: 'What each icon in the top bar does.',
      steps: [
        'House — Today: your score, balance, and anything that needs you right now.',
        'Flag — Challenges: everything you’re in, invites waiting on you, and your medals.',
        'Chart — Data: your steps, distance, and workouts over time.',
        'People — Friends: your friends, requests, and ways to add someone.',
        'Plug — Connect: link your phone’s health app.',
        'Your avatar (top right) opens Settings. The ? opens this guide.',
      ],
    },
    {
      id: 'connect',
      section: 'basics',
      title: 'Connect your health data',
      summary: 'Hound reads your steps, distance, and workouts from your phone.',
      numbered: true,
      steps: [
        'Open the Connect tab (plug icon).',
        'Tap Apple Health on iPhone, or Health Connect on Android.',
        'Allow Hound to read steps, distance, and workouts when your phone asks.',
        'That’s it — new activity syncs on its own whenever you open the app.',
      ],
      tip: 'Numbers look behind? Settings → Connected sources → Sync now.',
    },
    {
      id: 'today',
      section: 'basics',
      title: 'The Today screen',
      summary: 'Your home base — check it once a day.',
      steps: [
        `Hound Score and your ${currency} balance sit at the top.`,
        'Needs attention lists anything waiting on you: your move in Tic-Tac-Go, picking a target when you’re It in Tag, today’s 75 Day checklist, or progress to log.',
        'Challenges you’ve highlighted show up here too, so the ones you care about most are always one glance away.',
        `Early in each week (Monday to Wednesday), a recap card shows last week’s steps, challenges finished, Hound Score, and ${currency} earned. Tap the X to hide it until next week.`,
      ],
    },
    {
      id: 'create',
      section: 'challenges',
      title: 'Start a challenge',
      summary: 'Pick a game, set the dates, invite friends.',
      numbered: true,
      steps: [
        'Open the Challenges tab and tap New challenge.',
        'Pick a challenge type (see “Challenge types” below).',
        'Name it and choose when it starts and how long it runs.',
        'Invite friends, then create it — they’ll get an invite to join.',
      ],
      tip: `A type with a lock on it unlocks once you’ve earned enough ${currency} — the lock shows how many.`,
    },
    {
      id: 'join',
      section: 'challenges',
      title: 'Join and invite',
      summary: 'Accepting invites, and bringing more people in.',
      steps: [
        'Invites you’ve received appear at the top of the Challenges tab — tap Join or Decline.',
        'To invite someone to a challenge you’re in, open it and use Invite a friend.',
        'Invites close 24 hours after a challenge starts, so nobody joins late with an unfair read on the standings.',
      ],
    },
    {
      id: 'types',
      section: 'challenges',
      title: 'Challenge types',
      summary: 'Every game you can play, in one line each.',
      steps: CHALLENGE_TYPES.map((t) => {
        const desc =
          t.id === 'hunt'
            ? `The ${labels.hunted} gets a head start; the ${labels.hunter} has to catch them on logged miles before time runs out.`
            : t.desc;
        return `${t.name} — ${desc}`;
      }),
    },
    {
      id: 'detail',
      section: 'challenges',
      title: 'Leaderboards and challenge details',
      summary: 'Standings, highlights, and adding people you meet.',
      steps: [
        'Tap any challenge to see its leaderboard and progress.',
        'Turn on Highlight on Home to pin it to your Today screen.',
        'See someone you’d like to keep up with? Tap Add next to their name to send a friend request (Tic-Tac-Go is one-on-one, so it has no leaderboard).',
        'In Step Races and Chases, the small ▲ or ▼ under a rank shows how many places someone has moved since yesterday.',
        'When a challenge ends, the result shows at the top of its leaderboard and your medal is added on the Challenges tab.',
        'Finished challenges show That’s a wrap: tap Rematch to start the same game with the same rules and friends, or Share result to post how you did with an invite link.',
      ],
    },
    {
      id: 'score',
      section: 'rewards',
      title: 'Hound Score and levels',
      summary: 'Two numbers: how much you’ve won, and how much you’ve played.',
      steps: [
        'Hound Score grows from your results when a challenge wraps up. It never goes down.',
        'XP comes from simply taking part, win or lose, and fills up your level.',
        'New levels unlock new frames and backgrounds in your Locker.',
      ],
    },
    {
      id: 'currency',
      section: 'rewards',
      title: currency,
      summary: `How you earn ${currency}, and what they’re for.`,
      steps: [
        `You earn ${currency} every time a challenge you’re in wraps up, plus a bonus each time you level up.`,
        `Opening the app each day adds a daily bonus (see below).`,
        `Spend ${currency} in the Shop tab of your Locker on looks no level unlocks.`,
        'Limited-time drops (like Halloween) sit at the top of the Shop until they end — anything you buy from one is yours to keep afterward.',
        `Some challenge types unlock after you’ve earned enough ${currency} through play. Spending never re-locks them.`,
      ],
    },
    {
      id: 'daily-bonus',
      section: 'rewards',
      title: 'Daily bonus and streak',
      summary: 'Open Hound every day for a little extra.',
      steps: [
        `The first time you open the app each day, you get a small ${currency} bonus.`,
        'Come back on consecutive days to build a streak — every 7th day pays a bigger weekly bonus.',
        'Miss a day and your streak starts over at day 1 (you still get that day’s bonus).',
      ],
      tip: 'Turn on Daily reminders in Settings and Hound will nudge you in the evening.',
    },
    {
      id: 'locker',
      section: 'rewards',
      title: 'Customize your look',
      summary: 'Frames, backgrounds, and avatar icons.',
      numbered: true,
      steps: [
        'Tap your avatar (top right) to open Settings.',
        'Tap Customize your look to open your Locker.',
        `Pick a frame, background, or icon you’ve unlocked — or buy one in the Shop with ${currency}.`,
        'Your look shows everywhere your avatar does: leaderboards, friends, and the top bar.',
      ],
    },
    {
      id: 'add-friends',
      section: 'friends',
      title: 'Add a friend',
      summary: 'Four ways to connect — pick whichever’s easiest.',
      steps: [
        'Invite by email: on the Friends tab, tap Invite by email. If they’re not on Hound yet, they’ll get an invite and you’ll be connected when they sign up.',
        'Share my code: show your QR code, or copy or share your link.',
        'Enter a code: paste a friend’s code or link to connect instantly.',
        'From a leaderboard: tap Add next to anyone in a challenge with you.',
      ],
    },
    {
      id: 'requests',
      section: 'friends',
      title: 'Friend requests',
      summary: 'Accepting, declining, and cancelling.',
      steps: [
        'Requests waiting on you are at the top of the Friends tab — tap Accept or Decline.',
        'Invites you’ve sent are listed under Pending at the bottom; tap Cancel to withdraw one.',
        'If someone already asked you and you add them back, you just become friends.',
      ],
    },
    {
      id: 'friend-profile',
      section: 'friends',
      title: 'Head-to-head and kudos',
      summary: 'See how you stack up against a friend.',
      steps: [
        'Tap a friend to see how many challenges you’ve done together and your record against them.',
        'Send kudos to cheer them on — they’re unlimited and just for fun.',
      ],
    },
    {
      id: 'notifications',
      section: 'settings',
      title: 'Notifications and reminders',
      summary: 'Choose what Hound tells you about.',
      steps: [
        'Open Settings → Notifications to turn push and email notifications on or off.',
        'Daily reminders are on-device nudges for your daily bonus and anything on your Needs attention list.',
        'Open Advanced to pick exactly which alerts you get, and how.',
      ],
    },
    {
      id: 'account',
      section: 'settings',
      title: 'Appearance, goals, and username',
      summary: 'Make the app yours.',
      steps: [
        'Appearance: Hound is dark by default — turn on Light mode for a bright background.',
        'Daily goals: set your daily steps and distance targets with the sliders.',
        'Username: save a username, then turn on Use username in challenges to show it instead of your real name on leaderboards and invites.',
      ],
    },
    {
      id: 'orgs',
      section: 'settings',
      title: 'Organizations',
      summary: 'For schools and companies using Hound together.',
      steps: [
        'If you belong to an organization, it appears in Settings.',
        `Your organization may use its own words — for example, calling the Chase roles “${labels.hunter}” and “${labels.hunted}”, or renaming ${currency}.`,
        'Organization admins manage their members from the building icon in the top bar.',
      ],
    },
  ];
}
