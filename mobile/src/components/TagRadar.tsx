import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Avatar } from './Avatar';
import { font, withAlpha, type Palette } from '../theme/tokens';

// The visual for Game of Tag's own chase: It sits fixed at the center,
// every other participant is arranged around it at an angle (just for
// spacing — angle itself carries no meaning) and a radius proportional
// to how far away they currently are. "Away" means two different things
// depending on the member: the actual picked target's distance is the
// real, frozen tag_rounds.target_snapshot_metric gap that
// tag_check_catch itself is comparing against (see tagApi.ts) — closing
// that to zero really does end this round. Everyone else has no such
// snapshot (nobody's picked them), so their ring position is only ever
// illustrative: today's live gap between their own total and It's,
// recomputed on every load like the rest of this screen's board.
export interface TagRadarMember {
  userId: string;
  initials: string;
  name: string;
  distance: number;
  isTarget: boolean;
  isMe: boolean;
}

const SIZE = 300;
const CENTER = SIZE / 2;
const SLOT_W = 76;
const IT_AVATAR_SIZE = 60;
const MEMBER_AVATAR_SIZE = 46;
const MIN_ORBIT = 66;
const MAX_ORBIT = CENTER - MEMBER_AVATAR_SIZE / 2 - 8;

export function TagRadar({
  itInitials,
  itName,
  isMeIt,
  members,
  colors,
  formatDistance,
}: {
  itInitials: string;
  itName: string;
  isMeIt: boolean;
  members: TagRadarMember[];
  colors: Palette;
  formatDistance: (value: number) => string;
}) {
  const styles = makeStyles(colors);
  // Floors at 1 so an all-tied board (everyone's distance is 0) puts
  // every ring at MIN_ORBIT instead of dividing by zero.
  const maxDistance = Math.max(1, ...members.map((m) => m.distance));
  const count = members.length;

  return (
    <View style={styles.wrap}>
      <Svg width={SIZE} height={SIZE} style={StyleSheet.absoluteFill}>
        {[0.34, 0.67, 1].map((frac) => (
          <Circle
            key={frac}
            cx={CENTER}
            cy={CENTER}
            r={MIN_ORBIT + frac * (MAX_ORBIT - MIN_ORBIT)}
            stroke={withAlpha(colors.text, 0.1)}
            strokeWidth={1}
            fill="none"
          />
        ))}
      </Svg>

      <View style={[styles.slot, { left: CENTER - SLOT_W / 2, top: CENTER - IT_AVATAR_SIZE / 2 }]}>
        <View
          style={[
            styles.itRing,
            { width: IT_AVATAR_SIZE + 8, height: IT_AVATAR_SIZE + 8, borderRadius: (IT_AVATAR_SIZE + 8) / 2 },
          ]}
        >
          <Avatar initials={itInitials} tint={colors.amber} size={IT_AVATAR_SIZE} fontSize={18} />
        </View>
        <Text style={styles.centerLabel} numberOfLines={1}>
          {isMeIt ? 'You · It' : `${itName} · It`}
        </Text>
      </View>

      {members.map((m, i) => {
        const angle = -90 + (360 / Math.max(1, count)) * i;
        const rad = (angle * Math.PI) / 180;
        const radius = MIN_ORBIT + (m.distance / maxDistance) * (MAX_ORBIT - MIN_ORBIT);
        const x = CENTER + radius * Math.cos(rad);
        const y = CENTER + radius * Math.sin(rad);
        return (
          <View key={m.userId} style={[styles.slot, { left: x - SLOT_W / 2, top: y - MEMBER_AVATAR_SIZE / 2 }]}>
            <View
              style={[
                styles.memberRing,
                { width: MEMBER_AVATAR_SIZE + 6, height: MEMBER_AVATAR_SIZE + 6, borderRadius: (MEMBER_AVATAR_SIZE + 6) / 2 },
                m.isTarget && { borderColor: colors.accent, borderWidth: 2 },
              ]}
            >
              <Avatar
                initials={m.initials}
                tint={m.isMe ? colors.accent : withAlpha(colors.text, 0.35)}
                size={MEMBER_AVATAR_SIZE}
                fontSize={14}
              />
            </View>
            <Text style={styles.memberLabel} numberOfLines={1}>
              {m.name}
            </Text>
            <Text style={styles.memberDistance} numberOfLines={1}>
              {formatDistance(m.distance)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    wrap: { width: SIZE, height: SIZE, alignSelf: 'center' },
    slot: { position: 'absolute', width: SLOT_W, alignItems: 'center' },
    itRing: {
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: colors.amber,
      backgroundColor: withAlpha(colors.amber, 0.08),
    },
    memberRing: {
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: withAlpha(colors.text, 0.12),
    },
    centerLabel: { width: SLOT_W, fontSize: 11, fontFamily: font.heading, color: colors.text, marginTop: 4, textAlign: 'center' },
    memberLabel: { width: SLOT_W, fontSize: 11, color: colors.text, fontFamily: font.body, marginTop: 4, textAlign: 'center' },
    memberDistance: { width: SLOT_W, fontSize: 10, color: withAlpha(colors.text, 0.55), textAlign: 'center' },
  });
}
