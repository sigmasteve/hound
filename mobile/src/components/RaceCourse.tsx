import React from 'react';
import { ChaseTrack, type TrackRunner } from './ChaseTrack';
import { ChaseTrail } from './ChaseTrail';

// Where a race is drawn (0182's challenges.race_scene): the park track,
// or a trail through the woods, up a mountain or along the beach. The
// creator picks it for a Tag or Chase game.
export type RaceScene = 'track' | 'woods' | 'mountains' | 'beach';

export const RACE_SCENES: { id: RaceScene; name: string }[] = [
  { id: 'track', name: 'Track' },
  { id: 'woods', name: 'Woods' },
  { id: 'mountains', name: 'Mountains' },
  { id: 'beach', name: 'Beach' },
];

// A game's scene, or its default: the track for Tag, the woods for Chase.
export function raceSceneFor(challenge: { kind: string; raceScene?: RaceScene | null }): RaceScene {
  return challenge.raceScene ?? (challenge.kind === 'tag' ? 'track' : 'woods');
}

export function RaceCourse({
  scene,
  runners,
  width,
  chaserLabel,
  catchWord,
  autoPlay,
}: {
  scene: RaceScene;
  runners: TrackRunner[];
  width: number;
  chaserLabel?: string;
  catchWord?: string;
  autoPlay?: boolean;
}) {
  return scene === 'track' ? (
    <ChaseTrack runners={runners} width={width} chaserLabel={chaserLabel} catchWord={catchWord} autoPlay={autoPlay} />
  ) : (
    <ChaseTrail runners={runners} width={width} scene={scene} chaserLabel={chaserLabel} catchWord={catchWord} autoPlay={autoPlay} />
  );
}
