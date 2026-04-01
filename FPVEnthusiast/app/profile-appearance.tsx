import React, { useCallback } from 'react';
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
  type AvatarEffectDefinition,
  type AvatarFrameDefinition,
  type ProfileAppearanceItemType,
  type ProfileThemeDefinition,
} from '../src/constants/profileAppearance';
import { useProfileAppearanceCheckout } from '../src/hooks/useProfileAppearanceCheckout';
import { useProfileAppearanceStudio } from '../src/hooks/useProfileAppearance';
import ProfileAvatarDecoration from '../src/components/ProfileAvatarDecoration';
import ProfileBannerMedia from '../src/components/ProfileBannerMedia';

function StudioSectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionHint}>{subtitle}</Text>
    </View>
  );
}

type CatalogItem = ProfileThemeDefinition | AvatarFrameDefinition | AvatarEffectDefinition;

function StudioItemRow({
  item,
  accentColor,
  owned,
  active,
  busy,
  onPress,
}: {
  item: CatalogItem;
  accentColor: string;
  owned: boolean;
  active: boolean;
  busy: boolean;
  onPress: () => void;
}) {
  const isFree = item.priceCents === 0;
  const buttonLabel = active ? 'Active' : owned || isFree ? 'Use' : `Unlock ${formatUsd(item.priceCents)}`;
  return (
    <View style={[styles.itemCard, { borderColor: active ? accentColor : '#272a3f' }]}> 
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
        </View>
      </View>
      <View style={styles.itemFooterRow}>
        <Text style={styles.itemPrice}>{isFree ? 'Included' : formatUsd(item.priceCents)}</Text>
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

    const applied = await saveSelection(itemType, itemId);
    if (!applied.ok) {
      Alert.alert('Unlocked', 'The item was purchased, but could not be auto-applied. You already own it in the list below.');
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

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.headerBtn} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Profile appearance</Text>
            <Text style={styles.headerSubtitle}>Cosmetics that stay organized and visitor-visible</Text>
          </View>
          <TouchableOpacity style={styles.headerBtn} onPress={() => void refreshAppearance()}>
            <Ionicons name="refresh-outline" size={20} color="#fff" />
          </TouchableOpacity>
        </View>

        <View style={styles.previewCard}>
          <ProfileBannerMedia
            imageUrl={profile?.header_image_url}
            videoUrl={profile?.header_video_url}
            height={170}
            startColor={activeAppearance.theme.bannerStartColor}
            endColor={activeAppearance.theme.bannerEndColor}
            emptyHint="Banner photo or short loop video"
          />
          <View style={styles.previewAvatarRow}>
            <ProfileAvatarDecoration
              appearance={activeAppearance}
              avatarUrl={profile?.avatar_url}
              size={82}
              fallbackIconSize={32}
            />
            <View style={{ flex: 1 }}>
              <Text style={[styles.previewName, { color: activeAppearance.theme.textColor }]} numberOfLines={1}>
                @{profile?.username ?? 'pilot'}
              </Text>
              <Text style={[styles.previewMeta, { color: activeAppearance.theme.mutedTextColor }]}>
                Live for anyone visiting your profile.
              </Text>
              <View style={styles.livePillsRow}>
                <View style={[styles.livePill, { borderColor: `${activeAppearance.theme.accentColor}66` }]}>
                  <Text style={[styles.livePillText, { color: activeAppearance.theme.accentColor }]}>{activeAppearance.theme.name}</Text>
                </View>
                <View style={[styles.livePill, { borderColor: `${activeAppearance.frame.primaryColor}66` }]}>
                  <Text style={[styles.livePillText, { color: activeAppearance.frame.primaryColor }]}>{activeAppearance.frame.name}</Text>
                </View>
                <View style={[styles.livePill, { borderColor: `${activeAppearance.effect.accentColor}66` }]}>
                  <Text style={[styles.livePillText, { color: activeAppearance.effect.accentColor }]}>{activeAppearance.effect.name}</Text>
                </View>
              </View>
            </View>
          </View>
          <View style={styles.helperCallout}>
            <Ionicons name="sparkles-outline" size={16} color={activeAppearance.theme.accentColor} />
            <Text style={styles.helperCalloutText}>
              Avatar press behavior in the main profile tab stays untouched, so the hidden long-press Easter egg remains intact.
            </Text>
          </View>
        </View>

        <View style={styles.infoGrid}>
          <View style={styles.infoCard}>
            <Ionicons name="images-outline" size={18} color={activeAppearance.theme.accentColor} />
            <Text style={styles.infoTitle}>Header media</Text>
            <Text style={styles.infoText}>Upload either a banner image or a muted short loop video from your main profile screen.</Text>
          </View>
          <View style={styles.infoCard}>
            <Ionicons name="eye-outline" size={18} color={activeAppearance.theme.accentColor} />
            <Text style={styles.infoTitle}>Visitor-visible</Text>
            <Text style={styles.infoText}>Everything you activate here resolves from shared profile preferences, not local-only state.</Text>
          </View>
          <View style={styles.infoCard}>
            <Ionicons name="grid-outline" size={18} color={activeAppearance.theme.accentColor} />
            <Text style={styles.infoTitle}>Clean organization</Text>
            <Text style={styles.infoText}>Only one theme, one frame, and one motion effect can be active at a time.</Text>
          </View>
        </View>

        {loadingAppearance ? <ActivityIndicator color={activeAppearance.theme.accentColor} style={{ marginVertical: 18 }} /> : null}

        <StudioSectionHeader
          title="Themes"
          subtitle="Changes banner color treatment, stat surfaces, accents, and tab highlights across profile screens."
        />
        {PROFILE_THEMES.map((item) => (
          <StudioItemRow
            key={item.id}
            item={item}
            accentColor={item.accentColor}
            owned={ownedKeys.has(`theme:${item.id}`)}
            active={activePreference.active_theme_id === item.id}
            busy={savingAppearance || checkoutState.status === 'loading' || checkoutState.status === 'processing'}
            onPress={() => void handleItemPress('theme', item)}
          />
        ))}

        <StudioSectionHeader
          title="Avatar frames"
          subtitle="Adds a polished ring around your profile photo without changing the tap target underneath it."
        />
        {AVATAR_FRAMES.map((item) => (
          <StudioItemRow
            key={item.id}
            item={item}
            accentColor={item.primaryColor}
            owned={ownedKeys.has(`frame:${item.id}`)}
            active={activePreference.active_avatar_frame_id === item.id}
            busy={savingAppearance || checkoutState.status === 'loading' || checkoutState.status === 'processing'}
            onPress={() => void handleItemPress('frame', item)}
          />
        ))}

        <StudioSectionHeader
          title="Avatar effects"
          subtitle="Keeps motion restrained and readable so the profile still feels premium, not noisy."
        />
        {AVATAR_EFFECTS.map((item) => (
          <StudioItemRow
            key={item.id}
            item={item}
            accentColor={item.accentColor}
            owned={ownedKeys.has(`effect:${item.id}`)}
            active={activePreference.active_avatar_effect_id === item.id}
            busy={savingAppearance || checkoutState.status === 'loading' || checkoutState.status === 'processing'}
            onPress={() => void handleItemPress('effect', item)}
          />
        ))}

        <StudioSectionHeader
          title="Next useful upgrades"
          subtitle="Best follow-up additions once this rollout proves stable."
        />
        <View style={styles.ideaCard}>
          <Text style={styles.ideaTitle}>Good next profile cosmetics</Text>
          <Text style={styles.ideaBullet}>• collectible profile badges and founder tags</Text>
          <Text style={styles.ideaBullet}>• premium stat-card shells and tab icon skins</Text>
          <Text style={styles.ideaBullet}>• limited seasonal bundles with matching banner art</Text>
          <Text style={styles.ideaBullet}>• gated short video banner packs once moderation and compression rules are finalized</Text>
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
    gap: 14,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
    alignItems: 'center',
  },
  previewName: {
    fontSize: 20,
    fontWeight: '800',
  },
  previewMeta: {
    fontSize: 12,
    marginTop: 3,
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
  helperCallout: {
    flexDirection: 'row',
    gap: 8,
    borderTopWidth: 1,
    borderColor: '#262946',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  helperCalloutText: {
    flex: 1,
    color: '#9ea6c7',
    fontSize: 12,
    lineHeight: 18,
  },
  infoGrid: {
    gap: 10,
    marginBottom: 18,
  },
  infoCard: {
    backgroundColor: '#121426',
    borderWidth: 1,
    borderColor: '#252944',
    borderRadius: 16,
    padding: 14,
    gap: 6,
  },
  infoTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  infoText: {
    color: '#9aa2c5',
    fontSize: 12,
    lineHeight: 18,
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
  ideaCard: {
    marginTop: 4,
    backgroundColor: '#121426',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#252944',
    padding: 14,
    gap: 8,
  },
  ideaTitle: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 15,
  },
  ideaBullet: {
    color: '#a0a7c8',
    fontSize: 12,
    lineHeight: 18,
  },
});
