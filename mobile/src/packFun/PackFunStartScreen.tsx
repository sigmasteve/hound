import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeftIcon, CheckCircleIcon, CircleIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { Avatar } from '../components/Avatar';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { supabaseFriendsProvider } from '../friends/supabaseFriends';
import type { Friend } from '../friends/types';
import { getMyClubs } from '../clubs/clubsApi';
import { startPackFun } from './packFunApi';
import { hasLiveFeatures } from './packFunSensors';

// Start a Pack Fun (0192): a name, how long, who's coming (friends, or
// open to a club), and what's on.
const LENGTHS: { minutes: 30 | 60 | 120 | 240; label: string }[] = [
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '1 hr' },
  { minutes: 120, label: '2 hr' },
  { minutes: 240, label: '4 hr' },
];
const WHEN: { id: 'now' | '15' | '60'; label: string; minutes: number }[] = [
  { id: 'now', label: 'Now', minutes: 0 },
  { id: '15', label: 'In 15 min', minutes: 15 },
  { id: '60', label: 'In 1 hour', minutes: 60 },
];

export function PackFunStartScreen({ clubId: initialClub, onBack, onStarted }: { clubId?: string; onBack: () => void; onStarted: (id: string) => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const live = hasLiveFeatures();
  const [name, setName] = useState('');
  const [minutes, setMinutes] = useState<30 | 60 | 120 | 240>(60);
  const [when, setWhen] = useState<'now' | '15' | '60'>('now');
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [clubs, setClubs] = useState<{ id: string; name: string }[]>([]);
  const [clubId, setClubId] = useState<string | null>(initialClub ?? null);
  const [trails, setTrails] = useState(true);
  const [flash, setFlash] = useState(true);
  const [map, setMap] = useState(live);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabaseFriendsProvider
      .listFriends()
      .then((f) => setFriends(f.filter((x) => x.status === 'accepted')))
      .catch(() => setFriends([]));
    getMyClubs()
      .then((c) => setClubs(c.map((x) => ({ id: x.id, name: x.name }))))
      .catch(() => {});
  }, []);

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const start = async () => {
    setSaving(true);
    try {
      const delay = WHEN.find((w) => w.id === when)!.minutes;
      const id = await startPackFun({
        name: name.trim() || 'Pack Fun',
        minutes,
        invite: [...picked],
        clubId,
        trails,
        flash,
        map: map && live,
        startsAt: delay ? new Date(Date.now() + delay * 60_000) : null,
      });
      onStarted(id);
    } catch (e) {
      Alert.alert('Pack Fun', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.top}>
        <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <ArrowLeftIcon size={20} color={colors.accentActive} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={text.h2}>Pack Fun</Text>
        <Text style={styles.note}>A live session for a walk, run or hike together. Puzzles drop as the pack moves, anyone can start a quick race, and everyone sees the board.</Text>
        <TextField label="Name" value={name} onChangeText={setName} placeholder="Saturday hike" maxLength={60} />
        <Text style={styles.label}>How long</Text>
        <View style={styles.chips}>
          {LENGTHS.map((l) => (
            <Pressable key={l.minutes} onPress={() => setMinutes(l.minutes)} style={[styles.chip, minutes === l.minutes && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: minutes === l.minutes }}>
              <Text style={styles.chipText}>{l.label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.label}>Starts</Text>
        <View style={styles.chips}>
          {WHEN.map((w) => (
            <Pressable key={w.id} onPress={() => setWhen(w.id)} style={[styles.chip, when === w.id && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: when === w.id }}>
              <Text style={styles.chipText}>{w.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Who’s coming</Text>
        <View style={styles.panel}>
          {friends === null ? (
            <ActivityIndicator color={colors.accent} />
          ) : friends.length === 0 ? (
            <Text style={styles.note}>Add friends to invite them, or open it to a club below.</Text>
          ) : (
            friends.map((f) => {
              const on = picked.has(f.userId);
              return (
                <Pressable key={f.userId} onPress={() => toggle(f.userId)} style={styles.friendRow} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                  <Avatar initials={f.initials} tint={colors.accent800} size={34} fontSize={12} frameId={f.frameId} backgroundId={f.backgroundId} iconId={f.iconId} />
                  <Text style={[styles.rowText, { flex: 1 }]}>{f.name}</Text>
                  {on ? <CheckCircleIcon size={22} color={colors.accent} weight="fill" /> : <CircleIcon size={22} color={withAlpha(colors.text, 0.3)} />}
                </Pressable>
              );
            })
          )}
        </View>
        {clubs.length > 0 && (
          <>
            <Text style={styles.label}>Open to a club (optional)</Text>
            <View style={styles.chips}>
              <Pressable onPress={() => setClubId(null)} style={[styles.chip, clubId === null && styles.chipOn]} accessibilityRole="button">
                <Text style={styles.chipText}>No club</Text>
              </Pressable>
              {clubs.map((c) => (
                <Pressable key={c.id} onPress={() => setClubId(c.id)} style={[styles.chip, clubId === c.id && styles.chipOn]} accessibilityRole="button">
                  <Text style={styles.chipText}>{c.name}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        <View style={styles.panel}>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowText}>Scent trails</Text>
              <Text style={styles.small}>A puzzle every so many pack steps</Text>
            </View>
            <Switch value={trails} onValueChange={setTrails} trackColor={{ true: colors.accent }} />
          </View>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowText}>Flash challenges</Text>
              <Text style={styles.small}>Anyone can start a quick race</Text>
            </View>
            <Switch value={flash} onValueChange={setFlash} trackColor={{ true: colors.accent }} />
          </View>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowText}>Live map</Text>
              <Text style={styles.small}>
                {live ? 'See the pack on a map, and bones to walk to. Shared with the pack only, until it ends.' : 'Comes with the newest Hound update.'}
              </Text>
            </View>
            <Switch value={map && live} onValueChange={setMap} disabled={!live} trackColor={{ true: colors.accent }} />
          </View>
        </View>
        <Button label={saving ? 'Starting…' : when === 'now' ? 'Start now' : 'Schedule it'} variant="primary" block onPress={saving ? undefined : start} />
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
    label: { fontSize: 13, color: withAlpha(colors.text, 0.6), marginTop: 4 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { minHeight: 42, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: withAlpha(colors.text, 0.15), justifyContent: 'center', backgroundColor: colors.surface },
    chipOn: { borderWidth: 2, borderColor: colors.accent, backgroundColor: withAlpha(colors.accent, 0.12) },
    chipText: { fontFamily: font.headingSemibold, fontSize: 14, color: colors.text },
    panel: { borderRadius: 16, backgroundColor: colors.surface, padding: 12, gap: 10 },
    friendRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
    rowText: { fontSize: 15, color: colors.text },
    small: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  });
}
