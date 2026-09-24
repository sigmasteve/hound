import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeftIcon, ArrowsClockwiseIcon, MagnifyingGlassIcon, XIcon } from 'phosphor-react-native';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { TextField } from '../components/TextField';
import { useTheme } from '../theme/ThemeContext';
import { font, TINT_A, withAlpha, type Palette } from '../theme/tokens';
import { useAuth } from '../auth/AuthContext';
import { DEFAULT_HUNT_LABELS } from '../labels/types';
import { searchUsers, type AdminUserSummary } from '../admin/adminApi';
import {
  addOrgMember,
  getOrganization,
  getOrgLabels,
  listOrgMembers,
  regenerateOrgInviteCode,
  removeOrgMember,
  setOrgLabels,
  setOrgMemberRole,
} from '../organizations/supabaseOrganizations';
import type { Organization, OrgMember } from '../organizations/types';

// The per-org half of the org-management screen — see
// OrgManagementScreen.tsx for the platform-admin hub that lists every
// org and creates new ones. This screen is reached two ways: from that
// hub (any org, platform admin), or directly from TopNav's org icon (an
// org's own admin, always their one org — see RootNavigator.tsx). Same
// "check for itself, don't trust who navigated here" shape as
// AdminScreen: canManage below is the real gate, not just who could tap
// their way in.
export function OrgDetailScreen({ organizationId, onBack }: { organizationId: string; onBack: () => void }) {
  const { user, updateUser } = useAuth();
  const { text, colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [org, setOrg] = useState<Organization | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const canManage = !!user?.isAdmin || (user?.orgRole === 'admin' && user?.organizationId === organizationId);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    Promise.all([getOrganization(organizationId), listOrgMembers(organizationId)])
      .then(([orgResult, memberResult]) => {
        setOrg(orgResult);
        setMembers(memberResult);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Could not load this organization.'))
      .finally(() => setLoading(false));
  }, [organizationId]);

  useFocusEffect(load);

  const [regenerating, setRegenerating] = useState(false);
  const confirmRegenerate = () => {
    Alert.alert(
      'Regenerate invite code?',
      'The old code will stop working immediately — anyone who hasn’t joined with it yet will need the new one.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Regenerate',
          onPress: async () => {
            setRegenerating(true);
            try {
              const code = await regenerateOrgInviteCode(organizationId);
              setOrg((o) => (o ? { ...o, inviteCode: code } : o));
            } catch (e) {
              Alert.alert('Could not regenerate', e instanceof Error ? e.message : 'Try again.');
            } finally {
              setRegenerating(false);
            }
          },
        },
      ],
    );
  };

  const [roleChangingId, setRoleChangingId] = useState<string | null>(null);
  const toggleRole = async (member: OrgMember) => {
    const nextRole = member.orgRole === 'admin' ? 'member' : 'admin';
    setRoleChangingId(member.id);
    try {
      await setOrgMemberRole(member.id, nextRole);
      setMembers((prev) => prev.map((m) => (m.id === member.id ? { ...m, orgRole: nextRole } : m)));
    } catch (e) {
      Alert.alert('Could not update role', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setRoleChangingId(null);
    }
  };

  const [removingId, setRemovingId] = useState<string | null>(null);
  const confirmRemove = (member: OrgMember) => {
    Alert.alert('Remove this member?', `${member.displayName} will lose access to this organization.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setRemovingId(member.id);
          try {
            await removeOrgMember(member.id);
            setMembers((prev) => prev.filter((m) => m.id !== member.id));
          } catch (e) {
            Alert.alert('Could not remove', e instanceof Error ? e.message : 'Try again.');
          } finally {
            setRemovingId(null);
          }
        },
      },
    ]);
  };

  // Add-member search — platform admin only, same as admin_add_org_member
  // itself (0035_organizations.sql): an org's own admin hands out the
  // invite code instead (see the Invite code card below), they don't
  // place people in directly.
  const [addQuery, setAddQuery] = useState('');
  const [addResults, setAddResults] = useState<AdminUserSummary[]>([]);
  const [addSearching, setAddSearching] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.isAdmin) return;
    if (!addQuery.trim()) {
      setAddResults([]);
      return;
    }
    setAddSearching(true);
    const t = setTimeout(() => {
      searchUsers(addQuery)
        .then(setAddResults)
        .catch(() => setAddResults([]))
        .finally(() => setAddSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [addQuery, user?.isAdmin]);

  const addMember = async (candidate: AdminUserSummary) => {
    setAddError(null);
    setAddingId(candidate.id);
    try {
      await addOrgMember(candidate.id, organizationId);
      setAddQuery('');
      setAddResults([]);
      load();
      // A platform admin can add themselves this way (as just happened in
      // testing) — the RPC updates their profiles row, but nothing else
      // refetches THEIR OWN session, so their own app kept reading a
      // stale (no-org) AuthUser until a fresh sign-in. Patching it here
      // fixes that immediately, and also cascades into LabelsContext's
      // own effective-labels refresh (its useEffect depends on the whole
      // user object, which this replaces) without needing anything extra.
      if (candidate.id === user?.id) updateUser({ organizationId, orgRole: 'member' });
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Could not add that person.');
    } finally {
      setAddingId(null);
    }
  };

  // Labels — org admin of this org, or a platform admin (org_set_labels,
  // 0036_organization_labels.sql). Blank inputs with the global default
  // as placeholder means "this org hasn't overridden anything yet" reads
  // the same way AdminScreen's own Chase-labels card does.
  const [orgHunter, setOrgHunter] = useState('');
  const [orgHunted, setOrgHunted] = useState('');
  const [orgZombie, setOrgZombie] = useState('');
  const [labelsLoaded, setLabelsLoaded] = useState(false);
  const [savingLabels, setSavingLabels] = useState(false);
  const [labelsError, setLabelsError] = useState<string | null>(null);
  const [labelsSaved, setLabelsSaved] = useState(false);

  useEffect(() => {
    if (!canManage) return;
    getOrgLabels(organizationId)
      .then((l) => {
        if (l) {
          setOrgHunter(l.hunter);
          setOrgHunted(l.hunted);
          setOrgZombie(l.zombie);
        }
      })
      .catch(() => {})
      .finally(() => setLabelsLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, canManage]);

  const submitLabels = async () => {
    const hunter = orgHunter.trim() || DEFAULT_HUNT_LABELS.hunter;
    const hunted = orgHunted.trim() || DEFAULT_HUNT_LABELS.hunted;
    const zombie = orgZombie.trim() || DEFAULT_HUNT_LABELS.zombie;
    setLabelsError(null);
    setLabelsSaved(false);
    setSavingLabels(true);
    try {
      await setOrgLabels(organizationId, { hunter, hunted, zombie });
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

        {loading && !org ? (
          <ActivityIndicator color={colors.accent} />
        ) : loadError ? (
          <Text style={styles.loadError}>{loadError}</Text>
        ) : !org ? (
          <Text style={styles.footNote}>That organization couldn&rsquo;t be found.</Text>
        ) : !canManage ? (
          <>
            <Text style={text.h2}>{org.name}</Text>
            <Text style={styles.footNote}>This page is for organization admins only.</Text>
          </>
        ) : (
          <>
            <View>
              <Text style={text.h2}>{org.name}</Text>
              <Text style={styles.footNote}>{org.kind === 'school' ? 'School' : 'Company'}</Text>
            </View>

            <Card style={{ gap: 12 }} elevated={false}>
              <Text style={text.h4}>Invite code</Text>
              <Text style={styles.footNote}>
                Anyone who has this code can join {org.name} from the app. Share it directly with the people you want
                in.
              </Text>
              <View style={styles.codeRow}>
                <Text style={styles.code}>{org.inviteCode}</Text>
                <Button
                  label={regenerating ? 'Regenerating…' : 'Regenerate'}
                  icon={<ArrowsClockwiseIcon size={14} color={colors.text} />}
                  disabled={regenerating}
                  onPress={confirmRegenerate}
                />
              </View>
            </Card>

            <Card style={{ gap: 12 }} elevated={false}>
              <Text style={text.h4}>
                Members{members.length > 0 ? ` (${members.length})` : ''}
              </Text>
              {members.length === 0 ? (
                <Text style={styles.footNote}>Nobody has joined yet.</Text>
              ) : (
                members.map((m) => {
                  const isSelf = m.id === user?.id;
                  return (
                    <View key={m.id} style={styles.memberRow}>
                      <Avatar initials={m.displayInitials} tint={TINT_A} size={34} fontSize={12} />
                      <View style={{ flex: 1, gap: 1 }}>
                        <Text style={styles.memberName}>
                          {m.displayName}
                          {m.orgRole === 'admin' ? ' · Admin' : ''}
                        </Text>
                        <Text style={styles.footNote}>{m.email}</Text>
                      </View>
                      {!isSelf && (
                        <View style={{ flexDirection: 'row', gap: 6 }}>
                          <Button
                            label={m.orgRole === 'admin' ? 'Make member' : 'Make admin'}
                            small
                            disabled={roleChangingId === m.id}
                            onPress={() => toggleRole(m)}
                          />
                          <Pressable
                            onPress={() => confirmRemove(m)}
                            disabled={removingId === m.id}
                            style={styles.removeButton}
                            accessibilityLabel={`Remove ${m.displayName}`}
                          >
                            <XIcon size={14} color={colors.amber} />
                          </Pressable>
                        </View>
                      )}
                    </View>
                  );
                })
              )}
              {members.some((m) => m.id === user?.id) && (
                <Text style={styles.footNote}>You can&rsquo;t change your own role or remove yourself from here.</Text>
              )}
            </Card>

            {user?.isAdmin && (
              <Card style={{ gap: 12 }} elevated={false}>
                <Text style={text.h4}>Add member</Text>
                <TextField
                  label="Search"
                  value={addQuery}
                  onChangeText={setAddQuery}
                  placeholder="Name or email"
                  icon={<MagnifyingGlassIcon size={16} color={withAlpha(colors.text, 0.5)} />}
                  autoCapitalize="none"
                />
                {addError && <Text style={styles.loadError}>{addError}</Text>}
                {addSearching && addResults.length === 0 ? (
                  <ActivityIndicator color={colors.accent} />
                ) : (
                  addResults.map((candidate) => {
                    const alreadyInAnOrg = !!candidate.organizationId;
                    return (
                      <View key={candidate.id} style={styles.memberRow}>
                        <Avatar initials={candidate.displayInitials} tint={TINT_A} size={34} fontSize={12} />
                        <View style={{ flex: 1, gap: 1 }}>
                          <Text style={styles.memberName}>{candidate.displayName}</Text>
                          <Text style={styles.footNote}>
                            {alreadyInAnOrg ? 'Already in an organization' : candidate.email}
                          </Text>
                        </View>
                        <Button
                          label={addingId === candidate.id ? 'Adding…' : 'Add'}
                          small
                          disabled={alreadyInAnOrg || addingId === candidate.id}
                          onPress={() => addMember(candidate)}
                        />
                      </View>
                    );
                  })
                )}
              </Card>
            )}

            <Card style={{ gap: 12 }} elevated={false}>
              <Text style={text.h4}>Chase labels</Text>
              <Text style={styles.footNote}>
                Override the Hound/Fox/Out wording for everyone in {org.name}. Leave a field blank to fall back to
                the app-wide default.
              </Text>
              {labelsLoaded && (
                <>
                  <TextField label="Hound" value={orgHunter} onChangeText={setOrgHunter} placeholder={DEFAULT_HUNT_LABELS.hunter} />
                  <TextField label="Fox" value={orgHunted} onChangeText={setOrgHunted} placeholder={DEFAULT_HUNT_LABELS.hunted} />
                  <TextField label="Out" value={orgZombie} onChangeText={setOrgZombie} placeholder={DEFAULT_HUNT_LABELS.zombie} />
                  {labelsError && <Text style={styles.loadError}>{labelsError}</Text>}
                  {labelsSaved && !labelsError && <Text style={styles.successNote}>Saved.</Text>}
                  <Button label={savingLabels ? 'Saving…' : 'Save'} variant="primary" disabled={savingLabels} onPress={submitLabels} />
                </>
              )}
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
    codeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    code: { fontFamily: font.heading, fontSize: 22, letterSpacing: 2, color: colors.text },
    memberRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: withAlpha(colors.text, 0.07),
    },
    memberName: { fontFamily: font.body, fontSize: 14.5, color: colors.text },
    removeButton: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: withAlpha(colors.amber, 0.4),
    },
  });
}
