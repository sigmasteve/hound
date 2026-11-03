import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { MinusIcon, PlusIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { SegmentedControl } from '../components/SegmentedControl';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { useWater } from './WaterContext';
import { WaterGlass, waterColors } from './WaterGlass';
import {
  amountNumber,
  amountText,
  DEFAULT_WATER_GOAL,
  dayKeyBefore,
  detailText,
  entryText,
  glassName,
  glassSizes,
  localDayKey,
  sizeText,
  switchUnits,
  TARGET_STEPS,
  targetInUnits,
  targetMlFor,
  unitWord,
  type WaterEntry,
  type WaterGoal,
} from './water';

const DROP = 'M5.5 0 C 7.5 3.5 11 6.5 11 9.2 A 5.5 5.5 0 0 1 0 9.2 C 0 6.5 3.5 3.5 5.5 0 Z';

function Pip({ on, color, off }: { on: boolean; color: string; off: string }) {
  return (
    <Svg width={10} height={13} viewBox="0 0 11 15">
      <Path d={DROP} fill={on ? color : off} />
    </Svg>
  );
}

// How many glasses the goal is, for the drops under the count: one per
// glass, at most 12.
function glassCount(goal: WaterGoal): number {
  return Math.min(12, Math.max(1, Math.round(goal.targetMl / goal.glassMl)));
}

// The water row on Today's Goals tile: a small glass, "5 of 8 cups" over a
// drop per glass, and a + that logs one. Tapping the row opens the sheet;
// holding + does too, for another size.
export function WaterRow({ onOpen, onAdded }: { onOpen: () => void; onAdded: (entry: WaterEntry) => void }) {
  const { colors, mode } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const water = useWater();
  const c = waterColors(mode);
  const goal = water.goal;
  if (!goal) return null;
  const n = glassCount(goal);
  const filled = Math.min(n, Math.floor(water.todayMl / goal.glassMl + 0.01));
  const name = glassName(goal.glassMl, goal.units);

  return (
    <Pressable
      onPress={onOpen}
      style={({ pressed }) => [styles.row, { backgroundColor: c.wash }, pressed && { opacity: 0.85 }]}
      accessibilityRole="button"
      accessibilityLabel={`Water. ${amountNumber(water.todayMl, goal.units)} of ${amountText(goal.targetMl, goal.units)}. Open`}
    >
      <View style={{ marginTop: -18, marginBottom: -2 }}>
        <WaterGlass width={34} height={46} fraction={water.todayMl / goal.targetMl} pours={water.pours} met={water.met} haptics />
      </View>
      <View style={{ flex: 1, gap: 6 }}>
        <Text style={[styles.count, water.met && { color: c.water }]} numberOfLines={1}>
          {water.met ? (
            `✓ ${amountText(water.todayMl, goal.units)} · goal met`
          ) : (
            <>
              {amountNumber(water.todayMl, goal.units)}
              <Text style={styles.countOf}> of {amountText(goal.targetMl, goal.units)}</Text>
            </>
          )}
        </Text>
        <View style={styles.pips}>
          {Array.from({ length: n }, (_, i) => (
            <Pip key={i} on={i < filled} color={c.water} off={withAlpha(colors.text, 0.12)} />
          ))}
        </View>
      </View>
      <Pressable
        onPress={() => {
          water.add().then((e) => e && onAdded(e));
        }}
        onLongPress={onOpen}
        style={({ pressed }) => [styles.plus, { backgroundColor: c.water, shadowColor: c.water }, pressed && { transform: [{ scale: 0.9 }] }]}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={`Add a ${name} of water`}
        accessibilityHint="Hold to pick another size"
      >
        <PlusIcon size={22} color={c.on} weight="bold" />
      </Pressable>
    </Pressable>
  );
}

// What the water row opens: the big glass, the glass sizes, Add, this week
// and today's log.
export function WaterSheet({ onAdded, onEdit }: { onAdded: (entry: WaterEntry) => void; onEdit: () => void }) {
  const { colors, mode } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const water = useWater();
  const c = waterColors(mode);
  const goal = water.goal;
  if (!goal) return null;
  const left = goal.targetMl - water.todayMl;
  const sizes = glassSizes(goal.units);
  const name = glassName(goal.glassMl, goal.units);
  const pickSize = (ml: number) => water.setGoal({ ...goal, glassMl: ml }).catch(() => {});

  return (
    <View style={{ gap: 16 }}>
      <View style={styles.hero}>
        <WaterGlass
          width={112}
          height={150}
          fraction={water.todayMl / goal.targetMl}
          pours={water.pours}
          met={water.met}
          marks={goal.units === 'cups' ? Math.round(goal.targetMl / 236.588) : Math.round(goal.targetMl / 250)}
        />
        <View style={{ flex: 1, gap: 4, paddingBottom: 6 }}>
          <Text style={styles.big}>
            {amountNumber(water.todayMl, goal.units)}
            <Text style={styles.bigOf}> of {amountText(goal.targetMl, goal.units)}</Text>
          </Text>
          <Text style={styles.sub}>{detailText(water.todayMl, goal)}</Text>
          <Text style={[styles.left, { color: c.water }]}>
            {water.met ? 'Goal met. The bowl in the Yard is full.' : `${amountText(left, goal.units)} to go`}
          </Text>
        </View>
      </View>

      <View style={styles.chips} accessibilityRole="radiogroup">
        {sizes.map((s) => {
          const on = Math.abs(s.ml - goal.glassMl) < 3;
          return (
            <Pressable
              key={s.id}
              onPress={() => pickSize(s.ml)}
              style={[styles.chip, on && { borderColor: c.water, backgroundColor: c.wash }]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
            >
              <Text style={styles.chipText}>{s.name}</Text>
              <Text style={styles.chipSize}>{sizeText(s.ml, goal.units)}</Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        onPress={() => {
          water.add().then((e) => e && onAdded(e));
        }}
        style={({ pressed }) => [styles.add, { backgroundColor: c.water }, pressed && { transform: [{ scale: 0.98 }] }]}
        accessibilityRole="button"
      >
        <PlusIcon size={18} color={c.on} weight="bold" />
        <Text style={[styles.addText, { color: c.on }]}>Add a {name}</Text>
      </Pressable>

      <View style={{ gap: 8 }}>
        <Text style={styles.label}>THIS WEEK</Text>
        <WaterWeek />
      </View>

      <View style={{ gap: 8 }}>
        <Text style={styles.label}>TODAY</Text>
        <View style={styles.log}>
          {water.entries.length === 0 && water.healthTodayMl === 0 ? (
            <Text style={styles.empty}>Nothing yet today. Tap Add to log your first {name}.</Text>
          ) : (
            <>
              {[...water.entries].reverse().map((e, i) => (
                <View key={e.id} style={[styles.logRow, i > 0 && styles.logRowLine]}>
                  <Text style={styles.logTime}>{e.at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Text>
                  <Text style={styles.logAmount}>{entryText(e.ml, goal.units)}</Text>
                  <Pressable onPress={() => water.remove(e.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove this entry">
                    <Text style={styles.remove}>Remove</Text>
                  </Pressable>
                </View>
              ))}
              {water.healthTodayMl > 0 && (
                <View style={[styles.logRow, water.entries.length > 0 && styles.logRowLine]}>
                  <Text style={styles.logTime}>Health</Text>
                  <Text style={styles.logAmount}>{amountText(water.healthTodayMl, goal.units)} from other apps</Text>
                </View>
              )}
            </>
          )}
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <Text style={styles.label}>SHOW IT IN</Text>
        <SegmentedControl
          options={[
            { value: 'cups', label: 'Cups and ounces' },
            { value: 'ml', label: 'Millilitres' },
          ]}
          value={goal.units}
          onChange={(u) =>
            water
              .setGoal(switchUnits(goal, u as WaterGoal['units']))
              .catch((e) => Alert.alert('Couldn’t change that', e instanceof Error ? e.message : 'Try again.'))
          }
        />
      </View>

      <Text style={styles.note}>
        Water from other apps in Health counts too. Water days earn their own badges and fill your hound’s bowl in the Yard; they
        don’t change your goal day or streak.
      </Text>
      <Pressable onPress={onEdit} hitSlop={8} accessibilityRole="button">
        <Text style={styles.link}>Change the water goal</Text>
      </Pressable>
    </View>
  );
}

// This week as seven small glasses, Monday first.
export function WaterWeek() {
  const { colors, mode } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const water = useWater();
  const c = waterColors(mode);
  const goal = water.goal;
  if (!goal) return null;
  const now = new Date();
  const monday = (now.getDay() + 6) % 7;
  const today = localDayKey(now);
  return (
    <View style={styles.week}>
      {Array.from({ length: 7 }, (_, i) => {
        const key = dayKeyBefore(monday - i, now);
        const future = key > today;
        const f = future ? 0 : Math.min(1, (water.byDay.get(key) ?? 0) / goal.targetMl);
        const full = f >= 1;
        const h = 28;
        const top = 2 + (h - 2) * (1 - f * 0.92);
        return (
          <View key={key} style={styles.weekDay}>
            <Svg width={22} height={30} viewBox="0 0 26 34" opacity={future ? 0.4 : 1}>
              <Path
                d="M2 2 L24 2 L21 31 Q20.6 32 19.5 32 L6.5 32 Q5.4 32 5 31 Z"
                fill={withAlpha(colors.text, 0.05)}
                stroke={withAlpha(colors.text, 0.3)}
                strokeWidth={1.2}
              />
              {f > 0 && (
                <Path
                  d={`M${2 + 3 * (top / 32)} ${top} L${24 - 3 * (top / 32)} ${top} L21 31 Q20.6 32 19.5 32 L6.5 32 Q5.4 32 5 31 Z`}
                  fill={full ? c.water : c.back}
                />
              )}
            </Svg>
            <Text style={[styles.weekLabel, key === today && styles.weekToday]}>
              {key === today ? 'Today' : ['M', 'T', 'W', 'T', 'F', 'S', 'S'][i]}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// Goals screen: add, change or remove the water goal.
export function WaterGoalCard() {
  const { colors, text, mode } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const water = useWater();
  const c = waterColors(mode);
  const [draft, setDraft] = useState<WaterGoal | null>(null);
  const [saving, setSaving] = useState(false);
  const goal = water.goal;

  // A run of stepper taps saves once, a moment after the last.
  const [pending, setPending] = useState<WaterGoal | null>(null);
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => {
      water.setGoal(pending).catch((e) => Alert.alert('Couldn’t save that', e instanceof Error ? e.message : 'Try again.'));
      setPending(null);
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  if (!water.available) return null;

  const editing = goal ? pending ?? goal : draft;

  const change = (next: WaterGoal) => {
    if (goal) setPending(next);
    else setDraft(next);
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await water.setGoal(draft);
      setDraft(null);
    } catch (e) {
      Alert.alert('Couldn’t add it', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card style={{ gap: 14 }} elevated={false}>
      <View style={styles.cardHead}>
        <Svg width={16} height={20} viewBox="0 0 11 15">
          <Path d={DROP} fill={c.water} />
        </Svg>
        <Text style={text.h4}>Water</Text>
      </View>
      {!editing ? (
        <>
          <Text style={styles.note}>
            Log glasses of water with one tap from Today. It’s separate from your goals: it doesn’t change your goal day or streak.
          </Text>
          <Button
            label="Add a water goal"
            variant="secondary"
            icon={<PlusIcon size={14} color={colors.accent} />}
            onPress={() => setDraft(DEFAULT_WATER_GOAL)}
          />
        </>
      ) : (
        <>
          <View style={{ gap: 8 }}>
            <Text style={styles.fieldLabel}>Show it in</Text>
            <SegmentedControl
              options={[
                { value: 'cups', label: 'Cups and ounces' },
                { value: 'ml', label: 'Millilitres' },
              ]}
              value={editing.units}
              onChange={(u) => change(switchUnits(editing, u as WaterGoal['units']))}
            />
          </View>
          <View style={styles.goalRow}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.goalName}>Every day</Text>
              <Text style={styles.note}>{amountText(editing.targetMl, editing.units)} of water</Text>
            </View>
            <Stepper goal={editing} onChange={change} colors={colors} />
          </View>
          <View style={{ gap: 8 }}>
            <Text style={styles.fieldLabel}>One tap adds</Text>
            <View style={styles.chips}>
              {glassSizes(editing.units).map((s) => {
                const on = Math.abs(s.ml - editing.glassMl) < 3;
                return (
                  <Pressable
                    key={s.id}
                    onPress={() => change({ ...editing, glassMl: s.ml })}
                    style={[styles.chip, on && { borderColor: c.water, backgroundColor: c.wash }]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={styles.chipText}>{s.name}</Text>
                    <Text style={styles.chipSize}>{sizeText(s.ml, editing.units)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <View style={styles.goalRow}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.goalName}>Sip reminders</Text>
              <Text style={styles.note}>Every 2 hours from 10 AM to 6 PM, until the goal’s met.</Text>
            </View>
            <Switch
              value={editing.sipReminders}
              onValueChange={(v) => change({ ...editing, sipReminders: v })}
              trackColor={{ true: c.water, false: withAlpha(colors.text, 0.2) }}
            />
          </View>
          {goal ? (
            <Pressable
              onPress={() =>
                Alert.alert('Remove the water goal?', 'Water stops showing on Today. What you logged is kept.', [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Remove',
                    style: 'destructive',
                    onPress: () => water.removeGoal().catch((e) => Alert.alert('Couldn’t remove it', e instanceof Error ? e.message : 'Try again.')),
                  },
                ])
              }
              hitSlop={8}
              accessibilityRole="button"
            >
              <Text style={[styles.link, { color: colors.amber }]}>Remove the water goal</Text>
            </Pressable>
          ) : (
            <View style={styles.actions}>
              <Button label="Cancel" variant="ghost" onPress={() => setDraft(null)} />
              <Button label={saving ? 'Saving…' : 'Add water goal'} variant="primary" disabled={saving} onPress={save} />
            </View>
          )}
        </>
      )}
    </Card>
  );
}

function Stepper({ goal, onChange, colors }: { goal: WaterGoal; onChange: (g: WaterGoal) => void; colors: Palette }) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { min, max, step } = TARGET_STEPS[goal.units];
  const value = targetInUnits(goal);
  const nudge = (dir: 1 | -1) => {
    const next = Math.min(max, Math.max(min, value + step * dir));
    onChange({ ...goal, targetMl: targetMlFor(next, goal.units) });
  };
  return (
    <View style={styles.stepper}>
      <Pressable onPress={() => nudge(-1)} style={styles.stepButton} hitSlop={6} accessibilityLabel="Less water" disabled={value <= min}>
        <MinusIcon size={14} color={colors.accentActive} />
      </Pressable>
      <Text style={styles.stepValue}>
        {goal.units === 'ml' ? value.toLocaleString() : value} {unitWord(goal.units)}
      </Text>
      <Pressable onPress={() => nudge(1)} style={styles.stepButton} hitSlop={6} accessibilityLabel="More water" disabled={value >= max}>
        <PlusIcon size={14} color={colors.accentActive} />
      </Pressable>
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingLeft: 10, paddingRight: 10, borderRadius: 14 },
    count: { fontFamily: font.headingSemibold, fontSize: 14, color: colors.text },
    countOf: { fontFamily: font.heading, color: withAlpha(colors.text, 0.6) },
    pips: { flexDirection: 'row', gap: 4, flexWrap: 'wrap' },
    plus: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      shadowOpacity: 0.35,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
      elevation: 3,
    },
    hero: { flexDirection: 'row', alignItems: 'flex-end', gap: 18 },
    big: { fontFamily: font.headingSemibold, fontSize: 38, color: colors.text, fontVariant: ['tabular-nums'] },
    bigOf: { fontFamily: font.heading, fontSize: 16, color: withAlpha(colors.text, 0.6) },
    sub: { fontSize: 14, color: withAlpha(colors.text, 0.6) },
    left: { fontFamily: font.headingSemibold, fontSize: 14 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 7,
      paddingHorizontal: 12,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.surface,
    },
    chipText: { fontFamily: font.heading, fontSize: 13, color: colors.text },
    chipSize: { fontSize: 12, color: withAlpha(colors.text, 0.6) },
    add: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 14 },
    addText: { fontFamily: font.headingSemibold, fontSize: 16 },
    label: { fontFamily: font.headingSemibold, fontSize: 12, letterSpacing: 0.8, color: withAlpha(colors.text, 0.6) },
    week: { flexDirection: 'row', justifyContent: 'space-between' },
    weekDay: { alignItems: 'center', gap: 4, flex: 1 },
    weekLabel: { fontSize: 11.5, color: withAlpha(colors.text, 0.6) },
    weekToday: { fontFamily: font.headingSemibold, color: colors.text },
    log: { borderRadius: 14, backgroundColor: colors.surface },
    logRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 12 },
    logRowLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
    logTime: { width: 72, fontSize: 14, color: withAlpha(colors.text, 0.6), fontVariant: ['tabular-nums'] },
    logAmount: { flex: 1, fontSize: 14, color: colors.text },
    remove: { fontSize: 13, color: withAlpha(colors.text, 0.6) },
    empty: { padding: 12, fontSize: 14, color: withAlpha(colors.text, 0.6) },
    note: { fontSize: 12.5, lineHeight: 18, color: withAlpha(colors.text, 0.6) },
    link: { fontFamily: font.heading, fontSize: 13.5, color: colors.accentActive },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    fieldLabel: { fontSize: 12, letterSpacing: 0.4, color: withAlpha(colors.text, 0.55) },
    goalRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    goalName: { fontFamily: font.heading, fontSize: 14.5, color: colors.text },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
    stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    stepButton: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: withAlpha(colors.accent, 0.14),
    },
    stepValue: { minWidth: 76, textAlign: 'center', fontFamily: font.heading, fontSize: 14, color: colors.text },
  });
}
