import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { Text } from '../components/Text';
import { SponsorLine } from '../components/SponsorLine';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { CHALLENGE_TYPES } from '../data/sampleData';
import { CHALLENGE_KIND_ICON, DEFAULT_CHALLENGE_ICON } from '../data/challengeIcons';
import { useCurrencyName } from '../organizations/useCurrencyName';
import { globalTimingLine, joinDeadlineLine, recordSponsorViews, type GlobalChallenge } from '../challenges/globalChallenges';

// Try this (0281): one Global challenge at a time on Today, as an
// invitation: what it is, how many are playing, See it and Join. Swipe
// for the next; Not now (three times and it steps aside for a week).
export function TryThisCard({
  challenges,
  joiningId,
  onJoin,
  onOpen,
  onNotNow,
  onSeen,
  starterStep = null,
}: {
  // Already in Try this's order.
  challenges: GlobalChallenge[];
  joiningId: string | null;
  onJoin: (c: GlobalChallenge) => void;
  onOpen: (c: GlobalChallenge) => void;
  onNotNow: () => void;
  onSeen: (c: GlobalChallenge) => void;
  // Your first week's Global step (0282): the card is ringed and says so.
  starterStep?: { n: number; of: number } | null;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const currencyName = useCurrencyName();
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);
  const scroller = useRef<ScrollView>(null);
  const shown = challenges[Math.min(page, challenges.length - 1)];

  // The one showing: counted once (Admin), and its sponsor's view (0203).
  useEffect(() => {
    if (!shown) return;
    onSeen(shown);
    if (shown.sponsor) recordSponsorViews(shown.id, shown.sponsor.presented ? ['today', 'presented'] : ['today']);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown?.id]);

  if (challenges.length === 0) return null;
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width > 0) setPage(Math.round(e.nativeEvent.contentOffset.x / width));
  };
  const go = (i: number) => {
    setPage(i);
    scroller.current?.scrollTo({ x: i * width, animated: true });
  };

  return (
    <View style={[styles.card, starterStep && styles.ringed]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <View style={styles.head}>
        <Text style={styles.kicker}>
          TRY THIS
          {starterStep ? ` · STEP ${starterStep.n} OF ${starterStep.of}` : challenges.length > 1 ? ` · ${page + 1} OF ${challenges.length}` : ''}
        </Text>
        <Pressable onPress={onNotNow} hitSlop={8} accessibilityRole="button">
          <Text style={styles.notNow}>Not now</Text>
        </Pressable>
      </View>
      {width > 0 && (
        <ScrollView
          ref={scroller}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onScroll}
          scrollEventThrottle={16}
        >
          {challenges.map((c) => {
            const type = CHALLENGE_TYPES.find((t) => t.id === c.kind);
            const Icon = CHALLENGE_KIND_ICON[c.kind] ?? DEFAULT_CHALLENGE_ICON;
            const deadline = joinDeadlineLine(c);
            const prizes = c.prizes?.filter((b) => b > 0) ?? [];
            return (
              <View key={c.id} style={[styles.page, { width }]}>
                <Pressable style={styles.top} onPress={() => onOpen(c)} accessibilityRole="button" accessibilityLabel={`${c.name}. See it`}>
                  <View style={[styles.icon, { backgroundColor: type?.tint ?? withAlpha(colors.text, 0.1) }]}>
                    <Icon size={28} color={type?.iconColor ?? colors.text} weight="fill" />
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text style={styles.name} numberOfLines={1}>
                      {c.name}
                    </Text>
                    <Text style={styles.desc} numberOfLines={2}>
                      {type?.desc ?? ''}
                    </Text>
                  </View>
                </Pressable>
                <Text style={styles.meta} numberOfLines={2}>
                  {c.participantCount > 0 ? `${c.participantCount.toLocaleString()} playing · ` : ''}
                  {globalTimingLine(c)}
                  {prizes.length > 0 ? ` · Top ${prizes.length} win ${prizes.join(' / ')} ${currencyName}` : ''}
                </Text>
                {deadline && <Text style={styles.deadline}>{deadline}</Text>}
                {c.sponsor && <SponsorLine challengeId={c.id} sponsor={c.sponsor} compact />}
                <View style={styles.buttons}>
                  <Pressable onPress={() => onOpen(c)} style={[styles.btn, styles.btnQuiet]} accessibilityRole="button">
                    <Text style={styles.btnQuietText}>See it</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => onJoin(c)}
                    disabled={joiningId === c.id}
                    style={[styles.btn, styles.btnMain]}
                    accessibilityRole="button"
                    accessibilityLabel={`Join ${c.name}`}
                  >
                    {joiningId === c.id ? <ActivityIndicator color="#1b1d29" /> : <Text style={styles.btnMainText}>Join</Text>}
                  </Pressable>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
      {challenges.length > 1 && (
        <View style={styles.dots}>
          {challenges.map((c, i) => (
            <Pressable key={c.id} onPress={() => go(i)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Show ${c.name}`}>
              <View style={[styles.dot, i === page && styles.dotOn]} />
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    card: { borderRadius: 20, backgroundColor: colors.surface, paddingVertical: 12, gap: 8, overflow: 'hidden' },
    ringed: { borderWidth: 2, borderColor: '#f0c24a' },
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14 },
    kicker: { fontSize: 11.5, letterSpacing: 0.8, fontFamily: font.headingSemibold, color: withAlpha(colors.text, 0.6) },
    notNow: { fontSize: 13, fontFamily: font.headingSemibold, color: withAlpha(colors.text, 0.55) },
    page: { paddingHorizontal: 14, gap: 6 },
    top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    icon: { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
    name: { fontSize: 16.5, fontFamily: font.headingSemibold, color: colors.text },
    desc: { fontSize: 12.5, lineHeight: 17, color: withAlpha(colors.text, 0.65) },
    meta: { fontSize: 12.5, color: withAlpha(colors.text, 0.7) },
    deadline: { fontSize: 12, color: colors.amber },
    buttons: { flexDirection: 'row', gap: 10, marginTop: 4 },
    btn: { flex: 1, minHeight: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    btnQuiet: { backgroundColor: withAlpha(colors.text, 0.07) },
    btnQuietText: { fontSize: 14, fontFamily: font.headingSemibold, color: colors.text },
    btnMain: { backgroundColor: '#f0c24a' },
    btnMainText: { fontSize: 14, fontFamily: font.headingSemibold, color: '#1b1d29' },
    dots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: withAlpha(colors.text, 0.2) },
    dotOn: { backgroundColor: colors.text },
  });
}
