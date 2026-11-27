import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from './Text';
import { Card } from './Card';
import { Button } from './Button';
import { TextField } from './TextField';
import { ToggleRow } from './Selectable';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { supabase } from '../lib/supabase';
import { STARTER_TEXT, type StarterStepId } from '../home/starterPath';

// Admin → Overview → Status → Your first week (0282): the starter path for
// new accounts. How many started and finished, each step's done / skipped
// and how long it took, who came back the week after (finished or not),
// and the amounts, which can be changed here.

export interface StarterOverview {
  config: { enabled: boolean; step_bones: number; global_bones: number; finish_bones: number; days: number; start_after: string };
  started: number;
  started7d: number;
  finished: number;
  claimed: number;
  bonesPaid: number;
  bandanasWorn: number;
  steps: Record<string, { offered: number; done: number; skipped: number; median_hours: number | null }>;
  back: { finished: number; finished_back: number; not_finished: number; not_finished_back: number } | null;
}

export function starterSummary(d: StarterOverview): string {
  return `${d.started} started · ${d.finished} finished`;
}

const pct = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)}%` : '—');
const STEPS: StarterStepId[] = ['goal', 'fast', 'move', 'global'];

export function StarterAdminCard({ onChanged }: { onChanged?: (d: StarterOverview) => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<StarterOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState<Record<string, string>>({});
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const changed = useRef(onChanged);
  changed.current = onChanged;

  const load = useCallback(() => {
    if (!supabase) return;
    supabase.rpc('admin_starter_overview').then(({ data: d, error: e }) => {
      if (e) {
        setError(/admin_starter_overview/.test(e.message) ? 'Run 0282_starter_path.sql first.' : e.message);
        return;
      }
      const raw = (d ?? {}) as any;
      const o: StarterOverview = {
        config: raw.config,
        started: Number(raw.started ?? 0),
        started7d: Number(raw.started_7d ?? 0),
        finished: Number(raw.finished ?? 0),
        claimed: Number(raw.claimed ?? 0),
        bonesPaid: Number(raw.bones_paid ?? 0),
        bandanasWorn: Number(raw.bandanas_worn ?? 0),
        steps: raw.steps ?? {},
        back: raw.back_week2 ?? null,
      };
      setData(o);
      setEnabled(!!o.config?.enabled);
      setInput({
        step_bones: String(o.config?.step_bones ?? 10),
        global_bones: String(o.config?.global_bones ?? 15),
        finish_bones: String(o.config?.finish_bones ?? 15),
        days: String(o.config?.days ?? 7),
      });
      setError(null);
      changed.current?.(o);
    });
  }, []);
  useFocusEffect(load);

  const save = async () => {
    if (!supabase) return;
    const p: Record<string, number | boolean> = { enabled };
    for (const [k, v] of Object.entries(input)) {
      const n = Number(v);
      if (!Number.isInteger(n)) {
        setError('Whole numbers only.');
        return;
      }
      p[k] = n;
    }
    setSaving(true);
    const { error: e } = await supabase.rpc('admin_set_starter_config', { p });
    setSaving(false);
    if (e) setError(e.message);
    else {
      setSaved(true);
      setError(null);
      load();
    }
  };

  const field = (k: string, label: string) => (
    <TextField
      label={label}
      value={input[k] ?? ''}
      onChangeText={(v) => {
        setInput({ ...input, [k]: v });
        setSaved(false);
      }}
      keyboardType="number-pad"
    />
  );

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Your first week</Text>
      <Text style={styles.footNote}>
        New accounts' starter path, in place of Finish setting up: a step for each part of Hound they ticked, then a Global challenge. Accounts made before
        it started keep Finish setting up.
      </Text>
      {error && <Text style={styles.loadError}>{error}</Text>}
      {!data ? (
        !error && <ActivityIndicator color={colors.accent} />
      ) : (
        <>
          <View style={styles.row}>
            <Text style={styles.label}>Started (7 days)</Text>
            <Text style={styles.value}>
              {data.started} ({data.started7d}) · {data.finished} finished ({pct(data.finished, data.started)}) · {data.claimed} claimed
            </Text>
          </View>
          {STEPS.filter((s) => data.steps[s]).map((s) => {
            const v = data.steps[s];
            return (
              <View key={s} style={styles.row}>
                <Text style={styles.label}>{STARTER_TEXT[s].title}</Text>
                <Text style={styles.value}>
                  {v.done} of {v.offered} done ({pct(v.done, v.offered)}) · {v.skipped} skipped
                  {v.median_hours !== null ? ` · ${v.median_hours} h to do` : ''}
                </Text>
              </View>
            );
          })}
          {data.back && (
            <View style={styles.row}>
              <Text style={styles.label}>Back the week after (paths 2+ weeks old)</Text>
              <Text style={styles.value}>
                Finished {pct(data.back.finished_back, data.back.finished)} · didn’t {pct(data.back.not_finished_back, data.back.not_finished)}
              </Text>
            </View>
          )}
          <View style={styles.row}>
            <Text style={styles.label}>Bones paid · bandanas being worn</Text>
            <Text style={styles.value}>
              {data.bonesPaid.toLocaleString()} · {data.bandanasWorn}
            </Text>
          </View>
          <Text style={[text.h4, { marginTop: 6 }]}>Settings</Text>
          <ToggleRow label="On for new accounts" note={enabled ? 'New accounts get it' : 'Off: Finish setting up instead'} value={enabled} onChange={(v) => {
            setEnabled(v);
            setSaved(false);
          }} />
          {field('step_bones', 'Bones a step')}
          {field('global_bones', 'Bones for the Global step')}
          {field('finish_bones', 'Bones for finishing (with the Starter Bandana)')}
          {field('days', 'Days to do it')}
          <Button label={saving ? 'Saving…' : saved ? 'Saved' : 'Save'} variant="primary" block disabled={saving} onPress={save} />
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
  });
}
