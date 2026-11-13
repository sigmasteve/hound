import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from './Text';
import { Card } from './Card';
import { Button } from './Button';
import { SponsorLogo } from './SponsorLine';
import { SponsorEditor, draftFromSponsor, sponsorDraftProblem, sponsorFromDraft, type SponsorDraft } from './SponsorEditor';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import {
  SPONSOR_PLACEMENT_NAME,
  getChallengeSponsor,
  getSponsorOverview,
  getSponsorReport,
  setChallengeSponsorV2,
  type ChallengeSponsor,
  type SponsorOverview,
  type SponsorReport,
} from '../challenges/globalChallenges';

// Admin → Sponsors (0203): every sponsored Global challenge, and for each
// one the report you'd show the sponsor (players reached, views, taps, how
// each placement did, their hole), plus editing where they show. Counts
// only: nothing about who played. (A PDF of the report is issue #582.)
export function SponsorAdminCard({ onChanged }: { onChanged?: (o: SponsorOverview) => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<SponsorOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [report, setReport] = useState<SponsorReport | null>(null);
  const [sponsor, setSponsor] = useState<ChallengeSponsor | null>(null);
  const [editing, setEditing] = useState<SponsorDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const changed = useRef(onChanged);
  changed.current = onChanged;

  const load = useCallback(() => {
    getSponsorOverview()
      .then((o) => {
        setData(o);
        setError(null);
        changed.current?.(o);
      })
      .catch((e) =>
        setError(e instanceof Error && /admin_sponsor_overview/.test(e.message) ? 'Run 0203 to see these.' : e instanceof Error ? e.message : 'Could not load.'),
      );
  }, []);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const open = async (id: string) => {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    setReport(null);
    setSponsor(null);
    setEditing(null);
    try {
      const [r, s] = await Promise.all([getSponsorReport(id), getChallengeSponsor(id)]);
      setReport(r);
      setSponsor(s);
    } catch (e) {
      Alert.alert('Sponsor report', e instanceof Error ? e.message : 'Try again.');
    }
  };

  const save = async (id: string, golf: boolean) => {
    if (!editing) return;
    const problem = sponsorDraftProblem(editing);
    if (problem) {
      Alert.alert('Sponsor', problem);
      return;
    }
    setSaving(true);
    try {
      await setChallengeSponsorV2(id, sponsorFromDraft(editing, golf));
      setEditing(null);
      setSponsor(await getChallengeSponsor(id));
      load();
    } catch (e) {
      Alert.alert('Couldn’t save the sponsor', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Sponsors</Text>
      <Text style={styles.footNote}>
        Who sponsors which Global challenge, and how it did for them. Sponsors see counts only, never who played. Add a
        sponsor when you publish, or from the challenge in the Global list.
      </Text>
      {error ? (
        <Text style={styles.loadError}>{error}</Text>
      ) : !data ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <>
          <View style={styles.tiles}>
            {[
              [`${data.sponsoredLive}`, 'sponsored now'],
              [data.views7d.toLocaleString(), 'views this week'],
              [data.taps7d.toLocaleString(), 'link taps this week'],
              [data.reached7d.toLocaleString(), 'people reached this week'],
            ].map(([n, l]) => (
              <View key={l} style={styles.tile}>
                <Text style={styles.tileBig}>{n}</Text>
                <Text style={styles.label}>{l}</Text>
              </View>
            ))}
          </View>
          {data.challenges.length === 0 && <Text style={styles.label}>No sponsored challenges yet.</Text>}
          {data.challenges.map((c) => {
            const isOpen = openId === c.challengeId;
            const golf = c.kind === 'golf';
            return (
              <View key={c.challengeId} style={styles.item}>
                <Pressable onPress={() => open(c.challengeId)} style={styles.itemHead} accessibilityRole="button" accessibilityState={{ expanded: isOpen }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.value} numberOfLines={1}>
                      {c.name}
                    </Text>
                    <Text style={styles.label} numberOfLines={1}>
                      {c.sponsorName} · {fmt(c.startsAt)}–{fmt(c.endsAt)} · {c.views.toLocaleString()} views · {c.taps.toLocaleString()} taps
                    </Text>
                  </View>
                  <Text style={styles.link}>{isOpen ? 'Close' : 'Report'}</Text>
                </Pressable>
                {isOpen && !report && <ActivityIndicator color={colors.accent} />}
                {isOpen && report && (
                  <View style={{ gap: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      {sponsor && <SponsorLogo sponsor={sponsor} size={26} />}
                      <Text style={styles.value}>{report.sponsor.name}</Text>
                    </View>
                    <View style={styles.tiles}>
                      {[
                        [report.reached.toLocaleString(), `players reached (${report.players.toLocaleString()} joined)`],
                        [report.views.toLocaleString(), 'views'],
                        [report.taps.toLocaleString(), `link taps · ${(report.tapRate * 100).toFixed(1)}%`],
                      ].map(([n, l]) => (
                        <View key={l} style={styles.tile}>
                          <Text style={styles.tileBig}>{n}</Text>
                          <Text style={styles.label}>{l}</Text>
                        </View>
                      ))}
                    </View>
                    {report.placements.map((p) => (
                      <View key={p.placement} style={styles.row}>
                        <Text style={styles.label}>{SPONSOR_PLACEMENT_NAME[p.placement] ?? p.placement}</Text>
                        <Text style={styles.value}>
                          {p.views.toLocaleString()} views · {p.viewers.toLocaleString()} people · {p.taps.toLocaleString()} taps
                        </Text>
                      </View>
                    ))}
                    {report.placements.length === 0 && <Text style={styles.label}>No views yet.</Text>}
                    {report.hole && (
                      <View style={styles.row}>
                        <Text style={styles.label}>Their hole, the {report.hole.hole}</Text>
                        <Text style={styles.value}>
                          {report.hole.played.toLocaleString()} played · {report.hole.birdies.toLocaleString()} birdies · {report.hole.bones.toLocaleString()} Bones
                        </Text>
                      </View>
                    )}
                    {editing ? (
                      <View style={{ gap: 10 }}>
                        <SponsorEditor value={editing} onChange={setEditing} golf={golf} />
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          <Button label="Cancel" onPress={() => setEditing(null)} />
                          <Button label={saving ? 'Saving…' : 'Save'} variant="primary" onPress={() => save(c.challengeId, golf)} disabled={saving} />
                        </View>
                      </View>
                    ) : (
                      <Button label="Edit where they show" onPress={() => setEditing(draftFromSponsor(sponsor))} />
                    )}
                  </View>
                )}
              </View>
            );
          })}
        </>
      )}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    footNote: { fontSize: 12.5, lineHeight: 18, color: withAlpha(colors.text, 0.6) },
    loadError: { fontSize: 13, color: '#e5484d' },
    tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    tile: { flexGrow: 1, flexBasis: 120, borderRadius: 10, padding: 9, backgroundColor: withAlpha(colors.text, 0.05) },
    tileBig: { fontFamily: font.headingSemibold, fontSize: 18, color: colors.text },
    item: { gap: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(colors.text, 0.12) },
    itemHead: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
    row: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
    label: { flexShrink: 1, fontSize: 12.5, color: withAlpha(colors.text, 0.62) },
    value: { flexShrink: 1, fontFamily: font.headingSemibold, fontSize: 13.5, color: colors.text, textAlign: 'right' },
    link: { fontFamily: font.headingSemibold, fontSize: 13.5, color: colors.accentActive },
  });
}
