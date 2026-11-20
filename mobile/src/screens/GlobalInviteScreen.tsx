import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeftIcon, EnvelopeSimpleOpenIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { Card } from '../components/Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { CHALLENGE_TYPES } from '../data/sampleData';
import { canJoin, globalTimingLine, joinDeadlineLine, joinGlobalChallenge, listGlobalChallenges, type GlobalChallenge } from '../challenges/globalChallenges';
import { useCurrencyName } from '../organizations/useCurrencyName';

// Where a push from Hound inviting you to a Global challenge opens (0228,
// Send a push): the challenge, what it is, its prizes and how many are
// in, with Join pinned to the bottom. Already in it: straight to its page.

export function GlobalInviteScreen({
  challengeId,
  onBack,
  onOpen,
}: {
  challengeId: string;
  onBack: () => void;
  onOpen: (challengeId: string) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const currency = useCurrencyName();
  const [c, setC] = useState<GlobalChallenge | null | undefined>(undefined);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    listGlobalChallenges(true)
      .then((all) => {
        const found = all.find((x) => x.id === challengeId) ?? null;
        if (found?.joined) onOpen(challengeId);
        else setC(found);
      })
      .catch(() => setC(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challengeId]);

  const join = () => {
    if (!c) return;
    setJoining(true);
    joinGlobalChallenge(c.id)
      .then(() => onOpen(c.id))
      .catch((e) => Alert.alert('Couldn’t join', e instanceof Error ? e.message : 'Try again in a moment.'))
      .finally(() => setJoining(false));
  };

  const type = c ? CHALLENGE_TYPES.find((t) => t.id === c.kind) : null;
  const open = !!c && canJoin(c);
  const deadline = c ? joinDeadlineLine(c) : null;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.top}>
        <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <ArrowLeftIcon size={20} color={colors.accentActive} />
        </Pressable>
      </View>
      {c === undefined ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : !c ? (
        <View style={styles.center}>
          <Text style={styles.body}>That challenge isn’t around any more.</Text>
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.scroll}>
            <View style={{ gap: 2 }}>
              <Text style={styles.kicker}>GLOBAL HOUND CHALLENGE · {globalTimingLine(c).toUpperCase()}</Text>
              <Text style={styles.title}>{c.name}</Text>
              <Text style={styles.small}>
                {c.participantCount.toLocaleString()} in{deadline ? ` · ${deadline.charAt(0).toLowerCase()}${deadline.slice(1)}` : ''}
              </Text>
            </View>

            <View style={styles.invite}>
              <EnvelopeSimpleOpenIcon size={22} color="#f0c24a" />
              <Text style={[styles.body, { flex: 1, color: colors.text }]}>
                {open ? 'From Hound: you’re invited. Join in one tap; you can leave from its page.' : 'Joining has closed for this one. There’ll be another.'}
              </Text>
            </View>

            {type && (
              <Card style={{ gap: 6 }} elevated={false}>
                <Text style={styles.cardTitle}>{type.name}</Text>
                <Text style={styles.body}>{type.desc}</Text>
              </Card>
            )}

            {(c.prizes || c.sponsor) && (
              <Card style={{ gap: 0, paddingVertical: 4 }} elevated={false}>
                {(c.prizes ?? []).map((b, i) =>
                  b > 0 ? (
                    <View key={i} style={[styles.row, i > 0 && styles.line]}>
                      <Text style={styles.rowKey}>{['1st', '2nd', '3rd'][i]}</Text>
                      <Text style={styles.rowVal}>
                        {b.toLocaleString()} {currency}
                      </Text>
                    </View>
                  ) : null,
                )}
                {c.sponsor && (
                  <View style={[styles.row, c.prizes ? styles.line : null]}>
                    <Text style={styles.rowKey}>Presented by</Text>
                    <Text style={styles.rowVal}>{c.sponsor.name}</Text>
                  </View>
                )}
              </Card>
            )}
          </ScrollView>
          <View style={styles.pinned}>
            <Pressable
              onPress={open ? join : onBack}
              disabled={joining}
              style={[styles.join, !open && styles.joinOff, joining && { opacity: 0.6 }]}
              accessibilityRole="button"
            >
              <Text style={[styles.joinText, !open && { color: colors.text }]}>{joining ? 'Joining…' : open ? `Join ${c.name}` : 'Back'}</Text>
            </Pressable>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    top: { paddingHorizontal: 16, paddingVertical: 6, minHeight: 36 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    scroll: { paddingHorizontal: 16, paddingBottom: 24, gap: 12 },
    kicker: { fontFamily: font.headingSemibold, fontSize: 11.5, letterSpacing: 0.8, color: withAlpha(colors.text, 0.6) },
    title: { fontFamily: font.headingSemibold, fontSize: 24, color: colors.text },
    cardTitle: { fontFamily: font.headingSemibold, fontSize: 15, color: colors.text },
    small: { fontSize: 13, lineHeight: 18, color: withAlpha(colors.text, 0.65) },
    body: { fontSize: 13.5, lineHeight: 19, color: withAlpha(colors.text, 0.8) },
    invite: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, padding: 12, borderWidth: 1.5, borderColor: withAlpha('#f0c24a', 0.55), backgroundColor: withAlpha('#f0c24a', 0.12) },
    row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 10 },
    line: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(colors.text, 0.14) },
    rowKey: { fontSize: 13.5, color: withAlpha(colors.text, 0.7) },
    rowVal: { fontFamily: font.headingSemibold, fontSize: 13.5, color: colors.text },
    pinned: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(colors.text, 0.12) },
    join: { minHeight: 52, borderRadius: 14, backgroundColor: '#7fd39b', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
    joinOff: { backgroundColor: withAlpha(colors.text, 0.1) },
    joinText: { fontFamily: font.headingSemibold, fontSize: 16, color: '#161826', textAlign: 'center' },
  });
}
