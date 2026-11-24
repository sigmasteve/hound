import React, { useCallback, useMemo, useState } from 'react';
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

// Fasting on a club's page (0261): members who fast and share. Who's
// fasting now and the week's board (days on plan, then streak; longest
// shows "24 h+" until tapped). Shows when someone in the club fasts, or
// always in a Fasting club.
export function FastingClubCard({ clubId, fastingClub, onOpenFasting }: { clubId: string; fastingClub: boolean; onOpenFasting: () => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<ClubFasting | null>(null);

  useFocusEffect(
    useCallback(() => {
      getClubFasting(clubId)
        .then(setData)
        .catch(() => setData(null));
    }, [clubId]),
  );

  if (!data || data.under) return null;
  if (!fastingClub && data.board.length === 0 && data.now.length === 0) return null;
  const now = Date.now();
  const mineNow = data.now.some((n) => n.me);

  return (
    <Card style={{ gap: 10 }} elevated={false}>
      <View style={styles.rowBetween}>
        <Text style={text.h4}>Fasting</Text>
        {data.now.length > 0 && (
          <Text style={styles.live}>
            ● {data.now.length} fasting now
          </Text>
        )}
      </View>
      {data.now.length > 0 && (
        <View style={styles.wrap}>
          {data.now.slice(0, 8).map((n) => (
            <View key={n.id} style={styles.nowChip}>
              <PersonAvatar p={n} size={22} />
              <Text style={styles.small}>
                {n.me ? 'You' : n.name} {clockText(hoursSince(n.fast.startedAt, now))}
              </Text>
            </View>
          ))}
        </View>
      )}
      {data.board.length > 0 ? (
        <View style={{ gap: 6 }}>
          <View style={styles.rowBetween}>
            <Text style={styles.label}>THIS WEEK · DAYS ON PLAN</Text>
            <Text style={styles.small}>streak · longest</Text>
          </View>
          {data.board.slice(0, 10).map((r, i) => (
            <View key={r.id} style={styles.row}>
              <Text style={[styles.rank, { minWidth: 18 }]}>{i + 1}</Text>
              <PersonAvatar p={r} size={24} />
              <Text style={[styles.body, { flex: 1 }, r.me && styles.strong]} numberOfLines={1}>
                {r.me ? 'You' : r.name}
              </Text>
              <Text style={styles.num}>{r.numbers.weekDays}</Text>
              <Text style={styles.num}>🔥{r.numbers.streak}</Text>
              <LongestText hours={r.numbers.longest} style={styles.num} />
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.small}>Nobody here has fasted yet. Start one and you’ll lead the board.</Text>
      )}
      <Button label={mineNow ? 'Your fast' : data.canFast ? 'Start a fast' : 'Try fasting'} variant={mineNow ? 'secondary' : 'primary'} small onPress={onOpenFasting} />
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 30 },
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
