import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { BoneIcon } from 'phosphor-react-native';
import { Card } from '../components/Card';
import { useTheme } from '../theme/ThemeContext';
import { color, font, withAlpha, type Palette } from '../theme/tokens';
import { notifyBonesChanged } from './bonesChanged';
import { listBonesPackOffers, purchaseBonesPack, type BonesPackOffer } from './purchasesApi';

// Bones packs for real money (RevenueCat, 0064_bones_purchases.sql), on
// Your look's Shop tab and in the Kennel. The packs load when this card
// first shows, since that touches the store, not just Supabase.
// onOffers tells the screen whether there are any, for its "Add Bones"
// shortcuts; onCredited, how many Bones just landed.
export function BonesPacksCard({
  userId,
  currencyName,
  onCredited,
  onOffers,
}: {
  userId: string;
  currencyName: string;
  onCredited: (bones: number) => void;
  onOffers?: (offers: BonesPackOffer[] | null, error: string | null) => void;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [offers, setOffers] = useState<BonesPackOffer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buyingId, setBuyingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listBonesPackOffers(userId)
      .then((o) => {
        if (cancelled) return;
        setOffers(o);
        onOffers?.(o, null);
      })
      .catch((e) => {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : `Could not load ${currencyName} packs.`;
        setError(message);
        onOffers?.(null, message);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const buy = async (offer: BonesPackOffer) => {
    setBuyingId(offer.productId);
    try {
      const { credited } = await purchaseBonesPack(userId, offer);
      if (credited) {
        onCredited(offer.bonesAmount);
      } else {
        // The purchase went through; only the instant balance update
        // didn't. revenuecat-webhook still credits it shortly.
        Alert.alert('Purchase complete', `Your ${currencyName} may take a minute to show up.`);
      }
      notifyBonesChanged();
    } catch (e) {
      Alert.alert('Could not buy that', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setBuyingId(null);
    }
  };

  return (
    <Card style={{ gap: 4 }} elevated={false}>
      <Text style={text.h4}>Buy {currencyName}</Text>
      {error ? (
        <Text style={styles.errorNote}>{error}</Text>
      ) : offers === null ? (
        <ActivityIndicator color={colors.accent} />
      ) : offers.length === 0 ? (
        <Text style={styles.footNote}>No {currencyName} packs available right now.</Text>
      ) : (
        offers.map((offer) => (
          <Pressable
            key={offer.productId}
            style={styles.row}
            disabled={buyingId !== null}
            onPress={() => buy(offer)}
            accessibilityRole="button"
            accessibilityLabel={`${offer.bonesAmount} ${currencyName} for ${offer.priceString}`}
          >
            <BoneIcon size={22} color={color.accent} weight="fill" />
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>
                {offer.bonesAmount.toLocaleString()} {currencyName}
              </Text>
            </View>
            {buyingId === offer.productId ? (
              <ActivityIndicator color={colors.accent} />
            ) : (
              <Text style={styles.price}>{offer.priceString}</Text>
            )}
          </Pressable>
        ))
      )}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    footNote: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
    errorNote: { fontSize: 12.5, color: colors.amber },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: withAlpha(colors.text, 0.07),
    },
    name: { fontSize: 14.5, color: colors.text, fontFamily: font.body },
    price: { fontSize: 13, fontFamily: font.heading, color: colors.accent400 },
  });
}
