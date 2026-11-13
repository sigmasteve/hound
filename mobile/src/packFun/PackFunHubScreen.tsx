import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeftIcon, CaretRightIcon, MapTrifoldIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { Button } from '../components/Button';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { clock, isLive, myPackFuns, type MyPackFun } from './packFunApi';

// Your Pack Activities: live and coming up first, then the last few finished.
export function PackFunHubScreen({ onBack, onOpen, onStart }: { onBack: () => void; onOpen: (id: string) => void; onStart: () => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [list, setList] = useState<MyPackFun[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      myPackFuns()
        .then((l) => {
          setList(l);
          setError(null);
        })
        .catch((e) => setError(e instanceof Error ? e.message : 'Couldn’t reach Hound.'));
    }, []),
  );

  const now = Date.now();
  const current = (list ?? []).filter((p) => !p.settled && new Date(p.endsAt).getTime() > now);
  const done = (list ?? []).filter((p) => !current.includes(p)).slice(0, 10);

  const row = (p: MyPackFun) => {
    const live = isLive(p, now);
    const starts = new Date(p.startsAt).getTime();
    const detail = live
      ? `Live · ${clock(new Date(p.endsAt).getTime() - now)} left`
      : starts > now
        ? `Starts in ${clock(starts - now)}`
        : new Date(p.endsAt).toLocaleDateString();
    return (
      <Pressable key={p.id} style={styles.row} onPress={() => onOpen(p.id)} accessibilityRole="button">
        {live ? <View style={styles.liveDot} /> : <View style={styles.dot} />}
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {p.name}
          </Text>
          <Text style={styles.small}>
            {detail} · {p.people} {p.people === 1 ? 'person' : 'people'}
            {!p.joined && !p.settled ? ' · invited' : ''}
          </Text>
        </View>
        {p.mapOn && <MapTrifoldIcon size={16} color={withAlpha(colors.text, 0.5)} />}
        <CaretRightIcon size={14} color={withAlpha(colors.text, 0.4)} />
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.top}>
        <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <ArrowLeftIcon size={20} color={colors.accentActive} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={text.h2}>Pack Activities</Text>
        <Text style={styles.note}>
          Out walking, running or hiking together? Start a Pack Activity: a live board for the pack, scent-trail puzzles as you go, quick races,
          and Bones for everyone.
        </Text>
        <Button label="Start a Pack Activity" variant="primary" block onPress={onStart} />
        {list === null && !error && <ActivityIndicator color={colors.accent} />}
        {error && <Text style={styles.small}>{error}</Text>}
        {current.length > 0 && (
          <>
            <Text style={styles.label}>NOW AND COMING UP</Text>
            <View style={styles.card}>{current.map(row)}</View>
          </>
        )}
        {done.length > 0 && (
          <>
            <Text style={styles.label}>FINISHED</Text>
            <View style={styles.card}>{done.map(row)}</View>
          </>
        )}
        {list && list.length === 0 && <Text style={styles.small}>No Pack Activities yet. Start one and invite your friends.</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    top: { paddingHorizontal: 16, paddingVertical: 8 },
    body: { padding: 16, gap: 12, paddingBottom: 48 },
    note: { fontSize: 14.5, lineHeight: 20, color: withAlpha(colors.text, 0.7) },
    label: { fontSize: 12, letterSpacing: 0.6, color: withAlpha(colors.text, 0.55), marginTop: 8 },
    small: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    card: { borderRadius: 16, backgroundColor: colors.surface, paddingHorizontal: 12 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 58 },
    rowTitle: { fontFamily: font.headingSemibold, fontSize: 15, color: colors.text },
    liveDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#e06c6c' },
    dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: withAlpha(colors.text, 0.2) },
  });
}
