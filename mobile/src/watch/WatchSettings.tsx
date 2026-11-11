import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Platform, StyleSheet, View } from 'react-native';
import { WatchIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { supabase } from '../lib/supabase';

// Settings → Apple Watch (0189): enter the code Hound shows on the watch
// to link it, and see or unlink linked watches. Plain app code, so it
// reaches every version by update; the watch app itself comes with the
// 0.12.0 build.

interface LinkedWatch {
  id: string;
  linkedAt: string;
  lastSeenAt: string | null;
}

async function listWatches(): Promise<LinkedWatch[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('my_watches');
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map((w) => ({ id: w.id, linkedAt: w.linked_at, lastSeenAt: w.last_seen_at ?? null }));
}

async function linkWatch(code: string): Promise<void> {
  if (!supabase) throw new Error('Not connected to Hound.');
  const { error } = await supabase.rpc('link_watch', { p_code: code });
  if (error) throw new Error(error.message);
}

async function unlinkWatch(id: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.rpc('unlink_watch', { p_device: id });
  if (error) throw new Error(error.message);
}

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export function WatchSettings() {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [watches, setWatches] = useState<LinkedWatch[] | null>(null);
  const [code, setCode] = useState('');
  const [linking, setLinking] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    listWatches()
      .then(setWatches)
      .catch(() => setWatches(null));
  }, []);
  useEffect(load, [load]);

  // iPhone only, and only once 0189 has run (the list loads).
  if (Platform.OS !== 'ios' || watches === null) return null;

  const clean = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const link = async () => {
    setLinking(true);
    setNote(null);
    try {
      await linkWatch(clean);
      setCode('');
      setNote({ ok: true, text: 'Linked. Your watch shows your goals and water now.' });
      load();
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : 'Couldn’t link it. Try again.' });
    } finally {
      setLinking(false);
    }
  };

  const unlink = (w: LinkedWatch) =>
    Alert.alert('Unlink this watch?', 'Hound on it stops showing your goals until you link it again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Unlink', style: 'destructive', onPress: () => unlinkWatch(w.id).then(load).catch(() => {}) },
    ]);

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <View style={styles.head}>
        <WatchIcon size={18} color={colors.accent} />
        <Text style={text.h4}>Apple Watch</Text>
      </View>
      <Text style={styles.note}>
        Open Hound on your Apple Watch. It shows a six-letter code: enter it here to link the watch to your account.
      </Text>
      <TextField
        label="Code from your watch"
        value={code}
        onChangeText={(v) => {
          setCode(v);
          setNote(null);
        }}
        placeholder="K7M2QX"
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={8}
      />
      {note && <Text style={note.ok ? styles.ok : styles.warn}>{note.text}</Text>}
      <Button label={linking ? 'Linking…' : 'Link watch'} variant="primary" disabled={linking || clean.length !== 6} onPress={link} />
      {watches.map((w) => (
        <View key={w.id} style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>Apple Watch</Text>
            <Text style={styles.note}>
              Linked {day(w.linkedAt)}
              {w.lastSeenAt ? ` · last used ${day(w.lastSeenAt)}` : ''}
            </Text>
          </View>
          <Button label="Unlink" variant="ghost" small onPress={() => unlink(w)} />
        </View>
      ))}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    note: { fontSize: 13, lineHeight: 18, color: withAlpha(colors.text, 0.65) },
    ok: { fontSize: 13, color: colors.green },
    warn: { fontSize: 13, color: colors.amber },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
    name: { fontFamily: font.heading, fontSize: 15, color: colors.text },
  });
}
