import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeftIcon } from 'phosphor-react-native';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { TextField } from '../components/TextField';
import { useTheme } from '../theme/ThemeContext';
import { withAlpha, type Palette } from '../theme/tokens';
import { useAuth } from '../auth/AuthContext';
import { useLabels } from '../labels/LabelsContext';
import { DEFAULT_HUNT_LABELS } from '../labels/types';

// Reachable only via TopNav's own admin icon, which is itself only
// rendered for user?.isAdmin — but that's a UI convenience, not real
// enforcement (0021_admin_flag.sql's own column-level revoke is), so
// this still checks for itself rather than trusting it never gets
// navigated to some other way. Every card this screen grows should be
// backed by its own admin-gated RLS policy the same way Chase labels is
// (0022_admin_gate_app_labels.sql) — this check is belt, that's braces.
export function AdminScreen({ onBack }: { onBack: () => void }) {
  const { user } = useAuth();
  const { text, colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { labels, refresh: refreshLabels, save: saveLabels } = useLabels();

  const [hunterInput, setHunterInput] = useState(labels.hunter);
  const [huntedInput, setHuntedInput] = useState(labels.hunted);
  const [zombieInput, setZombieInput] = useState(labels.zombie);
  const [savingLabels, setSavingLabels] = useState(false);
  const [labelsError, setLabelsError] = useState<string | null>(null);
  const [labelsSaved, setLabelsSaved] = useState(false);

  useEffect(() => {
    setHunterInput(labels.hunter);
    setHuntedInput(labels.hunted);
    setZombieInput(labels.zombie);
  }, [labels]);

  useFocusEffect(
    useCallback(() => {
      refreshLabels();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const submitLabels = async (next: { hunter: string; hunted: string; zombie: string }) => {
    const hunter = next.hunter.trim();
    const hunted = next.hunted.trim();
    const zombie = next.zombie.trim();
    if (!hunter || !hunted || !zombie) {
      setLabelsError('All three labels need at least one character.');
      return;
    }
    setLabelsError(null);
    setLabelsSaved(false);
    setSavingLabels(true);
    try {
      await saveLabels({ hunter, hunted, zombie });
      setLabelsSaved(true);
    } catch (e) {
      setLabelsError(e instanceof Error ? e.message : 'Could not save that — try again.');
    } finally {
      setSavingLabels(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Button label="Back" variant="ghost" small icon={<ArrowLeftIcon size={13} color={colors.accent} />} onPress={onBack} />
      <Text style={text.h2}>Admin</Text>

      {!user?.isAdmin ? (
        <Text style={styles.footNote}>This page is for admins only.</Text>
      ) : (
        <Card style={{ gap: 12 }} elevated={false}>
          <Text style={text.h4}>Chase labels</Text>
          <Text style={styles.footNote}>
            What a chase&rsquo;s three roles are called, everywhere in the app. This changes it for
            everyone signed in right now, not just you — there&rsquo;s no per-person version of this
            setting yet.
          </Text>
          <TextField label="Hound" value={hunterInput} onChangeText={setHunterInput} placeholder={DEFAULT_HUNT_LABELS.hunter} />
          <TextField label="Fox" value={huntedInput} onChangeText={setHuntedInput} placeholder={DEFAULT_HUNT_LABELS.hunted} />
          <TextField label="Out" value={zombieInput} onChangeText={setZombieInput} placeholder={DEFAULT_HUNT_LABELS.zombie} />
          {labelsError && <Text style={styles.loadError}>{labelsError}</Text>}
          {labelsSaved && !labelsError && <Text style={styles.successNote}>Saved — updated everywhere.</Text>}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button
              label={savingLabels ? 'Saving…' : 'Save'}
              variant="primary"
              disabled={savingLabels}
              onPress={() => submitLabels({ hunter: hunterInput, hunted: huntedInput, zombie: zombieInput })}
            />
            <Button label="Reset to default" disabled={savingLabels} onPress={() => submitLabels(DEFAULT_HUNT_LABELS)} />
          </View>
        </Card>
      )}
    </ScrollView>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    container: { padding: 16, gap: 14, paddingBottom: 48 },
    footNote: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
    loadError: { fontSize: 12.5, color: colors.amber },
    successNote: { fontSize: 12.5, color: colors.green },
  });
}
