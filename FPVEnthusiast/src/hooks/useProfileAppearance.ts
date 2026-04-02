import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../services/supabase';
import {
  DEFAULT_AVATAR_EFFECT_ID,
  DEFAULT_AVATAR_FRAME_ID,
  DEFAULT_PROFILE_THEME_ID,
  type ProfileAppearanceItemType,
  resolveProfileAppearance,
} from '../constants/profileAppearance';

export interface UserProfileAppearancePreferenceRow {
  user_id: string;
  active_theme_id?: string | null;
  active_avatar_frame_id?: string | null;
  active_avatar_effect_id?: string | null;
  updated_at?: string | null;
}

export interface UserProfileAppearancePurchase {
  id: string;
  owner_user_id: string;
  item_type: ProfileAppearanceItemType;
  item_id: string;
  status: 'pending_payment' | 'paid' | 'cancelled';
  purchase_amount_cents?: number | null;
  stripe_payment_intent?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

const DEFAULT_PREFERENCE: UserProfileAppearancePreferenceRow = {
  user_id: '',
  active_theme_id: DEFAULT_PROFILE_THEME_ID,
  active_avatar_frame_id: DEFAULT_AVATAR_FRAME_ID,
  active_avatar_effect_id: DEFAULT_AVATAR_EFFECT_ID,
};

function isOwned(
  purchases: UserProfileAppearancePurchase[],
  itemType: ProfileAppearanceItemType,
  itemId: string,
) {
  if ((itemType === 'theme' && itemId === DEFAULT_PROFILE_THEME_ID)
    || (itemType === 'frame' && itemId === DEFAULT_AVATAR_FRAME_ID)
    || (itemType === 'effect' && itemId === DEFAULT_AVATAR_EFFECT_ID)) {
    return true;
  }
  return purchases.some((purchase) => purchase.item_type === itemType && purchase.item_id === itemId && purchase.status === 'paid');
}

export function useResolvedProfileAppearance(viewedUserId?: string | null) {
  const [preference, setPreference] = useState<UserProfileAppearancePreferenceRow>(DEFAULT_PREFERENCE);
  const [loadingAppearance, setLoadingAppearance] = useState(false);

  const loadAppearance = useCallback(async () => {
    if (!viewedUserId) {
      setPreference(DEFAULT_PREFERENCE);
      setLoadingAppearance(false);
      return;
    }

    setLoadingAppearance(true);
    try {
      const { data } = await supabase
        .from('user_profile_appearance_preferences')
        .select('user_id, active_theme_id, active_avatar_frame_id, active_avatar_effect_id, updated_at')
        .eq('user_id', viewedUserId)
        .maybeSingle();

      setPreference({
        user_id: viewedUserId,
        active_theme_id: data?.active_theme_id ?? DEFAULT_PROFILE_THEME_ID,
        active_avatar_frame_id: data?.active_avatar_frame_id ?? DEFAULT_AVATAR_FRAME_ID,
        active_avatar_effect_id: data?.active_avatar_effect_id ?? DEFAULT_AVATAR_EFFECT_ID,
        updated_at: data?.updated_at ?? null,
      });
    } finally {
      setLoadingAppearance(false);
    }
  }, [viewedUserId]);

  useEffect(() => {
    void loadAppearance();
  }, [loadAppearance]);

  useFocusEffect(
    useCallback(() => {
      void loadAppearance();
      return undefined;
    }, [loadAppearance]),
  );

  const appearance = useMemo(() => resolveProfileAppearance(preference), [preference]);

  return {
    preference,
    appearance,
    loadingAppearance,
    refreshAppearance: loadAppearance,
  };
}

export function useProfileAppearanceStudio(userId?: string | null) {
  const [activePreference, setActivePreference] = useState<UserProfileAppearancePreferenceRow>(DEFAULT_PREFERENCE);
  const [purchases, setPurchases] = useState<UserProfileAppearancePurchase[]>([]);
  const [loadingAppearance, setLoadingAppearance] = useState(false);
  const [savingAppearance, setSavingAppearance] = useState(false);

  const refreshAppearance = useCallback(async () => {
    if (!userId) {
      setActivePreference(DEFAULT_PREFERENCE);
      setPurchases([]);
      return;
    }

    setLoadingAppearance(true);
    try {
      const [{ data: pref }, { data: purchaseRows }] = await Promise.all([
        supabase
          .from('user_profile_appearance_preferences')
          .select('user_id, active_theme_id, active_avatar_frame_id, active_avatar_effect_id, updated_at')
          .eq('user_id', userId)
          .maybeSingle(),
        supabase
          .from('user_profile_appearance_purchases')
          .select('id, owner_user_id, item_type, item_id, status, purchase_amount_cents, stripe_payment_intent, created_at, updated_at')
          .eq('owner_user_id', userId)
          .order('created_at', { ascending: false }),
      ]);

      setActivePreference({
        user_id: userId,
        active_theme_id: pref?.active_theme_id ?? DEFAULT_PROFILE_THEME_ID,
        active_avatar_frame_id: pref?.active_avatar_frame_id ?? DEFAULT_AVATAR_FRAME_ID,
        active_avatar_effect_id: pref?.active_avatar_effect_id ?? DEFAULT_AVATAR_EFFECT_ID,
        updated_at: pref?.updated_at ?? null,
      });
      setPurchases((purchaseRows ?? []) as UserProfileAppearancePurchase[]);
    } finally {
      setLoadingAppearance(false);
    }
  }, [userId]);

  useEffect(() => {
    void refreshAppearance();
  }, [refreshAppearance]);

  const saveSelection = useCallback(async (
    itemType: ProfileAppearanceItemType,
    itemId: string,
    options?: { skipOwnershipCheck?: boolean },
  ) => {
    if (!userId) return { ok: false as const, error: 'No user id available.' };
    if (!options?.skipOwnershipCheck && !isOwned(purchases, itemType, itemId)) {
      return { ok: false as const, error: 'Unlock this item before applying it.' };
    }

    const nextPreference = {
      user_id: userId,
      active_theme_id: itemType === 'theme' ? itemId : (activePreference.active_theme_id ?? DEFAULT_PROFILE_THEME_ID),
      active_avatar_frame_id: itemType === 'frame' ? itemId : (activePreference.active_avatar_frame_id ?? DEFAULT_AVATAR_FRAME_ID),
      active_avatar_effect_id: itemType === 'effect' ? itemId : (activePreference.active_avatar_effect_id ?? DEFAULT_AVATAR_EFFECT_ID),
      updated_at: new Date().toISOString(),
    };

    setSavingAppearance(true);
    try {
      const { error } = await supabase
        .from('user_profile_appearance_preferences')
        .upsert(nextPreference, { onConflict: 'user_id' });
      if (error) return { ok: false as const, error: error.message };
      setActivePreference(nextPreference);
      return { ok: true as const };
    } finally {
      setSavingAppearance(false);
    }
  }, [activePreference.active_avatar_effect_id, activePreference.active_avatar_frame_id, activePreference.active_theme_id, purchases, userId]);

  const waitForPurchase = useCallback(async (purchaseId?: string | null) => {
    if (!purchaseId) return false;
    const started = Date.now();
    while (Date.now() - started < 45000) {
      const { data } = await supabase
        .from('user_profile_appearance_purchases')
        .select('status')
        .eq('id', purchaseId)
        .maybeSingle();
      if (data?.status === 'paid') {
        await refreshAppearance();
        return true;
      }
      if (data?.status === 'cancelled') {
        await refreshAppearance();
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    await refreshAppearance();
    return false;
  }, [refreshAppearance]);

  const activeAppearance = useMemo(() => resolveProfileAppearance(activePreference), [activePreference]);
  const ownedKeys = useMemo(() => {
    const keys = new Set<string>([
      `theme:${DEFAULT_PROFILE_THEME_ID}`,
      `frame:${DEFAULT_AVATAR_FRAME_ID}`,
      `effect:${DEFAULT_AVATAR_EFFECT_ID}`,
    ]);
    purchases.forEach((purchase) => {
      if (purchase.status === 'paid') keys.add(`${purchase.item_type}:${purchase.item_id}`);
    });
    return keys;
  }, [purchases]);

  return {
    activePreference,
    activeAppearance,
    purchases,
    ownedKeys,
    loadingAppearance,
    savingAppearance,
    refreshAppearance,
    saveSelection,
    waitForPurchase,
  };
}
