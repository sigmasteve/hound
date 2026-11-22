import React, { type Ref } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import QRCode from 'react-native-qrcode-svg';
import {
  AppleLogoIcon,
  BarbellIcon,
  GooglePlayLogoIcon,
  CheckCircleIcon,
  FireIcon,
  FlagCheckeredIcon,
  FootprintsIcon,
  PathIcon,
  TimerIcon,
  TrophyIcon,
} from 'phosphor-react-native';
import { color as C, font, withAlpha } from '../theme/tokens';
import { DarkTheme } from '../theme/ThemeContext';
import { HoundArt } from '../kennel/HoundArt';
import { Avatar } from '../components/Avatar';
import { levelProgressForXp } from '../challenges/leveling';
import { rankForLevel } from '../challenges/ranks';
import type { Kennel } from '../kennel/kennelApi';
import { formatAmount, goalTitle, type GoalMetric, type GoalProgress } from '../goals/goals';
import type { GoalStreak } from '../goals/goalStreakApi';
import { stepsChangePct, type WeeklyRecap } from '../home/weeklyRecap';
import { isWin, ordinal, shareMessage, type ResultOutcome } from '../challenges/shareResult';
import { CARD_HEIGHT, CARD_WIDTH } from './shareImage';
import { achievementIcon } from '../achievements/achievementIcons';
import { codeLink, formatCode } from '../challenges/communityApi';

// What can be shared as a picture (ShareSheet): last week, today's goals,
// how a challenge ended, or a badge (K-06).
export type ShareContent =
  | { kind: 'week'; recap: WeeklyRecap }
  | { kind: 'goals'; progress: GoalProgress[]; streak: GoalStreak | null }
  // visual: the game's own picture (the court, the pitch, the board),
  // when the game has one; the card shows it with your hound beside it.
  // podium: the top three when the viewer finished in it (Golf, the Hound
  // Open, the Home Run Derby); the card stands your hound on your step.
  | { kind: 'challenge'; name: string; outcome: ResultOutcome; line: string; visual?: React.ReactNode; podium?: SharePodiumSpot[] | null }
  // id and name from the achievements catalog; earnedAt an ISO date.
  | { kind: 'badge'; id: string; name: string; description?: string; earnedAt?: string }
  // A community challenge's invite (K-04): its code, link and QR code.
  | { kind: 'invite'; name: string; code: string; line: string; description?: string | null };

// A finished challenge's share (the card's 'challenge' kind).
export type ChallengeShare = Extract<ShareContent, { kind: 'challenge' }>;

// A step on the share card's podium. place is the finish (ties share
// one); score what it was ("12 HR", "−4").
export interface SharePodiumSpot {
  place: number;
  name: string;
  initials: string;
  iconId?: string | null;
  score: string;
  me: boolean;
}

// The three steps to draw, left to right (2nd, 1st, 3rd), from a
// podium list that can hold ties: the first three by place, with the
// viewer kept on it. null when the viewer isn't in the top 3.
export function podiumSteps(spots: SharePodiumSpot[] | null | undefined): (SharePodiumSpot | null)[] | null {
  if (!spots) return null;
  const sorted = [...spots].filter((x) => x.place >= 1 && x.place <= 3).sort((a, b) => a.place - b.place || Number(b.me) - Number(a.me));
  const mine = sorted.find((x) => x.me);
  if (!mine) return null;
  const top = sorted.slice(0, 3);
  if (!top.includes(mine)) top[2] = mine;
  top.sort((a, b) => a.place - b.place);
  return [top[1] ?? null, top[0] ?? null, top[2] ?? null];
}

const EYEBROW: Record<ShareContent['kind'], string> = {
  week: 'MY WEEK',
  goals: 'TODAY',
  challenge: 'CHALLENGE',
  badge: 'BADGE',
  invite: 'JOIN MY CHALLENGE',
};

const GOAL_ICONS: Record<GoalMetric, React.ComponentType<any>> = {
  steps: FootprintsIcon,
  distance_mi: PathIcon,
  workouts: BarbellIcon,
  workout_minutes: TimerIcon,
};

const MEDALS = [C.gold, C.silver, C.bronze];

// "Oct 12 – 18", or "Sep 28 – Oct 4" across a month.
function weekRange(weekKey: string): string {
  const [y, m, d] = weekKey.split('-').map(Number);
  const start = new Date(y, m - 1, d);
  const end = new Date(y, m - 1, d + 6);
  const month = (x: Date) => x.toLocaleDateString('en-US', { month: 'short' });
  return start.getMonth() === end.getMonth()
    ? `${month(start)} ${start.getDate()} – ${end.getDate()}`
    : `${month(start)} ${start.getDate()} – ${month(end)} ${end.getDate()}`;
}

function goalsHeadline(progress: GoalProgress[]): string {
  const done = progress.filter((p) => p.done).length;
  if (done === progress.length) return progress.length === 1 ? 'Goal done.' : `All ${progress.length} goals done.`;
  return `${done} of ${progress.length} goals done`;
}

// The words that go with the picture, and the whole share where a picture
// can't go (web): the same numbers, then the invite link.
export function shareText(content: ShareContent, inviteUrl: string | null): string {
  switch (content.kind) {
    case 'week': {
      const r = content.recap;
      const parts: string[] = [];
      if (r.stepsLastWeek !== null) parts.push(`${r.stepsLastWeek.toLocaleString()} steps`);
      if (r.challengesFinished > 0)
        parts.push(`${r.challengesFinished} ${r.challengesFinished === 1 ? 'challenge' : 'challenges'} finished`);
      parts.push(`+${r.scoreGained.toLocaleString()} Hound Score`);
      return shareMessage(`My week on Hound: ${parts.join(', ')}.`, inviteUrl);
    }
    case 'goals': {
      const streak = content.streak && content.streak.streak > 1 ? ` (${content.streak.streak}-day streak 🔥)` : '';
      return shareMessage(`${goalsHeadline(content.progress)} today on Hound${streak}`, inviteUrl);
    }
    case 'challenge':
      return shareMessage(content.line, inviteUrl);
    case 'invite':
      return `Join my challenge "${content.name}" on Hound: ${codeLink(content.code)} (or enter code ${formatCode(content.code)} under Challenges)`;
    case 'badge':
      return shareMessage(
        `I earned the ${content.name} badge on Hound${content.description ? `: ${content.description.replace(/\.$/, '')}` : ''} 🏅`,
        inviteUrl,
      );
  }
}

// The picture itself, 360×640, always in the app icon's dark look so it
// reads the same wherever it's posted: the Hound logo, your hound, the
// numbers, and how to find you on Hound. Only your own numbers are on it.
// The app's name as the App Store and Google Play list it, so whoever
// sees the card can search for it.
export const STORE_NAME = 'Hound: Fitness with Friends';

// The card's bottom: the QR code and link, or where to download it.
export type ShareFooter = 'qr' | 'stores';

export function ShareCard({
  content,
  kennel,
  inviteUrl,
  cardRef,
  footer = 'qr',
}: {
  content: ShareContent;
  kennel: Kennel | null;
  inviteUrl: string | null;
  cardRef?: Ref<View>;
  footer?: ShareFooter;
}) {
  const celebrate =
    (content.kind === 'challenge' && (isWin(content.outcome) || !!podiumSteps(content.podium))) || content.kind === 'badge';
  // An invite carries its own link: the challenge, not your friend code.
  const link = content.kind === 'invite' ? codeLink(content.code) : (inviteUrl ?? 'https://houndchallenge.net');
  return (
    <View ref={cardRef} collapsable={false} style={styles.card}>
      <Svg style={StyleSheet.absoluteFill} width={CARD_WIDTH} height={CARD_HEIGHT}>
        <Defs>
          <RadialGradient id="glow" cx="50%" cy="32%" rx="75%" ry="45%">
            <Stop offset="0" stopColor={celebrate ? C.gold : C.accent} stopOpacity={celebrate ? 0.32 : 0.42} />
            <Stop offset="1" stopColor={C.bg} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={C.bg} />
        <Rect width="100%" height="100%" fill="url(#glow)" />
      </Svg>

      <View style={styles.header}>
        <Image source={require('../../assets/icon.png')} style={styles.logo} />
        <View style={{ flex: 1 }}>
          <Text style={styles.brand} numberOfLines={1}>
            {STORE_NAME}
          </Text>
          <Text style={styles.eyebrow}>{EYEBROW[content.kind]}</Text>
        </View>
      </View>

      <View style={styles.hero}>
        {content.kind === 'badge' ? (
          <BadgeHero id={content.id} kennel={kennel} />
        ) : content.kind === 'challenge' && podiumSteps(content.podium) ? (
          <PodiumHero steps={podiumSteps(content.podium)!} kennel={kennel} />
        ) : content.kind === 'challenge' && content.visual ? (
          <GameHero visual={content.visual} kennel={kennel} />
        ) : kennel ? (
          <HoundArt
            rank={rankForLevel(levelProgressForXp(kennel.xpTotal).level).id}
            mood="happy"
            neckId={kennel.neckId}
            headId={kennel.headId}
            faceId={kennel.faceId}
            coatId={kennel.coatId}
            ears={kennel.ears}
            tail={kennel.tail}
            markings={kennel.markings}
            breedId={kennel.breedId}
            bodyId={kennel.bodyId}
            feetId={kennel.feetId}
            size={200}
            animate={false}
          />
        ) : (
          <Image source={require('../../assets/icon.png')} style={styles.bigLogo} />
        )}
      </View>

      <View style={styles.body}>
        {content.kind === 'week' && <WeekBody recap={content.recap} />}
        {content.kind === 'goals' && <GoalsBody progress={content.progress} streak={content.streak} />}
        {content.kind === 'challenge' && <ChallengeBody name={content.name} outcome={content.outcome} line={content.line} />}
        {content.kind === 'badge' && <BadgeBody name={content.name} description={content.description} earnedAt={content.earnedAt} />}
        {content.kind === 'invite' && (
          <View style={{ gap: 8 }}>
            <Text style={styles.kicker}>{content.line}</Text>
            <Text style={styles.headline} numberOfLines={2}>
              {content.name}
            </Text>
            {content.description ? (
              <Text style={styles.line} numberOfLines={2}>
                {content.description}
              </Text>
            ) : null}
          </View>
        )}
      </View>

      {/* A link can't be tapped or copied out of a story or a saved
          picture, so the QR code carries it too: a phone camera opens it
          (the website's /f/ page for a friend code). Dark on white, which
          every scanner reads. */}
      {footer === 'stores' ? (
        <View style={styles.footer}>
          <View style={{ flex: 1, gap: 2 }}>
            {content.kind === 'invite' ? (
              <>
                <Text style={styles.footerHint}>CODE {formatCode(content.code)}</Text>
                <Text style={styles.footerTitle}>Get {STORE_NAME}</Text>
              </>
            ) : (
              <>
                <Text style={styles.footerTitle}>Challenge me on Hound</Text>
                <Text style={styles.footerHint}>Free on the App Store and Google Play</Text>
              </>
            )}
          </View>
          <View style={{ gap: 6 }}>
            <View style={styles.store}>
              <View style={styles.storeIcon}>
                <AppleLogoIcon size={17} color="#ffffff" weight="fill" />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.storeSmall} numberOfLines={1} adjustsFontSizeToFit>
                  Download on the
                </Text>
                <Text style={styles.storeBig} numberOfLines={1} adjustsFontSizeToFit>
                  App Store
                </Text>
              </View>
            </View>
            <View style={styles.store}>
              <View style={styles.storeIcon}>
                <GooglePlayLogoIcon size={16} color="#ffffff" weight="fill" />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.storeSmall} numberOfLines={1} adjustsFontSizeToFit>
                  Get it on
                </Text>
                <Text style={styles.storeBig} numberOfLines={1} adjustsFontSizeToFit>
                  Google Play
                </Text>
              </View>
            </View>
          </View>
        </View>
      ) : (
      <View style={styles.footer}>
        {content.kind === 'invite' ? (
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.footerHint}>CODE</Text>
            <Text style={styles.code}>{formatCode(content.code)}</Text>
            <Text style={styles.footerHint}>Scan, or enter it in Hound → Challenges</Text>
          </View>
        ) : (
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.footerTitle}>Challenge me on Hound</Text>
            <Text style={styles.footerHint}>{inviteUrl ? 'Scan to add me' : `Scan to get ${STORE_NAME}`}</Text>
            <Text style={styles.footerUrl} numberOfLines={1}>
              {link.replace(/^https:\/\//, '')}
            </Text>
          </View>
        )}
        <View style={styles.qr}>
          <QRCode value={link} size={64} color={C.bg} backgroundColor="#ffffff" quietZone={0} />
        </View>
      </View>
      )}
    </View>
  );
}

function WeekBody({ recap }: { recap: WeeklyRecap }) {
  const change = stepsChangePct(recap);
  return (
    <View style={{ gap: 14 }}>
      <Text style={styles.kicker}>{weekRange(recap.weekKey)}</Text>
      {recap.stepsLastWeek !== null && (
        <View>
          <Text style={styles.bigNumber}>{recap.stepsLastWeek.toLocaleString()}</Text>
          <View style={styles.row}>
            <Text style={styles.bigLabel}>steps</Text>
            {change !== null && change !== 0 && (
              <Text style={[styles.pill, { color: change > 0 ? C.green : C.amber }]}>
                {change > 0 ? '▲' : '▼'} {Math.abs(change)}% vs the week before
              </Text>
            )}
          </View>
        </View>
      )}
      <View style={styles.statRow}>
        <Stat Icon={FlagCheckeredIcon} value={String(recap.challengesFinished)} label={recap.challengesFinished === 1 ? 'challenge finished' : 'challenges finished'} />
        <Stat Icon={TrophyIcon} value={`+${recap.scoreGained.toLocaleString()}`} label="Hound Score" />
      </View>
    </View>
  );
}

function GoalsBody({ progress, streak }: { progress: GoalProgress[]; streak: GoalStreak | null }) {
  return (
    <View style={{ gap: 12 }}>
      {streak && streak.streak > 1 && (
        <View style={styles.streak}>
          <FireIcon size={15} color={C.amber} weight="fill" />
          <Text style={styles.streakText}>{streak.streak}-day streak</Text>
        </View>
      )}
      <Text style={styles.headline}>{goalsHeadline(progress)}</Text>
      {progress.slice(0, 4).map((p) => {
        const Icon = GOAL_ICONS[p.goal.metric];
        return (
          <View key={p.goal.id} style={{ gap: 6 }}>
            <View style={styles.row}>
              <Icon size={16} color={C.accent300} />
              <Text style={styles.goalName} numberOfLines={1}>
                {goalTitle(p.goal)}
              </Text>
              {p.done ? (
                <CheckCircleIcon size={18} color={C.green} weight="fill" />
              ) : (
                <Text style={styles.goalValue}>
                  {formatAmount(p.goal.metric, p.value)} / {formatAmount(p.goal.metric, p.goal.target)}
                </Text>
              )}
            </View>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.min(100, p.pct)}%`, backgroundColor: p.done ? C.green : C.accent }]} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

function ChallengeBody({ name, outcome, line }: { name: string; outcome: ResultOutcome; line: string }) {
  const win = isWin(outcome);
  // Ranked, or a Golf round among three or more: your place, big.
  const placed =
    outcome.type === 'ranked'
      ? { rank: outcome.rank, of: outcome.of }
      : outcome.type === 'golf' && outcome.place && outcome.of && outcome.of >= 3
        ? { rank: outcome.place, of: outcome.of }
        : null;
  const medal = placed && placed.rank <= 3 ? MEDALS[placed.rank - 1] : null;
  return (
    <View style={{ gap: 10 }}>
      {placed ? (
        <View style={[styles.row, { alignItems: 'flex-end' }]}>
          {medal && <TrophyIcon size={34} color={medal} weight="fill" />}
          <Text style={[styles.bigNumber, medal ? { color: medal } : null]}>{ordinal(placed.rank)}</Text>
          <Text style={[styles.bigLabel, { marginBottom: 8 }]}>of {placed.of.toLocaleString()}</Text>
        </View>
      ) : (
        win && <TrophyIcon size={44} color={C.gold} weight="fill" />
      )}
      <Text style={styles.headline} numberOfLines={2}>
        {name}
      </Text>
      <Text style={styles.line} numberOfLines={3}>
        {line}
      </Text>
    </View>
  );
}

// A game: its own picture (the court, the pitch, the board) in a frame,
// drawn in the dark look, with your hound at its corner.
function GameHero({ visual, kennel }: { visual: React.ReactNode; kennel: Kennel | null }) {
  return (
    <View style={styles.gameWrap}>
      <View style={styles.gameFrame}>
        <DarkTheme>{visual}</DarkTheme>
      </View>
      {kennel && (
        <View style={styles.gameHound} pointerEvents="none">
          <HoundArt
            rank={rankForLevel(levelProgressForXp(kennel.xpTotal).level).id}
            mood="happy"
            neckId={kennel.neckId}
            headId={kennel.headId}
            faceId={kennel.faceId}
            coatId={kennel.coatId}
            ears={kennel.ears}
            tail={kennel.tail}
            markings={kennel.markings}
            breedId={kennel.breedId}
            bodyId={kennel.bodyId}
            feetId={kennel.feetId}
            size={92}
            animate={false}
          />
        </View>
      )}
    </View>
  );
}

// Top 3: the podium, 2nd · 1st · 3rd, with your hound standing on your
// step and the others' names on theirs.
function PodiumHero({ steps, kennel }: { steps: (SharePodiumSpot | null)[]; kennel: Kennel | null }) {
  const HEIGHT = [74, 104, 56];
  return (
    <View style={styles.podiumWrap}>
      {steps.map((x, k) => {
        if (!x) return <View key={k} style={styles.podiumCol} />;
        const medal = MEDALS[Math.min(3, Math.max(1, x.place)) - 1];
        return (
          <View key={k} style={styles.podiumCol}>
            {x.me && kennel ? (
              <HoundArt
                rank={rankForLevel(levelProgressForXp(kennel.xpTotal).level).id}
                mood="happy"
                neckId={kennel.neckId}
                headId={kennel.headId}
                faceId={kennel.faceId}
                coatId={kennel.coatId}
                ears={kennel.ears}
                tail={kennel.tail}
                markings={kennel.markings}
                breedId={kennel.breedId}
                bodyId={kennel.bodyId}
                feetId={kennel.feetId}
                size={x.place === 1 ? 132 : 116}
                animate={false}
              />
            ) : (
              <View style={{ alignItems: 'center', gap: 4, paddingBottom: 6 }}>
                <View style={[styles.podiumRing, { borderColor: x.me ? C.accent300 : withAlpha(medal, 0.7) }]}>
                  <Avatar initials={x.initials} tint="#33384f" size={44} fontSize={15} iconId={x.iconId ?? null} />
                </View>
              </View>
            )}
            <Text style={[styles.podiumName, x.me && { color: C.accent300 }]} numberOfLines={1}>
              {x.me ? 'Me' : x.name.split(' ')[0]}
            </Text>
            <Text style={styles.podiumScore} numberOfLines={1}>
              {x.score}
            </Text>
            <View style={[styles.podiumStep, { height: HEIGHT[k], backgroundColor: withAlpha(medal, x.me ? 0.95 : 0.55) }]}>
              <Text style={[styles.podiumPlace, { color: x.me ? '#161826' : withAlpha('#161826', 0.8) }]}>{x.place}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

// A badge: the medal itself, big, with your hound beside it.
function BadgeHero({ id, kennel }: { id: string; kennel: Kennel | null }) {
  const Icon = achievementIcon(id);
  return (
    <View style={styles.medalWrap}>
      <View style={styles.medalRing}>
        <View style={styles.medal}>
          <Icon size={92} color={C.gold} weight="fill" />
        </View>
      </View>
      {kennel && (
        <View style={styles.medalHound}>
          <HoundArt
            rank={rankForLevel(levelProgressForXp(kennel.xpTotal).level).id}
            mood="happy"
            neckId={kennel.neckId}
            headId={kennel.headId}
            faceId={kennel.faceId}
            coatId={kennel.coatId}
            ears={kennel.ears}
            tail={kennel.tail}
            markings={kennel.markings}
            breedId={kennel.breedId}
            bodyId={kennel.bodyId}
            feetId={kennel.feetId}
            size={96}
            animate={false}
          />
        </View>
      )}
    </View>
  );
}

function BadgeBody({ name, description, earnedAt }: { name: string; description?: string; earnedAt?: string }) {
  const when = earnedAt
    ? new Date(earnedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;
  return (
    <View style={{ gap: 8 }}>
      <Text style={[styles.kicker, { color: C.gold }]}>{when ? `Badge earned · ${when}` : 'Badge earned'}</Text>
      <Text style={styles.headline} numberOfLines={2}>
        {name}
      </Text>
      {description ? (
        <Text style={styles.line} numberOfLines={3}>
          {description}
        </Text>
      ) : null}
    </View>
  );
}

function Stat({ Icon, value, label }: { Icon: React.ComponentType<any>; value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Icon size={16} color={C.accent300} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    paddingHorizontal: 28,
    paddingTop: 28,
    paddingBottom: 24,
    backgroundColor: C.bg,
    overflow: 'hidden',
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: { width: 30, height: 30, borderRadius: 8 },
  bigLogo: { width: 120, height: 120, borderRadius: 28 },
  brand: { fontFamily: font.headingSemibold, fontSize: 16, color: C.text },
  eyebrow: { fontFamily: font.heading, fontSize: 11, letterSpacing: 1.6, color: withAlpha(C.text, 0.6) },
  hero: { flex: 1, minHeight: 150, alignItems: 'center', justifyContent: 'center' },
  body: { paddingBottom: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  kicker: { fontFamily: font.heading, fontSize: 14, color: C.accent300 },
  bigNumber: { fontFamily: font.headingSemibold, fontSize: 52, lineHeight: 58, color: C.text },
  bigLabel: { fontFamily: font.heading, fontSize: 17, color: withAlpha(C.text, 0.7) },
  pill: { fontFamily: font.heading, fontSize: 13 },
  headline: { fontFamily: font.headingSemibold, fontSize: 26, lineHeight: 31, color: C.text },
  line: { fontSize: 15, lineHeight: 21, color: withAlpha(C.text, 0.78) },
  statRow: { flexDirection: 'row', gap: 12 },
  stat: {
    flex: 1,
    gap: 3,
    padding: 14,
    borderRadius: 16,
    backgroundColor: withAlpha(C.text, 0.06),
    borderWidth: 1,
    borderColor: withAlpha(C.text, 0.1),
  },
  statValue: { fontFamily: font.headingSemibold, fontSize: 24, color: C.text },
  statLabel: { fontSize: 12.5, color: withAlpha(C.text, 0.65) },
  streak: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: withAlpha(C.amber, 0.16),
  },
  streakText: { fontFamily: font.heading, fontSize: 12.5, color: C.amber },
  goalName: { flex: 1, fontFamily: font.heading, fontSize: 14.5, color: C.text },
  goalValue: { fontSize: 13, color: withAlpha(C.text, 0.7) },
  track: { height: 6, borderRadius: 3, backgroundColor: withAlpha(C.text, 0.1), overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(C.text, 0.2),
  },
  footerTitle: { fontFamily: font.headingSemibold, fontSize: 15, color: C.text },
  footerHint: { fontSize: 12.5, color: withAlpha(C.text, 0.65) },
  footerUrl: { fontSize: 13, color: C.accent300 },
  qr: { padding: 5, borderRadius: 8, backgroundColor: '#ffffff' },
  store: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    width: 144,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: withAlpha('#ffffff', 0.35),
  },
  storeIcon: { flexShrink: 0 },
  storeSmall: { fontSize: 8, lineHeight: 10, color: '#ffffff' },
  storeBig: { fontFamily: font.headingSemibold, fontSize: 13, lineHeight: 15, color: '#ffffff' },
  code: { fontFamily: font.headingSemibold, fontSize: 26, letterSpacing: 3, color: C.text },
  medalWrap: { width: 260, height: 220, alignItems: 'center', justifyContent: 'center' },
  podiumWrap: { width: 312, flexDirection: 'row', alignItems: 'flex-end', gap: 6, paddingTop: 4 },
  podiumCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  podiumRing: { borderWidth: 2.5, borderRadius: 999, padding: 2 },
  podiumName: { fontFamily: font.headingSemibold, fontSize: 14, color: C.text, marginTop: 2 },
  podiumScore: { fontSize: 12.5, color: withAlpha(C.text, 0.7), marginBottom: 6 },
  podiumStep: { alignSelf: 'stretch', borderTopLeftRadius: 10, borderTopRightRadius: 10, alignItems: 'center', paddingTop: 6 },
  podiumPlace: { fontFamily: font.headingSemibold, fontSize: 30 },
  gameWrap: { width: 312, paddingBottom: 26, alignItems: 'center' },
  gameFrame: {
    width: 312,
    maxHeight: 250,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#1d1f2e',
    borderWidth: 1,
    borderColor: withAlpha('#ffffff', 0.12),
    padding: 8,
    gap: 6,
  },
  gameHound: { position: 'absolute', right: -6, bottom: -14 },
  medalRing: {
    width: 188,
    height: 188,
    borderRadius: 94,
    padding: 8,
    borderWidth: 3,
    borderColor: withAlpha(C.gold, 0.85),
    backgroundColor: withAlpha(C.gold, 0.08),
  },
  medal: {
    flex: 1,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(C.gold, 0.16),
    borderWidth: 1,
    borderColor: withAlpha(C.gold, 0.45),
  },
  medalHound: { position: 'absolute', right: -6, bottom: -18 },
});
