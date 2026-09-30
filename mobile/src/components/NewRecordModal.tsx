import React, { useMemo } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { TrophyIcon } from 'phosphor-react-native';
import { Button } from './Button';
import { useTheme } from '../theme/ThemeContext';
import { color, font, withAlpha, type Palette } from '../theme/tokens';
import { formatRecordValue, RECORD_TITLE, type NewRecord } from '../records/personalRecords';
import { RECORD_ICON } from '../records/recordIcons';

// Shown on Home when a sync beats one of your personal records
// (0084_personal_records.sql) — after the daily bonus and achievement
// popups, never on top of them.
export function NewRecordModal({
  records,
  onViewAll,
  onClose,
}: {
  records: NewRecord[];
  onViewAll: () => void;
  onClose: () => void;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const single = records.length === 1 ? records[0] : null;
  const HeroIcon = single ? RECORD_ICON[single.kind] : TrophyIcon;

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconCircle}>
            <HeroIcon size={30} color={color.gold} weight="fill" />
          </View>
          <Text style={text.eyebrow}>{single ? 'NEW PERSONAL RECORD' : `${records.length} NEW PERSONAL RECORDS`}</Text>

          {single ? (
            <>
              <Text style={styles.title}>{formatRecordValue(single.kind, single.value)}</Text>
              <Text style={styles.sub}>
                {RECORD_TITLE[single.kind]} — your old best was {formatRecordValue(single.kind, single.previousValue)}.
              </Text>
            </>
          ) : (
            <View style={styles.list}>
              {records.map((r) => {
                const Icon = RECORD_ICON[r.kind];
                return (
                  <View key={r.kind} style={styles.listRow}>
                    <Icon size={16} color={color.gold} weight="fill" />
                    <Text style={styles.listName} numberOfLines={1}>
                      {RECORD_TITLE[r.kind]}
                    </Text>
                    <Text style={styles.listValue}>{formatRecordValue(r.kind, r.value)}</Text>
                  </View>
                );
              })}
            </View>
          )}
          <Text style={styles.footNote}>Your friends will see it in their activity feed.</Text>

          <View style={styles.buttons}>
            <Button label="See records" variant="ghost" onPress={onViewAll} />
            <Button label="Let's go!" variant="primary" onPress={onClose} />
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
      backgroundColor: withAlpha(color.gold, 0.16),
    },
    title: { fontFamily: font.headingSemibold, fontSize: 28, color: colors.text, textAlign: 'center' },
    sub: { fontSize: 14, color: withAlpha(colors.text, 0.7), textAlign: 'center' },
    list: { alignSelf: 'stretch', gap: 8, marginTop: 4 },
    listRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    listName: { flex: 1, fontSize: 14.5, color: colors.text, fontFamily: font.heading },
    listValue: { fontSize: 13.5, color: withAlpha(colors.text, 0.75), fontFamily: font.heading },
    footNote: { fontSize: 12.5, color: withAlpha(colors.text, 0.55), textAlign: 'center' },
    buttons: { flexDirection: 'row', gap: 8, marginTop: 8 },
  });
}
