import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { FireIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { Tile } from './TodayTiles';
import { FastRing, StageIcon } from '../fasting/FastingParts';
import { STAGE_COLOR, clockText, leftText, longestShort, nextStage, planLabel, stageAt } from '../fasting/fasting';
import { getFastingGames, hoursSince, type FastingGamesState, type MyFasting } from '../fasting/fastingApi';
import { GAME_INFO } from '../fasting/fastingGames';
import { slotColor } from '../fasting/FastingGameScreen';

// The Fasting card across the top of Today (Steve, Nov 2026: "for folks
// who care more about Fasting and not steps"): swipe the Goals tile
// sideways to it. While fasting: the ring with the clock, the stage
// you're in, what's left to your goal and the next stage (never one past
// the goal). Between fasts: your plan, the week and your last fast. Tap
// opens the Fasting screen.

const at = (startedAt: string, h: number) =>
  new Date(new Date(startedAt).getTime() + h * 3600000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function TodayFastingCard({ fasting, now, onOpen }: { fasting: MyFasting; now: number; onOpen: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const o = fasting.open;
  const h = o ? hoursSince(o.startedAt, now) : 0;
  // A phase game that's open (0269) takes the card's last line.
  const [games, setGames] = useState<FastingGamesState | null>(null);
  const fastKey = `${o?.id ?? '-'}:${fasting.days.length}`;
  useEffect(() => {
    getFastingGames()
      .then(setGames)
      .catch(() => {});
  }, [fastKey, Math.floor(now / 600000)]);
  const gf = games?.on ? games.fast : null;
  const gh = gf ? ((gf.endedAt ? new Date(gf.endedAt).getTime() : now) - new Date(gf.startedAt).getTime()) / 3600000 : 0;
  const openGame = gf
    ? games!.slots.find((s) => s.status === 'open' || (s.status === 'locked' && gh >= s.at))
    : undefined;
  const streak = fasting.numbers.streak;
  const rows: { color: string; icon?: string; value: string; sub: string; subColor?: string }[] = [];

  if (o) {
    const st = stageAt(h);
    const reached = h >= o.goalHours;
    rows.push({ color: STAGE_COLOR[st.key], icon: st.key, value: st.name, sub: `${st.from}–${st.to === Infinity ? '' : st.to} h of your fast` });
    rows.push(
      reached
        ? { color: colors.green, value: `${planLabel(o.goalHours)} done`, sub: 'End it when you eat', subColor: colors.green }
        : { color: colors.green, value: `${leftText(o.goalHours - h)} to go`, sub: `Goal ${o.goalHours} h · ends ${at(o.startedAt, o.goalHours)}` },
    );
    const nx = nextStage(h);
    if (!reached && nx && nx.from < o.goalHours) {
      rows.push({ color: STAGE_COLOR[nx.key], icon: nx.key, value: `Next: ${nx.name}`, sub: `in ${leftText(nx.from - h)} · ${at(o.startedAt, nx.from)}` });
    } else if (fasting.cheers.length > 0) {
      rows.push({
        color: colors.accent,
        value: `${fasting.cheers.length} cheered you on`,
        sub: fasting.cheers.map((c) => c.name).slice(0, 3).join(', '),
      });
    }
  } else {
    const last = fasting.days.length ? fasting.days[fasting.days.length - 1] : null;
    rows.push({ color: colors.accent, value: `${planLabel(fasting.planHours)} plan`, sub: fasting.paidToday ? 'Today’s Bones earned' : 'Tap Start when you finish eating' });
    rows.push({ color: colors.green, value: `${fasting.numbers.weekDays} on plan this week`, sub: `${fasting.numbers.days30} ${fasting.numbers.days30 === 1 ? 'day' : 'days'} in the last 30` });
    if (last) {
      rows.push({
        color: last.onPlan ? colors.green : colors.amber,
        value: `Last fast ${clockText(last.hours)}`,
        sub: last.onPlan ? '✓ On plan' : 'Short of the plan',
        subColor: last.onPlan ? colors.green : undefined,
      });
    }
  }

  if (openGame) {
    const row = {
      color: slotColor(openGame.slot, colors.green),
      value: `${GAME_INFO[openGame.game].name} is open`,
      sub: 'Play it in Fasting ›',
      subColor: slotColor(openGame.slot, colors.green),
    };
    if (rows.length >= 3) rows[2] = row;
    else rows.push(row);
  } else if (o && rows.length < 3) {
    // Nothing next before the goal and no cheers: when it started.
    rows.push({
      color: withAlpha(colors.text, 0.35),
      value: `Started ${new Date(o.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`,
      sub: `${planLabel(o.goalHours)} plan`,
    });
  }

  // Under the ring, the numbers at a glance, the height of the Goals
  // tile's water row (Steve, Nov 2026: same size as the Goals card; the
  // games stay on the Fasting screen, with the open one named above).
  const stats: [string, string][] = [
    [`🔥 ${streak}`, 'day streak'],
    [`${fasting.numbers.weekDays}`, 'this week'],
    [games?.on ? games.points.toLocaleString() : `${fasting.numbers.days30}`, games?.on ? 'Fast Points' : 'days in 30'],
    [longestShort(fasting.numbers.longest), 'longest'],
  ];

  return (
    <Tile
      label={o ? `Fasting · ${planLabel(o.goalHours)}` : 'Fasting'}
      wide
      corner
      onPress={onOpen}
      accessibilityLabel={
        o ? `Fasting, ${clockText(h)} of ${o.goalHours} hours, ${stageAt(h).name}. Open Fasting` : 'Fasting, not fasting now. Open Fasting'
      }
      accessory={
        streak > 0 ? (
          <View style={styles.streak}>
            <FireIcon size={14} color={colors.amber} weight="fill" />
            <Text style={styles.streakText}>{streak}-day streak</Text>
          </View>
        ) : null
      }
    >
      <View style={styles.row}>
        <FastRing size={112} hours={o ? h : 0} goal={o ? o.goalHours : fasting.planHours} done={!!o && h >= o.goalHours}>
          <Text style={styles.clock}>{o ? clockText(h) : 'Start'}</Text>
          <Text style={styles.ringSub}>{o ? `of ${o.goalHours} h` : planLabel(fasting.planHours)}</Text>
        </FastRing>
        <View style={styles.legend}>
          {rows.map((r) => (
            <View key={r.value} style={styles.legendRow}>
              {r.icon ? (
                <View style={{ marginTop: 2 }}>
                  <StageIcon stageKey={r.icon} size={13} color={r.color} />
                </View>
              ) : (
                <View style={[styles.dot, { backgroundColor: r.color }]} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.value} numberOfLines={1}>
                  {r.value}
                </Text>
                <Text style={[styles.sub, r.subColor ? { color: r.subColor } : null]} numberOfLines={1}>
                  {r.sub}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </View>
      {/* The numbers sit at the bottom, so this card ends where the Goals
          tile does (its water row) and any spare room is above them. */}
      <View style={{ flexGrow: 1, minHeight: 10 }} />
      <View style={styles.stats}>
        {stats.map(([v, l]) => (
          <View key={l} style={styles.stat}>
            <Text style={styles.statValue} numberOfLines={1}>
              {v}
            </Text>
            <Text style={styles.statLabel} numberOfLines={2}>
              {l}
            </Text>
          </View>
        ))}
      </View>
    </Tile>
  );
}

// Goals and Fasting side by side: swipe between them, dots under, and the
// phone remembers which was showing (todayPrefs). Both pages are as tall
// as the taller one.
export function TodayTopPager({
  pages,
  page,
  onPage,
}: {
  pages: React.ReactNode[];
  page: number;
  onPage: (i: number) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [w, setW] = useState(0);
  const [shown, setShown] = useState(page);
  const ref = useRef<ScrollView>(null);
  const placed = useRef(false);
  // The same gap as between the other tiles, so the cards don't touch
  // while they slide.
  const GAP = 10;
  const step = w + GAP;

  useEffect(() => {
    if (w > 0 && !placed.current) {
      placed.current = true;
      ref.current?.scrollTo({ x: page * step, animated: false });
    }
  }, [w, page, step]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!w) return;
    const i = Math.max(0, Math.min(pages.length - 1, Math.round(e.nativeEvent.contentOffset.x / step)));
    if (i !== shown) {
      setShown(i);
      onPage(i);
    }
  };

  return (
    <View style={{ gap: 6 }} onLayout={(e) => setW(Math.round(e.nativeEvent.layout.width))}>
      {w > 0 && (
        <ScrollView
          ref={ref}
          horizontal
          snapToInterval={step}
          decelerationRate="fast"
          disableIntervalMomentum
          showsHorizontalScrollIndicator={false}
          contentOffset={{ x: page * step, y: 0 }}
          onScroll={onScroll}
          scrollEventThrottle={32}
          accessibilityHint="Swipe left or right for Goals and Fasting"
        >
          {pages.map((p, i) => (
            <View key={i} style={{ width: w, marginRight: i < pages.length - 1 ? GAP : 0, flexDirection: 'column' }}>
              {p}
            </View>
          ))}
        </ScrollView>
      )}
      <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {pages.map((_, i) => (
          <View key={i} style={[styles.pageDot, i === shown && { backgroundColor: colors.accent, width: 16 }]} />
        ))}
      </View>
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    streak: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    streakText: { fontFamily: font.headingSemibold, fontSize: 12.5, color: colors.amber },
    row: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 6 },
    clock: { fontFamily: font.headingSemibold, fontSize: 21, color: colors.text, fontVariant: ['tabular-nums'] },
    ringSub: { fontSize: 11.5, color: withAlpha(colors.text, 0.55) },
    legend: { flex: 1, gap: 9 },
    legendRow: { flexDirection: 'row', gap: 8 },
    dot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
    value: { fontFamily: font.headingSemibold, fontSize: 14, color: colors.text },
    sub: { fontSize: 12, color: withAlpha(colors.text, 0.6), marginTop: 1 },
    stats: { flexDirection: 'row', borderRadius: 12, backgroundColor: withAlpha(colors.accent, 0.08), paddingVertical: 10 },
    stat: { flex: 1, alignItems: 'center', paddingHorizontal: 2 },
    statValue: { fontFamily: font.headingSemibold, fontSize: 16, color: colors.text },
    statLabel: { fontSize: 11, lineHeight: 14, color: withAlpha(colors.text, 0.6), textAlign: 'center' },
    dots: { flexDirection: 'row', justifyContent: 'center', gap: 5 },
    pageDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: withAlpha(colors.text, 0.2) },
  });
}
