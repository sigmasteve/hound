import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';

// A time between `min` and `max` (0286): the day, then − and + by the
// hour and 15 minutes, and quick picks. For ending a fast you forgot ("I
// ate at…", any time back to the start) and fixing a fast's times, so it
// reaches back days, not just the 12 hours of "I stopped eating at…".

export function whenText(d: Date, now = new Date()): string {
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const days = Math.round((startOfDay(now).getTime() - startOfDay(d).getTime()) / 86400000);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  return `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}, ${time}`;
}

// "9:33 AM", "9:33 AM yesterday", "9:33 AM Wed": for a button.
export function atText(d: Date, now = new Date()): string {
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const days = Math.round((startOfDay(now).getTime() - startOfDay(d).getTime()) / 86400000);
  return days === 0 ? time : days === 1 ? `${time} yesterday` : `${time} ${d.toLocaleDateString([], { weekday: 'short' })}`;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function agoText(d: Date, now: Date): string {
  const min = Math.round((now.getTime() - d.getTime()) / 60000);
  if (min <= 1) return 'Now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} m ago` : `${h} h ago`;
}

export function FastTimePicker({
  value,
  min,
  max,
  onChange,
  picks = [],
}: {
  value: Date;
  min: Date;
  max: Date;
  onChange: (d: Date) => void;
  // Quick picks, e.g. "Now", "At your goal". Ones outside min..max hide.
  picks?: { label: string; at: Date }[];
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const now = new Date();
  const clamp = (t: number) => new Date(Math.max(min.getTime(), Math.min(max.getTime(), t)));
  const step = (minutes: number) => onChange(clamp(value.getTime() + minutes * 60000));

  // The days it can be on, oldest first (at most a week's worth shown).
  const days: Date[] = [];
  for (let d = startOfDay(max); d.getTime() >= startOfDay(min).getTime() && days.length < 8; d = new Date(d.getTime() - 86400000)) {
    days.unshift(new Date(d));
  }
  const onDay = (d: Date) => {
    const t = new Date(d);
    t.setHours(value.getHours(), value.getMinutes(), 0, 0);
    onChange(clamp(t.getTime()));
  };
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const btn = (label: string, minutes: number, a11y: string) => {
    const off = minutes < 0 ? value.getTime() <= min.getTime() : value.getTime() >= max.getTime();
    return (
      <Pressable
        onPress={() => step(minutes)}
        disabled={off}
        style={[styles.stepBtn, off && { opacity: 0.35 }]}
        accessibilityRole="button"
        accessibilityLabel={a11y}
      >
        <Text style={styles.stepText}>{label}</Text>
      </Pressable>
    );
  };

  return (
    <View style={{ gap: 10 }}>
      {days.length > 1 && (
        <View style={styles.chips}>
          {days.map((d) => (
            <Chip
              key={d.toDateString()}
              label={sameDay(d, now) ? 'Today' : sameDay(d, new Date(now.getTime() - 86400000)) ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'short' })}
              on={sameDay(d, value)}
              onPress={() => onDay(d)}
              styles={styles}
            />
          ))}
        </View>
      )}
      <View style={{ alignItems: 'center' }}>
        <Text style={styles.timeBig} numberOfLines={1}>
          {value.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
        </Text>
        <Text style={styles.small}>{agoText(value, now)}</Text>
      </View>
      <View style={styles.timeRow}>
        {btn('−1 h', -60, 'An hour earlier')}
        {btn('−15', -15, '15 minutes earlier')}
        {btn('+15', 15, '15 minutes later')}
        {btn('+1 h', 60, 'An hour later')}
      </View>
      {picks.length > 0 && (
        <View style={styles.chips}>
          {picks
            .filter((p) => p.at.getTime() >= min.getTime() - 60000 && p.at.getTime() <= max.getTime() + 60000)
            .map((p) => (
              <Chip key={p.label} label={p.label} on={Math.abs(p.at.getTime() - value.getTime()) < 60000} onPress={() => onChange(clamp(p.at.getTime()))} styles={styles} />
            ))}
        </View>
      )}
    </View>
  );
}

function Chip({ label, on, onPress, styles }: { label: string; on: boolean; onPress: () => void; styles: ReturnType<typeof makeStyles> }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    timeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    stepBtn: {
      flex: 1,
      minHeight: 44,
      borderRadius: 12,
      backgroundColor: withAlpha(colors.accentActive, 0.12),
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 6,
    },
    stepText: { fontSize: 14, fontFamily: font.headingSemibold, color: colors.accentActive },
    timeBig: { fontSize: 26, fontFamily: font.headingSemibold, color: colors.text },
    small: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    // The same chips as the Fasting screen's.
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: { borderWidth: 1, borderColor: withAlpha(colors.text, 0.18), borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
    chipOn: { backgroundColor: withAlpha(colors.accent, 0.22), borderColor: colors.accent },
    chipText: { fontSize: 13, fontFamily: font.headingSemibold, color: colors.text },
    chipTextOn: { color: colors.accentActive },
  });
}
