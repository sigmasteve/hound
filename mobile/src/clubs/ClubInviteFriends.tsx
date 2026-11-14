import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { CheckSquareIcon, SquareIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Avatar } from '../components/Avatar';
import { FriendPickList } from '../components/FriendPickList';
import { useTheme } from '../theme/ThemeContext';
import { font, TINT_N, withAlpha, type Palette } from '../theme/tokens';
import { friendsForClub, inviteToClub, type ClubFriend } from './clubsApi';

// A club's Invite friends (0187): your friends list, ticking whoever to
// invite. Each gets a push and an invite on their Clubs tab, which gets
// them in even when the club is private.
export function ClubInviteFriends({ clubId, clubName }: { clubId: string; clubName: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [friends, setFriends] = useState<ClubFriend[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [sending, setSending] = useState(false);

  const load = useCallback(() => {
    friendsForClub(clubId)
      .then(setFriends)
      .catch(() => setFriends([]));
  }, [clubId]);

  useEffect(load, [load]);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const send = async () => {
    setSending(true);
    try {
      const n = await inviteToClub(clubId, picked);
      setPicked([]);
      load();
      Alert.alert('Invited', n === 1 ? `They’ll get a push and an invite to ${clubName} on their Clubs tab.` : `${n} friends will get a push and an invite to ${clubName} on their Clubs tab.`);
    } catch (e) {
      Alert.alert('Couldn’t invite them', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setSending(false);
    }
  };

  const open = (friends ?? []).filter((f) => !f.member);
  const inClub = (friends ?? []).filter((f) => f.member).length;

  return (
    <Card style={{ gap: 10 }} elevated={false}>
      <Text style={styles.kicker}>INVITE FRIENDS</Text>
      {!friends ? (
        <ActivityIndicator color={colors.accent} />
      ) : friends.length === 0 ? (
        <Text style={styles.note}>No friends on Hound yet. Add some on the Friends tab, or share the club&rsquo;s code above.</Text>
      ) : open.length === 0 ? (
        <Text style={styles.note}>All your friends are in the club already.</Text>
      ) : (
        <>
          <FriendPickList
            items={open}
            pickedIds={picked}
            onUnpick={toggle}
            renderItem={(f) => {
            const on = picked.includes(f.userId);
            return (
              <Pressable
                key={f.userId}
                disabled={f.invited}
                onPress={() => toggle(f.userId)}
                style={[styles.row, on && styles.rowOn]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on, disabled: f.invited }}
                accessibilityLabel={f.name}
              >
                <Avatar initials={f.initials} tint={TINT_N} size={32} fontSize={11} frameId={f.frameId} backgroundId={f.backgroundId} iconId={f.iconId} />
                <Text style={styles.name} numberOfLines={1}>
                  {f.name}
                </Text>
                {f.invited ? (
                  <Text style={styles.invited}>Invited</Text>
                ) : on ? (
                  <CheckSquareIcon size={22} color={colors.accent} weight="fill" />
                ) : (
                  <SquareIcon size={22} color={withAlpha(colors.text, 0.4)} />
                )}
              </Pressable>
            );
            }}
          />
          {inClub > 0 && <Text style={styles.note}>{inClub === 1 ? '1 friend is' : `${inClub} friends are`} in the club already.</Text>}
          <Button
            label={sending ? 'Inviting…' : picked.length === 0 ? 'Pick friends to invite' : `Invite ${picked.length === 1 ? '1 friend' : `${picked.length} friends`}`}
            variant="primary"
            disabled={sending || picked.length === 0}
            onPress={send}
          />
        </>
      )}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    kicker: { fontFamily: font.headingSemibold, fontSize: 11.5, letterSpacing: 0.8, color: withAlpha(colors.text, 0.55) },
    note: { fontSize: 13, lineHeight: 18, color: withAlpha(colors.text, 0.65) },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, borderRadius: 12, borderWidth: 1.5, borderColor: 'transparent' },
    rowOn: { borderColor: colors.accent, backgroundColor: withAlpha(colors.accent, 0.08) },
    name: { flex: 1, fontFamily: font.heading, fontSize: 15, color: colors.text },
    invited: { fontFamily: font.headingSemibold, fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
  });
}
