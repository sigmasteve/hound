import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Rect, Text as SvgText } from 'react-native-svg';
import { PlayIcon } from 'phosphor-react-native';
import { Text } from './Text';
import { Card } from './Card';
import { usePinnedAction } from './PinnedAction';
import { BoutReplayView } from './BoutCard';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { GUARDS, punchName, setGuard, type BoutGuard, type BoutLive } from '../challenges/boutApi';
import { getTitleReplay, pickChampion, type TitleBout, type TitleTape } from '../challenges/titleBoutApi';

// The Title Bout (0227) on its challenge page, as mocked up (Main, Tape,
// Belt): the champion once there is one; in the title fight's days, the
// tale of the tape and your free pick (the fans' split shown); today's
// fight (who you're matched with, last night's result and its replay);
// your guard; the ladder with the belt line under #2; and the action
// pinned to the bottom (Slip N incoming, Throw your punches, or Pick your
// champion).

const ME_COLOR = '#ffd8b0';
const GOLD = '#f0c24a';
const A_COLOR = '#c2410c';
const B_COLOR = '#4f7be0';

const first = (name: string) => name.split(' ')[0];
const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${s}`;
};
const record = (w: number, l: number, d: number) => `${w}–${l}${d > 0 ? `–${d}` : ''}`;

// The belt, small: the ladder's cut line and the champion banner.
export function TitleBeltBadge({ size = 22 }: { size?: number }) {
  return (
    <Svg width={size * 1.5} height={size} viewBox="0 0 36 24">
      <Rect x={1} y={5} width={34} height={14} rx={4} fill={GOLD} stroke="#c98f12" strokeWidth={1.2} />
      <Circle cx={6} cy={12} r={2.2} fill="#e05b5b" />
      <Circle cx={30} cy={12} r={2.2} fill={B_COLOR} />
      <Circle cx={18} cy={12} r={7} fill="#fff3c4" stroke="#c98f12" strokeWidth={1.5} />
      <SvgText x={18} y={15} fontSize={8} fontWeight="800" fill="#7a5a0a" textAnchor="middle">
        H
      </SvgText>
    </Svg>
  );
}

export function TitleBoutCard({
  challengeId,
  name,
  live,
  tb,
  currency,
  onRing,
  onChanged,
}: {
  challengeId: string;
  name: string;
  live: BoutLive | null;
  tb: TitleBout | null;
  currency: string;
  onRing: (mode: 'throw' | 'slip') => void;
  onChanged: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [guard, setGuardState] = useState<BoutGuard | null>(null);
  const [replay, setReplay] = useState<{ fightId: number; label: string; meName: string; oppName: string } | null>(null);
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    if (live) setGuardState(live.guard);
  }, [live]);

  const t = tb?.title ?? null;
  const k = tb?.picks ?? null;
  const pickable = !!t && !!k && k.open;
  const doPick = (userId: string) => {
    if (!pickable || picking) return;
    setPicking(true);
    pickChampion(challengeId, userId)
      .then(onChanged)
      .catch((e) => Alert.alert('Title Bout', e instanceof Error ? e.message : 'Try again.'))
      .finally(() => setPicking(false));
  };

  const fighting = !!live && !!tb && live.status === 'active' && !!tb.fight;
  const incoming = live?.incoming.length ?? 0;
  const pinned = usePinnedAction(
    fighting && live && live.canAct
      ? incoming > 0
        ? { label: `Slip ${incoming} incoming`, onPress: () => onRing('slip') }
        : live.day.left > 0
          ? { label: `${tb?.fight?.title ? 'Fight for the belt' : 'Throw your punches'} · ${live.day.left} ${live.day.left === 1 ? 'action' : 'actions'}`, onPress: () => onRing('throw') }
          : null
      : pickable && t && !k?.mine
        ? {
            label: 'Pick your champion',
            onPress: () =>
              Alert.alert('Who takes the belt?', 'Free to pick. Check the tale of the tape first.', [
                { text: first(t.a.name), onPress: () => doPick(t.a.id) },
                { text: first(t.b.name), onPress: () => doPick(t.b.id) },
                { text: 'Not yet', style: 'cancel' },
              ]),
          }
        : null,
  );

  if (!live || !tb) {
    return (
      <Card elevated={false}>
        <ActivityIndicator color={colors.accent} />
      </Card>
    );
  }

  const apron = tb.sponsor?.name ?? 'Title Bout';
  const opp = live.opponent ? (live.opponent.id ? first(live.opponent.name) : 'The sparring hound') : null;
  const titleDay = tb.phase === 'upcoming' || tb.phase === 'ladder';
  const pickGuard = (g: BoutGuard) => {
    setGuardState(g);
    setGuard(challengeId, g, 'titlebout')
      .then(onChanged)
      .catch(() => setGuardState(live.guard));
  };
  const lf = tb.lastFight;
  const lastLine = lf
    ? lf.draw
      ? `Last fight: a draw with ${lf.opp}, ${lf.mine}–${lf.theirs}: +1 on the ladder.`
      : lf.won
        ? `Last fight: you beat ${lf.opp} ${lf.ko ? 'by KO' : `on points, ${lf.mine}–${lf.theirs}`}: +${lf.ko ? 3 : 2} on the ladder.`
        : `Last fight: ${lf.opp} beat you ${lf.ko ? 'by KO' : `on points, ${lf.theirs}–${lf.mine}`}.`
    : null;

  return (
    <View style={{ gap: 12 }}>
      <View style={{ gap: 2 }}>
        <Text style={styles.kicker}>
          GLOBAL HOUND CHALLENGE · {tb.phase === 'final' ? 'FINAL' : tb.dayNo < 1 ? 'STARTS SOON' : `DAY ${tb.dayNo} OF ${tb.days}`}
        </Text>
        <Text style={styles.title}>{name}</Text>
        <Text style={styles.small}>
          {tb.field.toLocaleString()} fighting ·{' '}
          {titleDay ? 'the top 2 after day 5 fight for the belt on days 6 and 7' : t?.winner ? 'the belt has a new owner' : 'the title fight is on'}
        </Text>
      </View>

      {t?.winner && (
        <Card style={styles.champ} elevated={false}>
          <TitleBeltBadge size={30} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[styles.cardTitle, { color: GOLD }]}>
              {t.winner === live.me ? 'You’re the champion!' : `${first(t.winner === t.a.id ? t.a.name : t.b.name)} is the champion`}
            </Text>
            <Text style={styles.body}>
              {t.method === 'ko'
                ? `By KO in round ${t.koRound}`
                : t.method === 'draw'
                  ? 'Level on the cards: the higher seed keeps it'
                  : 'On the cards'}
              {t.winner === live.me ? '. The belt is in your Kennel, and your hound’s wearing it.' : '. Their hound wears the belt.'}
              {tb.sponsor ? ` Presented by ${tb.sponsor.name}.` : ''}
            </Text>
          </View>
        </Card>
      )}

      {t && (
        <Card style={{ gap: 4 }} elevated={false}>
          <Text style={[styles.kicker, { color: GOLD }]}>THE TITLE FIGHT · 2 ROUNDS</Text>
          <View style={styles.tapeRow}>
            <TapeHead tape={t.a} tint={A_COLOR} gold styles={styles} />
            <Text style={[styles.tapeLabel, { fontFamily: font.headingSemibold, letterSpacing: 0.8 }]}>TALE OF THE TAPE</Text>
            <TapeHead tape={t.b} tint={B_COLOR} styles={styles} />
          </View>
          {tapeRows(t.a, t.b).map((r) => (
            <View key={r.label} style={[styles.tapeRow, styles.tapeLine]}>
              <Text style={[styles.tapeVal, r.better === 'a' && styles.tapeBetter]}>{r.a}</Text>
              <Text style={styles.tapeLabel}>{r.label}</Text>
              <Text style={[styles.tapeVal, { textAlign: 'right' }, r.better === 'b' && styles.tapeBetter]}>{r.b}</Text>
            </View>
          ))}
          {t.rounds.some((r) => r.scored) && (
            <View style={[styles.tapeLine, { paddingTop: 8, gap: 6 }]}>
              {t.rounds
                .filter((r) => r.scored)
                .map((r) => (
                  <Pressable
                    key={r.round}
                    style={styles.rowBetween}
                    onPress={() =>
                      setReplay(
                        replay?.fightId === r.fightId
                          ? null
                          : {
                              fightId: r.fightId,
                              label: `Title fight, round ${r.round}`,
                              // Seen from your corner if it's your fight, else from the first seed's.
                              meName: t.mine ? 'You' : first(t.a.name),
                              oppName: first(t.mine && live.me === t.b.id ? t.a.name : t.b.name),
                            },
                      )
                    }
                    accessibilityRole="button"
                  >
                    <Text style={styles.body}>
                      Round {r.round}: {first(t.a.name)} {r.a ?? '–'} – {r.b ?? '–'} {first(t.b.name)}
                      {(r.aDown ?? 0) + (r.bDown ?? 0) > 0 ? ` · ${(r.aDown ?? 0) + (r.bDown ?? 0)} down` : ''}
                    </Text>
                    <View style={styles.replayBtn}>
                      <PlayIcon size={13} color={colors.accentActive} weight="fill" />
                      <Text style={styles.link}>{replay?.fightId === r.fightId ? 'Hide' : 'Replay'}</Text>
                    </View>
                  </Pressable>
                ))}
            </View>
          )}
        </Card>
      )}

      {t && k && (
        <Card style={{ gap: 10 }} elevated={false}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>Who takes the belt?</Text>
            <Text style={styles.small}>{k.open || (t.mine && !t.winner) ? 'Free · closes after round 1' : 'Picks are closed'}</Text>
          </View>
          <FansBar a={k.a} b={k.b} aName={first(t.a.name)} bName={first(t.b.name)} styles={styles} />
          {t.mine ? (
            <Text style={styles.body}>You’re in the title fight: no picks for you. Win it.</Text>
          ) : (
            <>
              {k.open && (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {[t.a, t.b].map((s, i) => {
                    const on = k.mine === s.id;
                    const tint = i === 0 ? A_COLOR : B_COLOR;
                    return (
                      <Pressable
                        key={s.id}
                        onPress={() => doPick(s.id)}
                        disabled={picking}
                        style={[styles.pickBtn, on && { borderColor: tint, backgroundColor: withAlpha(tint, 0.22) }]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                      >
                        <Text style={styles.pickText}>{first(s.name)}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
              <Text style={styles.body}>
                {t.winner && k.mine
                  ? k.correct === true || (k.correct == null && k.mine === t.winner)
                    ? `You picked the champion${k.wonBones > 0 ? `: +${k.wonBones} ${currency}` : `: your ${currency} come when the Title Bout ends`}.`
                    : 'Your pick didn’t take the belt.'
                  : k.mine
                    ? `You picked ${first(k.mine === t.a.id ? t.a.name : t.b.name)}.${k.open ? ' Change it any time before round 1 is scored.' : ''}`
                    : k.open
                      ? `Free to pick. Right: ${k.reward} ${currency}; right on the underdog (the one fewer picked): ${k.reward * 2}.`
                      : 'You didn’t pick this time.'}
              </Text>
            </>
          )}
        </Card>
      )}

      {tb.joined && tb.fight && live.status === 'active' && (
        <Card style={{ gap: 10 }} elevated={false}>
          <View style={styles.rowBetween}>
            <Text style={[styles.kicker, { color: tb.fight.title ? GOLD : '#a6e3b8', flexShrink: 1 }]} numberOfLines={1}>
              {tb.fight.title ? `FOR THE BELT · ROUND ${tb.fight.round} OF 2` : `TODAY’S FIGHT${live.titleBout?.opponentIsBot ? ' · SPARRING' : ' · ONE ROUND'}`}
            </Text>
            <Text style={styles.small}>scored tomorrow</Text>
          </View>
          <View style={styles.vsRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.vsName, { color: ME_COLOR }]}>You</Text>
              <Text style={styles.small}>{tb.me ? `#${tb.me.pos} · ${tb.me.pts} pts · ${record(tb.me.wins, tb.me.losses, tb.me.draws)}` : ''}</Text>
            </View>
            <Text style={styles.vsScore} accessibilityLabel={`Today so far: you ${live.tally.mine}, ${opp} ${live.tally.theirs}`}>
              {live.tally.mine}–{live.tally.theirs}
            </Text>
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              <Text style={styles.vsName} numberOfLines={1}>
                {opp ?? 'No opponent'}
              </Text>
              <Text style={styles.small}>
                {tb.fight.oppPos != null ? `#${tb.fight.oppPos} · ${tb.fight.oppPts ?? 0} pts` : live.titleBout?.opponentIsBot ? 'off the ladder' : ''}
              </Text>
            </View>
          </View>
          {lastLine && (
            <View style={styles.rowBetween}>
              <Text style={[styles.body, { flex: 1 }]}>{lastLine}</Text>
              {lf && (
                <Pressable
                  onPress={() => setReplay(replay?.fightId === lf.id ? null : { fightId: lf.id, label: lf.title ? 'Title fight' : 'Last fight', meName: 'You', oppName: first(lf.opp) })}
                  hitSlop={8}
                  accessibilityRole="button"
                  style={styles.replayBtn}
                >
                  <PlayIcon size={13} color={colors.accentActive} weight="fill" />
                  <Text style={styles.link}>{replay?.fightId === lf.id ? 'Hide' : 'Replay'}</Text>
                </Pressable>
              )}
            </View>
          )}
          {!lastLine && <Text style={styles.body}>Every 1,000 steps is an action: throw a punch or slip one of theirs.</Text>}
        </Card>
      )}

      {replay && (
        <BoutReplayView
          challengeId={challengeId}
          round={1}
          label={replay.label}
          meName={replay.meName}
          oppName={replay.oppName}
          apron={apron}
          load={() => getTitleReplay(challengeId, replay.fightId)}
        />
      )}

      {fighting && (
        <Card style={{ gap: 10 }} elevated={false}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>Your guard today</Text>
            <Text style={styles.small}>{opp ?? 'They'} can’t see it</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {GUARDS.map((g) => {
              const on = guard === g.id;
              return (
                <Pressable key={g.id} onPress={() => pickGuard(g.id)} style={[styles.guard, on && styles.guardOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
                  <Text style={[styles.guardText, on && { color: ME_COLOR }]}>{g.name}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.body}>{GUARDS.find((g) => g.id === guard)?.line} It stays up until you change it.</Text>
        </Card>
      )}

      <Card style={{ gap: 0, paddingVertical: 4 }} elevated={false}>
        <View style={[styles.ladderRow, { minHeight: 32 }]}>
          <Text style={[styles.lPos, styles.head]}>#</Text>
          <Text style={[styles.lName, styles.head]}>HOUND</Text>
          <Text style={[styles.lRec, styles.head]}>W-L-D</Text>
          <Text style={[styles.lKo, styles.head]}>KO</Text>
          <Text style={[styles.lPts, styles.head]}>PTS</Text>
        </View>
        {tb.ladder.length === 0 && <Text style={[styles.small, { paddingVertical: 8 }]}>Nobody on the ladder yet.</Text>}
        {tb.ladder.map((r, i) => {
          // You, below the top 25: a gap before your row.
          const gap = i > 0 && r.isMe && r.pos > tb.ladder[i - 1].pos + 1;
          return (
            <React.Fragment key={r.userId}>
              {gap && <Text style={[styles.small, { textAlign: 'center' }]}>⋯</Text>}
              <View style={[styles.ladderRow, styles.tapeLine, r.isMe && styles.meRow]}>
                <Text style={[styles.lPos, { color: withAlpha(colors.text, 0.6) }]}>{r.pos}</Text>
                <View style={[styles.lName, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
                  <Text style={[styles.lNameText, r.isMe && { color: ME_COLOR }]} numberOfLines={1}>
                    {r.isMe ? 'You' : r.name}
                  </Text>
                  {(r.title || (t?.winner && t.winner === r.userId)) && <TitleBeltBadge size={12} />}
                </View>
                <Text style={styles.lRec}>{record(r.wins, r.losses, r.draws)}</Text>
                <Text style={styles.lKo}>{r.kos}</Text>
                <Text style={[styles.lPts, { fontFamily: font.headingSemibold }]}>{r.pts}</Text>
              </View>
              {titleDay && i === 1 && tb.ladder.length > 2 && (
                <View style={styles.cut}>
                  <TitleBeltBadge size={12} />
                  <View style={styles.cutLine} />
                  <Text style={styles.cutText}>THE TOP 2 FIGHT FOR THE BELT</Text>
                  <View style={styles.cutLine} />
                </View>
              )}
            </React.Fragment>
          );
        })}
        <Text style={[styles.small, styles.tapeLine, { paddingVertical: 8 }]}>
          A KO win 3 · a win on points 2 · a draw 1. Ties go to knockdowns, then points landed.
        </Text>
      </Card>

      {fighting && !pinned && (
        <View style={{ gap: 8 }}>
          {incoming > 0 && (
            <Pressable onPress={() => onRing('slip')} style={[styles.play, { backgroundColor: '#f08a24' }]} accessibilityRole="button">
              <Text style={styles.playText}>Slip {incoming} incoming</Text>
            </Pressable>
          )}
          <Pressable onPress={() => onRing('throw')} disabled={!live.canAct} style={[styles.play, !live.canAct && styles.playOff]} accessibilityRole="button">
            <Text style={[styles.playText, !live.canAct && { color: withAlpha(colors.text, 0.6), fontSize: 13.5 }]}>
              {live.canAct ? `Throw your punches · ${live.day.left} ${live.day.left === 1 ? 'action' : 'actions'}` : (live.reason ?? 'Not now')}
            </Text>
          </Pressable>
        </View>
      )}
      {fighting && (
        <Text style={styles.small}>
          {live.day.steps.toLocaleString()} steps today · {live.day.earned} actions · {live.day.used} used
          {live.day.nextAt != null ? ` · next at ${live.day.nextAt.toLocaleString()}` : ''}
          {live.day.strength ? ` · power: ${live.day.kdNeeds} for a knockdown` : ''}
          {live.day.camp ? ' · fight camp: a wider green' : ''}
        </Text>
      )}
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function TapeHead({ tape, tint, gold, styles }: { tape: TitleTape; tint: string; gold?: boolean; styles: Styles }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 4 }}>
      <View style={[styles.tapeAvatar, { backgroundColor: tint, borderColor: gold ? GOLD : '#c4c8d6' }]}>
        <Text style={styles.tapeInitials}>{tape.initials}</Text>
      </View>
      <Text style={styles.cardTitle} numberOfLines={1}>
        {first(tape.name)}
      </Text>
    </View>
  );
}

function FansBar({ a, b, aName, bName, styles }: { a: number; b: number; aName: string; bName: string; styles: Styles }) {
  const total = a + b;
  const pa = total > 0 ? Math.round((100 * a) / total) : 50;
  return (
    <View style={{ gap: 6 }} accessible accessibilityLabel={total > 0 ? `Fans: ${pa}% ${aName}, ${100 - pa}% ${bName}, ${total} picks` : 'No picks yet'}>
      <View style={styles.fans}>
        <View style={{ width: `${pa}%`, backgroundColor: A_COLOR }} />
        <View style={{ flex: 1, backgroundColor: B_COLOR }} />
      </View>
      <View style={styles.rowBetween}>
        <Text style={styles.small}>{total > 0 ? `Fans: ${pa}% ${aName}` : 'No picks yet'}</Text>
        <Text style={styles.small}>{total > 0 ? `${100 - pa}% ${bName} · ${total.toLocaleString()} ${total === 1 ? 'pick' : 'picks'}` : ''}</Text>
      </View>
    </View>
  );
}

// The tale of the tape: each line, and which side it favours.
function tapeRows(a: TitleTape, b: TitleTape): { label: string; a: string; b: string; better: 'a' | 'b' | '' }[] {
  const cmp = (x: number, y: number, more = true): 'a' | 'b' | '' => (x === y ? '' : (x > y) === more ? 'a' : 'b');
  const pct = (n: number, d: number) => (d > 0 ? Math.round((100 * n) / d) : 0);
  return [
    { label: 'Ladder', a: `${ordinal(a.pos)} · ${a.pts} pts`, b: `${ordinal(b.pos)} · ${b.pts} pts`, better: cmp(b.pos, a.pos) },
    { label: 'Record', a: record(a.wins, a.losses, a.draws), b: record(b.wins, b.losses, b.draws), better: cmp(a.wins, b.wins) },
    { label: 'KOs', a: String(a.kos), b: String(b.kos), better: cmp(a.kos, b.kos) },
    { label: 'Knocked down', a: `${a.downsAgainst} ${a.downsAgainst === 1 ? 'time' : 'times'}`, b: `${b.downsAgainst} ${b.downsAgainst === 1 ? 'time' : 'times'}`, better: cmp(a.downsAgainst, b.downsAgainst, false) },
    { label: 'Punches landed', a: `${pct(a.landed, a.thrown)}%`, b: `${pct(b.landed, b.thrown)}%`, better: cmp(pct(a.landed, a.thrown), pct(b.landed, b.thrown)) },
    { label: 'Slips', a: `${a.slipped} of ${a.slipsTried}`, b: `${b.slipped} of ${b.slipsTried}`, better: cmp(pct(a.slipped, a.slipsTried), pct(b.slipped, b.slipsTried)) },
    { label: 'Best punch', a: a.bestPunch ? punchName(a.bestPunch) : '–', b: b.bestPunch ? punchName(b.bestPunch) : '–', better: '' },
    {
      label: 'Guard most',
      a: a.guard ? (GUARDS.find((g) => g.id === a.guard)?.name ?? '–') : 'High',
      b: b.guard ? (GUARDS.find((g) => g.id === b.guard)?.name ?? '–') : 'High',
      better: '',
    },
    { label: 'Steps a day', a: a.stepsADay != null ? a.stepsADay.toLocaleString() : '–', b: b.stepsADay != null ? b.stepsADay.toLocaleString() : '–', better: cmp(a.stepsADay ?? 0, b.stepsADay ?? 0) },
    { label: 'Strength days', a: `${a.strengthDays} of 5`, b: `${b.strengthDays} of 5`, better: cmp(a.strengthDays, b.strengthDays) },
  ];
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    kicker: { fontFamily: font.headingSemibold, fontSize: 11.5, letterSpacing: 0.8, color: withAlpha(colors.text, 0.6) },
    title: { fontFamily: font.headingSemibold, fontSize: 22, color: colors.text },
    cardTitle: { fontFamily: font.headingSemibold, fontSize: 15, color: colors.text },
    rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    link: { fontFamily: font.headingSemibold, fontSize: 13, color: colors.accentActive },
    replayBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32 },
    small: { fontSize: 12, lineHeight: 17, color: withAlpha(colors.text, 0.62) },
    body: { fontSize: 13, lineHeight: 18, color: withAlpha(colors.text, 0.8) },
    champ: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, borderColor: withAlpha(GOLD, 0.6) },
    tapeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 30 },
    tapeLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(colors.text, 0.12) },
    tapeVal: { flex: 1, fontSize: 13.5, fontFamily: font.headingSemibold, color: withAlpha(colors.text, 0.7) },
    tapeBetter: { color: colors.text, fontWeight: '800' },
    tapeLabel: { width: 120, textAlign: 'center', fontSize: 11.5, color: withAlpha(colors.text, 0.6) },
    tapeAvatar: { width: 46, height: 46, borderRadius: 23, borderWidth: 2.5, alignItems: 'center', justifyContent: 'center' },
    tapeInitials: { fontFamily: font.headingSemibold, fontSize: 15, color: '#ffffff' },
    fans: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden' },
    pickBtn: { flex: 1, minHeight: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: withAlpha(colors.text, 0.12), backgroundColor: withAlpha(colors.text, 0.04) },
    pickText: { fontFamily: font.headingSemibold, fontSize: 16, color: colors.text },
    vsRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    vsName: { fontFamily: font.headingSemibold, fontSize: 15.5, color: colors.text },
    vsScore: { fontFamily: font.headingSemibold, fontSize: 20, color: colors.text },
    guard: { flex: 1, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha(colors.text, 0.05), borderWidth: 2, borderColor: 'transparent' },
    guardOn: { borderColor: ME_COLOR, backgroundColor: withAlpha(ME_COLOR, 0.14) },
    guardText: { fontFamily: font.headingSemibold, fontSize: 14.5, color: colors.text },
    head: { fontSize: 11, fontFamily: font.headingSemibold, letterSpacing: 0.5, color: withAlpha(colors.text, 0.55) },
    ladderRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40 },
    meRow: { backgroundColor: withAlpha(ME_COLOR, 0.1), marginHorizontal: -12, paddingHorizontal: 12, borderRadius: 10 },
    lPos: { width: 28, fontSize: 14, fontFamily: font.headingSemibold },
    lName: { flex: 1, minWidth: 0 },
    lNameText: { fontSize: 14, fontFamily: font.headingSemibold, color: colors.text, flexShrink: 1 },
    lRec: { width: 52, textAlign: 'right', fontSize: 13.5, color: withAlpha(colors.text, 0.8) },
    lKo: { width: 30, textAlign: 'right', fontSize: 13.5, color: withAlpha(colors.text, 0.8) },
    lPts: { width: 36, textAlign: 'right', fontSize: 14, color: colors.text },
    cut: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
    cutLine: { flex: 1, borderTopWidth: 1.5, borderStyle: 'dashed', borderTopColor: '#6b5a2a' },
    cutText: { fontSize: 11, fontFamily: font.headingSemibold, color: GOLD },
    play: { minHeight: 48, borderRadius: 12, backgroundColor: '#7fd39b', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
    playOff: { backgroundColor: withAlpha(colors.text, 0.1) },
    playText: { fontFamily: font.headingSemibold, fontSize: 15, color: '#161826', textAlign: 'center' },
  });
}
