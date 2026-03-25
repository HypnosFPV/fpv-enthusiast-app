export type GroupCardAnimationVariantId = 'none' | 'basic' | 'standard' | 'premium';

export interface GroupCardAnimationVariant {
  id: GroupCardAnimationVariantId;
  name: string;
  tier: 'free' | 'paid';
  priceCents: number;
  badge: string;
  description: string;
}

export interface GroupThemeTokens {
  id: string;
  name: string;
  source: 'preset' | 'custom';
  accentColor: string;
  accentSoftColor: string;
  surfaceColor: string;
  surfaceSecondaryColor: string;
  borderColor: string;
  chipBackgroundColor: string;
  chipTextColor: string;
  textColor: string;
  mutedTextColor: string;
  heroStartColor: string;
  heroEndColor: string;
  cardImageUrl?: string | null;
  bannerImageUrl?: string | null;
  overlayStrength?: number;
  animationVariantId?: GroupCardAnimationVariantId;
}

export const GROUP_CARD_ANIMATION_VARIANTS: GroupCardAnimationVariant[] = [
  {
    id: 'none',
    name: 'No animation',
    tier: 'free',
    priceCents: 0,
    badge: 'Free',
    description: 'Keeps the themed card static. Use this when you want the premium surface without motion.',
  },
  {
    id: 'basic',
    name: 'Basic sweep',
    tier: 'paid',
    priceCents: 99,
    badge: 'Starter',
    description: 'The current subtle pulse and top-edge sweep. Clean, lightweight, and ideal as the entry tier.',
  },
  {
    id: 'standard',
    name: 'Standard glow',
    tier: 'paid',
    priceCents: 199,
    badge: 'Popular',
    description: 'Adds a stronger pulse and a second sweep so the card feels more obviously premium in feed.',
  },
  {
    id: 'premium',
    name: 'Premium aura',
    tier: 'paid',
    priceCents: 299,
    badge: 'Top tier',
    description: 'The richest version with stronger perimeter activity and side highlights for the most premium look.',
  },
];

export const GROUP_THEME_PRESETS: GroupThemeTokens[] = [
  {
    id: 'midnight',
    name: 'Midnight Signal',
    source: 'preset',
    accentColor: '#6c8cff',
    accentSoftColor: 'rgba(108,140,255,0.18)',
    surfaceColor: '#141833',
    surfaceSecondaryColor: '#101427',
    borderColor: '#2b366f',
    chipBackgroundColor: 'rgba(74,108,214,0.22)',
    chipTextColor: '#b9ccff',
    textColor: '#f7f8ff',
    mutedTextColor: '#a8b0d9',
    heroStartColor: '#1d2350',
    heroEndColor: '#0c1022',
    overlayStrength: 72,
    animationVariantId: 'none',
  },
  {
    id: 'ember',
    name: 'Ember Run',
    source: 'preset',
    accentColor: '#ff7a3d',
    accentSoftColor: 'rgba(255,122,61,0.18)',
    surfaceColor: '#241510',
    surfaceSecondaryColor: '#160d0a',
    borderColor: '#6a351d',
    chipBackgroundColor: 'rgba(255,122,61,0.18)',
    chipTextColor: '#ffd1bc',
    textColor: '#fff8f4',
    mutedTextColor: '#d8b2a1',
    heroStartColor: '#402016',
    heroEndColor: '#120a08',
    overlayStrength: 70,
    animationVariantId: 'none',
  },
  {
    id: 'forest',
    name: 'Forest Run',
    source: 'preset',
    accentColor: '#40c98a',
    accentSoftColor: 'rgba(64,201,138,0.18)',
    surfaceColor: '#0f221b',
    surfaceSecondaryColor: '#0a1612',
    borderColor: '#23533f',
    chipBackgroundColor: 'rgba(64,201,138,0.16)',
    chipTextColor: '#b8f3d7',
    textColor: '#f4fffa',
    mutedTextColor: '#9bc9b6',
    heroStartColor: '#17362a',
    heroEndColor: '#09120f',
    overlayStrength: 68,
    animationVariantId: 'none',
  },
  {
    id: 'sunset',
    name: 'Sunset Band',
    source: 'preset',
    accentColor: '#ffb648',
    accentSoftColor: 'rgba(255,182,72,0.18)',
    surfaceColor: '#2a1d11',
    surfaceSecondaryColor: '#171008',
    borderColor: '#6f4a1d',
    chipBackgroundColor: 'rgba(255,182,72,0.18)',
    chipTextColor: '#ffe2a7',
    textColor: '#fffaf0',
    mutedTextColor: '#d9c08d',
    heroStartColor: '#4a3015',
    heroEndColor: '#120d08',
    overlayStrength: 66,
    animationVariantId: 'none',
  },
  {
    id: 'neon',
    name: 'Neon Grid',
    source: 'preset',
    accentColor: '#d15bff',
    accentSoftColor: 'rgba(209,91,255,0.18)',
    surfaceColor: '#23122f',
    surfaceSecondaryColor: '#140c1c',
    borderColor: '#6d2f89',
    chipBackgroundColor: 'rgba(209,91,255,0.18)',
    chipTextColor: '#f0c5ff',
    textColor: '#fff7ff',
    mutedTextColor: '#d2afd9',
    heroStartColor: '#3c1d4e',
    heroEndColor: '#140b1a',
    overlayStrength: 70,
    animationVariantId: 'none',
  },
  {
    id: 'steel',
    name: 'Steel Drift',
    source: 'preset',
    accentColor: '#86c3ff',
    accentSoftColor: 'rgba(134,195,255,0.18)',
    surfaceColor: '#18202a',
    surfaceSecondaryColor: '#0d1217',
    borderColor: '#3b556d',
    chipBackgroundColor: 'rgba(134,195,255,0.16)',
    chipTextColor: '#d2e9ff',
    textColor: '#f8fbff',
    mutedTextColor: '#a9b9c7',
    heroStartColor: '#263340',
    heroEndColor: '#0c1116',
    overlayStrength: 68,
    animationVariantId: 'none',
  },
];

export const DEFAULT_GROUP_THEME = GROUP_THEME_PRESETS[0];
export const DEFAULT_GROUP_CARD_ANIMATION_VARIANT_ID: GroupCardAnimationVariantId = 'none';

export function getPresetGroupTheme(themeId?: string | null): GroupThemeTokens {
  return GROUP_THEME_PRESETS.find((theme) => theme.id === themeId) ?? DEFAULT_GROUP_THEME;
}

export function getGroupCardAnimationVariant(variantId?: string | null): GroupCardAnimationVariant {
  return GROUP_CARD_ANIMATION_VARIANTS.find((variant) => variant.id === variantId) ?? GROUP_CARD_ANIMATION_VARIANTS[0];
}

export function clampOverlayStrength(value?: number | null): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return DEFAULT_GROUP_THEME.overlayStrength ?? 70;
  return Math.max(20, Math.min(92, Math.round(value)));
}
