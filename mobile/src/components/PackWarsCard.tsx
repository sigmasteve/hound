import React, { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Path, Polygon, Rect, Text as SvgText } from 'react-native-svg';
import { Text } from './Text';
import { Card } from './Card';
import { DayCard } from './DayCard';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { MAP_COLS, MAP_ROWS, PACKS, marchable, packOf } from '../challenges/packWars';
import { heldBy, packDayNo, type PackWarsGame } from '../challenges/packWarsApi';
import { localDayKey } from '../goals/goals';

export function PackWarsCard({
  name,
  game,
  voting,
  onVote,
}: {
  name: string;
  game: PackWarsGame;
  // A vote on its way to the server.
  voting: boolean;
  // A territory to march on, or -1 to hold.
  onVote: (idx: number) => void;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const me = packOf(game.myPack);
  const day = packDayNo(game);
  const counts = PACKS.map((p) => ({ pack: p, n: heldBy(game, p.id) }));
  const lead = Math.max(...counts.map((c) => c.n));
  const can = day != null && !game.settled ? marchable(game.map, game.myPack) : new Set<number>();
  const taken = new Set(game.lastNight.map((l) => l.idx));
  const nameOf = (idx: number) => (idx === -1 ? 'Hold' : (game.map[idx]?.name ?? 'somewhere'));
  const target = game.myVote;
  const today = localDayKey(new Date());
  const before = day == null && today < game.firstDay;
  const over = day == null && !before;
  const leaders = counts.filter((c) => c.n === lead).map((c) => c.pack);

  return (
    <Card style={{ gap: 14 }} elevated={false}>
      <View style={{ gap: 2 }}>
        <Text style={text.h4}>{name}</Text>
        <Text style={styles.meta}>
          Four packs, one map{day != null ? ` · Day ${day} of ${game.days}` : ` · ${game.days} days`} · most ground at the end wins
        </Text>
      </View>

      <View style={[styles.myPack, { borderColor: me.color, backgroundColor: withAlpha(me.color, 0.1) }]}>
        <View style={[styles.flag, { backgroundColor: me.color }]} />
        <View style={{ flex: 1 }}>
          <Text style={styles.myPackName}>You’re a {me.one}</Text>
          <Text style={styles.meta}>
            {game.members[game.myPack]} in your pack{day != null ? ` · ${game.votedToday} voted today` : ''}
          </Text>
        </View>
      </View>

      {/* Ground held, as one bar. */}
      <View style={{ gap: 6 }}>
        <View style={styles.bar}>
          {counts.map(({ pack, n }) => (
            <View key={pack.id} style={{ flex: Math.max(n, 0.0001), backgroundColor: pack.color }} />
          ))}
          <View style={{ flex: Math.max(game.map.filter((t) => !t.owner).length, 0.0001), backgroundColor: withAlpha(colors.text, 0.12) }} />
        </View>
        <View style={styles.legend}>
          {counts.map(({ pack, n }) => (
            <View key={pack.id} style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: pack.color }]} />
              <Text style={[styles.legendText, pack.id === game.myPack && styles.legendMine]}>
                {pack.name.split(' ')[0]} {n}
              </Text>
            </View>
          ))}
        </View>
      </View>

      <HoodMap game={game} can={can} taken={taken} onVote={voting ? () => {} : onVote} />

      {day != null && !game.settled && (
        <>
          <View style={styles.vote}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.voteTitle}>TODAY’S MARCH</Text>
              <Text style={styles.voteValue}>
                {target == null ? 'No vote yet' : target === -1 ? 'Holding our ground' : `Marching on ${nameOf(target)}`}
              </Text>
              {game.packVotes.length > 0 && (
                <Text style={styles.meta} numberOfLines={2}>
                  Your pack: {game.packVotes.map((v) => `${nameOf(v.idx)} ${v.votes}`).join(' · ')}
                </Text>
              )}
            </View>
            {voting ? (
              <ActivityIndicator color={me.color} />
            ) : (
              <Pressable
                onPress={() => onVote(-1)}
                style={[styles.hold, target === -1 && { backgroundColor: me.color, borderColor: me.color }]}
                accessibilityRole="button"
                accessibilityLabel="Hold our ground"
              >
                <Text style={[styles.holdText, target === -1 && { color: '#fff' }]}>Hold</Text>
              </Pressable>
            )}
          </View>
          <Text style={styles.note}>
            Tap a dashed territory to march on it, or Hold. Only members who vote add their steps today, and your pack goes where most
            of you voted. The march is overnight.
          </Text>
        </>
      )}
      {before && <Text style={styles.note}>The first march is on {formatDay(game.firstDay)}. Come back that day and vote.</Text>}
      {over && (
        <Text style={styles.result}>
          {leaders.length === 1 ? `The ${leaders[0].name} took the most ground.` : `${leaders.map((p) => p.name).join(' and ')} finished level.`}{' '}
          {leaders.some((p) => p.id === game.myPack) ? 'Your pack won!' : ''}
        </Text>
      )}

      {game.lastDay && (
        <DayCard
          title={game.lastDay === yesterday(today) ? 'Last night' : `The night of ${formatDay(game.lastDay)}`}
          summary={game.lastNight.length ? `${game.lastNight.length} ${game.lastNight.length === 1 ? 'territory' : 'territories'} changed hands` : 'Nothing changed hands'}
          defaultOpen
        >
          {game.lastNight.map((l) => {
            const to = packOf(l.to);
            return (
              <View key={l.idx} style={styles.nightRow}>
                <View style={[styles.dot, { backgroundColor: to.color }]} />
                <Text style={styles.nightText}>
                  {l.to === game.myPack ? 'Your pack' : `The ${to.name}`} took {nameOf(l.idx)}
                  {l.from ? ` from ${l.from === game.myPack ? 'you' : `the ${packOf(l.from).name}`}` : ''}: {l.avg.toLocaleString()} steps a member
                  {l.vsAvg != null ? ` against ${l.vsAvg.toLocaleString()}` : ''}
                </Text>
              </View>
            );
          })}
        </DayCard>
      )}

      <DayCard title="How it works">
        <Text style={styles.note}>
          Everyone’s in one of four packs, kept even. Each day, vote where your pack marches: a territory next to your ground, or Hold.
          Your pack’s strength is the steps of the members who voted, shared over the whole pack, so every vote counts. Overnight, a
          territory goes to the strongest pack on it if it beats the owner’s defence: all of its strength on a Hold, half while it
          marches elsewhere. Most ground at the end wins: everyone in the winning pack gets {game.winBones + 5} Bones, everyone else{' '}
          {game.finishBones + 5}.
        </Text>
      </DayCard>
    </Card>
  );
}

function yesterday(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return localDayKey(new Date(y, m - 1, d - 1));
}

// "Monday, Dec 1".
function formatDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

// A neighborhood: the same 24 territories as blocks between streets,
// with a river, trees and houses.
function HoodMap({ game, can, taken, onVote }: { game: PackWarsGame; can: Set<number>; taken: Set<number>; onVote: (idx: number) => void }) {
  const W = 600;
  const H = 440;
  const me = packOf(game.myPack);
  // A lattice of corners, nudged so the blocks aren't square. Edges stay put.
  const pts = useMemo(() => {
    const out: [number, number][][] = [];
    for (let r = 0; r <= MAP_ROWS; r++) {
      const row: [number, number][] = [];
      for (let c = 0; c <= MAP_COLS; c++) {
        const edgeX = c === 0 || c === MAP_COLS;
        const edgeY = r === 0 || r === MAP_ROWS;
        const jx = edgeX ? 0 : Math.sin(r * 7.1 + c * 3.3) * 13;
        const jy = edgeY ? 0 : Math.cos(r * 5.3 + c * 2.7) * 10;
        row.push([(c / MAP_COLS) * W + jx, (r / MAP_ROWS) * H + jy]);
      }
      out.push(row);
    }
    return out;
  }, []);

  const block = (idx: number) => {
    const r = Math.floor(idx / MAP_COLS);
    const c = idx % MAP_COLS;
    const corners = [pts[r][c], pts[r][c + 1], pts[r + 1][c + 1], pts[r + 1][c]];
    const cx = corners.reduce((s, p) => s + p[0], 0) / 4;
    const cy = corners.reduce((s, p) => s + p[1], 0) / 4;
    // Pulled in toward the middle, leaving the streets between.
    const inset = corners.map(([x, y]) => [cx + (x - cx) * 0.86, cy + (y - cy) * 0.84] as [number, number]);
    return { corners: inset, cx, cy };
  };

  return (
    <View style={{ borderRadius: 14, overflow: 'hidden' }}>
      <Svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ aspectRatio: W / H }}>
        {/* Streets underneath everything. */}
        <Rect x={0} y={0} width={W} height={H} fill="#d9d3c3" />
        {game.map.map((t) => {
          const { corners, cx, cy } = block(t.idx);
          const owner = t.owner ? packOf(t.owner) : null;
          const open = can.has(t.idx);
          const target = game.myVote === t.idx;
          const words = t.name.split(' ');
          return (
            <G key={t.idx} onPress={open ? () => onVote(t.idx) : undefined}>
              <Polygon
                points={corners.map((p) => p.join(',')).join(' ')}
                fill={owner ? owner.wash : '#e8efd9'}
                stroke={target ? me.color : open ? me.color : owner ? owner.color : '#c9d3b4'}
                strokeWidth={target ? 6 : open ? 3 : 2}
                strokeDasharray={open && !target ? '10 7' : undefined}
                strokeLinejoin="round"
              />
              {/* A few trees and rooftops, so it reads as a neighborhood. */}
              <Circle cx={cx - 28} cy={cy - 24} r={7} fill={owner ? withAlpha(owner.color, 0.35) : '#9cc58a'} />
              <Circle cx={cx + 30} cy={cy + 22} r={6} fill={owner ? withAlpha(owner.color, 0.35) : '#9cc58a'} />
              <Rect x={cx + 18} y={cy - 30} width={14} height={11} rx={2} fill={owner ? withAlpha(owner.color, 0.45) : '#c9b99a'} />
              <Rect x={cx - 36} y={cy + 16} width={12} height={10} rx={2} fill={owner ? withAlpha(owner.color, 0.45) : '#c9b99a'} />
              {owner && <Rect x={cx - 22} y={cy - 44} width={44} height={8} rx={4} fill={owner.color} />}
              {words.map((w, i) => (
                <SvgText
                  key={w}
                  x={cx}
                  y={cy + 4 + (i - (words.length - 1) / 2) * 17}
                  fontSize={16}
                  fontFamily={font.headingSemibold}
                  fill="#2b2620"
                  textAnchor="middle"
                >
                  {w}
                </SvgText>
              ))}
              {taken.has(t.idx) && (
                <SvgText x={cx + 34} y={cy - 28} fontSize={20} fill="#2b2620" textAnchor="middle">
                  ✦
                </SvgText>
              )}
              {target && (
                <>
                  <Circle cx={cx} cy={cy - 38} r={13} fill={me.color} />
                  <SvgText x={cx} y={cy - 33} fontSize={14} textAnchor="middle">
                    🐾
                  </SvgText>
                </>
              )}
            </G>
          );
        })}
        {/* The river, down the street between the second and third rows,
            with a bridge. */}
        <Path
          d={`M ${pts[2][0][0]} ${pts[2][0][1]} ${[1, 2, 3].map((c) => `L ${pts[2][c][0]} ${pts[2][c][1]}`).join(' ')}`}
          stroke="#7fb3d9"
          strokeWidth={12}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Rect
          x={(pts[2][1][0] + pts[2][2][0]) / 2 - 9}
          y={(pts[2][1][1] + pts[2][2][1]) / 2 - 14}
          width={18}
          height={28}
          rx={3}
          fill="#b9ad94"
        />
      </Svg>
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    meta: { fontSize: 12, color: withAlpha(colors.text, 0.58) },
    note: { fontSize: 12, color: withAlpha(colors.text, 0.6), lineHeight: 17 },
    result: { fontFamily: font.heading, fontSize: 15, color: colors.text },
    myPack: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12, borderWidth: 1.5 },
    flag: { width: 22, height: 22, borderRadius: 6 },
    myPackName: { fontFamily: font.headingSemibold, fontSize: 15, color: colors.text },
    bar: { flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden', gap: 2 },
    legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center' },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    legendText: { fontSize: 12, color: withAlpha(colors.text, 0.65), fontVariant: ['tabular-nums'] },
    legendMine: { fontFamily: font.headingSemibold, color: colors.text },
    dot: { width: 10, height: 10, borderRadius: 5 },
    vote: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, backgroundColor: withAlpha(colors.accent, 0.08) },
    voteTitle: { fontSize: 11, letterSpacing: 0.6, color: withAlpha(colors.text, 0.55), fontFamily: font.headingSemibold },
    voteValue: { fontFamily: font.heading, fontSize: 15, color: colors.text },
    hold: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1.5, borderColor: withAlpha(colors.text, 0.18) },
    holdText: { fontFamily: font.headingSemibold, fontSize: 13.5, color: colors.text },
    nightRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    nightText: { flex: 1, fontSize: 12.5, lineHeight: 17, color: withAlpha(colors.text, 0.8) },
  });
}
