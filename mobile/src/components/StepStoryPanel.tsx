import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, Share, StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ArrowCounterClockwiseIcon, FlagIcon, ShareNetworkIcon, StarIcon, SwordIcon } from 'phosphor-react-native';
import { Text } from './Text';
import { Card } from './Card';
import { StepRace, type RaceRunner } from './StepRace';
import { LANDMARKS, PoolTrail } from './PoolTrail';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { buildBoard, type BoardEntry } from '../challenges/board';
import { addDaysToKey, challengeDayNumber, localDayKey } from '../challenges/challengeDays';
import { houndFromCode } from '../tag/tagChaseApi';
import type { Challenge, ChallengeBot } from '../challenges/types';
import {
  BOUNTY_TEXT,
  bountyFor,
  bountyTarget,
  bountyWinners,
  checkpoints,
  courseFor,
  rivalOn,
  stepsOn,
  tallies,
  yesterdayStory,
  type Totals,
} from '../challenges/stepStory';
import { getDailySteps, logStepStory, type DailyRow, type StepOptions } from '../challenges/stepStoryApi';

// A Most steps challenge, more than a leaderboard (0233; mockup
// claude.ai/artifact/17YoJpFbHGVeWq335R1hj1). Above the Leaderboard:
//   - how yesterday went: the hounds run from where they stood when it
//     began to where it ended, overtakes and all (plays once a day, then
//     waits behind Replay yesterday), with what changed in one line;
//   - the race: today so far, on the course, checkpoints flagged;
//   - your rival today, and today's bounty;
//   - when it's over, the finish: the last day plays out and the hounds
//     cross the line, then the podium and Share.
// During a Blackout (the last 24 hours, if the creator chose it) the
// race shows only your own hound, and the rival card waits.

const ORD = ['1st', '2nd', '3rd'];
const LANDMARK_SHARES = LANDMARKS.map((m) => m.at);
const first = (name: string) => name.split(' ')[0];

// Is the Blackout on now: chosen, the challenge's last day, not over.
export function blackoutActive(challenge: Challenge, options: StepOptions | null, finished: boolean): boolean {
  if (!options?.blackout || finished || challenge.kind !== 'steps') return false;
  return challengeDayNumber(challenge) >= challenge.durationDays;
}

export function StepStoryPanel({
  challenge,
  board,
  bots,
  userId,
  hounds,
  options,
  finished,
}: {
  challenge: Challenge;
  board: BoardEntry[];
  bots: ChallengeBot[];
  userId: string | undefined;
  hounds: Map<string, string | null>;
  options: StepOptions;
  finished: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [width, setWidth] = useState(0);
  const [rows, setRows] = useState<DailyRow[] | null>(null);
  const [showYesterday, setShowYesterday] = useState(false);
  const boardKey = board.map((r) => `${r.userId}:${r.totalSteps}`).join(',');

  useEffect(() => {
    let off = false;
    getDailySteps(challenge.id)
      .then((r) => !off && setRows(r))
      .catch(() => !off && setRows([]));
    return () => {
      off = true;
    };
  }, [challenge.id, boardKey]);

  const D = challenge.durationDays;
  const todayIdx = finished ? D - 1 : Math.max(0, Math.min(D - 1, challengeDayNumber(challenge) - 1));
  const firstDay = challenge.startDay ?? localDayKey(new Date(challenge.startsAt));
  const me = userId ?? '';
  const ids = board.map((r) => r.userId);
  const nameOf = (id: string) => (id === me ? 'You' : first(board.find((r) => r.userId === id)?.name ?? 'Someone'));

  // Everyone's total at the end of each day so far; today is the board.
  const totalsAt: Totals[] = useMemo(() => {
    const out: Totals[] = [];
    const bySum = new Map<string, number>();
    const sorted = [...(rows ?? [])].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
    let i = 0;
    for (let k = 0; k < todayIdx; k++) {
      const key = addDaysToKey(firstDay, k);
      while (i < sorted.length && sorted[i].day <= key) {
        bySum.set(sorted[i].userId, (bySum.get(sorted[i].userId) ?? 0) + sorted[i].steps);
        i++;
      }
      const t: Totals = new Map(bySum);
      for (const b of buildBoard([], [], bots, k + 1)) if (b.isBot) t.set(b.userId, b.totalSteps);
      out.push(t);
    }
    out.push(new Map(board.map((r) => [r.userId, r.totalSteps])));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, boardKey, todayIdx, firstDay, bots]);

  const course = courseFor(D);
  const cps = useMemo(() => checkpoints(totalsAt, ids, course), [totalsAt, ids.join(','), course]); // eslint-disable-line react-hooks/exhaustive-deps
  const opts = { rivals: options.rivals, bounties: options.bounties };
  const tal = useMemo(() => tallies(totalsAt, ids, todayIdx, opts, cps), [totalsAt, cps, todayIdx, options.rivals, options.bounties]); // eslint-disable-line react-hooks/exhaustive-deps
  const story = rows ? yesterdayStory(totalsAt, ids, todayIdx, me, opts, cps) : null;
  const dark = blackoutActive(challenge, options, finished);

  // Yesterday plays by itself the first time you open the challenge each
  // day; after that it's behind Replay yesterday.
  const seenKey = `stepYesterday:${challenge.id}`;
  useEffect(() => {
    if (!story || finished) return;
    const today = localDayKey(new Date());
    AsyncStorage.getItem(seenKey)
      .then((v) => {
        if (v !== today) {
          setShowYesterday(true);
          AsyncStorage.setItem(seenKey, today).catch(() => {});
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!story, finished, seenKey]);

  // The engagement log (Admin): what you saw, once a day each.
  useEffect(() => {
    if (!rows) return;
    logStepStory(challenge.id, finished ? 'finish' : 'race');
    if (story?.rival?.won) logStepStory(challenge.id, 'rival_beaten');
    if (story?.bounty?.winners.includes(me)) logStepStory(challenge.id, 'bounty_star');
    if (story?.checkpoints.some((c) => c.firstId === me)) logStepStory(challenge.id, 'checkpoint');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!rows, finished]);
  useEffect(() => {
    if (showYesterday) logStepStory(challenge.id, 'replay');
  }, [showYesterday, challenge.id]);

  const runnersBetween = (a: Totals, b: Totals): RaceRunner[] =>
    board.slice(0, 10).map((r) => ({
      id: r.userId,
      name: nameOf(r.userId),
      hound: houndFromCode(hounds.get(r.userId) ?? null),
      from: Math.min(a.get(r.userId) ?? 0, b.get(r.userId) ?? 0),
      to: b.get(r.userId) ?? 0,
      me: r.userId === me,
      ribbons: tal.get(r.userId)?.ribbons ?? 0,
      stars: tal.get(r.userId)?.stars ?? 0,
    }));

  const startOfToday = todayIdx > 0 ? totalsAt[todayIdx - 1] : new Map<string, number>();
  const now = totalsAt[totalsAt.length - 1];
  const raceW = width;

  // ── The finish ──
  if (finished) {
    const lastStart = D >= 2 ? totalsAt[Math.max(0, totalsAt.length - 2)] : new Map<string, number>();
    const final = board;
    const myPlace = final.findIndex((r) => r.userId === me);
    return (
      <Card style={{ gap: 12 }} elevated={false}>
        <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
          <Text style={styles.kicker}>THE FINISH</Text>
          <Text style={styles.title}>{final[0] ? `${final[0].userId === me ? 'You' : first(final[0].name)} won it` : 'It’s over'}</Text>
        </View>
        {raceW > 0 && rows && (
          <StepRace
            runners={runnersBetween(lastStart, now)}
            course={Math.max(course, ...final.map((r) => r.totalSteps))}
            checkpoints={cps}
            width={raceW}
            durationMs={5200}
            finishLabel="THE FINISH"
            clock={(t) => (t < 1 ? (options.blackout ? 'The reveal: the last 24 hours' : 'The last day') : 'Final standings')}
          />
        )}
        <View style={styles.podium}>
          {[1, 0, 2].map((p) => {
            const r = final[p];
            if (!r) return <View key={p} style={{ flex: 1 }} />;
            const medal = ['#f0c24a', '#c9cdd6', '#d08a52'][p];
            return (
              <View key={p} style={styles.podiumCol}>
                <View style={[styles.medal, { backgroundColor: medal }]}>
                  <Text style={styles.medalText}>{p + 1}</Text>
                </View>
                <Text style={styles.podiumName} numberOfLines={1}>
                  {r.userId === me ? 'You' : first(r.name)}
                </Text>
                <Text style={styles.small}>{r.totalSteps.toLocaleString()}</Text>
                <View style={[styles.block, { height: [88, 112, 66][[1, 0, 2].indexOf(p)] }, r.userId === me && { backgroundColor: withAlpha('#4f7be0', 0.5) }]} />
              </View>
            );
          })}
        </View>
        {myPlace >= 0 && (
          <Pressable
            onPress={() =>
              Share.share({
                message: `I finished ${myPlace < 3 ? ORD[myPlace] : `#${myPlace + 1}`} in “${challenge.name}” on Hound, with ${final[myPlace].totalSteps.toLocaleString()} steps.`,
              }).catch(() => {})
            }
            style={styles.share}
            accessibilityRole="button"
          >
            <ShareNetworkIcon size={16} color="#1b1d29" weight="bold" />
            <Text style={styles.shareText}>{myPlace < 3 ? 'Share my medal' : 'Share my finish'}</Text>
          </Pressable>
        )}
      </Card>
    );
  }

  // ── Live ──
  const rival = options.rivals && !dark ? rivalOn(totalsAt, ids, todayIdx, me) : null;
  const myToday = stepsOn(totalsAt, todayIdx, me);
  const rivalToday = rival ? stepsOn(totalsAt, todayIdx, rival.id) : 0;
  const bKind = bountyFor(todayIdx);
  const bt = options.bounties ? bountyTarget(totalsAt, ids, todayIdx, me) : null;
  const onBounty = options.bounties ? bountyWinners(totalsAt, ids, todayIdx) : [];
  const storyLine = story
    ? [
        story.passes.length
          ? story.passes
              .slice(0, 2)
              .map((p) => `${nameOf(p.by)} passed ${p.past === me ? 'you' : nameOf(p.past)}`)
              .join('; ') + '.'
          : 'Nobody changed places.',
        story.rival ? (story.rival.won ? `You beat ${nameOf(story.rival.rival.id)} for a rival badge.` : `${nameOf(story.rival.rival.id)} held you off.`) : '',
      ]
        .filter(Boolean)
        .join(' ')
    : '';

  return (
    <View style={{ gap: 12 }}>
      {story && (
        <Card style={{ gap: 10 }} elevated={false}>
          <Pressable onPress={() => setShowYesterday((s) => !s)} style={styles.rowBetween} accessibilityRole="button" accessibilityState={{ expanded: showYesterday }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.kicker}>DAY {story.day + 1}</Text>
              <Text style={styles.title}>How yesterday went</Text>
            </View>
            {!showYesterday && (
              <View style={styles.replayBtn}>
                <ArrowCounterClockwiseIcon size={14} color={colors.accentActive} weight="bold" />
                <Text style={styles.link}>Replay yesterday</Text>
              </View>
            )}
          </Pressable>
          {showYesterday && raceW > 0 && (
            <StepRace
              runners={runnersBetween(totalsAt[story.day - 1], totalsAt[story.day])}
              course={course}
              checkpoints={cps}
              width={raceW}
              blackout={null}
              clock={(t) => {
                if (t <= 0) return 'Yesterday, the start';
                if (t >= 1) return 'Yesterday, the end';
                const h = Math.floor(6 + t * 17);
                return `Yesterday, ${h % 12 || 12} ${h >= 12 ? 'pm' : 'am'}`;
              }}
            />
          )}
          <Text style={styles.line}>{storyLine}</Text>
          <View style={styles.chips}>
            {story.big && <Text style={[styles.chip, styles.chipGold]}>Big day: {nameOf(story.big.id)}, {story.big.steps.toLocaleString()}</Text>}
            {story.bounty && story.bounty.winners.length > 0 && (
              <Text style={styles.chip}>
                Bounty: {story.bounty.winners.includes(me) ? 'you got a star' : `${story.bounty.winners.length} ${story.bounty.winners.length === 1 ? 'star' : 'stars'}`}
              </Text>
            )}
            {story.checkpoints.map((c) => (
              <Text key={c.label} style={[styles.chip, styles.chipGold]}>
                {c.label} flag: {c.firstId ? nameOf(c.firstId) : ''} first
              </Text>
            ))}
          </View>
        </Card>
      )}

      <Card style={{ gap: 10 }} elevated={false}>
        <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
          <Text style={styles.kicker}>DAY {todayIdx + 1} OF {D}{dark ? ' · BLACKOUT' : ''}</Text>
          <Text style={styles.title}>The race</Text>
        </View>
        {raceW > 0 && rows && (
          <StepRace
            runners={runnersBetween(startOfToday, now)}
            course={course}
            checkpoints={cps}
            width={raceW}
            durationMs={2600}
            blackout={dark ? { title: 'BLACKOUT', line: 'The standings are hidden for the last day. Every step counts until the finish.' } : null}
            finishLabel={`DAY ${D} FINISH`}
            clock={(t) => (t < 1 ? 'Today so far' : `${(now.get(me) ?? 0).toLocaleString()} steps · ${course.toLocaleString()} to the finish`)}
          />
        )}
        <View style={styles.chips}>
          {cps.map((c) => (
            <View key={c.label} style={[styles.cp, c.firstId && styles.cpOn]}>
              <FlagIcon size={12} color={c.firstId ? '#161826' : withAlpha(colors.text, 0.6)} weight="fill" />
              <Text style={[styles.cpText, c.firstId && { color: '#161826' }]}>
                {c.label} {c.firstId && !dark ? `${nameOf(c.firstId)}, day ${(c.day ?? 0) + 1}` : `${Math.round(c.at / 1000)}k`}
              </Text>
            </View>
          ))}
        </View>
      </Card>

      {(rival || bt) && (
        <View style={styles.pair}>
          {rival && (
            <View style={styles.mini}>
              <View style={styles.miniHead}>
                <SwordIcon size={13} color="#a6e3b8" weight="bold" />
                <Text style={[styles.miniKicker, { color: '#a6e3b8' }]}>YOUR RIVAL TODAY</Text>
              </View>
              <Text style={styles.miniTitle}>{rival.mode === 'catch' ? `Catch ${nameOf(rival.id)}` : `Hold off ${nameOf(rival.id)}`}</Text>
              <Text style={styles.miniLine}>
                {rival.mode === 'catch' ? `${rival.gap.toLocaleString()} ahead when today began.` : `${rival.gap.toLocaleString()} behind you when today began.`} Out-walk them
                today for a rival badge.
              </Text>
              <View style={styles.bar}>
                <View style={[styles.barFill, { width: `${Math.min(100, (myToday / Math.max(1, rivalToday, myToday)) * 100)}%`, backgroundColor: myToday > rivalToday ? '#7fd39b' : '#f0a35a' }]} />
              </View>
              <Text style={styles.miniFoot}>
                You {myToday.toLocaleString()} · {nameOf(rival.id)} {rivalToday.toLocaleString()} today
                {(tal.get(me)?.rivalWins ?? 0) > 0 ? ` · ${tal.get(me)!.rivalWins} won` : ''}
              </Text>
            </View>
          )}
          {bt && (
            <View style={styles.mini}>
              <View style={styles.miniHead}>
                <StarIcon size={13} color="#f0c24a" weight="fill" />
                <Text style={[styles.miniKicker, { color: '#f0c24a' }]}>TODAY’S BOUNTY</Text>
              </View>
              <Text style={styles.miniTitle}>{BOUNTY_TEXT[bKind].title}</Text>
              <Text style={styles.miniLine}>{BOUNTY_TEXT[bKind].line}</Text>
              <Text style={styles.miniFoot}>
                {onBounty.includes(me)
                  ? 'You’re on for it.'
                  : bt.target != null
                    ? `${Math.max(0, bt.target - myToday).toLocaleString()} to go${bKind === 'biggest' && bt.leaderId ? ` to pass ${nameOf(bt.leaderId)}` : ''}.`
                    : 'Walk to set the mark.'}
                {(tal.get(me)?.stars ?? 0) > 0 ? ` · ★ ${tal.get(me)!.stars}` : ''}
              </Text>
            </View>
          )}
        </View>
      )}
      {dark && <Text style={styles.note}>Blackout: the last 24 hours. You see your own steps; everyone else’s show again at the finish.</Text>}
    </View>
  );
}

// A Distance pool's trail (PoolTrail), with the day each landmark was
// reached worked out from the group's daily totals.
export function PoolTrailCard({ challenge, board, userId, hounds, goal, unit }: { challenge: Challenge; board: BoardEntry[]; userId: string | undefined; hounds: Map<string, string | null>; goal: number; unit: 'mi' | 'steps' }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [width, setWidth] = useState(0);
  const [rows, setRows] = useState<DailyRow[]>([]);
  const boardKey = board.map((r) => `${r.userId}:${r.totalSteps}:${r.totalDistanceMi}`).join(',');
  useEffect(() => {
    let off = false;
    getDailySteps(challenge.id)
      .then((r) => !off && setRows(r))
      .catch(() => {});
    logStepStory(challenge.id, 'trail');
    return () => {
      off = true;
    };
  }, [challenge.id, boardKey]);
  const amount = (r: BoardEntry) => (unit === 'mi' ? r.totalDistanceMi : r.totalSteps);
  const total = board.reduce((a, r) => a + amount(r), 0);
  // The challenge day (1-based) the group's running total passed each landmark.
  const firstDay = challenge.startDay ?? localDayKey(new Date(challenge.startsAt));
  const byDay = new Map<string, number>();
  for (const r of rows) byDay.set(r.day, (byDay.get(r.day) ?? 0) + (unit === 'mi' ? r.distanceMi : r.steps));
  const reachedDay = LANDMARK_SHARES.map((share) => {
    let run = 0;
    for (let k = 0; k < challenge.durationDays; k++) {
      run += byDay.get(addDaysToKey(firstDay, k)) ?? 0;
      if (run >= share * goal) return k + 1;
    }
    return null;
  });
  return (
    <Card style={{ gap: 10 }} elevated={false}>
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        <Text style={styles.kicker}>THE TRAIL · {Math.round(goal > 0 ? Math.min(100, (total / goal) * 100) : 0)}% OF THE WAY</Text>
        <Text style={styles.title}>Up the mountain, together</Text>
      </View>
      {width > 0 && (
        <PoolTrail
          walkers={board.map((r) => ({ id: r.userId, name: first(r.name), hound: houndFromCode(hounds.get(r.userId) ?? null), amount: amount(r), me: r.userId === userId }))}
          goal={goal}
          total={total}
          unit={unit}
          reachedDay={reachedDay}
          width={width}
        />
      )}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    kicker: { fontFamily: font.headingSemibold, fontSize: 11, letterSpacing: 0.7, color: withAlpha(colors.text, 0.6) },
    title: { fontFamily: font.headingSemibold, fontSize: 18, color: colors.text },
    line: { fontSize: 14, lineHeight: 20, color: colors.text, fontFamily: font.headingSemibold },
    small: { fontSize: 11.5, color: withAlpha(colors.text, 0.65) },
    note: { fontSize: 12.5, lineHeight: 18, color: withAlpha(colors.text, 0.7) },
    rowBetween: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
    replayBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    link: { fontFamily: font.headingSemibold, fontSize: 13, color: colors.accentActive },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: {
      fontSize: 11.5,
      fontFamily: font.headingSemibold,
      color: withAlpha(colors.text, 0.8),
      backgroundColor: withAlpha(colors.text, 0.08),
      borderRadius: 999,
      paddingHorizontal: 9,
      paddingVertical: 4,
      overflow: 'hidden',
    },
    chipGold: { color: '#161826', backgroundColor: '#f5d27a' },
    cp: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, backgroundColor: withAlpha(colors.text, 0.08) },
    cpOn: { backgroundColor: '#f5d27a' },
    cpText: { fontSize: 11.5, fontFamily: font.headingSemibold, color: withAlpha(colors.text, 0.75) },
    pair: { flexDirection: 'row', gap: 8 },
    mini: { flex: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, gap: 4, backgroundColor: colors.surface },
    miniHead: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    miniKicker: { fontFamily: font.headingSemibold, fontSize: 10.5, letterSpacing: 0.6 },
    miniTitle: { fontFamily: font.headingSemibold, fontSize: 15, color: colors.text },
    miniLine: { fontSize: 12, lineHeight: 17, color: withAlpha(colors.text, 0.75) },
    miniFoot: { fontSize: 11, color: withAlpha(colors.text, 0.6), marginTop: 'auto' },
    bar: { height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: withAlpha(colors.text, 0.12) },
    barFill: { height: 6, borderRadius: 3 },
    podium: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 8 },
    podiumCol: { flex: 1, alignItems: 'center', gap: 2 },
    medal: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
    medalText: { fontFamily: font.headingSemibold, fontSize: 14, color: '#161826' },
    podiumName: { fontFamily: font.headingSemibold, fontSize: 13.5, color: colors.text },
    block: { alignSelf: 'stretch', marginTop: 4, borderTopLeftRadius: 10, borderTopRightRadius: 10, backgroundColor: withAlpha(colors.text, 0.12) },
    share: { minHeight: 48, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#f08a24' },
    shareText: { fontFamily: font.headingSemibold, fontSize: 15, color: '#1b1d29' },
  });
}
