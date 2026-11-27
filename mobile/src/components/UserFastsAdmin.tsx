import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Switch, View } from 'react-native';
import { TimerIcon } from 'phosphor-react-native';
import { Text } from './Text';
import { Card } from './Card';
import { Button } from './Button';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { adminFixFast, getUserFasts, type AdminFast } from '../fasting/fastingApi';
import { FastTimePicker, atText, whenText } from '../fasting/FastTimePicker';
import { clockText } from '../fasting/fasting';

// Admin → People → a member → Fasts (0286): their fasts, the one they're
// on first, and Fix for any of them: the start, the end, or ending one
// that's still going. Hours, Bones and their streak follow, and the fix
// is kept with who made it.
export function UserFastsAdmin({ userId, name }: { userId: string; name: string }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<{ timeZone: string | null; streak: number; fasts: AdminFast[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [edit, setEdit] = useState<{ id: string; goalHours: number; start: Date; end: Date | null; wasOpen: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const first = name.split(' ')[0] || name;

  const load = () =>
    getUserFasts(userId)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) =>
        setError(
          e instanceof Error && /admin_user_fasts/.test(e.message)
            ? 'Run 0286_fasting_fix_times.sql to see and fix their fasts.'
            : e instanceof Error
              ? e.message
              : 'Could not load their fasts.',
        ),
      );
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Nothing to show for someone who's never fasted.
  if (data && data.fasts.length === 0) return null;

  const save = () => {
    if (!edit) return;
    const what = edit.end
      ? `${whenText(edit.start)} to ${whenText(edit.end)} (${clockText((edit.end.getTime() - edit.start.getTime()) / 3600000)})`
      : `started ${whenText(edit.start)}, still going`;
    Alert.alert(`Fix ${first}’s fast?`, `${what}. Their hours, Bones and streak follow.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Fix it',
        onPress: async () => {
          setBusy(true);
          try {
            const r = await adminFixFast(edit.id, edit.start, edit.end);
            setEdit(null);
            await load();
            Alert.alert(
              'Fixed',
              r.hours == null
                ? 'It counts from the new start.'
                : `${clockText(r.hours)}${r.onPlan ? ', on plan' : ''}${r.bonesChange ? `, ${r.bonesChange > 0 ? '+' : ''}${r.bonesChange} Bones` : ''}. Streak ${r.streak ?? 0}.`,
            );
          } catch (e) {
            Alert.alert('Couldn’t fix it', e instanceof Error ? e.message : 'Try again.');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const shown = data ? (all ? data.fasts : data.fasts.slice(0, 5)) : [];

  return (
    <Card style={{ gap: 12, padding: 18 }} elevated={false}>
      <View style={styles.header}>
        <TimerIcon size={18} color={colors.accentActive} weight="fill" />
        <Text style={text.h4}>Fasts</Text>
      </View>
      {error ? (
        <Text style={styles.footNote}>{error}</Text>
      ) : !data ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <>
          <Text style={styles.footNote}>
            Streak {data.streak}. Times are in your time zone; their day counts in {data.timeZone ?? 'theirs (none on file, so UTC)'}.
          </Text>
          {shown.map((f) =>
            edit?.id === f.id ? (
              <View key={f.id} style={styles.editBox}>
                <Text style={styles.label}>STARTED</Text>
                <FastTimePicker
                  value={edit.start}
                  min={new Date(new Date(f.startedAt).getTime() - 3 * 86400000)}
                  max={edit.end ? new Date(edit.end.getTime() - 60000) : new Date()}
                  onChange={(d) => setEdit({ ...edit, start: d })}
                />
                {edit.wasOpen && (
                  <View style={styles.rowBetween}>
                    <Text style={styles.body}>End it</Text>
                    <Switch
                      value={!!edit.end}
                      onValueChange={(on) => setEdit({ ...edit, end: on ? new Date(Math.min(Date.now(), edit.start.getTime() + edit.goalHours * 3600000)) : null })}
                    />
                  </View>
                )}
                {edit.end && (
                  <>
                    <Text style={styles.label}>ENDED</Text>
                    <FastTimePicker
                      value={edit.end}
                      min={new Date(edit.start.getTime() + 60000)}
                      max={new Date()}
                      onChange={(d) => setEdit({ ...edit, end: d })}
                      picks={[{ label: `At the ${edit.goalHours} h goal`, at: new Date(edit.start.getTime() + edit.goalHours * 3600000) }]}
                    />
                  </>
                )}
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Button label="Cancel" small disabled={busy} onPress={() => setEdit(null)} />
                  <Button label={busy ? 'Saving…' : 'Save'} variant="primary" small disabled={busy} onPress={save} />
                </View>
              </View>
            ) : (
              <Pressable
                key={f.id}
                style={styles.rowBetween}
                onPress={() =>
                  setEdit({ id: f.id, goalHours: f.goalHours, start: new Date(f.startedAt), end: f.endedAt ? new Date(f.endedAt) : null, wasOpen: !f.endedAt })
                }
                accessibilityRole="button"
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.body} numberOfLines={2}>
                    {whenText(new Date(f.startedAt))} → {f.endedAt ? atText(new Date(f.endedAt)) : 'still going'}
                  </Text>
                  <Text style={[styles.footNote, !f.endedAt && f.hours >= 36 && { color: colors.amber }]}>
                    {clockText(f.hours)} · goal {f.goalHours} h{f.onPlan ? ' · on plan' : ''}
                    {f.bones ? ` · ${f.bones} Bones` : ''}
                    {f.fixes ? ` · fixed ${f.fixes}×` : ''}
                  </Text>
                </View>
                <Text style={styles.link}>Fix</Text>
              </Pressable>
            ),
          )}
          {data.fasts.length > 5 && !all && <Button label={`Show all ${data.fasts.length}`} small onPress={() => setAll(true)} />}
        </>
      )}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 40 },
    body: { fontSize: 14, color: colors.text },
    label: { fontSize: 11.5, letterSpacing: 0.8, fontFamily: font.headingSemibold, color: withAlpha(colors.text, 0.6) },
    footNote: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    link: { fontSize: 14, fontFamily: font.headingSemibold, color: colors.accentActive },
    editBox: { gap: 10, padding: 12, borderRadius: 14, backgroundColor: withAlpha(colors.text, 0.05) },
  });
}
