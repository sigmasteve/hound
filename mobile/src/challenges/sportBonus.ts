// Sport bonuses (0198): strength workouts and playing the real sport, in
// the six sports games. Pure words and rules, no Supabase/RN imports; the
// server works the bonuses out each night (sport_day_bonus).

export type SportGameKind = 'soccer' | 'cricket' | 'baseball' | 'rally' | 'hoops' | 'horse';

export const SPORT_GAME_KINDS: SportGameKind[] = ['soccer', 'cricket', 'baseball', 'rally', 'hoops', 'horse'];

export function isSportGame(kind: string): kind is SportGameKind {
  return (SPORT_GAME_KINDS as string[]).includes(kind);
}

export interface SportBonusConfig {
  enabled: boolean;
  strength_first_min: number;
  strength_extra_min: number;
  strength_max: number;
  game_day_min: number;
  game_day_make: number;
  horse_strength_steps: number;
  horse_game_day_steps: number;
}

export const DEFAULT_SPORT_BONUS_CONFIG: SportBonusConfig = {
  enabled: true,
  strength_first_min: 15,
  strength_extra_min: 30,
  strength_max: 2,
  game_day_min: 20,
  game_day_make: 0.08,
  horse_strength_steps: 2000,
  horse_game_day_steps: 4000,
};

// The real sport behind each game: its emoji, and what counts.
export const GAME_SPORT: Record<SportGameKind, { emoji: string; name: string; counts: string }> = {
  hoops: { emoji: '🏀', name: 'basketball', counts: 'basketball' },
  horse: { emoji: '🏀', name: 'basketball', counts: 'basketball' },
  soccer: { emoji: '⚽', name: 'soccer', counts: 'soccer' },
  baseball: { emoji: '⚾', name: 'baseball', counts: 'baseball or softball' },
  cricket: { emoji: '🏏', name: 'cricket', counts: 'cricket' },
  rally: { emoji: '🏸', name: 'racquet sports', counts: 'badminton, tennis, squash or pickleball' },
};

// Bonuses for a day's strength minutes: 1 at 15, then 1 more every 30
// after that (2 at 45), up to the cap.
export function strengthBonuses(minutes: number, cfg: SportBonusConfig = DEFAULT_SPORT_BONUS_CONFIG): number {
  if (minutes < cfg.strength_first_min) return 0;
  return Math.min(cfg.strength_max, 1 + Math.floor((minutes - cfg.strength_first_min) / Math.max(1, cfg.strength_extra_min)));
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const steps = (n: number) => `${n.toLocaleString()} steps`;

// What n strength bonuses do in this game, short: "+2 shots".
export function strengthEffect(kind: SportGameKind, n: number, cfg: SportBonusConfig = DEFAULT_SPORT_BONUS_CONFIG): string {
  const plural = (w: string) => `${n === 1 ? w : `${w}s`}`;
  switch (kind) {
    case 'hoops':
    case 'soccer':
      return `+${n} ${plural('shot')}`;
    case 'baseball':
      return 'power: hits go further';
    case 'cricket':
      return 'power: more fours and sixes';
    case 'rally':
      return `${n} ${plural('smash')}: a return without walking it`;
    case 'horse':
      return `+${steps(cfg.horse_strength_steps * n)} toward the shot`;
  }
}

// What a game day does in this game, short.
export function gameDayEffect(kind: SportGameKind, cfg: SportBonusConfig = DEFAULT_SPORT_BONUS_CONFIG): string {
  switch (kind) {
    case 'hoops':
    case 'soccer':
      return `+1 shot, +${pct(cfg.game_day_make)}`;
    case 'baseball':
      return `+${pct(cfg.game_day_make)} to get a hit`;
    case 'cricket':
      return `+${pct(cfg.game_day_make)} on every ball`;
    case 'rally':
      return 'your return is 20% easier';
    case 'horse':
      return `+${steps(cfg.horse_game_day_steps)} toward the shot`;
  }
}

// The one-line hint when there's nothing yet today.
export function sportBonusHint(kind: SportGameKind): string {
  const sport = GAME_SPORT[kind];
  const strength =
    kind === 'hoops' || kind === 'soccer'
      ? 'A strength workout adds shots'
      : kind === 'horse'
        ? 'A strength workout counts toward the shot'
        : kind === 'rally'
          ? 'A strength workout gives you a smash'
          : 'A strength workout adds power';
  return `${strength}; playing ${sport.name} makes it a game day.`;
}

// The tag on a play by someone who played the real sport that day.
export function playedForRealTag(kind: SportGameKind): string {
  return `${GAME_SPORT[kind].emoji} Played for real`;
}
