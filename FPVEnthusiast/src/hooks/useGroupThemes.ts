import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { supabase } from '../services/supabase';
import {
  DEFAULT_GROUP_CARD_ANIMATION_VARIANT_ID,
  DEFAULT_GROUP_THEME,
  GROUP_CARD_ANIMATION_VARIANTS,
  GROUP_THEME_PRESETS,
  GroupCardAnimationVariantId,
  GroupThemeTokens,
  clampOverlayStrength,
  getPresetGroupTheme,
} from '../constants/groupThemes';

export type GroupThemeSelectionType = 'preset' | 'custom';

export interface GroupThemePreferenceRow {
  user_id: string;
  group_id: string;
  active_theme_type: GroupThemeSelectionType;
  active_theme_id: string;
  active_animation_variant_id?: GroupCardAnimationVariantId | null;
}

export interface GroupCustomTheme {
  id: string;
  group_id: string;
  owner_user_id: string;
  name: string;
  accent_color: string;
  surface_color: string;
  surface_secondary_color: string;
  border_color: string;
  chip_background_color: string;
  chip_text_color: string;
  text_color: string;
  muted_text_color: string;
  banner_image_url?: string | null;
  card_image_url?: string | null;
  overlay_strength?: number | null;
  status: 'pending_payment' | 'paid' | 'cancelled' | 'archived';
  stripe_payment_intent?: string | null;
  purchase_amount_cents?: number | null;
  created_at: string;
  updated_at: string;
}

export interface GroupAnimationPurchase {
  id: string;
  group_id: string;
  owner_user_id: string;
  variant_id: GroupCardAnimationVariantId;
  status: 'pending_payment' | 'paid' | 'cancelled' | 'archived';
  stripe_payment_intent?: string | null;
  purchase_amount_cents?: number | null;
  created_at: string;
  updated_at: string;
}

const resolvedThemeCache = new Map<string, GroupThemeTokens>();
const resolvedThemePromiseCache = new Map<string, Promise<GroupThemeTokens>>();

function cacheKey(userId?: string | null, groupId?: string | null) {
  return `${userId ?? 'anon'}:${groupId ?? 'none'}`;
}

function resolveAnimationVariantId(
  themeType?: GroupThemeSelectionType | null,
  variantId?: GroupCardAnimationVariantId | null,
): GroupCardAnimationVariantId {
  if (themeType === 'custom') return DEFAULT_GROUP_CARD_ANIMATION_VARIANT_ID;
  return variantId ?? DEFAULT_GROUP_CARD_ANIMATION_VARIANT_ID;
}

function applyAnimationVariant(theme: GroupThemeTokens, variantId?: string | null): GroupThemeTokens {
  return {
    ...theme,
    animationVariantId: resolveAnimationVariantId(theme.source, (variantId as GroupCardAnimationVariantId | null | undefined) ?? null),
  };
}

export function customThemeToTokens(theme: GroupCustomTheme): GroupThemeTokens {
  return {
    id: theme.id,
    name: theme.name,
    source: 'custom',
    accentColor: theme.accent_color,
    accentSoftColor: hexToRgba(theme.accent_color, 0.18),
    surfaceColor: theme.surface_color,
    surfaceSecondaryColor: theme.surface_secondary_color,
    borderColor: theme.border_color,
    chipBackgroundColor: theme.chip_background_color,
    chipTextColor: theme.chip_text_color,
    textColor: theme.text_color,
    mutedTextColor: theme.muted_text_color,
    heroStartColor: tintHex(theme.surface_color, 0.16),
    heroEndColor: theme.surface_secondary_color,
    cardImageUrl: theme.card_image_url ?? null,
    bannerImageUrl: theme.banner_image_url ?? null,
    overlayStrength: clampOverlayStrength(theme.overlay_strength),
    animationVariantId: DEFAULT_GROUP_CARD_ANIMATION_VARIANT_ID,
  };
}

function hexToRgba(hex: string, alpha: number) {
  const normalized = (hex || '').replace('#', '');
  const safe = normalized.length === 3
    ? normalized.split('').map((c) => `${c}${c}`).join('')
    : normalized.padEnd(6, '0').slice(0, 6);
  const intValue = Number.parseInt(safe, 16);
  const r = (intValue >> 16) & 255;
  const g = (intValue >> 8) & 255;
  const b = intValue & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function tintHex(hex: string, amount: number) {
  const normalized = (hex || '').replace('#', '');
  const safe = normalized.length === 3
    ? normalized.split('').map((c) => `${c}${c}`).join('')
    : normalized.padEnd(6, '0').slice(0, 6);
  const intValue = Number.parseInt(safe, 16);
  const r = Math.min(255, Math.round(((intValue >> 16) & 255) + 255 * amount));
  const g = Math.min(255, Math.round(((intValue >> 8) & 255) + 255 * amount));
  const b = Math.min(255, Math.round((intValue & 255) + 255 * amount));
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

export function invalidateResolvedGroupTheme(userId?: string | null, groupId?: string | null) {
  const key = cacheKey(userId, groupId);
  resolvedThemeCache.delete(key);
  resolvedThemePromiseCache.delete(key);
}

export async function fetchResolvedGroupTheme(userId?: string | null, groupId?: string | null): Promise<GroupThemeTokens> {
  if (!userId || !groupId) return DEFAULT_GROUP_THEME;

  const key = cacheKey(userId, groupId);
  if (resolvedThemeCache.has(key)) {
    return resolvedThemeCache.get(key)!;
  }
  if (resolvedThemePromiseCache.has(key)) {
    return resolvedThemePromiseCache.get(key)!;
  }

  const request = (async () => {
    const { data: preference } = await supabase
      .from('social_group_theme_preferences')
      .select('active_theme_type, active_theme_id, active_animation_variant_id')
      .eq('user_id', userId)
      .eq('group_id', groupId)
      .maybeSingle();

    const activeAnimationVariantId = resolveAnimationVariantId(
      preference?.active_theme_type as GroupThemeSelectionType | null | undefined,
      (preference?.active_animation_variant_id as GroupCardAnimationVariantId | null | undefined) ?? null,
    );

    if (!preference?.active_theme_id) {
      const fallback = applyAnimationVariant(DEFAULT_GROUP_THEME, activeAnimationVariantId);
      resolvedThemeCache.set(key, fallback);
      return fallback;
    }

    if (preference.active_theme_type === 'preset') {
      const preset = applyAnimationVariant(getPresetGroupTheme(preference.active_theme_id), activeAnimationVariantId);
      resolvedThemeCache.set(key, preset);
      return preset;
    }

    const { data: customTheme } = await supabase
      .from('social_group_custom_themes')
      .select('*')
      .eq('id', preference.active_theme_id)
      .eq('owner_user_id', userId)
      .eq('group_id', groupId)
      .eq('status', 'paid')
      .maybeSingle();

    const resolved = applyAnimationVariant(
      customTheme ? customThemeToTokens(customTheme as GroupCustomTheme) : DEFAULT_GROUP_THEME,
      activeAnimationVariantId,
    );
    resolvedThemeCache.set(key, resolved);
    return resolved;
  })().finally(() => {
    resolvedThemePromiseCache.delete(key);
  });

  resolvedThemePromiseCache.set(key, request);
  return request;
}

export function useResolvedGroupTheme(userId?: string | null, groupId?: string | null) {
  const [theme, setTheme] = useState<GroupThemeTokens>(DEFAULT_GROUP_THEME);
  const [loadingTheme, setLoadingTheme] = useState(false);

  const loadTheme = useCallback(async () => {
    if (!userId || !groupId) {
      setTheme(DEFAULT_GROUP_THEME);
      return;
    }
    setLoadingTheme(true);
    const nextTheme = await fetchResolvedGroupTheme(userId, groupId);
    setTheme(nextTheme);
    setLoadingTheme(false);
  }, [groupId, userId]);

  useEffect(() => {
    void loadTheme();
  }, [loadTheme]);

  useFocusEffect(
    useCallback(() => {
      if (!userId || !groupId) return undefined;
      void loadTheme();
      return undefined;
    }, [groupId, loadTheme, userId]),
  );

  return { theme, loadingTheme, refreshTheme: loadTheme };
}

export interface GroupThemeDraft {
  name: string;
  accentColor: string;
  surfaceColor: string;
  surfaceSecondaryColor: string;
  borderColor: string;
  chipBackgroundColor: string;
  chipTextColor: string;
  textColor: string;
  mutedTextColor: string;
  bannerImageUrl?: string | null;
  cardImageUrl?: string | null;
  overlayStrength: number;
}

const DEFAULT_DRAFT: GroupThemeDraft = {
  name: 'Custom Theme',
  accentColor: '#6c8cff',
  surfaceColor: '#161933',
  surfaceSecondaryColor: '#101327',
  borderColor: '#32407a',
  chipBackgroundColor: 'rgba(108,140,255,0.18)',
  chipTextColor: '#d0dcff',
  textColor: '#ffffff',
  mutedTextColor: '#b8bfd9',
  bannerImageUrl: null,
  cardImageUrl: null,
  overlayStrength: 72,
};

export function createDraftFromPreset(themeId?: string | null): GroupThemeDraft {
  const preset = getPresetGroupTheme(themeId);
  return {
    name: `${preset.name} Custom`,
    accentColor: preset.accentColor,
    surfaceColor: preset.surfaceColor,
    surfaceSecondaryColor: preset.surfaceSecondaryColor,
    borderColor: preset.borderColor,
    chipBackgroundColor: preset.chipBackgroundColor,
    chipTextColor: preset.chipTextColor,
    textColor: preset.textColor,
    mutedTextColor: preset.mutedTextColor,
    bannerImageUrl: null,
    cardImageUrl: null,
    overlayStrength: preset.overlayStrength ?? 72,
  };
}

export function useGroupThemes(userId?: string | null, groupId?: string | null) {
  const [customThemes, setCustomThemes] = useState<GroupCustomTheme[]>([]);
  const [animationPurchases, setAnimationPurchases] = useState<GroupAnimationPurchase[]>([]);
  const [activePreference, setActivePreference] = useState<GroupThemePreferenceRow | null>(null);
  const [loadingThemes, setLoadingThemes] = useState(false);
  const [savingPreference, setSavingPreference] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  const refreshThemes = useCallback(async () => {
    if (!userId || !groupId) {
      setCustomThemes([]);
      setAnimationPurchases([]);
      setActivePreference(null);
      return;
    }

    setLoadingThemes(true);
    const [{ data: preference }, { data: customData }, { data: animationData }] = await Promise.all([
      supabase
        .from('social_group_theme_preferences')
        .select('*')
        .eq('user_id', userId)
        .eq('group_id', groupId)
        .maybeSingle(),
      supabase
        .from('social_group_custom_themes')
        .select('*')
        .eq('owner_user_id', userId)
        .eq('group_id', groupId)
        .in('status', ['paid', 'pending_payment'])
        .order('created_at', { ascending: false }),
      supabase
        .from('social_group_animation_purchases')
        .select('*')
        .eq('owner_user_id', userId)
        .in('status', ['paid', 'pending_payment'])
        .order('created_at', { ascending: false }),
    ]);

    setActivePreference((preference as GroupThemePreferenceRow | null) ?? null);
    setCustomThemes((customData as GroupCustomTheme[] | null) ?? []);
    setAnimationPurchases((animationData as GroupAnimationPurchase[] | null) ?? []);
    setLoadingThemes(false);
  }, [groupId, userId]);

  useEffect(() => {
    void refreshThemes();
  }, [refreshThemes]);

  const activeTheme = useMemo(() => {
    const activeAnimationVariantId = resolveAnimationVariantId(
      activePreference?.active_theme_type,
      activePreference?.active_animation_variant_id ?? DEFAULT_GROUP_CARD_ANIMATION_VARIANT_ID,
    );
    let baseTheme: GroupThemeTokens;
    if (!activePreference?.active_theme_id) {
      baseTheme = DEFAULT_GROUP_THEME;
    } else if (activePreference.active_theme_type === 'preset') {
      baseTheme = getPresetGroupTheme(activePreference.active_theme_id);
    } else {
      const custom = customThemes.find((theme) => theme.id === activePreference.active_theme_id && theme.status === 'paid');
      baseTheme = custom ? customThemeToTokens(custom) : DEFAULT_GROUP_THEME;
    }
    return applyAnimationVariant(baseTheme, activeAnimationVariantId);
  }, [activePreference, customThemes]);

  const activeAnimationVariantId = useMemo(
    () => resolveAnimationVariantId(activePreference?.active_theme_type, activePreference?.active_animation_variant_id ?? DEFAULT_GROUP_CARD_ANIMATION_VARIANT_ID),
    [activePreference?.active_animation_variant_id, activePreference?.active_theme_type],
  );

  const saveThemePreference = useCallback(async (
    themeType: GroupThemeSelectionType,
    themeId: string,
    animationVariantOverride?: GroupCardAnimationVariantId,
  ) => {
    if (!userId || !groupId) return false;
    setSavingPreference(true);
    const { error } = await supabase
      .from('social_group_theme_preferences')
      .upsert({
        user_id: userId,
        group_id: groupId,
        active_theme_type: themeType,
        active_theme_id: themeId,
        active_animation_variant_id: resolveAnimationVariantId(
          themeType,
          animationVariantOverride ?? activePreference?.active_animation_variant_id ?? DEFAULT_GROUP_CARD_ANIMATION_VARIANT_ID,
        ),
      }, { onConflict: 'user_id,group_id' });
    setSavingPreference(false);

    if (error) {
      console.warn('[useGroupThemes] saveThemePreference error:', error.message);
      return false;
    }

    invalidateResolvedGroupTheme(userId, groupId);
    await refreshThemes();
    return true;
  }, [activePreference?.active_animation_variant_id, groupId, refreshThemes, userId]);

  const saveAnimationPreference = useCallback(async (variantId: GroupCardAnimationVariantId) => {
    if (!userId || !groupId) return false;

    if (activePreference?.active_theme_type === 'custom' && variantId !== 'none') {
      return false;
    }

    const canUseVariant = variantId === 'none'
      || animationPurchases.some((purchase) => purchase.variant_id === variantId && purchase.status === 'paid');
    if (!canUseVariant) return false;

    setSavingPreference(true);
    const { error } = await supabase
      .from('social_group_theme_preferences')
      .upsert({
        user_id: userId,
        group_id: groupId,
        active_theme_type: activePreference?.active_theme_type ?? 'preset',
        active_theme_id: activePreference?.active_theme_id ?? DEFAULT_GROUP_THEME.id,
        active_animation_variant_id: variantId,
      }, { onConflict: 'user_id,group_id' });
    setSavingPreference(false);

    if (error) {
      console.warn('[useGroupThemes] saveAnimationPreference error:', error.message);
      return false;
    }

    invalidateResolvedGroupTheme(userId, groupId);
    await refreshThemes();
    return true;
  }, [activePreference?.active_theme_id, activePreference?.active_theme_type, animationPurchases, groupId, refreshThemes, userId]);

  const uploadImage = useCallback(async (
    kind: 'avatar' | 'cover' | 'theme_banner' | 'theme_card',
    aspect: [number, number],
  ): Promise<{ url?: string; canceled?: boolean; error?: string }> => {
    if (!userId || !groupId) return { error: 'Missing group context.' };

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return { error: 'Media library permission denied.' };

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as any,
      allowsEditing: true,
      aspect,
      quality: 0.85,
      base64: false,
    });
    if (result.canceled) return { canceled: true };

    const asset = result.assets[0];
    const uri = asset.uri;
    const ext = (uri.split('?')[0].split('.').pop() ?? 'jpg').toLowerCase() === 'png' ? 'png' : 'jpg';
    const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
    const path = `groups/${groupId}/${kind}-${userId}-${Date.now()}.${ext}`;
    const bucketCandidates = kind === 'avatar' ? ['avatars', 'headers'] : ['headers'];

    setUploadingImage(true);
    try {
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' as any });
      const buffer = decode(base64);

      let lastError: any = null;
      for (const bucket of bucketCandidates) {
        const { error } = await supabase.storage.from(bucket).upload(path, buffer, { contentType: mime, upsert: true });
        if (!error) {
          const { data } = supabase.storage.from(bucket).getPublicUrl(path);
          setUploadingImage(false);
          return { url: data.publicUrl };
        }
        lastError = error;
        console.warn(`[useGroupThemes] upload failed for bucket ${bucket}:`, error.message);
      }

      throw lastError ?? new Error('Upload failed');
    } catch (err: any) {
      setUploadingImage(false);
      return { error: err?.message ?? 'Upload failed' };
    }
  }, [groupId, userId]);

  const updateGroupBranding = useCallback(async (updates: { avatar_url?: string | null; cover_url?: string | null }) => {
    if (!groupId) return false;
    const { error } = await supabase
      .from('social_groups')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', groupId);
    if (error) {
      console.warn('[useGroupThemes] updateGroupBranding error:', error.message);
      return false;
    }
    return true;
  }, [groupId]);

  const waitForThemePurchase = useCallback(async (customThemeId: string, timeoutMs = 60000) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const { data } = await supabase
        .from('social_group_custom_themes')
        .select('*')
        .eq('id', customThemeId)
        .maybeSingle();
      const status = (data as GroupCustomTheme | null)?.status;
      if (status === 'paid') {
        invalidateResolvedGroupTheme(userId, groupId);
        await refreshThemes();
        return true;
      }
      if (status === 'cancelled' || status === 'archived') {
        await refreshThemes();
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
    await refreshThemes();
    return false;
  }, [groupId, refreshThemes, userId]);

  const waitForAnimationPurchase = useCallback(async (purchaseId: string, timeoutMs = 25000) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const { data } = await supabase
        .from('social_group_animation_purchases')
        .select('*')
        .eq('id', purchaseId)
        .maybeSingle();
      if ((data as GroupAnimationPurchase | null)?.status === 'paid') {
        invalidateResolvedGroupTheme(userId, groupId);
        await refreshThemes();
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
    await refreshThemes();
    return false;
  }, [groupId, refreshThemes, userId]);

  return {
    presetThemes: GROUP_THEME_PRESETS,
    animationVariants: GROUP_CARD_ANIMATION_VARIANTS,
    defaultDraft: DEFAULT_DRAFT,
    createDraftFromPreset,
    customThemes,
    animationPurchases,
    activePreference,
    activeTheme,
    activeAnimationVariantId,
    loadingThemes,
    savingPreference,
    uploadingImage,
    refreshThemes,
    saveThemePreference,
    saveAnimationPreference,
    uploadImage,
    updateGroupBranding,
    waitForThemePurchase,
    waitForAnimationPurchase,
  };
}
