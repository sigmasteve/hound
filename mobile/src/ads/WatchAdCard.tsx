import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import { BoneIcon, PlayCircleIcon } from 'phosphor-react-native';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { useTheme } from '../theme/ThemeContext';
import { color, withAlpha, type Palette } from '../theme/tokens';
import type { RewardedBones } from './rewardedBones';

// The Locker's "Free Bones" card: watch a short ad for Bones, up to the
// day's limit. Hidden whenever ads are off for you.
export function WatchAdCard({ ads, currencyName }: { ads: RewardedBones; currencyName: string }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (ads.state === 'hidden') return null;

  const note =
    ads.state === 'done-for-today'
      ? `That's all for today. More tomorrow.`
      : ads.state === 'unavailable'
        ? 'No ad to show right now. Try again in a bit.'
        : `${ads.remaining} left today`;

  return (
    <Card style={{ gap: 8 }} elevated={false}>
      <View style={styles.row}>
        <PlayCircleIcon size={22} color={color.accent} weight="fill" />
        <View style={{ flex: 1, gap: 1 }}>
          <Text style={text.h4}>Free {currencyName}</Text>
          <Text style={styles.note}>
            Watch a short ad for {ads.bones} {currencyName}. {note}
          </Text>
        </View>
      </View>
      {ads.state !== 'done-for-today' && (
        <View style={styles.actions}>
          {ads.state === 'loading' || ads.state === 'paying' || ads.state === 'showing' ? (
            <View style={styles.waiting}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.note}>{ads.state === 'paying' ? `Adding your ${currencyName}…` : 'Getting an ad ready…'}</Text>
            </View>
          ) : (
            <Button
              label={ads.state === 'unavailable' ? 'Try again' : `Watch an ad · +${ads.bones}`}
              variant="primary"
              small
              icon={<BoneIcon size={14} color={colors.accent} weight="fill" />}
              onPress={ads.watch}
            />
          )}
        </View>
      )}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    note: { fontSize: 13, color: withAlpha(colors.text, 0.65) },
    actions: { flexDirection: 'row' },
    waiting: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  });
}
