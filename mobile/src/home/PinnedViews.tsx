import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, G, Path, Rect, Text as SvgText } from 'react-native-svg';
import { TrophyIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import type { Challenge } from '../challenges/types';
import type { BoardEntry } from '../challenges/board';
import { challengeDayNumber, localDayKey } from '../challenges/challengeDays';
import { ChaseTrack, type TrackRunner } from '../components/ChaseTrack';
import { RaceCourse, raceSceneFor } from '../components/RaceCourse';
import { getChallengeHounds } from '../hunt/huntApi';
import { getTagChase, houndFromCode, type TagChase } from '../tag/tagChaseApi';
import type { StreakStatus } from '../challenges/streak';
import { listSeventyFiveCheckins } from '../challenges/seventyFiveApi';
import type { SeventyFiveCheckin } from '../challenges/seventyFive';
import { listChecklistCheckins, listChecklistItems } from '../challenges/checklistApi';
import { doneItemIds, itemsForUser, type ChecklistCheckin, type ChecklistItem } from '../challenges/checklist';
import { courseById, formatMiles, nextStop } from '../journeys/courses';
import { JourneyMap } from '../journeys/JourneyMap';
import { getDoors, todaysDoor, type DoorsGame } from '../challenges/doorsApi';
import { taskTitle } from '../challenges/doors';
import { DoorsCalendar } from '../components/DoorsCard';
import { getPackWars, heldBy, packDayNo, type PackWarsGame } from '../challenges/packWarsApi';
import { PACKS, packOf } from '../challenges/packWars';
import { HoodMap } from '../components/PackWarsCard';
import { isSupabaseConfigured } from '../lib/supabase';
import { getRoulette, rouletteWaiting, type RouletteGame } from '../challenges/rouletteApi';
import { getSlots, slotsWaiting, type SlotsGame } from '../challenges/slotsApi';
import { getLongShot, longshotWaiting, yd, type LongShotGame } from '../challenges/longshotApi';
import { LongShotRangeArt } from '../components/LongShotRange';
import { getBullseye, bullseyeWaiting, type BullseyeGame } from '../challenges/bullseyeApi';
import { BullseyeFieldArt } from '../components/BullseyeField';
import { teamName } from '../challenges/slots';
import { SlotSymbolArt } from '../components/SlotSymbol';
import { SEGMENTS, stakeName, taskTitle as rouletteTaskTitle } from '../challenges/roulette';
import { chessHeadline, getChess, type ChessGame } from '../challenges/chessApi';
import { parseFen } from '../challenges/chess';

// A pinned challenge on Today's "Your challenges" sheet, for the games
// that used to fall back to a plain list (Steve, Nov 2026: "each
// challenge should have a view when pinned"). Each one is the game's own
// picture first, then where you stand, then one button. They load what
// they need themselves, once per challenge.

export interface PinnedProps {
  challenge: Challenge;
  board: BoardEntry[];
  userId: string | null;
  onOpen: () => void;
}

const SPREAD = ['#8b6bd6', '#f0892a', '#4f7be0', '#3f9a6b', '#c2410c', '#d14d8b', '#2a9db0', '#9a9ca6'];

function first(name: string): string {
  return name.split(' ')[0] || name;
}

function daysLeftOf(c: Challenge): number {
  return Math.max(0, Math.ceil((new Date(c.endsAt).getTime() - Date.now()) / 86_400_000));
}

// The card around each view: the name and a short meta line, the view,
// then the button.
function Frame({
  challenge,
  meta,
  button,
  onOpen,
  primaryButton,
  children,
}: {
  challenge: Challenge;
  meta?: string | null;
  button: string;
  onOpen: () => void;
  primaryButton?: boolean;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Card style={styles.card} elevated={false}>
      <View style={styles.header}>
        <TrophyIcon size={15} color={colors.accent} />
        <Text style={styles.title} numberOfLines={1}>
          {challenge.name}
        </Text>
        {meta ? <Text style={styles.meta}>{meta}</Text> : null}
      </View>
      {children}
      <Button label={button} variant={primaryButton ? 'primary' : 'ghost'} small={!primaryButton} block={primaryButton} onPress={onOpen} />
    </Card>
  );
}

function useLoad<T>(key: string, load: () => Promise<T>): T | null | undefined {
  // undefined while loading, null when it couldn't load.
  const [value, setValue] = useState<T | null | undefined>(undefined);
  useEffect(() => {
    if (!isSupabaseConfigured) {
      setValue(null);
      return;
    }
    let live = true;
    setValue(undefined);
    load()
      .then((v) => live && setValue(v))
      .catch(() => live && setValue(null));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return value;
}

function useTrackWidth(): number {
  const { width } = useWindowDimensions();
  // The sheet's padding and the card's.
  return Math.min(width, 520) - 66;
}

// ── Step Race: everyone on the park track, by their steps. ──

export function StepRacePinned({ challenge, board, userId, onOpen }: PinnedProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const width = useTrackWidth();
  const hounds = useLoad(`hounds:${challenge.id}`, () => getChallengeHounds(challenge.id));
  const runners: TrackRunner[] = board.slice(0, 8).map((r) => ({
    id: r.userId,
    name: r.userId === userId ? 'You' : first(r.name),
    hound: houndFromCode(hounds?.get(r.userId) ?? null),
    startSteps: 0,
    daySteps: r.totalSteps,
    me: r.userId === userId,
  }));
  const myIdx = board.findIndex((r) => r.userId === userId);
  const me = myIdx >= 0 ? board[myIdx] : null;
  const leader = board[0];
  const line = !me
    ? null
    : myIdx === 0
      ? board[1]
        ? `You lead ${first(board[1].name)} by ${(me.totalSteps - board[1].totalSteps).toLocaleString()} steps.`
        : 'You’re out in front.'
      : `You’re ${ordinal(myIdx + 1)}, ${(leader.totalSteps - me.totalSteps).toLocaleString()} steps behind ${first(leader.name)}.`;
  const left = daysLeftOf(challenge);
  return (
    <Frame challenge={challenge} meta={`${board.length} people · ${left} ${left === 1 ? 'day' : 'days'} left`} button="Open the race" onOpen={onOpen}>
      {runners.length > 0 && <ChaseTrack runners={runners} width={width} tagging={false} />}
      {board.slice(0, 3).map((r, i) => (
        <Row key={r.userId} rank={i + 1} name={r.userId === userId ? 'You' : r.name} value={r.totalSteps.toLocaleString()} me={r.userId === userId} styles={styles} />
      ))}
      {me && myIdx > 2 && <Row rank={myIdx + 1} name="You" value={me.totalSteps.toLocaleString()} me styles={styles} />}
      {line && <Text style={styles.note}>{line}</Text>}
    </Frame>
  );
}

// ── Game of Tag: today's chase on the track, IT from the start line. ──

export function TagPinned({ challenge, userId, onOpen }: PinnedProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const width = useTrackWidth();
  const game = useLoad<TagChase>(`tag:${challenge.id}`, () => getTagChase(challenge.id, localDayKey(new Date())));
  const scene = raceSceneFor(challenge);
  if (game === undefined || game === null) {
    return (
      <Frame challenge={challenge} button="Open the game" onOpen={onOpen}>
        <Text style={styles.note}>{game === undefined ? 'Loading the chase…' : 'Open the game to see the chase.'}</Text>
      </Frame>
    );
  }
  const name = (id: string) => (id === userId ? 'you' : first(game.players.find((p) => p.id === id)?.name ?? 'Someone'));
  const it = game.it ? game.players.find((p) => p.id === game.it) : undefined;
  const over = game.history.length >= game.days;
  const meta = `${game.players.length} hounds · ${game.headStart.toLocaleString()}-step head start`;
  if (!it || over) {
    const last = game.history[game.history.length - 1];
    return (
      <Frame challenge={challenge} meta={meta} button="Open the game" onOpen={onOpen}>
        <Text style={styles.note}>
          {over
            ? 'The chase is over. See who won.'
            : `A random hound is IT on day 1, and everyone else gets a ${game.headStart.toLocaleString()}-step head start.`}
          {last ? ` Last: ${name(last.it)} was IT.` : ''}
        </Text>
      </Frame>
    );
  }
  const itSteps = game.today[it.id] ?? 0;
  const runners: TrackRunner[] = [it, ...game.players.filter((p) => p.id !== it.id)].map((p) => ({
    id: p.id,
    name: p.id === userId ? 'You' : first(p.name),
    hound: p.hound,
    startSteps: p.id === it.id ? 0 : game.headStart,
    daySteps: game.today[p.id] ?? 0,
    it: p.id === it.id,
    me: p.id === userId,
  }));
  const caught = game.players.filter((p) => p.id !== it.id && (game.today[p.id] ?? 0) + game.headStart < itSteps);
  const meIt = it.id === userId;
  const myLead = userId && !meIt ? (game.today[userId] ?? 0) + game.headStart - itSteps : null;
  return (
    <Frame challenge={challenge} meta={meta} button="Open the game" onOpen={onOpen}>
      <RaceCourse scene={scene} runners={runners} width={width} catchWord="TAG!" />
      <Text style={styles.note}>
        {meIt
          ? caught.length
            ? `You're IT. If the day ended now, you'd tag ${caught.map((p) => first(p.name)).join(', ')}.`
            : `You're IT. Nobody's in reach yet: out-walk their head start.`
          : caught.length
            ? `If the day ended now, ${name(it.id)} would tag ${caught.map((p) => name(p.id)).join(', ')}.`
            : `If the day ended now, everyone would get away from ${name(it.id)}.`}
        {myLead != null && myLead > 0 ? ` You're clear by ${myLead.toLocaleString()} steps.` : ''}
      </Text>
      <Text style={styles.small}>Settles at 6am.</Text>
    </Frame>
  );
}

// ── Group Distance Target: the group's ring, and who's carried it. ──

export function DistancePinned({ challenge, board, userId, onOpen }: PinnedProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const steps = challenge.distanceGoalUnit === 'steps';
  const goal = (steps ? challenge.distanceGoalSteps : challenge.distanceGoalMi) ?? 0;
  const of = (r: BoardEntry) => (steps ? r.totalSteps : r.totalDistanceMi);
  const total = board.reduce((s, r) => s + of(r), 0);
  const share = goal > 0 ? Math.min(1, total / goal) : 0;
  const fmt = (v: number) => (steps ? Math.round(v).toLocaleString() : formatMiles(v));
  const unit = steps ? 'steps' : 'mi';
  const day = challengeDayNumber(challenge);
  const left = Math.max(0, challenge.durationDays - day + 1);
  const need = goal > total && left > 0 ? (goal - total) / left : 0;
  const pace = day > 0 ? total / day : 0;
  const R = 50;
  const C = 2 * Math.PI * R;
  const sorted = [...board].sort((a, b) => of(b) - of(a));
  return (
    <Frame challenge={challenge} meta={`${board.length} people · ${daysLeftOf(challenge)} days left`} button="Open the challenge" onOpen={onOpen}>
      <View style={styles.rowCenter}>
        <Svg width={124} height={124} viewBox="0 0 124 124">
          <Circle cx={62} cy={62} r={R} stroke={withAlpha(colors.text, 0.1)} strokeWidth={13} fill="none" />
          <Circle
            cx={62}
            cy={62}
            r={R}
            stroke={colors.green}
            strokeWidth={13}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${C * share} ${C}`}
            transform="rotate(-90 62 62)"
          />
          <SvgText x={62} y={60} textAnchor="middle" fontSize={22} fontFamily={font.headingSemibold} fill={colors.text}>
            {fmt(total)}
          </SvgText>
          <SvgText x={62} y={80} textAnchor="middle" fontSize={11} fontFamily={font.body} fill={withAlpha(colors.text, 0.6)}>
            {`of ${fmt(goal)} ${unit}`}
          </SvgText>
        </Svg>
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={styles.big}>{total >= goal ? 'Target reached!' : `${fmt(goal - total)} ${unit} to go`}</Text>
          {total < goal && need > 0 && (
            <Text style={styles.note}>
              {fmt(need)} {unit} a day to finish; the group&rsquo;s doing {fmt(pace)}.
            </Text>
          )}
        </View>
      </View>
      {total > 0 && (
        <View style={{ gap: 6 }}>
          <Text style={styles.label}>Who&rsquo;s carried it</Text>
          <View style={styles.stack}>
            {sorted.map((r, i) => (
              <View key={r.userId} style={{ flex: Math.max(0.0001, of(r)), backgroundColor: SPREAD[i % SPREAD.length] }} />
            ))}
          </View>
          <View style={styles.legend}>
            {sorted.slice(0, 6).map((r, i) => (
              <View key={r.userId} style={styles.legendItem}>
                <View style={[styles.dot, { backgroundColor: SPREAD[i % SPREAD.length] }]} />
                <Text style={[styles.small, r.userId === userId && styles.bold]}>
                  {r.userId === userId ? 'You' : first(r.name)} · {fmt(of(r))}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </Frame>
  );
}

// ── Daily Streak: everyone by day, made it or out. ──

export function StreakPinned({
  challenge,
  board,
  userId,
  onOpen,
  statuses,
  stepsToday,
}: PinnedProps & { statuses: Map<string, StreakStatus>; stepsToday: number | null }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const goal = challenge.dailyGoalSteps ?? 0;
  const todayNo = Math.min(challenge.durationDays, Math.max(1, challengeDayNumber(challenge)));
  const cols = Math.min(challenge.durationDays, 10);
  const from = Math.max(1, Math.min(todayNo - 7, challenge.durationDays - cols + 1));
  const dayNos = Array.from({ length: cols }, (_, i) => from + i);
  const startKey = localDayKey(new Date(challenge.startsAt));
  const keyOf = (n: number) => {
    const [y, m, d] = startKey.split('-').map(Number);
    return localDayKey(new Date(y, m - 1, d + n - 1));
  };
  const stillIn = board.filter((r) => !statuses.get(r.userId)?.eliminatedOnDay).length;
  const mine = Math.max(0, stepsToday ?? 0);
  const myOut = !!(userId && statuses.get(userId)?.eliminatedOnDay);
  const people = [...board].sort((a, b) => (a.userId === userId ? -1 : b.userId === userId ? 1 : 0)).slice(0, 7);
  const cell = (r: BoardEntry, n: number) => {
    const out = statuses.get(r.userId)?.eliminatedOnDay ?? null;
    const k = keyOf(n);
    if (out && k > out) return { bg: 'transparent', fg: colors.text, mark: '' };
    if (out && k === out) return { bg: withAlpha(colors.amber, 0.25), fg: '#c2410c', mark: '×' };
    if (n < todayNo) return { bg: colors.green, fg: '#1b1d29', mark: '✓' };
    if (n === todayNo) {
      const done = r.userId === userId && goal > 0 && mine >= goal;
      return done ? { bg: colors.green, fg: '#1b1d29', mark: '✓' } : { bg: withAlpha(colors.amber, 0.18), fg: colors.amber, mark: '·' };
    }
    return { bg: withAlpha(colors.text, 0.06), fg: colors.text, mark: '' };
  };
  return (
    <Frame challenge={challenge} meta={goal ? `${goal.toLocaleString()} steps a day` : null} button="Open the challenge" onOpen={onOpen}>
      <Text style={styles.big}>
        {stillIn} of {board.length} still in
      </Text>
      <View style={{ gap: 4 }}>
        <View style={styles.gridRow}>
          <Text style={styles.gridName} />
          {dayNos.map((n) => (
            <Text key={n} style={[styles.gridHead, n === todayNo && { color: colors.accentActive, fontFamily: font.headingSemibold }]}>
              {n}
            </Text>
          ))}
        </View>
        {people.map((r) => {
          const out = !!statuses.get(r.userId)?.eliminatedOnDay;
          return (
            <View key={r.userId} style={styles.gridRow}>
              <Text style={[styles.gridName, r.userId === userId && styles.bold, out && styles.out]} numberOfLines={1}>
                {r.userId === userId ? 'You' : first(r.name)}
              </Text>
              {dayNos.map((n) => {
                const c = cell(r, n);
                return (
                  <View key={n} style={[styles.gridCell, { backgroundColor: c.bg }]}>
                    <Text style={[styles.gridMark, { color: c.fg }]}>{c.mark}</Text>
                  </View>
                );
              })}
            </View>
          );
        })}
      </View>
      {!myOut && goal > 0 && (
        <View style={{ gap: 6 }}>
          <View style={styles.rowBetween}>
            <Text style={styles.small}>
              Today: <Text style={styles.bold}>{mine.toLocaleString()}</Text> of {goal.toLocaleString()}
            </Text>
            <Text style={[styles.small, styles.bold]}>{mine >= goal ? 'Done for today' : `${(goal - mine).toLocaleString()} to go`}</Text>
          </View>
          <Bar share={goal ? mine / goal : 0} color={mine >= goal ? colors.green : colors.amber} styles={styles} />
        </View>
      )}
      <Text style={styles.small}>A missed day puts you out. Last one still in wins.</Text>
    </Frame>
  );
}

// ── 75 Day: day N of 75, and today's six. ──

const SEVENTY_FIVE: { key: keyof SeventyFiveCheckin; label: string }[] = [
  { key: 'workout1Done', label: 'Workout' },
  { key: 'workout2OutdoorDone', label: 'Outdoor workout' },
  { key: 'dietDone', label: 'Diet' },
  { key: 'waterDone', label: 'Gallon of water' },
  { key: 'readingDone', label: 'Read 10 pages' },
  { key: 'photoDone', label: 'Progress photo' },
];

export function SeventyFivePinned({ challenge, userId, onOpen }: PinnedProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const checkins = useLoad(`75:${challenge.id}`, () => listSeventyFiveCheckins(challenge.id));
  const today = localDayKey(new Date());
  const mineToday = checkins?.find((c) => c.userId === userId && c.day === today) ?? null;
  const done = SEVENTY_FIVE.filter((t) => !!mineToday?.[t.key]).length;
  const days = challenge.durationDays;
  const dayNo = Math.min(days, Math.max(1, challengeDayNumber(challenge)));
  const R = 38;
  const C = 2 * Math.PI * R;
  const myDays = new Set((checkins ?? []).filter((c) => c.userId === userId && SEVENTY_FIVE.every((t) => !!c[t.key])).map((c) => c.day));
  const startKey = localDayKey(new Date(challenge.startsAt));
  const keyOf = (n: number) => {
    const [y, m, d] = startKey.split('-').map(Number);
    return localDayKey(new Date(y, m - 1, d + n - 1));
  };
  return (
    <Frame
      challenge={challenge}
      meta={`${Math.max(0, days - dayNo)} days left`}
      button={done < SEVENTY_FIVE.length ? 'Tick off today' : 'Open the challenge'}
      primaryButton={done < SEVENTY_FIVE.length}
      onOpen={onOpen}
    >
      <View style={styles.rowCenter}>
        <Svg width={92} height={92} viewBox="0 0 92 92">
          <Circle cx={46} cy={46} r={R} stroke={withAlpha(colors.text, 0.1)} strokeWidth={10} fill="none" />
          <Circle cx={46} cy={46} r={R} stroke={colors.accent} strokeWidth={10} fill="none" strokeLinecap="round" strokeDasharray={`${(C * dayNo) / days} ${C}`} transform="rotate(-90 46 46)" />
          <SvgText x={46} y={48} textAnchor="middle" fontSize={20} fontFamily={font.headingSemibold} fill={colors.text}>
            {String(dayNo)}
          </SvgText>
          <SvgText x={46} y={64} textAnchor="middle" fontSize={10} fontFamily={font.body} fill={withAlpha(colors.text, 0.6)}>
            {`of ${days}`}
          </SvgText>
        </Svg>
        <View style={styles.strip}>
          {Array.from({ length: days }, (_, i) => {
            const n = i + 1;
            const bg = n === dayNo ? colors.amber : n < dayNo ? (myDays.has(keyOf(n)) ? colors.accent : withAlpha(colors.accent, 0.3)) : withAlpha(colors.text, 0.08);
            return <View key={n} style={[styles.stripCell, { backgroundColor: bg }]} />;
          })}
        </View>
      </View>
      <Text style={styles.big}>
        {done} of {SEVENTY_FIVE.length} done today
      </Text>
      {SEVENTY_FIVE.map((t) => (
        <Tick key={t.key} label={t.label} done={!!mineToday?.[t.key]} styles={styles} colors={colors} />
      ))}
    </Frame>
  );
}

// ── Journey: the route, you and the others on it. ──

export function JourneyPinned({ challenge, board, userId, onOpen }: PinnedProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const width = useTrackWidth();
  const course = challenge.courseId ? courseById(challenge.courseId) : undefined;
  const me = board.find((r) => r.userId === userId) ?? null;
  const miles = me?.totalDistanceMi ?? 0;
  if (!course) {
    return (
      <Frame challenge={challenge} button="Open the map" onOpen={onOpen}>
        <Text style={styles.note}>Open the challenge to see the route.</Text>
      </Frame>
    );
  }
  const next = nextStop(course, miles);
  const others = board.filter((r) => r.userId !== userId);
  return (
    <Frame challenge={challenge} meta={`${board.length} walkers · ${daysLeftOf(challenge)} days left`} button="Open the map" onOpen={onOpen}>
      <View style={{ borderRadius: 12, overflow: 'hidden' }}>
        <JourneyMap
          course={course}
          width={width}
          height={Math.round(width * 0.55)}
          miles={miles}
          labels="few"
          people={others.slice(0, 6).map((r, i) => ({ id: r.userId, miles: r.totalDistanceMi, initials: r.initials, color: SPREAD[i % SPREAD.length] }))}
        />
      </View>
      <View style={styles.rowBetween}>
        <Text style={styles.small}>
          You: <Text style={styles.bold}>{formatMiles(miles)} mi</Text> of {formatMiles(course.miles)}
        </Text>
        {next && <Text style={styles.small}>{next.name} in {formatMiles(Math.max(0, next.mi - miles))} mi</Text>}
      </View>
      <Bar share={course.miles ? miles / course.miles : 0} color={colors.accent} styles={styles} />
      {others.length > 0 && (
        <Text style={styles.small}>
          {others
            .slice(0, 3)
            .map((r) => `${first(r.name)} ${formatMiles(r.totalDistanceMi)} mi`)
            .join(' · ')}
        </Text>
      )}
    </Frame>
  );
}

// ── Checklist: today's items, and everyone's day. ──

export function ChecklistPinned({ challenge, board, userId, onOpen }: PinnedProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const data = useLoad<{ items: ChecklistItem[]; checkins: ChecklistCheckin[] }>(`checklist:${challenge.id}`, () =>
    Promise.all([listChecklistItems(challenge.id), listChecklistCheckins(challenge.id)]).then(([items, checkins]) => ({ items, checkins })),
  );
  const today = localDayKey(new Date());
  if (!data || !userId) {
    return (
      <Frame challenge={challenge} button="Open the checklist" onOpen={onOpen}>
        <Text style={styles.note}>{data === undefined ? 'Loading the checklist…' : 'Open the challenge to see the checklist.'}</Text>
      </Frame>
    );
  }
  const myItems = itemsForUser(data.items, userId, today);
  const myDone = doneItemIds(data.checkins, userId, today);
  const left = myItems.filter((i) => !myDone.has(i.id)).length;
  return (
    <Frame
      challenge={challenge}
      meta={`${board.length} people · ${daysLeftOf(challenge)} days left`}
      button={left > 0 ? 'Tick off today' : 'Open the checklist'}
      primaryButton={left > 0}
      onOpen={onOpen}
    >
      <Text style={styles.big}>
        {myItems.length - left} of {myItems.length} done today
      </Text>
      {myItems.map((i) => (
        <Tick key={i.id} label={i.label} done={myDone.has(i.id)} styles={styles} colors={colors} />
      ))}
      {board.length > 1 && (
        <View style={{ gap: 6 }}>
          <Text style={styles.label}>Everyone today</Text>
          {board.slice(0, 6).map((r) => {
            const items = itemsForUser(data.items, r.userId, today);
            const done = doneItemIds(data.checkins, r.userId, today);
            return (
              <View key={r.userId} style={styles.rowCenter}>
                <Text style={[styles.personName, r.userId === userId && styles.bold]} numberOfLines={1}>
                  {r.userId === userId ? 'You' : first(r.name)}
                </Text>
                <View style={styles.cells}>
                  {items.map((it) => (
                    <View key={it.id} style={[styles.cellBar, { backgroundColor: done.has(it.id) ? colors.green : withAlpha(colors.text, 0.08) }]} />
                  ))}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </Frame>
  );
}

// ── Daily Doors: the calendar, today's door, the standings. ──

export function DoorsPinned({ challenge, board, userId, onOpen, houndName }: PinnedProps & { houndName: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const game = useLoad<DoorsGame>(`doors:${challenge.id}`, () => getDoors(challenge.id));
  if (!game) {
    return (
      <Frame challenge={challenge} button="Open the doors" onOpen={onOpen}>
        <Text style={styles.note}>{game === undefined ? 'Loading the doors…' : 'Open the challenge to see the doors.'}</Text>
      </Frame>
    );
  }
  const door = todaysDoor(game);
  // Six doors around today: the last few and the next couple.
  const at = door ? game.doors.findIndex((d) => d.no === door.no) : game.doors.findIndex((d) => d.state === 'locked');
  const from = Math.max(0, Math.min((at < 0 ? game.doors.length : at) - 3, game.doors.length - 6));
  const near = game.doors.slice(from, from + 6);
  const nameOf = (id: string) => (id === userId ? 'You' : first(board.find((r) => r.userId === id)?.name ?? 'Someone'));
  const shut = door?.state === 'ready';
  return (
    <Frame
      challenge={challenge}
      meta={`${game.players.toLocaleString()} ${game.players === 1 ? 'player' : 'players'}`}
      button={shut ? 'Open today’s door' : 'Open the doors'}
      primaryButton={shut}
      onOpen={onOpen}
    >
      <DoorsCalendar doors={near} />
      {door && (
        <View style={styles.doorToday}>
          <Text style={styles.kicker}>{shut ? `DOOR ${door.no} IS WAITING` : `BEHIND DOOR ${door.no}`}</Text>
          <Text style={styles.big}>{shut ? 'Knock to see today’s task.' : door.task ? taskTitle(door.task, houndName) : 'Done for today.'}</Text>
          {door.state === 'done' && <Text style={styles.small}>Done. Come back tomorrow.</Text>}
        </View>
      )}
      {game.board.slice(0, 3).map((r) => (
        <Row key={r.userId} rank={r.place} name={nameOf(r.userId)} value={`${r.points} pts`} me={r.userId === userId} styles={styles} />
      ))}
    </Frame>
  );
}

// ── Hound Roulette: the wheel, today's task, the ride, the standings. ──

function MiniWheel({ size }: { size: number }) {
  const c = size / 2;
  const r = c - 2;
  const pt = (a: number) => `${(c + r * Math.sin((a * Math.PI) / 180)).toFixed(1)} ${(c - r * Math.cos((a * Math.PI) / 180)).toFixed(1)}`;
  return (
    <Svg width={size} height={size}>
      {SEGMENTS.map((s, i) => (
        <Path key={s.id} d={`M${c} ${c} L${pt(i * 36)} A${r} ${r} 0 0 1 ${pt(i * 36 + 36)} Z`} fill={s.fill} />
      ))}
      <Circle cx={c} cy={c} r={r} fill="none" stroke="#f0c24a" strokeWidth={2} />
      <Circle cx={c} cy={c} r={r * 0.26} fill="#161826" stroke="#f0c24a" strokeWidth={2} />
    </Svg>
  );
}

export function RoulettePinned({ challenge, userId, onOpen }: PinnedProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const game = useLoad<RouletteGame>(`roulette:${challenge.id}`, () => getRoulette(challenge.id));
  if (!game) {
    return (
      <Frame challenge={challenge} button="Open the wheel" onOpen={onOpen}>
        <Text style={styles.note}>{game === undefined ? 'Loading the wheel…' : 'Open the challenge to see the wheel.'}</Text>
      </Frame>
    );
  }
  const w = rouletteWaiting(game);
  const s = game.spin;
  return (
    <Frame
      challenge={challenge}
      meta={`${game.board.length} ${game.board.length === 1 ? 'player' : 'players'}`}
      button={w.duel ? 'Answer the Duel' : w.spin ? 'Spin today’s wheel' : 'Open the wheel'}
      primaryButton={!!w.duel || w.spin}
      onOpen={onOpen}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <MiniWheel size={58} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.kicker}>{w.spin ? 'TODAY’S WHEEL IS WAITING' : s ? `TODAY · ${stakeName(s.stake).toUpperCase()}` : 'HOUND ROULETTE'}</Text>
          <Text style={styles.big}>
            {w.duel
              ? `${first(w.duel.other)} called you out for ${w.duel.stake}`
              : s
                ? `${rouletteTaskTitle(s.task, s.target, s.double)}${s.status === 'done' ? ' · done' : ''}`
                : game.reason ?? 'Spin to see today’s task.'}
          </Text>
          <Text style={styles.small}>
            {game.banked} banked{game.ride > 0 ? ` · ${game.ride} riding × ${game.mult}` : ''}
            {game.raidOnMe ? ` · ${first(game.raidOnMe.by)} is raiding you` : ''}
          </Text>
        </View>
      </View>
      {game.board.slice(0, 3).map((r, i) => (
        <Row key={r.userId} rank={1 + game.board.filter((x) => x.banked > r.banked).length || i + 1} name={r.userId === userId ? 'You' : first(r.name)} value={`${r.banked} banked`} me={r.userId === userId} styles={styles} />
      ))}
    </Frame>
  );
}

// ── Paw Slots: three reels, your Paw Coins and place, spins ready. ──

export function SlotsPinned({ challenge, userId, onOpen }: PinnedProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const game = useLoad<SlotsGame>(`slots:${challenge.id}`, () => getSlots(challenge.id));
  if (!game) {
    return (
      <Frame challenge={challenge} button="Open the machine" onOpen={onOpen}>
        <Text style={styles.note}>{game === undefined ? 'Loading the machine…' : 'Open the challenge to see the machine.'}</Text>
      </Frame>
    );
  }
  const ready = slotsWaiting(game);
  const team = game.teams >= 2;
  return (
    <Frame
      challenge={challenge}
      meta={`${game.pool.toLocaleString('en-US')} Bones in the pool`}
      button={ready > 0 ? `Play · ${ready} ${ready === 1 ? 'spin' : 'spins'} ready` : 'Open the machine'}
      primaryButton={ready > 0}
      onOpen={onOpen}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Svg width={84} height={30} viewBox="0 0 176 60">
          {(['bone', 'gold', 'collar'] as const).map((s, i) => (
            <G key={s} transform={`translate(${i * 60} 2)`}>
              <Rect x={0} y={0} width={56} height={56} rx={10} fill="#f6f1e4" />
              <SlotSymbolArt sym={s} />
            </G>
          ))}
        </Svg>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.kicker}>{ready > 0 ? 'SPINS READY' : 'PAW SLOTS'}</Text>
          <Text style={styles.big}>
            {game.me.coins.toLocaleString('en-US')} Paw Coins{team ? '' : ` · ${ordinal(game.me.rank)}`}
          </Text>
          <Text style={styles.small}>
            {team ? `The ${teamName(game.me.team)} · ` : ''}
            {game.today.nextAt != null ? `${Math.max(0, game.today.nextAt - game.today.steps).toLocaleString('en-US')} steps to the next spin` : 'All of today’s spins from steps are in'}
          </Text>
        </View>
      </View>
      {team
        ? game.teamBoard.slice(0, 3).map((t) => (
            <Row key={t.team} rank={t.rank} name={teamName(t.team)} value={`${Math.round(t.avg).toLocaleString('en-US')} a hound`} me={t.mine} styles={styles} />
          ))
        : game.board.slice(0, 3).map((r) => (
            <Row key={r.userId} rank={r.rank} name={r.userId === userId ? 'You' : first(r.name)} value={`${r.coins.toLocaleString('en-US')}`} me={r.userId === userId} styles={styles} />
          ))}
    </Frame>
  );
}

// ── Bullseye: the day's field, your points and place, arrows ready. ──

export function BullseyePinned({ challenge, userId, onOpen }: PinnedProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const game = useLoad<BullseyeGame>(`bullseye:${challenge.id}`, () => getBullseye(challenge.id));
  if (!game) {
    return (
      <Frame challenge={challenge} button="Open the field" onOpen={onOpen}>
        <Text style={styles.note}>{game === undefined ? 'Loading the field…' : 'Open the challenge to see the field.'}</Text>
      </Frame>
    );
  }
  const ready = bullseyeWaiting(game);
  const c = game.conditions;
  return (
    <Frame
      challenge={challenge}
      meta={c.world === 'moon' ? 'A Moon day: ⅙ gravity' : c.balloons ? 'Balloon day!' : c.bounty && !game.goldTaker ? 'The gold balloon is still up' : `${game.pool.toLocaleString('en-US')} Bones in the pool`}
      button={ready > 0 ? `To the field · ${ready} ${ready === 1 ? 'arrow' : 'arrows'}` : 'Open the field'}
      primaryButton={ready > 0}
      onOpen={onOpen}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 96, height: 72, borderRadius: 10, overflow: 'hidden' }}>
          <BullseyeFieldArt width={96} height={72} conditions={c} targets={game.targets} now={Date.now()} showHound={false} labels={false} showSocks={false} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.kicker}>{ready > 0 ? 'ARROWS READY' : 'BULLSEYE'}</Text>
          <Text style={styles.big}>
            {game.me.points.toLocaleString('en-US')} points · {ordinal(game.me.rank)}
          </Text>
          <Text style={styles.small}>
            {game.today.nextAt != null ? `${Math.max(0, game.today.nextAt - game.today.steps).toLocaleString('en-US')} steps to 3 more arrows` : 'All of today’s arrows are in'}
          </Text>
        </View>
      </View>
      {game.board.slice(0, 3).map((r) => (
        <Row key={r.userId} rank={r.rank} name={r.userId === userId ? 'You' : first(r.name)} value={`${r.points.toLocaleString('en-US')}`} me={r.userId === userId} styles={styles} />
      ))}
    </Frame>
  );
}

// ── Long Shot: the day's range, your points and place, rounds ready. ──

export function LongShotPinned({ challenge, userId, onOpen }: PinnedProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const game = useLoad<LongShotGame>(`longshot:${challenge.id}`, () => getLongShot(challenge.id));
  if (!game) {
    return (
      <Frame challenge={challenge} button="Open the range" onOpen={onOpen}>
        <Text style={styles.note}>{game === undefined ? 'Loading the range…' : 'Open the challenge to see the range.'}</Text>
      </Frame>
    );
  }
  const ready = longshotWaiting(game);
  const c = game.conditions;
  return (
    <Frame
      challenge={challenge}
      meta={c.world === 'moon' ? 'A Moon day: ⅙ gravity' : c.bounty && !game.goldTaker ? `Gold plate at ${yd(c.gold)} still up` : `${game.pool.toLocaleString('en-US')} Bones in the pool`}
      button={ready > 0 ? `To the range · ${ready} ${ready === 1 ? 'round' : 'rounds'}` : 'Open the range'}
      primaryButton={ready > 0}
      onOpen={onOpen}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 96, height: 72, borderRadius: 10, overflow: 'hidden' }}>
          <LongShotRangeArt width={96} height={72} conditions={c} plates={game.plates} now={Date.now()} showHound={false} labels={false} showFlags={false} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.kicker}>{ready > 0 ? 'ROUNDS READY' : 'LONG SHOT'}</Text>
          <Text style={styles.big}>
            {game.me.points.toLocaleString('en-US')} points · {ordinal(game.me.rank)}
          </Text>
          <Text style={styles.small}>
            {game.today.nextAt != null ? `${Math.max(0, game.today.nextAt - game.today.steps).toLocaleString('en-US')} steps to the next round` : 'All of today’s rounds are in'}
          </Text>
        </View>
      </View>
      {game.board.slice(0, 3).map((r) => (
        <Row key={r.userId} rank={r.rank} name={r.userId === userId ? 'You' : first(r.name)} value={`${r.points.toLocaleString('en-US')}`} me={r.userId === userId} styles={styles} />
      ))}
    </Frame>
  );
}

// ── Hound Chess: the position, whose move, the pieces freed today. ──

function MiniBoard({ fen, me, size }: { fen: string; me: 'w' | 'b'; size: number }) {
  const cell = size / 8;
  const { pieces } = parseFen(fen);
  const at = (sq: number) => {
    const col = me === 'b' ? 7 - (sq % 8) : sq % 8;
    const row = me === 'b' ? Math.floor(sq / 8) : 7 - Math.floor(sq / 8);
    return { x: col * cell, y: row * cell };
  };
  return (
    <Svg width={size} height={size}>
      {Array.from({ length: 64 }, (_, sq) => {
        const p = at(sq);
        return <Rect key={sq} x={p.x} y={p.y} width={cell} height={cell} fill={(Math.floor(sq / 8) + (sq % 8)) % 2 === 0 ? '#9c7752' : '#ecdcb8'} />;
      })}
      {pieces.map((pc) => {
        const p = at(pc.sq);
        const r = cell * (pc.type === 'P' ? 0.24 : 0.34);
        return (
          <Circle
            key={`${pc.color}${pc.sq}`}
            cx={p.x + cell / 2}
            cy={p.y + cell / 2}
            r={r}
            fill={pc.color === 'w' ? '#f6efe2' : '#373c58'}
            stroke={pc.type === 'K' || pc.type === 'Q' ? '#f0c24a' : pc.color === 'w' ? '#5a4a3a' : '#0f111a'}
            strokeWidth={pc.type === 'K' || pc.type === 'Q' ? 1.6 : 0.8}
          />
        );
      })}
    </Svg>
  );
}

export function ChessPinned({ challenge, onOpen }: PinnedProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const game = useLoad<ChessGame>(`chess:${challenge.id}`, () => getChess(challenge.id));
  if (!game) {
    return (
      <Frame challenge={challenge} button="Open the board" onOpen={onOpen}>
        <Text style={styles.note}>{game === undefined ? 'Loading the board…' : 'Open the challenge to see the board.'}</Text>
      </Frame>
    );
  }
  const free = ['knights, bishops', 'rooks', 'the queen'].filter((_, i) => game.free.includes(['N', 'R', 'Q'][i]));
  return (
    <Frame challenge={challenge} button={game.myTurn ? 'Your move' : 'Open the board'} primaryButton={game.myTurn} onOpen={onOpen}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <MiniBoard fen={game.fen} me={game.me ?? 'w'} size={84} />
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={styles.kicker}>{game.status === 'final' ? 'GAME OVER' : game.myTurn ? 'YOUR MOVE' : 'HOUND CHESS'}</Text>
          <Text style={styles.big}>{chessHeadline(challenge.name, game)}</Text>
          <Text style={styles.small}>
            {game.steps.toLocaleString('en-US')} steps today · {free.length ? `${free.join(', ')} free` : 'pawns and king only'}
          </Text>
        </View>
      </View>
    </Frame>
  );
}

// ── Pack Wars: the neighborhood map, and who holds what. ──

export function PacksPinned({ challenge, onOpen }: PinnedProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const game = useLoad<PackWarsGame>(`packs:${challenge.id}`, () => getPackWars(challenge.id));
  if (!game) {
    return (
      <Frame challenge={challenge} button="Open Pack Wars" onOpen={onOpen}>
        <Text style={styles.note}>{game === undefined ? 'Loading the map…' : 'Open the challenge to see the map.'}</Text>
      </Frame>
    );
  }
  const live = !game.settled && packDayNo(game) != null;
  const voted = game.myVote != null;
  const packs = PACKS.filter((p) => game.members[p.id] > 0 || heldBy(game, p.id) > 0).sort((a, b) => heldBy(game, b.id) - heldBy(game, a.id));
  return (
    <Frame
      challenge={challenge}
      meta={`${packs.length} packs · ${game.map.length} blocks`}
      button={live && !voted ? 'Vote on tonight’s move' : 'Open Pack Wars'}
      primaryButton={live && !voted}
      onOpen={onOpen}
    >
      <HoodMap game={game} can={new Set()} taken={new Set(game.lastNight.map((m) => m.idx))} onVote={() => {}} />
      {packs.map((p) => (
        <View key={p.id} style={styles.rowCenter}>
          <View style={[styles.dot, { backgroundColor: p.color, width: 12, height: 12 }]} />
          <Text style={[styles.personName, { flex: 1 }, p.id === game.myPack && styles.bold]}>
            {p.id === game.myPack ? `Your pack · ${packOf(p.id).name}` : p.name}
          </Text>
          <Text style={[styles.small, styles.bold]}>{heldBy(game, p.id)} blocks</Text>
        </View>
      ))}
      {live && voted && <Text style={styles.small}>You&rsquo;ve voted. Your pack&rsquo;s steps tonight decide the move.</Text>}
    </Frame>
  );
}

// ── Pieces. ──

function Row({ rank, name, value, me, styles }: { rank: number; name: string; value: string; me: boolean; styles: Styles }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rank}>{rank}</Text>
      <Text style={[styles.personName, { flex: 1 }, me && styles.bold]} numberOfLines={1}>
        {name}
      </Text>
      <Text style={[styles.value, me && styles.valueMe]}>{value}</Text>
    </View>
  );
}

function Tick({ label, done, styles, colors }: { label: string; done: boolean; styles: Styles; colors: Palette }) {
  return (
    <View style={styles.tickRow}>
      <View style={[styles.tickBox, done ? { backgroundColor: colors.green } : { borderWidth: 2, borderColor: withAlpha(colors.text, 0.25) }]}>
        {done && <Text style={styles.tickMark}>✓</Text>}
      </View>
      <Text style={[styles.personName, { width: undefined, flex: 1 }]}>{label}</Text>
    </View>
  );
}

function Bar({ share, color, styles }: { share: number; color: string; styles: Styles }) {
  return (
    <View style={styles.track}>
      <View style={[styles.fill, { width: `${Math.round(Math.max(0, Math.min(1, share)) * 100)}%`, backgroundColor: color }]} />
    </View>
  );
}

function ordinal(n: number): string {
  const sfx = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${sfx}`;
}

type Styles = ReturnType<typeof makeStyles>;

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    card: { gap: 10 },
    header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    title: { flex: 1, fontFamily: font.headingSemibold, fontSize: 16, color: colors.text },
    meta: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    note: { fontSize: 13.5, lineHeight: 19, color: withAlpha(colors.text, 0.8) },
    small: { fontSize: 13, color: withAlpha(colors.text, 0.65) },
    label: { fontSize: 13, fontFamily: font.headingSemibold, color: withAlpha(colors.text, 0.65) },
    kicker: { fontSize: 12, letterSpacing: 0.6, fontFamily: font.headingSemibold, color: colors.amber },
    big: { fontFamily: font.headingSemibold, fontSize: 15.5, color: colors.text },
    bold: { fontFamily: font.headingSemibold, color: colors.text },
    out: { textDecorationLine: 'line-through', color: withAlpha(colors.text, 0.4) },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 },
    rowCenter: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    rank: { width: 18, fontSize: 13, fontFamily: font.headingSemibold, color: withAlpha(colors.text, 0.55) },
    personName: { fontSize: 14, color: colors.text, width: 80 },
    value: { fontFamily: font.headingSemibold, fontSize: 14, color: colors.text },
    valueMe: { color: colors.accentActive },
    stack: { flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden' },
    legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, columnGap: 14 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: '44%' },
    dot: { width: 10, height: 10, borderRadius: 3 },
    gridRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    gridName: { width: 66, fontSize: 12.5, color: colors.text },
    gridHead: { flex: 1, textAlign: 'center', fontSize: 11, color: withAlpha(colors.text, 0.55) },
    gridCell: { flex: 1, height: 18, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
    gridMark: { fontSize: 10, fontFamily: font.headingSemibold },
    track: { height: 8, borderRadius: 4, backgroundColor: withAlpha(colors.text, 0.08), overflow: 'hidden' },
    fill: { height: 8, borderRadius: 4 },
    strip: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
    stripCell: { width: 11, height: 9, borderRadius: 2 },
    tickRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 3 },
    tickBox: { width: 22, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
    tickMark: { fontSize: 12, fontFamily: font.headingSemibold, color: '#1b1d29' },
    cells: { flex: 1, flexDirection: 'row', gap: 4 },
    cellBar: { flex: 1, height: 10, borderRadius: 3 },
    doorToday: {
      gap: 4,
      padding: 12,
      borderRadius: 12,
      backgroundColor: withAlpha(colors.amber, 0.12),
      borderWidth: 1,
      borderColor: withAlpha(colors.amber, 0.35),
    },
  });
}
