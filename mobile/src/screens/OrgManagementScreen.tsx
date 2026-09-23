import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeftIcon, BuildingsIcon, CaretRightIcon } from 'phosphor-react-native';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { SegmentedControl } from '../components/SegmentedControl';
import { TextField } from '../components/TextField';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { useAuth } from '../auth/AuthContext';
import { createOrganization, listOrganizations } from '../organizations/supabaseOrganizations';
import type { Organization, OrganizationKind } from '../organizations/types';

const KIND_OPTIONS: { value: OrganizationKind; label: string }[] = [
  { value: 'school', label: 'School' },
  { value: 'company', label: 'Company' },
];

// The hub half of the org-management screen — platform admins only (see
// GitHub issue #158: org creation isn't self-serve). An org's own admin
// never lands here: TopNav sends them straight to OrgDetailScreen for
// their one org instead, since there's nothing else for them to pick
// from. Reachable only via TopNav's own org icon, same "belt, not
// braces" shape as AdminScreen — this still checks isAdmin for itself
// rather than trusting that.
export function OrgManagementScreen({
  onBack,
  onOpenOrg,
}: {
  onBack: () => void;
  onOpenOrg: (organizationId: string) => void;
}) {
  const { user } = useAuth();
  const { text, colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!user?.isAdmin) return;
    setLoading(true);
    setLoadError(null);
    listOrganizations()
      .then(setOrgs)
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Could not load organizations.'))
      .finally(() => setLoading(false));
  }, [user?.isAdmin]);

  useFocusEffect(load);

  const [name, setName] = useState('');
  const [kind, setKind] = useState<OrganizationKind>('school');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const submitCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setCreateError('Give it a name.');
      return;
    }
    setCreateError(null);
    setCreating(true);
    try {
      const id = await createOrganization(trimmed, kind);
      setName('');
      onOpenOrg(id);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Could not create that — try again.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.container}>
        <Button label="Back" variant="ghost" small icon={<ArrowLeftIcon size={13} color={colors.accent} />} onPress={onBack} />
        <Text style={text.h2}>Organizations</Text>

        {!user?.isAdmin ? (
          <Text style={styles.footNote}>This page is for admins only.</Text>
        ) : (
          <>
            <Card style={{ gap: 12 }} elevated={false}>
              <Text style={text.h4}>All organizations</Text>
              {loadError && <Text style={styles.loadError}>{loadError}</Text>}
              {loading && orgs.length === 0 ? (
                <ActivityIndicator color={colors.accent} />
              ) : orgs.length === 0 ? (
                <Text style={styles.footNote}>No organizations yet — create the first one below.</Text>
              ) : (
                orgs.map((org) => (
                  <Pressable key={org.id} onPress={() => onOpenOrg(org.id)} style={styles.orgRow}>
                    <View style={styles.orgIcon}>
                      <BuildingsIcon size={16} color={colors.accent} />
                    </View>
                    <View style={{ flex: 1, gap: 1 }}>
                      <Text style={styles.orgName}>{org.name}</Text>
                      <Text style={styles.footNote}>{org.kind === 'school' ? 'School' : 'Company'}</Text>
                    </View>
                    <CaretRightIcon size={14} color={withAlpha(colors.text, 0.4)} />
                  </Pressable>
                ))
              )}
            </Card>

            <Card style={{ gap: 12 }} elevated={false}>
              <Text style={text.h4}>New organization</Text>
              <TextField label="Name" value={name} onChangeText={setName} placeholder="e.g. Lincoln High School" />
              <SegmentedControl options={KIND_OPTIONS} value={kind} onChange={setKind} />
              {createError && <Text style={styles.loadError}>{createError}</Text>}
              <Button label={creating ? 'Creating…' : 'Create'} variant="primary" disabled={creating} onPress={submitCreate} />
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
    orgRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: withAlpha(colors.text, 0.07),
    },
    orgIcon: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: withAlpha(colors.accent, 0.12),
    },
    orgName: { fontFamily: font.body, fontSize: 14.5, color: colors.text },
  });
}
