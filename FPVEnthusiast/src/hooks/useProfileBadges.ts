import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../services/supabase';
import {
  FEATURED_PROFILE_BADGE_LIMIT,
  getProfileBadgesByIds,
  type ProfileBadgeDefinition,
} from '../constants/profileBadges';

export interface UserProfileBadgePreferenceRow {
  user_id: string;
  featured_badge_ids: string[];
  updated_at?: string | null;
}

export interface UserProfileBadgeUnlock {
  id: string;
  owner_user_id: string;
  badge_id: string;
  status: 'pending_payment' | 'paid' | 'granted' | 'cancelled';
  unlock_source?: 'stripe' | 'admin_grant' | 'season_reward' | 'promo' | null;
  unlock_amount_cents?: number | null;
  stripe_payment_intent?: string | null;
  purchased_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

const DEFAULT_PREFERENCE: UserProfileBadgePreferenceRow = {
  user_id: '',
  featured_badge_ids: [],
};

function normalizeBadgeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const ordered: string[] = [];
  value.forEach((entry) => {
    if (typeof entry !== 'string') return;
    const badgeId = entry.trim();
    if (!badgeId || seen.has(badgeId)) return;
    seen.add(badgeId);
    ordered.push(badgeId);
  });
  return ordered.slice(0, FEATURED_PROFILE_BADGE_LIMIT);
}

export function useResolvedProfileBadges(viewedUserId?: string | null) {
  const [preference, setPreference] = useState<UserProfileBadgePreferenceRow>(DEFAULT_PREFERENCE);
  const [loadingBadges, setLoadingBadges] = useState(false);

  const loadBadges = useCallback(async () => {
    if (!viewedUserId) {
      setPreference(DEFAULT_PREFERENCE);
      setLoadingBadges(false);
      return;
    }

    setLoadingBadges(true);
    try {
      const { data } = await supabase
        .from('user_profile_badge_preferences')
        .select('user_id, featured_badge_ids, updated_at')
        .eq('user_id', viewedUserId)
        .maybeSingle();

      setPreference({
        user_id: viewedUserId,
        featured_badge_ids: normalizeBadgeIds(data?.featured_badge_ids),
        updated_at: data?.updated_at ?? null,
      });
    } finally {
      setLoadingBadges(false);
    }
  }, [viewedUserId]);

  useEffect(() => {
    void loadBadges();
  }, [loadBadges]);

  useFocusEffect(
    useCallback(() => {
      void loadBadges();
      return undefined;
    }, [loadBadges]),
  );

  const featuredBadges = useMemo(() => getProfileBadgesByIds(preference.featured_badge_ids), [preference.featured_badge_ids]);

  return {
    preference,
    featuredBadges,
    loadingBadges,
    refreshBadges: loadBadges,
  };
}

export function useProfileBadgesStudio(userId?: string | null) {
  const [activePreference, setActivePreference] = useState<UserProfileBadgePreferenceRow>(DEFAULT_PREFERENCE);
  const [unlocks, setUnlocks] = useState<UserProfileBadgeUnlock[]>([]);
  const [loadingBadges, setLoadingBadges] = useState(false);
  const [savingBadges, setSavingBadges] = useState(false);

  const refreshBadges = useCallback(async () => {
    if (!userId) {
      setActivePreference(DEFAULT_PREFERENCE);
      setUnlocks([]);
      return;
    }

    setLoadingBadges(true);
    try {
      const [{ data: pref }, { data: unlockRows }] = await Promise.all([
        supabase
          .from('user_profile_badge_preferences')
          .select('user_id, featured_badge_ids, updated_at')
          .eq('user_id', userId)
          .maybeSingle(),
        supabase
          .from('user_profile_badge_unlocks')
          .select('id, owner_user_id, badge_id, status, unlock_source, unlock_amount_cents, stripe_payment_intent, purchased_at, created_at, updated_at')
          .eq('owner_user_id', userId)
          .order('created_at', { ascending: false }),
      ]);

      setActivePreference({
        user_id: userId,
        featured_badge_ids: normalizeBadgeIds(pref?.featured_badge_ids),
        updated_at: pref?.updated_at ?? null,
      });
      setUnlocks((unlockRows ?? []) as UserProfileBadgeUnlock[]);
    } finally {
      setLoadingBadges(false);
    }
  }, [userId]);

  useEffect(() => {
    void refreshBadges();
  }, [refreshBadges]);

  const saveFeaturedBadges = useCallback(async (badgeIds: string[]) => {
    if (!userId) return { ok: false as const, error: 'No user id available.' };

    const nextBadgeIds = normalizeBadgeIds(badgeIds);
    const ownedBadgeIds = new Set(
      unlocks
        .filter((unlock) => unlock.status === 'paid' || unlock.status === 'granted')
        .map((unlock) => unlock.badge_id),
    );

    const missingOwnedBadge = nextBadgeIds.find((badgeId) => !ownedBadgeIds.has(badgeId));
    if (missingOwnedBadge) {
      return { ok: false as const, error: 'Unlock the badge before featuring it.' };
    }

    setSavingBadges(true);
    try {
      const { data, error } = await supabase.rpc('set_featured_profile_badges', {
        p_badge_ids: nextBadgeIds,
      });
      if (error) return { ok: false as const, error: error.message };

      const savedPreference = {
        user_id: userId,
        featured_badge_ids: normalizeBadgeIds(data?.featured_badge_ids ?? nextBadgeIds),
        updated_at: data?.updated_at ?? new Date().toISOString(),
      };
      setActivePreference(savedPreference);
      return { ok: true as const, preference: savedPreference };
    } finally {
      setSavingBadges(false);
    }
  }, [unlocks, userId]);

  const waitForUnlock = useCallback(async (badgeId?: string | null) => {
    if (!userId || !badgeId) return false;

    const started = Date.now();
    while (Date.now() - started < 45000) {
      const { data } = await supabase
        .from('user_profile_badge_unlocks')
        .select('status')
        .eq('owner_user_id', userId)
        .eq('badge_id', badgeId)
        .maybeSingle();

      if (data?.status === 'paid' || data?.status === 'granted') {
        await refreshBadges();
        return true;
      }
      if (data?.status === 'cancelled') {
        await refreshBadges();
        return false;
      }

      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    await refreshBadges();
    return false;
  }, [refreshBadges, userId]);

  const featuredBadges = useMemo<ProfileBadgeDefinition[]>(() => {
    return getProfileBadgesByIds(activePreference.featured_badge_ids);
  }, [activePreference.featured_badge_ids]);

  const ownedBadgeIds = useMemo(() => {
    const ids = new Set<string>();
    unlocks.forEach((unlock) => {
      if (unlock.status === 'paid' || unlock.status === 'granted') ids.add(unlock.badge_id);
    });
    return ids;
  }, [unlocks]);

  return {
    activePreference,
    featuredBadges,
    unlocks,
    ownedBadgeIds,
    loadingBadges,
    savingBadges,
    refreshBadges,
    saveFeaturedBadges,
    waitForUnlock,
  };
}
