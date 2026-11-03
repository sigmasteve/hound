import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { useFocusEffect } from '@react-navigation/native';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { dollars, getShopOverview, type ShopOverview } from '../admin/shopOverview';

// Admin → Shop: packs sold, who buys, and what Bones are spent on.
// Reloads each time Admin comes into view.
export function ShopAdminCard() {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<ShopOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      getShopOverview()
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e) =>
          setError(
            e instanceof Error && /admin_shop_overview/.test(e.message)
              ? 'Run 0156_shop_phase1.sql to see these numbers.'
              : e instanceof Error
                ? e.message
                : 'Could not load the shop numbers.',
          ),
        );
    }, []),
  );

  const rows: [string, string][] = data
    ? [
        ['Packs, last 7 days', dollars(data.revenue7d)],
        [
          'Packs, last 30 days',
          `${dollars(data.revenue30d)} · ${data.packs30d.small} small, ${data.packs30d.medium} medium, ${data.packs30d.large} large`,
        ],
        ['Packs, all time', dollars(data.revenueAll)],
        ['Bought a pack, last 30 days', `${data.buyers30d} people · ${data.firstBuyers30d} for the first time`],
        ['Ever bought a pack', `${data.buyersAll}`],
        [
          'Bones spent, last 30 days',
          `Clothes ${data.spent30d.clothes.toLocaleString()} · Coats and breeds ${data.spent30d.coatsBreeds.toLocaleString()} · Yard ${data.spent30d.yard.toLocaleString()}`,
        ],
        ['On holiday items, last 30 days', `${data.spent30d.limited.toLocaleString()} Bones`],
        ['Bought new clothes', `${data.clothesBuyers} · wearing an outfit ${data.wearingBody}, booties or shoes ${data.wearingFeet}`],
        ['Porch unlocked', `${data.porchUnlocks} · ${data.hotTubs} with a hot tub`],
        ['Bougie houses bought', `${data.bougieHouses}`],
        ['Tricks bought', `${data.tricksBought} by ${data.trickOwners} ${data.trickOwners === 1 ? 'person' : 'people'}`],
        ['Gifts, last 30 days', `${data.gifts30d} from ${data.gifters30d} ${data.gifters30d === 1 ? 'person' : 'people'} · ${data.giftBones30d.toLocaleString()} Bones`],
      ]
    : [];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Shop</Text>
      <Text style={styles.footNote}>
        Money is at list prices ($1.99, $4.99, $9.99), before the stores take their cut. Refunded packs aren&rsquo;t
        counted.
      </Text>
      {error ? (
        <Text style={styles.loadError}>{error}</Text>
      ) : !data ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <>
          {rows.map(([label, value]) => (
            <View key={label} style={styles.row}>
              <Text style={styles.label}>{label}</Text>
              <Text style={styles.value}>{value}</Text>
            </View>
          ))}
          {data.topItems30d.length > 0 && (
            <View style={styles.row}>
              <Text style={styles.label}>Top items, last 30 days</Text>
              {data.topItems30d.map((t) => (
                <Text key={t.name} style={styles.item}>
                  {t.name} <Text style={styles.label}>· {t.sold} sold · {t.bones.toLocaleString()} Bones</Text>
                </Text>
              ))}
            </View>
          )}
        </>
      )}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    footNote: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
    loadError: { fontSize: 12.5, color: colors.amber },
    row: { gap: 2, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(colors.text, 0.07) },
    label: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    value: { fontFamily: font.heading, fontSize: 15, color: colors.text },
    item: { fontFamily: font.heading, fontSize: 14, color: colors.text },
  });
}
