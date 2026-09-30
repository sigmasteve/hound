import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { TicketIcon, XIcon } from 'phosphor-react-native';
import { Button } from './Button';
import { TextField } from './TextField';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { supabaseFriendsProvider } from '../friends/supabaseFriends';

// Today, for someone with no friends on Hound yet: paste the code (or
// link) from the friend who invited them. An invite link can't survive
// installing the beta from TestFlight, so this is where the code the
// invite page showed them gets used.
export function InviteCodeCard({ onAdded, onDismiss }: { onAdded: () => void; onDismiss: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [code, setCode] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    setAdding(true);
    setError(null);
    try {
      // Accepts a bare code or a whole houndchallenge.net/f/… link.
      await supabaseFriendsProvider.addFriendByCode(code);
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that — try again.');
    } finally {
      setAdding(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <TicketIcon size={17} color={colors.accentActive} />
        <Text style={styles.title}>Got an invite code?</Text>
        <Pressable onPress={onDismiss} hitSlop={10} accessibilityRole="button" accessibilityLabel="Hide the invite code card">
          <XIcon size={14} color={withAlpha(colors.text, 0.5)} />
        </Pressable>
      </View>
      <Text style={styles.body}>If a friend invited you, enter their code or paste their link to connect right away.</Text>
      <View style={styles.row}>
        <TextField
          label="Code or link"
          value={code}
          onChangeText={(v) => {
            setCode(v);
            if (error) setError(null);
          }}
          placeholder="e.g. Ab3xK9pQ"
          autoCapitalize="none"
          autoCorrect={false}
          style={{ flex: 1 }}
        />
        <View style={{ paddingBottom: 2 }}>
          <Button label={adding ? 'Adding…' : 'Add'} variant="primary" small disabled={adding || !code.trim()} onPress={add} />
        </View>
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    card: {
      gap: 10,
      padding: 14,
      borderRadius: 16,
      backgroundColor: withAlpha(colors.accent, 0.12),
      borderWidth: 1,
      borderColor: withAlpha(colors.accent, 0.4),
    },
    header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    title: { flex: 1, fontSize: 16, fontFamily: font.heading, color: colors.text },
    body: { fontSize: 12.5, color: withAlpha(colors.text, 0.65) },
    row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
    error: { fontSize: 12.5, color: colors.amber },
  });
}
