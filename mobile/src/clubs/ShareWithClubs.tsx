import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { CheckSquareIcon, SquareIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { isSupabaseConfigured } from '../lib/supabase';
import type { ChallengeKind } from '../challenges/types';
import { CLUB_KINDS, clubsForChallenge, postToClubs, type ShareableClub } from './clubsApi';
import { ClubBadge } from './clubLook';

// "Share with your clubs" (0185). In Create (no challengeId yet), it
// only picks clubs: the challenge is posted once it's made. On a
// challenge's page, its creator posts it to more clubs straight away.
// Nothing shows for someone in no clubs, or for a kind that can't be
// posted (fixed-team games).
export function ShareWithClubs({
  kind,
  challengeId,
  value,
  onChange,
}: {
  kind: ChallengeKind;
  challengeId?: string;
  value?: string[];
  onChange?: (ids: string[]) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [clubs, setClubs] = useState<ShareableClub[] | null>(null);
  const [picked, setPicked] = useState<string[]>(value ?? []);
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    clubsForChallenge(challengeId ?? null)
      .then(setClubs)
      .catch(() => setClubs([]));
  }, [challengeId]);

  if (!CLUB_KINDS.includes(kind) || !clubs || clubs.length === 0) return null;
  const postNow = !!challengeId;
  const toggle = (id: string) => {
    const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
    setPicked(next);
    onChange?.(next);
  };

  const post = async () => {
    if (!challengeId || picked.length === 0) return;
    setPosting(true);
    try {
      const n = await postToClubs(challengeId, picked);
      setClubs((cs) => (cs ?? []).map((c) => (picked.includes(c.id) ? { ...c, posted: true } : c)));
      setPicked([]);
      Alert.alert('Posted', `It’s on ${n === 1 ? 'the club’s page' : `${n} clubs’ pages`}, and members got a push.`);
    } catch (e) {
      Alert.alert('Couldn’t post it', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setPosting(false);
    }
  };

  return (
    <Card style={{ gap: 10 }} elevated={false}>
      <Text style={styles.kicker}>SHARE WITH YOUR CLUBS</Text>
      {clubs.map((c) => {
        const on = c.posted || picked.includes(c.id);
        return (
          <Pressable
            key={c.id}
            disabled={c.posted}
            onPress={() => toggle(c.id)}
            style={[styles.pick, on && styles.pickOn, c.posted && { opacity: 0.7 }]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on, disabled: c.posted }}
          >
            {on ? <CheckSquareIcon size={22} color={colors.accent} weight="fill" /> : <SquareIcon size={22} color={withAlpha(colors.text, 0.4)} />}
            <ClubBadge sport={c.sport} color={c.color} size={32} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{c.name}</Text>
              <Text style={styles.meta}>
                {c.members} {c.members === 1 ? 'member' : 'members'}
                {c.posted ? ' · posted' : ''}
              </Text>
            </View>
          </Pressable>
        );
      })}
      <Text style={styles.note}>
        Members see it on the club&rsquo;s page with a Join button, and get a push. Anyone else can still join with your invite.
      </Text>
      {postNow && picked.length > 0 && (
        <Button label={posting ? 'Posting…' : `Post to ${picked.length === 1 ? 'the club' : `${picked.length} clubs`}`} variant="primary" small disabled={posting} onPress={post} />
      )}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    kicker: { fontFamily: font.headingSemibold, fontSize: 11.5, letterSpacing: 0.8, color: withAlpha(colors.text, 0.55) },
    pick: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12, borderWidth: 1.5, borderColor: colors.divider },
    pickOn: { borderColor: colors.accent, backgroundColor: withAlpha(colors.accent, 0.08) },
    name: { fontFamily: font.heading, fontSize: 15, color: colors.text },
    meta: { fontSize: 12, color: withAlpha(colors.text, 0.6) },
    note: { fontSize: 12.5, lineHeight: 18, color: withAlpha(colors.text, 0.65) },
  });
}
