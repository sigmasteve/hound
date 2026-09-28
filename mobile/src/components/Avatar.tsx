import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { font } from '../theme/tokens';
import { backgroundById, frameById, iconStyleById } from '../cosmetics/catalog';
import { DEFAULT_AVATAR_ICON, ICON_COMPONENTS } from '../cosmetics/avatarIcons';

let gradientIdCounter = 0;

export function Avatar({
  initials,
  tint,
  size = 34,
  fontSize = 12,
  frameId,
  backgroundId,
  iconId,
}: {
  initials: string;
  tint: string;
  size?: number;
  fontSize?: number;
  // Both optional and undefined at almost every call site — that's
  // exactly today's plain look (initials on a flat tint circle), no
  // visual change at all. Only a caller that actually looked up someone's
  // equipped cosmetics (src/cosmetics/catalog.ts, profiles.equipped_*)
  // passes these; a null (no id, or an id this build doesn't know) reads
  // the same as omitted rather than crashing.
  frameId?: string | null;
  backgroundId?: string | null;
  // Same optional/null-safe shape as frameId/backgroundId above — when
  // set to a real icon id, replaces the initials text with that icon's
  // glyph (see cosmetics/avatarIcons.ts). Frame/background still layer
  // around it exactly as they would around initials.
  iconId?: string | null;
}) {
  const frame = frameById(frameId);
  const background = backgroundById(backgroundId);
  const iconStyle = iconStyleById(iconId);
  const IconGlyph = iconStyle ? (ICON_COMPONENTS[iconStyle.icon] ?? DEFAULT_AVATAR_ICON) : null;
  // Stable for this component instance, not regenerated every render —
  // two Avatars on screen at once still need distinct ids, since SVG
  // gradient ids live in one shared namespace, not scoped per <Svg>.
  const gradientId = React.useRef(`avatar-grad-${(gradientIdCounter += 1)}`).current;

  const circle = (
    <View
      style={[
        styles.base,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          overflow: 'hidden',
          backgroundColor: background ? undefined : tint,
        },
      ]}
    >
      {background && (
        <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
              <Stop offset="0%" stopColor={background.gradientFrom} />
              <Stop offset="100%" stopColor={background.gradientTo} />
            </LinearGradient>
          </Defs>
          <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${gradientId})`} />
        </Svg>
      )}
      {IconGlyph ? (
        // Sized relative to the circle, not fontSize — an icon glyph and
        // a line of initials text don't scale the same way, and every
        // existing call site's fontSize was tuned for text, not a glyph.
        <IconGlyph size={size * 0.6} color="#fff" weight="fill" />
      ) : (
        <Text style={[styles.label, { fontSize }]}>{initials}</Text>
      )}
    </View>
  );

  if (!frame) return circle;

  // A frame grows the rendered footprint slightly beyond `size` — opt-in
  // only (see frameId's own comment above), so this never shifts layout
  // at a call site that doesn't equip one.
  const ringWidth = Math.max(2, Math.round(size * 0.08));
  const outerSize = size + ringWidth * 2;
  return (
    <View
      style={{
        width: outerSize,
        height: outerSize,
        borderRadius: outerSize / 2,
        borderWidth: ringWidth,
        borderColor: frame.ringColor,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {circle}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: font.headingSemibold, color: '#fff' },
});
