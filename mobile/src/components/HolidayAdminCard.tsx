import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { CaretLeftIcon, CaretRightIcon } from 'phosphor-react-native';
import { Text } from './Text';
import { Card } from './Card';
import { Button } from './Button';
import { ToggleRow } from './Selectable';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { localDayKey } from '../water/water';
import { getHolidayOverview, saveHolidayRun, stopHolidayRun, type HolidayOverview, type HolidayRunStats } from '../holiday/holidayApi';
import { HOLIDAY_THEME_IDS, HOLIDAY_THEMES, shortDay, suggestedEnd, type HolidayThemeId } from '../holiday/holidays';

// Admin → Holiday themes (0184): what's on Today now, the schedule of
// themes (each a run of days; the one that started last shows where
// they overlap), each run's numbers, and adding or changing a run. It
// reaches everyone on their next open, with no update.

const plusDays = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00`);
  x.setDate(x.getDate() + n);
  return localDayKey(x);
};

// "Diwali on now · 42 seen it", for the fold's line.
export function holidaySummary(o: HolidayOverview): string {
  if (!o.showing) {
    const next = o.runs.find((r) => r.startsOn > localDayKey());
    return next ? `${HOLIDAY_THEMES[next.theme].name} from ${shortDay(next.startsOn)}` : 'None on';
  }
  const now = o.runs.find((r) => r.id === o.showing?.id);
  return `${HOLIDAY_THEMES[o.showing.theme].name} on now${now ? ` · ${now.seen} seen it` : ''}`;
}

export function HolidayAdminCard({ onChanged }: { onChanged?: (o: HolidayOverview) => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const today = localDayKey();
  const [data, setData] = useState<HolidayOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The form: a new run (id null) or one being changed.
  const [editing, setEditing] = useState<number | null>(null);
  const [theme, setTheme] = useState<HolidayThemeId>('christmas');
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn] = useState(suggestedEnd('christmas', today));
  const [effects, setEffects] = useState(true);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  // Kept in a ref, so a new function from Admin each render doesn't
  // reload the card.
  const changed = useRef(onChanged);
  changed.current = onChanged;

  // A new run starts the day after the last one on now or to come ends.
  const freshForm = useCallback(
    (o: HolidayOverview | null, t: HolidayThemeId = 'christmas') => {
      const last = (o?.runs ?? []).filter((r) => r.endsOn >= today).reduce<string | null>((m, r) => (!m || r.endsOn > m ? r.endsOn : m), null);
      const start = last ? plusDays(last, 1) : today;
      setEditing(null);
      setTheme(t);
      setStartsOn(start);
      setEndsOn(suggestedEnd(t, start));
      setEffects(true);
    },
    [today],
  );

  const load = useCallback(
    (fresh: boolean) =>
      getHolidayOverview(localDayKey())
        .then((o) => {
          setData(o);
          setError(null);
          changed.current?.(o);
          if (fresh) freshForm(o);
        })
        .catch((e) =>
          setError(
            e instanceof Error && /admin_holiday_overview/.test(e.message)
              ? 'Run 0184_holiday_themes.sql to schedule holiday themes.'
              : e instanceof Error
                ? e.message
                : 'Could not load the holiday themes.',
          ),
        ),
    [freshForm],
  );

  useFocusEffect(
    useCallback(() => {
      load(true);
    }, [load]),
  );

  const pickTheme = (t: HolidayThemeId) => {
    setTheme(t);
    setEndsOn(suggestedEnd(t, startsOn));
    setNote(null);
  };
  const moveStart = (n: number) => {
    const s = plusDays(startsOn, n);
    if (s < today && editing === null) return;
    setStartsOn(s);
    if (endsOn < s) setEndsOn(s);
    setNote(null);
  };
  const moveEnd = (n: number) => {
    const e = plusDays(endsOn, n);
    if (e < startsOn) return;
    setEndsOn(e);
    setNote(null);
  };

  const save = async () => {
    setSaving(true);
    setNote(null);
    try {
      await saveHolidayRun({ id: editing, theme, startsOn, endsOn, effects });
      setNote({ ok: true, text: `Saved. ${HOLIDAY_THEMES[theme].name} shows ${shortDay(startsOn)} to ${shortDay(endsOn)}, from everyone’s next open.` });
      await load(true);
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : 'Could not save.' });
    } finally {
      setSaving(false);
    }
  };

  const edit = (r: HolidayRunStats) => {
    setEditing(r.id);
    setTheme(r.theme);
    setStartsOn(r.startsOn);
    setEndsOn(r.endsOn);
    setEffects(r.effects);
    setNote(null);
  };

  const stop = (r: HolidayRunStats) => {
    const begun = r.startsOn <= today;
    Alert.alert(
      begun ? `Stop ${HOLIDAY_THEMES[r.theme].name} now?` : `Remove ${HOLIDAY_THEMES[r.theme].name}?`,
      begun ? 'It comes off Today on everyone’s next open. Its numbers stay.' : 'It hasn’t started, so it’s taken off the schedule.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: begun ? 'Stop' : 'Remove',
          style: 'destructive',
          onPress: () => {
            stopHolidayRun(r.id, today)
              .then(() => load(editing === r.id))
              .catch((e) => setNote({ ok: false, text: e instanceof Error ? e.message : 'Could not stop it.' }));
          },
        },
      ],
    );
  };

  const status = (r: HolidayRunStats) =>
    r.id === data?.showing?.id
      ? 'On now'
      : r.endsOn < today
        ? `Ended ${shortDay(r.endsOn)}`
        : r.startsOn > today
          ? `Starts ${shortDay(r.startsOn)}`
          : 'Hidden by a later one';

  const stepper = (label: string, value: string, move: (n: number) => void) => (
    <View style={styles.stepper}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.stepRow}>
        <Pressable onPress={() => move(-1)} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel={`${label} a day earlier`}>
          <CaretLeftIcon size={16} color={colors.text} />
        </Pressable>
        <Text style={styles.stepValue}>{shortDay(value)}</Text>
        <Pressable onPress={() => move(1)} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel={`${label} a day later`}>
          <CaretRightIcon size={16} color={colors.text} />
        </Pressable>
      </View>
    </View>
  );

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Holiday themes</Text>
      <Text style={styles.footNote}>
        Decorates Today for everyone: a garland and countdown, a trim on the tiles and things drifting down the screen. Schedule a
        run of days for each; where two overlap, the one that starts later shows. Changes reach everyone on their next open.
      </Text>
      {error ? (
        <Text style={styles.loadError}>{error}</Text>
      ) : !data ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <>
          <View style={styles.row}>
            <Text style={styles.label}>Today</Text>
            <Text style={styles.value}>
              {data.showing
                ? `${HOLIDAY_THEMES[data.showing.theme].emoji} ${HOLIDAY_THEMES[data.showing.theme].name}, until ${shortDay(data.showing.endsOn)}`
                : 'No theme showing'}
            </Text>
          </View>

          {data.runs.map((r) => {
            const t = HOLIDAY_THEMES[r.theme];
            const done = r.endsOn < today;
            return (
              <View key={r.id} style={[styles.row, { gap: 4 }, done && { opacity: 0.7 }]}>
                <View style={styles.runHead}>
                  <Text style={styles.value}>
                    {t.emoji} {t.name}
                  </Text>
                  <Text style={[styles.tag, r.id === data.showing?.id && { color: colors.green }]}>{status(r)}</Text>
                </View>
                <Text style={styles.label}>
                  {shortDay(r.startsOn)} to {shortDay(r.endsOn)} · {t.effectsName.toLowerCase()} {r.effects ? 'on' : 'off'}
                </Text>
                {r.startsOn <= today && (
                  <Text style={styles.stats}>
                    Seen by {r.seen}
                    {data.active14d > 0 ? ` (${Math.round((r.seen / data.active14d) * 100)}% of active)` : ''}
                    {r.id === data.showing?.id ? ` · ${r.seenToday} today` : ''} · {r.effectsOff} turned the effects off · {r.tappers}{' '}
                    tapped the countdown ({r.taps} taps)
                  </Text>
                )}
                {!done && (
                  <View style={styles.runActions}>
                    <Button label="Change" small variant="ghost" onPress={() => edit(r)} />
                    <Button label={r.startsOn <= today ? 'Stop now' : 'Remove'} small variant="ghost" onPress={() => stop(r)} />
                  </View>
                )}
              </View>
            );
          })}

          <View style={[styles.row, { gap: 10 }]}>
            <Text style={text.h4}>{editing === null ? 'Add a theme' : `Change ${HOLIDAY_THEMES[theme].name}`}</Text>
            <View style={styles.chips}>
              {HOLIDAY_THEME_IDS.map((id) => {
                const on = id === theme;
                return (
                  <Pressable
                    key={id}
                    onPress={() => pickTheme(id)}
                    style={[styles.chip, on && { borderColor: colors.accent, backgroundColor: withAlpha(colors.accent, 0.16) }]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.chipText, on && { color: colors.accentActive }]}>
                      {HOLIDAY_THEMES[id].emoji} {HOLIDAY_THEMES[id].name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.steppers}>
              {stepper('Starts', startsOn, moveStart)}
              {stepper('Ends (the last day)', endsOn, moveEnd)}
            </View>
            <ToggleRow
              label={HOLIDAY_THEMES[theme].effectsName}
              note={effects ? 'On: people can turn it off for themselves in Settings' : 'Off for everyone'}
              value={effects}
              onChange={setEffects}
            />
            {note && <Text style={note.ok ? styles.saved : styles.loadError}>{note.text}</Text>}
            <Button label={saving ? 'Saving…' : editing === null ? 'Add to the schedule' : 'Save changes'} variant="primary" disabled={saving} onPress={save} />
            {editing !== null && <Button label="Cancel" variant="ghost" small onPress={() => freshForm(data)} />}
          </View>
        </>
      )}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    footNote: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
    loadError: { fontSize: 12.5, color: colors.amber },
    saved: { fontSize: 12.5, color: colors.green },
    row: {
      gap: 2,
      paddingTop: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: withAlpha(colors.text, 0.07),
    },
    label: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    value: { fontFamily: font.heading, fontSize: 15, color: colors.text },
    stats: { fontSize: 12.5, color: colors.text, lineHeight: 18 },
    runHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    tag: { fontFamily: font.headingSemibold, fontSize: 12, color: withAlpha(colors.text, 0.6) },
    runActions: { flexDirection: 'row', gap: 8 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1.5, borderColor: colors.divider },
    chipText: { fontFamily: font.headingSemibold, fontSize: 13, color: colors.text },
    steppers: { flexDirection: 'row', gap: 10 },
    stepper: { flex: 1, gap: 4 },
    stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.divider, borderRadius: 10, paddingHorizontal: 4, paddingVertical: 4 },
    stepBtn: { padding: 6 },
    stepValue: { fontFamily: font.headingSemibold, fontSize: 14, color: colors.text },
  });
}
