export type ProfileAppearanceItemType = 'theme' | 'frame' | 'effect';

export interface ProfileThemeDefinition {
  id: string;
  name: string;
  tier: 'free' | 'paid';
  priceCents: number;
  badge: string;
  description: string;
  accentColor: string;
  bannerStartColor: string;
  bannerEndColor: string;
  surfaceColor: string;
  surfaceSecondaryColor: string;
  borderColor: string;
  textColor: string;
  mutedTextColor: string;
}

export interface AvatarFrameDefinition {
  id: string;
  name: string;
  tier: 'free' | 'paid';
  priceCents: number;
  badge: string;
  description: string;
  primaryColor: string;
  secondaryColor: string;
  glowColor: string;
}

export interface AvatarEffectDefinition {
  id: string;
  name: string;
  tier: 'free' | 'paid';
  priceCents: number;
  badge: string;
  description: string;
  accentColor: string;
  effectStyle: 'none' | 'pulse' | 'orbit' | 'storm';
}

export interface ProfileAppearancePreference {
  active_theme_id?: string | null;
  active_avatar_frame_id?: string | null;
  active_avatar_effect_id?: string | null;
}

export interface ResolvedProfileAppearance {
  theme: ProfileThemeDefinition;
  frame: AvatarFrameDefinition;
  effect: AvatarEffectDefinition;
}

export const PROFILE_THEMES: ProfileThemeDefinition[] = [
  {
    id: 'default',
    name: 'Default Night',
    tier: 'free',
    priceCents: 0,
    badge: 'Free',
    description: 'Keeps the current dark Hypnos profile treatment with a clean cyan accent.',
    accentColor: '#00d4ff',
    bannerStartColor: '#14142d',
    bannerEndColor: '#090914',
    surfaceColor: '#111128',
    surfaceSecondaryColor: '#161633',
    borderColor: '#243154',
    textColor: '#ffffff',
    mutedTextColor: '#a3a9c7',
  },
  {
    id: 'hypnos_violet',
    name: 'Hypnos Violet',
    tier: 'paid',
    priceCents: 699,
    badge: 'Signature',
    description: 'A polished violet identity pass with richer hero gradients and a crisp electric accent.',
    accentColor: '#7c5cff',
    bannerStartColor: '#2b1d4d',
    bannerEndColor: '#0d0a1b',
    surfaceColor: '#161127',
    surfaceSecondaryColor: '#1d1431',
    borderColor: '#4a35a8',
    textColor: '#fbfbff',
    mutedTextColor: '#c1b8ea',
  },
  {
    id: 'ember_signal',
    name: 'Ember Signal',
    tier: 'paid',
    priceCents: 799,
    badge: 'Forge',
    description: 'Warms the profile with ember highlights while keeping cards readable and premium.',
    accentColor: '#ff8a47',
    bannerStartColor: '#4b2418',
    bannerEndColor: '#110907',
    surfaceColor: '#241511',
    surfaceSecondaryColor: '#1a0f0b',
    borderColor: '#7a3e20',
    textColor: '#fff8f4',
    mutedTextColor: '#ddb8a3',
  },
  {
    id: 'aurora_teal',
    name: 'Aurora Teal',
    tier: 'paid',
    priceCents: 999,
    badge: 'Premium',
    description: 'A cool sci-fi profile shell that makes the hero and stat card feel more futuristic.',
    accentColor: '#48e0d2',
    bannerStartColor: '#13353a',
    bannerEndColor: '#071316',
    surfaceColor: '#0d1d22',
    surfaceSecondaryColor: '#10262c',
    borderColor: '#2d6e78',
    textColor: '#f3ffff',
    mutedTextColor: '#a4d6d4',
  },
];

export const AVATAR_FRAMES: AvatarFrameDefinition[] = [
  {
    id: 'none',
    name: 'No Frame',
    tier: 'free',
    priceCents: 0,
    badge: 'Free',
    description: 'Displays the avatar cleanly with no premium frame.',
    primaryColor: '#243154',
    secondaryColor: '#243154',
    glowColor: 'rgba(0,0,0,0)',
  },
  {
    id: 'ion_ring',
    name: 'Ion Ring',
    tier: 'paid',
    priceCents: 399,
    badge: 'Starter',
    description: 'A bright cyan ring with subtle outer glow for a sharper profile photo.',
    primaryColor: '#24d6ff',
    secondaryColor: '#86ecff',
    glowColor: 'rgba(36,214,255,0.4)',
  },
  {
    id: 'violet_crown',
    name: 'Violet Crown',
    tier: 'paid',
    priceCents: 499,
    badge: 'Charged',
    description: 'Adds a richer purple edge treatment that pairs well with darker banners.',
    primaryColor: '#8b63ff',
    secondaryColor: '#d4c7ff',
    glowColor: 'rgba(139,99,255,0.42)',
  },
  {
    id: 'solar_forge',
    name: 'Solar Forge',
    tier: 'paid',
    priceCents: 599,
    badge: 'Premium',
    description: 'A premium gold-ember frame that feels mechanical and rare without being noisy.',
    primaryColor: '#ffb04d',
    secondaryColor: '#ffe2b3',
    glowColor: 'rgba(255,176,77,0.45)',
  },
];

export const AVATAR_EFFECTS: AvatarEffectDefinition[] = [
  {
    id: 'none',
    name: 'Still',
    tier: 'free',
    priceCents: 0,
    badge: 'Free',
    description: 'No motion layer. Best for the cleanest profile photo look.',
    accentColor: '#243154',
    effectStyle: 'none',
  },
  {
    id: 'soft_pulse',
    name: 'Soft Pulse',
    tier: 'paid',
    priceCents: 499,
    badge: 'Starter',
    description: 'A restrained animated pulse that adds life without distracting from the avatar.',
    accentColor: '#31d4ff',
    effectStyle: 'pulse',
  },
  {
    id: 'star_orbit',
    name: 'Star Orbit',
    tier: 'paid',
    priceCents: 599,
    badge: 'Charged',
    description: 'Tiny orbiting highlights move around the profile photo for a more premium identity effect.',
    accentColor: '#9d7bff',
    effectStyle: 'orbit',
  },
  {
    id: 'storm_field',
    name: 'Storm Field',
    tier: 'paid',
    priceCents: 799,
    badge: 'Premium',
    description: 'A stronger dual-ring storm aura designed to feel special on public profile visits.',
    accentColor: '#ff8f5a',
    effectStyle: 'storm',
  },
];

export const DEFAULT_PROFILE_THEME_ID = 'default';
export const DEFAULT_AVATAR_FRAME_ID = 'none';
export const DEFAULT_AVATAR_EFFECT_ID = 'none';

export function getProfileTheme(themeId?: string | null): ProfileThemeDefinition {
  return PROFILE_THEMES.find((item) => item.id === themeId) ?? PROFILE_THEMES[0];
}

export function getAvatarFrame(frameId?: string | null): AvatarFrameDefinition {
  return AVATAR_FRAMES.find((item) => item.id === frameId) ?? AVATAR_FRAMES[0];
}

export function getAvatarEffect(effectId?: string | null): AvatarEffectDefinition {
  return AVATAR_EFFECTS.find((item) => item.id === effectId) ?? AVATAR_EFFECTS[0];
}

export function getProfileAppearanceCatalogItem(itemType: ProfileAppearanceItemType, itemId?: string | null) {
  if (itemType === 'theme') return getProfileTheme(itemId);
  if (itemType === 'frame') return getAvatarFrame(itemId);
  return getAvatarEffect(itemId);
}

export function resolveProfileAppearance(preference?: ProfileAppearancePreference | null): ResolvedProfileAppearance {
  return {
    theme: getProfileTheme(preference?.active_theme_id),
    frame: getAvatarFrame(preference?.active_avatar_frame_id),
    effect: getAvatarEffect(preference?.active_avatar_effect_id),
  };
}

export function formatUsd(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}
