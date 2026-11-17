import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { BoneIcon } from 'phosphor-react-native';
import { Text } from './Text';
import { Card } from './Card';
import { Button } from './Button';
import { TextField } from './TextField';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getMemberBones, giveBones, type MemberBones } from '../admin/adminApi';

// Admin → People → a member → Give Bones (0218). They go into the
// member's balance to spend, never into Bones earned by playing, so they
// don't open locked games. Every grant is logged with who gave it.
const QUICK = [50, 100, 250, 500];

export function GiveBonesCard({ userId, name }: { userId: string; name: string }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<MemberBones | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const first = name.split(' ')[0] || name;

  const load = () =>
    getMemberBones(userId)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) =>
        setError(
          e instanceof Error && /admin_member_bones/.test(e.message)
            ? 'Run 0218_admin_give_bones.sql to give Bones.'
            : e instanceof Error
              ? e.message
              : 'Could not load their Bones.',
        ),
      );
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const n = Number(amount.replace(/[^0-9]/g, ''));
  const valid = Number.isInteger(n) && n >= 1 && n <= 10000;

  const give = () => {
    if (!valid) return;
    Alert.alert(`Give ${first} ${n.toLocaleString()} Bones?`, 'They’re for spending, not earned by playing. They’ll get a push: “Hound sent you Bones”.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Give',
        onPress: async () => {
          setBusy(true);
          try {
            const balance = await giveBones(userId, n, note.trim() || null);
            setAmount('');
            setNote('');
            await load();
            Alert.alert('Given', `${first} now has ${balance.toLocaleString()} Bones.`);
          } catch (e) {
            Alert.alert('Couldn’t give Bones', e instanceof Error ? e.message : 'Try again.');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  return (
    <Card style={{ gap: 12, padding: 18 }} elevated={false}>
      <View style={styles.header}>
        <BoneIcon size={18} color={colors.amber} weight="fill" />
        <Text style={text.h4}>Give Bones</Text>
      </View>
      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : !data ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <>
          <View style={styles.stats}>
            <Stat label="To spend" value={data.balance.toLocaleString()} styles={styles} />
            <Stat label="Earned by playing" value={data.earned.toLocaleString()} styles={styles} />
            <Stat label="Given by admins" value={data.givenTotal.toLocaleString()} styles={styles} />
          </View>
          <View style={styles.quick}>
            {QUICK.map((q) => (
              <Pressable
                key={q}
                onPress={() => setAmount(String(q))}
                style={[styles.chip, n === q && { backgroundColor: withAlpha(colors.amber, 0.22), borderColor: colors.amber }]}
                accessibilityRole="button"
              >
                <Text style={styles.chipText}>{q}</Text>
              </Pressable>
            ))}
          </View>
          <TextField label="Bones" value={amount} onChangeText={setAmount} placeholder="1 to 10,000" keyboardType="number-pad" maxLength={5} />
          <TextField label="Note (optional, just for Admin)" value={note} onChangeText={setNote} placeholder="e.g. Thanks for testing Pack Wars" maxLength={140} />
          <Button
            label={busy ? 'Giving…' : valid ? `Give ${n.toLocaleString()} Bones` : 'Give Bones'}
            variant="primary"
            block
            disabled={!valid || busy}
            onPress={give}
          />
          <Text style={styles.foot}>
            They land in {first}&rsquo;s balance to spend, with a push to tell them. They don&rsquo;t count as earned, so they don&rsquo;t open locked games.
          </Text>
          {data.grants.length > 0 && (
            <View style={{ gap: 6 }}>
              <Text style={styles.label}>GIVEN BEFORE</Text>
              {data.grants.map((g, i) => (
                <Text key={i} style={styles.foot}>
                  {g.bones.toLocaleString()} by {g.by.split(' ')[0]} · {new Date(g.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  {g.note ? ` · ${g.note}` : ''}
                </Text>
              ))}
            </View>
          )}
        </>
      )}
    </Card>
  );
}

function Stat({ label, value, styles }: { label: string; value: string; styles: Styles }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    error: { fontSize: 13, color: colors.amber },
    stats: { flexDirection: 'row', gap: 8 },
    stat: { flex: 1, padding: 10, borderRadius: 10, backgroundColor: withAlpha(colors.text, 0.05), gap: 2 },
    statValue: { fontFamily: font.headingSemibold, fontSize: 17, color: colors.text },
    statLabel: { fontSize: 11.5, color: withAlpha(colors.text, 0.6) },
    quick: { flexDirection: 'row', gap: 8 },
    chip: { flex: 1, height: 38, borderRadius: 10, borderWidth: 1, borderColor: withAlpha(colors.text, 0.15), alignItems: 'center', justifyContent: 'center' },
    chipText: { fontFamily: font.headingSemibold, fontSize: 14, color: colors.text },
    label: { fontSize: 11.5, letterSpacing: 0.6, fontFamily: font.headingSemibold, color: withAlpha(colors.text, 0.55) },
    foot: { fontSize: 12.5, lineHeight: 17, color: withAlpha(colors.text, 0.6) },
  });
}
