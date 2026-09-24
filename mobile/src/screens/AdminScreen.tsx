import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeftIcon, CaretRightIcon, MagnifyingGlassIcon } from 'phosphor-react-native';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { TextField } from '../components/TextField';
import { useTheme } from '../theme/ThemeContext';
import { font, TINT_A, withAlpha, type Palette } from '../theme/tokens';
import { useAuth } from '../auth/AuthContext';
import { useLabels } from '../labels/LabelsContext';
import { getHuntLabels, setHuntLabels } from '../labels/supabaseLabels';
import { DEFAULT_HUNT_LABELS, type HuntLabels } from '../labels/types';
import { getTotalUserCount, searchUsers, type AdminUserSummary } from '../admin/adminApi';

// Reachable only via TopNav's own admin icon, which is itself only
// rendered for user?.isAdmin — but that's a UI convenience, not real
// enforcement (0021_admin_flag.sql's own column-level revoke is), so
// this still checks for itself rather than trusting it never gets
// navigated to some other way. Every card this screen grows should be
// backed by its own admin-gated RLS policy the same way Chase labels is
// (0022_admin_gate_app_labels.sql) — this check is belt, that's braces.
export function AdminScreen({
  onBack,
  onOpenUser,
}: {
  onBack: () => void;
  onOpenUser: (user: AdminUserSummary) => void;
}) {
  const { user } = useAuth();
  const { text, colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // The raw app-wide default, fetched and saved directly rather than via
  // useLabels() — that context's own labelsForOrg() resolves a SPECIFIC
  // challenge's own words (org override if that challenge has one, see
  // LabelsContext.tsx), which isn't what this card edits. This still
  // calls that context's refresh() after saving, which clears its
  // cached org lookups too, so any screen showing a global challenge
  // picks up the change without restarting the app.
  const { refresh: refreshEffectiveLabels } = useLabels();
  const [globalLabels, setGlobalLabels] = useState<HuntLabels>(DEFAULT_HUNT_LABELS);

  const [totalUsers, setTotalUsers] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AdminUserSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const runSearch = useCallback((q: string) => {
    setSearching(true);
    setSearchError(null);
    searchUsers(q)
      .then(setResults)
      .catch((e) => setSearchError(e instanceof Error ? e.message : 'Could not load users.'))
      .finally(() => setSearching(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!user?.isAdmin) return;
      getTotalUserCount().then(setTotalUsers).catch(() => {});
      runSearch(query);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.isAdmin]),
  );

  // Debounced rather than firing on every keystroke — profiles.select is
  // open to any signed-in user, but there's no reason to hit it that
  // often while someone's still typing a name.
  useEffect(() => {
    if (!user?.isAdmin) return;
    const t = setTimeout(() => runSearch(query), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const [hunterInput, setHunterInput] = useState(globalLabels.hunter);
  const [huntedInput, setHuntedInput] = useState(globalLabels.hunted);
  const [zombieInput, setZombieInput] = useState(globalLabels.zombie);
  const [savingLabels, setSavingLabels] = useState(false);
  const [labelsError, setLabelsError] = useState<string | null>(null);
  const [labelsSaved, setLabelsSaved] = useState(false);

  useEffect(() => {
    setHunterInput(globalLabels.hunter);
    setHuntedInput(globalLabels.hunted);
    setZombieInput(globalLabels.zombie);
  }, [globalLabels]);

  useFocusEffect(
    useCallback(() => {
      if (!user?.isAdmin) return;
      getHuntLabels()
        .then(setGlobalLabels)
        .catch(() => {
          // Same "quietly stay on whatever's already showing" convention
          // as LabelsContext's own refresh().
        });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.isAdmin]),
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
      await setHuntLabels({ hunter, hunted, zombie });
      setGlobalLabels({ hunter, hunted, zombie });
      await refreshEffectiveLabels();
      setLabelsSaved(true);
    } catch (e) {
      setLabelsError(e instanceof Error ? e.message : 'Could not save that — try again.');
    } finally {
      setSavingLabels(false);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.container}>
        <Button label="Back" variant="ghost" small icon={<ArrowLeftIcon size={13} color={colors.accent} />} onPress={onBack} />
        <Text style={text.h2}>Admin</Text>

        {!user?.isAdmin ? (
          <Text style={styles.footNote}>This page is for admins only.</Text>
        ) : (
          <>
            <Card style={{ gap: 12 }} elevated={false}>
              <View style={styles.directoryHeader}>
                <Text style={text.h4}>User directory</Text>
                {totalUsers !== null && <Text style={styles.footNote}>{totalUsers} registered</Text>}
              </View>
              <TextField
                label="Search"
                value={query}
                onChangeText={setQuery}
                placeholder="Name or email"
                icon={<MagnifyingGlassIcon size={16} color={withAlpha(colors.text, 0.5)} />}
                autoCapitalize="none"
              />
              {searchError && <Text style={styles.loadError}>{searchError}</Text>}
              {searching && results.length === 0 ? (
                <ActivityIndicator color={colors.accent} />
              ) : results.length === 0 ? (
                <Text style={styles.footNote}>No users match that search.</Text>
              ) : (
                results.map((u) => (
                  <Pressable key={u.id} onPress={() => onOpenUser(u)} style={styles.userRow}>
                    <Avatar initials={u.displayInitials} tint={TINT_A} size={34} fontSize={12} />
                    <View style={{ flex: 1, gap: 1 }}>
                      <Text style={styles.userName}>
                        {u.displayName}
                        {u.isAdmin ? ' · Admin' : ''}
                      </Text>
                      <Text style={styles.footNote}>{u.email}</Text>
                    </View>
                    <CaretRightIcon size={14} color={withAlpha(colors.text, 0.4)} />
                  </Pressable>
                ))
              )}
            </Card>

            <Card style={{ gap: 12 }} elevated={false}>
              <Text style={text.h4}>Chase labels</Text>
              <Text style={styles.footNote}>
                What a chase&rsquo;s three roles are called, app-wide. This is the default for anyone not in an
                organization with its own override &mdash; manage a specific organization&rsquo;s labels from its own page
                instead (see the organization icon in the top bar).
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
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    container: { padding: 16, gap: 14, paddingBottom: 48 },
    footNote: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
    loadError: { fontSize: 12.5, color: colors.amber },
    successNote: { fontSize: 12.5, color: colors.green },
    directoryHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    userRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: withAlpha(colors.text, 0.07),
    },
    userName: { fontFamily: font.body, fontSize: 14.5, color: colors.text },
  });
}
