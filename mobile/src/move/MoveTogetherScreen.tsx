import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeftIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { Button } from '../components/Button';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { PersonAvatar } from '../fasting/FastingParts';
import { routineById } from './move';
import { declineMovePack, getMovePack, joinMovePack, type MovePack, type MovePackMember } from './moveApi';
import { ActivityIcon } from './MoveParts';

// Move together (0275): who's in for the routine, where each of them is,
// and your Start. Everyone does the same guided routine on their own
// phone; when everyone who joined is done, each gets the bonus.
export function MoveTogetherScreen({
  packId,
  onBack,
  onStart,
}: {
  packId: string;
  onBack: () => void;
  onStart: (routineId: string, packId: string) => void;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [pack, setPack] = useState<MovePack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(() => {
    getMovePack(packId)
      .then((p) => {
        setPack(p);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load.'));
  }, [packId]);

  useEffect(() => {
    load();
    const t = setInterval(() => {
      setNow(Date.now());
      load();
    }, 8000);
    return () => clearInterval(t);
  }, [load]);

  const mine = pack?.members.find((m) => m.me) ?? null;
  const routine = pack ? routineById(pack.routineRef) : undefined;
  const open = pack ? new Date(pack.joinUntil).getTime() > now : false;

  const act = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      load();
    } catch (e) {
      Alert.alert('Move together', e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const line = (m: MovePackMember): { text: string; color: string; pct: number } => {
    const total = (pack?.minutes ?? 10) * 60000;
    switch (m.state) {
      case 'done':
        return { text: m.bones > 0 ? `Done ✓ +${m.bones} Bones` : 'Done ✓', color: colors.green, pct: 1 };
      case 'going': {
        const pct = m.startedAt ? Math.min(0.99, (now - new Date(m.startedAt).getTime()) / total) : 0;
        return { text: `Going · ${Math.round(pct * 100)}%`, color: colors.accentActive, pct };
      }
      case 'waiting':
        return { text: 'In, not started yet', color: withAlpha(colors.text, 0.6), pct: 0 };
      case 'invited':
        return { text: 'Invited', color: withAlpha(colors.text, 0.45), pct: 0 };
      default:
        return { text: 'Didn’t finish', color: withAlpha(colors.text, 0.45), pct: 0 };
    }
  };

  const doneCount = pack?.members.filter((m) => m.state === 'done').length ?? 0;
  const pending = pack?.members.filter((m) => m.state === 'waiting' || m.state === 'going').length ?? 0;

  let pinned: React.ReactNode = null;
  if (pack && mine && routine) {
    if (mine.state === 'invited') {
      pinned = open ? (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button label="Not now" block style={{ flex: 1 }} disabled={busy} onPress={() => act(async () => { await declineMovePack(packId); onBack(); })} />
          <Button label={busy ? 'Joining…' : 'I’m in'} variant="primary" block style={{ flex: 2 }} disabled={busy} onPress={() => act(() => joinMovePack(packId))} />
        </View>
      ) : (
        <Button label="This one’s closed" block disabled onPress={() => {}} />
      );
    } else if (mine.state === 'waiting' || mine.state === 'out') {
      pinned = <Button label="Start the routine" variant="primary" block onPress={() => onStart(routine.id, packId)} />;
    } else if (mine.state === 'going') {
      pinned = <Button label="Back to my routine" variant="primary" block onPress={() => onStart(routine.id, packId)} />;
    } else {
      pinned = <Button label="Done" variant="primary" block onPress={onBack} />;
    }
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.top}>
        <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <ArrowLeftIcon size={20} color={colors.accentActive} />
        </Pressable>
        <Text style={[text.h4, { flex: 1, textAlign: 'center' }]}>Move together</Text>
        <View style={{ width: 20 }} />
      </View>
      {!pack ? (
        <View style={styles.center}>{error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.accent} />}</View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.hero}>
            <ActivityIcon activity={pack.routineRef.startsWith('stretch') ? 'stretching' : 'strength_light'} size={44} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.title}>{pack.routineName}</Text>
              <Text style={styles.small}>
                {pack.minutes} min · each on your own phone · +{pack.bonus} Bones each when everyone who joined finishes
              </Text>
            </View>
          </View>
          <View style={styles.card}>
            {pack.members.map((m) => {
              const l = line(m);
              return (
                <View key={m.person.id} style={styles.row}>
                  <PersonAvatar p={m.person} size={34} />
                  <View style={{ flex: 1, gap: 4 }}>
                    <View style={styles.between}>
                      <Text style={styles.strong}>{m.me ? 'You' : m.person.name}</Text>
                      <Text style={[styles.small, { color: l.color }]}>{l.text}</Text>
                    </View>
                    <View style={styles.track}>
                      <View style={[styles.fill, { width: `${Math.round(l.pct * 100)}%`, backgroundColor: l.color }]} />
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
          <Text style={styles.small}>
            {doneCount >= 2 && pending === 0
              ? 'Everyone who joined finished. Nice work, pack.'
              : open
                ? `Friends can join until ${new Date(pack.joinUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. The bonus comes when at least two of you finish and no one’s still going.`
                : 'The bonus comes when at least two of you finish and no one’s still going.'}
          </Text>
          {error && <Text style={styles.error}>{error}</Text>}
        </ScrollView>
      )}
      {pinned && <View style={styles.pinned}>{pinned}</View>}
    </SafeAreaView>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, gap: 12 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    body: { paddingHorizontal: 16, paddingBottom: 16, gap: 12 },
    hero: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 18, backgroundColor: colors.surface, padding: 14 },
    title: { fontSize: 18, fontFamily: font.headingSemibold, color: colors.text },
    card: { borderRadius: 16, backgroundColor: colors.surface, padding: 12, gap: 12 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    strong: { fontSize: 14.5, fontFamily: font.headingSemibold, color: colors.text },
    small: { fontSize: 12.5, lineHeight: 17, color: withAlpha(colors.text, 0.6) },
    track: { height: 6, borderRadius: 3, backgroundColor: withAlpha(colors.text, 0.08), overflow: 'hidden' },
    fill: { height: 6, borderRadius: 3 },
    error: { fontSize: 13, color: colors.amber, textAlign: 'center' },
    pinned: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8 },
  });
}
