import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { CakeIcon, HeartbeatIcon, SparkleIcon, XIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { Card } from '../components/Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import {
  ageText,
  birthdayText,
  STAGE_NAMES,
  STAGE_NEXT,
  traitInfo,
  TRAITS,
  type HoundProfile,
} from './growth';

// Kennel → Walks → About (0164): the hound's age and stage, its
// birthday, fitness, and the traits its habits have earned. With
// `onSetBirthday` it's yours and the birthday can be picked; without,
// it's a friend's, read only.

function Bar({ value, styles }: { value: number; styles: Styles }) {
  return (
    <View style={styles.bar}>
      <View style={[styles.barFill, { width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }]} />
    </View>
  );
}

export function AboutCard({
  profile,
  today,
  onSetBirthday,
  busy = false,
}: {
  profile: HoundProfile;
  today: string;
  onSetBirthday?: (birthday: string) => Promise<boolean>;
  busy?: boolean;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [traitsOpen, setTraitsOpen] = useState(false);
  const [birthdayOpen, setBirthdayOpen] = useState(false);
  const p = profile;
  const mine = !!onSetBirthday;
  const age = ageText(p.bornOn, today);
  const next = STAGE_NEXT[p.stage];
  const fitSpan = p.fitnessNext !== null ? p.fitnessNext - p.fitnessFrom : 1;
  const fitShare = p.fitnessNext !== null ? (p.activeDays - p.fitnessFrom) / fitSpan : 1;

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <View style={styles.header}>
        <Text style={text.h4}>{mine ? `About ${p.name}` : p.name}</Text>
        <Text style={styles.stageChip}>
          {STAGE_NAMES[p.stage]}
          {age ? ` · ${age}` : ''}
        </Text>
      </View>

      {p.isBirthday && (
        <View style={styles.birthdayBanner}>
          <CakeIcon size={20} color="#c2366a" weight="fill" />
          <Text style={styles.birthdayText}>
            It&rsquo;s {p.name}&rsquo;s birthday today!{' '}
            {mine ? 'The party’s on in the yard.' : 'There’s a party on in their yard.'}
          </Text>
        </View>
      )}

      {mine && next !== null && p.stepsSinceBorn !== null && (
        <View style={styles.section}>
          <Text style={styles.label}>
            {p.stage === 'puppy' ? 'Grows into a young hound' : 'Fully grown'} at {next.toLocaleString()} steps
          </Text>
          <Bar value={p.stepsSinceBorn / next} styles={styles} />
          <Text style={styles.note}>{p.stepsSinceBorn.toLocaleString()} steps since it was born.</Text>
        </View>
      )}

      <View style={styles.section}>
        <View style={styles.rowTitle}>
          <HeartbeatIcon size={16} color={colors.accent} weight="bold" />
          <Text style={styles.label}>
            Fitness <Text style={styles.strong}>{p.fitness}</Text> of 10
          </Text>
        </View>
        <Bar value={fitShare} styles={styles} />
        <Text style={styles.note}>
          {p.activeDays} active {p.activeDays === 1 ? 'day' : 'days'}
          {p.fitnessNext !== null ? `. ${p.fitnessNext - p.activeDays} more to fitness ${p.fitness + 1}.` : '. As fit as a hound gets.'}
          {mine ? ' An active day is 5,000 steps. Fitness only goes up, and a fitter hound is livelier in the yard.' : ''}
        </Text>
      </View>

      <View style={styles.section}>
        <View style={styles.rowTitle}>
          <SparkleIcon size={16} color={colors.accent} weight="fill" />
          <Text style={styles.label}>Traits</Text>
        </View>
        {p.traits.length === 0 ? (
          <Text style={styles.note}>{mine ? 'Habits become traits: walk early, walk far, drink your water…' : 'None yet.'}</Text>
        ) : (
          <View style={styles.chips}>
            {p.traits.map((t) => (
              <Text key={t.id} style={styles.traitChip}>
                {traitInfo(t.id).name}
              </Text>
            ))}
          </View>
        )}
        {mine && (
          <Pressable onPress={() => setTraitsOpen(true)} hitSlop={8} accessibilityRole="button">
            <Text style={styles.link}>All {TRAITS.length} traits and how to earn them</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.birthdayRow}>
        <CakeIcon size={16} color={withAlpha(colors.text, 0.6)} />
        <Text style={[styles.note, { flex: 1 }]}>
          Birthday: <Text style={styles.strong}>{birthdayText(p.birthday) ?? 'not set'}</Text>
        </Text>
        {mine && (
          <Pressable onPress={() => setBirthdayOpen(true)} hitSlop={8} accessibilityRole="button" disabled={busy}>
            {busy ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.link}>Change</Text>}
          </Pressable>
        )}
      </View>

      {traitsOpen && <TraitsSheet profile={p} onClose={() => setTraitsOpen(false)} styles={styles} />}
      {birthdayOpen && onSetBirthday && (
        <BirthdaySheet
          name={p.name}
          current={p.birthday}
          onClose={() => setBirthdayOpen(false)}
          onSave={async (b) => {
            if (await onSetBirthday(b)) setBirthdayOpen(false);
          }}
          styles={styles}
        />
      )}
    </Card>
  );
}

function Sheet({ title, onClose, children, styles }: { title: string; onClose(): void; children: React.ReactNode; styles: Styles }) {
  const { colors, text } = useTheme();
  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close">
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.header}>
            <Text style={[text.h4, { flex: 1 }]}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <XIcon size={18} color={withAlpha(colors.text, 0.5)} />
            </Pressable>
          </View>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function TraitsSheet({ profile, onClose, styles }: { profile: HoundProfile; onClose(): void; styles: Styles }) {
  const earned = new Map(profile.traits.map((t) => [t.id, t.earnedAt]));
  return (
    <Sheet title="Traits" onClose={onClose} styles={styles}>
      <Text style={styles.note}>Habits become traits, and once earned they&rsquo;re kept for good. Friends see them too.</Text>
      <ScrollView style={{ maxHeight: 440 }} contentContainerStyle={{ gap: 8 }}>
        {TRAITS.map((t) => {
          const at = earned.get(t.id);
          return (
            <View key={t.id} style={[styles.traitRow, at && styles.traitRowOn]}>
              <SparkleIcon size={18} color={at ? '#f2c443' : '#8a8a8a'} weight={at ? 'fill' : 'regular'} />
              <View style={{ flex: 1 }}>
                <Text style={styles.traitName}>{t.name}</Text>
                <Text style={styles.note}>
                  {at ? `Earned ${at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · ` : ''}
                  {t.how}
                </Text>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </Sheet>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function BirthdaySheet({
  name,
  current,
  onClose,
  onSave,
  styles,
}: {
  name: string;
  current: string | null;
  onClose(): void;
  onSave(birthday: string): void;
  styles: Styles;
}) {
  const [month, setMonth] = useState(current ? Number(current.slice(5, 7)) : 1);
  const [day, setDay] = useState(current ? Number(current.slice(8, 10)) : 1);
  const days = MONTH_DAYS[month - 1];
  const d = Math.min(day, days);
  // 2000 was a leap year, so 29 February is fine.
  const value = `2000-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return (
    <Sheet title={`${name}'s birthday`} onClose={onClose} styles={styles}>
      <Text style={styles.note}>
        Pick a day: your own dog&rsquo;s birthday, or the day you met. It can change once a month.
      </Text>
      <View style={styles.chips}>
        {MONTHS.map((m, i) => (
          <Pressable key={m} onPress={() => setMonth(i + 1)} style={[styles.pickChip, month === i + 1 && styles.pickChipOn]} accessibilityRole="button">
            <Text style={[styles.pickText, month === i + 1 && styles.pickTextOn]}>{m}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.dayGrid}>
        {Array.from({ length: days }, (_, i) => i + 1).map((n) => (
          <Pressable key={n} onPress={() => setDay(n)} style={[styles.dayCell, d === n && styles.pickChipOn]} accessibilityRole="button">
            <Text style={[styles.pickText, d === n && styles.pickTextOn]}>{n}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable style={styles.save} onPress={() => onSave(value)} accessibilityRole="button">
        <CakeIcon size={16} color="#ffffff" weight="fill" />
        <Text style={styles.saveText}>
          Save: {new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}
        </Text>
      </Pressable>
    </Sheet>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'space-between' },
    stageChip: {
      fontFamily: font.headingSemibold,
      fontSize: 12.5,
      color: colors.accentActive,
      backgroundColor: withAlpha(colors.accent, 0.14),
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
      overflow: 'hidden',
    },
    section: { gap: 5 },
    rowTitle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    label: { fontFamily: font.heading, fontSize: 14, color: colors.text },
    strong: { fontFamily: font.headingSemibold, color: colors.text },
    note: { fontSize: 12.5, color: withAlpha(colors.text, 0.6), lineHeight: 17 },
    link: { fontFamily: font.headingSemibold, fontSize: 13, color: colors.accent },
    bar: { height: 7, borderRadius: 4, backgroundColor: withAlpha(colors.text, 0.1), overflow: 'hidden' },
    barFill: { height: 7, borderRadius: 4, backgroundColor: colors.accent },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    traitChip: {
      fontFamily: font.headingSemibold,
      fontSize: 12.5,
      color: colors.text,
      backgroundColor: withAlpha('#f2c443', 0.2),
      borderWidth: 1,
      borderColor: withAlpha('#f2c443', 0.5),
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
      overflow: 'hidden',
    },
    birthdayRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingTop: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: withAlpha(colors.text, 0.08),
    },
    birthdayBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      padding: 10,
      borderRadius: 12,
      backgroundColor: withAlpha('#f37ba0', 0.18),
    },
    birthdayText: { flex: 1, fontFamily: font.headingSemibold, fontSize: 13.5, color: colors.text },
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      padding: 18,
      paddingBottom: 30,
      gap: 12,
    },
    traitRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      padding: 10,
      borderRadius: 12,
      backgroundColor: withAlpha(colors.text, 0.04),
    },
    traitRowOn: { backgroundColor: withAlpha('#f2c443', 0.14) },
    traitName: { fontFamily: font.headingSemibold, fontSize: 14.5, color: colors.text },
    pickChip: {
      paddingHorizontal: 11,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: withAlpha(colors.text, 0.15),
    },
    pickChipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    pickText: { fontFamily: font.heading, fontSize: 13, color: colors.text },
    pickTextOn: { color: '#ffffff', fontFamily: font.headingSemibold },
    dayGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
    dayCell: {
      width: '12.4%',
      aspectRatio: 1.2,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 8,
      borderWidth: 1,
      borderColor: withAlpha(colors.text, 0.1),
    },
    save: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 12,
      borderRadius: 999,
      backgroundColor: colors.accent,
    },
    saveText: { fontFamily: font.headingSemibold, fontSize: 15, color: '#ffffff' },
  });
}
