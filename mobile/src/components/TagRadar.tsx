import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
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
// Large enough that even a member placed directly below It (the tight
// case: two members split top/bottom) clears It's own full stack — the
// halo and the name label under it — with a little breathing room,
// rather than the name text running into that member's own avatar.
const MIN_ORBIT = 80;
const MAX_ORBIT = CENTER - MEMBER_AVATAR_SIZE / 2 - 8;
// Just outside It's own halo (radius (IT_AVATAR_SIZE + 8) / 2 = 34) —
// close enough to read as "this belongs to It," with a few px of gap so
// it doesn't run flush against the halo's own stroke, and well inside
// MIN_ORBIT so it never collides with the nearest member ring.
const CLOCK_RADIUS = (IT_AVATAR_SIZE + 8) / 2 + 6;
const CLOCK_CIRCUMFERENCE = 2 * Math.PI * CLOCK_RADIUS;
const MEMBER_RING_RADIUS = (MEMBER_AVATAR_SIZE + 6) / 2;
// A member placed due south at MAX_ORBIT — the worst case for how far
// down a member's own ring + two label lines can reach — lands past
// SIZE's own bottom edge (this container is a fixed square, sized only
// for the ring geometry, not for label text hanging below it). Absolutely
// positioned children don't get clipped to their parent's bounds, so
// without this the overflow doesn't just get cut off — it renders on
// top of whatever this card shows next. Padding the container's own
// height by this amount reserves real layout space for that overflow
// instead, at the cost of the ring itself sitting slightly above center
// in a taller box rather than dead center.
const BOTTOM_LABEL_BUFFER = 44;

export function TagRadar({
  itInitials,
  itName,
  isMeIt,
  members,
  colors,
  formatDistance,
  minutesLeft,
  timeLimitMinutes,
}: {
  itInitials: string;
  itName: string;
  isMeIt: boolean;
  members: TagRadarMember[];
  colors: Palette;
  formatDistance: (value: number) => string;
  // The same round-timeout clock regardless of whether It has picked a
  // target yet — tag_settle_timeout (see tagApi.ts) hands It to someone
  // else at 0 either way, whether that's a stale It who never picked
  // anyone or an active chase that ran out the clock. One ring around
  // It covers both cases identically since they're really the same
  // timer.
  minutesLeft: number;
  timeLimitMinutes: number;
}) {
  const styles = makeStyles(colors);
  // Floors at 1 so an all-tied board (everyone's distance is 0) puts
  // every ring at MIN_ORBIT instead of dividing by zero.
  const maxDistance = Math.max(1, ...members.map((m) => m.distance));
  const count = members.length;
  const clockFraction = Math.max(0, Math.min(1, timeLimitMinutes > 0 ? minutesLeft / timeLimitMinutes : 0));
  // Under a fifth of the round left reads as genuinely urgent — same
  // green/amber status-tone vocabulary the rest of the app already uses
  // (see theme/tokens.ts's own toneColor), not a new color language just
  // for this ring.
  const clockColor = clockFraction > 0.2 ? colors.green : colors.amber;

  // Computed once and reused for both the connecting line below and
  // each member's own slot — angle is purely for spacing (see this
  // file's own top comment), radius is the one number that actually
  // means something.
  const positioned = members.map((m, i) => {
    const angle = -90 + (360 / Math.max(1, count)) * i;
    const rad = (angle * Math.PI) / 180;
    const radius = MIN_ORBIT + (m.distance / maxDistance) * (MAX_ORBIT - MIN_ORBIT);
    return { ...m, dirX: Math.cos(rad), dirY: Math.sin(rad), x: CENTER + radius * Math.cos(rad), y: CENTER + radius * Math.sin(rad) };
  });
  const target = positioned.find((m) => m.isTarget);

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
        <Circle
          cx={CENTER}
          cy={CENTER}
          r={CLOCK_RADIUS}
          stroke={withAlpha(colors.text, 0.12)}
          strokeWidth={3}
          fill="none"
        />
        <Circle
          cx={CENTER}
          cy={CENTER}
          r={CLOCK_RADIUS}
          stroke={clockColor}
          strokeWidth={3}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${CLOCK_CIRCUMFERENCE} ${CLOCK_CIRCUMFERENCE}`}
          strokeDashoffset={CLOCK_CIRCUMFERENCE * (1 - clockFraction)}
          rotation={-90}
          origin={`${CENTER}, ${CENTER}`}
        />
        {/* The one visual answer to "who's It actually chasing" — drawn
            from just outside It's own countdown ring to just outside
            the target's own ring (not center-to-center, which would run
            underneath both avatars instead of connecting their edges). */}
        {target && (
          <Line
            x1={CENTER + CLOCK_RADIUS * target.dirX}
            y1={CENTER + CLOCK_RADIUS * target.dirY}
            x2={target.x - MEMBER_RING_RADIUS * target.dirX}
            y2={target.y - MEMBER_RING_RADIUS * target.dirY}
            stroke={colors.accent}
            strokeWidth={2}
            strokeDasharray="6 5"
            strokeLinecap="round"
          />
        )}
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

      {positioned.map((m) => {
        return (
          <View key={m.userId} style={[styles.slot, { left: m.x - SLOT_W / 2, top: m.y - MEMBER_AVATAR_SIZE / 2 }]}>
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
    wrap: { width: SIZE, height: SIZE + BOTTOM_LABEL_BUFFER, alignSelf: 'center' },
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
