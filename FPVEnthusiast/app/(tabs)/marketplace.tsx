// app/(tabs)/marketplace.tsx
// FPV Marketplace — Phase 1
// Browse · Search · Filter · Watchlist · Trust landing · Create listing

import React, {
  useState, useCallback, useRef, useMemo, useEffect,
} from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput,
  ActivityIndicator, RefreshControl, StatusBar, Modal, ScrollView,
  Image, Animated, Easing, Pressable, Alert, KeyboardAvoidingView,
  Platform, Dimensions, PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../../src/context/AuthContext';
import { supabase } from '../../src/services/supabase';
import {
  useMarketplace,
  MarketplaceListing,
  MarketplaceFilters,
  CATEGORIES,
  CONDITIONS,
  CategorySlug,
  ConditionValue,
  CreateListingParams,
  useFeaturedListings,
  FeaturedListing,
  FEATURED_PROPS_COST,
  FEATURED_PAID_TIERS,
} from '../../src/hooks/useMarketplace';

const { width: SW } = Dimensions.get('window');
const CAROUSEL_H = 210;

// ─── Trust value-prop data ────────────────────────────────────────────────────
const TRUST_BULLETS = [
  {
    icon: '🔒',
    title: 'Payment held until delivery',
    body: 'Funds are secured at checkout and only released after you confirm receipt — protecting both sides of every transaction.',
  },
  {
    icon: '🎯',
    title: 'FPV pilots only',
    body: 'Every buyer knows what a 5" freestyle build is. No explaining specs, no wrong-category returns, no wasted DMs.',
  },
  {
    icon: '⭐',
    title: 'Reputation that travels with you',
    body: 'Your rating, badge, and community standing follow every listing. Buyers can see your full track record before they commit.',
  },
  {
    icon: '🚩',
    title: 'Real dispute mediation',
    body: 'If something goes wrong, it\'s handled here — not left to a third-party payment processor with no context on the deal.',
  },
  {
    icon: '📦',
    title: 'Shipping built right in',
    body: 'Generate labels, track packages, and trigger automatic fund release from inside the app. No copy-pasting addresses across tabs.',
  },
  {
    icon: '🛡️',
    title: 'Scam-resistant by design',
    body: 'Every payment is verified before an order is created. No fake screenshots, no "send first" pressure, no off-platform redirects.',
  },
];

// ─── Condition badge color ────────────────────────────────────────────────────
function conditionColor(c: string) {
  return CONDITIONS.find(x => x.value === c)?.color ?? '#888';
}
function conditionLabel(c: string) {
  return CONDITIONS.find(x => x.value === c)?.label ?? c;
}

// ─── Boost Modal ──────────────────────────────────────────────────────────────
// Lets the listing owner choose: spend props for 24 h  |  pay via Stripe
const BoostModal = ({
  visible,
  listingId,
  listingTitle,
  userProps,
  onClose,
  onSpendProps,
}: {
  visible: boolean;
  listingId: string;
  listingTitle: string;
  userProps: number;        // spendable wallet
  lifetimeProps: number;    // all-time earned (shown for context)
  onClose: () => void;
  onSpendProps: () => Promise<void>;
}) => {
  const [spending, setSpending] = useState(false);
  const canAfford = userProps >= FEATURED_PROPS_COST;

  const handleSpendProps = async () => {
    setSpending(true);
    await onSpendProps();
    setSpending(false);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.boostModal}>
        <View style={styles.boostHandle} />

        {/* Header */}
        <View style={styles.boostHeader}>
          <Text style={styles.boostTitle}>⚡ Boost Listing</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={24} color="#666" />
          </TouchableOpacity>
        </View>
        <Text style={styles.boostSubtitle} numberOfLines={2}>{listingTitle}</Text>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}>

          {/* ── Props option ─────────────────────────────────────────────── */}
          <View style={[styles.boostCard, !canAfford && styles.boostCardDim]}>
            <View style={styles.boostCardHeader}>
              <Text style={styles.boostCardIcon}>🌀</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.boostCardTitle}>24-Hour Feature</Text>
                <Text style={styles.boostCardMeta}>Spend Props · Community currency</Text>
              </View>
              <View style={styles.boostPropsPill}>
                <Text style={styles.boostPropsCost}>{FEATURED_PROPS_COST.toLocaleString()}</Text>
                <Text style={styles.boostPropsLabel}>props</Text>
              </View>
            </View>
            <Text style={styles.boostCardBody}>
              Your listing appears in the Featured carousel at the top of the marketplace for 24 hours,
              seen by every user who opens the tab.
            </Text>

            {/* Balance rows */}
            <View style={styles.boostBalanceRow}>
              <Text style={styles.boostBalanceLabel}>Spendable balance</Text>
              <Text style={[styles.boostBalanceVal, !canAfford && { color: '#ff4444' }]}>
                {userProps.toLocaleString()} props {!canAfford ? '(not enough)' : '✓'}
              </Text>
            </View>
            <View style={[styles.boostBalanceRow, { marginTop: 6 }]}>
              <Text style={styles.boostBalanceLabel}>All-time earned</Text>
              <Text style={[styles.boostBalanceVal, { color: '#ffcc00' }]}>
                {lifetimeProps.toLocaleString()} props
              </Text>
            </View>

            {!canAfford && (
              <View style={styles.boostHint}>
                <Ionicons name="information-circle-outline" size={14} color="#888" />
                <Text style={styles.boostHintTxt}>
                  Earn props by winning challenges, gaining followers, and engaging with the community.
                </Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.boostPropsBtn, (!canAfford || spending) && styles.boostBtnDisabled]}
              onPress={handleSpendProps}
              disabled={!canAfford || spending}
            >
              {spending
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.boostBtnTxt}>
                    {canAfford ? `Spend ${FEATURED_PROPS_COST.toLocaleString()} Props` : 'Not Enough Props'}
                  </Text>
              }
            </TouchableOpacity>
          </View>

          {/* ── Paid tiers ────────────────────────────────────────────────── */}
          <Text style={styles.boostSectionLabel}>Or pay to feature</Text>
          {FEATURED_PAID_TIERS.map(tier => (
            <TouchableOpacity
              key={tier.hours}
              style={styles.boostPaidRow}
              onPress={() =>
                Alert.alert(
                  'Paid Feature Coming Soon',
                  `Paid featured slots ($${tier.price_usd} for ${tier.label}) will be available once Stripe is connected. Check back soon!`
                )
              }
              activeOpacity={0.8}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.boostPaidLabel}>{tier.label}</Text>
                <Text style={styles.boostPaidMeta}>Guaranteed placement · Stripe checkout</Text>
              </View>
              <Text style={styles.boostPaidPrice}>${tier.price_usd}</Text>
              <Ionicons name="chevron-forward" size={16} color="#444" style={{ marginLeft: 8 }} />
            </TouchableOpacity>
          ))}

          {/* Explainer */}
          <View style={styles.boostExplainer}>
            <Text style={styles.boostExplainerTitle}>How Featured works</Text>
            <Text style={styles.boostExplainerBody}>
              Featured listings appear in the auto-scrolling carousel at the very top of the marketplace,
              before all search results and category filters. They include a golden ⭐ badge visible to
              every buyer. Props-funded slots last exactly 24 hours; paid slots run for the purchased
              duration. When your window expires, the listing returns to normal ranking automatically.
            </Text>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
};

// ─── Featured Carousel ────────────────────────────────────────────────────────
const FeaturedCarousel = ({
  items,
  loading,
  currentUserId,
  onItemPress,
  onBoostPress,
}: {
  items: FeaturedListing[];
  loading: boolean;
  currentUserId?: string;
  onItemPress: (item: FeaturedListing) => void;
  onBoostPress: () => void;
}) => {
  const scrollRef    = useRef<ScrollView>(null);
  const autoTimer    = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentIndex = useRef(0);
  const itemW        = SW - 32; // full-width card with 16 px side margins

  // ── Auto-scroll every 3.5 s ──────────────────────────────────────────────
  useEffect(() => {
    if (items.length < 2) return;
    autoTimer.current = setInterval(() => {
      currentIndex.current = (currentIndex.current + 1) % items.length;
      scrollRef.current?.scrollTo({ x: currentIndex.current * (itemW + 12), animated: true });
    }, 3500);
    return () => { if (autoTimer.current) clearInterval(autoTimer.current); };
  }, [items.length, itemW]);

  // ── Pause auto on user touch ──────────────────────────────────────────────
  const pauseAuto = () => {
    if (autoTimer.current) clearInterval(autoTimer.current);
    // resume after 6 s of no interaction
    setTimeout(() => {
      if (items.length < 2) return;
      autoTimer.current = setInterval(() => {
        currentIndex.current = (currentIndex.current + 1) % items.length;
        scrollRef.current?.scrollTo({ x: currentIndex.current * (itemW + 12), animated: true });
      }, 3500);
    }, 6000);
  };

  // ── Entry animation ───────────────────────────────────────────────────────
  const entryOpacity = useRef(new Animated.Value(0)).current;
  const entryTransY  = useRef(new Animated.Value(-18)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(entryOpacity, { toValue: 1, duration: 350, useNativeDriver: true }),
      Animated.spring(entryTransY,  { toValue: 0, friction: 8, tension: 70, useNativeDriver: true }),
    ]).start();
  }, []);

  if (loading) {
    return (
      <View style={styles.featuredShimmerWrap}>
        <View style={styles.featuredShimmerLabel} />
        <View style={styles.featuredShimmerCard} />
      </View>
    );
  }

  return (
    <Animated.View style={{ opacity: entryOpacity, transform: [{ translateY: entryTransY }] }}>
      {/* Section header */}
      <View style={styles.featuredHeader}>
        <View style={styles.featuredHeaderLeft}>
          <Text style={styles.featuredHeaderIcon}>⭐</Text>
          <Text style={styles.featuredHeaderTitle}>Featured</Text>
          <View style={styles.featuredLiveDot} />
        </View>
        <TouchableOpacity style={styles.featuredBoostBtn} onPress={onBoostPress} activeOpacity={0.8}>
          <Ionicons name="flash" size={13} color="#ffcc00" />
          <Text style={styles.featuredBoostTxt}>Boost your listing</Text>
        </TouchableOpacity>
      </View>

      {items.length === 0 ? (
        /* Empty state — invite first boost */
        <TouchableOpacity style={styles.featuredEmptyCard} onPress={onBoostPress} activeOpacity={0.85}>
          <Text style={styles.featuredEmptyIcon}>🚀</Text>
          <Text style={styles.featuredEmptyTitle}>Be the first featured listing</Text>
          <Text style={styles.featuredEmptyBody}>
            Spend props or pay to pin your listing here for every buyer to see.
          </Text>
          <View style={styles.featuredEmptyBtn}>
            <Ionicons name="flash" size={14} color="#ffcc00" />
            <Text style={styles.featuredEmptyBtnTxt}>Boost a listing</Text>
          </View>
        </TouchableOpacity>
      ) : (
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled={false}
          decelerationRate="fast"
          snapToInterval={itemW + 12}
          snapToAlignment="start"
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 12, paddingBottom: 4 }}
          onScrollBeginDrag={pauseAuto}
        >
          {items.map((item, idx) => {
            const image = item.listing_images?.find(i => i.is_primary) ?? item.listing_images?.[0];
            const isOwn = item.seller_id === currentUserId;
            const remaining = item.featured_until
              ? Math.max(0, Math.ceil((new Date(item.featured_until).getTime() - Date.now()) / 3_600_000))
              : 0;

            return (
              <TouchableOpacity
                key={item.id}
                style={[styles.featuredCard, { width: itemW }]}
                onPress={() => onItemPress(item)}
                activeOpacity={0.9}
              >
                {/* Background image */}
                {image ? (
                  <Image source={{ uri: image.url }} style={styles.featuredCardImg} resizeMode="cover" />
                ) : (
                  <View style={[styles.featuredCardImg, styles.featuredCardImgPlaceholder]}>
                    <Text style={{ fontSize: 48 }}>
                      {CATEGORIES.find(c => c.slug === item.category)?.icon ?? '📦'}
                    </Text>
                  </View>
                )}

                {/* Dark gradient overlay */}
                <View style={styles.featuredGradient} />

                {/* Top badges */}
                <View style={styles.featuredTopRow}>
                  <View style={styles.featuredBadge}>
                    <Text style={styles.featuredBadgeTxt}>⭐ FEATURED</Text>
                  </View>
                  {item.featured_type === 'props' && (
                    <View style={styles.featuredPropsBadge}>
                      <Text style={styles.featuredPropsBadgeTxt}>🌀 Props</Text>
                    </View>
                  )}
                  {isOwn && (
                    <View style={styles.featuredYoursBadge}>
                      <Text style={styles.featuredYoursBadgeTxt}>Your listing</Text>
                    </View>
                  )}
                </View>

                {/* Bottom info */}
                <View style={styles.featuredCardFooter}>
                  <Text style={styles.featuredCardTitle} numberOfLines={2}>{item.title}</Text>
                  <View style={styles.featuredCardPriceRow}>
                    <Text style={styles.featuredCardPrice}>
                      {item.listing_type === 'auction' && item.current_bid
                        ? `$${item.current_bid.toFixed(2)} bid`
                        : `$${item.price.toFixed(2)}`}
                    </Text>
                    {item.seller?.username && (
                      <Text style={styles.featuredCardSeller}>
                        {(item.seller.verification_tier ?? 0) >= 3 ? '✅ ' : ''}
                        {item.seller.username}
                      </Text>
                    )}
                  </View>
                  <Text style={styles.featuredTimeLeft}>
                    ⏱ {remaining}h remaining
                  </Text>
                </View>

                {/* Dot indicators */}
                {items.length > 1 && (
                  <View style={styles.featuredDots}>
                    {items.map((_, di) => (
                      <View key={di} style={[styles.featuredDot, di === idx % items.length && styles.featuredDotActive]} />
                    ))}
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </Animated.View>
  );
};

// ─── Animated Empty State ─────────────────────────────────────────────────────
const EmptyState = ({
  selectedCat,
  searchText,
  onCreatePress,
}: {
  selectedCat: CategorySlug | null;
  searchText: string;
  onCreatePress: () => void;
}) => {
  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(24)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 420, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, friction: 8, tension: 60, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View style={[styles.emptyWrap, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
      <Text style={styles.emptyIcon}>🛸</Text>
      <Text style={styles.emptyTitle}>No listings yet</Text>
      <Text style={styles.emptyBody}>
        {selectedCat || searchText
          ? 'Try clearing your filters or searching something else.'
          : 'Be the first to list your gear. The community is ready to buy.'}
      </Text>
      {!selectedCat && !searchText && (
        <TouchableOpacity style={styles.emptyBtn} onPress={onCreatePress}>
          <Text style={styles.emptyBtnTxt}>List something now</Text>
        </TouchableOpacity>
      )}
    </Animated.View>
  );
};

// ─── Listing card ─────────────────────────────────────────────────────────────
const ListingCard = React.memo(({
  item,
  index,
  onPress,
  onWatch,
  isOwner,
  onArchive,
  onDelete,
}: {
  item: MarketplaceListing;
  index: number;
  onPress: () => void;
  onWatch: () => void;
  isOwner?: boolean;
  onArchive?: () => void;
  onDelete?: () => void;
}) => {
  const image = item.listing_images?.find(i => i.is_primary) ?? item.listing_images?.[0];
  const displayPrice = item.listing_type === 'auction' && item.current_bid
    ? item.current_bid
    : item.price;
  const priceLabel = item.listing_type === 'auction'
    ? (item.current_bid ? `$${displayPrice.toFixed(2)} bid` : `$${item.price.toFixed(2)} start`)
    : `$${item.price.toFixed(2)}`;
  const cat = CATEGORIES.find(c => c.slug === item.category);

  // ── Staggered slide-up entry animation ────────────────────────────────────
  const cardOpacity    = useRef(new Animated.Value(0)).current;
  const cardTranslateY = useRef(new Animated.Value(28)).current;
  const cardScale      = useRef(new Animated.Value(0.94)).current;

  useEffect(() => {
    const delay = Math.min(index, 8) * 60; // cap stagger at 8 cards (480ms max)
    Animated.parallel([
      Animated.timing(cardOpacity, {
        toValue: 1, duration: 260, delay, useNativeDriver: true,
      }),
      Animated.spring(cardTranslateY, {
        toValue: 0, friction: 8, tension: 65, delay, useNativeDriver: true,
      }),
      Animated.spring(cardScale, {
        toValue: 1, friction: 7, tension: 70, delay, useNativeDriver: true,
      }),
    ]).start();
  }, []);

  // ── Swipe-to-reveal (owner: archive / delete) ──────────────────────────────
  const swipeX = useRef(new Animated.Value(0)).current;
  const SWIPE_THRESHOLD = -44;
  const SWIPE_OPEN      = -90;

  const panResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_evt, g) =>
      isOwner === true &&
      Math.abs(g.dx) > Math.abs(g.dy) &&
      Math.abs(g.dx) > 8,
    onPanResponderMove: (_evt, g) => {
      if (g.dx < 0) swipeX.setValue(Math.max(g.dx, SWIPE_OPEN));
    },
    onPanResponderRelease: (_evt, g) => {
      if (g.dx < SWIPE_THRESHOLD) {
        Animated.spring(swipeX, { toValue: SWIPE_OPEN, useNativeDriver: true, friction: 8, tension: 70 }).start();
      } else {
        Animated.spring(swipeX, { toValue: 0, useNativeDriver: true, friction: 8, tension: 70 }).start();
      }
    },
  })).current;

  const closeSwipe = () =>
    Animated.spring(swipeX, { toValue: 0, useNativeDriver: true, friction: 8 }).start();

  return (
    <Animated.View style={{
      opacity:   cardOpacity,
      transform: [{ translateY: cardTranslateY }, { scale: cardScale }],
      flex: 1,
    }}>
    {/* Swipe-reveal action strip (owner only) */}
    <View style={styles.swipeWrap}>
      {isOwner && (
        <View style={styles.swipeActions}>
          <TouchableOpacity
            style={styles.archiveActionBtn}
            onPress={() => { closeSwipe(); onArchive?.(); }}
          >
            <Ionicons name="archive-outline" size={18} color="#fff" />
            <Text style={styles.swipeActionTxt}>Archive</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.deleteActionBtn}
            onPress={() => { closeSwipe(); onDelete?.(); }}
          >
            <Ionicons name="trash-outline" size={18} color="#fff" />
            <Text style={styles.swipeActionTxt}>Delete</Text>
          </TouchableOpacity>
        </View>
      )}
      <Animated.View style={{ transform: [{ translateX: swipeX }] }} {...panResponder.panHandlers}>
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      {/* Image */}
      <View style={styles.cardImageWrap}>
        {image ? (
          <Image source={{ uri: image.url }} style={styles.cardImage} resizeMode="cover" />
        ) : (
          <View style={[styles.cardImage, styles.cardImagePlaceholder]}>
            <Text style={{ fontSize: 32 }}>{cat?.icon ?? '📦'}</Text>
          </View>
        )}
        {/* Watch heart */}
        <TouchableOpacity style={styles.watchBtn} onPress={onWatch} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons
            name={item.is_watched ? 'heart' : 'heart-outline'}
            size={20}
            color={item.is_watched ? '#ff4500' : '#fff'}
          />
        </TouchableOpacity>
        {/* Auction badge */}
        {item.listing_type === 'auction' && (
          <View style={styles.auctionBadge}>
            <Text style={styles.auctionBadgeTxt}>AUCTION</Text>
          </View>
        )}
        {/* LiPo hazmat */}
        {item.lipo_hazmat && (
          <View style={styles.lipoTag}>
            <Text style={styles.lipoTagTxt}>🔋 Ground Only</Text>
          </View>
        )}
      </View>

      {/* Details */}
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>

        <View style={styles.cardMeta}>
          <View style={[styles.condBadge, { backgroundColor: conditionColor(item.condition) + '22', borderColor: conditionColor(item.condition) }]}>
            <Text style={[styles.condBadgeTxt, { color: conditionColor(item.condition) }]}>
              {conditionLabel(item.condition)}
            </Text>
          </View>
          {item.free_shipping && (
            <View style={styles.freeShipBadge}>
              <Text style={styles.freeShipTxt}>Free ship</Text>
            </View>
          )}
        </View>

        <View style={styles.cardFooter}>
          <Text style={styles.cardPrice}>{priceLabel}</Text>
          {item.seller?.username && (
            <Text style={styles.cardSeller} numberOfLines={1}>
              {item.seller.verification_tier && item.seller.verification_tier >= 3 ? '✅ ' : ''}
              {item.seller.username}
            </Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
      </Animated.View>
    </View>
    </Animated.View>
  );
});

// ─── Trust panel (shown when no listings yet or first-time user) ──────────────
const TrustPanel = ({ onDismiss }: { onDismiss: () => void }) => {
  const scrollRef  = useRef<ScrollView>(null);
  const bounceAnim = useRef(new Animated.Value(0)).current;
  const [showArrow, setShowArrow] = useState(true);

  // ── Entry animation: slide up + spring bounce on mount ────────────────────
  const entryTranslateY = useRef(new Animated.Value(40)).current;
  const entryScale      = useRef(new Animated.Value(0.92)).current;
  const entryOpacity    = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      // Fade in
      Animated.timing(entryOpacity, {
        toValue: 1, duration: 220, useNativeDriver: true,
      }),
      // Slide up with spring overshoot
      Animated.spring(entryTranslateY, {
        toValue: 0, friction: 7, tension: 60, useNativeDriver: true,
      }),
      // Scale up with slight overshoot
      Animated.spring(entryScale, {
        toValue: 1, friction: 6, tension: 70, useNativeDriver: true,
      }),
    ]).start();
  }, []);

  // ── Arrow bounce loop ──────────────────────────────────────────────────────
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bounceAnim, { toValue: 7,  duration: 420, useNativeDriver: true }),
        Animated.timing(bounceAnim, { toValue: 0,  duration: 420, useNativeDriver: true }),
        Animated.timing(bounceAnim, { toValue: 5,  duration: 300, useNativeDriver: true }),
        Animated.timing(bounceAnim, { toValue: 0,  duration: 300, useNativeDriver: true }),
        Animated.delay(1200),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [bounceAnim]);

  const handleArrowPress = () => {
    scrollRef.current?.scrollTo({ x: 220, animated: true });
  };

  const handleScroll = (e: any) => {
    if (e.nativeEvent.contentOffset.x > 30) setShowArrow(false);
  };

  return (
    <Animated.View style={[
      styles.trustPanel,
      {
        opacity:   entryOpacity,
        transform: [
          { translateY: entryTranslateY },
          { scale: entryScale },
        ],
      },
    ]}>
      <View style={styles.trustHeader}>
        <Text style={styles.trustTitle}>Why sell here?</Text>
        <TouchableOpacity onPress={onDismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="close" size={20} color="#666" />
        </TouchableOpacity>
      </View>

      {/* Scroll area + right-edge arrow overlay */}
      <View style={styles.trustScrollWrap}>
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.trustScroll}
          onScroll={handleScroll}
          scrollEventThrottle={16}
        >
          {TRUST_BULLETS.map((b, i) => (
            <View key={i} style={styles.trustCard}>
              <Text style={styles.trustIcon}>{b.icon}</Text>
              <Text style={styles.trustBulletTitle}>{b.title}</Text>
              <Text style={styles.trustBulletBody}>{b.body}</Text>
            </View>
          ))}
          {/* trailing spacer so last card isn't flush against edge */}
          <View style={{ width: 8 }} />
        </ScrollView>

        {/* Right-edge fade + bouncing arrow */}
        {showArrow && (
          <View style={styles.trustArrowOverlay} pointerEvents="box-none">
            {/* Fade gradient simulation */}
            <View style={styles.trustFade} pointerEvents="none" />
            {/* Tappable bouncing chevron */}
            <TouchableOpacity
              style={styles.trustArrowBtn}
              onPress={handleArrowPress}
              activeOpacity={0.7}
            >
              <Animated.View style={{ transform: [{ translateX: bounceAnim }] }}>
                <Ionicons name="chevron-forward-circle" size={30} color="#ff4500" />
              </Animated.View>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Animated.View>
  );
};

// ─── Category grid ─────────────────────────────────────────────────────────────
const CategoryGrid = ({
  selected,
  onSelect,
}: {
  selected: CategorySlug | null;
  onSelect: (s: CategorySlug | null) => void;
}) => (
  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catScroll} contentContainerStyle={styles.catContent}>
    <TouchableOpacity
      style={[styles.catChip, !selected && styles.catChipActive]}
      onPress={() => onSelect(null)}
    >
      <Text style={[styles.catChipTxt, !selected && styles.catChipTxtActive]}>All</Text>
    </TouchableOpacity>
    {CATEGORIES.map(c => (
      <TouchableOpacity
        key={c.slug}
        style={[styles.catChip, selected === c.slug && styles.catChipActive]}
        onPress={() => onSelect(selected === c.slug ? null : c.slug)}
      >
        <Text style={styles.catChipIcon}>{c.icon}</Text>
        <Text style={[styles.catChipTxt, selected === c.slug && styles.catChipTxtActive]}>
          {c.label}
        </Text>
      </TouchableOpacity>
    ))}
  </ScrollView>
);

// ─── Create Listing Modal ──────────────────────────────────────────────────────
const CreateListingModal = ({
  visible,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (params: CreateListingParams) => Promise<void>;
}) => {
  const [step, setStep]               = useState<'basics' | 'details' | 'shipping'>('basics');
  const [title, setTitle]             = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory]       = useState<CategorySlug | null>(null);
  const [condition, setCondition]     = useState<ConditionValue | null>(null);
  const [condNotes, setCondNotes]     = useState('');
  const [price, setPrice]             = useState('');
  const [listingType, setListingType] = useState<'fixed' | 'offer'>('fixed');
  const [freeShip, setFreeShip]       = useState(false);
  const [shipCost, setShipCost]       = useState('');
  const [fromState, setFromState]     = useState('');
  const [lipo, setLipo]               = useState(false);
  const [images, setImages]           = useState<string[]>([]);
  const [submitting, setSubmitting]   = useState(false);

  const reset = () => {
    setStep('basics'); setTitle(''); setDescription('');
    setCategory(null); setCondition(null); setCondNotes('');
    setPrice(''); setListingType('fixed'); setFreeShip(false);
    setShipCost(''); setFromState(''); setLipo(false); setImages([]);
  };

  const pickImages = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo access to add listing photos.'); return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: 8,
      quality: 0.85,
    });
    if (!result.canceled) {
      setImages(prev => [...prev, ...result.assets.map(a => a.uri)].slice(0, 8));
    }
  };

  const removeImage = (uri: string) => setImages(prev => prev.filter(i => i !== uri));

  const canNextBasics = title.trim().length >= 5 && description.trim().length >= 20 && !!category && !!condition;
  const canNextDetails = !!price && parseFloat(price) > 0;
  const canSubmit = canNextBasics && canNextDetails;

  const handleSubmit = async () => {
    if (!category || !condition || !canSubmit) return;
    setSubmitting(true);
    await onSubmit({
      title: title.trim(),
      description: description.trim(),
      category,
      condition,
      condition_notes: condNotes.trim() || undefined,
      price: parseFloat(price),
      listing_type: listingType,
      ships_from_state: fromState.trim() || undefined,
      shipping_cost: shipCost ? parseFloat(shipCost) : undefined,
      free_shipping: freeShip,
      lipo_hazmat: lipo,
      imageUris: images,
    });
    setSubmitting(false);
    reset();
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.createModal} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <StatusBar barStyle="light-content" />
        {/* Header */}
        <View style={styles.createHeader}>
          <TouchableOpacity onPress={() => { reset(); onClose(); }}>
            <Text style={styles.createCancel}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.createTitle}>
            {step === 'basics' ? 'New Listing' : step === 'details' ? 'Pricing' : 'Shipping'}
          </Text>
          <View style={{ width: 60 }} />
        </View>

        {/* Step indicators */}
        <View style={styles.stepRow}>
          {(['basics', 'details', 'shipping'] as const).map((s, i) => (
            <View key={s} style={[styles.stepDot, step === s && styles.stepDotActive,
              (step === 'details' && i === 0) || (step === 'shipping' && i <= 1) ? styles.stepDotDone : null
            ]} />
          ))}
        </View>

        <ScrollView style={styles.createBody} keyboardShouldPersistTaps="handled">
          {step === 'basics' && (
            <View>
              {/* Photos */}
              <Text style={styles.fieldLabel}>Photos ({images.length}/8)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                <TouchableOpacity style={styles.addPhotoBtn} onPress={pickImages}>
                  <Ionicons name="camera-outline" size={28} color="#ff4500" />
                  <Text style={styles.addPhotoBtnTxt}>Add photos</Text>
                </TouchableOpacity>
                {images.map(uri => (
                  <View key={uri} style={styles.photoThumbWrap}>
                    <Image source={{ uri }} style={styles.photoThumb} />
                    <TouchableOpacity style={styles.removePhoto} onPress={() => removeImage(uri)}>
                      <Ionicons name="close-circle" size={20} color="#ff4444" />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>

              {/* Title */}
              <Text style={styles.fieldLabel}>Title *</Text>
              <TextInput
                style={styles.fieldInput}
                value={title}
                onChangeText={setTitle}
                placeholder="e.g. HGLRC Sector 5 V3 — 2 flights, no crashes"
                placeholderTextColor="#444"
                maxLength={120}
              />
              <Text style={styles.charCount}>{title.length}/120</Text>

              {/* Category */}
              <Text style={styles.fieldLabel}>Category *</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                {CATEGORIES.map(c => (
                  <TouchableOpacity
                    key={c.slug}
                    style={[styles.selectChip, category === c.slug && styles.selectChipActive]}
                    onPress={() => {
                      setCategory(c.slug);
                      // auto-flag lipo
                      if (c.slug === 'batteries') setLipo(true);
                      else setLipo(false);
                    }}
                  >
                    <Text style={styles.catChipIcon}>{c.icon}</Text>
                    <Text style={[styles.selectChipTxt, category === c.slug && styles.selectChipTxtActive]}>
                      {c.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Condition */}
              <Text style={styles.fieldLabel}>Condition *</Text>
              <View style={styles.condRow}>
                {CONDITIONS.map(c => (
                  <TouchableOpacity
                    key={c.value}
                    style={[styles.condChip, condition === c.value && { backgroundColor: c.color + '33', borderColor: c.color }]}
                    onPress={() => setCondition(c.value)}
                  >
                    <Text style={[styles.condChipTxt, condition === c.value && { color: c.color }]}>{c.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput
                style={[styles.fieldInput, { marginTop: 8 }]}
                value={condNotes}
                onChangeText={setCondNotes}
                placeholder='Condition notes (e.g. "3 flights, minor frame scuff")'
                placeholderTextColor="#444"
                maxLength={200}
              />

              {/* Description */}
              <Text style={styles.fieldLabel}>Description * (min 20 chars)</Text>
              <TextInput
                style={[styles.fieldInput, styles.textArea]}
                value={description}
                onChangeText={setDescription}
                placeholder="Describe your item — specs, flight time, what's included, any known issues..."
                placeholderTextColor="#444"
                multiline
                maxLength={2000}
              />
              <Text style={styles.charCount}>{description.length}/2000</Text>
            </View>
          )}

          {step === 'details' && (
            <View>
              {/* Price */}
              <Text style={styles.fieldLabel}>Price (USD) *</Text>
              <View style={styles.priceRow}>
                <Text style={styles.priceDollar}>$</Text>
                <TextInput
                  style={[styles.fieldInput, styles.priceInput]}
                  value={price}
                  onChangeText={t => setPrice(t.replace(/[^0-9.]/g, ''))}
                  placeholder="0.00"
                  placeholderTextColor="#444"
                  keyboardType="decimal-pad"
                />
              </View>

              {/* Listing type */}
              <Text style={styles.fieldLabel}>Listing type</Text>
              <View style={styles.typeRow}>
                {([['fixed', 'Buy Now', '🏷️'], ['offer', 'Best Offer', '🤝']] as const).map(([v, l, ic]) => (
                  <TouchableOpacity
                    key={v}
                    style={[styles.typeChip, listingType === v && styles.typeChipActive]}
                    onPress={() => setListingType(v)}
                  >
                    <Text style={styles.typeChipIcon}>{ic}</Text>
                    <Text style={[styles.typeChipTxt, listingType === v && styles.typeChipTxtActive]}>{l}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Trust reminder */}
              <View style={styles.trustReminder}>
                <Ionicons name="shield-checkmark-outline" size={16} color="#00e676" />
                <Text style={styles.trustReminderTxt}>
                  Payment is held securely until the buyer confirms delivery. You're protected against cancellations and false claims.
                </Text>
              </View>
            </View>
          )}

          {step === 'shipping' && (
            <View>
              {/* LiPo warning */}
              {lipo && (
                <View style={styles.lipoWarning}>
                  <Text style={styles.lipoWarningTitle}>⚠️ Battery / LiPo detected</Text>
                  <Text style={styles.lipoWarningBody}>
                    LiPo batteries must ship via ground only (USPS Ground, UPS Ground, or FedEx Ground). Air shipping is prohibited by carrier policy and FAA regulations. Ensure proper packaging — use a LiPo-safe bag and original packaging where possible.
                  </Text>
                  <TouchableOpacity style={styles.lipoCheckRow} onPress={() => setLipo(!lipo)}>
                    <View style={[styles.checkbox, lipo && styles.checkboxChecked]}>
                      {lipo && <Ionicons name="checkmark" size={14} color="#fff" />}
                    </View>
                    <Text style={styles.lipoCheckTxt}>I understand and will ship ground-only</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Shipping cost */}
              <Text style={styles.fieldLabel}>Shipping cost</Text>
              <View style={styles.typeRow}>
                <TouchableOpacity
                  style={[styles.typeChip, freeShip && styles.typeChipActive]}
                  onPress={() => { setFreeShip(true); setShipCost(''); }}
                >
                  <Text style={[styles.typeChipTxt, freeShip && styles.typeChipTxtActive]}>Free shipping</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.typeChip, !freeShip && styles.typeChipActive]}
                  onPress={() => setFreeShip(false)}
                >
                  <Text style={[styles.typeChipTxt, !freeShip && styles.typeChipTxtActive]}>Buyer pays shipping</Text>
                </TouchableOpacity>
              </View>
              {!freeShip && (
                <>
                  <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Estimated shipping cost ($)</Text>
                  <View style={styles.priceRow}>
                    <Text style={styles.priceDollar}>$</Text>
                    <TextInput
                      style={[styles.fieldInput, styles.priceInput]}
                      value={shipCost}
                      onChangeText={t => setShipCost(t.replace(/[^0-9.]/g, ''))}
                      placeholder="0.00"
                      placeholderTextColor="#444"
                      keyboardType="decimal-pad"
                    />
                  </View>
                </>
              )}

              {/* Ships from state */}
              <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Ships from (state)</Text>
              <TextInput
                style={styles.fieldInput}
                value={fromState}
                onChangeText={setFromState}
                placeholder="e.g. TX, CA, FL"
                placeholderTextColor="#444"
                maxLength={2}
                autoCapitalize="characters"
              />

              {/* Fee transparency */}
              {!!price && (
                <View style={styles.feeBox}>
                  <Text style={styles.feeBoxTitle}>Fee estimate</Text>
                  <View style={styles.feeRow}>
                    <Text style={styles.feeLabel}>Sale price</Text>
                    <Text style={styles.feeValue}>${parseFloat(price || '0').toFixed(2)}</Text>
                  </View>
                  <View style={styles.feeRow}>
                    <Text style={styles.feeLabel}>Platform fee (5%)</Text>
                    <Text style={styles.feeValue}>−${(parseFloat(price || '0') * 0.05).toFixed(2)}</Text>
                  </View>
                  <View style={[styles.feeRow, styles.feeRowTotal]}>
                    <Text style={styles.feeLabelBold}>You receive</Text>
                    <Text style={styles.feeValueBold}>${(parseFloat(price || '0') * 0.95).toFixed(2)}</Text>
                  </View>
                  <Text style={styles.feeNote}>
                    Payment is held until delivery confirmed, then transferred to you automatically.
                  </Text>
                </View>
              )}
            </View>
          )}
        </ScrollView>

        {/* Bottom nav */}
        <View style={styles.createFooter}>
          {step !== 'basics' && (
            <TouchableOpacity
              style={styles.backBtn}
              onPress={() => setStep(step === 'shipping' ? 'details' : 'basics')}
            >
              <Ionicons name="arrow-back" size={20} color="#fff" />
              <Text style={styles.backBtnTxt}>Back</Text>
            </TouchableOpacity>
          )}
          {step === 'shipping' ? (
            <TouchableOpacity
              style={[styles.nextBtn, (!canSubmit || submitting) && styles.nextBtnDisabled]}
              onPress={handleSubmit}
              disabled={!canSubmit || submitting || (lipo === false && category === 'batteries')}
            >
              {submitting
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.nextBtnTxt}>Publish Listing</Text>
              }
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.nextBtn, ((step === 'basics' && !canNextBasics) || (step === 'details' && !canNextDetails)) && styles.nextBtnDisabled]}
              onPress={() => setStep(step === 'basics' ? 'details' : 'shipping')}
              disabled={(step === 'basics' && !canNextBasics) || (step === 'details' && !canNextDetails)}
            >
              <Text style={styles.nextBtnTxt}>Continue</Text>
              <Ionicons name="arrow-forward" size={20} color="#fff" />
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

// ─── Filter modal ─────────────────────────────────────────────────────────────
const FilterModal = ({
  visible,
  onClose,
  onApply,
  current,
}: {
  visible: boolean;
  onClose: () => void;
  onApply: (f: MarketplaceFilters) => void;
  current: MarketplaceFilters;
}) => {
  const [condition, setCondition] = useState<ConditionValue | null>(current.condition ?? null);
  const [minPrice, setMinPrice]   = useState(current.minPrice?.toString() ?? '');
  const [maxPrice, setMaxPrice]   = useState(current.maxPrice?.toString() ?? '');
  const [freeShip, setFreeShip]   = useState(current.freeShipping ?? false);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.filterModal}>
        <View style={styles.filterHeader}>
          <Text style={styles.filterTitle}>Filters</Text>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={24} color="#fff" />
          </TouchableOpacity>
        </View>
        <ScrollView style={styles.filterBody}>
          <Text style={styles.fieldLabel}>Condition</Text>
          <View style={styles.condRow}>
            <TouchableOpacity
              style={[styles.condChip, !condition && styles.condChipAllActive]}
              onPress={() => setCondition(null)}
            >
              <Text style={[styles.condChipTxt, !condition && { color: '#fff' }]}>Any</Text>
            </TouchableOpacity>
            {CONDITIONS.map(c => (
              <TouchableOpacity
                key={c.value}
                style={[styles.condChip, condition === c.value && { backgroundColor: c.color + '33', borderColor: c.color }]}
                onPress={() => setCondition(condition === c.value ? null : c.value)}
              >
                <Text style={[styles.condChipTxt, condition === c.value && { color: c.color }]}>{c.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.fieldLabel}>Price range</Text>
          <View style={styles.priceRangeRow}>
            <View style={[styles.priceRow, { flex: 1 }]}>
              <Text style={styles.priceDollar}>$</Text>
              <TextInput
                style={[styles.fieldInput, styles.priceInput, { flex: 1 }]}
                value={minPrice}
                onChangeText={t => setMinPrice(t.replace(/[^0-9.]/g, ''))}
                placeholder="Min"
                placeholderTextColor="#444"
                keyboardType="decimal-pad"
              />
            </View>
            <Text style={styles.priceRangeSep}>–</Text>
            <View style={[styles.priceRow, { flex: 1 }]}>
              <Text style={styles.priceDollar}>$</Text>
              <TextInput
                style={[styles.fieldInput, styles.priceInput, { flex: 1 }]}
                value={maxPrice}
                onChangeText={t => setMaxPrice(t.replace(/[^0-9.]/g, ''))}
                placeholder="Max"
                placeholderTextColor="#444"
                keyboardType="decimal-pad"
              />
            </View>
          </View>

          <TouchableOpacity style={styles.toggleRow} onPress={() => setFreeShip(!freeShip)}>
            <Text style={styles.toggleLabel}>Free shipping only</Text>
            <View style={[styles.toggle, freeShip && styles.toggleOn]}>
              <View style={[styles.toggleKnob, freeShip && styles.toggleKnobOn]} />
            </View>
          </TouchableOpacity>
        </ScrollView>

        <View style={styles.filterFooter}>
          <TouchableOpacity style={styles.clearBtn} onPress={() => { setCondition(null); setMinPrice(''); setMaxPrice(''); setFreeShip(false); }}>
            <Text style={styles.clearBtnTxt}>Clear all</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.applyBtn} onPress={() => {
            onApply({
              condition: condition ?? null,
              minPrice: minPrice ? parseFloat(minPrice) : null,
              maxPrice: maxPrice ? parseFloat(maxPrice) : null,
              freeShipping: freeShip,
            });
            onClose();
          }}>
            <Text style={styles.applyBtnTxt}>Apply filters</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function MarketplaceScreen() {
  const router   = useRouter();
  const { user } = useAuth();

  // ── Animated title (matches Feed header) ──────────────────────────────────
  const animValue = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.timing(animValue, {
        toValue: 1, duration: 3000,
        easing: Easing.linear, useNativeDriver: false,
      })
    ).start();
  }, [animValue]);
  const animatedColor = animValue.interpolate({
    inputRange:  [0,    0.25,     0.5,      0.75,     1],
    outputRange: ['#ff4500', '#ff8c00', '#ffcc00', '#ff6600', '#ff4500'],
  });

  const {
    listings, loading, refreshing, loadingMore, hasMore,
    filters, loadListings, loadMore, applyFilters, onRefresh,
    toggleWatch, createListing,
  } = useMarketplace(user?.id);

  // ── Pull-to-refresh custom spinner (must be after `refreshing` is declared) ─
  const spinAnim = useRef(new Animated.Value(0)).current;
  const spinLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  useEffect(() => {
    if (refreshing) {
      spinAnim.setValue(0);
      spinLoopRef.current = Animated.loop(
        Animated.timing(spinAnim, { toValue: 1, duration: 700, easing: Easing.linear, useNativeDriver: true })
      );
      spinLoopRef.current.start();
    } else {
      spinLoopRef.current?.stop();
      spinAnim.setValue(0);
    }
  }, [refreshing]);
  const spinRotate = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  // ── FAB bounce when new listings land (must be after `listings` is declared) ─
  const fabScale       = useRef(new Animated.Value(1)).current;
  const prevListingLen = useRef(0);
  const safeLen        = listings?.length ?? 0;
  useEffect(() => {
    if (safeLen > prevListingLen.current && prevListingLen.current > 0) {
      Animated.sequence([
        Animated.spring(fabScale, { toValue: 1.28, friction: 4, tension: 90, useNativeDriver: true }),
        Animated.spring(fabScale, { toValue: 1,    friction: 5, tension: 70, useNativeDriver: true }),
      ]).start();
    }
    prevListingLen.current = safeLen;
  }, [safeLen]);

  // ── Featured listings ──────────────────────────────────────────────────────
  const {
    featured, loading: featLoading, reload: reloadFeatured, spendPropsForFeatured,
  } = useFeaturedListings();
  const [showBoost, setShowBoost]       = useState(false);
  const [boostTarget, setBoostTarget]   = useState<{ id: string; title: string } | null>(null);
  // User's own props balance (fetched once)
  const [userProps,     setUserProps]     = useState(0);
  const [lifetimeProps, setLifetimeProps] = useState(0);
  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('users')
      .select('total_props, lifetime_props')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        setUserProps(data?.total_props ?? 0);
        setLifetimeProps(data?.lifetime_props ?? data?.total_props ?? 0);
      });
  }, [user?.id]);

  const handleOpenBoost = useCallback((listingId?: string, listingTitle?: string) => {
    // If called from a specific card, pre-select that listing
    // Otherwise let user pick from their own listings (future phase)
    if (listingId && listingTitle) {
      setBoostTarget({ id: listingId, title: listingTitle });
    } else {
      // Find first active listing owned by user
      const own = listings?.find(l => l.seller_id === user?.id);
      if (own) setBoostTarget({ id: own.id, title: own.title });
      else {
        Alert.alert('No active listing', 'Create a listing first, then boost it to the Featured carousel.');
        return;
      }
    }
    setShowBoost(true);
  }, [listings, user?.id]);

  const [searchText, setSearchText]     = useState('');
  const [selectedCat, setSelectedCat]   = useState<CategorySlug | null>(null);
  const [showFilter, setShowFilter]     = useState(false);
  const [showCreate, setShowCreate]     = useState(false);
  const [showTrust, setShowTrust]       = useState(true);

  // Reset trust panel every time the tab comes back into focus
  useFocusEffect(
    useCallback(() => {
      setShowTrust(true);
    }, [])
  );
  const [searchActive, setSearchActive] = useState(false);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Active filter count badge
  const filterCount = useMemo(() => {
    let n = 0;
    if (filters.condition) n++;
    if (filters.minPrice) n++;
    if (filters.maxPrice) n++;
    if (filters.freeShipping) n++;
    return n;
  }, [filters]);

  const handleCatSelect = useCallback((slug: CategorySlug | null) => {
    setSelectedCat(slug);
    applyFilters({ ...filters, category: slug });
  }, [filters, applyFilters]);

  const handleSearch = useCallback((text: string) => {
    setSearchText(text);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      applyFilters({ ...filters, searchQuery: text });
    }, 400);
  }, [filters, applyFilters]);

  const handleCreateSubmit = useCallback(async (params: CreateListingParams) => {
    const result = await createListing(params);
    if (result.ok) {
      Alert.alert('🎉 Listing published!', 'Your item is now live in the marketplace.');
      onRefresh();
    } else {
      Alert.alert('Error', result.error ?? 'Failed to publish listing. Please try again.');
    }
  }, [createListing, onRefresh]);

  // ── List footer ────────────────────────────────────────────────────────────
  const ListFooter = useCallback(() => {
    if (loadingMore) return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color="#ff4500" />
        <Text style={styles.footerLoaderTxt}>Loading more...</Text>
      </View>
    );
    if (!hasMore && (listings?.length ?? 0) > 0) return (
      <View style={styles.footerEnd}>
        <View style={styles.footerEndLine} />
        <Text style={styles.footerEndTxt}>You've seen it all</Text>
        <View style={styles.footerEndLine} />
      </View>
    );
    return null;
  }, [loadingMore, hasMore, listings?.length]);

  // ── Empty state ────────────────────────────────────────────────────────────
  const EmptyStateWrapper = useCallback(() => (
    <EmptyState
      selectedCat={selectedCat}
      searchText={searchText}
      onCreatePress={() => setShowCreate(true)}
    />
  ), [selectedCat, searchText]);

  // ── Header component inside FlatList ──────────────────────────────────────
  const ListHeader = useCallback(() => (
    <View>
      {/* Trust panel — first thing sellers/buyers see when opening the tab */}
      {showTrust && <TrustPanel onDismiss={() => setShowTrust(false)} />}
      {/* Featured carousel */}
      <FeaturedCarousel
        items={featured}
        loading={featLoading}
        currentUserId={user?.id}
        onItemPress={item =>
          Alert.alert(item.title, `$${item.price.toFixed(2)} · ${conditionLabel(item.condition)}\n\n${item.description}`)
        }
        onBoostPress={() => handleOpenBoost()}
      />
      {/* Category row */}
      <CategoryGrid selected={selectedCat} onSelect={handleCatSelect} />
    </View>
  ), [showTrust, selectedCat, handleCatSelect, featured, featLoading, user?.id, handleOpenBoost]);

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />
        <ActivityIndicator size="large" color="#ff4500" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />

      {/* ── Top bar ───────────────────────────────────────────────────────── */}
      <View style={styles.topBar}>
        {searchActive ? (
          <View style={styles.searchBarWrap}>
            <Ionicons name="search" size={16} color="#888" style={{ marginRight: 8 }} />
            <TextInput
              style={styles.searchInput}
              value={searchText}
              onChangeText={handleSearch}
              placeholder="Search listings..."
              placeholderTextColor="#444"
              autoFocus
              returnKeyType="search"
            />
            <TouchableOpacity onPress={() => { setSearchActive(false); handleSearch(''); }}>
              <Text style={styles.searchCancel}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Animated.Text style={[styles.topBarTitle, { color: animatedColor }]}>Marketplace</Animated.Text>
            <View style={styles.topBarActions}>
              <TouchableOpacity style={styles.topBarBtn} onPress={() => setSearchActive(true)}>
                <Ionicons name="search-outline" size={22} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.topBarBtn} onPress={() => setShowFilter(true)}>
                <Ionicons name="options-outline" size={22} color="#fff" />
                {filterCount > 0 && (
                  <View style={styles.filterBadge}>
                    <Text style={styles.filterBadgeTxt}>{filterCount}</Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>

      {/* ── Refresh overlay ──────────────────────────────────────────────── */}
      {refreshing && (
        <View style={styles.refreshOverlay}>
          <Animated.View style={{ transform: [{ rotate: spinRotate }] }}>
            <Ionicons name="sync" size={20} color="#ff4500" />
          </Animated.View>
          <Text style={styles.refreshTxt}>Refreshing…</Text>
        </View>
      )}

      {/* ── Listings grid ─────────────────────────────────────────────────── */}
      <FlatList
        data={listings}
        keyExtractor={item => item.id}
        numColumns={2}
        columnWrapperStyle={styles.row}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={EmptyStateWrapper}
        ListFooterComponent={ListFooter}
        renderItem={({ item, index }) => (
          <ListingCard
            item={item}
            index={index}
            isOwner={item.seller_id === user?.id}
            onPress={() => {
              // Phase 2: router.push(`/marketplace/${item.id}`)
              Alert.alert(item.title, `$${item.price.toFixed(2)} · ${conditionLabel(item.condition)}\n\n${item.description}`);
            }}
            onWatch={() => user
              ? toggleWatch(item.id)
              : Alert.alert('Sign in', 'Sign in to save listings to your watchlist.')
            }
            onArchive={() =>
              Alert.alert(
                'Archive listing',
                'This will hide your listing from search. You can reactivate it anytime.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Archive', style: 'destructive', onPress: () => {} },
                ]
              )
            }
            onDelete={() =>
              Alert.alert(
                'Delete listing',
                'Permanently delete this listing? This cannot be undone.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: () => {} },
                ]
              )
            }
          />
        )}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#ff4500" />
        }
        onEndReached={() => { if (hasMore && !loadingMore) loadMore(); }}
        onEndReachedThreshold={0.4}
        contentContainerStyle={(listings?.length ?? 0) === 0 ? { flexGrow: 1 } : { paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      />

      {/* ── FAB — Sell ────────────────────────────────────────────────────── */}
      <Animated.View style={[styles.fabWrap, { transform: [{ scale: fabScale }] }]}>
        <TouchableOpacity
          style={styles.fab}
          onPress={() => user ? setShowCreate(true) : Alert.alert('Sign in', 'Sign in to list items for sale.')}
          activeOpacity={0.85}
        >
          <Ionicons name="add" size={22} color="#fff" />
          <Text style={styles.fabTxt}>Sell</Text>
        </TouchableOpacity>
      </Animated.View>

      {/* ── Modals ───────────────────────────────────────────────────────── */}
      <CreateListingModal
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        onSubmit={handleCreateSubmit}
      />
      <FilterModal
        visible={showFilter}
        onClose={() => setShowFilter(false)}
        onApply={f => applyFilters({ ...filters, ...f })}
        current={filters}
      />
      {boostTarget && (
        <BoostModal
          visible={showBoost}
          listingId={boostTarget.id}
          listingTitle={boostTarget.title}
          userProps={userProps}
          lifetimeProps={lifetimeProps}
          onClose={() => setShowBoost(false)}
          onSpendProps={async () => {
            if (!user?.id || !boostTarget) return;
            const res = await spendPropsForFeatured(boostTarget.id, user.id);
            if (res.ok) {
              setUserProps(p => Math.max(0, p - FEATURED_PROPS_COST));
              reloadFeatured();
              Alert.alert('🎉 Listing featured!', 'Your listing will appear in the carousel for the next 24 hours.');
            } else {
              const msg = res.error === 'insufficient_props'
                ? `You need ${FEATURED_PROPS_COST.toLocaleString()} props. Keep flying and earning!`
                : res.error ?? 'Something went wrong.';
              Alert.alert('Could not boost listing', msg);
            }
          }}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const CARD_W = (SW - 36) / 2;

const styles = StyleSheet.create({
  container:         { flex: 1, backgroundColor: '#0a0a0a' },
  loadingWrap:       { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center' },

  // ── Top bar
  topBar:            { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 54 : 16, paddingBottom: 12, backgroundColor: '#0a0a0a', borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  topBarTitle:       { fontSize: 24, fontWeight: '800', letterSpacing: 1.5 },
  topBarActions:     { flexDirection: 'row', gap: 8 },
  topBarBtn:         { padding: 6, position: 'relative' },
  filterBadge:       { position: 'absolute', top: 2, right: 2, backgroundColor: '#ff4500', borderRadius: 8, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center' },
  filterBadgeTxt:    { color: '#fff', fontSize: 10, fontWeight: '700' },
  searchBarWrap:     { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a1a', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  searchInput:       { flex: 1, color: '#fff', fontSize: 15 },
  searchCancel:      { color: '#ff4500', fontSize: 15, marginLeft: 10 },

  // ── Trust panel
  trustPanel:        { backgroundColor: '#111', marginHorizontal: 12, marginTop: 12, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#1e2a3a' },
  trustHeader:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  trustTitle:        { color: '#fff', fontSize: 15, fontWeight: '700' },
  trustScroll:       { marginHorizontal: -4 },
  trustCard:         { width: 200, backgroundColor: '#0d1117', borderRadius: 12, padding: 14, marginHorizontal: 4, borderWidth: 1, borderColor: '#1e2a3a' },
  trustScrollWrap:   { position: 'relative' },
  trustArrowOverlay: { position: 'absolute', top: 0, bottom: 0, right: 0, width: 64, justifyContent: 'center', alignItems: 'flex-end' },
  trustFade:         { position: 'absolute', top: 0, bottom: 0, right: 0, width: 64, backgroundColor: 'transparent',
                       // layered semi-transparent boxes simulate a right fade
                       borderRadius: 12 },
  trustArrowBtn:     { width: 40, height: 40, justifyContent: 'center', alignItems: 'center',
                       backgroundColor: '#111', borderRadius: 20,
                       shadowColor: '#ff4500', shadowOffset: { width: 0, height: 0 },
                       shadowOpacity: 0.5, shadowRadius: 8, elevation: 6,
                       marginRight: 2 },
  trustIcon:         { fontSize: 26, marginBottom: 8 },
  trustBulletTitle:  { color: '#fff', fontSize: 13, fontWeight: '700', marginBottom: 4 },
  trustBulletBody:   { color: '#888', fontSize: 12, lineHeight: 17 },

  // ── Category row
  catScroll:         { backgroundColor: '#0a0a0a' },
  catContent:        { paddingHorizontal: 12, paddingVertical: 10, gap: 8, flexDirection: 'row' },
  catChip:           { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a' },
  catChipActive:     { backgroundColor: '#ff450022', borderColor: '#ff4500' },
  catChipIcon:       { fontSize: 13 },
  catChipTxt:        { color: '#888', fontSize: 13, fontWeight: '600' },
  catChipTxtActive:  { color: '#ff4500' },

  // ── Grid
  row:               { paddingHorizontal: 12, gap: 12, marginBottom: 12 },

  // ── Listing card
  card:              { width: CARD_W, backgroundColor: '#111', borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: '#1e1e1e' },
  cardImageWrap:     { width: '100%', height: CARD_W, position: 'relative' },
  cardImage:         { width: '100%', height: '100%' },
  cardImagePlaceholder: { backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center' },
  watchBtn:          { position: 'absolute', top: 8, right: 8, backgroundColor: '#00000066', borderRadius: 16, padding: 5 },
  auctionBadge:      { position: 'absolute', top: 8, left: 8, backgroundColor: '#9c27b0cc', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  auctionBadgeTxt:   { color: '#fff', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  lipoTag:           { position: 'absolute', bottom: 6, left: 6, backgroundColor: '#ff440066', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  lipoTagTxt:        { color: '#fff', fontSize: 9, fontWeight: '600' },
  cardBody:          { padding: 10 },
  cardTitle:         { color: '#fff', fontSize: 13, fontWeight: '600', marginBottom: 6, lineHeight: 17 },
  cardMeta:          { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 8 },
  condBadge:         { borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1 },
  condBadgeTxt:      { fontSize: 10, fontWeight: '700' },
  freeShipBadge:     { backgroundColor: '#00e67622', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  freeShipTxt:       { color: '#00e676', fontSize: 10, fontWeight: '600' },
  cardFooter:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardPrice:         { color: '#ff4500', fontSize: 15, fontWeight: '800' },
  cardSeller:        { color: '#666', fontSize: 11, flex: 1, textAlign: 'right' },

  // ── Footer states
  footerLoader:      { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: 20, gap: 8 },
  footerLoaderTxt:   { color: '#555', fontSize: 13 },
  footerEnd:         { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 20 },
  footerEndLine:     { flex: 1, height: 1, backgroundColor: '#1e1e1e' },
  footerEndTxt:      { color: '#444', fontSize: 12, marginHorizontal: 12 },

  // ── Empty state
  emptyWrap:         { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, paddingTop: 40, paddingBottom: 160 },
  emptyIcon:         { fontSize: 52, marginBottom: 16 },
  emptyTitle:        { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  emptyBody:         { color: '#666', fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  emptyBtn:          { backgroundColor: '#ff4500', borderRadius: 24, paddingHorizontal: 28, paddingVertical: 13 },
  emptyBtnTxt:       { color: '#fff', fontSize: 15, fontWeight: '700' },

  // ── FAB
  fabWrap:           { position: 'absolute', bottom: 110, right: 20 },
  fab:               { backgroundColor: '#ff4500', borderRadius: 28, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, gap: 6, shadowColor: '#ff4500', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 8 },
  fabTxt:            { color: '#fff', fontSize: 16, fontWeight: '700' },

  // ── Refresh overlay
  refreshOverlay:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 9, backgroundColor: '#111', borderBottomWidth: 1, borderBottomColor: '#1e1e1e' },
  refreshTxt:        { color: '#ff4500', fontSize: 12, fontWeight: '600', letterSpacing: 0.3 },

  // ── Swipe-to-reveal
  swipeWrap:         { position: 'relative', overflow: 'hidden', flex: 1 },
  swipeActions:      { position: 'absolute', top: 0, bottom: 0, right: 0, width: 90, flexDirection: 'column' },
  archiveActionBtn:  { flex: 1, backgroundColor: '#1565c0', alignItems: 'center', justifyContent: 'center', gap: 4 },
  deleteActionBtn:   { flex: 1, backgroundColor: '#b71c1c', alignItems: 'center', justifyContent: 'center', gap: 4 },
  swipeActionTxt:    { color: '#fff', fontSize: 10, fontWeight: '700' },

  // ── Create listing modal
  createModal:       { flex: 1, backgroundColor: '#0a0a0a' },
  createHeader:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: Platform.OS === 'ios' ? 54 : 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  createCancel:      { color: '#ff4500', fontSize: 16 },
  createTitle:       { color: '#fff', fontSize: 17, fontWeight: '700' },
  stepRow:           { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingVertical: 12 },
  stepDot:           { width: 8, height: 8, borderRadius: 4, backgroundColor: '#2a2a2a' },
  stepDotActive:     { backgroundColor: '#ff4500', width: 24 },
  stepDotDone:       { backgroundColor: '#ff450066' },
  createBody:        { flex: 1, paddingHorizontal: 20 },
  createFooter:      { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: Platform.OS === 'ios' ? 34 : 20, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#1a1a1a' },

  // ── Form fields
  fieldLabel:        { color: '#aaa', fontSize: 13, fontWeight: '600', marginBottom: 8, marginTop: 4 },
  fieldInput:        { backgroundColor: '#1a1a1a', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, color: '#fff', fontSize: 15, borderWidth: 1, borderColor: '#2a2a2a' },
  textArea:          { height: 110, textAlignVertical: 'top', paddingTop: 12 },
  charCount:         { color: '#444', fontSize: 11, textAlign: 'right', marginTop: 4, marginBottom: 8 },

  // ── Photos
  addPhotoBtn:       { width: 88, height: 88, backgroundColor: '#1a1a1a', borderRadius: 10, borderWidth: 1.5, borderColor: '#ff4500', borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  addPhotoBtnTxt:    { color: '#ff4500', fontSize: 11, fontWeight: '600', marginTop: 4 },
  photoThumbWrap:    { width: 88, height: 88, borderRadius: 10, overflow: 'visible', marginRight: 10, position: 'relative' },
  photoThumb:        { width: 88, height: 88, borderRadius: 10 },
  removePhoto:       { position: 'absolute', top: -6, right: -6, backgroundColor: '#0a0a0a', borderRadius: 12 },

  // ── Select chips
  selectChip:        { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a', marginRight: 8 },
  selectChipActive:  { backgroundColor: '#ff450022', borderColor: '#ff4500' },
  selectChipTxt:     { color: '#888', fontSize: 13 },
  selectChipTxtActive: { color: '#ff4500', fontWeight: '700' },

  // ── Condition chips
  condRow:           { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  condChip:          { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a' },
  condChipAllActive: { backgroundColor: '#ff450022', borderColor: '#ff4500' },
  condChipTxt:       { color: '#888', fontSize: 13 },

  // ── Pricing
  priceRow:          { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 16 },
  priceDollar:       { color: '#888', fontSize: 18, fontWeight: '700', marginRight: 4 },
  priceInput:        { flex: 1 },
  typeRow:           { flexDirection: 'row', gap: 10, marginBottom: 16 },
  typeChip:          { flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a', alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 },
  typeChipActive:    { backgroundColor: '#ff450022', borderColor: '#ff4500' },
  typeChipIcon:      { fontSize: 16 },
  typeChipTxt:       { color: '#888', fontSize: 13, fontWeight: '600' },
  typeChipTxtActive: { color: '#ff4500' },

  // ── Trust reminder
  trustReminder:     { flexDirection: 'row', gap: 10, backgroundColor: '#00e67611', borderRadius: 10, padding: 14, alignItems: 'flex-start', marginBottom: 16 },
  trustReminderTxt:  { flex: 1, color: '#88d8b0', fontSize: 13, lineHeight: 18 },

  // ── LiPo warning
  lipoWarning:       { backgroundColor: '#ff440015', borderRadius: 12, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: '#ff440044' },
  lipoWarningTitle:  { color: '#ff8888', fontSize: 14, fontWeight: '700', marginBottom: 6 },
  lipoWarningBody:   { color: '#cc8888', fontSize: 13, lineHeight: 19, marginBottom: 12 },
  lipoCheckRow:      { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkbox:          { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: '#555', justifyContent: 'center', alignItems: 'center' },
  checkboxChecked:   { backgroundColor: '#ff4500', borderColor: '#ff4500' },
  lipoCheckTxt:      { color: '#aaa', fontSize: 13, flex: 1 },

  // ── Fee box
  feeBox:            { backgroundColor: '#111827', borderRadius: 12, padding: 14, marginTop: 16, borderWidth: 1, borderColor: '#1e2a3a' },
  feeBoxTitle:       { color: '#888', fontSize: 12, fontWeight: '600', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  feeRow:            { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  feeRowTotal:       { borderTopWidth: 1, borderTopColor: '#1e2a3a', paddingTop: 8, marginTop: 4 },
  feeLabel:          { color: '#888', fontSize: 13 },
  feeValue:          { color: '#888', fontSize: 13 },
  feeLabelBold:      { color: '#fff', fontSize: 14, fontWeight: '700' },
  feeValueBold:      { color: '#00e676', fontSize: 14, fontWeight: '800' },
  feeNote:           { color: '#555', fontSize: 11, marginTop: 8, lineHeight: 16 },

  // ── Shipping
  priceRangeRow:     { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  priceRangeSep:     { color: '#666', fontSize: 16 },
  toggleRow:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1a1a1a', marginBottom: 16 },
  toggleLabel:       { color: '#fff', fontSize: 15 },
  toggle:            { width: 46, height: 26, borderRadius: 13, backgroundColor: '#2a2a2a', padding: 3 },
  toggleOn:          { backgroundColor: '#ff450055' },
  toggleKnob:        { width: 20, height: 20, borderRadius: 10, backgroundColor: '#555' },
  toggleKnobOn:      { backgroundColor: '#ff4500', transform: [{ translateX: 20 }] },

  // ── Nav buttons
  backBtn:           { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 13, borderRadius: 12, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a' },
  backBtnTxt:        { color: '#fff', fontSize: 15, fontWeight: '600' },
  nextBtn:           { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15, borderRadius: 12, backgroundColor: '#ff4500' },
  nextBtnDisabled:   { backgroundColor: '#3a1a0a', opacity: 0.6 },
  nextBtnTxt:        { color: '#fff', fontSize: 16, fontWeight: '700' },

  // ── Featured carousel
  featuredShimmerWrap:   { marginHorizontal: 16, marginTop: 14, marginBottom: 4 },
  featuredShimmerLabel:  { width: 120, height: 14, backgroundColor: '#1e1e1e', borderRadius: 7, marginBottom: 10 },
  featuredShimmerCard:   { width: '100%', height: CAROUSEL_H, backgroundColor: '#111', borderRadius: 16 },
  featuredHeader:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 },
  featuredHeaderLeft:    { flexDirection: 'row', alignItems: 'center', gap: 6 },
  featuredHeaderIcon:    { fontSize: 16 },
  featuredHeaderTitle:   { color: '#fff', fontSize: 15, fontWeight: '800', letterSpacing: 0.4 },
  featuredLiveDot:       { width: 7, height: 7, borderRadius: 4, backgroundColor: '#ff4500', marginLeft: 2 },
  featuredBoostBtn:      { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#1a1400', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: '#ffcc0044' },
  featuredBoostTxt:      { color: '#ffcc00', fontSize: 12, fontWeight: '700' },
  // empty carousel state
  featuredEmptyCard:     { marginHorizontal: 16, marginBottom: 4, height: CAROUSEL_H, backgroundColor: '#111', borderRadius: 16, borderWidth: 1, borderColor: '#1e2a3a', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 32 },
  featuredEmptyIcon:     { fontSize: 36, marginBottom: 4 },
  featuredEmptyTitle:    { color: '#fff', fontSize: 15, fontWeight: '700', textAlign: 'center' },
  featuredEmptyBody:     { color: '#666', fontSize: 13, textAlign: 'center', lineHeight: 18, marginBottom: 4 },
  featuredEmptyBtn:      { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#1a1400', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1, borderColor: '#ffcc0066' },
  featuredEmptyBtnTxt:   { color: '#ffcc00', fontSize: 13, fontWeight: '700' },
  // carousel card
  featuredCard:          { height: CAROUSEL_H, borderRadius: 16, overflow: 'hidden', position: 'relative', backgroundColor: '#111' },
  featuredCardImg:       { ...StyleSheet.absoluteFillObject },
  featuredCardImgPlaceholder: { backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center' },
  featuredGradient:      { ...StyleSheet.absoluteFillObject, backgroundColor: 'transparent',
                            // Top fade + bottom fade via multiple overlapping Views below
                           },
  featuredTopRow:        { position: 'absolute', top: 10, left: 10, right: 10, flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  featuredBadge:         { backgroundColor: '#00000099', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: '#ffcc0066' },
  featuredBadgeTxt:      { color: '#ffcc00', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  featuredPropsBadge:    { backgroundColor: '#00000099', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  featuredPropsBadgeTxt: { color: '#aaa', fontSize: 10, fontWeight: '700' },
  featuredYoursBadge:    { backgroundColor: '#ff450099', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  featuredYoursBadgeTxt: { color: '#fff', fontSize: 10, fontWeight: '700' },
  featuredCardFooter:    { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#00000088', padding: 12, gap: 2 },
  featuredCardTitle:     { color: '#fff', fontSize: 14, fontWeight: '700', lineHeight: 19 },
  featuredCardPriceRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  featuredCardPrice:     { color: '#ff4500', fontSize: 16, fontWeight: '800' },
  featuredCardSeller:    { color: '#aaa', fontSize: 11 },
  featuredTimeLeft:      { color: '#888', fontSize: 10, marginTop: 2 },
  featuredDots:          { position: 'absolute', bottom: 78, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 4 },
  featuredDot:           { width: 5, height: 5, borderRadius: 3, backgroundColor: '#ffffff44' },
  featuredDotActive:     { backgroundColor: '#fff', width: 14 },

  // ── Boost modal
  boostModal:            { flex: 1, backgroundColor: '#0a0a0a', paddingTop: 12 },
  boostHandle:           { width: 40, height: 4, borderRadius: 2, backgroundColor: '#333', alignSelf: 'center', marginBottom: 16 },
  boostHeader:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 4 },
  boostTitle:            { color: '#fff', fontSize: 18, fontWeight: '800' },
  boostSubtitle:         { color: '#666', fontSize: 13, paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#1a1a1a', marginBottom: 20 },
  boostCard:             { backgroundColor: '#111', borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#1e2a3a' },
  boostCardDim:          { opacity: 0.7 },
  boostCardHeader:       { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  boostCardIcon:         { fontSize: 28 },
  boostCardTitle:        { color: '#fff', fontSize: 15, fontWeight: '700' },
  boostCardMeta:         { color: '#666', fontSize: 12 },
  boostPropsPill:        { backgroundColor: '#1a1400', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, alignItems: 'center', borderWidth: 1, borderColor: '#ffcc0033' },
  boostPropsCost:        { color: '#ffcc00', fontSize: 16, fontWeight: '800' },
  boostPropsLabel:       { color: '#888', fontSize: 10 },
  boostCardBody:         { color: '#888', fontSize: 13, lineHeight: 19, marginBottom: 12 },
  boostBalanceRow:       { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#0d1117', borderRadius: 10, padding: 12, marginBottom: 10 },
  boostBalanceLabel:     { color: '#666', fontSize: 13 },
  boostBalanceVal:       { color: '#00e676', fontSize: 13, fontWeight: '700' },
  boostHint:             { flexDirection: 'row', gap: 8, backgroundColor: '#1a1a1a', borderRadius: 10, padding: 10, marginBottom: 12, alignItems: 'flex-start' },
  boostHintTxt:          { flex: 1, color: '#888', fontSize: 12, lineHeight: 17 },
  boostPropsBtn:         { backgroundColor: '#ffcc00', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  boostBtnDisabled:      { backgroundColor: '#2a2a00', opacity: 0.6 },
  boostBtnTxt:           { color: '#000', fontSize: 15, fontWeight: '800' },
  boostSectionLabel:     { color: '#555', fontSize: 12, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase', marginVertical: 10 },
  boostPaidRow:          { flexDirection: 'row', alignItems: 'center', backgroundColor: '#111', borderRadius: 14, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: '#1e1e1e' },
  boostPaidLabel:        { color: '#fff', fontSize: 14, fontWeight: '700', marginBottom: 2 },
  boostPaidMeta:         { color: '#666', fontSize: 12 },
  boostPaidPrice:        { color: '#ff4500', fontSize: 18, fontWeight: '800' },
  boostExplainer:        { backgroundColor: '#111', borderRadius: 14, padding: 16, marginTop: 6, borderWidth: 1, borderColor: '#1e2a3a' },
  boostExplainerTitle:   { color: '#aaa', fontSize: 13, fontWeight: '700', marginBottom: 8 },
  boostExplainerBody:    { color: '#666', fontSize: 13, lineHeight: 20 },

  // ── Filter modal
  filterModal:       { flex: 1, backgroundColor: '#0a0a0a' },
  filterHeader:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: Platform.OS === 'ios' ? 54 : 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  filterTitle:       { color: '#fff', fontSize: 18, fontWeight: '700' },
  filterBody:        { flex: 1, paddingHorizontal: 20, paddingTop: 20 },
  filterFooter:      { flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingBottom: Platform.OS === 'ios' ? 34 : 20, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#1a1a1a' },
  clearBtn:          { flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: '#1a1a1a', alignItems: 'center' },
  clearBtnTxt:       { color: '#888', fontSize: 15, fontWeight: '600' },
  applyBtn:          { flex: 2, paddingVertical: 14, borderRadius: 12, backgroundColor: '#ff4500', alignItems: 'center' },
  applyBtnTxt:       { color: '#fff', fontSize: 15, fontWeight: '700' },
});
