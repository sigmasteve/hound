import React from 'react';
import { View } from 'react-native';
import { BicycleIcon, MountainsIcon, PersonSimpleRunIcon, PersonSimpleSwimIcon, PersonSimpleWalkIcon, UsersThreeIcon } from 'phosphor-react-native';
import type { ClubColor, ClubSport } from './clubsApi';

// How a club looks: its sport's icon on a badge of its colour.

export const CLUB_SPORTS: { id: ClubSport; name: string; Icon: React.ComponentType<any> }[] = [
  { id: 'running', name: 'Running', Icon: PersonSimpleRunIcon },
  { id: 'cycling', name: 'Cycling', Icon: BicycleIcon },
  { id: 'walking', name: 'Walking', Icon: PersonSimpleWalkIcon },
  { id: 'hiking', name: 'Hiking', Icon: MountainsIcon },
  { id: 'swimming', name: 'Swimming', Icon: PersonSimpleSwimIcon },
  { id: 'mixed', name: 'Mixed', Icon: UsersThreeIcon },
];

export const CLUB_COLORS: Record<ClubColor, string> = {
  orange: '#f08a24',
  blue: '#4f7ae5',
  green: '#3fb37f',
  purple: '#8b6fd6',
  red: '#e5484d',
  teal: '#1fa3a3',
};

export function sportName(sport: ClubSport): string {
  return CLUB_SPORTS.find((s) => s.id === sport)?.name ?? 'Club';
}

export function ClubBadge({ sport, color, size = 40 }: { sport: ClubSport; color: ClubColor; size?: number }) {
  const Icon = CLUB_SPORTS.find((s) => s.id === sport)?.Icon ?? UsersThreeIcon;
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.3, backgroundColor: CLUB_COLORS[color] ?? CLUB_COLORS.orange, alignItems: 'center', justifyContent: 'center' }}>
      <Icon size={size * 0.56} color="#ffffff" weight="fill" />
    </View>
  );
}

// "Running · Austin, TX · 48 members"
export function clubMeta(c: { sport: ClubSport; city: string | null; members: number }): string {
  return [sportName(c.sport), c.city, `${c.members} ${c.members === 1 ? 'member' : 'members'}`].filter(Boolean).join(' · ');
}
