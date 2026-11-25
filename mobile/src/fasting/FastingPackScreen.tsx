import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeftIcon, CheckSquareIcon, SquareIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { Button } from '../components/Button';
import { Avatar } from '../components/Avatar';
import { FriendPickList } from '../components/FriendPickList';
import { TileSheet } from '../home/TodayTiles';
import { supabaseFriendsProvider } from '../friends/supabaseFriends';
import type { Friend } from '../friends/types';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { NOTES, clockText, noteLabel, planLabel } from './fasting';
import {
  declineFastPack,
  getFastPack,
  getMyFasting,
  hoursSince,
  inviteToFastPack,
  joinFastPack,
  sendPackNote,
  type FastPack,
} from './fastingApi';
import { PersonAvatar } from './FastingParts';

// A pack fast (0261): friends fasting the same night, each on their own
// plan. The pack ring fills as each one ends on plan; when all who joined
// do, everyone gets the pack bonus. Quick notes ping the others.
export function FastingPackScreen({ packId, onBack, onOpenFasting }: { packId: string; onBack: () => void; onOpenFasting: () => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [pack, setPack] = useState<FastPack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [myPlan, setMyPlan] = useState(16);
  const [inviting, setInviting] = useState(false);
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);

  const load = useCallback(() => {
    getFastPack(packId)
      .then((p) => {
        setPack(p);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Couldn’t reach Hound.'));
  }, [packId]);

  useFocusEffect(
    useCallback(() => {
      load();
      getMyFasting()
        .then((m) => setMyPlan(m.planHours))
        .catch(() => {});
      const tick = setInterval(() => setNow(Date.now()), 30000);
      const refresh = setInterval(() => {
        if (AppState.currentState === 'active') load();
      }, 30000);
      return () => {
        clearInterval(tick);
        clearInterval(refresh);
      };
    }, [load]),
  );

  useEffect(() => {
    if (inviting && friends === null) {
      supabaseFriendsProvider
        .listFriends()
        .then((f) => setFriends(f.filter((x) => x.status === 'accepted')))
        .catch(() => setFriends([]));
    }
  }, [inviting, friends]);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      load();
    } catch (e) {
      Alert.alert('Pack fast', e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const mine = pack?.members.find((m) => m.me);
  const joined = (pack?.members ?? []).filter((m) => m.status === 'joined');
  const finished = joined.filter((m) => m.fast?.endedAt && m.fast.onPlan);
  const open = pack ? new Date(pack.joinUntil).getTime() > now : false;
  const meFasting = !!mine?.fast && !mine.fast.endedAt;

  let pinned: React.ReactNode = null;
  if (mine?.status === 'invited' && open) {
    pinned = (
      <View style={styles.pinRow}>
        <View style={{ flex: 1 }}>
          <Button label={`Join on ${planLabel(myPlan)}`} variant="primary" block disabled={busy} onPress={() => run(() => joinFastPack(packId, myPlan))} />
        </View>
        <Button label="Not now" disabled={busy} onPress={() => run(() => declineFastPack(packId))} />
      </View>
    );
  } else if (mine?.status === 'joined') {
    pinned = <Button label={meFasting ? 'Your fast' : 'Fasting'} variant="primary" block onPress={onOpenFasting} />;
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.top}>
        <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <ArrowLeftIcon size={20} color={colors.accentActive} />
        </Pressable>
        <Text style={[text.h4, { flex: 1, textAlign: 'center' }]}>Pack fast</Text>
        <View style={{ width: 20 }} />
      </View>
      <ScrollView contentContainerStyle={styles.body0}>
        {!pack && !error && <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />}
        {error && <Text style={styles.small}>{error}</Text>}
        {pack && (
          <>
            <View style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.strong}>
                  {new Date(pack.createdAt).toLocaleDateString([], { weekday: 'long' })}’s pack fast
                </Text>
                <Text style={styles.small}>
                  {joined.length} of {pack.members.filter((m) => m.status !== 'declined').length} in
                </Text>
              </View>
              {pack.members
                .filter((m) => m.status !== 'declined')
                .map((m) => {
                  const f = m.fast;
                  const h = f ? (f.endedAt ? f.hours : hoursSince(f.startedAt, now)) : 0;
                  return (
                    <View key={m.id} style={styles.row}>
                      <PersonAvatar p={m} />
                      <Text style={[styles.body, { flex: 1 }]} numberOfLines={1}>
                        <Text style={styles.strong}>{m.me ? 'You' : m.name}</Text>
                        {f ? ` · ${planLabel(f.goalHours)}` : ' · invited'}
                      </Text>
                      {f && f.endedAt ? (
                        <Text style={[styles.num, { color: f.onPlan ? colors.green : withAlpha(colors.text, 0.6) }]}>
                          {f.onPlan ? `done ✓ ${clockText(h)}` : `ended ${clockText(h)}`}
                        </Text>
                      ) : f ? (
                        <Text style={styles.num}>{clockText(h)}</Text>
                      ) : null}
                    </View>
                  );
                })}
              {open && mine?.status === 'joined' && (
                <Pressable onPress={() => setInviting(true)} accessibilityRole="button">
                  <Text style={styles.link}>Invite more friends ›</Text>
                </Pressable>
              )}
            </View>

            <View style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.label}>PACK RING</Text>
                <Text style={[styles.small, { color: colors.amber, fontFamily: font.headingSemibold }]}>
                  {pack.bonusPaid ? `Paid +${pack.bonus} each` : `+${pack.bonus} each when all finish`}
                </Text>
              </View>
              <View style={styles.track}>
                <View style={[styles.trackFill, { width: `${joined.length ? (finished.length / joined.length) * 100 : 0}%` }]} />
              </View>
              <Text style={styles.small}>
                {pack.bonusPaid
                  ? 'Everyone made it. 🐾'
                  : joined.length < 2
                    ? 'It takes two or more who join.'
                    : `${finished.length} of ${joined.length} done on plan.${open ? ` Friends can join until ${new Date(pack.joinUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` : ''}`}
              </Text>
            </View>

            {mine?.status === 'joined' && (
              <View style={styles.card}>
                <Text style={styles.label}>SEND THE PACK</Text>
                <View style={styles.chips}>
                  {NOTES.map((n) => (
                    <Pressable key={n.key} style={styles.chip} disabled={busy} onPress={() => run(() => sendPackNote(packId, n.key))} accessibilityRole="button">
                      <Text style={styles.chipText}>{n.label}</Text>
                    </Pressable>
                  ))}
                </View>
                {pack.notes.map((n, i) => (
                  <View key={`${n.id}-${n.at}-${i}`} style={styles.row}>
                    <PersonAvatar p={n} size={22} />
                    <Text style={[styles.body, { flex: 1 }]} numberOfLines={1}>
                      <Text style={styles.strong}>{n.name}</Text> {noteLabel(n.note)}
                    </Text>
                    <Text style={styles.small}>{new Date(n.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Text>
                  </View>
                ))}
              </View>
            )}
            {mine?.status === 'invited' && !open && <Text style={styles.small}>This pack fast closed to new people.</Text>}
          </>
        )}
      </ScrollView>
      {pinned && <View style={styles.pinned}>{pinned}</View>}

      {inviting && (
        <TileSheet title="Invite friends" onClose={() => setInviting(false)}>
          {friends === null ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <FriendPickList
              items={friends.filter((f) => !pack?.members.some((m) => m.id === f.userId))}
              pickedIds={picked}
              onUnpick={(id) => setPicked((p) => p.filter((x) => x !== id))}
              renderItem={(f) => {
                const on = picked.includes(f.userId);
                return (
                  <Pressable
                    style={styles.row}
                    onPress={() => setPicked((p) => (on ? p.filter((x) => x !== f.userId) : [...p, f.userId]))}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                  >
                    {on ? <CheckSquareIcon size={22} color={colors.accentActive} weight="fill" /> : <SquareIcon size={22} color={withAlpha(colors.text, 0.4)} />}
                    <Avatar initials={f.initials} tint={colors.accent800} size={32} fontSize={12} frameId={f.frameId} backgroundId={f.backgroundId} iconId={f.iconId} />
                    <Text style={[styles.body, { flex: 1 }]} numberOfLines={1}>
                      {f.name}
                    </Text>
                  </Pressable>
                );
              }}
            />
          )}
          <Button
            label={picked.length ? `Invite ${picked.length}` : 'Pick friends'}
            variant="primary"
            block
            disabled={busy || picked.length === 0}
            onPress={() =>
              run(async () => {
                await inviteToFastPack(packId, picked);
                setPicked([]);
                setInviting(false);
              })
            }
          />
        </TileSheet>
      )}
    </SafeAreaView>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, gap: 12 },
    body0: { padding: 16, gap: 12, paddingBottom: 32 },
    pinned: {
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: withAlpha(colors.text, 0.12),
      backgroundColor: colors.bg,
    },
    pinRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
    card: { borderRadius: 16, backgroundColor: colors.surface, padding: 12, gap: 8 },
    label: { fontSize: 11, letterSpacing: 0.7, color: withAlpha(colors.text, 0.55), fontFamily: font.headingSemibold },
    body: { fontSize: 14.5, lineHeight: 20, color: colors.text, fontFamily: font.body },
    small: { fontSize: 12.5, lineHeight: 17, color: withAlpha(colors.text, 0.62), fontFamily: font.body },
    strong: { fontSize: 14.5, color: colors.text, fontFamily: font.headingSemibold },
    link: { fontSize: 13.5, color: colors.accentActive, fontFamily: font.headingSemibold },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 34 },
    rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: { borderWidth: 1, borderColor: withAlpha(colors.text, 0.18), borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
    chipText: { fontSize: 13, color: colors.text, fontFamily: font.headingSemibold },
    num: { fontSize: 13, color: colors.text, fontFamily: font.headingSemibold, fontVariant: ['tabular-nums'] },
    track: { height: 8, borderRadius: 4, backgroundColor: withAlpha(colors.text, 0.12), overflow: 'hidden' },
    trackFill: { height: 8, borderRadius: 4, backgroundColor: colors.green },
  });
}
