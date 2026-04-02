import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/context/AuthContext';
import { useProfile } from '../src/hooks/useProfile';
import {
  AVATAR_EFFECTS,
  AVATAR_FRAMES,
  PROFILE_THEMES,
  formatUsd,
  resolveProfileAppearance,
  type AvatarEffectDefinition,
  type AvatarFrameDefinition,
  type ProfileAppearanceItemType,
  type ProfileThemeDefinition,
} from '../src/constants/profileAppearance';
import {
  FEATURED_PROFILE_BADGE_LIMIT,
  PROFILE_BADGES,
  badgeTierLabel,
  formatBadgePrice,
  getProfileBadgesByIds,
  type ProfileBadgeDefinition,
} from '../src/constants/profileBadges';
import { useProfileAppearanceCheckout } from '../src/hooks/useProfileAppearanceCheckout';
import { useProfileAppearanceStudio } from '../src/hooks/useProfileAppearance';
import { useProfileBadgeCheckout } from '../src/hooks/useProfileBadgeCheckout';
import { useProfileBadgesStudio } from '../src/hooks/useProfileBadges';
import ProfileAvatarDecoration from '../src/components/ProfileAvatarDecoration';
import ProfileBannerMedia from '../src/components/ProfileBannerMedia';
import ProfileBadgeRow from '../src/components/ProfileBadgeRow';

function StudioSectionHeader({
  title,
  subtitle,
  expanded,
  onPress,
}: {
  title: string;
  subtitle: string;
  expanded: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onPress} style={styles.sectionHeaderButton}>
      <View style={{ flex: 1 }}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionHint}>{subtitle}</Text>
      </View>
      <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color="#d8def4" />
    </TouchableOpacity>
  );
}

type CatalogItem = ProfileThemeDefinition | AvatarFrameDefinition | AvatarEffectDefinition;

function StudioItemRow({
  item,
  accentColor,
  owned,
  active,
  selected,
  busy,
  onPreview,
  onPress,
}: {
  item: CatalogItem;
  accentColor: string;
  owned: boolean;
  active: boolean;
  selected: boolean;
  busy: boolean;
  onPreview: () => void;
  onPress: () => void;
}) {
  const isFree = item.priceCents === 0;
  const buttonLabel = active ? 'Active' : owned || isFree ? 'Apply' : `Unlock ${formatUsd(item.priceCents)}`;
  const previewLabel = active ? 'Live' : selected ? 'Previewing' : 'Preview';

  return (
    <View style={[styles.itemCard, { borderColor: active || selected ? accentColor : '#272a3f' }]}>
      <View style={styles.itemHeaderRow}>
        <View style={[styles.itemSwatch, { backgroundColor: 'accentColor' in item ? item.accentColor : item.primaryColor, borderColor: accentColor }]} />
        <View style={{ flex: 1 }}>
          <View style={styles.itemTitleRow}>
            <Text style={styles.itemTitle}>{item.name}</Text>
            <View style={[styles.badgePill, { borderColor: `${accentColor}77` }]}>
              <Text style={[styles.badgeText, { color: accentColor }]}>{item.badge}</Text>
            </View>
          </View>
          <Text style={styles.itemDescription}>{item.description}</Text>
          <Text style={styles.previewHintText}>
            {active ? 'Currently live on your profile' : selected ? 'Previewing above until you apply it' : 'Preview before you make it live'}
          </Text>
        </View>
      </View>
      <View style={styles.itemFooterRow}>
        <Text style={styles.itemPrice}>{isFree ? 'Included' : formatUsd(item.priceCents)}</Text>
        <View style={styles.badgeActionRow}>
          <TouchableOpacity
            activeOpacity={0.85}
            style={[
              styles.previewButton,
              { borderColor: `${accentColor}55`, backgroundColor: selected ? `${accentColor}16` : 'transparent' },
              busy && { opacity: 0.6 },
            ]}
            onPress={onPreview}
            disabled={busy}
          >
            <Text style={[styles.previewButtonText, { color: accentColor }]}>{previewLabel}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.9}
            style={[
              styles.itemButton,
              active ? styles.itemButtonActive : owned || isFree ? styles.itemButtonOwned : { backgroundColor: accentColor },
              busy && { opacity: 0.6 },
            ]}
            onPress={onPress}
            disabled={busy || active}
          >
            {busy ? <ActivityIndicator color={active ? accentColor : '#071016'} size="small" /> : (
              <Text style={[styles.itemButtonText, active && { color: accentColor }]}>{buttonLabel}</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function BadgeStudioRow({
  badge,
  owned,
  featured,
  previewed,
  busy,
  onPreview,
  onPress,
}: {
  badge: ProfileBadgeDefinition;
  owned: boolean;
  featured: boolean;
  previewed: boolean;
  busy: boolean;
  onPreview: () => void;
  onPress: () => void;
}) {
  const buttonLabel = featured ? 'Featured' : owned ? 'Feature' : `Unlock ${formatBadgePrice(badge.priceCents)}`;

  return (
    <View style={[styles.itemCard, { borderColor: featured || previewed ? badge.accentColor : '#272a3f' }]}>
      <View style={styles.itemHeaderRow}>
        <View style={[styles.badgeIconSwatch, { backgroundColor: `${badge.accentColor}18`, borderColor: `${badge.accentColor}55` }]}>
          <Ionicons name={badge.iconName as any} size={18} color={badge.accentColor} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.itemTitleRow}>
            <Text style={styles.itemTitle}>{badge.name}</Text>
            <View style={[styles.badgePill, { borderColor: `${badge.accentColor}77` }]}>
              <Text style={[styles.badgeText, { color: badge.accentColor }]}>{badgeTierLabel(badge.tier)}</Text>
            </View>
          </View>
          <Text style={styles.itemDescription}>{badge.description}</Text>
          <View style={styles.badgeMetaRow}>
            {badge.limited ? <Text style={[styles.badgeLimitedText, { color: badge.accentColor }]}>Limited collectible</Text> : null}
            <Text style={styles.previewHintText}>{previewed ? 'Previewing above' : 'Preview before you unlock'}</Text>
          </View>
        </View>
      </View>
      <View style={styles.itemFooterRow}>
        <Text style={styles.itemPrice}>{formatBadgePrice(badge.priceCents)}</Text>
        <View style={styles.badgeActionRow}>
          <TouchableOpacity
            activeOpacity={0.85}
            style={[
              styles.previewButton,
              { borderColor: `${badge.accentColor}55`, backgroundColor: previewed ? `${badge.accentColor}16` : 'transparent' },
            ]}
            onPress={onPreview}
            disabled={busy}
          >
            <Text style={[styles.previewButtonText, { color: badge.accentColor }]}>{previewed ? 'Previewing' : 'Preview'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.9}
            style={[
              styles.itemButton,
              featured ? styles.itemButtonActive : owned ? styles.itemButtonOwned : { backgroundColor: badge.accentColor },
              busy && { opacity: 0.6 },
            ]}
            onPress={onPress}
            disabled={busy || featured}
          >
            {busy ? <ActivityIndicator color={featured ? badge.accentColor : '#071016'} size="small" /> : (
              <Text style={[styles.itemButtonText, featured && { color: badge.accentColor }]}>{buttonLabel}</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

export default function ProfileAppearanceStudioScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { profile } = useProfile(user?.id ?? undefined);
  const {
    activePreference,
    activeAppearance,
    ownedKeys,
    loadingAppearance,
    savingAppearance,
    saveSelection,
    refreshAppearance,
    waitForPurchase,
  } = useProfileAppearanceStudio(user?.id ?? undefined);
  const { initCheckout, confirmCheckout, resetCheckout, checkoutState } = useProfileAppearanceCheckout();
  const {
    activePreference: activeBadgePreference,
    featuredBadges,
    ownedBadgeIds,
    loadingBadges,
    savingBadges,
    refreshBadges,
    saveFeaturedBadges,
    waitForUnlock,
  } = useProfileBadgesStudio(user?.id ?? undefined);
  const [draftPreference, setDraftPreference] = useState(activePreference);
  const {
    initCheckout: initBadgeCheckout,
    confirmCheckout: confirmBadgeCheckout,
    resetCheckout: resetBadgeCheckout,
    checkoutState: badgeCheckoutState,
  } = useProfileBadgeCheckout();
  const [previewBadgeIds, setPreviewBadgeIds] = useState<string[] | null>(null);
  const scrollViewRef = useRef<ScrollView | null>(null);
  const [previewCardY, setPreviewCardY] = useState(0);
  const [expandedSection, setExpandedSection] = useState<'themes' | 'frames' | 'effects' | 'badges' | null>(null);

  useEffect(() => {
    setDraftPreference(activePreference);
  }, [
    activePreference.active_avatar_effect_id,
    activePreference.active_avatar_frame_id,
    activePreference.active_theme_id,
    activePreference.updated_at,
  ]);

  const previewAppearance = useMemo(() => resolveProfileAppearance(draftPreference), [draftPreference]);
  const hasAppearancePreview = draftPreference.active_theme_id !== activePreference.active_theme_id
    || draftPreference.active_avatar_frame_id !== activePreference.active_avatar_frame_id
    || draftPreference.active_avatar_effect_id !== activePreference.active_avatar_effect_id;

  const previewBadges = useMemo(() => {
    return previewBadgeIds?.length ? getProfileBadgesByIds(previewBadgeIds) : featuredBadges;
  }, [featuredBadges, previewBadgeIds]);

  const appearanceBusy = savingAppearance || checkoutState.status === 'loading' || checkoutState.status === 'processing';
  const badgeBusy = savingBadges || badgeCheckoutState.status === 'loading' || badgeCheckoutState.status === 'processing';

  const toggleSection = useCallback((section: 'themes' | 'frames' | 'effects' | 'badges') => {
    setExpandedSection((current) => current === section ? null : section);
  }, []);

  const scrollToPreview = useCallback(() => {
    scrollViewRef.current?.scrollTo({ y: Math.max(previewCardY - 12, 0), animated: true });
  }, [previewCardY]);

  const handleApply = useCallback(async (itemType: ProfileAppearanceItemType, itemId: string) => {
    const result = await saveSelection(itemType, itemId);
    if (!result.ok) {
      Alert.alert('Could not update style', result.error ?? 'Please try again.');
      return;
    }
    Alert.alert('Profile updated', 'Your appearance is now live anywhere people open your profile.');
  }, [saveSelection]);

  const handlePurchase = useCallback(async (itemType: ProfileAppearanceItemType, itemId: string) => {
    const started = await initCheckout({ itemType, itemId });
    if (!started.ok) {
      Alert.alert('Checkout failed', started.error ?? 'Could not start checkout.');
      return;
    }

    const completed = await confirmCheckout();
    if (!completed.ok || !completed.purchaseId) {
      if (completed.error !== 'cancelled') {
        Alert.alert('Payment failed', completed.error ?? 'Payment did not complete.');
      }
      return;
    }

    const unlocked = await waitForPurchase(completed.purchaseId);
    resetCheckout();
    if (!unlocked) {
      Alert.alert('Payment received', 'Your unlock should finish shortly. Pull to refresh if it does not appear right away.');
      return;
    }

    const applied = await saveSelection(itemType, itemId, { skipOwnershipCheck: true });
    if (!applied.ok) {
      Alert.alert('Unlocked', 'Your item was purchased successfully. If it does not appear live immediately, pull to refresh.');
      return;
    }

    Alert.alert('Unlocked', 'Your new profile cosmetic is live now and visible to profile visitors.');
  }, [confirmCheckout, initCheckout, resetCheckout, saveSelection, waitForPurchase]);

  const handleItemPress = useCallback(async (itemType: ProfileAppearanceItemType, item: CatalogItem) => {
    const owned = ownedKeys.has(`${itemType}:${item.id}`);
    if (owned || item.priceCents === 0) {
      await handleApply(itemType, item.id);
      return;
    }
    await handlePurchase(itemType, item.id);
  }, [handleApply, handlePurchase, ownedKeys]);

  const handleRefresh = useCallback(() => {
    void refreshAppearance();
    void refreshBadges();
    setDraftPreference(activePreference);
    setPreviewBadgeIds(null);
  }, [activePreference, refreshAppearance, refreshBadges]);

  const handlePreviewAppearance = useCallback((itemType: ProfileAppearanceItemType, itemId: string) => {
    setDraftPreference((current) => ({
      user_id: current.user_id || activePreference.user_id,
      active_theme_id: itemType === 'theme' ? itemId : (current.active_theme_id ?? activePreference.active_theme_id),
      active_avatar_frame_id: itemType === 'frame' ? itemId : (current.active_avatar_frame_id ?? activePreference.active_avatar_frame_id),
      active_avatar_effect_id: itemType === 'effect' ? itemId : (current.active_avatar_effect_id ?? activePreference.active_avatar_effect_id),
      updated_at: current.updated_at ?? activePreference.updated_at ?? null,
    }));
    scrollToPreview();
  }, [activePreference, scrollToPreview]);

  const clearAppearancePreview = useCallback(() => {
    setDraftPreference(activePreference);
  }, [activePreference]);

  const handlePreviewBadge = useCallback((badgeId: string) => {
    setPreviewBadgeIds((current) => {
      const base = current?.length ? current : activeBadgePreference.featured_badge_ids;
      const withoutBadge = base.filter((id) => id !== badgeId);
      const next = [...withoutBadge, badgeId].slice(-FEATURED_PROFILE_BADGE_LIMIT);
      return next;
    });
    scrollToPreview();
  }, [activeBadgePreference.featured_badge_ids, scrollToPreview]);

  const clearBadgePreview = useCallback(() => {
    setPreviewBadgeIds(null);
  }, []);

  const handleRemoveFeaturedBadge = useCallback(async (badgeId: string) => {
    const result = await saveFeaturedBadges(activeBadgePreference.featured_badge_ids.filter((id) => id !== badgeId));
    if (!result.ok) {
      Alert.alert('Could not update badges', result.error ?? 'Please try again.');
      return;
    }
    setPreviewBadgeIds(null);
    Alert.alert('Badges updated', 'Your featured badge row is now live on your profile.');
  }, [activeBadgePreference.featured_badge_ids, saveFeaturedBadges]);

  const handleBadgePurchase = useCallback(async (badgeId: string) => {
    const started = await initBadgeCheckout({ badgeId });
    if (!started.ok) {
      Alert.alert('Checkout failed', started.error ?? 'Could not start badge checkout.');
      return;
    }

    const completed = await confirmBadgeCheckout();
    if (!completed.ok || !completed.badgeId) {
      if (completed.error !== 'cancelled') {
        Alert.alert('Payment failed', completed.error ?? 'Payment did not complete.');
      }
      return;
    }

    const unlocked = await waitForUnlock(completed.badgeId);
    resetBadgeCheckout();
    if (!unlocked) {
      Alert.alert('Payment received', 'Your badge should appear shortly. Pull to refresh if it does not show up right away.');
      return;
    }

    const alreadyFeatured = activeBadgePreference.featured_badge_ids.includes(completed.badgeId);
    if (alreadyFeatured) {
      Alert.alert('Badge unlocked', 'Your new collectible badge is now visible on your profile.');
      return;
    }

    if (activeBadgePreference.featured_badge_ids.length >= FEATURED_PROFILE_BADGE_LIMIT) {
      Alert.alert('Badge unlocked', `You now own the badge. Remove one featured badge first if you want to show this one. You can feature up to ${FEATURED_PROFILE_BADGE_LIMIT}.`);
      return;
    }

    const saved = await saveFeaturedBadges([...activeBadgePreference.featured_badge_ids, completed.badgeId]);
    if (!saved.ok) {
      Alert.alert('Badge unlocked', 'The badge was purchased, but could not be auto-featured. You already own it in the list below.');
      return;
    }

    Alert.alert('Badge unlocked', 'Your new collectible badge is now featured on your public profile.');
  }, [activeBadgePreference.featured_badge_ids, confirmBadgeCheckout, initBadgeCheckout, resetBadgeCheckout, saveFeaturedBadges, waitForUnlock]);

  const handleBadgePress = useCallback(async (badge: ProfileBadgeDefinition) => {
    const owned = ownedBadgeIds.has(badge.id);
    const featured = activeBadgePreference.featured_badge_ids.includes(badge.id);

    if (!owned) {
      await handleBadgePurchase(badge.id);
      return;
    }

    if (featured) {
      Alert.alert('Already featured', 'This badge is already visible on your profile. Remove it from the featured row first if you want to rotate it out.');
      return;
    }

    if (activeBadgePreference.featured_badge_ids.length >= FEATURED_PROFILE_BADGE_LIMIT) {
      Alert.alert('Featured row full', `Remove one of your current badges first. You can feature up to ${FEATURED_PROFILE_BADGE_LIMIT} at a time.`);
      return;
    }

    const saved = await saveFeaturedBadges([...activeBadgePreference.featured_badge_ids, badge.id]);
    if (!saved.ok) {
      Alert.alert('Could not feature badge', saved.error ?? 'Please try again.');
      return;
    }

    setPreviewBadgeIds(null);
    Alert.alert('Badge featured', 'Your badge row is now updated anywhere people open your profile.');
  }, [activeBadgePreference.featured_badge_ids, handleBadgePurchase, ownedBadgeIds, saveFeaturedBadges]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView ref={scrollViewRef} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.headerBtn} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Profile appearance</Text>
            <Text style={styles.headerSubtitle}>Cosmetics and collectibles that stay organized and visitor-visible</Text>
          </View>
          <TouchableOpacity style={styles.headerBtn} onPress={handleRefresh}>
            <Ionicons name="refresh-outline" size={20} color="#fff" />
          </TouchableOpacity>
        </View>

        <View style={styles.previewCard} onLayout={(event) => setPreviewCardY(event.nativeEvent.layout.y)}>
          <ProfileBannerMedia
            imageUrl={profile?.header_image_url}
            videoUrl={profile?.header_video_url}
            height={132}
            startColor={previewAppearance.theme.bannerStartColor}
            endColor={previewAppearance.theme.bannerEndColor}
            emptyHint="Banner photo or short loop video"
          />
          <View style={styles.previewAvatarRow}>
            <ProfileAvatarDecoration
              appearance={previewAppearance}
              avatarUrl={profile?.avatar_url}
              size={72}
              fallbackIconSize={32}
            />
            <View style={{ flex: 1 }}>
              <Text style={[styles.previewName, { color: previewAppearance.theme.textColor }]} numberOfLines={1}>
                @{profile?.username ?? 'pilot'}
              </Text>
              <Text style={[styles.previewMeta, { color: previewAppearance.theme.mutedTextColor }]}>{hasAppearancePreview ? 'Previewing now — apply below to make it live.' : 'Current live profile look.'}</Text>
              <View style={styles.livePillsRow}>
                <View style={[styles.livePill, { borderColor: `${previewAppearance.theme.accentColor}66` }]}>
                  <Text style={[styles.livePillText, { color: previewAppearance.theme.accentColor }]}>{previewAppearance.theme.name}</Text>
                </View>
                <View style={[styles.livePill, { borderColor: `${previewAppearance.frame.primaryColor}66` }]}>
                  <Text style={[styles.livePillText, { color: previewAppearance.frame.primaryColor }]}>{previewAppearance.frame.name}</Text>
                </View>
                <View style={[styles.livePill, { borderColor: `${previewAppearance.effect.accentColor}66` }]}>
                  <Text style={[styles.livePillText, { color: previewAppearance.effect.accentColor }]}>{previewAppearance.effect.name}</Text>
                </View>
              </View>
              <View style={styles.previewBadgesWrap}>
                <ProfileBadgeRow
                  badges={previewBadges}
                  accentColor={previewAppearance.theme.accentColor}
                  borderColor={previewAppearance.theme.borderColor}
                  textColor={previewAppearance.theme.textColor}
                  mutedTextColor={previewAppearance.theme.mutedTextColor}
                  emptyText="No featured badges yet"
                  compact
                />
                {hasAppearancePreview ? (
                  <View style={styles.previewStatusRow}>
                    <Text style={styles.previewStatusText}>Previewing appearance only — tap Apply on any owned item to make this look live.</Text>
                    <TouchableOpacity onPress={clearAppearancePreview} activeOpacity={0.8} style={styles.previewClearBtn}>
                      <Text style={styles.previewClearBtnText}>Reset</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
                {previewBadgeIds?.length ? (
                  <View style={styles.previewStatusRow}>
                    <Text style={styles.previewStatusText}>Previewing badge row only — nothing saves until you unlock or feature it.</Text>
                    <TouchableOpacity onPress={clearBadgePreview} activeOpacity={0.8} style={styles.previewClearBtn}>
                      <Text style={styles.previewClearBtnText}>Clear</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
            </View>
          </View>
          <View style={styles.helperCallout}>
            <Ionicons name="sparkles-outline" size={16} color={previewAppearance.theme.accentColor} />
            <Text style={styles.helperCalloutText}>
              Preview updates here instantly. Apply or feature below when you want to make the look live.
            </Text>
          </View>
        </View>

        {(loadingAppearance || loadingBadges) ? <ActivityIndicator color={previewAppearance.theme.accentColor} style={{ marginVertical: 18 }} /> : null}

        <View style={styles.sectionBlock}>
          <StudioSectionHeader
            title="Themes"
            subtitle="Changes banner color treatment, stat surfaces, accents, and tab highlights across profile screens."
            expanded={expandedSection === 'themes'}
            onPress={() => toggleSection('themes')}
          />
          {expandedSection === 'themes' ? (
            <View style={styles.sectionBody}>
              {PROFILE_THEMES.map((item) => (
                <StudioItemRow
                  key={item.id}
                  item={item}
                  accentColor={item.accentColor}
                  owned={ownedKeys.has(`theme:${item.id}`)}
                  active={activePreference.active_theme_id === item.id}
                  selected={draftPreference.active_theme_id === item.id}
                  busy={appearanceBusy}
                  onPreview={() => handlePreviewAppearance('theme', item.id)}
                  onPress={() => void handleItemPress('theme', item)}
                />
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.sectionBlock}>
          <StudioSectionHeader
            title="Avatar frames"
            subtitle="Adds a polished ring around your profile photo without changing the tap target underneath it."
            expanded={expandedSection === 'frames'}
            onPress={() => toggleSection('frames')}
          />
          {expandedSection === 'frames' ? (
            <View style={styles.sectionBody}>
              {AVATAR_FRAMES.map((item) => (
                <StudioItemRow
                  key={item.id}
                  item={item}
                  accentColor={item.primaryColor}
                  owned={ownedKeys.has(`frame:${item.id}`)}
                  active={activePreference.active_avatar_frame_id === item.id}
                  selected={draftPreference.active_avatar_frame_id === item.id}
                  busy={appearanceBusy}
                  onPreview={() => handlePreviewAppearance('frame', item.id)}
                  onPress={() => void handleItemPress('frame', item)}
                />
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.sectionBlock}>
          <StudioSectionHeader
            title="Avatar effects"
            subtitle="Keeps motion restrained and readable so the profile still feels premium, not noisy."
            expanded={expandedSection === 'effects'}
            onPress={() => toggleSection('effects')}
          />
          {expandedSection === 'effects' ? (
            <View style={styles.sectionBody}>
              {AVATAR_EFFECTS.map((item) => (
                <StudioItemRow
                  key={item.id}
                  item={item}
                  accentColor={item.accentColor}
                  owned={ownedKeys.has(`effect:${item.id}`)}
                  active={activePreference.active_avatar_effect_id === item.id}
                  selected={draftPreference.active_avatar_effect_id === item.id}
                  busy={appearanceBusy}
                  onPreview={() => handlePreviewAppearance('effect', item.id)}
                  onPress={() => void handleItemPress('effect', item)}
                />
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.sectionBlock}>
          <StudioSectionHeader
            title="Collectible badges"
            subtitle="Feature up to three badges under your bio so visitors immediately see your profile flex without cluttering the screen."
            expanded={expandedSection === 'badges'}
            onPress={() => toggleSection('badges')}
          />
          {expandedSection === 'badges' ? (
            <View style={styles.sectionBody}>
              <View style={styles.badgeFeatureCard}>
                <View style={styles.badgeFeatureHeader}>
                  <View>
                    <Text style={styles.badgeFeatureTitle}>Featured on profile</Text>
                    <Text style={styles.badgeFeatureSubtitle}>You can feature up to {FEATURED_PROFILE_BADGE_LIMIT} badges at once.</Text>
                  </View>
                  <View style={[styles.badgeCountPill, { borderColor: `${activeAppearance.theme.accentColor}55` }]}>
                    <Text style={[styles.badgeCountText, { color: previewAppearance.theme.accentColor }]}>{activeBadgePreference.featured_badge_ids.length}/{FEATURED_PROFILE_BADGE_LIMIT}</Text>
                  </View>
                </View>
                <ProfileBadgeRow
                  badges={featuredBadges}
                  accentColor={activeAppearance.theme.accentColor}
                  borderColor={activeAppearance.theme.borderColor}
                  textColor={activeAppearance.theme.textColor}
                  mutedTextColor={activeAppearance.theme.mutedTextColor}
                  emptyText="Unlock a badge below to start your featured row."
                  removable
                  onRemoveBadge={(badgeId) => void handleRemoveFeaturedBadge(badgeId)}
                />
              </View>

              {PROFILE_BADGES.map((badge) => (
                <BadgeStudioRow
                  key={badge.id}
                  badge={badge}
                  owned={ownedBadgeIds.has(badge.id)}
                  featured={activeBadgePreference.featured_badge_ids.includes(badge.id)}
                  previewed={(previewBadgeIds?.length ? previewBadgeIds : activeBadgePreference.featured_badge_ids).includes(badge.id)}
                  busy={badgeBusy}
                  onPreview={() => handlePreviewBadge(badge.id)}
                  onPress={() => void handleBadgePress(badge)}
                />
              ))}
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#090914',
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#151629',
    borderWidth: 1,
    borderColor: '#242741',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
  },
  headerSubtitle: {
    color: '#8b92b3',
    fontSize: 12,
    marginTop: 2,
  },
  previewCard: {
    backgroundColor: '#111223',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#262946',
    overflow: 'hidden',
    marginBottom: 18,
  },
  previewAvatarRow: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 14,
    alignItems: 'center',
  },
  previewName: {
    fontSize: 18,
    fontWeight: '800',
  },
  previewMeta: {
    fontSize: 11,
    marginTop: 2,
  },
  livePillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  livePill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  livePillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  previewBadgesWrap: {
    marginTop: 10,
  },
  helperCallout: {
    flexDirection: 'row',
    gap: 8,
    borderTopWidth: 1,
    borderColor: '#262946',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  helperCalloutText: {
    flex: 1,
    color: '#9ea6c7',
    fontSize: 11,
    lineHeight: 16,
  },
  sectionBlock: {
    marginBottom: 10,
  },
  sectionHeaderButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#101224',
    borderWidth: 1,
    borderColor: '#252944',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  sectionBody: {
    marginTop: 10,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 4,
  },
  sectionHint: {
    color: '#8e96b8',
    fontSize: 12,
    lineHeight: 18,
  },
  itemCard: {
    backgroundColor: '#111223',
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
  },
  itemHeaderRow: {
    flexDirection: 'row',
    gap: 12,
  },
  itemSwatch: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    marginTop: 2,
  },
  badgeIconSwatch: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 4,
  },
  itemTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
  },
  badgePill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  itemDescription: {
    color: '#9aa2c5',
    fontSize: 12,
    lineHeight: 18,
  },
  badgeLimitedText: {
    marginTop: 6,
    fontSize: 11,
    fontWeight: '700',
  },
  itemFooterRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  itemPrice: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  itemButton: {
    minWidth: 110,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  itemButtonOwned: {
    backgroundColor: '#182031',
    borderWidth: 1,
    borderColor: '#2b3650',
  },
  itemButtonActive: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#3b4a74',
  },
  itemButtonText: {
    color: '#071016',
    fontSize: 12,
    fontWeight: '800',
  },
  badgeFeatureCard: {
    marginTop: 4,
    marginBottom: 10,
    backgroundColor: '#121426',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#252944',
    padding: 14,
    gap: 12,
  },
  badgeFeatureHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'center',
  },
  badgeFeatureTitle: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 15,
  },
  badgeFeatureSubtitle: {
    color: '#9aa2c5',
    fontSize: 12,
    marginTop: 4,
  },
  badgeCountPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  badgeCountText: {
    fontSize: 11,
    fontWeight: '800',
  },
  badgeMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 6,
  },
  previewHintText: {
    color: '#7f86a8',
    fontSize: 11,
  },
  badgeActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  previewButton: {
    minWidth: 88,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
  },
  previewButtonText: {
    fontSize: 12,
    fontWeight: '800',
  },
  previewStatusRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  previewStatusText: {
    flex: 1,
    color: '#93a0c7',
    fontSize: 11,
    lineHeight: 16,
  },
  previewClearBtn: {
    borderWidth: 1,
    borderColor: '#374261',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  previewClearBtnText: {
    color: '#d8def4',
    fontSize: 11,
    fontWeight: '700',
  },
});
