import { CHALLENGE_TYPES } from '../data/sampleData';
import type { HuntLabels } from '../labels/types';

// The Help screen's how-to guide, as plain data — kept out of the screen
// itself so the copy can be edited (or a topic added) without touching
// any layout code. Every string here describes what the app actually
// does today; when a feature changes, its topic here should too.

export type HelpSectionId = 'basics' | 'challenges' | 'hound' | 'rewards' | 'friends' | 'settings';

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
  { id: 'hound', label: 'Your hound' },
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
      summary: 'The four tabs at the bottom of the screen.',
      steps: [
        'Today: your challenges and anything that needs you right now.',
        'Challenges: everything you’re in, invites waiting on you, and your medals.',
        'Friends: your friends, requests, and ways to add someone.',
        `You (your picture): your level, Hound Score and ${currency}, then Your progress (Goals, Stats & records, Achievements), Spend your ${currency} (Your look, Kennel) and App (Health data, Settings and this Help guide). Tap ${currency} to see how to earn and spend them.`,
      ],
    },
    {
      id: 'connect',
      section: 'basics',
      title: 'Connect your health data',
      summary: 'Hound reads your steps, distance, and workouts from your phone.',
      numbered: true,
      steps: [
        'Open You → Health data. (Hound also asks right after you sign up.)',
        'Tap Apple Health on iPhone, or Health Connect on Android.',
        'Allow Hound to read steps, distance, and workouts when your phone asks.',
        'That’s it — new activity syncs on its own whenever you open the app.',
      ],
      tip: 'Numbers look behind? You → Health data → Sync now.',
    },
    {
      id: 'android-missing',
      section: 'basics',
      title: 'Android: steps or workouts missing',
      summary: 'Samsung Health, WHOOP and your watch all share through Health Connect.',
      numbered: true,
      steps: [
        'On Android, Hound reads Health Connect, the phone’s shared health store. Samsung Health, WHOOP, Google Health and watch apps each have to share into it.',
        'Open You → Health data and look at “Where your data comes from” to see which apps shared this week, and which one Hound’s step total counts.',
        'In Health Connect → Data and access → App permissions → Hound, allow Steps, Distance and Exercise.',
        'In Samsung Health → ⋮ → Settings → Health Connect, turn on syncing and allow Steps, Distance and Exercise.',
        'In WHOOP → More → Account & Settings → Integrations → Health Connect, allow Exercise.',
        'Set Samsung Health (and Galaxy Wearable) to Unrestricted battery use, then open it once so it syncs.',
      ],
      tip: 'WHOOP shares workouts but not steps with Health Connect, so on Android your phone or another watch counts your steps. When two apps count the same minutes, Health Connect keeps only one — you choose which in Health Connect → Activity → Steps → Data sources and priority.',
    },
    {
      id: 'today',
      section: 'basics',
      title: 'The Today screen',
      summary: 'Your home base — check it once a day.',
      steps: [
        'Your goals come first: the Hound’s on you card shows each goal, where you are on it, and what’s left. Tap Edit to change them.',
        `New here? A short setup walks you through it one step at a time: connect your health app, say how you’ll use Hound, set goals, turn on notifications, add a friend, join a challenge and meet your hound. Connect health, add a friend and join a challenge for a ${currency} reward. Skipped something? Today’s “Finish setting up” picks up where you left off.`,
        'Below your challenges list is one featured challenge: the one you’ve pinned with Pin to Today, or otherwise your newest active one. To only feature one you pin, turn off Newest challenge on Today in Settings.',
        'Needs you lists anything waiting on you: challenge invites, friend requests, your move in Tic-Tac-Go, picking a target when you’re It in Tag, today’s 75 Day checklist, or progress to log.',
        `Your Hound Score, level and ${currency} balance are on the You tab.`,
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
      id: 'global',
      section: 'challenges',
      title: 'Global Hound Challenges',
      summary: 'Challenges open to everyone on Hound.',
      steps: [
        'Global Hound Challenges appear on your Today screen — tap Join to hop in. No invite needed.',
        'Each one shows when it starts, how many people have joined, and when joining closes. After that, it drops off Today for anyone who hasn’t joined.',
        'Once you’re in, it works like any other challenge: it’s on your Challenges tab, your steps sync on their own, and it pays Hound Score and rewards when it wraps up.',
        'Spot someone on its leaderboard you’d like to keep up with? Tap Add next to their name.',
        `Some have prizes for the top 3, shown on the card. Hound pays them in ${currency} when it ends, and ties share a place.`,
        'Some are sponsored by a brand, shown as “Sponsored by” on the card. Tap it to visit their site. Any real prize they offer comes from the sponsor, and Hound never shares your details with them.',
      ],
    },
    {
      id: 'pot',
      section: 'challenges',
      title: `${currency} pots`,
      summary: `Put ${currency} in a Step Race or Tic-Tac-Go, winner takes all.`,
      steps: [
        `When you create a Step Race or Tic-Tac-Go, you can add a pot: 10, 25, 50 or 100 ${currency} each.`,
        'Joining the pot is optional. Anyone in the challenge can join from its page until a day after it starts.',
        `Step Race: whoever in the pot has the most steps takes it all, and a tie splits it. Tic-Tac-Go: the winner takes it, and a draw gives everyone theirs back.`,
        `Only ${currency} you’ve earned by playing can go in a pot, never bought ones. If the pot has no winner, everyone gets their entry back.`,
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
      id: 'baseball',
      section: 'challenges',
      title: 'Baseball: picks and plays',
      summary: 'Aim your swing, call the shift, and how an at-bat is decided.',
      steps: [
        'One inning a day, both halves, played the next morning from that day’s steps. Your steps count for every at-bat and play you’re in.',
        'Each day, tap Left, Center or Right on the field to aim your swing. No pick and you swing at a random zone.',
        'The catcher calls the shift for the fielding side. Guess the batter’s zone and catches get likelier; guess wrong and they get a little harder.',
        'The pitcher picks Power (more strikeouts, harder contact) or Finesse (softer contact, more walks).',
        'Turn on Steal and, when you’re on base with the next one open, you’ll try for it: your steps against the catcher’s.',
        'At bat, it’s your steps against the pitcher’s, then the fielder’s. Big step days go further: doubles from 4,000 steps, triples and home runs from 8,000.',
        'Tied after the last inning? Extra innings, one a day, up to three. Tap Replay on an inning’s card to watch its plays on the field.',
      ],
    },
    {
      id: 'doors',
      section: 'challenges',
      title: 'Daily Doors: a door a day',
      summary: 'Open today’s door, do what’s behind it, and how the points add up.',
      steps: [
        'A Global Hound Challenge with a door for every day, like Knock Knock, Hound in December. Join it from Today.',
        'Each morning a new door opens. Tap it to open it: that’s 1 point. It only opens on its own day, so a day you don’t open stays shut.',
        'Behind it is the day’s task, the same for everyone: your steps target, a workout, your water goal, all your daily goals, a treat for your hound, a 10-minute walk, or a cheer for someone.',
        'Do it by midnight for 2 more points. Hound checks it from your Health data, water, goals and Kennel, so there’s nothing to tick. A task you’d already done counts as soon as you open the door.',
        'The steps target is your own: a little over your average for the week before.',
        'Three done doors in a row and each one after is worth 1 more. One missed day a week doesn’t break your run.',
        'Some doors have Bones behind them (every third, unless it says otherwise), and the last one a frame for your Locker you can’t buy. Most points at the end wins, and everyone in it gets Bones for finishing.',
        'To cheer someone, tap 👏 beside them in the standings.',
      ],
    },
    {
      id: 'detail',
      section: 'challenges',
      title: 'Leaderboards and challenge details',
      summary: 'Standings, highlights, and adding people you meet.',
      steps: [
        'Tap any challenge to open it. Board shows where everyone stands, Talk is the trash-talk wall, and Details has the rules, dates, inviting and deleting. The ⓘ at the top also opens Details.',
        'In Details, turn on Pin to Today to show it at the top of your Today screen.',
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
        'XP fills up your level. You earn it by taking part in challenges (win or lose), opening Hound each day, and hitting your goals.',
        'Your level gives you a rank: Pup, Tracker (level 5), Hunter (10), Alpha (15) and Legend (20). It shows on your avatar for everyone to see.',
        'New levels unlock new frames and backgrounds in Your look.',
      ],
    },
    {
      id: 'currency',
      section: 'rewards',
      title: currency,
      summary: `How you earn ${currency}, and what they’re for.`,
      steps: [
        `You earn ${currency} every time a challenge you’re in wraps up, plus a bonus each time you level up.`,
        `Opening the app each day adds a daily bonus, and hitting your goals pays too (see below).`,
        `Spend ${currency} on your hound (its wardrobe, yard, Porch, tricks and treats), garden seeds, Streak Shields, bounties, and looks in the Shop tab of Your look.`,
        'Limited-time drops (like Halloween) sit at the top of the Shop until they end — anything you buy from one is yours to keep afterward.',
        `Some challenge types unlock after you’ve earned enough ${currency} through play. Spending never re-locks them.`,
      ],
    },
    {
      id: 'achievements',
      section: 'rewards',
      title: 'Achievements',
      summary: `One-time badges that each pay ${currency}.`,
      steps: [
        'Earn badges for milestones — your first finish and first win, a Bingo blackout, a perfect Daily Streak, friends, big step days and weeks, login streaks, and levels.',
        `Each one pays ${currency} once, the moment you earn it — a popup on Today tells you what you unlocked.`,
        'See them all (and what’s left) under You → Achievements. Friends can see your badges on your profile, and you can see theirs.',
      ],
    },
    {
      id: 'goals',
      section: 'basics',
      title: 'Goals and the Hound',
      summary: 'Set a goal and Hound won’t let it go.',
      steps: [
        'Everyone starts with three goals: 10,000 steps a day, 3 miles a day and 3 workouts a week. Tap Set your goals on Today to make them yours, or change them any time under You → Goals.',
        'Add your own goal: pick steps, distance, workouts or workout minutes, every day or every week. For workouts you can choose the kind, like runs or strength.',
        'Hound looks at your last four weeks and suggests a target a little above what you usually do.',
        'Choose how hard Hound hounds you: Gentle (one evening reminder), Persistent (up to 3 a day), Relentless (up to 5) or Off.',
        'Reminders stop for the day once your goals are done. Weekly goals only remind you when you’re behind pace.',
      ],
      tip: 'Hound checks your progress in the background every so often, so reminders stop once you hit a goal. Your phone decides how often, so a reminder can still say what time its numbers are from.',
    },
    {
      id: 'water',
      section: 'basics',
      title: 'Water',
      summary: 'Log glasses of water with one tap.',
      steps: [
        'Add a water goal under You → Goals → Water: 8 cups a day to start, from 4 to 16. You can show it in cups and ounces or in millilitres.',
        'Tap the blue + on the Goals tile on Today to log a glass. Tap the water row to see the big glass, change the glass size (a cup, a bottle or a big bottle), and see today’s log and this week.',
        'Logged one by mistake? Tap Undo on the message that pops up, or Remove it in the water sheet.',
        'Water other apps put in Apple Health counts too.',
        'Water sits beside your goals: it doesn’t change your goal day, streak or Bones. Water days earn their own badges and fill your hound’s bowl in the Yard.',
        'Turn on Sip reminders for a nudge every 2 hours from 10 AM to 6 PM, until your goal’s met.',
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
      tip: 'With hounding on (You → Goals), your evening reminder mentions the bonus too.',
    },
    {
      id: 'goal-streak',
      section: 'rewards',
      title: 'Goal streak',
      summary: `Hit your goals for ${currency}, and keep the streak going.`,
      steps: [
        `Finish every daily goal on a day and you earn ${currency} for it. Today’s goals card shows what the day pays.`,
        'Days in a row build your goal streak, shown on the goals card. Every 7th day in a row pays a bigger bonus.',
        'Miss a day and the streak starts over.',
        `A Streak Shield (tap the shield next to your streak to get one with ${currency}) covers one missed day, so the streak keeps going. You can hold 2, and one covers a miss each week. Two missed days in a row still end the streak.`,
        `Finish every weekly goal in a week (Monday to Sunday) for a weekly ${currency} bonus.`,
      ],
      tip: 'Hound checks in the background, so a goal you hit without opening the app still counts once your phone lets it run. Opening Hound before midnight makes sure.',
    },
    {
      id: 'bounties',
      section: 'friends',
      title: 'Bounties',
      summary: `Put ${currency} on a step target for your friends.`,
      steps: [
        `On Today, tap Post one on the Bounties card. Pick a step target and how many ${currency} go on it.`,
        `The ${currency} come off your balance straight away, and your friends get a heads-up.`,
        `The first friend whose steps today reach the target gets the ${currency}. Nobody by midnight, and they come back to you.`,
        'You can have one bounty out at a time, and take it back until someone claims it.',
        `A friend’s bounty shows on your Today with how close you are. Reach it and Hound claims it for you.`,
      ],
    },
    {
      id: 'bone-dig',
      section: 'rewards',
      title: 'Bone Dig',
      summary: 'A free surprise once a day for finishing your goals.',
      steps: [
        'Finish every daily goal and the Bone Dig card on Today lights up. Tap Dig.',
        `A dig turns up 5 ${currency} (35% of digs), 10 (25%), 20 (10%), 50 (3%), or a piece (27%).`,
        'Pieces unlock Dig items in Your look that can’t be bought: the Fossil Ring at 5 pieces, the Dig Site background at 10, and the Bone icon at 15.',
        `Once you have all three, a piece is worth 25 ${currency} instead.`,
        'One dig a day. It’s free, and you can’t buy more.',
      ],
    },
    {
      id: 'kennel',
      section: 'hound',
      title: 'Your hound (Kennel)',
      summary: 'A hound who’s happy when you hit your goals.',
      steps: [
        'Open the Kennel from your hound on Today, or from the You tab. Tap the name to rename your hound.',
        'Their mood follows your goal days over the last week, and a goal day today always makes them happy. A quiet week just makes them sleepy.',
        `Give a treat once a day for ${currency} to cheer them up. Today’s Kennel card lists what’s left to do, and its Treat chip gives one right there.`,
        'The Kennel has five tabs: Walks (what today’s walks found, the diary and the About card), Wardrobe, Look, Yard and More (tricks).',
        'Your friends see your hound on your friend page, and you see theirs.',
        'Turn on “Use as my avatar” in the Kennel and your hound replaces your initials everywhere: leaderboards, friends and chats. It keeps your frame and background, and picking an icon in Your look switches back.',
        'Care style: Gentle is the default. Classic pet adds 3 meal hearts; one empties each day they aren’t fed, and with none left they’re hungry until you feed them. Going up a level fills every heart. You can switch back any time.',
      ],
    },
    {
      id: 'wardrobe',
      section: 'hound',
      title: 'Wardrobe and look',
      summary: 'Dress them up, and try things on before you buy.',
      steps: [
        `Wardrobe has collars and bandanas, hats, glasses, outfits (sweaters, a hoodie, a raincoat, a tutu, a cape, a tuxedo) and shoes, bought with ${currency} and kept for good.`,
        'Tap anything to try it on: the scene zooms in and a row of choices runs along the bottom. Red ✕ puts it back; green ✓ keeps it, and shows the price when it buys.',
        'Holiday drops sit first in the Wardrobe for a little while, like Thanksgiving in November and Winter from 15 November. Anything you buy, you keep.',
        `Under Look, pick their coat, ears, tail, markings and breed. Tan, Chocolate, Cream and Gray coats are free; special coats and breeds cost ${currency}.`,
      ],
    },
    {
      id: 'yard',
      section: 'hound',
      title: 'The Yard and the Porch',
      summary: 'Their home, a garden, and a porch round the back.',
      steps: [
        'Kennel → Yard: a spot for each thing, and more spots and a bigger yard as you rank up. Pick a spot (House, Bed, Bowl, Toy and more) to choose what goes there.',
        'Your hound strolls about, naps in bed or the hammock, and drinks from a bowl that fills with your water through the day.',
        'Swipe the grass to throw their toy. Swipe the sky across to go round to the Porch, and again to go inside to the room.',
        `Houses go from the free Hound House to an Igloo, a Beach Bungalow, a Modern Glass House, a Treehouse, a Castle and the Doghouse Mansion (2,500 ${currency}).`,
        'The Porch opens at Hunter (level 10): a Hot Tub, Lounge Chair, Porch Swing, Fire Pit, Patio Umbrella and Grill.',
        'Trophies you win in challenges stand in the yard. Choose which under Yard → Trophies.',
        'Tricks (Kennel → More): High Five, Spin, Roll Over and Play Dead. Double-tap your hound to do one. Friends can do it in your yard too.',
      ],
    },
    {
      id: 'walks',
      section: 'hound',
      title: 'Walks and finds',
      summary: 'Your walks become their walks, and every one finds something.',
      steps: [
        'Nothing to start or stop: 10 minutes or more of steady steps counts as a walk. Kennel → Walks shows today’s, like “Morning walk · 1.5 mi · 32 min”.',
        'Every finished walk brings something home, up to 5 a day. A walk still going says so, and finds something once you’re back.',
        'Longer walks find rarer things. There are 22 kinds: 10 all year and 3 each season, like a golden acorn in autumn or a perfect snowflake in winter.',
        'Open the collection book to see everything you’ve found, and silhouettes of what’s still out there.',
      ],
      tip: 'Walks are worked out from your steps when you open the Kennel, so open it after a walk to see what you found.',
    },
    {
      id: 'diary',
      section: 'hound',
      title: 'Your hound’s diary',
      summary: 'A line a day, in their own voice.',
      steps: [
        'Kennel → Walks has a diary for the last 7 days, written from your walks, finds, steps and water, and today’s treat and goals.',
        'Birthdays and new traits get a mention too.',
        'Only you see it. Tap Share the week to send it to someone.',
      ],
    },
    {
      id: 'garden',
      section: 'hound',
      title: 'The garden',
      summary: 'Plant a seed and your steps water it.',
      steps: [
        'Kennel → Yard → Garden has 3 plots. Tap an empty one to plant a seed.',
        'The steps you take after planting make it grow: seed, sprout, bud, then bloom. A daisy needs 20,000 steps; a giant sunflower 70,000.',
        'A day without steps just pauses it. Nothing wilts.',
        `One free seed a week (a daisy, sunflower or tulip). More come in packs of 2 or 3 for ${currency}, and some only in their season, like pumpkins in autumn.`,
        'Once it’s bloomed, tap it to pick it (it goes in “Grown so far”), or leave it to show off. Tap a plant that’s still growing to dig it up.',
      ],
    },
    {
      id: 'growth',
      section: 'hound',
      title: 'Fitness, traits, age and birthday',
      summary: 'Your hound grows with you.',
      steps: [
        'Kennel → Walks → About shows how old they are, their fitness and their traits.',
        'Fitness goes from 1 to 10 with active days (5,000 steps or more). It only goes up, and a fitter hound is livelier in the yard.',
        'Traits come from your habits and are kept for good: Early bird, Night owl, Lunch stroller, Trail dog, Well watered, Weekend warrior, Steady paws, Collector and Green paws. Tap “All 9 traits” to see how to earn each.',
        'A new hound starts as a puppy, then grows up at 100,000 and 400,000 steps.',
        'Their birthday is the day they were born, or pick your own (it can change once a month). On the day, the yard has a party and a friend’s hound comes round.',
      ],
    },
    {
      id: 'care',
      section: 'hound',
      title: 'Bath day, treats and the room',
      summary: 'A bath after a busy day, treats from your finds, and a room inside.',
      steps: [
        'A long walk (30 minutes or 3,000 steps) brings your hound home muddy. Nothing bad comes of it: it just looks the part.',
        'A busy day earns a bath: that long walk, 8,000 steps or your goals done. Kennel → Care → Give a bath, and watch the bubbles in the Yard. One a day, and they stay fresh until the next long walk.',
        `Kennel → Care → Kitchen bakes treats from the things your walks find, plus a few ${currency}: Pumpkin biscuits, a Peanut butter pupcake, Frosty paws and a Birthday cake. Your collection book still counts every find.`,
        'Treats wait in the pantry. Feed one as today’s treat, with nothing to pay, or send one to a friend’s hound: open them in Friends and tap Send a gift.',
        `The room is inside the house, a swipe on from the Porch, and open to everyone. Kennel → Yard → Room has a Fireplace, Sofa, Bookshelf, Photo Wall (with your hound’s portrait), Fireside Cushion, Cozy Rug, Floor Lamp and Potted Fern, from 150 to 900 ${currency}.`,
      ],
    },
    {
      id: 'together',
      section: 'hound',
      title: 'Playdates, walks together and the dog park',
      summary: 'Your hound and your friends’ hounds.',
      steps: [
        'Playdates: on a day you and a friend have both finished your goals, their hound comes over to play in your yard. Friends you’re in a challenge with come first. It’s the same friend all day.',
        'Walks together: when your walk and a friend’s overlap by 10 minutes or more, the walk says who with (“With Jordan’s Scout”), and so does the diary.',
        'The dog park (Kennel → Walks): friends’ hounds that have been out walking in the last day, with yours once you’ve walked. A friend who walked with you has a ♥. Tap a hound to visit their page.',
      ],
    },
    {
      id: 'locker',
      section: 'rewards',
      title: 'Customize your look',
      summary: 'Frames, backgrounds, and avatar icons.',
      numbered: true,
      steps: [
        'Open Your look from the You tab.',
        `Pick a frame, background, or icon you’ve unlocked — or buy one in the Shop with ${currency}.`,
        'Your look shows everywhere your avatar does: leaderboards, friends, and the top bar.',
      ],
    },
    {
      id: 'add-friends',
      section: 'friends',
      title: 'Add a friend',
      summary: 'Several ways to connect — pick whichever’s easiest.',
      steps: [
        'Find people: on the Friends tab, search by name or username, or pick from People you may know (people in your challenges, friends of friends, and new members). Tap Add to send a request.',
        'Share my code: show your QR code, or share your link. The link helps friends who don’t have Hound yet get the beta first, then shows them your code.',
        'Enter a code: paste a friend’s code or link, or tap Scan their QR code and point your camera at theirs, to connect instantly. New members can also enter one during setup.',
        'Invite by email: if they’re not on Hound yet, they’ll get an invite and you’ll be connected when they sign up.',
        'From a leaderboard: tap Add next to anyone in a challenge with you.',
      ],
      tip: 'Rather not be found? You → Settings → Show me in Find people.',
    },
    {
      id: 'requests',
      section: 'friends',
      title: 'Friend requests',
      summary: 'Accepting, declining, and cancelling.',
      steps: [
        'Requests waiting on you are at the top of the Friends tab and on Today — tap Accept or Decline. Tapping a friend-request notification takes you straight there.',
        'Invites you’ve sent are listed under Pending at the bottom; tap Cancel to withdraw one.',
        'If someone already asked you and you add them back, you just become friends.',
      ],
    },
    {
      id: 'friend-activity',
      section: 'friends',
      title: 'Friend activity',
      summary: 'See what your friends have been up to.',
      steps: [
        'The Friend activity card on the Friends tab shows friends’ recent wins and unlocked achievements from the last two weeks.',
        'Tap 👏 on a row to send that friend kudos, or tap the row to open their profile.',
        'Only your friends’ highlights appear — never the names or details of challenges you weren’t in.',
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
      id: 'visits',
      section: 'friends',
      title: 'Visits and gifts',
      summary: 'Drop by a friend’s yard, and send their hound something.',
      steps: [
        'Open a friend to see their yard. Your hound comes along and plays with theirs.',
        `Tap Leave a pawprint, or Toss a treat for ${currency}. They see who visited next time they open their Kennel.`,
        `Tap Send a gift to give their hound something from the shop, with a note. It comes out of your ${currency}.`,
        'Their page also shows their hound’s age, fitness, traits and birthday, and on the day, their yard has a party.',
      ],
    },
    {
      id: 'notifications',
      section: 'settings',
      title: 'Notifications and reminders',
      summary: 'Choose what Hound tells you about.',
      steps: [
        'Open You → Settings → Notifications to turn push and email notifications on or off.',
        'Goal reminders (the Hound) are set under You → Goals: Gentle, Persistent, Relentless or Off.',
        'Open Advanced to pick exactly which alerts you get, and how.',
      ],
    },
    {
      id: 'account',
      section: 'settings',
      title: 'Appearance and username',
      summary: 'Make the app yours.',
      steps: [
        'Appearance: Hound is dark by default — turn on Light mode for a bright background.',
        'Username: save a username, then turn on Use username in challenges to show it instead of your real name on leaderboards and invites.',
      ],
    },
    {
      id: 'orgs',
      section: 'settings',
      title: 'Organizations',
      summary: 'For schools and companies using Hound together.',
      steps: [
        'If you belong to an organization, it appears in You → Settings.',
        `Your organization may use its own words — for example, calling the Chase roles “${labels.hunter}” and “${labels.hunted}”, or renaming ${currency}.`,
        'Organization admins manage their members from the building icon in the top bar.',
      ],
    },
  ];
}
