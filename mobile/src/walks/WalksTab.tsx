import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { BookOpenIcon, CaretDownIcon, FootprintsIcon, ShareNetworkIcon, XIcon } from 'phosphor-react-native';
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
import { traitInfo } from '../growth/growth';
import { PARK_ROOM } from '../together/ParkArt';
import { togetherNames, type ParkHound, type WalkTogether } from '../together/together';
import type { TogetherState } from '../together/useTogether';
import type { YardHound } from '../kennel/YardArt';

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
  // Together (0170): walks with friends, today's playdate, the dog park.
  together?: TogetherState;
  // Your hound, for the park once you've walked.
  myHound?: YardHound;
  onOpenFriend?: (h: ParkHound) => void;
  // The kitchen, next to the finds, and care (bath, pantry) after them,
  // from the Kennel (0169).
  kitchen?: React.ReactNode;
  care?: React.ReactNode;
}

export function WalksTab({
  houndName,
  growth,
  walks,
  treatedToday,
  goalHitToday,
  waterGoal,
  waterByDay,
  together,
  myHound,
  kitchen,
  care,
}: Props) {
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
  // Who each walk was with (0170).
  const withByWalk = useMemo(() => {
    const m = new Map<string, WalkTogether[]>();
    for (const t of together?.data?.together ?? []) m.set(t.walkId, [...(m.get(t.walkId) ?? []), t]);
    return m;
  }, [together?.data]);
  const playdate = together?.available ? (together.data?.playdate ?? null) : null;
  // The diary waits behind More, so Today opens on what's new.
  const [more, setMore] = useState(false);

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
      const withFriends = [
        ...new Map(dayWalks.flatMap((w) => withByWalk.get(w.id) ?? []).map((t) => [t.userId, t] as const)).values(),
      ];
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
            walkedWith: withFriends.map((t) => t.houndName),
          },
        ),
      });
    }
    return out;
  }, [data, today, waterByDay, waterGoal, treatedToday, goalHitToday, kinds, growth?.profile, withByWalk]);

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
      {playdate && (
        <View style={styles.playdate}>
          <Text style={styles.playdateText}>
            <Text style={styles.playdateTitle}>Playdate! </Text>
            You and {playdate.owner} both finished your goals, so {playdate.houndName} is over to play in your yard.
          </Text>
        </View>
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
              withFriends={withByWalk.get(w.id)}
              styles={styles}
            />
          ))
        )}
      </Card>

      {data && (
        <Card style={{ gap: 10 }} elevated={false}>
          <View style={styles.header}>
            <Text style={text.h4}>Finds</Text>
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

      {kitchen}
      {care}

      {more ? (
        <>
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
        </>
      ) : (
        <Pressable onPress={() => setMore(true)} style={styles.moreRow} accessibilityRole="button">
          <Text style={styles.moreText}>More: {houndName}&rsquo;s diary</Text>
          <CaretDownIcon size={14} color={colors.accentActive} weight="bold" />
        </Pressable>
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

// Kennel → Home on the Park (0170): the friends whose hounds are at the
// dog park, to tap and visit, under the park scene.
export function ParkList({
  together,
  houndName,
  onOpenFriend,
}: {
  together: TogetherState;
  houndName: string;
  onOpenFriend?: (h: ParkHound) => void;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const park = together.available ? together.data : null;
  // A look at the park, once a day per person (for Admin).
  useEffect(() => {
    if (park) logWalkEvent('park_open');
  }, [!!park]);
  if (!park) return null;
  return (
    <Card style={{ gap: 10 }} elevated={false}>
      <View style={styles.header}>
        <Text style={text.h4}>At the park</Text>
        {park.park.length > 0 && (
          <Text style={styles.headerNote}>
            {park.park.length} {park.park.length === 1 ? 'friend' : 'friends'}
          </Text>
        )}
      </View>
      <Text style={styles.note}>
        {park.park.length === 0
          ? `No friends’ hounds out yet. When friends go for a walk, their hounds turn up here${park.meWalked ? '' : `, and so does ${houndName} after yours`}.`
          : `Friends’ hounds out walking in the last day${park.park.length > PARK_ROOM ? ` (the ${PARK_ROOM} most recent are in the park)` : ''}. Tap one to visit.${
              park.meWalked ? '' : ` ${houndName} joins them after your next walk.`
            }`}
      </Text>
      {park.park.length > 0 && (
        <View style={styles.parkChips}>
          {park.park.map((h) => (
            <Pressable
              key={h.userId}
              onPress={() => onOpenFriend?.(h)}
              style={styles.parkChip}
              accessibilityRole="button"
              accessibilityLabel={`${h.hound.name}, ${h.owner}'s hound, out ${h.minutes} minutes${h.withMe ? ', walked with you' : ''}. Visit ${h.owner}`}
            >
              <Text style={styles.parkChipText} numberOfLines={1}>
                {h.withMe ? '♥ ' : ''}
                <Text style={styles.parkChipName}>{h.hound.name}</Text> · {h.owner} · {h.minutes} min
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </Card>
  );
}

function WalkRow({
  walk,
  find,
  capped,
  withFriends,
  styles,
}: {
  walk: HoundWalk;
  find?: FindKind;
  capped: boolean;
  // Friends' hounds on this walk too (0170).
  withFriends?: WalkTogether[];
  styles: Styles;
}) {
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
        {withFriends && withFriends.length > 0 && (
          <Text style={[styles.walkFind, { color: colors.accentActive }]}>With {togetherNames(withFriends)}</Text>
        )}
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
      <View style={styles.backdrop}>
        {/* Behind the sheet, so a tap outside closes it without stealing the sheet's scrolling. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={styles.sheet}>
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
        </View>
      </View>
    </Modal>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    playdate: { padding: 12, borderRadius: 14, backgroundColor: withAlpha(colors.accent, 0.12) },
    playdateText: { fontSize: 13.5, lineHeight: 19, color: withAlpha(colors.text, 0.8) },
    playdateTitle: { fontFamily: font.heading, color: colors.text },
    moreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12 },
    moreText: { fontFamily: font.heading, fontSize: 14, color: colors.accentActive },
    parkChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    parkChip: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 14,
      backgroundColor: withAlpha(colors.accent, 0.1),
      maxWidth: '100%',
    },
    parkChipText: { fontSize: 12.5, color: withAlpha(colors.text, 0.7) },
    parkChipName: { fontFamily: font.heading, color: colors.text },
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
