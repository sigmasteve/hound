import {
  AccessoryWidgetBackground,
  Gauge,
  HStack,
  Image,
  ProgressView,
  Spacer,
  Text,
  VStack,
  ZStack,
} from '@expo/ui/swift-ui';
import {
  aspectRatio,
  containerBackground,
  font,
  foregroundStyle,
  frame,
  gaugeStyle,
  lineLimit,
  minimumScaleFactor,
  padding,
  progressViewStyle,
  resizable,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import type { WidgetEnvironment } from 'expo-widgets';
import type { WidgetData } from '../widgetModel';

// iPhone widget layouts, in SwiftUI through @expo/ui. Each function marked
// 'widget' is turned into a string when the app is built and run by the
// widget itself, so it can't use anything from outside its own body except
// the SwiftUI views and modifiers: helpers live inside each one. Colors
// follow the phone's light or dark mode, in Hound's purple.

// Home screen, small and medium: your hound and today's goals.
export function HoundGoalsLayout(props: WidgetData | undefined, env: WidgetEnvironment) {
  'widget';
  const dark = env.colorScheme === 'dark';
  const accent = dark ? '#b5abfc' : '#5d5294';
  const green = dark ? '#7fd39b' : '#2e8b57';
  const bg = dark ? '#161826' : '#f5f4ff';
  const primary = { type: 'hierarchical', style: 'primary' } as const;
  const secondary = { type: 'hierarchical', style: 'secondary' } as const;

  const hound = (size: number) =>
    props?.houndImage ? (
      <Image uiImage={props.houndImage} modifiers={[resizable(), aspectRatio({ contentMode: 'fit' }), frame({ width: size, height: size })]} />
    ) : (
      <Image systemName="pawprint.fill" size={size * 0.6} color={accent} modifiers={[frame({ width: size, height: size })]} />
    );

  if (!props || !props.ready) {
    return (
      <VStack spacing={8} modifiers={[containerBackground(bg, 'widget')]}>
        {hound(44)}
        <Text modifiers={[font({ size: 13, weight: 'semibold' }), foregroundStyle(primary), lineLimit(2)]}>
          Open Hound to set up your widget
        </Text>
      </VStack>
    );
  }

  const goalsLine = props.total === 0 ? 'No goals yet' : props.done === props.total ? 'All goals done' : `${props.done} of ${props.total} goals`;
  const streakLine = props.streak > 1 ? ` · 🔥 ${props.streak}` : '';

  if (env.widgetFamily === 'systemMedium') {
    return (
      <HStack spacing={14} modifiers={[containerBackground(bg, 'widget')]}>
        <VStack spacing={2} alignment="center" modifiers={[frame({ width: 104 })]}>
          {hound(96)}
          <Text modifiers={[font({ size: 11, weight: 'medium' }), foregroundStyle(secondary), lineLimit(2), minimumScaleFactor(0.8)]}>
            {props.moodLine}
          </Text>
          {props.streak > 1 && (
            <Text modifiers={[font({ size: 11, weight: 'semibold' }), foregroundStyle('#e0a94f')]}>{`🔥 ${props.streak}-day streak`}</Text>
          )}
        </VStack>
        <VStack spacing={7} alignment="leading">
          <Text modifiers={[font({ size: 15, weight: 'semibold' }), foregroundStyle(primary)]}>{goalsLine}</Text>
          {props.goals.slice(0, 3).map((g, i) => (
            <VStack key={String(i)} spacing={3} alignment="leading">
              <HStack spacing={4}>
                <Text modifiers={[font({ size: 12, weight: 'medium' }), foregroundStyle(primary), lineLimit(1)]}>{g.title}</Text>
                <Spacer />
                <Text modifiers={[font({ size: 11 }), foregroundStyle(g.done ? green : secondary)]}>
                  {g.done ? '✓' : `${g.value} / ${g.target}`}
                </Text>
              </HStack>
              <ProgressView value={g.pct / 100} modifiers={[progressViewStyle('linear'), tint(g.done ? green : accent)]} />
            </VStack>
          ))}
          {props.goals.length === 0 && (
            <Text modifiers={[font({ size: 12 }), foregroundStyle(secondary)]}>Set goals in Hound and they'll show here.</Text>
          )}
          <Spacer />
        </VStack>
      </HStack>
    );
  }

  // Small: the hound, today's steps against the goal, and the goals line.
  return (
    <VStack spacing={2} alignment="leading" modifiers={[containerBackground(bg, 'widget')]}>
      <HStack>
        {hound(60)}
        <Spacer />
        {props.stepsGoal !== null && (
          <Gauge value={props.stepsPct} min={0} max={100} modifiers={[gaugeStyle('circularCapacity'), tint(props.stepsPct >= 100 ? green : accent), frame({ width: 40, height: 40 })]}>
            <Text>{`${props.stepsPct}%`}</Text>
          </Gauge>
        )}
      </HStack>
      <Spacer />
      <Text modifiers={[font({ size: 26, weight: 'semibold', design: 'rounded' }), foregroundStyle(primary), minimumScaleFactor(0.6), lineLimit(1)]}>
        {props.stepsText}
      </Text>
      <Text modifiers={[font({ size: 12 }), foregroundStyle(secondary), lineLimit(1)]}>
        {props.stepsGoalText ? `of ${props.stepsGoalText} steps` : 'steps today'}
      </Text>
      <Text modifiers={[font({ size: 12, weight: 'semibold' }), foregroundStyle(accent), lineLimit(1), padding({ top: 2 })]}>
        {`${goalsLine}${streakLine}`}
      </Text>
    </VStack>
  );
}

// Lock Screen: today's steps. The Lock Screen draws widgets in one tint,
// so these use shapes and text only, no colors.
export function HoundStepsLayout(props: WidgetData | undefined, env: WidgetEnvironment) {
  'widget';
  const ready = !!props && props.ready;
  const steps = ready ? props!.stepsText : '–';
  const pct = ready ? props!.stepsPct : 0;
  const goal = ready ? props!.stepsGoalText : null;

  if (env.widgetFamily === 'accessoryInline') {
    return <Text>{goal ? `🐾 ${steps} / ${goal} steps` : `🐾 ${steps} steps`}</Text>;
  }

  if (env.widgetFamily === 'accessoryCircular') {
    return (
      <ZStack>
        <AccessoryWidgetBackground />
        <Gauge value={pct} min={0} max={100} modifiers={[gaugeStyle('circularCapacity')]}>
          <Image systemName="figure.walk" />
        </Gauge>
      </ZStack>
    );
  }

  // accessoryRectangular
  return (
    <VStack spacing={2} alignment="leading">
      <HStack spacing={4}>
        <Image systemName="pawprint.fill" size={12} />
        <Text modifiers={[font({ size: 13, weight: 'semibold' })]}>Hound</Text>
      </HStack>
      <Text modifiers={[font({ size: 17, weight: 'semibold', design: 'rounded' }), minimumScaleFactor(0.7), lineLimit(1)]}>
        {goal ? `${steps} / ${goal}` : `${steps} steps`}
      </Text>
      {goal && <ProgressView value={pct / 100} modifiers={[progressViewStyle('linear')]} />}
    </VStack>
  );
}
