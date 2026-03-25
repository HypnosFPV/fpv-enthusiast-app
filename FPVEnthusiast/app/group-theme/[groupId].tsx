import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../src/context/AuthContext';
import { supabase } from '../../src/services/supabase';
import { GROUP_THEME_PRESETS, GroupThemeTokens } from '../../src/constants/groupThemes';
import { createDraftFromPreset, customThemeToTokens, GroupCustomTheme, GroupThemeDraft, useGroupThemes } from '../../src/hooks/useGroupThemes';
import { useGroupThemeCheckout } from '../../src/hooks/useGroupThemeCheckout';

interface GroupAppearanceSummary {
  id: string;
  name: string;
  description?: string | null;
  avatar_url?: string | null;
  cover_url?: string | null;
}

const ACCENT_SWATCHES = ['#6c8cff', '#ff7a3d', '#40c98a', '#ffb648', '#d15bff', '#86c3ff', '#ff5f87'];
const SURFACE_SWATCHES = [
  { surface: '#161933', secondary: '#101327', border: '#32407a', chip: 'rgba(108,140,255,0.18)', chipText: '#d0dcff', muted: '#b8bfd9' },
  { surface: '#241510', secondary: '#160d0a', border: '#6a351d', chip: 'rgba(255,122,61,0.18)', chipText: '#ffd1bc', muted: '#d8b2a1' },
  { surface: '#0f221b', secondary: '#0a1612', border: '#23533f', chip: 'rgba(64,201,138,0.18)', chipText: '#b8f3d7', muted: '#9bc9b6' },
  { surface: '#23122f', secondary: '#140c1c', border: '#6d2f89', chip: 'rgba(209,91,255,0.18)', chipText: '#f0c5ff', muted: '#d2afd9' },
];
const OVERLAY_OPTIONS = [
  { label: 'Soft', value: 56 },
  { label: 'Balanced', value: 72 },
  { label: 'Bold', value: 84 },
];

function previewThemeFromDraft(draft: GroupThemeDraft): GroupThemeTokens {
  return {
    id: 'preview',
    name: draft.name,
    source: 'custom',
    accentColor: draft.accentColor,
    accentSoftColor: draft.chipBackgroundColor,
    surfaceColor: draft.surfaceColor,
    surfaceSecondaryColor: draft.surfaceSecondaryColor,
    borderColor: draft.borderColor,
    chipBackgroundColor: draft.chipBackgroundColor,
    chipTextColor: draft.chipTextColor,
    textColor: draft.textColor,
    mutedTextColor: draft.mutedTextColor,
    heroStartColor: draft.surfaceColor,
    heroEndColor: draft.surfaceSecondaryColor,
    bannerImageUrl: draft.bannerImageUrl ?? null,
    cardImageUrl: draft.cardImageUrl ?? null,
    overlayStrength: draft.overlayStrength,
  };
}

function resolveOverlayOpacity(strength?: number | null, min = 0.14, max = 0.5) {
  const normalized = (strength ?? 72) / 180;
  return Math.max(min, Math.min(max, normalized));
}

function Avatar({ uri, size = 58 }: { uri?: string | null; size?: number }) {
  if (uri) {
    return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  }
  return (
    <View style={[styles.avatarFallback, { width: size, height: size, borderRadius: size / 2 }]}> 
      <Ionicons name="people-outline" size={Math.round(size * 0.42)} color="#999" />
    </View>
  );
}

export default function GroupThemeScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const scrollRef = useRef<ScrollView | null>(null);
  const [group, setGroup] = useState<GroupAppearanceSummary | null>(null);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [loadingGroup, setLoadingGroup] = useState(true);
  const [savingBranding, setSavingBranding] = useState(false);
  const [draft, setDraft] = useState<GroupThemeDraft>(() => createDraftFromPreset('midnight'));

  const {
    customThemes,
    activePreference,
    loadingThemes,
    savingPreference,
    uploadingImage,
    saveThemePreference,
    uploadImage,
    updateGroupBranding,
    waitForThemePurchase,
    refreshThemes,
  } = useGroupThemes(user?.id, groupId);

  const { initCheckout, confirmCheckout, checkoutState, resetCheckout } = useGroupThemeCheckout();

  const canManageBranding = myRole === 'owner' || myRole === 'admin';

  const loadGroup = useCallback(async () => {
    if (!groupId || !user?.id) return;
    setLoadingGroup(true);
    const [{ data: groupData, error: groupError }, { data: membershipData }] = await Promise.all([
      supabase
        .from('social_groups')
        .select('id, name, description, avatar_url, cover_url')
        .eq('id', groupId)
        .maybeSingle(),
      supabase
        .from('social_group_members')
        .select('role')
        .eq('group_id', groupId)
        .eq('user_id', user.id)
        .maybeSingle(),
    ]);

    if (groupError || !groupData) {
      Alert.alert('Not found', 'That community could not be loaded.');
      router.back();
      return;
    }

    setGroup(groupData as GroupAppearanceSummary);
    setMyRole((membershipData as any)?.role ?? null);
    setLoadingGroup(false);
  }, [groupId, router, user?.id]);

  useEffect(() => {
    void loadGroup();
  }, [loadGroup]);

  const previewTheme = useMemo(() => previewThemeFromDraft(draft), [draft]);

  const handleUploadBranding = useCallback(async (kind: 'avatar' | 'cover') => {
    const result = await uploadImage(kind, kind === 'avatar' ? [1, 1] : [16, 9]);
    if (result.canceled) return;
    if (result.error || !result.url) {
      Alert.alert('Upload failed', result.error ?? 'Please try again.');
      return;
    }

    setSavingBranding(true);
    const ok = await updateGroupBranding(kind === 'avatar' ? { avatar_url: result.url } : { cover_url: result.url });
    setSavingBranding(false);
    if (!ok) {
      Alert.alert('Save failed', 'Could not update the community branding.');
      return;
    }

    setGroup((prev) => prev ? ({
      ...prev,
      avatar_url: kind === 'avatar' ? result.url : prev.avatar_url,
      cover_url: kind === 'cover' ? result.url : prev.cover_url,
    }) : prev);
  }, [updateGroupBranding, uploadImage]);

  const handleUploadDraftImage = useCallback(async (kind: 'theme_banner' | 'theme_card') => {
    const result = await uploadImage(kind, kind === 'theme_banner' ? [16, 9] : [16, 9]);
    if (result.canceled) return;
    if (result.error || !result.url) {
      Alert.alert('Upload failed', result.error ?? 'Please try again.');
      return;
    }
    setDraft((prev) => ({
      ...prev,
      bannerImageUrl: kind === 'theme_banner' ? result.url : prev.bannerImageUrl,
      cardImageUrl: kind === 'theme_card' ? result.url : prev.cardImageUrl,
    }));
  }, [uploadImage]);

  const handleApplyPreset = useCallback(async (themeId: string) => {
    const ok = await saveThemePreference('preset', themeId);
    if (!ok) {
      Alert.alert('Could not apply theme', 'Please try again.');
      return;
    }
    Alert.alert('Theme updated', 'Your community view now uses the selected preset theme.');
  }, [saveThemePreference]);

  const handleApplyCustom = useCallback(async (themeId: string) => {
    const ok = await saveThemePreference('custom', themeId);
    if (!ok) {
      Alert.alert('Could not apply theme', 'Please try again.');
      return;
    }
    Alert.alert('Theme updated', 'Your custom theme is now active for this community.');
  }, [saveThemePreference]);

  const handlePurchaseCustomTheme = useCallback(async () => {
    if (!groupId) return;
    if (!draft.name.trim()) {
      Alert.alert('Missing name', 'Give your custom theme a name first.');
      return;
    }

    const started = await initCheckout({
      groupId,
      name: draft.name.trim(),
      accentColor: draft.accentColor,
      surfaceColor: draft.surfaceColor,
      surfaceSecondaryColor: draft.surfaceSecondaryColor,
      borderColor: draft.borderColor,
      chipBackgroundColor: draft.chipBackgroundColor,
      chipTextColor: draft.chipTextColor,
      textColor: draft.textColor,
      mutedTextColor: draft.mutedTextColor,
      bannerImageUrl: draft.bannerImageUrl ?? null,
      cardImageUrl: draft.cardImageUrl ?? null,
      overlayStrength: draft.overlayStrength,
    });

    if (!started.ok || !started.customThemeId) {
      Alert.alert('Checkout failed', started.error ?? 'Could not start checkout.');
      return;
    }

    const completed = await confirmCheckout();
    if (!completed.ok || !completed.customThemeId) {
      if (completed.error !== 'cancelled') {
        Alert.alert('Payment failed', completed.error ?? 'Payment did not complete.');
      }
      return;
    }

    const unlocked = await waitForThemePurchase(completed.customThemeId);
    resetCheckout();
    if (!unlocked) {
      Alert.alert('Payment received', 'Your purchase went through. Pull to refresh in a moment if the theme does not appear yet.');
      return;
    }

    Alert.alert('Theme unlocked', 'Your custom theme was added to this group and activated for your view.');
    setDraft(createDraftFromPreset(activePreference?.active_theme_type === 'preset' ? activePreference.active_theme_id : 'midnight'));
  }, [activePreference?.active_theme_id, activePreference?.active_theme_type, confirmCheckout, draft, groupId, initCheckout, resetCheckout, waitForThemePurchase]);

  if (loadingGroup || !group) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color="#ff6a2f" size="large" />
        <Text style={styles.loadingText}>Loading appearance studio…</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView ref={scrollRef} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <TouchableOpacity style={styles.headerBtn} onPress={() => router.back()}>
              <Ionicons name="chevron-back" size={22} color="#fff" />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle}>Appearance studio</Text>
              <Text style={styles.headerSubtitle}>{group.name}</Text>
            </View>
          </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Quick start</Text>
          <Text style={styles.sectionHint}>The key actions are surfaced here so you do not have to hunt through the studio to update the group look.</Text>
          <View style={styles.quickActionsGrid}>
            <TouchableOpacity style={styles.quickActionCard} disabled={!canManageBranding || savingBranding || uploadingImage} onPress={() => void handleUploadBranding('avatar')}>
              <View style={styles.quickActionIconWrap}>
                <Ionicons name="camera-outline" size={18} color="#ff9b68" />
              </View>
              <Text style={styles.quickActionTitle}>Group photo</Text>
              <Text style={styles.quickActionMeta}>{group.avatar_url ? 'Replace the current avatar' : 'Add a square avatar'}</Text>
              <View style={styles.quickActionBadge}>
                <Text style={styles.quickActionBadgeText}>{group.avatar_url ? 'Set' : 'Missing'}</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickActionCard} disabled={!canManageBranding || savingBranding || uploadingImage} onPress={() => void handleUploadBranding('cover')}>
              <View style={styles.quickActionIconWrap}>
                <Ionicons name="image-outline" size={18} color="#ff9b68" />
              </View>
              <Text style={styles.quickActionTitle}>Group banner</Text>
              <Text style={styles.quickActionMeta}>{group.cover_url ? 'Replace the current banner' : 'Add a wide cover image'}</Text>
              <View style={styles.quickActionBadge}>
                <Text style={styles.quickActionBadgeText}>{group.cover_url ? 'Set' : 'Missing'}</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickActionCard} onPress={() => scrollRef.current?.scrollToEnd({ animated: true })}>
              <View style={styles.quickActionIconWrap}>
                <Ionicons name="sparkles-outline" size={18} color="#ff9b68" />
              </View>
              <Text style={styles.quickActionTitle}>Custom theme</Text>
              <Text style={styles.quickActionMeta}>Jump to the premium builder and preview the art treatment.</Text>
              <View style={styles.quickActionBadge}>
                <Text style={styles.quickActionBadgeText}>{customThemes.length > 0 ? `${customThemes.length} saved` : 'Build now'}</Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Group identity</Text>
          <Text style={styles.sectionHint}>Avatar and banner shape the community identity for everyone. Only owners and admins can update them.</Text>

          <View style={styles.identityPreviewWrap}>
            {group.cover_url ? <Image source={{ uri: group.cover_url }} style={styles.groupBanner} /> : <View style={[styles.groupBanner, styles.groupBannerFallback]} />}
            <View style={styles.groupAvatarWrap}>
              <Avatar uri={group.avatar_url} size={68} />
            </View>
          </View>

          {canManageBranding ? (
            <View style={styles.identityActionRow}>
              <TouchableOpacity style={styles.secondaryBtn} disabled={savingBranding || uploadingImage} onPress={() => void handleUploadBranding('avatar')}>
                <Ionicons name="camera-outline" size={16} color="#ff9b68" />
                <Text style={styles.secondaryBtnText}>Change avatar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryBtn} disabled={savingBranding || uploadingImage} onPress={() => void handleUploadBranding('cover')}>
                <Ionicons name="image-outline" size={16} color="#ff9b68" />
                <Text style={styles.secondaryBtnText}>Change banner</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <Text style={styles.lockedText}>Branding is managed by the group owner/admins.</Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Preset themes</Text>
          <Text style={styles.sectionHint}>These are free and can be switched any time for just this group on your device.</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalList}>
            {GROUP_THEME_PRESETS.map((theme) => {
              const isActive = activePreference?.active_theme_type === 'preset' && activePreference.active_theme_id === theme.id;
              return (
                <TouchableOpacity key={theme.id} style={[styles.presetCard, isActive && styles.presetCardActive]} disabled={savingPreference} onPress={() => void handleApplyPreset(theme.id)}>
                  <View style={[styles.swatchPreview, { backgroundColor: theme.surfaceColor, borderColor: theme.borderColor }]}>
                    <View style={[styles.swatchAccent, { backgroundColor: theme.accentColor }]} />
                  </View>
                  <Text style={styles.presetTitle}>{theme.name}</Text>
                  <Text style={styles.presetMeta}>{isActive ? 'Active' : 'Tap to use'}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Your custom theme collection</Text>
          <Text style={styles.sectionHint}>Custom themes are purchased per group and stay locked to this community for your account.</Text>
          {loadingThemes ? (
            <ActivityIndicator color="#ff6a2f" size="small" />
          ) : customThemes.length === 0 ? (
            <Text style={styles.emptyText}>No custom themes yet for this group.</Text>
          ) : (
            customThemes.map((theme) => {
              const tokens = customThemeToTokens(theme);
              const isActive = activePreference?.active_theme_type === 'custom' && activePreference.active_theme_id === theme.id;
              return (
                <View key={theme.id} style={styles.collectionRow}>
                  <View style={[styles.collectionSwatch, { backgroundColor: tokens.surfaceColor, borderColor: tokens.borderColor }]}>
                    <View style={[styles.collectionSwatchAccent, { backgroundColor: tokens.accentColor }]} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.collectionTitle}>{theme.name}</Text>
                    <Text style={styles.collectionMeta}>{theme.status === 'paid' ? (isActive ? 'Active in this group' : 'Purchased for this group') : 'Payment pending'}</Text>
                  </View>
                  {theme.status === 'paid' ? (
                    <TouchableOpacity style={styles.secondaryBtn} disabled={savingPreference} onPress={() => void handleApplyCustom(theme.id)}>
                      <Text style={styles.secondaryBtnText}>{isActive ? 'Active' : 'Use'}</Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={styles.pendingPill}><Text style={styles.pendingPillText}>Pending</Text></View>
                  )}
                </View>
              );
            })
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Build a premium custom theme</Text>
          <Text style={styles.sectionHint}>Preview first, then unlock if you like it. Artwork now sits in dedicated preview frames so you can judge the banner and feed card treatment before paying.</Text>

          <Text style={styles.label}>Theme name</Text>
          <TextInput
            style={styles.input}
            value={draft.name}
            onChangeText={(value) => setDraft((prev) => ({ ...prev, name: value }))}
            placeholder="e.g. Desert rip"
            placeholderTextColor="#666"
          />

          <Text style={styles.label}>Start from a preset</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalList}>
            {GROUP_THEME_PRESETS.map((theme) => (
              <TouchableOpacity key={`seed-${theme.id}`} style={styles.seedChip} onPress={() => setDraft(createDraftFromPreset(theme.id))}>
                <Text style={styles.seedChipText}>{theme.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={styles.label}>Accent color</Text>
          <View style={styles.swatchRow}>
            {ACCENT_SWATCHES.map((color) => (
              <TouchableOpacity
                key={color}
                style={[styles.colorDot, { backgroundColor: color }, draft.accentColor === color && styles.colorDotActive]}
                onPress={() => setDraft((prev) => ({ ...prev, accentColor: color }))}
              />
            ))}
          </View>

          <Text style={styles.label}>Surface style</Text>
          <View style={styles.surfaceGrid}>
            {SURFACE_SWATCHES.map((option) => (
              <TouchableOpacity
                key={option.surface}
                style={[styles.surfaceCard, draft.surfaceColor === option.surface && styles.surfaceCardActive]}
                onPress={() => setDraft((prev) => ({
                  ...prev,
                  surfaceColor: option.surface,
                  surfaceSecondaryColor: option.secondary,
                  borderColor: option.border,
                  chipBackgroundColor: option.chip,
                  chipTextColor: prev.accentColor === '#ffb648' ? '#ffe2a7' : prev.chipTextColor,
                  mutedTextColor: option.muted,
                }))}
              >
                <View style={[styles.surfacePreview, { backgroundColor: option.surface, borderColor: option.border }]}>
                  <View style={[styles.surfacePreviewInner, { backgroundColor: option.secondary }]} />
                </View>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Template art</Text>
          <Text style={styles.assetHint}>Banner art is used on the group header. Card art is used in the feed theme and now gets its own framed treatment so it does not disappear into the background.</Text>
          <View style={styles.identityActionRow}>
            <TouchableOpacity style={styles.secondaryBtn} disabled={uploadingImage} onPress={() => void handleUploadDraftImage('theme_banner')}>
              <Ionicons name="image-outline" size={16} color="#ff9b68" />
              <Text style={styles.secondaryBtnText}>{draft.bannerImageUrl ? 'Change banner art' : 'Upload banner art'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} disabled={uploadingImage} onPress={() => void handleUploadDraftImage('theme_card')}>
              <Ionicons name="albums-outline" size={16} color="#ff9b68" />
              <Text style={styles.secondaryBtnText}>{draft.cardImageUrl ? 'Change card art' : 'Upload card art'}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.assetPreviewGrid}>
            <View style={styles.assetPreviewCard}>
              <Text style={styles.assetPreviewLabel}>Header banner art</Text>
              {draft.bannerImageUrl ? <Image source={{ uri: draft.bannerImageUrl }} style={styles.assetPreviewThumb} /> : <View style={[styles.assetPreviewThumb, styles.assetPreviewPlaceholder]}><Ionicons name="image-outline" size={22} color="#666" /></View>}
              <Text style={styles.assetPreviewMeta}>{draft.bannerImageUrl ? 'Ready for the group header preview.' : 'No banner art yet.'}</Text>
            </View>
            <View style={styles.assetPreviewCard}>
              <Text style={styles.assetPreviewLabel}>Feed card art</Text>
              {draft.cardImageUrl ? <Image source={{ uri: draft.cardImageUrl }} style={styles.assetPreviewThumb} /> : <View style={[styles.assetPreviewThumb, styles.assetPreviewPlaceholder]}><Ionicons name="albums-outline" size={22} color="#666" /></View>}
              <Text style={styles.assetPreviewMeta}>{draft.cardImageUrl ? 'Ready for the feed card frame.' : 'No card art yet.'}</Text>
            </View>
          </View>

          <Text style={styles.label}>Readability overlay</Text>
          <View style={styles.choiceRow}>
            {OVERLAY_OPTIONS.map((option) => (
              <TouchableOpacity key={option.label} style={[styles.choiceChip, draft.overlayStrength === option.value && styles.choiceChipActive]} onPress={() => setDraft((prev) => ({ ...prev, overlayStrength: option.value }))}>
                <Text style={[styles.choiceChipText, draft.overlayStrength === option.value && styles.choiceChipTextActive]}>{option.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <ThemePreview group={group} theme={previewTheme} />

          <TouchableOpacity style={[styles.primaryBtn, checkoutState.status === 'loading' || checkoutState.status === 'processing' ? { opacity: 0.7 } : null]} disabled={checkoutState.status === 'loading' || checkoutState.status === 'processing'} onPress={() => void handlePurchaseCustomTheme()}>
            {checkoutState.status === 'loading' || checkoutState.status === 'processing' ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Ionicons name="sparkles-outline" size={16} color="#fff" />
                <Text style={styles.primaryBtnText}>Preview approved — unlock for $2.99</Text>
              </>
            )}
          </TouchableOpacity>
          <Text style={styles.purchaseHint}>The purchase stays locked to {group.name} and will show in your collection for this group only.</Text>
        </View>

        <TouchableOpacity style={styles.refreshBtn} onPress={() => void Promise.all([loadGroup(), refreshThemes()])}>
          <Ionicons name="refresh-outline" size={16} color="#bbb" />
          <Text style={styles.refreshBtnText}>Refresh appearance data</Text>
        </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ThemePreview({ group, theme }: { group: GroupAppearanceSummary; theme: GroupThemeTokens }) {
  const heroOverlayOpacity = resolveOverlayOpacity(theme.overlayStrength, 0.16, 0.46);
  const cardOverlayOpacity = resolveOverlayOpacity(theme.overlayStrength, 0.08, 0.32);
  const hasCardArt = !!theme.cardImageUrl;
  const contentPlateStyle = hasCardArt
    ? {
        backgroundColor: `rgba(8,10,16,${Math.min(0.76, cardOverlayOpacity + 0.34)})`,
        borderColor: `rgba(255,255,255,${Math.min(0.16, cardOverlayOpacity * 0.45)})`,
      }
    : {
        backgroundColor: 'rgba(255,255,255,0.03)',
        borderColor: 'rgba(255,255,255,0.05)',
      };
  const previewBodyText = hasCardArt
    ? 'Pinned a new look for Admin test — this is how the premium card treatment will read in the feed with your uploaded art, overlay, and surface glow applied.'
    : '';

  return (
    <View style={styles.previewWrap}>
      <View>
        <Text style={styles.previewSectionLabel}>Community header</Text>
        <View style={[styles.previewHero, { backgroundColor: theme.surfaceSecondaryColor, borderColor: theme.borderColor }]}> 
          {group.cover_url || theme.bannerImageUrl ? (
            <Image source={{ uri: theme.bannerImageUrl ?? group.cover_url ?? undefined }} style={styles.previewHeroBanner} />
          ) : null}
          <View style={[styles.previewHeroOverlay, { backgroundColor: `rgba(0,0,0,${heroOverlayOpacity})` }]} />
          <View style={styles.previewHeroContent}>
            <Avatar uri={group.avatar_url} size={50} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.previewHeroTitle, { color: theme.textColor }]}>{group.name}</Text>
              <Text style={[styles.previewHeroMeta, { color: theme.mutedTextColor }]}>Community page preview</Text>
            </View>
          </View>
        </View>
      </View>

      <View>
        <Text style={styles.previewSectionLabel}>Feed card treatment</Text>
        <View style={[styles.previewPostCard, { backgroundColor: theme.surfaceColor, borderColor: theme.borderColor }]}> 
          {hasCardArt ? <Image source={{ uri: theme.cardImageUrl ?? undefined }} style={styles.previewPostImage} /> : null}
          {hasCardArt ? <View style={[styles.previewPostOverlay, { backgroundColor: `rgba(0,0,0,${cardOverlayOpacity})` }]} /> : null}
          <View style={[styles.previewArtBadge, { backgroundColor: theme.chipBackgroundColor, borderColor: theme.borderColor }]}> 
            <Ionicons name="sparkles-outline" size={12} color={theme.chipTextColor} />
            <Text style={[styles.previewArtBadgeText, { color: theme.chipTextColor }]}>{hasCardArt ? 'Full-card art preview' : 'Premium frame preview'}</Text>
          </View>
          <View style={styles.previewPostContent}>
            <View style={[styles.previewPostContentPlate, contentPlateStyle]}>
              <View style={styles.previewPostHeader}>
                <Avatar uri={group.avatar_url} size={34} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.previewPostAuthor, { color: theme.textColor }]}>HypnosBot</Text>
                  <Text style={[styles.previewPostMeta, { color: theme.mutedTextColor }]}>just now</Text>
                  <View style={[styles.previewChip, { backgroundColor: theme.chipBackgroundColor, borderColor: theme.borderColor }]}>
                    <Ionicons name="people-outline" size={11} color={theme.chipTextColor} />
                    <Text style={[styles.previewChipText, { color: theme.chipTextColor }]} numberOfLines={1}>View group • {group.name}</Text>
                  </View>
                </View>
              </View>
              {!hasCardArt ? (
                <View style={styles.previewEmptyMediaCard}>
                  <View style={styles.previewEmptyMediaCenter}>
                    <View style={styles.previewEmptyMediaIconWrap}>
                      <Ionicons name="albums-outline" size={20} color={theme.chipTextColor} />
                    </View>
                    <Text style={[styles.previewEmptyMediaTitle, { color: theme.textColor }]}>Card art preview appears here</Text>
                    <Text style={[styles.previewEmptyMediaText, { color: theme.mutedTextColor }]}>Upload artwork above to see the animated premium treatment on a real post surface.</Text>
                  </View>
                </View>
              ) : (
                <Text style={[styles.previewCaption, { color: theme.textColor }]}>{previewBodyText}</Text>
              )}
              <View style={[styles.previewDivider, { backgroundColor: theme.borderColor }]} />
              <View style={styles.previewActions}>
                <Ionicons name="heart-outline" size={22} color={theme.mutedTextColor} />
                <Ionicons name="chatbubble-outline" size={20} color={theme.accentColor} />
              </View>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  centered: { alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: '#9a9a9a', marginTop: 12, fontSize: 14 },
  scrollContent: { padding: 16, paddingTop: 16, paddingBottom: 32, gap: 14 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#151515',
  },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '800' },
  headerSubtitle: { color: '#8b8b8b', fontSize: 13, marginTop: 2 },
  card: {
    backgroundColor: '#111',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    padding: 16,
  },
  sectionTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  sectionHint: { color: '#8b8b8b', fontSize: 13, lineHeight: 18, marginTop: 5 },
  quickActionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  quickActionCard: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 150,
    backgroundColor: '#151515',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#242424',
    padding: 14,
    gap: 8,
  },
  quickActionIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#24130c',
  },
  quickActionTitle: { color: '#fff', fontSize: 14, fontWeight: '800' },
  quickActionMeta: { color: '#9a9a9a', fontSize: 12, lineHeight: 17 },
  quickActionBadge: {
    alignSelf: 'flex-start',
    marginTop: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#4f2d1d',
    backgroundColor: '#1d130f',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  quickActionBadgeText: { color: '#ffb088', fontSize: 11, fontWeight: '800' },
  label: { color: '#ddd', fontSize: 13, fontWeight: '700', marginTop: 16, marginBottom: 8 },
  input: {
    backgroundColor: '#171717',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#262626',
    color: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  identityPreviewWrap: { marginTop: 16 },
  groupBanner: { width: '100%', height: 140, borderRadius: 16, backgroundColor: '#161616' },
  groupBannerFallback: { borderWidth: 1, borderColor: '#2a2a2a' },
  groupAvatarWrap: { position: 'absolute', bottom: -24, left: 18 },
  avatarFallback: { backgroundColor: '#1c1c1c', alignItems: 'center', justifyContent: 'center' },
  identityActionRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', marginTop: 36 },
  secondaryBtn: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#53301f',
    backgroundColor: '#1a120f',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  secondaryBtnText: { color: '#ffb088', fontSize: 13, fontWeight: '700' },
  lockedText: { color: '#7b7b7b', fontSize: 13, marginTop: 14 },
  horizontalList: { gap: 10, paddingTop: 14, paddingBottom: 2 },
  presetCard: {
    width: 132,
    borderRadius: 14,
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#252525',
    padding: 12,
  },
  presetCardActive: { borderColor: '#ff6a2f', backgroundColor: '#20110b' },
  swatchPreview: { height: 66, borderRadius: 12, borderWidth: 1, justifyContent: 'flex-end', padding: 8 },
  swatchAccent: { width: 42, height: 8, borderRadius: 999 },
  presetTitle: { color: '#fff', fontSize: 13, fontWeight: '700', marginTop: 10 },
  presetMeta: { color: '#8c8c8c', fontSize: 12, marginTop: 4 },
  emptyText: { color: '#8b8b8b', marginTop: 14, fontSize: 13 },
  collectionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },
  collectionSwatch: { width: 56, height: 56, borderRadius: 14, borderWidth: 1, justifyContent: 'flex-end', padding: 8 },
  collectionSwatchAccent: { width: 28, height: 6, borderRadius: 999 },
  collectionTitle: { color: '#fff', fontSize: 14, fontWeight: '700' },
  collectionMeta: { color: '#8b8b8b', fontSize: 12, marginTop: 4 },
  pendingPill: { backgroundColor: '#261910', borderColor: '#6a351d', borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  pendingPillText: { color: '#ffb48d', fontSize: 12, fontWeight: '700' },
  seedChip: { backgroundColor: '#171717', borderRadius: 999, borderWidth: 1, borderColor: '#262626', paddingHorizontal: 12, paddingVertical: 9 },
  seedChipText: { color: '#ddd', fontSize: 12, fontWeight: '600' },
  swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  colorDot: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: 'transparent' },
  colorDotActive: { borderColor: '#fff' },
  surfaceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  surfaceCard: { width: 72, borderRadius: 12, borderWidth: 1, borderColor: '#282828', backgroundColor: '#141414', padding: 8 },
  surfaceCardActive: { borderColor: '#ff6a2f' },
  surfacePreview: { height: 46, borderRadius: 10, borderWidth: 1, padding: 7 },
  surfacePreviewInner: { flex: 1, borderRadius: 8 },
  choiceRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  choiceChip: { borderRadius: 999, borderWidth: 1, borderColor: '#2a2a2a', paddingHorizontal: 12, paddingVertical: 9, backgroundColor: '#151515' },
  choiceChipActive: { borderColor: '#ff6a2f', backgroundColor: '#24130c' },
  choiceChipText: { color: '#bbb', fontSize: 12, fontWeight: '700' },
  choiceChipTextActive: { color: '#ffb088' },
  assetHint: { color: '#8f8f8f', fontSize: 12, lineHeight: 17, marginBottom: 2 },
  assetPreviewGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  assetPreviewCard: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 146,
    backgroundColor: '#151515',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#252525',
    padding: 12,
  },
  assetPreviewLabel: { color: '#fff', fontSize: 12, fontWeight: '700' },
  assetPreviewThumb: { width: '100%', height: 92, borderRadius: 12, marginTop: 10, backgroundColor: '#0f0f0f' },
  assetPreviewPlaceholder: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#2d2d2d' },
  assetPreviewMeta: { color: '#8b8b8b', fontSize: 11, lineHeight: 16, marginTop: 8 },
  previewWrap: { marginTop: 18, gap: 16 },
  previewSectionLabel: { color: '#a6a6a6', fontSize: 12, fontWeight: '700', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.6 },
  previewHero: { height: 156, borderRadius: 18, overflow: 'hidden', borderWidth: 1 },
  previewHeroBanner: { ...StyleSheet.absoluteFillObject },
  previewHeroOverlay: { ...StyleSheet.absoluteFillObject },
  previewHeroContent: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 12, padding: 16 },
  previewHeroTitle: { fontSize: 18, fontWeight: '800' },
  previewHeroMeta: { fontSize: 12, marginTop: 2 },
  previewPostCard: { borderRadius: 18, overflow: 'hidden', borderWidth: 1, minHeight: 296, justifyContent: 'flex-end' },
  previewPostImage: { ...StyleSheet.absoluteFillObject, opacity: 0.6 },
  previewPostOverlay: { ...StyleSheet.absoluteFillObject },
  previewPostContent: { padding: 14, paddingTop: 64, zIndex: 1 },
  previewPostContentPlate: { borderRadius: 16, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 14, gap: 12 },
  previewEmptyMediaCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    minHeight: 132,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  previewEmptyMediaCenter: { width: '100%', alignItems: 'center', justifyContent: 'center' },
  previewEmptyMediaIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    marginBottom: 10,
  },
  previewEmptyMediaTitle: { fontSize: 13, fontWeight: '700', textAlign: 'center' },
  previewEmptyMediaText: { fontSize: 12, lineHeight: 17, marginTop: 6, textAlign: 'center' },
  previewPostHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  previewPostAuthor: { fontSize: 15, fontWeight: '700' },
  previewPostMeta: { fontSize: 11, marginTop: 2 },
  previewChip: { marginTop: 8, borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', maxWidth: '100%' },
  previewChipText: { fontSize: 11, fontWeight: '700', flexShrink: 1 },
  previewArtBadge: {
    position: 'absolute',
    top: 14,
    left: 14,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    zIndex: 2,
  },
  previewArtBadgeText: { fontSize: 11, fontWeight: '800' },
  previewCaption: { fontSize: 13, lineHeight: 19 },
  previewDivider: { height: StyleSheet.hairlineWidth, width: '100%' },
  previewActions: { flexDirection: 'row', gap: 18, alignItems: 'center' },
  primaryBtn: { marginTop: 18, borderRadius: 14, backgroundColor: '#ff6a2f', paddingHorizontal: 14, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  purchaseHint: { color: '#8b8b8b', fontSize: 12, lineHeight: 17, marginTop: 10 },
  refreshBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12 },
  refreshBtnText: { color: '#bbb', fontSize: 13, fontWeight: '600' },
});
