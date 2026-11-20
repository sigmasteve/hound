import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PawPrintIcon } from 'phosphor-react-native';
import { Text } from './Text';
import { Card } from './Card';
import { TextField } from './TextField';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { listGlobalChallenges, type GlobalChallenge } from '../challenges/globalChallenges';
import {
  getBroadcastOverview,
  MESSAGE_MAX,
  nextAtLabel,
  pct,
  previewBroadcast,
  sendBroadcast,
  sendBroadcastTest,
  TITLE_MAX,
  type BroadcastAudience,
  type BroadcastOverview,
  type BroadcastPreview,
} from '../admin/broadcastApi';

// Admin → Overview → Status → Send a push (0228), as mocked up: write a
// title and a message, pick what tapping it opens (Today, or a Global
// challenge people can still join: an invite, which can go only to
// people not in it yet), see how it looks and how many it reaches, then
// check and send on a sheet. One a day. Send only to me (0229) tries it on
// your own phone first. Under it, every push sent with
// how many it went to, opened it and joined.

const ORANGE = '#f08a24';

function PushPreview({ title, message, colors }: { title: string; message: string; colors: Palette }) {
  return (
    <View style={pv.box} accessible accessibilityLabel={`How it looks: ${title || 'Hound'}. ${message || 'Your message'}`}>
      <View style={pv.icon}>
        <PawPrintIcon size={20} color="#1b1d29" weight="fill" />
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
          <Text style={pv.title} numberOfLines={1}>
            {title || 'Hound'}
          </Text>
          <Text style={pv.when}>now</Text>
        </View>
        <Text style={pv.body} numberOfLines={4}>
          {message || 'Your message'}
        </Text>
      </View>
    </View>
  );
}

const pv = StyleSheet.create({
  box: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', borderRadius: 18, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: 'rgba(233,233,237,0.94)' },
  icon: { width: 34, height: 34, borderRadius: 9, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center' },
  title: { flexShrink: 1, fontFamily: font.headingSemibold, fontSize: 13, color: '#1b1d29' },
  when: { fontSize: 12, color: '#555865' },
  body: { fontSize: 13, lineHeight: 18, color: '#1b1d29' },
});

export function BroadcastAdminCard({ onChanged }: { onChanged?: (o: BroadcastOverview) => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [opens, setOpens] = useState<string | null>(null);
  const [audience, setAudience] = useState<BroadcastAudience>('not_in');
  const [globals, setGlobals] = useState<GlobalChallenge[]>([]);
  const [preview, setPreview] = useState<BroadcastPreview | null>(null);
  const [overview, setOverview] = useState<BroadcastOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [testing, setTesting] = useState(false);

  const load = useCallback(() => {
    getBroadcastOverview()
      .then((o) => {
        setOverview(o);
        setError(null);
        onChanged?.(o);
      })
      .catch((e) =>
        setError(
          e instanceof Error && /admin_broadcast_overview/.test(e.message)
            ? 'Run 0228_broadcast_push.sql and deploy send-broadcast-push to send pushes.'
            : e instanceof Error
              ? e.message
              : 'Could not load the pushes.',
        ),
      );
    listGlobalChallenges()
      .then((all) => {
        const now = Date.now();
        setGlobals(all.filter((c) => now < new Date(c.joinClosesAt).getTime() && now < new Date(c.endsAt).getTime()));
      })
      .catch(() => setGlobals([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useFocusEffect(load);

  const aud: BroadcastAudience = opens ? audience : 'all';
  useEffect(() => {
    let live = true;
    previewBroadcast(opens, aud)
      .then((p) => live && setPreview(p))
      .catch(() => live && setPreview(null));
    return () => {
      live = false;
    };
  }, [opens, aud, overview]);

  const challenge = globals.find((g) => g.id === opens) ?? null;
  const t = title.trim();
  const m = message.trim();
  const ready = t.length > 0 && m.length > 0 && !!preview && preview.reach > 0 && !preview.nextAt;
  const sendLabel = !preview
    ? 'Review'
    : preview.nextAt
      ? `Next push after ${nextAtLabel(preview.nextAt)}`
      : !t || !m
        ? 'Write a title and a message'
        : `Review · send to ${preview.reach.toLocaleString()}`;

  const send = () => {
    setSending(true);
    sendBroadcast(t, m, opens, aud)
      .then(() => {
        setConfirming(false);
        setTitle('');
        setMessage('');
        load();
      })
      .catch((e) => Alert.alert('Send a push', e instanceof Error ? e.message : 'Try again.'))
      .finally(() => setSending(false));
  };

  // Send only to me (0229): try it on your own phone first.
  const canTest = t.length > 0 && m.length > 0 && !testing;
  const sendTest = () => {
    setTesting(true);
    sendBroadcastTest(t, m, opens)
      .then(() => Alert.alert('Sent to your phone', 'It should arrive in a moment. It doesn’t use today’s push, and it won’t show in the history.'))
      .catch((e) => Alert.alert('Send only to me', e instanceof Error ? e.message : 'Try again.'))
      .finally(() => setTesting(false));
  };

  const chip = (on: boolean) => [styles.chip, on && styles.chipOn];

  if (error) {
    return (
      <Card elevated={false}>
        <Text style={styles.note}>{error}</Text>
      </Card>
    );
  }

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Send a push</Text>
      <Text style={styles.note}>
        One push to everyone who can get one, at most once a day. People can turn these off in Settings (News and challenge invites).
      </Text>

      <TextField label={`Title · ${title.length} / ${TITLE_MAX}`} value={title} onChangeText={setTitle} maxLength={TITLE_MAX} placeholder="The Title Bout starts Monday" />
      <TextField
        label={`Message · ${message.length} / ${MESSAGE_MAX}`}
        value={message}
        onChangeText={setMessage}
        maxLength={MESSAGE_MAX}
        multiline
        placeholder="Five days on the ladder, then the top two fight for the belt."
      />

      <View style={{ gap: 8 }}>
        <Text style={styles.label}>Tapping it opens</Text>
        <View style={styles.chips}>
          <Pressable onPress={() => setOpens(null)} style={chip(opens == null)} accessibilityRole="button" accessibilityState={{ selected: opens == null }}>
            <Text style={[styles.chipText, opens == null && styles.chipTextOn]}>Today</Text>
          </Pressable>
          {globals.map((g) => (
            <Pressable key={g.id} onPress={() => setOpens(g.id)} style={chip(opens === g.id)} accessibilityRole="button" accessibilityState={{ selected: opens === g.id }}>
              <Text style={[styles.chipText, opens === g.id && styles.chipTextOn]} numberOfLines={1}>
                {g.name} · Global
              </Text>
            </Pressable>
          ))}
        </View>
        {globals.length === 0 && <Text style={styles.small}>No Global challenge is open to join right now.</Text>}
        {opens && (
          <>
            <Text style={styles.label}>Send to</Text>
            <View style={styles.chips}>
              {(['all', 'not_in'] as const).map((a) => (
                <Pressable key={a} onPress={() => setAudience(a)} style={chip(audience === a)} accessibilityRole="button" accessibilityState={{ selected: audience === a }}>
                  <Text style={[styles.chipText, audience === a && styles.chipTextOn]}>{a === 'all' ? 'Everyone' : 'Not in it yet'}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
      </View>

      <View style={{ gap: 6 }}>
        <Text style={styles.label}>How it looks</Text>
        <PushPreview title={t} message={m} colors={colors} />
      </View>

      {preview && (
        <Text style={[styles.small, { textAlign: 'center' }]}>
          {preview.reach.toLocaleString()} can get it
          {opens && aud === 'not_in' ? ` · ${preview.alreadyIn.toLocaleString()} already in` : ''}
          {preview.turnedOff > 0 ? ` · ${preview.turnedOff.toLocaleString()} turned these off` : ''}
        </Text>
      )}
      <Pressable onPress={() => ready && setConfirming(true)} disabled={!ready} style={[styles.send, !ready && styles.sendOff]} accessibilityRole="button">
        <Text style={[styles.sendText, !ready && styles.sendTextOff]}>{sendLabel}</Text>
      </Pressable>
      <Pressable onPress={sendTest} disabled={!canTest} style={[styles.back, !canTest && { opacity: 0.45 }]} accessibilityRole="button">
        <Text style={styles.backText}>{testing ? 'Sending to you…' : 'Send only to me'}</Text>
      </Pressable>

      {overview && overview.broadcasts.length > 0 && (
        <View>
          <View style={[styles.histRow, { paddingBottom: 6 }]}>
            <Text style={[styles.head, { flex: 1 }]}>SENT</Text>
            <Text style={[styles.head, styles.num]}>TO</Text>
            <Text style={[styles.head, styles.num]}>OPENED</Text>
            <Text style={[styles.head, styles.num]}>JOINED</Text>
          </View>
          {overview.broadcasts.map((b) => (
            <View key={b.id} style={styles.histItem}>
              <View style={styles.histRow}>
                <Text style={[styles.histTitle, { flex: 1 }]} numberOfLines={1}>
                  {b.title}
                </Text>
                <Text style={[styles.histNum, styles.num]}>{b.recipients.toLocaleString()}</Text>
                <Text style={[styles.histNum, styles.num]}>{pct(b.opened, b.recipients)}</Text>
                <Text style={[styles.histNum, styles.num, { fontFamily: font.headingSemibold, color: colors.text }]}>{b.joined == null ? '–' : b.joined.toLocaleString()}</Text>
              </View>
              <Text style={styles.small}>
                {new Date(b.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ·{' '}
                {b.challengeName ? `${b.challengeName} · ${b.audience === 'not_in' ? 'not in it yet' : 'everyone'}` : 'opens Today · everyone'}
                {b.status === 'sending' ? ' · sending…' : b.status === 'failed' ? ` · didn’t send${b.error ? `: ${b.error}` : ''}` : ''}
              </Text>
            </View>
          ))}
          <Text style={[styles.small, { paddingTop: 8 }]}>Opened: tapped the push. Joined: joined the challenge within a day of the push.</Text>
        </View>
      )}
      {!overview && <ActivityIndicator color={colors.accent} />}

      <Modal visible={confirming} transparent animationType="slide" onRequestClose={() => !sending && setConfirming(false)}>
        <View style={styles.backdrop}>
          <SafeAreaView edges={['bottom']} style={styles.sheet}>
            <ScrollView contentContainerStyle={{ gap: 12 }}>
              <View style={styles.grabber} />
              <Text style={styles.sheetTitle} accessibilityRole="header">
                Send to {preview?.reach.toLocaleString()} {preview?.reach === 1 ? 'person' : 'people'}?
              </Text>
              <PushPreview title={t} message={m} colors={colors} />
              <View>
                {[
                  ['Opens', challenge ? `${challenge.name}, with Join` : 'Today'],
                  ['Goes to', opens ? (aud === 'not_in' ? 'Everyone not in it yet' : 'Everyone') : 'Everyone'],
                  [
                    'Left out',
                    [opens && aud === 'not_in' ? `${preview?.alreadyIn.toLocaleString()} already in` : null, `${preview?.turnedOff.toLocaleString()} turned these off`]
                      .filter(Boolean)
                      .join(' · '),
                  ],
                  ['Arrives', 'Now, within a few minutes'],
                ].map(([k, v]) => (
                  <View key={k} style={styles.sumRow}>
                    <Text style={styles.sumKey}>{k}</Text>
                    <Text style={styles.sumVal}>{v}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.warn}>One push a day to everyone, and this is today’s. It can’t be taken back once it’s sent.</Text>
              <Pressable onPress={send} disabled={sending} style={[styles.send, sending && { opacity: 0.6 }]} accessibilityRole="button">
                <Text style={styles.sendText}>{sending ? 'Sending…' : 'Send now'}</Text>
              </Pressable>
              <Pressable onPress={() => setConfirming(false)} disabled={sending} style={styles.back} accessibilityRole="button">
                <Text style={styles.backText}>Back to edit</Text>
              </Pressable>
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    note: { fontSize: 13, lineHeight: 18, color: withAlpha(colors.text, 0.7) },
    label: { fontFamily: font.headingSemibold, fontSize: 12.5, color: withAlpha(colors.text, 0.72) },
    small: { fontSize: 12, lineHeight: 17, color: withAlpha(colors.text, 0.62) },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { minHeight: 44, maxWidth: '100%', borderRadius: 12, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: withAlpha(colors.text, 0.12), backgroundColor: withAlpha(colors.text, 0.04) },
    chipOn: { borderColor: ORANGE, backgroundColor: withAlpha(ORANGE, 0.16) },
    chipText: { fontFamily: font.headingSemibold, fontSize: 13.5, color: colors.text },
    chipTextOn: { color: colors.text },
    send: { minHeight: 52, borderRadius: 14, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
    sendOff: { backgroundColor: withAlpha(colors.text, 0.1) },
    sendText: { fontFamily: font.headingSemibold, fontSize: 16, color: '#1b1d29', textAlign: 'center' },
    sendTextOff: { color: withAlpha(colors.text, 0.6), fontSize: 14 },
    head: { fontSize: 11, fontFamily: font.headingSemibold, letterSpacing: 0.5, color: withAlpha(colors.text, 0.55) },
    num: { width: 56, textAlign: 'right' },
    histItem: { paddingVertical: 9, gap: 3, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(colors.text, 0.12) },
    histRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
    histTitle: { fontFamily: font.headingSemibold, fontSize: 13.5, color: colors.text },
    histNum: { fontSize: 13.5, color: withAlpha(colors.text, 0.8) },
    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
    sheet: { maxHeight: '88%', backgroundColor: colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 16 },
    grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: withAlpha(colors.text, 0.25) },
    sheetTitle: { fontFamily: font.headingSemibold, fontSize: 20, color: colors.text },
    sumRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(colors.text, 0.14) },
    sumKey: { fontSize: 13.5, color: withAlpha(colors.text, 0.7) },
    sumVal: { flexShrink: 1, textAlign: 'right', fontFamily: font.headingSemibold, fontSize: 13.5, color: colors.text },
    warn: { borderRadius: 12, padding: 12, fontSize: 12.5, lineHeight: 18, color: colors.text, backgroundColor: withAlpha(ORANGE, 0.14), overflow: 'hidden' },
    back: { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: withAlpha(colors.text, 0.2), alignItems: 'center', justifyContent: 'center' },
    backText: { fontFamily: font.headingSemibold, fontSize: 15, color: colors.text },
  });
}
