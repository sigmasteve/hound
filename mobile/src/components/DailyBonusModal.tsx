import React, { useEffect, useMemo, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { BoneIcon } from 'phosphor-react-native';
import { Button } from './Button';
import { useTheme } from '../theme/ThemeContext';
import { color, font, withAlpha, type Palette } from '../theme/tokens';
import { DAILY_BONUS_CYCLE, DAILY_BONUS_WEEKLY, dailyBonusForStreak, dayInCycle } from '../bones/dailyBonus';
import {
  getLocalRemindersEnabled,
  getReminderPermission,
  requestReminderPermission,
  scheduleDailyBonusReminder,
} from '../notifications/localReminders';

// Shown once per day, right after HomeScreen's claim_daily_bonus call
// actually awards something (see 0070_daily_bonus.sql) — never for a
// same-day re-open, which the server reports as awarded: false.
export function DailyBonusModal({
  bonesAwarded,
  streak,
  currencyName,
  onClose,
}: {
  bonesAwarded: number;
  streak: number;
  currencyName: string;
  onClose: () => void;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const nextBonus = dailyBonusForStreak(streak + 1);
  const today = dayInCycle(streak);

  // The contextual moment to ask for notification permission: someone who
  // just got a streak reward is the most likely to want tomorrow's nudge.
  // Only offered while the OS question is still unanswered — once they've
  // allowed it, reminders just schedule on their own; once they've denied
  // it, re-asking here would be nagging (Settings' toggle explains how).
  const [offerReminder, setOfferReminder] = useState(false);
  useEffect(() => {
    let cancelled = false;
    Promise.all([getLocalRemindersEnabled(), getReminderPermission()]).then(([enabled, permission]) => {
      if (!cancelled) setOfferReminder(enabled && permission === 'undetermined');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const remindMe = async () => {
    try {
      if (await requestReminderPermission()) {
        await scheduleDailyBonusReminder(streak + 1, nextBonus, currencyName);
      }
    } catch {
      // Nothing to recover — the popup closes either way.
    }
    onClose();
  };

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconCircle}>
            <BoneIcon size={30} color={color.accent} weight="fill" />
          </View>
          <Text style={text.eyebrow}>DAILY BONUS</Text>
          <Text style={styles.amount}>
            +{bonesAwarded} {currencyName}
          </Text>
          <Text style={styles.streakLine}>
            {streak > 1 ? `${streak}-day streak — keep it going!` : 'Come back tomorrow to start a streak.'}
          </Text>

          <View style={styles.dotsRow}>
            {Array.from({ length: DAILY_BONUS_CYCLE }, (_, i) => {
              const day = i + 1;
              const filled = day <= today;
              const weekly = day === DAILY_BONUS_CYCLE;
              return (
                <View key={day} style={styles.dotSlot}>
                  <View style={[styles.dot, weekly && styles.dotWeekly, filled && styles.dotFilled]}>
                    {weekly && <BoneIcon size={11} color={filled ? '#fff' : color.accent} weight="fill" />}
                  </View>
                  <Text style={styles.dotLabel}>{weekly ? `+${DAILY_BONUS_WEEKLY}` : day}</Text>
                </View>
              );
            })}
          </View>

          <Text style={styles.footNote}>
            Tomorrow: +{nextBonus} {currencyName}
            {nextBonus === DAILY_BONUS_WEEKLY ? ' — the weekly bonus!' : ''}
          </Text>

          <View style={styles.buttons}>
            {offerReminder && <Button label="Remind me tomorrow" onPress={remindMe} />}
            <Button label="Nice!" variant="primary" onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    card: {
      width: '100%',
      maxWidth: 360,
      alignItems: 'center',
      gap: 10,
      padding: 24,
      borderRadius: 16,
      backgroundColor: colors.surface,
    },
    iconCircle: {
      width: 60,
      height: 60,
      borderRadius: 30,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: withAlpha(color.accent, 0.16),
    },
    amount: { fontFamily: font.headingSemibold, fontSize: 30, color: colors.text },
    streakLine: { fontSize: 14, color: withAlpha(colors.text, 0.75), textAlign: 'center' },
    dotsRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
    dotSlot: { alignItems: 'center', gap: 4 },
    dot: {
      width: 18,
      height: 18,
      borderRadius: 9,
      borderWidth: 1.5,
      borderColor: withAlpha(color.accent, 0.5),
      alignItems: 'center',
      justifyContent: 'center',
    },
    dotWeekly: { width: 24, height: 24, borderRadius: 12 },
    dotFilled: { backgroundColor: color.accent, borderColor: color.accent },
    dotLabel: { fontSize: 10.5, color: withAlpha(colors.text, 0.55) },
    footNote: { fontSize: 12.5, color: withAlpha(colors.text, 0.6), marginTop: 4 },
    buttons: { flexDirection: 'row', gap: 8, marginTop: 8 },
  });
}
