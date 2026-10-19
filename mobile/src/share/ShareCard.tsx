import React, { type Ref } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import QRCode from 'react-native-qrcode-svg';
import {
  BarbellIcon,
  CheckCircleIcon,
  FireIcon,
  FlagCheckeredIcon,
  FootprintsIcon,
  PathIcon,
  TimerIcon,
  TrophyIcon,
} from 'phosphor-react-native';
import { color as C, font, withAlpha } from '../theme/tokens';
import { HoundArt } from '../kennel/HoundArt';
import { levelProgressForXp } from '../challenges/leveling';
import { rankForLevel } from '../challenges/ranks';
import type { Kennel } from '../kennel/kennelApi';
import { formatAmount, goalTitle, type GoalMetric, type GoalProgress } from '../goals/goals';
import type { GoalStreak } from '../goals/goalStreakApi';
import { stepsChangePct, type WeeklyRecap } from '../home/weeklyRecap';
import { isWin, ordinal, shareMessage, type ResultOutcome } from '../challenges/shareResult';
import { CARD_HEIGHT, CARD_WIDTH } from './shareImage';

// What can be shared as a picture (ShareSheet): last week, today's goals,
// or how a challenge ended.
export type ShareContent =
  | { kind: 'week'; recap: WeeklyRecap }
  | { kind: 'goals'; progress: GoalProgress[]; streak: GoalStreak | null }
  | { kind: 'challenge'; name: string; outcome: ResultOutcome; line: string };

const EYEBROW: Record<ShareContent['kind'], string> = {
  week: 'MY WEEK',
  goals: 'TODAY',
  challenge: 'CHALLENGE',
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
  }
}

// The picture itself, 360×640, always in the app icon's dark look so it
// reads the same wherever it's posted: the Hound logo, your hound, the
// numbers, and how to find you on Hound. Only your own numbers are on it.
export function ShareCard({
  content,
  kennel,
  inviteUrl,
  cardRef,
}: {
  content: ShareContent;
  kennel: Kennel | null;
  inviteUrl: string | null;
  cardRef?: Ref<View>;
}) {
  const celebrate = content.kind === 'challenge' && isWin(content.outcome);
  const link = inviteUrl ?? 'https://houndchallenge.net';
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
        <Text style={styles.brand}>Hound</Text>
        <View style={{ flex: 1 }} />
        <Text style={styles.eyebrow}>{EYEBROW[content.kind]}</Text>
      </View>

      <View style={styles.hero}>
        {kennel ? (
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
      </View>

      {/* A link can't be tapped or copied out of a story or a saved
          picture, so the QR code carries it too: a phone camera opens it
          (the website's /f/ page for a friend code). Dark on white, which
          every scanner reads. */}
      <View style={styles.footer}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.footerTitle}>Challenge me on Hound</Text>
          <Text style={styles.footerHint}>{inviteUrl ? 'Scan to add me' : 'Scan to get Hound'}</Text>
          <Text style={styles.footerUrl} numberOfLines={1}>
            {link.replace(/^https:\/\//, '')}
          </Text>
        </View>
        <View style={styles.qr}>
          <QRCode value={link} size={64} color={C.bg} backgroundColor="#ffffff" quietZone={0} />
        </View>
      </View>
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
  const medal = outcome.type === 'ranked' && outcome.rank <= 3 ? MEDALS[outcome.rank - 1] : null;
  return (
    <View style={{ gap: 10 }}>
      {outcome.type === 'ranked' ? (
        <View style={[styles.row, { alignItems: 'flex-end' }]}>
          {medal && <TrophyIcon size={34} color={medal} weight="fill" />}
          <Text style={[styles.bigNumber, medal ? { color: medal } : null]}>{ordinal(outcome.rank)}</Text>
          <Text style={[styles.bigLabel, { marginBottom: 8 }]}>of {outcome.of}</Text>
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
  brand: { fontFamily: font.headingSemibold, fontSize: 19, color: C.text },
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
});
