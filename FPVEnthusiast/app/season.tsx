import React, { useMemo } from 'react';
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
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/context/AuthContext';
import { useSeasonPass } from '../src/hooks/useSeasonPass';
import { useSeasonPassCheckout } from '../src/hooks/useSeasonPassCheckout';
import {
  describeSeasonReward,
  formatSeasonPassPrice,
  formatSeasonRewardLabel,
  getSeasonLevelProgress,
  seasonRewardAccent,
  type SeasonRewardTrackItem,
} from '../src/constants/seasonPass';
import { PropsToast, usePropsToast } from '../src/components/PropsToast';

function RewardCard({
  item,
  claimed,
  premiumUnlocked,
  currentLevel,
  busy,
  onClaim,
}: {
  item: SeasonRewardTrackItem;
  claimed: boolean;
  premiumUnlocked: boolean;
  currentLevel: number;
  busy: boolean;
  onClaim: () => void;
}) {
  const accent = seasonRewardAccent(item);
  const lockedByLevel = currentLevel < item.level_number;
  const lockedByPass = item.track_type === 'premium' && !premiumUnlocked;
  const disabled = busy || claimed || lockedByLevel || lockedByPass;
  const label = claimed
    ? 'Claimed'
    : lockedByLevel
      ? `Reach L${item.level_number}`
      : lockedByPass
        ? 'Premium only'
        : busy
          ? 'Claiming...'
          : 'Claim';

  return (
    <View style={[styles.rewardCard, { borderColor: `${accent}66`, backgroundColor: `${accent}12` }]}>
      <View style={[styles.rewardGlow, { backgroundColor: `${accent}14` }]} />
      <View style={styles.rewardHeaderRow}>
        <View style={[styles.rewardBadge, { backgroundColor: `${accent}20`, borderColor: `${accent}50` }]}>
          <Text style={[styles.rewardBadgeText, { color: accent }]}>{item.track_type === 'premium' ? 'Premium' : 'Free'}</Text>
        </View>
        <Text style={styles.rewardLevel}>Level {item.level_number}</Text>
      </View>
      <Text style={styles.rewardTitle}>{formatSeasonRewardLabel(item)}</Text>
      <Text style={styles.rewardSubtitle}>{describeSeasonReward(item)}</Text>
      <TouchableOpacity
        activeOpacity={0.88}
        disabled={disabled}
        onPress={onClaim}
        style={[
          styles.claimButton,
          {
            backgroundColor: claimed ? '#1f7a45' : disabled ? '#23283c' : accent,
            borderColor: claimed ? '#2bb566' : `${accent}80`,
            opacity: disabled && !claimed ? 0.72 : 1,
          },
        ]}
      >
        <Text style={styles.claimButtonText}>{label}</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function SeasonScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const propsToast = usePropsToast();
  const {
    season,
    progress,
    freeRewards,
    premiumRewards,
    claimedRewardIds,
    loading,
    claimingRewardId,
    unlockingPass,
    claimableCount,
    claimReward,
    unlockSeasonPassForTesting,
    refreshSeasonPass,
    waitForPremiumUnlock,
  } = useSeasonPass(user?.id ?? null);
  const {
    initCheckout: initPassCheckout,
    confirmCheckout: confirmPassCheckout,
    resetCheckout: resetPassCheckout,
    checkoutState,
  } = useSeasonPassCheckout();

  const seasonProgress = useMemo(() => {
    return getSeasonLevelProgress(progress.xp_total ?? 0, season?.xp_per_level ?? 100);
  }, [progress.xp_total, season?.xp_per_level]);

  const handleClaim = async (item: SeasonRewardTrackItem) => {
    const result = await claimReward(item.id);
    if (!result.ok) {
      Alert.alert('Claim failed', result.error);
      return;
    }

    const reward = (result.data as any)?.reward;
    if (reward?.reward_type === 'props' && reward?.props_awarded) {
      propsToast.show(`+${reward.props_awarded} Props claimed`, { celebrate: true });
    } else {
      propsToast.show(`${formatSeasonRewardLabel(item)} claimed`, { celebrate: item.track_type === 'premium' });
    }
  };

  const handleUnlockTesting = async () => {
    const result = await unlockSeasonPassForTesting();
    if (!result.ok) {
      Alert.alert('Could not unlock premium', result.error);
      return;
    }
    propsToast.show('Premium rewards unlocked for testing', { celebrate: true });
  };

  const purchaseBusy = unlockingPass || checkoutState.status === 'loading' || checkoutState.status === 'processing';

  const handleBuySeasonPass = async () => {
    if (!season) return;

    const started = await initPassCheckout({ seasonId: season.id });
    if (!started.ok) {
      Alert.alert('Checkout failed', started.error ?? 'Could not start season pass checkout.');
      return;
    }

    const completed = await confirmPassCheckout();
    if (!completed.ok) {
      if (completed.error !== 'cancelled') {
        Alert.alert('Payment failed', completed.error ?? 'Payment did not complete.');
      }
      return;
    }

    const unlocked = await waitForPremiumUnlock();
    resetPassCheckout();
    await refreshSeasonPass();

    if (!unlocked) {
      Alert.alert('Payment received', 'Your season pass should unlock shortly. Pull to refresh if it does not appear right away.');
      return;
    }

    propsToast.show('Season pass unlocked — premium rewards are ready to claim', { celebrate: true });
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color="#8b63ff" />
          <Text style={styles.loadingText}>Loading season pass…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!season) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.emptyWrap}>
          <Ionicons name="sparkles-outline" size={28} color="#8b63ff" />
          <Text style={styles.emptyTitle}>Season content is not ready yet</Text>
          <Text style={styles.emptySubtitle}>The backend foundation is in place, but no active season was found.</Text>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backButtonText}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.topRow}>
          <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={20} color="#f4f7ff" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconButton} onPress={() => router.replace('/season')}>
            <Ionicons name="refresh" size={18} color="#f4f7ff" />
          </TouchableOpacity>
        </View>

        <LinearGradient
          colors={['#211438', '#0d1020', '#090b15']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.heroCard}
        >
          <View style={styles.heroPillRow}>
            <View style={styles.heroPill}>
              <Text style={styles.heroPillText}>Season Pass Foundation</Text>
            </View>
            <View style={[styles.heroPill, { backgroundColor: '#15233d' }]}>
              <Text style={styles.heroPillText}>{season.status.toUpperCase()}</Text>
            </View>
          </View>
          <Text style={styles.heroTitle}>{season.name}</Text>
          <Text style={styles.heroSubtitle}>
            {season.description || 'Seasonal XP, level rewards, and premium track progression are now driven from backend config.'}
          </Text>

          <View style={styles.progressShell}>
            <View style={styles.progressHeaderRow}>
              <Text style={styles.progressTitle}>Level {progress.level_current}</Text>
              <Text style={styles.progressMeta}>{progress.xp_total} XP total</Text>
            </View>
            <View style={styles.progressBarTrack}>
              <View style={[styles.progressBarFill, { width: `${Math.max(6, Math.min(100, seasonProgress.progressRatio * 100))}%` }]} />
            </View>
            <Text style={styles.progressHint}>
              {progress.level_current >= season.max_level
                ? 'Max level reached for this season.'
                : `${seasonProgress.xpNeededForNextLevel} XP until level ${progress.level_current + 1}`}
            </Text>
          </View>

          <View style={styles.summaryGrid}>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Pass price</Text>
              <Text style={styles.summaryValue}>{formatSeasonPassPrice(season.pass_price_cents)}</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Claimable now</Text>
              <Text style={styles.summaryValue}>{claimableCount}</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Premium</Text>
              <Text style={styles.summaryValue}>{progress.premium_unlocked ? 'Unlocked' : 'Locked'}</Text>
            </View>
          </View>

          {progress.premium_unlocked ? (
            <View style={styles.premiumNotice}>
              <Ionicons name="checkmark-circle" size={16} color="#66e0a3" />
              <Text style={styles.premiumNoticeText}>
                {claimableCount > 0
                  ? `Premium unlocked — ${claimableCount} reward${claimableCount === 1 ? '' : 's'} ready to claim.`
                  : 'Premium unlocked — keep earning XP to reach your next reward.'}
              </Text>
            </View>
          ) : season.pass_enabled ? (
            <TouchableOpacity
              style={[styles.purchaseButton, purchaseBusy ? styles.purchaseButtonDisabled : null]}
              onPress={handleBuySeasonPass}
              disabled={purchaseBusy}
            >
              <Ionicons name="sparkles" size={18} color="#ffffff" />
              <View style={{ flex: 1 }}>
                <Text style={styles.purchaseButtonText}>
                  {purchaseBusy ? 'Opening checkout…' : `Unlock premium track • ${formatSeasonPassPrice(season.pass_price_cents)}`}
                </Text>
                <Text style={styles.purchaseButtonHint}>Claim premium rewards retroactively for every level you already earned.</Text>
              </View>
            </TouchableOpacity>
          ) : null}

          {__DEV__ ? (
            <TouchableOpacity
              style={[styles.testingButton, unlockingPass ? styles.testingButtonDisabled : null]}
              onPress={handleUnlockTesting}
              disabled={unlockingPass}
            >
              <Ionicons name="flask-outline" size={16} color="#f4f7ff" />
              <Text style={styles.testingButtonText}>{unlockingPass ? 'Unlocking…' : 'Unlock premium for testing'}</Text>
            </TouchableOpacity>
          ) : null}
        </LinearGradient>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Free Track</Text>
          <Text style={styles.sectionSubtitle}>Every user can level up and claim these rewards.</Text>
        </View>
        {freeRewards.map((item) => (
          <RewardCard
            key={item.id}
            item={item}
            claimed={claimedRewardIds.has(item.id)}
            premiumUnlocked={progress.premium_unlocked}
            currentLevel={progress.level_current}
            busy={claimingRewardId === item.id}
            onClaim={() => handleClaim(item)}
          />
        ))}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Premium Track</Text>
          <Text style={styles.sectionSubtitle}>Cosmetics, collectibles, and bigger props bundles for pass holders.</Text>
        </View>
        {premiumRewards.map((item) => (
          <RewardCard
            key={item.id}
            item={item}
            claimed={claimedRewardIds.has(item.id)}
            premiumUnlocked={progress.premium_unlocked}
            currentLevel={progress.level_current}
            busy={claimingRewardId === item.id}
            onClaim={() => handleClaim(item)}
          />
        ))}
      </ScrollView>
      <PropsToast toast={propsToast} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#070812',
  },
  content: {
    padding: 16,
    paddingBottom: 40,
    gap: 14,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#27304b',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111527',
  },
  heroCard: {
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: '#2a3350',
    overflow: 'hidden',
    gap: 14,
  },
  heroPillRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  heroPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#8b63ff22',
  },
  heroPillText: {
    color: '#efe7ff',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  heroTitle: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '900',
  },
  heroSubtitle: {
    color: '#c8cfec',
    fontSize: 14,
    lineHeight: 20,
  },
  progressShell: {
    backgroundColor: '#0d1120',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#26314f',
    padding: 14,
    gap: 10,
  },
  progressHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressTitle: {
    color: '#f4f7ff',
    fontSize: 18,
    fontWeight: '800',
  },
  progressMeta: {
    color: '#9dacdd',
    fontSize: 13,
    fontWeight: '700',
  },
  progressBarTrack: {
    height: 12,
    borderRadius: 999,
    backgroundColor: '#182038',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#8b63ff',
  },
  progressHint: {
    color: '#b1bcdf',
    fontSize: 13,
  },
  summaryGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  summaryCard: {
    flex: 1,
    borderRadius: 16,
    padding: 12,
    backgroundColor: '#12182c',
    borderWidth: 1,
    borderColor: '#2a3350',
    gap: 4,
  },
  summaryLabel: {
    color: '#8e9bc5',
    fontSize: 12,
    fontWeight: '700',
  },
  summaryValue: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '900',
  },
  purchaseButton: {
    marginTop: 2,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#8f73ff',
    backgroundColor: '#6f4cff',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  purchaseButtonDisabled: {
    opacity: 0.72,
  },
  purchaseButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '900',
  },
  purchaseButtonHint: {
    color: '#ebe6ff',
    fontSize: 12,
    marginTop: 2,
  },
  premiumNotice: {
    marginTop: 2,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2e7d59',
    backgroundColor: '#113324',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  premiumNoticeText: {
    color: '#d8ffe9',
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
  },
  testingButton: {
    marginTop: 2,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#5267a6',
    backgroundColor: '#1a2340',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  testingButtonDisabled: {
    opacity: 0.7,
  },
  testingButtonText: {
    color: '#f4f7ff',
    fontSize: 14,
    fontWeight: '800',
  },
  sectionHeader: {
    marginTop: 6,
    gap: 4,
  },
  sectionTitle: {
    color: '#f7f8ff',
    fontSize: 20,
    fontWeight: '900',
  },
  sectionSubtitle: {
    color: '#95a2cd',
    fontSize: 13,
    lineHeight: 18,
  },
  rewardCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    backgroundColor: '#121727',
    overflow: 'hidden',
    gap: 10,
  },
  rewardGlow: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.6,
  },
  rewardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rewardBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  rewardBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  rewardLevel: {
    color: '#b9c3e3',
    fontSize: 12,
    fontWeight: '700',
  },
  rewardTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '900',
  },
  rewardSubtitle: {
    color: '#bcc6e5',
    fontSize: 13,
    lineHeight: 18,
  },
  claimButton: {
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  claimButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: {
    color: '#c6cfef',
    fontSize: 15,
    fontWeight: '700',
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 10,
  },
  emptyTitle: {
    color: '#f5f7ff',
    fontSize: 20,
    fontWeight: '900',
    textAlign: 'center',
  },
  emptySubtitle: {
    color: '#9dacdd',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  backButton: {
    marginTop: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: '#1f2741',
    borderWidth: 1,
    borderColor: '#3a476c',
  },
  backButtonText: {
    color: '#ffffff',
    fontWeight: '800',
  },
});
