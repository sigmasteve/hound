import React, { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { CaretRightIcon, PersonSimpleWalkIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { clock, isLive, joinPackFun, type MyPackFun } from './packFunApi';

// Pack Activities that are on or coming up, with Join on the ones you
// were invited to (or that your club opened), and Start. On Today's
// Needs you, the Clubs tab and a club's page.
export function PackActivitiesCard({
  list,
  onOpen,
  onStart,
  startLabel = 'Start a Pack Activity',
  showClub = true,
  emptyNote = 'Out walking, running or hiking together? Start one: a live board for the pack, puzzles as you go and quick races.',
}: {
  list: MyPackFun[];
  onOpen: (id: string) => void;
  onStart: () => void;
  startLabel?: string;
  showClub?: boolean;
  emptyNote?: string | null;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [joining, setJoining] = useState<string | null>(null);
  const now = Date.now();

  const join = async (p: MyPackFun) => {
    setJoining(p.id);
    try {
      await joinPackFun(p.id);
      onOpen(p.id);
    } catch (e) {
      Alert.alert('Pack Activities', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setJoining(null);
    }
  };

  return (
    <Card style={styles.card} elevated={false}>
      <View style={styles.head}>
        <PersonSimpleWalkIcon size={16} color={colors.accentActive} weight="bold" />
        <Text style={styles.kicker}>PACK ACTIVITIES</Text>
      </View>
      {list.length === 0 && emptyNote ? <Text style={styles.note}>{emptyNote}</Text> : null}
      {list.map((p) => {
        const live = isLive(p, now);
        const starts = new Date(p.startsAt).getTime();
        const when = live ? `Live · ${clock(new Date(p.endsAt).getTime() - now)} left` : `Starts in ${clock(starts - now)}`;
        const who = p.invited ? `${p.creatorName} invited you` : !p.joined ? `${p.creatorName} started it` : null;
        const sub = [when, who, `${p.people} in`, showClub ? p.clubName : null].filter(Boolean).join(' · ');
        return (
          <View key={p.id} style={styles.row}>
            <Pressable style={styles.rowMain} onPress={() => onOpen(p.id)} accessibilityRole="button" accessibilityLabel={`${p.name}, ${sub}. Open`}>
              <View style={[styles.dot, live && styles.dotLive]} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {p.name}
                </Text>
                <Text style={styles.sub} numberOfLines={2}>
                  {sub}
                </Text>
              </View>
              {p.joined && <CaretRightIcon size={16} color={withAlpha(colors.text, 0.5)} />}
            </Pressable>
            {!p.joined && (
              <Button label={joining === p.id ? 'Joining…' : 'Join'} variant="primary" small disabled={joining === p.id} onPress={() => join(p)} />
            )}
          </View>
        );
      })}
      <Button label={startLabel} variant={list.length ? 'secondary' : 'primary'} block small onPress={onStart} />
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    card: { gap: 10 },
    head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    kicker: { fontFamily: font.headingSemibold, fontSize: 11.5, letterSpacing: 0.8, color: colors.accentActive },
    note: { fontSize: 13.5, lineHeight: 19, color: withAlpha(colors.text, 0.65) },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 },
    rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
    dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: withAlpha(colors.text, 0.25) },
    dotLive: { backgroundColor: '#e06c6c' },
    name: { fontFamily: font.headingSemibold, fontSize: 15, color: colors.text },
    sub: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
  });
}
