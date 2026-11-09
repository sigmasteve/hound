import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeftIcon, CheckIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { SegmentedControl } from '../components/SegmentedControl';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { createClub, getClubPage, updateClub, type ClubColor, type ClubSport } from '../clubs/clubsApi';
import { CLUB_COLORS, CLUB_SPORTS, ClubBadge } from '../clubs/clubLook';
import { localDayKey } from '../water/water';

// Start a club (0185), or change one's details (clubId). Public or
// private is picked once, when it's made.
export function StartClubScreen({
  clubId,
  onBack,
  onDone,
}: {
  clubId?: string;
  onBack: () => void;
  onDone: (clubId: string) => void;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [name, setName] = useState('');
  const [sport, setSport] = useState<ClubSport>('running');
  const [city, setCity] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState<ClubColor>('orange');
  const [isPublic, setIsPublic] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clubId) return;
    getClubPage(clubId, localDayKey())
      .then((c) => {
        setName(c.name);
        setSport(c.sport);
        setCity(c.city ?? '');
        setDescription(c.description ?? '');
        setColor(c.color);
        setIsPublic(c.isPublic);
      })
      .catch(() => {});
  }, [clubId]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (clubId) {
        await updateClub(clubId, { name, sport, city, description, color });
        onDone(clubId);
      } else {
        const made = await createClub({ name, sport, city, description, color, isPublic });
        onDone(made.id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the club.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <Button label="Back" variant="ghost" small icon={<ArrowLeftIcon size={13} color={colors.accent} />} onPress={onBack} />
        <View style={styles.hero}>
          <ClubBadge sport={sport} color={color} size={56} />
          <View style={{ flex: 1 }}>
            <Text style={text.h2}>{clubId ? 'Edit the club' : 'Start a club'}</Text>
            <Text style={styles.note}>A run club, a cycling group, the Saturday walkers. Members post challenges and everyone can join.</Text>
          </View>
        </View>

        <Card style={{ gap: 12 }} elevated={false}>
          <TextField label="Name" value={name} onChangeText={setName} maxLength={40} placeholder="Eastside Runners" />
          <View style={{ gap: 6 }}>
            <Text style={styles.label}>Sport</Text>
            <View style={styles.chips}>
              {CLUB_SPORTS.map(({ id, name: n, Icon }) => {
                const on = id === sport;
                return (
                  <Pressable key={id} onPress={() => setSport(id)} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
                    <Icon size={14} color={on ? colors.accentActive : colors.text} />
                    <Text style={[styles.chipText, on && { color: colors.accentActive }]}>{n}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <TextField label="City (optional)" value={city} onChangeText={setCity} maxLength={40} placeholder="Austin, TX" />
          <TextField
            label="About the club (optional)"
            value={description}
            onChangeText={setDescription}
            maxLength={160}
            multiline
            placeholder="Tuesday and Saturday runs from the Riverside trailhead. All paces welcome."
          />
          <View style={{ gap: 6 }}>
            <Text style={styles.label}>Colour</Text>
            <View style={styles.chips}>
              {(Object.keys(CLUB_COLORS) as ClubColor[]).map((c) => (
                <Pressable key={c} onPress={() => setColor(c)} style={[styles.swatch, { backgroundColor: CLUB_COLORS[c] }]} accessibilityRole="button" accessibilityLabel={c} accessibilityState={{ selected: c === color }}>
                  {c === color && <CheckIcon size={16} color="#fff" weight="bold" />}
                </Pressable>
              ))}
            </View>
          </View>
        </Card>

        {!clubId && (
          <Card style={{ gap: 10 }} elevated={false}>
            <Text style={styles.label}>Who can join</Text>
            <SegmentedControl
              options={[
                { value: 'public', label: 'Public' },
                { value: 'private', label: 'Private' },
              ]}
              value={isPublic ? 'public' : 'private'}
              onChange={(v) => setIsPublic(v === 'public')}
            />
            <Text style={styles.note}>
              {isPublic
                ? 'Anyone can find it in Find a club and join, or join with its code, link or QR.'
                : 'Hidden from Find a club. People join with its code, link or QR, which you share from the club’s page.'}{' '}
              This can&rsquo;t be changed later.
            </Text>
          </Card>
        )}

        <Text style={styles.small}>Clubs show usernames. Names, cities and descriptions are checked for links, phone numbers and bad words.</Text>
        {error && <Text style={styles.error}>{error}</Text>}
        <Button label={saving ? 'Saving…' : clubId ? 'Save' : 'Start the club'} variant="primary" disabled={saving || name.trim().length < 2} onPress={save} />
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    container: { padding: 16, gap: 14, paddingBottom: 60 },
    hero: { flexDirection: 'row', gap: 12, alignItems: 'center' },
    note: { fontSize: 13, lineHeight: 18, color: withAlpha(colors.text, 0.65) },
    small: { fontSize: 12, color: withAlpha(colors.text, 0.55) },
    label: { fontSize: 14, color: colors.text },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 999, borderWidth: 1.5, borderColor: colors.divider },
    chipOn: { borderColor: colors.accent, backgroundColor: withAlpha(colors.accent, 0.16) },
    chipText: { fontSize: 13, fontFamily: font.headingSemibold, color: colors.text },
    swatch: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    error: { fontSize: 13, color: colors.amber },
  });
}
