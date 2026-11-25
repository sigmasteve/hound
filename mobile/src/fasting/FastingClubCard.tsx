import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from '../components/Text';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { clockText } from './fasting';
import { getClubFasting, hoursSince, type ClubFasting } from './fastingApi';
import { LongestText, PersonAvatar } from './FastingParts';

// Fasting on a club's page (0261, 0262): members who fast and share.
// Who's fasting now and the week's board (days on plan, then streak;
// longest shows "24 h+" until tapped): everyone in it who has ever fasted,
// the top 25 and your own row. Someone who hasn't joined a public club
// sees only the counts. Shows when someone in the club fasts, or always
// in a Fasting club. `onLoaded` tells the page whether you're fasting, for
// its pinned button.
export function FastingClubCard({
  clubId,
  fastingClub,
  showButton = true,
  refreshKey,
  onOpenFasting,
  onLoaded,
}: {
  clubId: string;
  fastingClub: boolean;
  // The page pins the button itself for a Fasting club.
  showButton?: boolean;
  // Changes when the page reloads (after joining).
  refreshKey?: unknown;
  onOpenFasting: () => void;
  onLoaded?: (d: ClubFasting | null) => void;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<ClubFasting | null>(null);

  const load = useCallback(() => {
    getClubFasting(clubId)
      .then((d) => {
        setData(d);
        onLoaded?.(d);
      })
      .catch(() => {
        setData(null);
        onLoaded?.(null);
      });
    // onLoaded is the page's setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId]);

  useFocusEffect(load);
  useEffect(() => {
    if (refreshKey !== undefined) load();
  }, [refreshKey, load]);

  if (!data || data.under) return null;
  if (!fastingClub && data.fasters === 0 && data.nowCount === 0) return null;
  const now = Date.now();
  const mineNow = data.now.some((n) => n.me);

  if (!data.member) {
    return (
      <Card style={{ gap: 6 }} elevated={false}>
        <View style={styles.rowBetween}>
          <Text style={text.h4}>Fasting</Text>
          {data.nowCount > 0 && <Text style={styles.live}>● {data.nowCount} fasting now</Text>}
        </View>
        <Text style={styles.small}>
          {data.fasters > 0
            ? `${data.fasters} ${data.fasters === 1 ? 'member fasts' : 'members fast'} here. Join to see the board, start a fast with them and cheer them on.`
            : 'Join to start a fast with the club and see the board.'}
        </Text>
      </Card>
    );
  }

  const top = data.board.filter((r) => r.rank <= 25);
  const mine = data.board.find((r) => r.me && r.rank > 25);
  const row = (r: ClubFasting['board'][number]) => (
    <View key={r.id} style={[styles.row, r.me && styles.meRow]}>
      <Text style={[styles.rank, { minWidth: 22 }]}>{r.rank}</Text>
      <PersonAvatar p={r} size={24} />
      <Text style={[styles.body, { flex: 1 }, r.me && styles.strong]} numberOfLines={1}>
        {r.me ? 'You' : r.name}
      </Text>
      <Text style={styles.num}>{r.numbers.weekDays}</Text>
      <Text style={styles.num}>🔥{r.numbers.streak}</Text>
      <LongestText hours={r.numbers.longest} style={styles.num} />
    </View>
  );

  return (
    <Card style={{ gap: 10 }} elevated={false}>
      <View style={styles.rowBetween}>
        <Text style={text.h4}>Fasting</Text>
        {data.nowCount > 0 && <Text style={styles.live}>● {data.nowCount} fasting now</Text>}
      </View>
      {data.now.length > 0 && (
        <View style={styles.wrap}>
          {data.now.slice(0, 12).map((n) => (
            <View key={n.id} style={styles.nowChip}>
              <PersonAvatar p={n} size={22} />
              <Text style={styles.small}>
                {n.me ? 'You' : n.name} {clockText(hoursSince(n.fast.startedAt, now))}
              </Text>
            </View>
          ))}
          {data.nowCount > 12 && <Text style={[styles.small, { alignSelf: 'center' }]}>+{data.nowCount - 12} more</Text>}
        </View>
      )}
      {top.length > 0 ? (
        <View style={{ gap: 6 }}>
          <View style={styles.rowBetween}>
            <Text style={styles.label}>THIS WEEK · DAYS ON PLAN</Text>
            <Text style={styles.small}>streak · longest</Text>
          </View>
          {top.map(row)}
          {mine && (
            <>
              <Text style={[styles.small, { textAlign: 'center' }]}>⋯</Text>
              {row(mine)}
            </>
          )}
          {data.fasters > top.length + (mine ? 1 : 0) && (
            <Text style={styles.small}>
              {data.fasters} {data.fasters === 1 ? 'member fasts' : 'members fast'} here.
            </Text>
          )}
        </View>
      ) : (
        <Text style={styles.small}>Nobody here has fasted yet. Start one and you’ll lead the board.</Text>
      )}
      {showButton && (
        <Button
          label={mineNow ? 'Your fast' : data.canFast ? 'Start a fast' : 'Try fasting'}
          variant={mineNow ? 'secondary' : 'primary'}
          small
          onPress={onOpenFasting}
        />
      )}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 30, borderRadius: 8, paddingHorizontal: 4 },
    meRow: { backgroundColor: withAlpha(colors.accent, 0.12) },
    rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    nowChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 10, borderRadius: 999, backgroundColor: withAlpha(colors.text, 0.06) },
    live: { fontSize: 12.5, color: colors.green, fontFamily: font.headingSemibold },
    label: { fontSize: 11, letterSpacing: 0.7, color: withAlpha(colors.text, 0.55), fontFamily: font.headingSemibold },
    body: { fontSize: 14, color: colors.text, fontFamily: font.body },
    strong: { fontFamily: font.headingSemibold },
    small: { fontSize: 12.5, color: withAlpha(colors.text, 0.62), fontFamily: font.body },
    rank: { fontSize: 12.5, color: withAlpha(colors.text, 0.6), fontFamily: font.headingSemibold, fontVariant: ['tabular-nums'] },
    num: { fontSize: 13, color: colors.text, fontFamily: font.headingSemibold, fontVariant: ['tabular-nums'], minWidth: 28, textAlign: 'right' },
  });
}
