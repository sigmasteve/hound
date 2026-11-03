import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { BookOpenIcon, FootprintsIcon, ShareNetworkIcon, XIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { dayKeyBefore, type WaterGoal } from '../water/water';
import { FindArt } from './FindArt';
import { diaryDayLabel, diaryLine, diaryShareText } from './diary';
import { RARITY_NAMES, SEASON_NAMES, walkName, walkStats, type FindKind, type HoundWalk, type Season } from './walks';
import { logWalkEvent } from './walksApi';
import type { HoundWalksState } from './useHoundWalks';
import type { HoundProfileState } from '../growth/useHoundProfile';
import { AboutCard } from '../growth/AboutCard';
import { traitInfo } from '../growth/growth';

// The Kennel's Walks tab (lifestyle phase 1, 0161): today's walks and
// what each found, the Hound's diary for the week, and the collection
// book of every kind of find.

interface Props {
  houndName: string;
  // Fitness, age, traits and the birthday (0165).
  growth?: HoundProfileState;
  walks: HoundWalksState;
  treatedToday: boolean;
  goalHitToday: boolean;
  waterGoal: WaterGoal | null;
  waterByDay: Map<string, number>;
}

export function WalksTab({ houndName, growth, walks, treatedToday, goalHitToday, waterGoal, waterByDay }: Props) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [bookOpen, setBookOpen] = useState(false);
  const data = walks.data;
  const today = walks.today;

  // The diary is on screen whenever this tab is (for Admin).
  useEffect(() => {
    logWalkEvent('diary_open');
  }, []);

  const kinds = useMemo(() => new Map((data?.kinds ?? []).map((k) => [k.id, k])), [data]);
  const todays = (data?.walks ?? []).filter((w) => w.day === today);

  // A line a day, newest first, for days there's something to go on.
  const diary = useMemo(() => {
    if (!data) return [];
    const out: { day: string; label: string; line: string }[] = [];
    for (let i = 0; i < 7; i++) {
      const day = dayKeyBefore(i, new Date(`${today}T12:00:00`));
      const dayWalks = data.walks.filter((w) => w.day === day);
      const steps = data.stepsByDay.get(day) ?? null;
      if (dayWalks.length === 0 && steps === null && i > 0) continue;
      const ml = waterByDay.get(day) ?? 0;
      const profile = growth?.profile;
      const traitsToday = (profile?.traits ?? []).filter((t) => dayKeyBefore(0, t.earnedAt) === day).map((t) => traitInfo(t.id).name);
      out.push({
        day,
        label: diaryDayLabel(day, today),
        line: diaryLine(
          {
            day,
            walks: dayWalks,
            steps,
            waterMet: waterGoal ? ml >= waterGoal.targetMl : null,
            treated: i === 0 ? treatedToday : undefined,
            goalHit: i === 0 ? goalHitToday : undefined,
          },
          kinds,
          {
            birthday: i === 0 && !!profile?.isBirthday,
            newTraits: traitsToday,
          },
        ),
      });
    }
    return out;
  }, [data, today, waterByDay, waterGoal, treatedToday, goalHitToday, kinds, growth?.profile]);

  const foundKinds = (data?.kinds ?? []).filter((k) => data?.found.has(k.id));

  const share = () => {
    logWalkEvent('diary_share');
    Share.share({ message: diaryShareText(houndName, diary) }).catch(() => {});
  };

  if (!walks.available) {
    return (
      <Card style={{ gap: 6 }} elevated={false}>
        <Text style={text.h4}>Walks</Text>
        <Text style={styles.note}>Walks are on their way. Check back after the next update.</Text>
      </Card>
    );
  }

  return (
    <>
      {growth?.profile && (
        <AboutCard profile={growth.profile} today={today} onSetBirthday={growth.setBirthday} busy={growth.busy} />
      )}
      <Card style={{ gap: 10 }} elevated={false}>
        <View style={styles.header}>
          <Text style={text.h4}>Today&rsquo;s walks</Text>
          {data && todays.length > 0 && (
            <Text style={styles.headerNote}>
              {todays.length} {todays.length === 1 ? 'walk' : 'walks'}
            </Text>
          )}
        </View>
        {!data ? (
          <Text style={styles.note}>Looking for today&rsquo;s walks…</Text>
        ) : todays.length === 0 ? (
          <Text style={styles.note}>
            No walks yet today. Head out with {houndName} for 10 minutes or more and see what you find.
          </Text>
        ) : (
          todays.map((w) => (
            <WalkRow
              key={w.id}
              walk={w}
              find={w.findId ? kinds.get(w.findId) : undefined}
              capped={todays.filter((t) => t.findId).length >= 5}
              styles={styles}
            />
          ))
        )}
      </Card>

      {diary.length > 0 && (
        <Card style={{ gap: 10 }} elevated={false}>
          <View style={styles.header}>
            <Text style={text.h4}>{houndName}&rsquo;s diary</Text>
            <Pressable onPress={share} hitSlop={10} style={styles.shareBtn} accessibilityRole="button" accessibilityLabel="Share the week">
              <ShareNetworkIcon size={15} color={colors.accent} />
              <Text style={styles.shareText}>Share the week</Text>
            </Pressable>
          </View>
          {diary.map((d, i) => (
            <View key={d.day} style={[styles.diaryRow, i > 0 && styles.rowRule]}>
              <Text style={styles.diaryDay}>{d.label}</Text>
              <Text style={[styles.diaryLine, i === 0 && styles.diaryToday]}>{d.line}</Text>
            </View>
          ))}
          <Text style={styles.footNote}>Only you see this, unless you share it.</Text>
        </Card>
      )}

      {data && (
        <Card style={{ gap: 10 }} elevated={false}>
          <View style={styles.header}>
            <Text style={text.h4}>Collection</Text>
            <Text style={styles.headerNote}>
              {foundKinds.length} of {data.kinds.length} found
            </Text>
          </View>
          {foundKinds.length === 0 ? (
            <Text style={styles.note}>Every walk brings something home. Longer walks find rarer things.</Text>
          ) : (
            <View style={styles.previewRow}>
              {foundKinds.slice(0, 8).map((k) => (
                <View key={k.id} style={styles.previewTile}>
                  <FindArt id={k.id} size={34} />
                </View>
              ))}
            </View>
          )}
          <Button
            label="Open the collection book"
            variant="secondary"
            small
            icon={<BookOpenIcon size={15} color={colors.accent} />}
            onPress={() => {
              logWalkEvent('book_open');
              setBookOpen(true);
            }}
          />
        </Card>
      )}

      {bookOpen && data && (
        <CollectionSheet
          kinds={data.kinds}
          found={data.found}
          season={data.season}
          onClose={() => setBookOpen(false)}
          styles={styles}
        />
      )}
    </>
  );
}

function WalkRow({ walk, find, capped, styles }: { walk: HoundWalk; find?: FindKind; capped: boolean; styles: Styles }) {
  const { colors } = useTheme();
  const at = walk.startedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return (
    <View style={styles.walkRow}>
      <View style={[styles.walkIcon, find && find.rarity === 'rare' && styles.walkIconRare]}>
        {find ? <FindArt id={find.id} size={34} /> : <FootprintsIcon size={22} color={withAlpha(colors.text, 0.45)} />}
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={styles.walkName}>
          {walkName(walk)} <Text style={styles.walkAt}>· {at}</Text>
        </Text>
        <Text style={styles.walkStats}>{walkStats(walk)}</Text>
        <Text style={[styles.walkFind, find?.rarity === 'rare' && { color: colors.amber }]}>
          {walk.walking
            ? 'Still out walking. Something to find when you’re back.'
            : find
              ? `Found: ${find.name}${find.rarity === 'common' ? '' : ` · ${RARITY_NAMES[find.rarity]}`}`
              : capped
                ? 'Nothing this time: five finds a day is the most.'
                : 'Nothing this time. Walks of 10 minutes or more find something.'}
        </Text>
      </View>
    </View>
  );
}

const GROUPS: { season: Season | null; title: string }[] = [
  { season: null, title: 'All year' },
  { season: 'autumn', title: 'Autumn' },
  { season: 'winter', title: 'Winter' },
  { season: 'spring', title: 'Spring' },
  { season: 'summer', title: 'Summer' },
];

function CollectionSheet({
  kinds,
  found,
  season,
  onClose,
  styles,
}: {
  kinds: FindKind[];
  found: Map<string, { count: number; firstAt: Date | null }>;
  season: Season;
  onClose(): void;
  styles: Styles;
}) {
  const { colors, text } = useTheme();
  const total = kinds.filter((k) => found.has(k.id)).length;
  // This season first after All year, the rest in order.
  const groups = [GROUPS[0], ...GROUPS.slice(1).filter((g) => g.season === season), ...GROUPS.slice(1).filter((g) => g.season !== season)];
  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close">
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.header}>
            <BookOpenIcon size={20} color={colors.accent} weight="fill" />
            <Text style={[text.h4, { flex: 1 }]}>Collection book</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <XIcon size={18} color={withAlpha(colors.text, 0.5)} />
            </Pressable>
          </View>
          <Text style={styles.note}>
            {total} of {kinds.length} found. Longer walks find rarer things, and each season has its own.
          </Text>
          <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ gap: 14, paddingBottom: 6 }}>
            {groups.map((g) => {
              const items = kinds.filter((k) => k.season === g.season);
              if (items.length === 0) return null;
              const now = g.season === season;
              return (
                <View key={g.title} style={{ gap: 6 }}>
                  <Text style={styles.groupTitle}>
                    {g.title.toUpperCase()}
                    {now ? '  ·  NOW' : g.season ? '  ·  LATER IN THE YEAR' : ''}
                  </Text>
                  <View style={styles.bookGrid}>
                    {items.map((k) => {
                      const f = found.get(k.id);
                      return (
                        <View key={k.id} style={[styles.bookTile, k.rarity === 'rare' && f && styles.bookTileRare]}>
                          <FindArt id={k.id} size={40} hidden={!f} hiddenColor={colors.text} />
                          <Text style={styles.bookName} numberOfLines={2}>
                            {f ? k.name : 'Not found yet'}
                          </Text>
                          <Text style={styles.bookNote}>
                            {f ? `×${f.count}` : k.season && !now ? `${SEASON_NAMES[k.season]} only` : RARITY_NAMES[k.rarity]}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'space-between' },
    headerNote: { fontSize: 13, color: withAlpha(colors.text, 0.55) },
    note: { fontSize: 13.5, color: withAlpha(colors.text, 0.65), lineHeight: 19 },
    footNote: { fontSize: 12, color: withAlpha(colors.text, 0.45) },
    walkRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
    walkIcon: {
      width: 50,
      height: 50,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: withAlpha(colors.text, 0.06),
    },
    walkIconRare: { backgroundColor: withAlpha(colors.amber, 0.16), borderWidth: 1.5, borderColor: withAlpha(colors.amber, 0.6) },
    walkName: { fontFamily: font.headingSemibold, fontSize: 15, color: colors.text },
    walkAt: { fontFamily: font.body, fontSize: 13, color: withAlpha(colors.text, 0.5) },
    walkStats: { fontSize: 13, color: withAlpha(colors.text, 0.65) },
    walkFind: { fontSize: 13, color: colors.accentActive },
    shareBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    shareText: { fontFamily: font.headingSemibold, fontSize: 13, color: colors.accent },
    diaryRow: { gap: 2, paddingTop: 2 },
    rowRule: { paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(colors.text, 0.08) },
    diaryDay: { fontFamily: font.headingSemibold, fontSize: 12.5, color: withAlpha(colors.text, 0.5) },
    diaryLine: { fontSize: 14.5, color: withAlpha(colors.text, 0.85), lineHeight: 20 },
    diaryToday: { color: colors.text },
    previewRow: { flexDirection: 'row', gap: 8, overflow: 'hidden' },
    previewTile: {
      width: 44,
      height: 44,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: withAlpha(colors.text, 0.06),
    },
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      padding: 18,
      paddingBottom: 30,
      gap: 12,
    },
    groupTitle: { fontFamily: font.headingSemibold, fontSize: 11.5, letterSpacing: 0.6, color: withAlpha(colors.text, 0.5) },
    bookGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    bookTile: {
      width: '31%',
      flexGrow: 1,
      maxWidth: '33%',
      alignItems: 'center',
      gap: 3,
      paddingVertical: 10,
      paddingHorizontal: 6,
      borderRadius: 14,
      backgroundColor: withAlpha(colors.text, 0.05),
    },
    bookTileRare: { backgroundColor: withAlpha(colors.amber, 0.14), borderWidth: 1.5, borderColor: withAlpha(colors.amber, 0.55) },
    bookName: { fontFamily: font.headingSemibold, fontSize: 12.5, color: colors.text, textAlign: 'center' },
    bookNote: { fontSize: 11.5, color: withAlpha(colors.text, 0.55) },
  });
}
