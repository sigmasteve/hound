import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { MagnifyingGlassIcon } from 'phosphor-react-native';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { Card } from './Card';
import { TextField } from './TextField';
import { useTheme } from '../theme/ThemeContext';
import { font, TINT_N, withAlpha, type Palette } from '../theme/tokens';
import { supabaseFriendsProvider } from '../friends/supabaseFriends';
import {
  findPeople,
  MIN_SEARCH_LENGTH,
  peopleYouMayKnow,
  type FoundPerson,
  type PersonRelation,
} from '../friends/discovery';

// Friends tab: search Hound by name or username, and "People you may
// know" underneath (0080_friend_discovery.sql). Either half is hidden when
// an admin has switched it off.
export function FindPeopleCard({
  searchEnabled,
  suggestionsEnabled,
  onChanged,
}: {
  searchEnabled: boolean;
  suggestionsEnabled: boolean;
  // A request that turns into a friendship (accepting someone who'd
  // already asked) changes the friends list above.
  onChanged: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoundPerson[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<FoundPerson[] | null>(null);
  // Relations changed from this card, until the lists reload.
  const [changed, setChanged] = useState<Record<string, PersonRelation>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!suggestionsEnabled) return;
    peopleYouMayKnow()
      .then(setSuggestions)
      .catch(() => setSuggestions(null));
  }, [suggestionsEnabled]);

  // Debounced, like Admin's user search.
  useEffect(() => {
    if (!searchEnabled) return;
    const q = query.trim();
    if (q.length < MIN_SEARCH_LENGTH) {
      setResults(null);
      setSearchError(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      setSearching(true);
      findPeople(q)
        .then((r) => {
          if (!cancelled) {
            setResults(r);
            setSearchError(null);
          }
        })
        .catch((e) => {
          if (!cancelled) setSearchError(e instanceof Error ? e.message : 'Could not search right now.');
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, searchEnabled]);

  if (!searchEnabled && !suggestionsEnabled) return null;

  const add = async (person: FoundPerson, relation: PersonRelation) => {
    setBusyId(person.userId);
    setActionError(null);
    try {
      // Sends a request — or, if they'd already asked you, accepts it.
      await supabaseFriendsProvider.sendFriendRequest(person.userId);
      setChanged((cur) => ({ ...cur, [person.userId]: relation === 'incoming' ? 'friends' : 'requested' }));
      if (relation === 'incoming') onChanged();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not send that request — try again.');
    } finally {
      setBusyId(null);
    }
  };

  const row = (person: FoundPerson, sub: string | null) => {
    const relation = changed[person.userId] ?? person.relation;
    return (
      <View key={person.userId} style={styles.row}>
        {/* Fixed-width slot: a framed avatar is wider, and names should
            still line up. */}
        <View style={styles.avatarSlot}>
          <Avatar
            initials={person.initials}
            tint={TINT_N}
            size={34}
            fontSize={12}
            frameId={person.frameId}
            backgroundId={person.backgroundId}
            iconId={person.iconId}
          />
        </View>
        <View style={{ flex: 1, gap: 1 }}>
          <Text style={styles.name} numberOfLines={1}>
            {person.name}
          </Text>
          {!!sub && <Text style={styles.sub}>{sub}</Text>}
        </View>
        {relation === 'friends' ? (
          <Text style={styles.state}>Friends</Text>
        ) : relation === 'requested' ? (
          <Text style={styles.state}>Requested</Text>
        ) : (
          <Button
            label={busyId === person.userId ? '…' : relation === 'incoming' ? 'Accept' : 'Add'}
            variant="primary"
            small
            disabled={busyId !== null}
            onPress={() => add(person, relation)}
          />
        )}
      </View>
    );
  };

  const searchingNow = searchEnabled && query.trim().length >= MIN_SEARCH_LENGTH;
  const visibleSuggestions = (suggestions ?? []).filter((p) => (changed[p.userId] ?? 'none') !== 'friends');

  return (
    <Card style={{ gap: 10 }} elevated={false}>
      <Text style={styles.title}>Find people</Text>
      {searchEnabled && (
        <TextField
          label="Search by name or username"
          value={query}
          onChangeText={setQuery}
          placeholder="e.g. Jordan"
          autoCapitalize="none"
          autoCorrect={false}
          icon={<MagnifyingGlassIcon size={16} color={withAlpha(colors.text, 0.5)} />}
        />
      )}
      {actionError && <Text style={styles.error}>{actionError}</Text>}

      {searchingNow ? (
        searching && !results ? (
          <ActivityIndicator color={colors.accent} />
        ) : searchError ? (
          <Text style={styles.error}>{searchError}</Text>
        ) : results && results.length === 0 ? (
          <Text style={styles.sub}>No one on Hound matches “{query.trim()}”.</Text>
        ) : (
          (results ?? []).map((p) =>
            row(p, p.relation === 'incoming' ? 'Wants to be your friend' : null),
          )
        )
      ) : (
        suggestionsEnabled &&
        visibleSuggestions.length > 0 && (
          <>
            <Text style={styles.label}>People you may know</Text>
            {visibleSuggestions.map((p) => row(p, p.reason))}
          </>
        )
      )}
      {!searchingNow && searchEnabled && (!suggestionsEnabled || visibleSuggestions.length === 0) && (
        <Text style={styles.sub}>Type at least {MIN_SEARCH_LENGTH} letters to search everyone on Hound.</Text>
      )}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    title: { fontSize: 16, fontFamily: font.heading, color: colors.text },
    label: { fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', color: withAlpha(colors.text, 0.55) },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 6,
    },
    avatarSlot: { width: 44, alignItems: 'center' },
    name: { fontSize: 14.5, fontFamily: font.heading, color: colors.text },
    sub: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
    state: { fontSize: 12.5, fontFamily: font.heading, color: withAlpha(colors.text, 0.55) },
    error: { fontSize: 12.5, color: colors.amber },
  });
}
