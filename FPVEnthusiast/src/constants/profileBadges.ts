export type ProfileBadgeTier =
  | 'common'
  | 'rare'
  | 'epic'
  | 'legendary'
  | 'seasonal';

export interface ProfileBadgeDefinition {
  id: string;
  name: string;
  tier: ProfileBadgeTier;
  priceCents: number;
  description: string;
  accentColor: string;
  iconName: string;
  limited: boolean;
}

export const FEATURED_PROFILE_BADGE_LIMIT = 3;

export const PROFILE_BADGES: ProfileBadgeDefinition[] = [
  {
    id: 'founder_signal',
    name: 'Founder Signal',
    tier: 'rare',
    priceCents: 299,
    description: 'Early supporter energy with a clean neon founder mark.',
    accentColor: '#8b5cf6',
    iconName: 'sparkles-outline',
    limited: false,
  },
  {
    id: 'aerial_ace',
    name: 'Aerial Ace',
    tier: 'common',
    priceCents: 399,
    description: 'Fast, sharp, and unmistakably FPV.',
    accentColor: '#06b6d4',
    iconName: 'rocket-outline',
    limited: false,
  },
  {
    id: 'midnight_orbit',
    name: 'Midnight Orbit',
    tier: 'epic',
    priceCents: 499,
    description: 'Dark premium badge with orbit-core styling.',
    accentColor: '#0ea5e9',
    iconName: 'planet-outline',
    limited: false,
  },
  {
    id: 'storm_chaser',
    name: 'Storm Chaser',
    tier: 'epic',
    priceCents: 599,
    description: 'Electric storm styling for aggressive profile flex.',
    accentColor: '#f59e0b',
    iconName: 'flash-outline',
    limited: false,
  },
  {
    id: 'season_zero',
    name: 'Season Zero',
    tier: 'legendary',
    priceCents: 799,
    description: 'A premium first-wave collectible for early adopters.',
    accentColor: '#ef4444',
    iconName: 'trophy-outline',
    limited: true,
  },
];

export function getProfileBadge(badgeId?: string | null): ProfileBadgeDefinition | null {
  if (!badgeId) return null;
  return PROFILE_BADGES.find((badge) => badge.id === badgeId) ?? null;
}

export function getProfileBadgesByIds(badgeIds?: string[] | null): ProfileBadgeDefinition[] {
  if (!badgeIds?.length) return [];

  const ordered = badgeIds
    .map((badgeId) => getProfileBadge(badgeId))
    .filter((badge): badge is ProfileBadgeDefinition => Boolean(badge));

  const seen = new Set<string>();
  return ordered.filter((badge) => {
    if (seen.has(badge.id)) return false;
    seen.add(badge.id);
    return true;
  });
}

export function formatBadgePrice(priceCents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(priceCents / 100);
}

export function badgeTierLabel(tier: ProfileBadgeTier): string {
  switch (tier) {
    case 'common':
      return 'Common';
    case 'rare':
      return 'Rare';
    case 'epic':
      return 'Epic';
    case 'legendary':
      return 'Legendary';
    case 'seasonal':
      return 'Seasonal';
    default:
      return 'Badge';
  }
}
