import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Path, Rect, Text as SvgText } from 'react-native-svg';
import { XIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { buzz } from '../celebrate/feedback';
import { YardThumb } from './YardArt';
import { RoomThumb } from './RoomArt';
import { equipKennelItem } from './kennelApi';
import { placeYardItem } from './yardApi';
import { PRIZE_NOTES, buyPrize, getPrizeCounter, type PrizeCounter, type PrizeItem } from './prizeCounterApi';

// The Kennel's Prize Counter (0243): the Paw Coin wallet (every coin a
// member finished a Paw Slots challenge with) and what it buys. Tap one
// to see it; Get it, then wear it or put it in the yard straight away.

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

function CoinIcon({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20">
      <Circle cx={10} cy={10} r={9.5} fill="#f0c24a" />
      <Circle cx={10} cy={10} r={7} fill="none" stroke="#b8862a" strokeWidth={1.2} />
      <G fill="#7a5a14">
        <Ellipse cx={10} cy={12} rx={3} ry={2.4} />
        <Ellipse cx={6.6} cy={8.6} rx={1.2} ry={1.6} />
        <Ellipse cx={9} cy={6.8} rx={1.2} ry={1.6} />
        <Ellipse cx={11.6} cy={6.8} rx={1.2} ry={1.6} />
        <Ellipse cx={13.8} cy={8.6} rx={1.2} ry={1.6} />
      </G>
    </Svg>
  );
}

// Each item as it looks: the neck ones on their own, the rest as the yard
// and the room draw them.
export function PrizeThumb({ id, size }: { id: string; size: number }) {
  if (id === 'neck_lucky7') {
    return (
      <Svg width={size} height={size} viewBox="0 0 64 64">
        <Path d="M8 14 Q32 30 56 14" stroke="#d94a4a" strokeWidth={6} fill="none" strokeLinecap="round" />
        <Circle cx={32} cy={26} r={4} fill="none" stroke="#b8862a" strokeWidth={2.5} />
        <Circle cx={32} cy={42} r={16} fill="#f0c24a" />
        <Circle cx={32} cy={42} r={12} fill="none" stroke="#b8862a" strokeWidth={2} />
        <SvgText x={32} y={50} fontSize={21} fontWeight="800" textAnchor="middle" fill="#d94a4a">
          7
        </SvgText>
      </Svg>
    );
  }
  if (id === 'collar_goldhound') {
    return (
      <Svg width={size} height={size} viewBox="0 0 64 64">
        <Ellipse cx={32} cy={26} rx={25} ry={11} fill="none" stroke="#2c4f9e" strokeWidth={9} />
        <Ellipse cx={32} cy={26} rx={25} ry={11} fill="none" stroke="#f0c24a" strokeWidth={2} strokeDasharray="4 5" />
        <Circle cx={32} cy={44} r={10} fill="#f0c24a" stroke="#b8862a" strokeWidth={1.5} />
        <Ellipse cx={32} cy={46.5} rx={3.6} ry={2.9} fill="#7a5a14" />
        <Circle cx={28.4} cy={42} r={1.5} fill="#7a5a14" />
        <Circle cx={32} cy={40.4} r={1.5} fill="#7a5a14" />
        <Circle cx={35.6} cy={42} r={1.5} fill="#7a5a14" />
      </Svg>
    );
  }
  if (id === 'room_neon') return <RoomThumb id={id} size={size} />;
  return <YardThumb id={id} size={size} />;
}

export function PrizeCounterTab({ houndName, onChanged }: { houndName: string; onChanged: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [counter, setCounter] = useState<PrizeCounter | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<PrizeItem | null>(null);
  const [busy, setBusy] = useState(false);
  // Just bought: offer to wear it or put it out.
  const [justGot, setJustGot] = useState<string | null>(null);

  const load = useCallback(() => {
    getPrizeCounter()
      .then((c) => {
        setCounter(c);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error && /prize_counter_state/.test(e.message) ? 'The Prize Counter opens soon.' : e instanceof Error ? e.message : 'Could not load the Prize Counter.'));
  }, []);
  useEffect(load, [load]);

  const get = async (item: PrizeItem) => {
    if (busy) return;
    setBusy(true);
    try {
      setCounter(await buyPrize(item.id));
      setJustGot(item.id);
      buzz('success');
      onChanged();
    } catch (e) {
      Alert.alert('Prize Counter', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  const useIt = async (item: PrizeItem) => {
    if (busy) return;
    setBusy(true);
    try {
      if (item.slot === 'neck') await equipKennelItem('neck', item.id);
      else if (item.slot === 'bowl' || item.slot === 'ground' || item.slot === 'house') await placeYardItem(item.slot, item.id);
      onChanged();
      setOpen(null);
      setJustGot(null);
    } catch (e) {
      Alert.alert('Prize Counter', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!counter) {
    return <View style={styles.center}>{error ? <Text style={styles.note}>{error}</Text> : <ActivityIndicator color={colors.accent} />}</View>;
  }

  const close = () => {
    setOpen(null);
    setJustGot(null);
  };
  const useLabel = (item: PrizeItem) =>
    item.slot === 'neck' ? `Put it on ${houndName}` : item.slot === 'room' ? null : 'Put it in the yard';

  return (
    <View style={{ gap: 12 }}>
      <View style={styles.wallet}>
        <CoinIcon size={38} />
        <View style={{ flex: 1 }}>
          <Text style={styles.walletN}>{fmt(counter.balance)} Paw Coins</Text>
          <Text style={styles.walletSub}>
            {counter.earned > 0
              ? `Won in finished Paw Slots challenges${counter.credits[0] ? `, ${fmt(counter.credits[0].amount)} from “${counter.credits[0].name}”` : ''}. Only here: never Bones, never bought.`
              : 'Play a Paw Slots challenge: every Paw Coin you finish with comes here. Never Bones, never bought.'}
          </Text>
        </View>
      </View>

      <View style={styles.grid}>
        {counter.items.map((item) => {
          const short = item.price - counter.balance;
          return (
            <Pressable key={item.id} onPress={() => setOpen(item)} style={[styles.card, item.owned && styles.cardOwned]} accessibilityRole="button" accessibilityLabel={`${item.name}, ${fmt(item.price)} Paw Coins`}>
              <View style={styles.thumb}>
                <PrizeThumb id={item.id} size={64} />
              </View>
              <Text style={styles.name} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.where}>{PRIZE_NOTES[item.id]?.where ?? ''}</Text>
              <Text style={[styles.price, item.owned ? styles.priceOwned : short > 0 ? styles.priceShort : null]}>
                {item.owned ? 'Owned ✓' : short > 0 ? `${fmt(item.price)} · ${fmt(short)} more` : `${fmt(item.price)} Paw Coins`}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.note}>Looks only: nothing here helps win a game. Prize Counter things can’t be bought with Bones or given as gifts.</Text>

      {open && (
        <Modal transparent animationType="slide" visible onRequestClose={close}>
          <View style={styles.backdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close" />
            <View style={styles.sheet}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                <View style={styles.bigThumb}>
                  <PrizeThumb id={open.id} size={84} />
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={styles.kicker}>PRIZE COUNTER · {(PRIZE_NOTES[open.id]?.where ?? '').toUpperCase()}</Text>
                  <Text style={styles.sheetTitle}>{open.name}</Text>
                  <Text style={styles.desc}>{PRIZE_NOTES[open.id]?.desc ?? ''}</Text>
                </View>
                <Pressable onPress={close} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close" style={{ alignSelf: 'flex-start' }}>
                  <XIcon size={18} color={withAlpha(colors.text, 0.5)} />
                </Pressable>
              </View>
              {(() => {
                const item = counter.items.find((i) => i.id === open.id) ?? open;
                const short = item.price - counter.balance;
                if (justGot === item.id || item.owned) {
                  const label = useLabel(item);
                  return (
                    <>
                      <Text style={styles.yours}>
                        {justGot === item.id ? 'It’s yours!' : 'You have this one.'}
                        {item.slot === 'room' ? ' It’s on the wall in the Room.' : ''}
                      </Text>
                      {label && (
                        <Pressable onPress={() => useIt(item)} disabled={busy} style={[styles.go, busy && { opacity: 0.6 }]} accessibilityRole="button">
                          <Text style={styles.goText}>{label}</Text>
                        </Pressable>
                      )}
                      <Pressable onPress={close} style={styles.later} accessibilityRole="button">
                        <Text style={styles.laterText}>Done</Text>
                      </Pressable>
                    </>
                  );
                }
                return (
                  <>
                    <Text style={styles.note}>Only at the Prize Counter: it can’t be bought with Bones.</Text>
                    <Pressable
                      onPress={() => get(item)}
                      disabled={busy || short > 0}
                      style={[styles.go, (busy || short > 0) && styles.goOff]}
                      accessibilityRole="button"
                    >
                      <Text style={[styles.goText, short > 0 && { color: withAlpha(colors.text, 0.6) }]}>
                        {short > 0 ? `Need ${fmt(short)} more Paw Coins` : busy ? 'Getting it…' : `Get it · ${fmt(item.price)} Paw Coins`}
                      </Text>
                    </Pressable>
                    <Pressable onPress={close} style={styles.later} accessibilityRole="button">
                      <Text style={styles.laterText}>Not now</Text>
                    </Pressable>
                  </>
                );
              })()}
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    center: { padding: 24, alignItems: 'center' },
    note: { fontSize: 12.5, lineHeight: 18, color: withAlpha(colors.text, 0.6) },
    wallet: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#23263a' },
    walletN: { fontFamily: font.headingSemibold, fontSize: 20, color: '#ffe08a' },
    walletSub: { fontSize: 11.5, lineHeight: 16, color: '#a9abb8' },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    card: { width: '48%', flexGrow: 1, borderRadius: 16, padding: 10, gap: 2, backgroundColor: colors.surface, borderWidth: 1, borderColor: withAlpha(colors.text, 0.08) },
    cardOwned: { borderWidth: 2, borderColor: '#7fd39b' },
    thumb: { height: 80, borderRadius: 12, backgroundColor: '#f6f1e4', alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
    name: { fontFamily: font.headingSemibold, fontSize: 13.5, color: colors.text },
    where: { fontSize: 11.5, color: withAlpha(colors.text, 0.6) },
    price: { marginTop: 4, fontFamily: font.headingSemibold, fontSize: 12.5, color: '#a8780c' },
    priceOwned: { color: '#2f8a4f' },
    priceShort: { color: withAlpha(colors.text, 0.5) },
    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
    sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: colors.bg, paddingHorizontal: 18, paddingTop: 18, paddingBottom: 30, gap: 12 },
    bigThumb: { width: 96, height: 96, borderRadius: 16, backgroundColor: '#f6f1e4', alignItems: 'center', justifyContent: 'center' },
    kicker: { fontFamily: font.headingSemibold, fontSize: 11, letterSpacing: 0.6, color: '#a8780c' },
    sheetTitle: { fontFamily: font.headingSemibold, fontSize: 20, color: colors.text },
    desc: { fontSize: 13, lineHeight: 18, color: withAlpha(colors.text, 0.75) },
    yours: { fontFamily: font.headingSemibold, fontSize: 15, color: '#2f8a4f' },
    go: { minHeight: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, backgroundColor: '#f08a24' },
    goOff: { backgroundColor: withAlpha(colors.text, 0.1) },
    goText: { fontFamily: font.headingSemibold, fontSize: 16, color: '#1b1d29' },
    later: { alignItems: 'center', paddingVertical: 4 },
    laterText: { fontFamily: font.headingSemibold, fontSize: 14, color: withAlpha(colors.text, 0.6) },
  });
}
