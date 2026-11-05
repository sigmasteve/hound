import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeftIcon, MagnifyingGlassIcon, RobotIcon, SlidersHorizontalIcon, SparkleIcon, XIcon } from 'phosphor-react-native';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { TextField } from '../components/TextField';
import { GlobalChallengesCard } from '../components/GlobalChallengesCard';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { CHALLENGE_TYPES, type ChallengeKind } from '../data/sampleData';
import { CHALLENGE_KIND_ICON } from '../data/challengeIcons';
import { canJoin, joinGlobalChallenge, listGlobalChallenges, type GlobalChallenge } from '../challenges/globalChallenges';
import { getMyInterests, type Interest } from '../onboarding/interests';
import {
  COUNTS_NAMES,
  FORMAT_NAMES,
  LEVEL_NAMES,
  NO_FILTERS,
  PLAYERS_NAMES,
  globalMatches,
  isFiltered,
  kindName,
  rankKinds,
  suitScore,
  type Filters,
  type KindInfo,
} from '../discover/discoverCatalog';

// Discover (K-01): find a challenge that fits. Search and filter by
// format, what counts, who plays and how hard it is. Global challenges
// still open to join come first; then every kind of challenge you can
// start, best fits for your interests (K-08) first, each with a clear
// sheet of how it works.

type FilterKey = 'format' | 'counts' | 'players' | 'level';

const FILTER_ROWS: { key: FilterKey; label: string; options: Record<string, string> }[] = [
  { key: 'format', label: 'Format', options: FORMAT_NAMES },
  { key: 'counts', label: 'What counts', options: COUNTS_NAMES },
  { key: 'players', label: 'Who plays', options: PLAYERS_NAMES },
  { key: 'level', label: 'Level', options: LEVEL_NAMES },
];

export function DiscoverScreen({
  onBack,
  onOpenChallenge,
  onStart,
}: {
  onBack: () => void;
  onOpenChallenge: (challengeId: string) => void;
  onStart: (kind: ChallengeKind) => void;
}) {
  const { colors, text } = useTheme();
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <DiscoverContent
        onOpenChallenge={onOpenChallenge}
        onStart={onStart}
        top={
          <>
            <Button label="Back" variant="ghost" small icon={<ArrowLeftIcon size={13} color={colors.accent} />} onPress={onBack} />
            <Text style={text.h2}>Discover</Text>
          </>
        }
      />
    </SafeAreaView>
  );
}

// Discover's search, filters, global challenges open to join, and the
// kinds to start: its own screen, and the Challenges screen's Join tab.
export function DiscoverContent({
  onOpenChallenge,
  onStart,
  top,
  onOpenCount,
}: {
  onOpenChallenge: (challengeId: string) => void;
  onStart: (kind: ChallengeKind) => void;
  // Shown first in the scroll, over the search.
  top?: React.ReactNode;
  // How many global challenges are open to join, for the Join tab's dot.
  onOpenCount?: (n: number) => void;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [interests, setInterests] = useState<Interest[]>([]);
  const [globals, setGlobals] = useState<GlobalChallenge[]>([]);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [detail, setDetail] = useState<KindInfo | null>(null);
  // The four rows of filter chips, folded behind "Filters" so the search
  // and the challenges come first.
  const [showFilters, setShowFilters] = useState(false);

  useFocusEffect(
    useCallback(() => {
      listGlobalChallenges()
        // Only ones you can still join: not ones you're already in, and
        // not ones whose joining has closed.
        .then((all) => {
          const open = all.filter((c) => canJoin(c));
          setGlobals(open);
          onOpenCount?.(open.length);
        })
        .catch(() => setGlobals([]));
      getMyInterests()
        .then((i) => setInterests(i ?? []))
        .catch(() => {});
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const toggle = (key: FilterKey, id: string) =>
    setFilters((f) => {
      const cur = f[key] as string[];
      return { ...f, [key]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] };
    });

  const join = (c: GlobalChallenge) => {
    setJoiningId(c.id);
    joinGlobalChallenge(c.id)
      .then(() => onOpenChallenge(c.id))
      .catch((e) => Alert.alert('Couldn’t join', e instanceof Error ? e.message : 'Try again in a moment.'))
      .finally(() => setJoiningId(null));
  };

  const openGlobals = globals.filter((c) => globalMatches(c, filters));
  const kinds = rankKinds(filters, interests);
  const filtered = isFiltered(filters);
  const chipCount = filters.format.length + filters.counts.length + filters.players.length + filters.level.length;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {top}

        <View style={styles.searchRow}>
          <TextField
            label=""
            style={{ flex: 1 }}
            icon={<MagnifyingGlassIcon size={18} color={withAlpha(colors.text, 0.55)} />}
            placeholder="Search: football, marathon, bingo…"
            value={filters.query}
            onChangeText={(query) => setFilters((f) => ({ ...f, query }))}
            returnKeyType="search"
            autoCorrect={false}
            accessibilityLabel="Search challenges"
          />
          <Pressable
            onPress={() => setShowFilters((v) => !v)}
            style={[styles.filtersButton, (showFilters || chipCount > 0) && styles.filtersButtonOn]}
            accessibilityRole="button"
            accessibilityState={{ expanded: showFilters }}
            accessibilityLabel={`Filters${chipCount > 0 ? `, ${chipCount} on` : ''}`}
          >
            <SlidersHorizontalIcon size={17} color={colors.accentActive} />
            <Text style={styles.filtersText}>{chipCount > 0 ? `Filters · ${chipCount}` : 'Filters'}</Text>
          </Pressable>
        </View>

        <View style={{ gap: 10 }}>
          {showFilters && FILTER_ROWS.map((row) => (
            <View key={row.key} style={{ gap: 6 }}>
              <Text style={styles.rowLabel}>{row.label}</Text>
              <View style={styles.chips}>
                {Object.entries(row.options).map(([id, name]) => {
                  const on = (filters[row.key] as string[]).includes(id);
                  return (
                    <Pressable
                      key={id}
                      style={[styles.chip, on && styles.chipOn]}
                      onPress={() => toggle(row.key, id)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={`${row.label}: ${name}`}
                    >
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{name}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
          {filtered && (
            <Pressable onPress={() => setFilters(NO_FILTERS)} hitSlop={8} style={styles.clear} accessibilityRole="button">
              <XIcon size={14} color={colors.accentActive} />
              <Text style={styles.clearText}>Clear search and filters</Text>
            </Pressable>
          )}
        </View>

        {openGlobals.length > 0 && (
          <View style={{ gap: 8 }}>
            <Text style={text.h4}>Open to join</Text>
            <GlobalChallengesCard
              challenges={openGlobals}
              joiningId={joiningId}
              onJoin={join}
              onOpen={(c) => onOpenChallenge(c.id)}
              where="challenges"
            />
          </View>
        )}

        <View style={{ gap: 8 }}>
          <Text style={text.h4}>Start your own</Text>
          <Text style={styles.note}>
            {interests.length > 0
              ? 'Best fits for your interests first. Invite friends, or add bots where they can play.'
              : 'Invite friends, or add bots where they can play.'}
          </Text>
          {kinds.length === 0 ? (
            <Card elevated={false} style={{ gap: 8, alignItems: 'flex-start' }}>
              <Text style={styles.name}>Nothing matches that.</Text>
              <Text style={styles.note}>Try fewer filters, or another word.</Text>
              <Button label="Clear search and filters" variant="ghost" small onPress={() => setFilters(NO_FILTERS)} />
            </Card>
          ) : (
            kinds.map((info) => (
              <KindRow key={info.kind} info={info} forYou={suitScore(info, interests) > 0} onPress={() => setDetail(info)} />
            ))
          )}
        </View>
      </ScrollView>

      {detail && (
        <KindSheet
          info={detail}
          onClose={() => setDetail(null)}
          onStart={() => {
            setDetail(null);
            onStart(detail.kind);
          }}
        />
      )}
    </View>
  );
}

function tagLine(info: KindInfo): string {
  return [
    info.counts.map((c) => COUNTS_NAMES[c]).join(' or '),
    info.players.map((p) => PLAYERS_NAMES[p]).join(', '),
    LEVEL_NAMES[info.level],
  ].join(' · ');
}

function KindIcon({ kind, size = 44 }: { kind: ChallengeKind; size?: number }) {
  const type = CHALLENGE_TYPES.find((t) => t.id === kind);
  const Icon = CHALLENGE_KIND_ICON[kind];
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: type?.tint }}>
      {Icon && <Icon size={size * 0.5} color={type?.iconColor} weight="fill" />}
    </View>
  );
}

function KindRow({ info, forYou, onPress }: { info: KindInfo; forYou: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${kindName(info.kind)}. ${info.summary}`}>
      {({ pressed }) => (
        <Card elevated={false} style={pressed ? [styles.kindRow, { opacity: 0.75 }] : styles.kindRow}>
          <KindIcon kind={info.kind} />
          <View style={{ flex: 1, gap: 3 }}>
            <View style={styles.nameRow}>
              <Text style={styles.name}>{kindName(info.kind)}</Text>
              {forYou && (
                <View style={styles.forYou}>
                  <SparkleIcon size={11} color={colors.amber} weight="fill" />
                  <Text style={styles.forYouText}>For you</Text>
                </View>
              )}
            </View>
            <Text style={styles.summary}>{info.summary}</Text>
            <Text style={styles.tags}>{tagLine(info)}</Text>
          </View>
        </Card>
      )}
    </Pressable>
  );
}

// "Clear challenge detail": everything about a kind before you start one.
function KindSheet({ info, onClose, onStart }: { info: KindInfo; onClose: () => void; onStart: () => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const type = CHALLENGE_TYPES.find((t) => t.id === info.kind);
  const facts: [string, string][] = [
    ['How you win', info.howToWin],
    ['Who it’s for', info.who],
    ['What counts', info.counts.map((c) => COUNTS_NAMES[c]).join(', ')],
    ['How long', info.length],
    ['Level', LEVEL_NAMES[info.level]],
  ];
  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {/* Behind the sheet, so a tap outside closes it without stealing the sheet's scrolling. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <ScrollView contentContainerStyle={{ gap: 12 }}>
            <View style={styles.nameRow}>
              <KindIcon kind={info.kind} size={52} />
              <Text style={[styles.sheetTitle, { flex: 1 }]}>{kindName(info.kind)}</Text>
            </View>
            <Text style={styles.desc}>{type?.desc}</Text>
            {facts.map(([label, value]) => (
              <View key={label} style={styles.fact}>
                <Text style={styles.factLabel}>{label}</Text>
                <Text style={styles.factValue}>{value}</Text>
              </View>
            ))}
            <View style={styles.botsRow}>
              <RobotIcon size={16} color={withAlpha(colors.text, 0.7)} />
              <Text style={styles.factValue}>{info.bots ? 'Bots can fill in when friends can’t.' : 'Friends only: no bots in this one.'}</Text>
            </View>
          </ScrollView>
          <View style={styles.sheetButtons}>
            <Button label="Close" variant="ghost" onPress={onClose} />
            <Button label={`Start ${kindName(info.kind)}`} variant="primary" onPress={onStart} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    container: { padding: 16, gap: 16, paddingBottom: 48 },
    rowLabel: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      minHeight: 36,
      paddingHorizontal: 14,
      justifyContent: 'center',
      borderRadius: 999,
      borderWidth: 1,
      borderColor: withAlpha(colors.text, 0.2),
    },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { fontFamily: font.heading, fontSize: 13.5, color: colors.text },
    chipTextOn: { color: '#ffffff' },
    clear: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
    searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    filtersButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      minHeight: 46,
      paddingHorizontal: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: withAlpha(colors.text, 0.15),
    },
    filtersButtonOn: { borderColor: colors.accent, backgroundColor: withAlpha(colors.accent, 0.1) },
    filtersText: { fontFamily: font.heading, fontSize: 14, color: colors.accentActive },
    clearText: { fontFamily: font.heading, fontSize: 13.5, color: colors.accentActive },
    note: { fontSize: 13, color: withAlpha(colors.text, 0.6) },
    kindRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    name: { fontFamily: font.headingSemibold, fontSize: 16, color: colors.text },
    summary: { fontSize: 13.5, lineHeight: 19, color: withAlpha(colors.text, 0.8) },
    tags: { fontSize: 12, color: withAlpha(colors.text, 0.6) },
    forYou: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 999,
      backgroundColor: withAlpha(colors.amber, 0.16),
    },
    forYouText: { fontFamily: font.headingSemibold, fontSize: 11, color: colors.amber },
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
    sheet: {
      maxHeight: '85%',
      gap: 14,
      padding: 20,
      paddingBottom: 32,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      backgroundColor: colors.surface,
    },
    sheetTitle: { fontFamily: font.headingSemibold, fontSize: 24, color: colors.text },
    desc: { fontSize: 14.5, lineHeight: 21, color: colors.text },
    fact: { gap: 2 },
    factLabel: { fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', color: withAlpha(colors.text, 0.6), fontFamily: font.headingSemibold },
    factValue: { fontSize: 14, lineHeight: 20, color: colors.text, flexShrink: 1 },
    botsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    sheetButtons: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
  });
}
