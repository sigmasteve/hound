import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { PlayIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import type { PendingAction } from '../challenges/pendingActions';
import { actionLine } from './needsYouActions';
import { finishPlayTurns, nextPlayTurn, stopPlayTurns, usePlayRun } from './playTurns';

// Play your turns (0279), between games: back on Today after one, this
// bar names the next and opens it after a short count (Go now skips the
// wait, Stop ends the run). After the last one it says so and goes.
const COUNT = 3;

export function PlayTurnsBar({ onOpen }: { onOpen: (a: PendingAction) => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const run = usePlayRun();
  const focused = useIsFocused();
  // Only once you've been to a game and come back.
  const left = useRef(false);
  const [back, setBack] = useState(false);
  const [count, setCount] = useState(COUNT);
  const [doneNote, setDoneNote] = useState<number | null>(null);

  useEffect(() => {
    if (!focused) {
      if (run) left.current = true;
      setBack(false);
      return;
    }
    if (left.current && run) {
      left.current = false;
      if (run.done >= run.turns.length) {
        setDoneNote(run.turns.length);
        finishPlayTurns();
      } else {
        setCount(COUNT);
        setBack(true);
      }
    }
  }, [focused, run]);

  const go = () => {
    setBack(false);
    const t = nextPlayTurn();
    if (t) onOpen(t);
  };

  useEffect(() => {
    if (!back) return;
    if (count <= 0) {
      go();
      return;
    }
    const t = setTimeout(() => setCount((c) => c - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [back, count]);

  useEffect(() => {
    if (doneNote === null) return;
    const t = setTimeout(() => setDoneNote(null), 3500);
    return () => clearTimeout(t);
  }, [doneNote]);

  if (doneNote !== null)
    return (
      <View style={styles.bar} accessibilityLiveRegion="polite">
        <Text style={[styles.title, { flex: 1 }]}>
          That’s {doneNote === 1 ? 'your turn' : `all ${doneNote} turns`} played 🐾
        </Text>
      </View>
    );
  if (!back || !run) return null;
  const next = run.turns[run.done];
  if (!next) return null;
  return (
    <View style={styles.bar} accessibilityLiveRegion="polite">
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.small}>
          Next up · {run.done + 1} of {run.turns.length}
        </Text>
        <Text style={styles.title} numberOfLines={2}>
          {next.challengeName}: {actionLine(next)}
        </Text>
      </View>
      <Pressable
        onPress={() => {
          setBack(false);
          stopPlayTurns();
        }}
        hitSlop={6}
        style={styles.stop}
        accessibilityRole="button"
      >
        <Text style={styles.stopText}>Stop</Text>
      </Pressable>
      <Pressable onPress={go} style={styles.go} accessibilityRole="button" accessibilityLabel={`Go now: ${next.challengeName}`}>
        <PlayIcon size={13} color="#1b1d29" weight="fill" />
        <Text style={styles.goText}>Go {count > 0 ? count : ''}</Text>
      </Pressable>
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    bar: {
      position: 'absolute',
      left: 12,
      right: 12,
      bottom: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      padding: 12,
      borderRadius: 16,
      backgroundColor: colors.surface,
      borderWidth: 1.5,
      borderColor: withAlpha('#f08a24', 0.5),
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 6,
    },
    small: { fontSize: 11.5, color: withAlpha(colors.text, 0.6) },
    title: { fontSize: 14, fontFamily: font.headingSemibold, color: colors.text },
    stop: { minHeight: 40, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
    stopText: { fontSize: 13.5, fontFamily: font.headingSemibold, color: withAlpha(colors.text, 0.7) },
    go: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 40, minWidth: 64, paddingHorizontal: 12, borderRadius: 12, backgroundColor: '#f08a24', justifyContent: 'center' },
    goText: { fontSize: 14, fontFamily: font.headingSemibold, color: '#1b1d29', fontVariant: ['tabular-nums'] },
  });
}
