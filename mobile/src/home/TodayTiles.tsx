import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, BackHandler, Easing, Pressable, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { Text } from '../components/Text';
import { CaretRightIcon, XIcon } from 'phosphor-react-native';
import { HoundArt } from '../kennel/HoundArt';
import { useMyMoonLook } from '../kennel/moonApi';
import { levelProgressForXp } from '../challenges/leveling';
import { rankForLevel } from '../challenges/ranks';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import type { Kennel } from '../kennel/kennelApi';
import { HOLIDAY_CORNER, HolidayCorner, HolidayTileCap } from '../holiday/HolidayDecor';
import { useHoliday } from '../holiday/HolidayContext';

// Today as tiles: Your day across the top (YourDayCard.tsx), then small
// tiles for your hound, what needs you and your challenges. Each tile is a
// summary; tapping one opens a sheet (TileSheet) with the full cards that
// used to sit on Today one after another.

export function Tile({
  label,
  badge,
  accessory,
  wide,
  corner,
  onPress,
  accessibilityLabel,
  children,
}: {
  label: string;
  badge?: number;
  // On the right of the label row.
  accessory?: React.ReactNode;
  wide?: boolean;
  // The holiday theme's piece in the corner.
  corner?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const holidayCorner = !!useHoliday() && corner;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.tile, wide ? styles.wide : styles.half, pressed && { opacity: 0.75 }]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      {/* A holiday theme's trim (0184): snow or marigolds along the top. */}
      <HolidayTileCap />
      {holidayCorner && <HolidayCorner />}
      <View style={[styles.labelRow, holidayCorner && { paddingRight: HOLIDAY_CORNER - 4 }]}>
        {/* Shrinks a little rather than cutting off at a larger text size. */}
        <Text style={styles.label} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
          {label}
        </Text>
        {badge !== undefined && badge > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        )}
        {accessory && <View style={{ marginLeft: 'auto' }}>{accessory}</View>}
      </View>
      {children}
    </Pressable>
  );
}

// A tile's big number or word, and the lines under it (a line can have
// its own color, like the step rank's ▲ and ▼).
export type TileLine = string | { text: string; color?: string };

export function TileValue({ value, lines, inline }: { value: string; lines: TileLine[]; inline?: boolean }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // A tile spanning the row on its own (Step rank, Week in review): the
  // number with its lines beside it, so it stays a slim strip rather than
  // a half tile's height stretched across (Steve, Nov 2026).
  if (inline) {
    return (
      <View style={styles.inlineRow}>
        <Text style={[styles.value, { marginTop: 0 }]} numberOfLines={1}>
          {value}
        </Text>
        <View style={{ flex: 1, minWidth: 0 }}>
          {lines.map((line, i) =>
            typeof line === 'string' ? (
              <Text key={i} style={styles.line} numberOfLines={1}>
                {line}
              </Text>
            ) : (
              <Text key={i} style={[styles.line, line.color ? { color: line.color, fontFamily: font.headingSemibold } : null]} numberOfLines={1}>
                {line.text}
              </Text>
            ),
          )}
        </View>
      </View>
    );
  }
  return (
    <>
      <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {value}
      </Text>
      {lines.map((line, i) =>
        typeof line === 'string' ? (
          <Text key={i} style={styles.line} numberOfLines={2}>
            {line}
          </Text>
        ) : (
          <Text key={i} style={[styles.line, line.color ? { color: line.color, fontFamily: font.headingSemibold } : null]} numberOfLines={1}>
            {line.text}
          </Text>
        ),
      )}
    </>
  );
}

const MOOD_WORD: Record<Kennel['mood'], string> = {
  happy: 'Happy',
  okay: 'Doing okay',
  hungry: 'Hungry',
  sleepy: 'Sleepy',
};

export function HoundTile({ kennel, onPress }: { kennel: Kennel; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const rank = rankForLevel(levelProgressForXp(kennel.xpTotal).level);
  const moon = useMyMoonLook();
  return (
    <Tile label={kennel.name} onPress={onPress} accessibilityLabel={`${kennel.name}, ${MOOD_WORD[kennel.mood]}. Open the Kennel`}>
      <TileValue value={MOOD_WORD[kennel.mood]} lines={[kennel.treatedToday ? 'Treated today' : 'Treat ready', 'Kennel ›']} />
      <View style={styles.hound} pointerEvents="none">
        <HoundArt
          rank={rank.id}
          mood={kennel.mood}
          neckId={kennel.neckId}
          headId={kennel.headId}
          faceId={kennel.faceId}
          coatId={kennel.coatId}
          ears={kennel.ears}
          tail={kennel.tail}
          markings={kennel.markings}
          breedId={kennel.breedId}
          bodyId={kennel.bodyId}
          feetId={kennel.feetId}
          moon={moon}
          size={84}
        />
      </View>
    </Tile>
  );
}

// A tile's details, sliding up over Today. Drawn inside the screen rather
// than as a Modal, so the dig, share and celebration popups (which are
// Modals) still open on top of it: iOS shows only one Modal at a time.
export function TileSheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(slide, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [slide]);

  // Android's back button closes the sheet, not the app.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.dim, { opacity: slide }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View
        style={[styles.sheet, { transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [600, 0] }) }] }]}
      >
        <View style={styles.grab} />
        <View style={styles.sheetHeader}>
          <Text style={[text.h4, { flex: 1 }]}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
            <XIcon size={18} color={withAlpha(colors.text, 0.6)} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.sheetBody}>{children}</ScrollView>
      </Animated.View>
    </View>
  );
}

// "See all" at the bottom of a sheet, for the tab with the rest.
export function SheetLink({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.sheetLink, pressed && { opacity: 0.7 }]} accessibilityRole="button">
      <Text style={styles.sheetLinkText}>{label}</Text>
      <CaretRightIcon size={14} color={colors.accentActive} />
    </Pressable>
  );
}

export const tileGrid: ViewStyle = { gap: 10 };
export const tileRow: ViewStyle = { flexDirection: 'row', gap: 10 };

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    tile: {
      backgroundColor: colors.surface,
      borderRadius: 18,
      padding: 13,
      gap: 3,
      overflow: 'hidden',
    },
    // Every flex value spelled out in both: a tile that switches from wide
    // to half (when Week in review loads after the rest) otherwise kept
    // the wide one's sizing and stayed too wide.
    half: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, minHeight: 150 },
    wide: { flexGrow: 1, flexShrink: 1, flexBasis: 'auto', minWidth: 0, minHeight: 0 },
    labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    label: {
      flexShrink: 1,
      fontFamily: font.headingSemibold,
      fontSize: 11.5,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      color: withAlpha(colors.text, 0.55),
    },
    badge: { minWidth: 20, paddingHorizontal: 6, height: 18, borderRadius: 9, backgroundColor: colors.accent400, alignItems: 'center', justifyContent: 'center' },
    badgeText: { fontFamily: font.headingSemibold, fontSize: 11.5, color: '#1b1d29' },
    value: { fontFamily: font.headingSemibold, fontSize: 22, color: colors.text, marginTop: 2 },
    line: { fontSize: 12.5, lineHeight: 17, color: withAlpha(colors.text, 0.6) },
    inlineRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 2 },
    hound: { position: 'absolute', right: -6, bottom: -4 },
    streak: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    streakText: { fontFamily: font.headingSemibold, fontSize: 12.5, color: colors.amber },
    ringsRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 6 },
    legend: { flex: 1, gap: 9 },
    legendRow: { flexDirection: 'row', gap: 8 },
    dot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
    legendValue: { fontFamily: font.headingSemibold, fontSize: 14, color: colors.text },
    legendSub: { fontSize: 12, color: withAlpha(colors.text, 0.6), marginTop: 1 },
    trailTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    trailName: { flexShrink: 1, fontSize: 13, color: colors.text },
    weekTag: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: withAlpha(colors.amber, 0.16) },
    weekTagText: { fontFamily: font.headingSemibold, fontSize: 10.5, color: colors.amber },
    trailLeft: { marginLeft: 'auto', fontSize: 12, color: withAlpha(colors.text, 0.6), maxWidth: '45%' },
    goalsFoot: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
    setGoals: { fontFamily: font.headingSemibold, fontSize: 12.5, color: colors.accentActive },
    dim: { backgroundColor: 'rgba(0,0,0,0.5)' },
    sheet: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      maxHeight: '88%',
      backgroundColor: colors.bg,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      paddingTop: 8,
    },
    grab: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: withAlpha(colors.text, 0.25) },
    sheetHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6 },
    sheetBody: { padding: 16, paddingTop: 6, gap: 14, paddingBottom: 40 },
    sheetLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8 },
    sheetLinkText: { fontFamily: font.headingSemibold, fontSize: 14, color: colors.accentActive },
  });
}
