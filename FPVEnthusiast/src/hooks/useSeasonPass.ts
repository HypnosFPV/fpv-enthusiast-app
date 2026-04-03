import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../services/supabase';
import type {
  SeasonPassSeason,
  SeasonRewardTrackItem,
  UserSeasonProgress,
  UserSeasonRewardClaim,
} from '../constants/seasonPass';

const EMPTY_PROGRESS: UserSeasonProgress = {
  user_id: '',
  season_id: '',
  xp_total: 0,
  level_current: 0,
  premium_unlocked: false,
};

async function fetchPreferredSeason(): Promise<SeasonPassSeason | null> {
  const { data: activeSeason } = await supabase
    .from('seasons')
    .select('id, number, name, slug, theme_key, description, banner_image_url, starts_at, ends_at, is_active, xp_per_level, max_level, pass_price_cents, pass_enabled, claims_open_until, status')
    .eq('status', 'active')
    .order('starts_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activeSeason) return activeSeason as SeasonPassSeason;

  const { data: latestSeason } = await supabase
    .from('seasons')
    .select('id, number, name, slug, theme_key, description, banner_image_url, starts_at, ends_at, is_active, xp_per_level, max_level, pass_price_cents, pass_enabled, claims_open_until, status')
    .order('starts_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return (latestSeason as SeasonPassSeason | null) ?? null;
}

export function useSeasonPass(userId?: string | null) {
  const [season, setSeason] = useState<SeasonPassSeason | null>(null);
  const [progress, setProgress] = useState<UserSeasonProgress>(EMPTY_PROGRESS);
  const [rewards, setRewards] = useState<SeasonRewardTrackItem[]>([]);
  const [claims, setClaims] = useState<UserSeasonRewardClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [claimingRewardId, setClaimingRewardId] = useState<string | null>(null);
  const [unlockingPass, setUnlockingPass] = useState(false);

  const loadSeasonPass = useCallback(async () => {
    setLoading(true);
    try {
      const nextSeason = await fetchPreferredSeason();
      setSeason(nextSeason);

      if (!nextSeason) {
        setProgress(EMPTY_PROGRESS);
        setRewards([]);
        setClaims([]);
        return;
      }

      const jobs: Promise<any>[] = [
        supabase
          .from('season_track_reward_details')
          .select('id, season_id, level_number, track_type, quantity, claim_group, sort_order, reward_catalog_id, reward_type, reward_key, display_name, description, amount_int, rarity, is_evergreen, is_premium_only, season_theme_tag, metadata')
          .eq('season_id', nextSeason.id)
          .order('level_number', { ascending: true })
          .order('track_type', { ascending: true }),
      ];

      if (userId) {
        jobs.push(
          supabase
            .from('user_season_progress')
            .select('id, user_id, season_id, xp_total, level_current, premium_unlocked, premium_unlocked_at, season_completed_at, last_xp_at, created_at, updated_at')
            .eq('user_id', userId)
            .eq('season_id', nextSeason.id)
            .maybeSingle(),
        );
        jobs.push(
          supabase
            .from('user_season_reward_claims')
            .select('id, user_id, season_id, track_reward_id, claimed_at')
            .eq('user_id', userId)
            .eq('season_id', nextSeason.id)
            .order('claimed_at', { ascending: false }),
        );
      }

      const [rewardResult, progressResult, claimsResult] = await Promise.all(jobs);

      setRewards(((rewardResult as any)?.data ?? []) as SeasonRewardTrackItem[]);
      setProgress(
        userId
          ? (((progressResult as any)?.data as UserSeasonProgress | null) ?? {
              ...EMPTY_PROGRESS,
              user_id: userId,
              season_id: nextSeason.id,
            })
          : { ...EMPTY_PROGRESS, season_id: nextSeason.id },
      );
      setClaims(userId ? ((((claimsResult as any)?.data ?? []) as UserSeasonRewardClaim[])) : []);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void loadSeasonPass();
  }, [loadSeasonPass]);

  useFocusEffect(
    useCallback(() => {
      void loadSeasonPass();
      return undefined;
    }, [loadSeasonPass]),
  );

  const claimReward = useCallback(async (trackRewardId: string) => {
    if (!userId) return { ok: false as const, error: 'Sign in required.' };
    setClaimingRewardId(trackRewardId);
    try {
      const { data, error } = await supabase.rpc('claim_season_reward', {
        p_track_reward_id: trackRewardId,
      });
      if (error) return { ok: false as const, error: error.message };
      await loadSeasonPass();
      return { ok: true as const, data };
    } finally {
      setClaimingRewardId(null);
    }
  }, [loadSeasonPass, userId]);

  const unlockSeasonPassForTesting = useCallback(async () => {
    if (!userId || !season) return { ok: false as const, error: 'No user or season available.' };
    setUnlockingPass(true);
    try {
      const { error } = await supabase.rpc('set_user_season_pass', {
        p_season_id: season.id,
        p_premium_unlocked: true,
        p_user_id: userId,
      });
      if (error) return { ok: false as const, error: error.message };
      await loadSeasonPass();
      return { ok: true as const };
    } finally {
      setUnlockingPass(false);
    }
  }, [loadSeasonPass, season, userId]);

  const waitForPremiumUnlock = useCallback(async (maxAttempts = 10, delayMs = 1500) => {
    if (!userId || !season) return false;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const { data, error } = await supabase
        .from('user_season_progress')
        .select('premium_unlocked')
        .eq('user_id', userId)
        .eq('season_id', season.id)
        .maybeSingle();

      if (!error && data?.premium_unlocked) {
        await loadSeasonPass();
        return true;
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    await loadSeasonPass();
    return false;
  }, [loadSeasonPass, season, userId]);

  const claimedRewardIds = useMemo(() => new Set(claims.map((claim) => claim.track_reward_id)), [claims]);
  const freeRewards = useMemo(() => rewards.filter((item) => item.track_type === 'free'), [rewards]);
  const premiumRewards = useMemo(() => rewards.filter((item) => item.track_type === 'premium'), [rewards]);
  const claimableCount = useMemo(() => {
    return rewards.filter((item) => {
      if (claimedRewardIds.has(item.id)) return false;
      if ((progress.level_current ?? 0) < item.level_number) return false;
      if (item.track_type === 'premium' && !progress.premium_unlocked) return false;
      return true;
    }).length;
  }, [claimedRewardIds, progress.level_current, progress.premium_unlocked, rewards]);

  return {
    season,
    progress,
    rewards,
    freeRewards,
    premiumRewards,
    claims,
    claimedRewardIds,
    loading,
    claimingRewardId,
    unlockingPass,
    claimableCount,
    refreshSeasonPass: loadSeasonPass,
    claimReward,
    unlockSeasonPassForTesting,
    waitForPremiumUnlock,
  };
}
