import React, { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { BoneIcon, ShareNetworkIcon } from 'phosphor-react-native';
import { Button } from './Button';
import { useTheme } from '../theme/ThemeContext';
import { color, font, withAlpha, type Palette } from '../theme/tokens';
import { achievementIcon } from '../achievements/achievementIcons';
import type { NewlyEarnedAchievement } from '../achievements/achievementsApi';

// Shown on Home right after check_achievements (0072_achievements.sql)
// reports something newly earned — after the daily bonus popup, never on
// top of it. A first check for an existing player can unlock several at
// once, so this lists every one with its reward.
export function AchievementUnlockedModal({
  achievements,
  currencyName,
  onViewAll,
  onClose,
  onShare,
}: {
  achievements: NewlyEarnedAchievement[];
  currencyName: string;
  onViewAll: () => void;
  onClose: () => void;
  // Shares one badge as a picture (K-06); left out, there's no Share.
  onShare?: (a: NewlyEarnedAchievement) => void;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const total = achievements.reduce((sum, a) => sum + a.bones, 0);
  const single = achievements.length === 1 ? achievements[0] : null;
  const HeroIcon = achievementIcon(single ? single.id : 'first_win');

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconCircle}>
            <HeroIcon size={30} color={color.gold} weight="fill" />
          </View>
          <Text style={text.eyebrow}>{single ? 'ACHIEVEMENT UNLOCKED' : `${achievements.length} ACHIEVEMENTS UNLOCKED`}</Text>

          {single ? (
            <Text style={styles.title}>{single.name}</Text>
          ) : (
            <View style={styles.list}>
              {achievements.map((a) => {
                const Icon = achievementIcon(a.id);
                return (
                  <View key={a.id} style={styles.listRow}>
                    <Icon size={16} color={color.gold} weight="fill" />
                    <Text style={styles.listName} numberOfLines={1}>
                      {a.name}
                    </Text>
                    {a.bones > 0 && <Text style={styles.listBones}>+{a.bones}</Text>}
                    {onShare && (
                      <Pressable onPress={() => onShare(a)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Share ${a.name}`}>
                        <ShareNetworkIcon size={18} color={colors.accent} />
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          {/* Water badges (0153) pay nothing. */}
          {total > 0 && (
            <View style={styles.rewardRow}>
              <BoneIcon size={16} color={color.accent} weight="fill" />
              <Text style={styles.reward}>
                +{total.toLocaleString()} {currencyName}
              </Text>
            </View>
          )}

          <View style={styles.buttons}>
            {single && onShare ? (
              <Button
                label="Share"
                variant="ghost"
                icon={<ShareNetworkIcon size={16} color={colors.accent} />}
                onPress={() => onShare(single)}
              />
            ) : (
              <Button label="View all" variant="ghost" onPress={onViewAll} />
            )}
            <Button label="Nice!" variant="primary" onPress={onClose} />
          </View>
          {single && onShare && (
            <Pressable onPress={onViewAll} hitSlop={8} accessibilityRole="button">
              <Text style={styles.viewAll}>See all badges</Text>
            </Pressable>
          )}
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
    title: { fontFamily: font.headingSemibold, fontSize: 26, color: colors.text, textAlign: 'center' },
    list: { alignSelf: 'stretch', gap: 8, marginTop: 4 },
    listRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    listName: { flex: 1, fontSize: 14.5, color: colors.text, fontFamily: font.heading },
    listBones: { fontSize: 13, color: withAlpha(colors.text, 0.6) },
    rewardRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
    reward: { fontFamily: font.headingSemibold, fontSize: 18, color: colors.text },
    buttons: { flexDirection: 'row', gap: 8, marginTop: 8 },
    viewAll: { fontFamily: font.heading, fontSize: 13.5, color: colors.accentActive, marginTop: 2 },
  });
}
