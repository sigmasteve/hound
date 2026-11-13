import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Switch, View } from 'react-native';
import { Text } from './Text';
import { TextField } from './TextField';
import { SponsorLogo } from './SponsorLine';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { canAddPhoto, pickPhoto } from '../dogPhotos/dogPhotos';
import { uploadSponsorLogo, type ChallengeSponsor } from '../challenges/globalChallenges';

// A Global challenge's sponsor, as an admin types it (0111, and 0203's
// placements): the logo, name, link and message, then where they show.
// Golf (the Hound Open) gets the course boards, a hole of their own and a
// message at the finish. Used by Create and by Admin → Sponsors.

export interface SponsorDraft {
  name: string;
  message: string;
  url: string;
  logoUrl: string;
  color: string;
  presented: boolean;
  boards: boolean;
  holeOn: boolean;
  hole: number;
  holeBones: string;
  finishOn: boolean;
  finishMessage: string;
  finishLabel: string;
  prizes: boolean;
  prizeNote: string;
}

export const SPONSOR_COLORS = ['#f08a24', '#e5484d', '#3fb37f', '#3e8ed0', '#9184d9', '#1f9e9e'];

export function emptySponsorDraft(): SponsorDraft {
  return {
    name: '',
    message: '',
    url: '',
    logoUrl: '',
    color: SPONSOR_COLORS[0],
    presented: true,
    boards: true,
    holeOn: false,
    hole: 7,
    holeBones: '5',
    finishOn: false,
    finishMessage: '',
    finishLabel: '',
    prizes: false,
    prizeNote: '',
  };
}

export function draftFromSponsor(s: ChallengeSponsor | null): SponsorDraft {
  if (!s) return emptySponsorDraft();
  return {
    name: s.name,
    message: s.message ?? '',
    url: s.url ?? '',
    logoUrl: s.logoUrl ?? '',
    color: s.color ?? SPONSOR_COLORS[0],
    presented: !!s.presented,
    boards: !!s.boards,
    holeOn: s.hole != null,
    hole: s.hole ?? 7,
    holeBones: String(s.holeBones ?? 5),
    finishOn: !!s.finishMessage,
    finishMessage: s.finishMessage ?? '',
    finishLabel: s.finishLabel ?? '',
    prizes: !!s.prizes,
    prizeNote: s.prizeNote ?? '',
  };
}

// The sponsor to save, or null for none. Golf-only placements are left off
// for other kinds.
export function sponsorFromDraft(d: SponsorDraft, golf: boolean): ChallengeSponsor | null {
  const name = d.name.trim();
  if (!name) return null;
  return {
    name,
    message: d.message.trim() || null,
    url: d.url.trim() || null,
    logoUrl: d.logoUrl.trim() || null,
    color: d.color || null,
    presented: d.presented,
    boards: golf && d.boards,
    hole: golf && d.holeOn ? d.hole : null,
    holeBones: golf && d.holeOn ? Math.max(0, Math.min(100, Math.round(Number(d.holeBones.replace(/[^0-9]/g, '')) || 0))) : null,
    finishMessage: golf && d.finishOn ? d.finishMessage.trim() || null : null,
    finishLabel: golf && d.finishOn ? d.finishLabel.trim() || null : null,
    prizes: d.prizes,
    prizeNote: d.prizes ? d.prizeNote.trim() || null : null,
  };
}

// Anything set beyond the plain line (0111): saved with the v2 call.
export function usesPlacements(s: ChallengeSponsor): boolean {
  return !!(s.logoUrl || s.presented || s.boards || s.hole != null || s.finishMessage || s.prizes || (s.color && s.color !== SPONSOR_COLORS[0]));
}

// A sentence to show, or null when it's fine to save.
export function sponsorDraftProblem(d: SponsorDraft): string | null {
  const name = d.name.trim();
  const anything = d.message.trim() || d.url.trim() || d.logoUrl.trim() || d.finishMessage.trim() || d.prizeNote.trim();
  if (!name) return anything ? 'Add the sponsor’s name, or clear the rest.' : null;
  if (d.url.trim() && !/^https:\/\/\S+$/.test(d.url.trim())) return 'The sponsor’s link must start with https://';
  if (d.logoUrl.trim() && !/^https:\/\/\S+$/.test(d.logoUrl.trim())) return 'The logo’s address must start with https://';
  if (d.finishOn && !d.finishMessage.trim()) return 'Write the finish message, or turn it off.';
  return null;
}

export function SponsorEditor({
  value,
  onChange,
  golf,
}: {
  value: SponsorDraft;
  onChange: (next: SponsorDraft) => void;
  // Golf (the Hound Open): the course boards, the hole sponsor, the finish.
  golf: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [uploading, setUploading] = useState(false);
  const set = (patch: Partial<SponsorDraft>) => onChange({ ...value, ...patch });
  const preview: ChallengeSponsor = {
    name: value.name.trim() || 'Sponsor',
    message: null,
    url: null,
    logoUrl: value.logoUrl.trim() || null,
    color: value.color,
  };

  const pickLogo = async () => {
    try {
      const photo = await pickPhoto('library');
      if (!photo) return;
      setUploading(true);
      const url = await uploadSponsorLogo(photo.base64);
      set({ logoUrl: url });
    } catch (e) {
      Alert.alert('Logo', e instanceof Error ? e.message : 'Couldn’t upload that logo.');
    } finally {
      setUploading(false);
    }
  };

  const toggle = (label: string, note: string, on: boolean, flip: (v: boolean) => void) => (
    <View style={styles.switchRow}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.note}>{note}</Text>
      </View>
      <Switch value={on} onValueChange={flip} trackColor={{ true: colors.accent, false: withAlpha(colors.text, 0.2) }} accessibilityLabel={label} />
    </View>
  );

  return (
    <View style={{ gap: 10 }}>
      <View style={styles.logoRow}>
        <Pressable
          onPress={canAddPhoto() ? pickLogo : undefined}
          disabled={uploading || !canAddPhoto()}
          style={styles.logoBox}
          accessibilityRole="button"
          accessibilityLabel={value.logoUrl ? 'Change the sponsor’s logo' : 'Add the sponsor’s logo'}
        >
          {uploading ? <ActivityIndicator color={colors.accent} /> : <SponsorLogo sponsor={preview} size={44} />}
        </Pressable>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.note}>
            {canAddPhoto() ? 'Tap to pick a square logo, or paste its https address below.' : 'Paste the logo’s https address below.'}
          </Text>
          <View style={styles.swatches}>
            {SPONSOR_COLORS.map((c) => (
              <Pressable
                key={c}
                onPress={() => set({ color: c })}
                style={[styles.swatch, { backgroundColor: c }, value.color === c && styles.swatchOn]}
                accessibilityRole="button"
                accessibilityLabel={`Colour ${c}`}
                accessibilityState={{ selected: value.color === c }}
              />
            ))}
          </View>
        </View>
      </View>
      <TextField label="Sponsor name" value={value.name} onChangeText={(t: string) => set({ name: t })} placeholder="e.g. Acme Running Co." maxLength={40} />
      <TextField
        label="Message"
        value={value.message}
        onChangeText={(t: string) => set({ message: t })}
        placeholder="e.g. Every mile tells a story."
        maxLength={100}
      />
      <TextField
        label="Link"
        value={value.url}
        onChangeText={(t: string) => set({ url: t })}
        placeholder="https://"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        maxLength={200}
      />
      <TextField
        label="Logo address (optional)"
        value={value.logoUrl}
        onChangeText={(t: string) => set({ logoUrl: t })}
        placeholder="https://…/logo.png"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        maxLength={300}
      />

      <Text style={styles.heading}>Where they show</Text>
      {toggle('Presented by', 'On the title, Today and the leaderboard', value.presented, (v) => set({ presented: v }))}
      {golf && toggle('Boards on the course', 'Behind every green', value.boards, (v) => set({ boards: v }))}
      {golf && toggle('Hole sponsor', 'A hole of their own: birdie it and they add Bones', value.holeOn, (v) => set({ holeOn: v }))}
      {golf && value.holeOn && (
        <View style={{ gap: 8 }}>
          <View style={styles.holes}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => {
              const on = value.hole === n;
              return (
                <Pressable
                  key={n}
                  onPress={() => set({ hole: n })}
                  style={[styles.holeChip, on && styles.holeChipOn]}
                  accessibilityRole="button"
                  accessibilityLabel={`Hole ${n}`}
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[styles.holeText, on && { color: colors.bg }]}>{n}</Text>
                </Pressable>
              );
            })}
          </View>
          <TextField
            label="Bones for a birdie there"
            value={value.holeBones}
            onChangeText={(t: string) => set({ holeBones: t })}
            keyboardType="number-pad"
            maxLength={3}
          />
          <Text style={styles.note}>On 18 holes it’s that hole on both nines.</Text>
        </View>
      )}
      {golf && toggle('Finish message', 'Once, when someone finishes every hole', value.finishOn, (v) => set({ finishOn: v }))}
      {golf && value.finishOn && (
        <View style={{ gap: 8 }}>
          <TextField
            label="Message"
            value={value.finishMessage}
            onChangeText={(t: string) => set({ finishMessage: t })}
            placeholder="e.g. Your feet earned a new pair."
            maxLength={120}
          />
          <TextField
            label="Link label"
            value={value.finishLabel}
            onChangeText={(t: string) => set({ finishLabel: t })}
            placeholder="e.g. See Acme’s trail shoes"
            maxLength={30}
          />
        </View>
      )}
      {toggle('Prizes from', 'Names the sponsor on the prizes', value.prizes, (v) => set({ prizes: v }))}
      {value.prizes && (
        <TextField
          label="Prize note (optional)"
          value={value.prizeNote}
          onChangeText={(t: string) => set({ prizeNote: t })}
          placeholder="e.g. The winner gets a $50 gift card from Acme"
          maxLength={120}
        />
      )}
      <Text style={styles.note}>
        Sponsors see counts only (views and taps), never who played. A real prize is sent by the sponsor, not Hound.
      </Text>
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    logoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    logoBox: {
      width: 64,
      height: 64,
      borderRadius: 14,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: withAlpha(colors.text, 0.3),
      alignItems: 'center',
      justifyContent: 'center',
    },
    swatches: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
    swatch: { width: 30, height: 30, borderRadius: 15 },
    swatchOn: { borderWidth: 3, borderColor: colors.text },
    heading: { fontFamily: font.headingSemibold, fontSize: 13, color: withAlpha(colors.text, 0.7), marginTop: 4 },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
    label: { fontFamily: font.headingSemibold, fontSize: 14, color: colors.text },
    note: { fontSize: 12, lineHeight: 16, color: withAlpha(colors.text, 0.6) },
    holes: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    holeChip: {
      width: 44,
      height: 44,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: withAlpha(colors.text, 0.18),
      alignItems: 'center',
      justifyContent: 'center',
    },
    holeChipOn: { backgroundColor: colors.text, borderColor: colors.text },
    holeText: { fontFamily: font.headingSemibold, fontSize: 14, color: colors.text },
  });
}
