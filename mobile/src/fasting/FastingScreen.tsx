import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Pressable, ScrollView, StyleSheet, Switch, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeftIcon, CaretRightIcon, CheckSquareIcon, CoffeeIcon, FlagCheckeredIcon, ListBulletsIcon, SquareIcon, UsersThreeIcon, UserPlusIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { Button } from '../components/Button';
import { FriendPickList } from '../components/FriendPickList';
import { Avatar } from '../components/Avatar';
import { TileSheet } from '../home/TodayTiles';
import { supabaseFriendsProvider } from '../friends/supabaseFriends';
import type { Friend } from '../friends/types';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import {
  BREAK_FAST_TIP,
  DRINKS,
  EVIDENCE_WORD,
  FEELS,
  PLANS,
  STAGES,
  WEEKDAYS,
  bonesForHours,
  clockText,
  isoWeekday,
  leftText,
  localDayKey,
  nextStreakBonus,
  planLabel,
  stageAt,
  nextStage,
  STAGE_COLOR,
} from './fasting';
import {
  cancelFast,
  cheerFast,
  compareFasting,
  declineFastPack,
  endFast,
  getFastingFriends,
  getFastingWaiting,
  getMyFasting,
  hoursSince,
  joinFastPack,
  saveFastingSettings,
  setFastFeel,
  setFastingAge,
  startFast,
  type BoardRow,
  type FastPackInvite,
  type FastResult,
  type FastingCompare,
  type FriendFasting,
  type MyFasting,
} from './fastingApi';
import { FastDial, FastRing, LongestText, PersonAvatar, StageIcon } from './FastingParts';
import { scheduleFastingReminders } from './fastingReminders';
import { getHoundClubs, type HoundClub } from '../clubs/clubsApi';
import { ClubBadge } from '../clubs/clubLook';

// Fasting (0261): press Start when you finish eating, End when you eat.
// One screen: the first-time check, starting (your plan, when you
// stopped eating, alone or together), the live ring while you fast, the
// result when you end, then your week, the friends board and settings.
// The main action (Start fast / End fast) is pinned at the bottom.

type Sheet = 'drinks' | 'stages' | 'together' | 'end' | 'start-when' | { compare: string } | null;

// How far back a fast can start ("I stopped eating at…"), as the server
// allows (fasting_begin), and the quick picks under the time.
const MAX_BACK_MIN = 12 * 60;
const QUICK_BACK = [0, 60, 120, 180, 240, 360, 480, 720];

function agoLabel(min: number): string {
  if (min === 0) return 'Now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} m ago` : `${h} h ago`;
}

function timeAgo(min: number): string {
  return new Date(Date.now() - min * 60000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function FastingScreen({
  onBack,
  onOpenPack,
  onOpenClub,
}: {
  onBack: () => void;
  onOpenPack: (packId: string) => void;
  // A Hound Fasting club you're not in yet (0262).
  onOpenClub?: (clubId: string) => void;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { width: winW } = useWindowDimensions();
  const [me, setMe] = useState<MyFasting | null>(null);
  const [friends, setFriends] = useState<{ now: FriendFasting[]; board: BoardRow[] } | null>(null);
  const [invites, setInvites] = useState<FastPackInvite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [plan, setPlan] = useState<number | null>(null);
  const [backMin, setBackMin] = useState(0);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [result, setResult] = useState<FastResult | null>(null);
  const [feel, setFeel] = useState<string | null>(null);
  const [allFriends, setAllFriends] = useState<Friend[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [compare, setCompare] = useState<FastingCompare | null>(null);
  // The Hound Fasting club, while you're not in it (0262).
  const [club, setClub] = useState<HoundClub | null>(null);
  // "I ate at…" in the End sheet, minutes ago.
  const [endMin, setEndMin] = useState(0);

  const load = useCallback(async () => {
    try {
      const m = await getMyFasting();
      setMe(m);
      setError(null);
      scheduleFastingReminders(m);
      if (m.age === 'ok') {
        getFastingFriends()
          .then(setFriends)
          .catch(() => {});
        getFastingWaiting()
          .then(setInvites)
          .catch(() => {});
        getHoundClubs()
          .then((l) => setClub(l.find((c) => c.sport === 'fasting' && !c.role) ?? null))
          .catch(() => {});
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t reach Hound.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      const tick = setInterval(() => setNow(Date.now()), 30000);
      const refresh = setInterval(() => {
        if (AppState.currentState === 'active') load();
      }, 90000);
      return () => {
        clearInterval(tick);
        clearInterval(refresh);
      };
    }, [load]),
  );

  useEffect(() => {
    if (sheet === 'together' && allFriends === null) {
      supabaseFriendsProvider
        .listFriends()
        .then((f) => setAllFriends(f.filter((x) => x.status === 'accepted')))
        .catch(() => setAllFriends([]));
    }
  }, [sheet, allFriends]);

  useEffect(() => {
    if (sheet && typeof sheet === 'object' && 'compare' in sheet) {
      setCompare(null);
      compareFasting(sheet.compare)
        .then(setCompare)
        .catch((e) => Alert.alert('Couldn’t compare', e instanceof Error ? e.message : ''));
    }
  }, [sheet]);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      Alert.alert('Fasting', e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const chosenPlan = plan ?? me?.planHours ?? 16;
  const open = me?.open ?? null;
  const hours = open ? hoursSince(open.startedAt, now) : 0;

  const begin = (invite: string[]) =>
    run(async () => {
      const startedAt = backMin > 0 ? new Date(Date.now() - backMin * 60000) : null;
      const r = await startFast(chosenPlan, startedAt, invite);
      setSheet(null);
      setPicked([]);
      setBackMin(0);
      setResult(null);
      await load();
      if (r.packId) onOpenPack(r.packId);
    });

  const finish = (minAgo: number) =>
    run(async () => {
      const r = await endFast(minAgo > 0 ? new Date(Date.now() - minAgo * 60000) : null);
      setSheet(null);
      setFeel(null);
      setResult(r);
      await load();
    });

  // ── Not answered yet: the one-time check ──
  const gate = (
    <View style={styles.card}>
      <Text style={text.h4}>Before your first fast</Text>
      <Text style={styles.body}>Fasting isn’t for everyone. Talk to your doctor first if you:</Text>
      {[
        'are pregnant or breastfeeding',
        'take insulin or diabetes medicine',
        'have had an eating disorder',
        'are underweight, or have kidney or heart problems',
      ].map((l) => (
        <Text key={l} style={styles.body}>
          •  {l}
        </Text>
      ))}
      <Text style={styles.small}>
        Stop and eat if you feel dizzy, faint or unwell. Hound stops adding Bones past 20 hours and checks in at 36.
      </Text>
      <Text style={styles.small}>Fasting is for people 16 and older.</Text>
    </View>
  );

  // ── The result after ending ──
  const resultCard = result && (
    <View style={{ gap: 12 }}>
      <View style={{ alignItems: 'center' }}>
        <FastRing size={150} hours={result.hours} goal={result.goalHours} done={result.onPlan}>
          <Text style={styles.bigClock}>{clockText(result.hours)}</Text>
          <Text style={[styles.small, { color: result.onPlan ? colors.green : withAlpha(colors.text, 0.6), fontFamily: font.headingSemibold }]}>
            {result.onPlan ? `${planLabel(result.goalHours)} done` : `Goal ${result.goalHours} h`}
          </Text>
        </FastRing>
      </View>
      <View style={styles.statRow}>
        <Stat value={result.bones > 0 ? `+${result.bones}` : '0'} label="Bones" color={colors.amber} />
        <Stat value={`🔥 ${result.streak}`} label="Day streak" />
        <Stat value={<LongestText hours={result.longest} style={styles.statValue} />} label={result.newLongest ? 'New longest!' : 'Longest'} />
      </View>
      {result.bones === 0 && result.hours >= 12 && (
        <Text style={styles.small}>You already earned today’s fasting Bones. They’re once a day.</Text>
      )}
      {!result.onPlan && (
        <Text style={styles.small}>Ended before your {result.goalHours} h goal. It still counts as a fast, just not on plan. No guilt.</Text>
      )}
      {result.milestoneBones > 0 && (
        <View style={[styles.card, { borderWidth: 1.5, borderColor: colors.amber }]}>
          <View style={styles.rowBetween}>
            <Text style={styles.strong}>{result.streak}-day streak</Text>
            <Text style={[styles.strong, { color: colors.amber }]}>+{result.milestoneBones} Bones</Text>
          </View>
        </View>
      )}
      {result.packBones > 0 && (
        <View style={[styles.card, { borderWidth: 1.5, borderColor: colors.green }]}>
          <View style={styles.rowBetween}>
            <Text style={styles.strong}>Everyone in your pack made it</Text>
            <Text style={[styles.strong, { color: colors.amber }]}>+{result.packBones}</Text>
          </View>
        </View>
      )}
      <View style={styles.card}>
        <Text style={styles.label}>BREAKING YOUR FAST</Text>
        <Text style={styles.body}>{BREAK_FAST_TIP}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>HOW DID IT FEEL?</Text>
        <View style={styles.chips}>
          {FEELS.map((f) => (
            <Chip
              key={f.key}
              label={f.label}
              on={feel === f.key}
              onPress={() => {
                setFeel(f.key);
                setFastFeel(result.fastId, f.key).catch(() => {});
                if (f.key === 'unwell') {
                  Alert.alert(
                    'Look after yourself',
                    'Eat something and drink water. If you feel faint, dizzy or very unwell, get medical help. Shorter fasts are just as good a habit.',
                  );
                }
              }}
            />
          ))}
        </View>
      </View>
    </View>
  );

  // ── Starting ──
  const startView = me && me.age === 'ok' && !open && !result && (
    <View style={{ gap: 12 }}>
      {invites.map((inv) => (
        <View key={inv.packId} style={[styles.card, { borderWidth: 1.5, borderColor: colors.accent }]}>
          <View style={styles.row}>
            <PersonAvatar p={inv.from} />
            <Text style={[styles.body, { flex: 1 }]}>
              <Text style={styles.strong}>{inv.from.name}</Text> asked you to fast together
              {inv.joined > 1 ? ` (${inv.joined} in)` : ''}.
            </Text>
          </View>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Button
                label={`Join on ${planLabel(chosenPlan)}`}
                variant="primary"
                block
                small
                disabled={busy}
                onPress={() =>
                  run(async () => {
                    await joinFastPack(inv.packId, chosenPlan, backMin > 0 ? new Date(Date.now() - backMin * 60000) : null);
                    await load();
                    onOpenPack(inv.packId);
                  })
                }
              />
            </View>
            <Button label="Not now" small disabled={busy} onPress={() => run(async () => { await declineFastPack(inv.packId); await load(); })} />
          </View>
        </View>
      ))}
      <View style={styles.card}>
        <Text style={styles.label}>YOUR PLAN</Text>
        <View style={styles.chips}>
          {PLANS.map((p) => (
            <Chip key={p.hours} label={p.label} on={chosenPlan === p.hours} onPress={() => setPlan(p.hours)} />
          ))}
        </View>
        <Text style={styles.small}>
          {PLANS.find((p) => p.hours === chosenPlan)?.note} Done{' '}
          {new Date(Date.now() - backMin * 60000 + chosenPlan * 3600000).toLocaleString([], {
            weekday: 'short',
            hour: 'numeric',
            minute: '2-digit',
          })}
          .
        </Text>
      </View>
      <Pressable style={styles.card} onPress={() => setSheet('start-when')} accessibilityRole="button">
        <View style={styles.rowBetween}>
          <Text style={styles.label}>I STOPPED EATING</Text>
          <Text style={styles.link}>Change</Text>
        </View>
        <Text style={styles.strong}>
          {backMin === 0
            ? `Now, ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
            : `${timeAgo(backMin)}, ${agoLabel(backMin)}`}
        </Text>
      </Pressable>
      <StreakCard m={me} styles={styles} colors={colors} />
    </View>
  );

  // The Hound Fasting club, while you're not in it.
  const clubCard = club && onOpenClub && me?.age === 'ok' && !result && (
    <Pressable style={[styles.card, styles.row]} onPress={() => onOpenClub(club.id)} accessibilityRole="button">
      <ClubBadge sport={club.sport} color={club.color} size={38} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.strong}>Join {club.name}</Text>
        <Text style={styles.small}>
          {club.members} {club.members === 1 ? 'member' : 'members'}
          {club.fastingNow > 0 ? ` · ${club.fastingNow} fasting now` : ''}. Fast with everyone on Hound and see where you rank.
        </Text>
      </View>
      <CaretRightIcon size={14} color={withAlpha(colors.text, 0.4)} />
    </Pressable>
  );

  // ── While fasting ──
  const liveView = me && me.age === 'ok' && open && !result && (
    <View style={{ gap: 12 }}>
      <View style={{ alignItems: 'center', paddingTop: 6 }}>
        <FastDial size={Math.min(winW - 32, 320)} hours={hours} goal={open.goalHours}>
          <View style={styles.dialStage}>
            <StageIcon stageKey={stageAt(hours).key} size={13} color={STAGE_COLOR[stageAt(hours).key]} />
            <Text style={[styles.label, { color: STAGE_COLOR[stageAt(hours).key] }]}>
              {hours >= open.goalHours ? 'GOAL REACHED' : stageAt(hours).name.toUpperCase()}
            </Text>
          </View>
          <Text style={styles.hugeClock}>{clockText(hours)}</Text>
          <Text style={[styles.small, styles.ringLine]}>
            {hours >= open.goalHours ? `${planLabel(open.goalHours)} done` : `${leftText(open.goalHours - hours)} to go`}
          </Text>
          <Text style={[styles.small, styles.ringLine]}>
            {hours >= open.goalHours
              ? 'End it when you eat'
              : `ends ${new Date(new Date(open.startedAt).getTime() + open.goalHours * 3600000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}
          </Text>
        </FastDial>
      </View>
      {hours >= 36 && (
        <View style={[styles.card, { borderWidth: 1.5, borderColor: colors.amber }]}>
          <Text style={styles.strong}>Still fasting? How do you feel?</Text>
          <Text style={styles.body}>
            You’re {Math.floor(hours)} hours in. If you’ve eaten, end it with “I ate at…”. If you feel dizzy, faint or unwell, eat. Fasts this long
            are for a doctor’s care.
          </Text>
        </View>
      )}
      <Pressable style={styles.card} onPress={() => setSheet('stages')} accessibilityRole="button">
        <View style={styles.row}>
          <View style={[styles.stageDot, { backgroundColor: STAGE_COLOR[stageAt(hours).key] }]}>
            <StageIcon stageKey={stageAt(hours).key} size={15} color="#fff" />
          </View>
          <Text style={[styles.strong, { flex: 1 }]}>{stageAt(hours).name}</Text>
          <Text style={styles.small}>
            {stageAt(hours).from}–{stageAt(hours).to === Infinity ? '' : stageAt(hours).to} h ›
          </Text>
        </View>
        <Text style={styles.small}>{stageAt(hours).about}</Text>
        {(() => {
          // What's next, up to your goal: never a stage past it, so
          // nobody's nudged into a longer fast than they planned.
          if (hours >= open.goalHours) return null;
          const nx = nextStage(hours);
          const goalNext = !nx || nx.from >= open.goalHours;
          const atH = goalNext ? open.goalHours : nx!.from;
          const col = goalNext ? colors.green : STAGE_COLOR[nx!.key];
          const at = new Date(new Date(open.startedAt).getTime() + atH * 3600000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          return (
            <View style={[styles.nextUp, { borderColor: withAlpha(col, 0.5), backgroundColor: withAlpha(col, 0.1) }]}>
              {goalNext ? <FlagCheckeredIcon size={16} color={col} weight="fill" /> : <StageIcon stageKey={nx!.key} size={16} color={col} />}
              <Text style={[styles.body, { flex: 1 }]}>
                <Text style={styles.strong}>Next up: {goalNext ? 'your goal' : nx!.name}</Text> in {leftText(atH - hours)}
              </Text>
              <Text style={styles.small}>{at}</Text>
            </View>
          );
        })()}
      </Pressable>
      <View style={styles.actionRow}>
        <ActionButton icon={<CoffeeIcon size={18} color={colors.accentActive} weight="fill" />} label="What to drink" onPress={() => setSheet('drinks')} />
        <ActionButton icon={<ListBulletsIcon size={18} color={colors.accentActive} weight="bold" />} label="Stages" onPress={() => setSheet('stages')} />
        {open.packId ? (
          <ActionButton icon={<UsersThreeIcon size={18} color={colors.accentActive} weight="fill" />} label="Pack fast" onPress={() => onOpenPack(open.packId!)} />
        ) : (
          <ActionButton icon={<UserPlusIcon size={18} color={colors.accentActive} weight="fill" />} label="Invite friends" onPress={() => setSheet('together')} />
        )}
      </View>
      {me.cheers.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.label}>CHEERING YOU ON</Text>
          <View style={styles.row}>
            <View style={{ flexDirection: 'row' }}>
              {me.cheers.slice(0, 6).map((p, i) => (
                <View key={p.id} style={{ marginLeft: i === 0 ? 0 : -8 }}>
                  <PersonAvatar p={p} size={26} />
                </View>
              ))}
            </View>
            <Text style={[styles.small, { flex: 1 }]} numberOfLines={2}>
              {me.cheers.map((p) => p.name).slice(0, 3).join(', ')}
              {me.cheers.length > 3 ? ` and ${me.cheers.length - 3} more` : ''}
            </Text>
          </View>
        </View>
      )}
      <Text style={styles.small}>
        Reaching {Math.min(Math.max(open.goalHours, 12), 20)} h pays {bonesForHours(Math.min(Math.max(open.goalHours, 12), 20), me.config)} Bones
        {me.paidToday ? ' (already earned today)' : ''}.
      </Text>
      {now - new Date(open.startedAt).getTime() < 15 * 60000 && (
        <Pressable
          onPress={() =>
            Alert.alert('Cancel this fast?', 'It goes away as if you never started.', [
              { text: 'Keep it', style: 'cancel' },
              { text: 'Cancel fast', style: 'destructive', onPress: () => run(async () => { await cancelFast(); await load(); }) },
            ])
          }
          accessibilityRole="button"
        >
          <Text style={styles.link}>Started by mistake? Cancel it</Text>
        </Pressable>
      )}
    </View>
  );

  // ── Friends fasting now ──
  const nowList = friends && friends.now.length > 0 && (
    <View style={styles.card}>
      <Text style={styles.label}>FASTING NOW</Text>
      {friends.now.map((f) => {
        const h = hoursSince(f.fast.startedAt, now);
        return (
          <View key={f.id} style={styles.row}>
            <PersonAvatar p={f} />
            <Text style={[styles.body, { flex: 1 }]} numberOfLines={1}>
              <Text style={styles.strong}>{f.name}</Text> · {clockText(h)} of {f.fast.goalHours}
            </Text>
            <Pressable
              disabled={f.cheered || busy}
              onPress={() =>
                run(async () => {
                  await cheerFast(f.fast.id);
                  setFriends((cur) => cur && { ...cur, now: cur.now.map((x) => (x.id === f.id ? { ...x, cheered: true } : x)) });
                })
              }
              style={[styles.cheer, f.cheered && { opacity: 0.5 }]}
              accessibilityRole="button"
              accessibilityLabel={f.cheered ? `Cheered ${f.name}` : `Cheer ${f.name}`}
            >
              <Text style={styles.cheerText}>{f.cheered ? 'Cheered' : 'Cheer'}</Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );

  // ── Your week ──
  const today = new Date(now);
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (6 - i));
    const key = localDayKey(d);
    const day = me?.days.find((x) => x.day === key);
    return { key, d, hours: day?.hours ?? 0, onPlan: day?.onPlan ?? false, rest: (me?.restDays ?? []).includes(isoWeekday(d)) };
  });
  const maxBar = Math.max(24, ...week.map((w) => w.hours));
  const weekView = me && me.age === 'ok' && me.startedAny && (
    <View style={styles.card}>
      <View style={styles.rowBetween}>
        <Text style={styles.label}>LAST 7 DAYS</Text>
        <Text style={styles.small}>goal {me.planHours} h</Text>
      </View>
      <View style={styles.bars}>
        <View style={[styles.goalLine, { bottom: (me.planHours / maxBar) * 84 }]} />
        {week.map((w) => (
          <View key={w.key} style={styles.barCol}>
            <View
              style={[
                styles.bar,
                { height: Math.max(3, (w.hours / maxBar) * 84) },
                w.hours === 0 && w.rest && styles.barRest,
                w.hours > 0 && !w.onPlan && { backgroundColor: withAlpha(colors.accent, 0.4) },
              ]}
            />
          </View>
        ))}
      </View>
      <View style={styles.barLabels}>
        {week.map((w) => (
          <Text key={w.key} style={styles.barLabel}>
            {w.hours === 0 && w.rest ? 'Rest' : w.d.toLocaleDateString([], { weekday: 'narrow' })}
          </Text>
        ))}
      </View>
      <View style={styles.statRow}>
        <Stat value={`🔥 ${me.numbers.streak}`} label="Streak" />
        <Stat value={<LongestText hours={me.numbers.longest} style={styles.statValue} />} label="Longest" />
        <Stat value={`${me.numbers.days30}`} label="On plan, 30 d" />
      </View>
    </View>
  );

  // ── The board ──
  const board = friends && friends.board.length > 1 && (
    <View style={styles.card}>
      <View style={styles.rowBetween}>
        <Text style={styles.label}>THIS WEEK · DAYS ON PLAN</Text>
        <Text style={styles.small}>streak · longest</Text>
      </View>
      {friends.board.map((r, i) => (
        <Pressable
          key={r.id}
          style={styles.row}
          disabled={r.me}
          onPress={() => setSheet({ compare: r.id })}
          accessibilityRole="button"
          accessibilityLabel={r.me ? undefined : `Compare with ${r.name}`}
        >
          <Text style={[styles.rank, { minWidth: 18 }]}>{i + 1}</Text>
          <PersonAvatar p={r} size={26} />
          <Text style={[styles.body, { flex: 1 }, r.me && styles.strong]} numberOfLines={1}>
            {r.me ? 'You' : r.name}
            {r.fasting ? ' ·' : ''}
            {r.fasting && <Text style={{ color: colors.green }}> fasting</Text>}
          </Text>
          <Text style={styles.num}>{r.numbers.weekDays}</Text>
          <Text style={styles.num}>🔥{r.numbers.streak}</Text>
          <LongestText hours={r.numbers.longest} style={styles.num} />
          {!r.me && <CaretRightIcon size={12} color={withAlpha(colors.text, 0.4)} />}
        </Pressable>
      ))}
      <Text style={styles.small}>Ranked by days on plan, then streak. Tap a friend to compare.</Text>
    </View>
  );

  // ── Settings ──
  const settings = me && me.age === 'ok' && (
    <View style={styles.card}>
      <Text style={styles.label}>REST DAYS (UP TO 3)</Text>
      <View style={styles.chips}>
        {WEEKDAYS.map((d) => {
          const on = me.restDays.includes(d.iso);
          return (
            <Chip
              key={d.iso}
              label={d.name.slice(0, 3)}
              on={on}
              onPress={() =>
                run(async () => {
                  const next = on ? me.restDays.filter((x) => x !== d.iso) : [...me.restDays, d.iso];
                  if (next.length > 3) throw new Error('Pick up to 3 rest days.');
                  await saveFastingSettings({ restDays: next });
                  setMe({ ...me, restDays: next });
                })
              }
            />
          );
        })}
      </View>
      <Text style={styles.small}>Rest days don’t break your streak, and neither does one missed day a week.</Text>
      <View style={[styles.rowBetween, { marginTop: 6 }]}>
        <Text style={[styles.body, { flex: 1 }]}>Friends and clubmates see when I’m fasting</Text>
        <Switch
          value={me.share}
          onValueChange={(v) =>
            run(async () => {
              await saveFastingSettings({ share: v });
              setMe({ ...me, share: v });
            })
          }
        />
      </View>
    </View>
  );

  // ── Pinned action ──
  let pinned: React.ReactNode = null;
  if (me && me.age === null) {
    pinned = (
      <View style={{ gap: 8 }}>
        <Button label="I’m 16 or older" variant="primary" block disabled={busy} onPress={() => run(async () => { await setFastingAge(true); await load(); })} />
        <Button
          label="I’m under 16"
          block
          disabled={busy}
          onPress={() =>
            Alert.alert('Under 16?', 'Fasting will stay hidden on this account.', [
              { text: 'Go back', style: 'cancel' },
              { text: 'I’m under 16', onPress: () => run(async () => { await setFastingAge(false); onBack(); }) },
            ])
          }
        />
      </View>
    );
  } else if (result) {
    pinned = <Button label="Done" variant="primary" block onPress={() => setResult(null)} />;
  } else if (me && me.age === 'ok' && open) {
    pinned = (
      <Button
        label={busy ? 'Ending…' : 'End fast'}
        block
        disabled={busy}
        onPress={() => {
          setEndMin(0);
          setSheet('end');
        }}
      />
    );
  } else if (me && me.age === 'ok') {
    pinned = (
      <View style={{ gap: 8 }}>
        <Button
          label={busy ? 'Starting…' : backMin > 0 ? `Start fast from ${timeAgo(backMin)}` : 'Start fast'}
          variant="primary"
          block
          disabled={busy}
          onPress={() => begin([])}
        />
        <Button label="Start together…" block disabled={busy} onPress={() => setSheet('together')} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.top}>
        <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <ArrowLeftIcon size={20} color={colors.accentActive} />
        </Pressable>
        <Text style={[text.h4, { flex: 1, textAlign: 'center' }]}>Fasting</Text>
        <Text style={[styles.small, { minWidth: 20, textAlign: 'right' }]}>{open ? planLabel(open.goalHours) : ''}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.body0}>
        {!me && !error && <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />}
        {error && <Text style={styles.small}>{error}</Text>}
        {me && me.age === null && gate}
        {me && me.age === 'under' && <Text style={styles.body}>Fasting is for people 16 and older.</Text>}
        {resultCard}
        {startView}
        {liveView}
        {me?.age === 'ok' && !result && nowList}
        {clubCard}
        {!result && weekView}
        {!result && board}
        {!result && !open && settings}
        {me?.age === 'ok' && !result && (
          <Pressable onPress={() => setSheet('drinks')} accessibilityRole="button">
            <Text style={styles.link}>What can I drink while fasting? ›</Text>
          </Pressable>
        )}
      </ScrollView>
      {pinned && <View style={styles.pinned}>{pinned}</View>}

      {sheet === 'drinks' && (
        <TileSheet title="What can I drink?" onClose={() => setSheet(null)}>
          <DrinkList title="Yes" color={colors.green} items={DRINKS.yes} styles={styles} />
          <DrinkList title="Your call" color={colors.amber} items={DRINKS.maybe} styles={styles} />
          <DrinkList title="Breaks your fast" color="#e06c6c" items={DRINKS.no} styles={styles} />
        </TileSheet>
      )}
      {sheet === 'stages' && (
        <TileSheet title="The stages of a fast" onClose={() => setSheet(null)}>
          <Text style={styles.small}>Typical times. They move a lot with what you ate before and how active you are.</Text>
          {STAGES.map((s) => (
            <View key={s.key} style={[styles.stageRow, open && hours >= s.from && { opacity: 1 }]}>
              <Text style={styles.stageHours}>
                {s.from}–{s.to === Infinity ? '' : s.to} h
              </Text>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.strong}>
                  {s.name}
                  {open && hours >= s.from && hours < s.to ? '  ← you' : ''}
                </Text>
                <Text style={styles.small}>{s.about}</Text>
                <Text style={[styles.evidence, s.evidence === 'supervised' && { color: '#e06c6c' }]}>{EVIDENCE_WORD[s.evidence]}</Text>
              </View>
            </View>
          ))}
          <Text style={styles.small}>
            Trials find a daily eating window helps about as much as counting calories. Longer fasts aren’t proven better, so Hound rewards
            coming back, not going long.
          </Text>
        </TileSheet>
      )}
      {sheet === 'start-when' && (
        <TileSheet title="When did you stop eating?" onClose={() => setSheet(null)}>
          <TimeBack minutes={backMin} max={MAX_BACK_MIN} onChange={setBackMin} />
          <Text style={styles.small}>Your fast counts from then, up to 12 hours back.</Text>
          <Button label={backMin === 0 ? 'Start from now' : `Start from ${timeAgo(backMin)}`} variant="primary" block onPress={() => setSheet(null)} />
        </TileSheet>
      )}
      {sheet === 'end' && open && (
        <TileSheet title="End your fast" onClose={() => setSheet(null)}>
          <Text style={styles.body}>
            {clockText(hours)} so far{hours < open.goalHours ? `, ${leftText(open.goalHours - hours)} short of your goal` : ''}. When did you eat?
          </Text>
          <TimeBack
            minutes={endMin}
            max={Math.max(0, Math.min(MAX_BACK_MIN, Math.floor((Date.now() - new Date(open.startedAt).getTime()) / 60000) - 1))}
            onChange={setEndMin}
            nowLabel="Eating now"
          />
          <Button
            label={busy ? 'Ending…' : endMin === 0 ? 'End fast now' : `End fast at ${timeAgo(endMin)}`}
            variant="primary"
            block
            disabled={busy}
            onPress={() => finish(endMin)}
          />
        </TileSheet>
      )}
      {sheet === 'together' && (
        <TileSheet title={open ? 'Invite friends' : 'Fast together'} onClose={() => setSheet(null)}>
          <Text style={styles.small}>
            Each of you fasts your own plan. When everyone who joins ends on plan, you all get {me?.config.packBonus ?? 10} Bones.
          </Text>
          {allFriends === null ? (
            <ActivityIndicator color={colors.accent} />
          ) : allFriends.length === 0 ? (
            <Text style={styles.small}>Add friends to fast together.</Text>
          ) : (
            <FriendPickList
              items={allFriends}
              pickedIds={picked}
              onUnpick={(id) => setPicked((p) => p.filter((x) => x !== id))}
              renderItem={(f) => {
                const on = picked.includes(f.userId);
                return (
                  <Pressable
                    style={styles.row}
                    onPress={() => setPicked((p) => (on ? p.filter((x) => x !== f.userId) : p.length >= 10 ? p : [...p, f.userId]))}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                  >
                    {on ? <CheckSquareIcon size={22} color={colors.accentActive} weight="fill" /> : <SquareIcon size={22} color={withAlpha(colors.text, 0.4)} />}
                    <Avatar initials={f.initials} tint={colors.accent800} size={32} fontSize={12} frameId={f.frameId} backgroundId={f.backgroundId} iconId={f.iconId} />
                    <Text style={[styles.body, { flex: 1 }]} numberOfLines={1}>
                      {f.name}
                    </Text>
                  </Pressable>
                );
              }}
            />
          )}
          {!open && (
            <Button
              label={picked.length ? `Start and invite ${picked.length}` : 'Pick friends to invite'}
              variant="primary"
              block
              disabled={busy || picked.length === 0}
              onPress={() => begin(picked)}
            />
          )}
          {open && (
            <Text style={styles.small}>
              To fast together, start your next fast with “Start together…”. Tonight’s is already going on its own.
            </Text>
          )}
        </TileSheet>
      )}
      {sheet && typeof sheet === 'object' && 'compare' in sheet && (
        <TileSheet title={compare ? `You and ${compare.them.name}` : 'Compare'} onClose={() => setSheet(null)}>
          {!compare ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <View style={{ gap: 10 }}>
              <Text style={styles.small}>The last 30 days.</Text>
              <CompareRow label="Days on plan" a={`${compare.me.days30}`} b={`${compare.them.numbers.days30}`} styles={styles} />
              <CompareRow label="Average fast" a={clockText(compare.me.avg30)} b={clockText(compare.them.numbers.avg30)} styles={styles} />
              <CompareRow label="Streak now" a={`${compare.me.streak}`} b={`${compare.them.numbers.streak}`} styles={styles} />
              <CompareRow label="Best streak" a={`${compare.me.bestStreak}`} b={`${compare.them.numbers.bestStreak}`} styles={styles} />
              <View style={styles.rowBetween}>
                <Text style={[styles.small, { flex: 1 }]}>Longest</Text>
                <LongestText hours={compare.me.longest} style={styles.num} />
                <Text style={styles.small}>  ·  </Text>
                <LongestText hours={compare.them.numbers.longest} style={styles.num} />
              </View>
              <CompareRow label="Pack fasts together" a={`${compare.together}`} b="" styles={styles} />
            </View>
          )}
        </TileSheet>
      )}
    </SafeAreaView>
  );
}

function StreakCard({ m, styles, colors }: { m: MyFasting; styles: ReturnType<typeof makeStyles>; colors: Palette }) {
  const next = nextStreakBonus(m.numbers.streak, m.config);
  return (
    <View style={styles.card}>
      <View style={styles.rowBetween}>
        <Text style={styles.strong}>{m.numbers.streak > 0 ? `Streak ${m.numbers.streak} ${m.numbers.streak === 1 ? 'day' : 'days'}` : 'Start a streak'}</Text>
        <Text style={[styles.small, { color: colors.amber, fontFamily: font.headingSemibold }]}>
          {m.paidToday ? 'Today’s Bones earned' : `+${bonesForHours(Math.min(Math.max(m.planHours, 12), 20), m.config)} Bones at ${m.planHours} h`}
        </Text>
      </View>
      {next && (
        <>
          <View style={styles.track}>
            <View style={[styles.trackFill, { width: `${Math.min(100, (m.numbers.streak / next.at) * 100)}%` }]} />
          </View>
          <Text style={styles.small}>
            {next.at - m.numbers.streak} more {next.at - m.numbers.streak === 1 ? 'day' : 'days'} on plan for the {next.at}-day bonus ({next.bones} Bones).
          </Text>
        </>
      )}
    </View>
  );
}

// A time some minutes back: the clock time with − and + in 15-minute
// steps, and quick picks (only those within `max`).
function TimeBack({ minutes, max, onChange, nowLabel = 'Now' }: { minutes: number; max: number; onChange: (m: number) => void; nowLabel?: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const clamp = (m: number) => Math.max(0, Math.min(max, m));
  const step = (d: number) => onChange(clamp(minutes === 0 && d > 0 ? 15 : Math.round((minutes + d) / 15) * 15));
  return (
    <View style={{ gap: 10 }}>
      <View style={styles.timeRow}>
        <Pressable
          onPress={() => step(15)}
          disabled={minutes >= max}
          style={[styles.stepBtn, minutes >= max && { opacity: 0.35 }]}
          accessibilityRole="button"
          accessibilityLabel="15 minutes earlier"
        >
          <Text style={styles.stepText}>−15</Text>
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={styles.timeBig}>{timeAgo(minutes)}</Text>
          <Text style={styles.small}>{minutes === 0 ? nowLabel : agoLabel(minutes)}</Text>
        </View>
        <Pressable
          onPress={() => step(-15)}
          disabled={minutes <= 0}
          style={[styles.stepBtn, minutes <= 0 && { opacity: 0.35 }]}
          accessibilityRole="button"
          accessibilityLabel="15 minutes later"
        >
          <Text style={styles.stepText}>+15</Text>
        </Pressable>
      </View>
      <View style={styles.chips}>
        {QUICK_BACK.filter((m) => m <= max).map((m) => (
          <Chip key={m} label={m === 0 ? nowLabel : agoLabel(m)} on={minutes === m} onPress={() => onChange(m)} />
        ))}
      </View>
    </View>
  );
}

function Stat({ value, label, color }: { value: React.ReactNode; label: string; color?: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.stat}>
      {typeof value === 'string' ? <Text style={[styles.statValue, color ? { color } : null]}>{value}</Text> : value}
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ActionButton({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.action, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={label}>
      {icon}
      <Text style={styles.actionText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
        {label}
      </Text>
    </Pressable>
  );
}

function Chip({ label, on, onPress }: { label: string; on?: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: !!on }}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

function DrinkList({
  title,
  color,
  items,
  styles,
}: {
  title: string;
  color: string;
  items: { name: string; note: string }[];
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={{ gap: 6 }}>
      <View style={styles.row}>
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
        <Text style={styles.strong}>{title}</Text>
      </View>
      {items.map((d) => (
        <View key={d.name} style={{ paddingLeft: 18 }}>
          <Text style={styles.body}>{d.name}</Text>
          {!!d.note && <Text style={styles.small}>{d.note}</Text>}
        </View>
      ))}
    </View>
  );
}

function CompareRow({ label, a, b, styles }: { label: string; a: string; b: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.rowBetween}>
      <Text style={[styles.small, { flex: 1 }]}>{label}</Text>
      <Text style={styles.num}>{a}</Text>
      {b !== '' && (
        <>
          <Text style={styles.small}>  ·  </Text>
          <Text style={styles.num}>{b}</Text>
        </>
      )}
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, gap: 12 },
    body0: { padding: 16, gap: 12, paddingBottom: 32 },
    pinned: {
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: withAlpha(colors.text, 0.12),
      backgroundColor: colors.bg,
    },
    card: { borderRadius: 16, backgroundColor: colors.surface, padding: 12, gap: 8 },
    label: { fontSize: 11, letterSpacing: 0.7, color: withAlpha(colors.text, 0.55), fontFamily: font.headingSemibold },
    body: { fontSize: 14.5, lineHeight: 20, color: colors.text, fontFamily: font.body },
    small: { fontSize: 12.5, lineHeight: 17, color: withAlpha(colors.text, 0.62), fontFamily: font.body },
    strong: { fontSize: 14.5, color: colors.text, fontFamily: font.headingSemibold },
    link: { fontSize: 13.5, color: colors.accentActive, fontFamily: font.headingSemibold },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 34 },
    rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: { borderWidth: 1, borderColor: withAlpha(colors.text, 0.18), borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
    chipOn: { backgroundColor: withAlpha(colors.accent, 0.22), borderColor: colors.accent },
    chipText: { fontSize: 13, color: colors.text, fontFamily: font.headingSemibold },
    chipTextOn: { color: colors.accentActive },
    ringLine: { textAlign: 'center', maxWidth: 160 },
    dialStage: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    stageDot: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
    nextUp: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, marginTop: 2 },
    actionRow: { flexDirection: 'row', gap: 8 },
    action: {
      flex: 1,
      alignItems: 'center',
      gap: 4,
      paddingVertical: 10,
      paddingHorizontal: 4,
      borderRadius: 14,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: withAlpha(colors.text, 0.08),
    },
    actionText: { fontSize: 12.5, color: colors.text, fontFamily: font.headingSemibold },
    timeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    timeBig: { fontSize: 30, color: colors.text, fontFamily: font.heading, fontVariant: ['tabular-nums'] },
    stepBtn: { width: 56, height: 44, borderRadius: 12, borderWidth: 1, borderColor: withAlpha(colors.text, 0.18), alignItems: 'center', justifyContent: 'center' },
    stepText: { fontSize: 15, color: colors.accentActive, fontFamily: font.headingSemibold },
    hugeClock: { fontSize: 38, color: colors.text, fontFamily: font.heading, fontVariant: ['tabular-nums'] },
    bigClock: { fontSize: 28, color: colors.text, fontFamily: font.heading, fontVariant: ['tabular-nums'] },
    statRow: { flexDirection: 'row', gap: 8 },
    stat: { flex: 1, borderRadius: 12, backgroundColor: withAlpha(colors.text, 0.05), padding: 10, gap: 2 },
    statValue: { fontSize: 19, color: colors.text, fontFamily: font.heading, fontVariant: ['tabular-nums'] },
    statLabel: { fontSize: 11, color: withAlpha(colors.text, 0.58), fontFamily: font.body },
    track: { height: 7, borderRadius: 4, backgroundColor: withAlpha(colors.text, 0.12), overflow: 'hidden' },
    trackFill: { height: 7, borderRadius: 4, backgroundColor: colors.accent },
    cheer: { borderWidth: 1, borderColor: withAlpha(colors.accent, 0.6), borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
    cheerText: { fontSize: 12, color: colors.accentActive, fontFamily: font.headingSemibold },
    bars: { height: 88, flexDirection: 'row', alignItems: 'flex-end', gap: 6, position: 'relative' },
    barCol: { flex: 1, justifyContent: 'flex-end', height: 88 },
    bar: { borderTopLeftRadius: 4, borderTopRightRadius: 4, borderBottomLeftRadius: 2, borderBottomRightRadius: 2, backgroundColor: colors.accent },
    barRest: { backgroundColor: withAlpha(colors.text, 0.12), height: 84 },
    goalLine: { position: 'absolute', left: 0, right: 0, borderTopWidth: 1.5, borderStyle: 'dashed', borderTopColor: colors.amber },
    barLabels: { flexDirection: 'row', gap: 6 },
    barLabel: { flex: 1, textAlign: 'center', fontSize: 10, color: withAlpha(colors.text, 0.55), fontFamily: font.body },
    rank: { fontSize: 12.5, color: withAlpha(colors.text, 0.6), fontFamily: font.headingSemibold, fontVariant: ['tabular-nums'] },
    num: { fontSize: 13, color: colors.text, fontFamily: font.headingSemibold, fontVariant: ['tabular-nums'], minWidth: 28, textAlign: 'right' },
    stageRow: { flexDirection: 'row', gap: 10, paddingVertical: 6 },
    stageHours: { width: 54, fontSize: 13, color: colors.text, fontFamily: font.headingSemibold, fontVariant: ['tabular-nums'] },
    evidence: { fontSize: 11, color: colors.amber, fontFamily: font.headingSemibold },
  });
}
