import {
  AccessoryWidgetBackground,
  Gauge,
  HStack,
  Image,
  Link,
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
  monospacedDigit,
  padding,
  progressViewStyle,
  resizable,
  tint,
  widgetURL,
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
          {/* 1.3.0: straight to logging an activity (Move). */}
          <Link destination="hound://move/log?from=widget">
            <HStack spacing={4}>
              <Image systemName="plus.circle.fill" size={13} color={accent} />
              <Text modifiers={[font({ size: 12, weight: 'semibold' }), foregroundStyle(accent)]}>Log activity</Text>
            </HStack>
          </Link>
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

// The Fasting widget (1.3.0): home screen small, and the Lock Screen. The
// clock and the bar run on their own from when the fast started (SwiftUI
// timers), so they stay right between updates; tapping opens Fasting.
export function HoundFastingLayout(props: WidgetData | undefined, env: WidgetEnvironment) {
  'widget';
  const dark = env.colorScheme === 'dark';
  const accent = dark ? '#b5abfc' : '#5d5294';
  const green = dark ? '#7fd39b' : '#2e8b57';
  const amber = '#e0a94f';
  const bg = dark ? '#161826' : '#f5f4ff';
  const primary = { type: 'hierarchical', style: 'primary' } as const;
  const secondary = { type: 'hierarchical', style: 'secondary' } as const;
  const url = widgetURL('hound://fasting?from=widget');
  const f = props && props.ready ? props.fasting : null;
  const o = f && f.ok ? f.open : null;
  const start = o ? new Date(o.startedAt) : null;
  // Counting up from the start; the upper end only has to be far off.
  const clock = start ? { lower: start, upper: new Date(start.getTime() + 72 * 3600000) } : null;
  const toGoal = start && o ? { lower: start, upper: new Date(start.getTime() + o.goalHours * 3600000) } : null;
  const lock = env.widgetFamily !== 'systemSmall' && env.widgetFamily !== 'systemMedium';

  if (lock) {
    if (env.widgetFamily === 'accessoryInline') {
      return <Text modifiers={[url]}>{o ? (f!.reached ? `🍽 ${o.goalHours} h fast done ✓` : `🍽 Fasting · ${o.endsText}`) : '🍽 Not fasting'}</Text>;
    }
    if (env.widgetFamily === 'accessoryCircular') {
      return (
        <ZStack modifiers={[url]}>
          <AccessoryWidgetBackground />
          {toGoal ? (
            <ProgressView timerInterval={toGoal} countsDown={false} modifiers={[progressViewStyle('circular')]}>
              <Image systemName="fork.knife" />
            </ProgressView>
          ) : (
            <VStack spacing={1}>
              <Image systemName="fork.knife" />
              <Text modifiers={[font({ size: 11, weight: 'semibold' })]}>Fast</Text>
            </VStack>
          )}
        </ZStack>
      );
    }
    // accessoryRectangular
    return (
      <VStack spacing={2} alignment="leading" modifiers={[url]}>
        <HStack spacing={4}>
          <Image systemName="fork.knife" size={12} />
          <Text modifiers={[font({ size: 13, weight: 'semibold' })]}>{o ? (f!.reached ? 'Goal reached ✓' : 'Fasting') : 'Not fasting'}</Text>
        </HStack>
        {clock ? (
          <Text timerInterval={clock} countsDown={false} modifiers={[font({ size: 17, weight: 'semibold', design: 'rounded' }), monospacedDigit()]} />
        ) : (
          <Text modifiers={[font({ size: 15, weight: 'semibold' })]}>{f && f.ok ? `${f.planLabel} · 🔥 ${f.streak}` : 'Open Hound'}</Text>
        )}
        {toGoal && <ProgressView timerInterval={toGoal} countsDown={false} modifiers={[progressViewStyle('linear')]} />}
      </VStack>
    );
  }

  // Home screen.
  if (!f || !f.ok) {
    return (
      <VStack spacing={6} modifiers={[containerBackground(bg, 'widget'), url]}>
        <Image systemName="fork.knife.circle.fill" size={30} color={accent} />
        <Text modifiers={[font({ size: 13, weight: 'semibold' }), foregroundStyle(primary), lineLimit(2)]}>Open Hound to start fasting</Text>
      </VStack>
    );
  }
  if (!o || !clock || !toGoal) {
    return (
      <VStack spacing={3} alignment="leading" modifiers={[containerBackground(bg, 'widget'), url]}>
        <HStack spacing={4}>
          <Image systemName="fork.knife" size={12} color={accent} />
          <Text modifiers={[font({ size: 12, weight: 'semibold' }), foregroundStyle(accent)]}>FASTING</Text>
        </HStack>
        <Spacer />
        <Text modifiers={[font({ size: 22, weight: 'semibold', design: 'rounded' }), foregroundStyle(primary), lineLimit(1), minimumScaleFactor(0.7)]}>Start a fast</Text>
        <Text modifiers={[font({ size: 12 }), foregroundStyle(secondary), lineLimit(1)]}>{`${f.planLabel} · ${f.planHours} h`}</Text>
        {f.streak > 0 && <Text modifiers={[font({ size: 12, weight: 'semibold' }), foregroundStyle(amber)]}>{`🔥 ${f.streak}-day streak`}</Text>}
      </VStack>
    );
  }
  return (
    <VStack spacing={3} alignment="leading" modifiers={[containerBackground(bg, 'widget'), url]}>
      <HStack spacing={4}>
        <Image systemName="fork.knife" size={12} color={f.reached ? green : accent} />
        <Text modifiers={[font({ size: 12, weight: 'semibold' }), foregroundStyle(f.reached ? green : accent)]}>{f.reached ? 'GOAL REACHED' : 'FASTING'}</Text>
        <Spacer />
        {f.streak > 0 && <Text modifiers={[font({ size: 11, weight: 'semibold' }), foregroundStyle(amber)]}>{`🔥 ${f.streak}`}</Text>}
      </HStack>
      <Spacer />
      <Text
        timerInterval={clock}
        countsDown={false}
        modifiers={[font({ size: 28, weight: 'semibold', design: 'rounded' }), foregroundStyle(primary), monospacedDigit(), lineLimit(1), minimumScaleFactor(0.6)]}
      />
      <ProgressView timerInterval={toGoal} countsDown={false} modifiers={[progressViewStyle('linear'), tint(f.reached ? green : accent)]} />
      <Text modifiers={[font({ size: 11 }), foregroundStyle(secondary), lineLimit(1), minimumScaleFactor(0.8)]}>
        {f.reached ? `${o.goalHours} h done · end when you eat` : `Goal ${o.goalHours} h · ${o.endsText}`}
      </Text>
    </VStack>
  );
}
