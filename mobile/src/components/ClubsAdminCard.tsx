import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { MinusIcon, PlusIcon } from 'phosphor-react-native';
import { Text } from './Text';
import { Card } from './Card';
import { Button } from './Button';
import { ToggleRow } from './Selectable';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { adminRemoveClub, getClubsOverview, setClubConfig, type ClubsOverview } from '../clubs/clubsApi';
import { CLUB_SPORTS, ClubBadge, sportName } from '../clubs/clubLook';

// "8 clubs · 64 in them", for the fold's line.
export function clubsSummary(o: ClubsOverview): string {
  return `${o.clubs} ${o.clubs === 1 ? 'club' : 'clubs'} · ${o.people} in them`;
}

// Admin → Clubs (0185): how many clubs, who's in them and what they
// post; who can start one, whether Find a club and the popular community
// challenges list are on; and taking a club down.
export function ClubsAdminCard({ onChanged }: { onChanged?: (o: ClubsOverview) => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<ClubsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const changed = useRef(onChanged);
  changed.current = onChanged;

  const load = useCallback(
    () =>
      getClubsOverview()
        .then((o) => {
          setData(o);
          setError(null);
          changed.current?.(o);
        })
        .catch((e) =>
          setError(
            e instanceof Error && /admin_clubs_overview/.test(e.message)
              ? 'Run 0185_clubs.sql to see the clubs.'
              : e instanceof Error
                ? e.message
                : 'Could not load the clubs.',
          ),
        ),
    [],
  );

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const set = (patch: Parameters<typeof setClubConfig>[0]) => {
    setClubConfig(patch)
      .then(load)
      .catch((e) => Alert.alert('Couldn’t save that', e instanceof Error ? e.message : 'Try again.'));
  };

  const remove = (id: string, name: string) => {
    Alert.alert(`Take down ${name}?`, 'It leaves everyone’s Clubs tab and search, and its code stops working. Its challenges carry on.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Take it down', style: 'destructive', onPress: () => adminRemoveClub(id, 'removed by Hound').then(load).catch(() => {}) },
    ]);
  };

  const rows: [string, string][] = data
    ? [
        ['Clubs', `${data.clubs} (${data.publicClubs} public, ${data.privateClubs} private) · ${data.new7d} new this week`],
        ['People in clubs', `${data.people} · ${data.memberships} memberships · ${data.joined7d} joined this week`],
        ['Posting (30 days)', `${data.posts30d} challenges posted · ${data.active30d} ${data.active30d === 1 ? 'club' : 'clubs'} posting`],
        ['Joined through a club (30 days)', `${data.clubJoins30d}`],
        [
          'By sport',
          CLUB_SPORTS.filter((s) => data.bySport[s.id])
            .map((s) => `${s.name} ${data.bySport[s.id]}`)
            .join(' · ') || 'None yet',
        ],
      ]
    : [];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Clubs</Text>
      <Text style={styles.footNote}>
        Members start clubs (public or private), post challenges to them, and the rest of the club joins from the club&rsquo;s page.
        Clubs never narrow who people can play with.
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

          <View style={[styles.row, { gap: 10 }]}>
            <Text style={text.h4}>Settings</Text>
            <View style={styles.levelRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.value}>Level to start a club</Text>
                <Text style={styles.label}>Plus an account {data.config.minAccountDays} days old and a username</Text>
              </View>
              <Pressable onPress={() => set({ min_level: Math.max(1, data.config.minLevel - 1) })} style={styles.step} accessibilityRole="button" accessibilityLabel="Lower">
                <MinusIcon size={14} color={colors.text} />
              </Pressable>
              <Text style={styles.level}>{data.config.minLevel}</Text>
              <Pressable onPress={() => set({ min_level: Math.min(50, data.config.minLevel + 1) })} style={styles.step} accessibilityRole="button" accessibilityLabel="Raise">
                <PlusIcon size={14} color={colors.text} />
              </Pressable>
            </View>
            <ToggleRow
              label="Find a club"
              note={data.config.searchOn ? 'On: public clubs can be searched' : 'Off: clubs are joined by code only'}
              value={data.config.searchOn}
              onChange={(v) => set({ search_on: v })}
            />
            <ToggleRow
              label="Popular community challenges"
              note={data.config.communityListOn ? 'On: listed on the Clubs tab' : 'Off: only featured ones are listed'}
              value={data.config.communityListOn}
              onChange={(v) => set({ community_list_on: v })}
            />
            <ToggleRow
              label="Clubs"
              note={data.config.enabled ? 'On' : 'Off: no new clubs or joins'}
              value={data.config.enabled}
              onChange={(v) => set({ enabled: v })}
            />
          </View>

          <View style={[styles.row, { gap: 8 }]}>
            <Text style={text.h4}>Newest clubs</Text>
            {data.newest.length === 0 ? (
              <Text style={styles.footNote}>No clubs yet.</Text>
            ) : (
              data.newest.map((c) => (
                <View key={c.id} style={styles.club}>
                  <ClubBadge sport={c.sport} color="purple" size={30} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.value}>{c.name}</Text>
                    <Text style={styles.label}>
                      {[sportName(c.sport), c.city, c.isPublic ? 'public' : 'private', `${c.members} members`, `${c.posts} posts`, c.owner ? `@${c.owner}` : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                  <Button label="Take down" variant="ghost" small onPress={() => remove(c.id, c.name)} />
                </View>
              ))
            )}
          </View>
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
    levelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    step: { width: 32, height: 32, borderRadius: 8, borderWidth: 1, borderColor: colors.divider, alignItems: 'center', justifyContent: 'center' },
    level: { fontFamily: font.heading, fontSize: 18, color: colors.text, minWidth: 24, textAlign: 'center' },
    club: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  });
}
