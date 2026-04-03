import { getAvatarEffect, getAvatarFrame, getProfileTheme } from './profileAppearance';
import { badgeTierLabel, getProfileBadge } from './profileBadges';

export type SeasonStatus = 'draft' | 'scheduled' | 'active' | 'ended' | 'archived';
export type SeasonTrackType = 'free' | 'premium';
export type SeasonRewardType = 'props' | 'badge' | 'theme' | 'frame' | 'effect' | 'title';

export interface SeasonPassSeason {
  id: string;
  number: number;
  name: string;
  slug?: string | null;
  theme_key?: string | null;
  description?: string | null;
  banner_image_url?: string | null;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  xp_per_level: number;
  max_level: number;
  pass_price_cents: number;
  pass_enabled: boolean;
  claims_open_until?: string | null;
  status: SeasonStatus;
}

export interface UserSeasonProgress {
  id?: string;
  user_id: string;
  season_id: string;
  xp_total: number;
  level_current: number;
  premium_unlocked: boolean;
  premium_unlocked_at?: string | null;
  season_completed_at?: string | null;
  last_xp_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface SeasonRewardTrackItem {
  id: string;
  season_id: string;
  level_number: number;
  track_type: SeasonTrackType;
  quantity: number;
  claim_group?: string | null;
  sort_order: number;
  reward_catalog_id: string;
  reward_type: SeasonRewardType;
  reward_key: string;
  display_name: string;
  description?: string | null;
  amount_int: number;
  rarity: 'standard' | 'rare' | 'epic' | 'legendary' | 'seasonal';
  is_evergreen: boolean;
  is_premium_only: boolean;
  season_theme_tag?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface UserSeasonRewardClaim {
  id: string;
  user_id: string;
  season_id: string;
  track_reward_id: string;
  claimed_at: string;
}

export const DEFAULT_SEASON_XP_PER_LEVEL = 100;
export const DEFAULT_SEASON_MAX_LEVEL = 30;

export function getSeasonLevelProgress(xpTotal: number, xpPerLevel: number) {
  const safeXp = Math.max(0, xpTotal ?? 0);
  const safePerLevel = Math.max(1, xpPerLevel ?? DEFAULT_SEASON_XP_PER_LEVEL);
  const currentLevel = Math.floor(safeXp / safePerLevel);
  const xpIntoLevel = safeXp % safePerLevel;
  const xpNeededForNextLevel = safePerLevel - xpIntoLevel;

  return {
    currentLevel,
    xpIntoLevel,
    xpNeededForNextLevel,
    progressRatio: xpIntoLevel / safePerLevel,
  };
}

export function formatSeasonRewardLabel(item: Pick<SeasonRewardTrackItem, 'reward_type' | 'reward_key' | 'display_name' | 'amount_int'>) {
  switch (item.reward_type) {
    case 'props':
      return `+${item.amount_int} Props`;
    case 'badge': {
      const badge = getProfileBadge(item.reward_key);
      return badge ? `${badge.name} Badge` : item.display_name;
    }
    case 'theme': {
      const theme = getProfileTheme(item.reward_key);
      return theme?.name ?? item.display_name;
    }
    case 'frame': {
      const frame = getAvatarFrame(item.reward_key);
      return frame?.name ?? item.display_name;
    }
    case 'effect': {
      const effect = getAvatarEffect(item.reward_key);
      return effect?.name ?? item.display_name;
    }
    default:
      return item.display_name;
  }
}

export function describeSeasonReward(item: SeasonRewardTrackItem) {
  switch (item.reward_type) {
    case 'props':
      return `${item.amount_int} spendable props added to the wallet.`;
    case 'badge': {
      const badge = getProfileBadge(item.reward_key);
      return badge
        ? `${badgeTierLabel(badge.tier)} collectible badge.`
        : item.description ?? 'Collectible badge reward.';
    }
    case 'theme':
      return getProfileTheme(item.reward_key)?.description ?? item.description ?? 'Profile theme unlock.';
    case 'frame':
      return getAvatarFrame(item.reward_key)?.description ?? item.description ?? 'Avatar frame unlock.';
    case 'effect':
      return getAvatarEffect(item.reward_key)?.description ?? item.description ?? 'Avatar effect unlock.';
    default:
      return item.description ?? 'Season reward.';
  }
}

export function seasonRewardAccent(item: SeasonRewardTrackItem) {
  switch (item.reward_type) {
    case 'props':
      return '#f7b500';
    case 'badge':
      return getProfileBadge(item.reward_key)?.accentColor ?? '#8b5cf6';
    case 'theme':
      return getProfileTheme(item.reward_key)?.accentColor ?? '#7c5cff';
    case 'frame':
      return getAvatarFrame(item.reward_key)?.primaryColor ?? '#24d6ff';
    case 'effect':
      return getAvatarEffect(item.reward_key)?.accentColor ?? '#ff8f5a';
    default:
      return '#7c5cff';
  }
}

export function formatSeasonPassPrice(priceCents: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format((priceCents ?? 0) / 100);
}
