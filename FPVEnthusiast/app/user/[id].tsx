// app/user/[id].tsx
// Public user/seller profile
// Tabs: Posts (photo grid) | Listings (active marketplace cards)
// Shows seller reputation card when user has a seller_profile

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, Image, StyleSheet, ScrollView,
  TouchableOpacity, FlatList, ActivityIndicator,
  Dimensions, RefreshControl, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { supabase }     from '../../src/services/supabase';
import { useAuth }      from '../../src/context/AuthContext';
import { useFollows }   from '../../src/hooks/useFollows';
import type { UserProfile } from '../../src/types/profile';
import ProfileAvatarDecoration from '../../src/components/ProfileAvatarDecoration';
import ProfileBannerMedia from '../../src/components/ProfileBannerMedia';
import { useResolvedProfileAppearance } from '../../src/hooks/useProfileAppearance';
import {
  CATEGORIES, CONDITIONS,
} from '../../src/hooks/useMarketplace';

const { width: W } = Dimensions.get('window');
const CELL         = (W - 6) / 3;
const CARD_W       = (W - 40) / 2;   // two-col listing cards

// ─── Types ─────────────────────────────────────────────────────────────────────
interface Post {
  id: string;
  media_url:     string | null;
  thumbnail_url: string | null;
  social_url:    string | null;
  platform:      string | null;
  caption:       string | null;
  created_at:    string;
}

interface SellerListing {
  id: string;
  title: string;
  price: number;
  condition: string;
  category: string;
  free_shipping: boolean;
  lipo_hazmat: boolean;
  listing_type: string;
  current_bid: number | null;
  listing_images: { url: string; is_primary: boolean }[];
}

interface SellerStats {
  avg_rating:        number | null;
  total_sales:       number;
  verification_tier: number;
  stripe_onboarded:  boolean;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function thumbUri(post: Post): string | null {
  if (post.thumbnail_url) return post.thumbnail_url;
  if (post.media_url)     return post.media_url;
  if (post.platform === 'youtube' && post.social_url) {
    const m = post.social_url.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_\-]{11})/);
    if (m) return `https://img.youtube.com/vi/${m[1]}/mqdefault.jpg`;
  }
  return null;
}
function conditionColor(c: string) {
  return CONDITIONS.find(x => x.value === c)?.color ?? '#888';
}
function conditionLabel(c: string) {
  return CONDITIONS.find(x => x.value === c)?.label ?? c;
}
function starStr(r: number | null) {
  if (!r) return null;
  const f = Math.round(r);
  return '★'.repeat(f) + '☆'.repeat(Math.max(0, 5 - f));
}
const TIER_LABELS = ['', 'Email verified', 'ID verified', 'ID + Stripe ✅'];

// ─── Seller reputation card ────────────────────────────────────────────────────
function SellerRepCard({ stats }: { stats: SellerStats }) {
  const tier = Math.min(stats.verification_tier, 3);
  return (
    <View style={styles.repCard}>
      <Text style={styles.repTitle}>Seller Reputation</Text>
      <View style={styles.repRow}>
        {stats.avg_rating != null ? (
          <>
            <Text style={styles.repStar}>{starStr(stats.avg_rating)}</Text>
            <Text style={styles.repRating}>{stats.avg_rating.toFixed(1)}</Text>
          </>
        ) : (
          <Text style={styles.repNoRating}>No ratings yet</Text>
        )}
        <Text style={styles.repSales}>
          {stats.total_sales > 0 ? `· ${stats.total_sales} sale${stats.total_sales !== 1 ? 's' : ''}` : '· 0 sales'}
        </Text>
      </View>
      {tier > 0 && (
        <View style={styles.repTierRow}>
          <Ionicons
            name={tier >= 3 ? 'shield-checkmark' : 'shield-outline'}
            size={13}
            color={tier >= 3 ? '#22c55e' : tier >= 2 ? '#3b82f6' : '#f59e0b'}
          />
          <Text style={styles.repTierTxt}>{TIER_LABELS[tier]}</Text>
        </View>
      )}
    </View>
  );
}

// ─── Listing mini-card ─────────────────────────────────────────────────────────
function ListingCard({
  item, onPress,
}: { item: SellerListing; onPress: () => void }) {
  const primaryImg = item.listing_images?.find(i => i.is_primary)?.url
    ?? item.listing_images?.[0]?.url;
  const cat = CATEGORIES.find(c => c.slug === item.category);
  const displayPrice = item.listing_type === 'auction' && item.current_bid
    ? item.current_bid
    : item.price;

  return (
    <TouchableOpacity style={styles.listCard} onPress={onPress} activeOpacity={0.85}>
      {primaryImg ? (
        <Image source={{ uri: primaryImg }} style={styles.listCardImg} resizeMode="cover" />
      ) : (
        <View style={[styles.listCardImg, styles.listCardImgPh]}>
          <Text style={{ fontSize: 28 }}>{cat?.icon ?? '📦'}</Text>
        </View>
      )}
      <View style={styles.listCardBody}>
        <Text style={styles.listCardTitle} numberOfLines={2}>{item.title}</Text>
        <View style={styles.listCardMeta}>
          <View style={[styles.listCardCond, { borderColor: conditionColor(item.condition) + '88' }]}>
            <Text style={[styles.listCardCondTxt, { color: conditionColor(item.condition) }]}>
              {conditionLabel(item.condition)}
            </Text>
          </View>
          {item.free_shipping && (
            <View style={styles.listCardFree}>
              <Text style={styles.listCardFreeTxt}>Free ship</Text>
            </View>
          )}
        </View>
        <Text style={styles.listCardPrice}>${displayPrice.toFixed(2)}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Main screen ───────────────────────────────────────────────────────────────
type Tab = 'posts' | 'listings';

export default function UserProfileScreen() {
  const { id }       = useLocalSearchParams<{ id: string }>();
  const router       = useRouter();
  const { user }     = useAuth();

  const [profile,      setProfile]      = useState<UserProfile | null>(null);
  const [posts,        setPosts]        = useState<Post[]>([]);
  const [listings,     setListings]     = useState<SellerListing[]>([]);
  const [sellerStats,  setSellerStats]  = useState<SellerStats | null>(null);
  const [loadingP,     setLoadingP]     = useState(true);
  const [loadingL,     setLoadingL]     = useState(false);
  const [refreshing,   setRefreshing]   = useState(false);
  const [activeTab,    setActiveTab]    = useState<Tab>('posts');
  const [liveFollowersCount, setLiveFollowersCount] = useState(0);
  const [liveFollowingCount, setLiveFollowingCount] = useState(0);
  const { appearance } = useResolvedProfileAppearance(profile?.id);

  const tabAnim = useRef(new Animated.Value(0)).current; // 0=posts, 1=listings

  const {
    isFollowing, toggling,
    toggle: toggleFollow,
  } = useFollows(user?.id, id);

  // ── Load profile + posts ──────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!id) return;
    const [
      { data: prof },
      { data: postsData },
      { count: fc },
      { count: fing },
      { data: spData },
    ] = await Promise.all([
      supabase.from('users').select('*').eq('id', id).single(),
      supabase.from('posts')
        .select('id, media_url, thumbnail_url, social_url, platform, caption, created_at')
        .eq('user_id', id).order('created_at', { ascending: false }).limit(60),
      supabase.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', id),
      supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', id),
      supabase.from('seller_profiles')
        .select('avg_rating, total_sales, verification_tier, stripe_onboarded')
        .eq('user_id', id).maybeSingle(),
    ]);
    setProfile(prof as UserProfile);
    setPosts((postsData as Post[]) ?? []);
    setLiveFollowersCount(fc ?? 0);
    setLiveFollowingCount(fing ?? 0);
    if (spData) setSellerStats(spData as SellerStats);
    setLoadingP(false);
  }, [id]);

  // ── Load listings (lazy — only when Listings tab first opened) ─────────────
  const loadListings = useCallback(async () => {
    if (!id || loadingL) return;
    setLoadingL(true);
    const { data } = await supabase
      .from('marketplace_listings')
      .select(`
        id, title, price, condition, category, free_shipping, lipo_hazmat,
        listing_type, current_bid,
        listing_images (url, is_primary)
      `)
      .eq('seller_id', id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(40);
    setListings((data ?? []) as SellerListing[]);
    setLoadingL(false);
  }, [id, loadingL]);

  useEffect(() => { loadData(); }, [loadData]);

  // Switch tab with slide animation + lazy-load listings
  const switchTab = useCallback((tab: Tab) => {
    setActiveTab(tab);
    Animated.spring(tabAnim, {
      toValue: tab === 'posts' ? 0 : 1,
      useNativeDriver: true,
      friction: 8,
      tension: 60,
    }).start();
    if (tab === 'listings' && listings.length === 0) {
      loadListings();
    }
  }, [tabAnim, listings.length, loadListings]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    if (activeTab === 'listings') await loadListings();
    setRefreshing(false);
  }, [loadData, loadListings, activeTab]);

  // ── Loading / not found ───────────────────────────────────────────────────
  if (loadingP) return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color="#ff4500" />
    </View>
  );
  if (!profile) return (
    <View style={styles.center}>
      <Text style={styles.errorText}>User not found.</Text>
    </View>
  );

  const isOwnProfile = user?.id === id;
  const tabIndicatorX = tabAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, W / 2],
  });

  // ── Post grid cell ────────────────────────────────────────────────────────
  const renderCell = ({ item }: { item: Post }) => {
    const uri  = thumbUri(item);
    const isYT = item.platform === 'youtube';
    return (
      <TouchableOpacity style={styles.cell} activeOpacity={0.8}>
        {uri
          ? <Image source={{ uri }} style={styles.cellImage} resizeMode="cover" />
          : <View style={[styles.cellImage, styles.cellPlaceholder]}>
              <Ionicons name="image-outline" size={28} color="#444" />
            </View>
        }
        {isYT && (
          <View style={styles.ytBadge}>
            <Ionicons name="logo-youtube" size={12} color="#ff0000" />
          </View>
        )}
      </TouchableOpacity>
    );
  };

  // ── Listing grid cell ─────────────────────────────────────────────────────
  const renderListing = ({ item, index }: { item: SellerListing; index: number }) => (
    <View style={index % 2 === 0 ? styles.listColLeft : styles.listColRight}>
      <ListingCard
        item={item}
        onPress={() => router.push({ pathname: '/listing/[id]', params: { id: item.id } })}
      />
    </View>
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      {/* header bar */}
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={26} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerBarTitle}>@{profile.username ?? 'user'}</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#ff4500" />}
      >
        {/* banner */}
        <ProfileBannerMedia
          imageUrl={profile.header_image_url}
          videoUrl={profile.header_video_url}
          height={160}
          startColor={appearance.theme.bannerStartColor}
          endColor={appearance.theme.bannerEndColor}
          emptyHint="Profile banner"
        />

        {/* profile info */}
        <View style={styles.infoBlock}>
          <View style={styles.avatarRow}>
            <ProfileAvatarDecoration
              appearance={appearance}
              avatarUrl={profile.avatar_url}
              size={80}
              fallbackIconSize={32}
            />
            {!isOwnProfile && (
              <TouchableOpacity
                style={[styles.followBtn, { backgroundColor: appearance.theme.accentColor }, isFollowing && styles.followBtnActive]}
                onPress={toggleFollow}
                disabled={toggling}
              >
                {toggling
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.followBtnText}>{isFollowing ? 'Unfollow' : 'Follow'}</Text>
                }
              </TouchableOpacity>
            )}
          </View>

          <Text style={[styles.username, { color: appearance.theme.textColor }]}>@{profile.username ?? 'user'}</Text>
          {profile.bio ? <Text style={[styles.bio, { color: appearance.theme.mutedTextColor }]}>{profile.bio}</Text> : null}

          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statNum}>{posts.length}</Text>
              <Text style={styles.statLabel}>Posts</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statNum}>{liveFollowersCount}</Text>
              <Text style={styles.statLabel}>Followers</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statNum}>{liveFollowingCount}</Text>
              <Text style={styles.statLabel}>Following</Text>
            </View>
            {sellerStats && sellerStats.total_sales > 0 && (
              <View style={styles.statItem}>
                <Text style={[styles.statNum, { color: appearance.theme.accentColor }]}>{sellerStats.total_sales}</Text>
                <Text style={styles.statLabel}>Sales</Text>
              </View>
            )}
          </View>

          {/* Seller rep card — only if they've sold at least once or have a rating */}
          {sellerStats && (sellerStats.avg_rating != null || sellerStats.verification_tier > 0) && (
            <SellerRepCard stats={sellerStats} />
          )}
        </View>

        {/* ── Tab bar ── */}
        <View style={styles.tabBar}>
          <TouchableOpacity style={styles.tabBtn} onPress={() => switchTab('posts')}>
            <Text style={[styles.tabTxt, activeTab === 'posts' && styles.tabTxtActive]}>
              Posts  {posts.length > 0 ? `(${posts.length})` : ''}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.tabBtn} onPress={() => switchTab('listings')}>
            <Text style={[styles.tabTxt, activeTab === 'listings' && styles.tabTxtActive]}>
              Listings
            </Text>
          </TouchableOpacity>
          {/* sliding indicator */}
          <Animated.View style={[styles.tabIndicator, { backgroundColor: appearance.theme.accentColor, transform: [{ translateX: tabIndicatorX }] }]} />
        </View>

        {/* ── Posts tab ── */}
        {activeTab === 'posts' && (
          <FlatList
            data={posts}
            keyExtractor={item => item.id}
            renderItem={renderCell}
            numColumns={3}
            scrollEnabled={false}
            ListEmptyComponent={
              <View style={styles.emptyGrid}>
                <Ionicons name="images-outline" size={48} color="#333" />
                <Text style={styles.emptyGridText}>No posts yet</Text>
              </View>
            }
          />
        )}

        {/* ── Listings tab ── */}
        {activeTab === 'listings' && (
          loadingL
            ? <ActivityIndicator color="#ff4500" style={{ marginTop: 40 }} />
            : listings.length === 0
              ? (
                <View style={styles.emptyGrid}>
                  <Text style={{ fontSize: 36 }}>🛸</Text>
                  <Text style={styles.emptyGridText}>No active listings</Text>
                </View>
              )
              : (
                <FlatList
                  data={listings}
                  keyExtractor={item => item.id}
                  renderItem={renderListing}
                  numColumns={2}
                  scrollEnabled={false}
                  contentContainerStyle={styles.listingsGrid}
                />
              )
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:          { flex: 1, backgroundColor: '#0a0a0a' },
  center:             { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0a0a0a' },
  errorText:          { color: '#888', fontSize: 16 },
  headerBar:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 52, paddingBottom: 10, paddingHorizontal: 16, backgroundColor: '#0a0a0a' },
  headerBarTitle:     { color: '#fff', fontSize: 17, fontWeight: '600' },
  banner:             { width: '100%', height: 160, resizeMode: 'cover' },
  bannerPlaceholder:  { width: '100%', height: 160, backgroundColor: '#1a1a1a' },
  infoBlock:          { backgroundColor: '#0a0a0a', paddingHorizontal: 16, paddingBottom: 4 },
  avatarRow:          { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: -36 },
  avatar:             { width: 80, height: 80, borderRadius: 40, borderWidth: 3, borderColor: '#0a0a0a' },
  avatarPlaceholder:  { backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center' },
  followBtn:          { paddingHorizontal: 22, paddingVertical: 8, borderRadius: 8, backgroundColor: '#ff4500' },
  followBtnActive:    { backgroundColor: '#2a2a2a', borderWidth: 1, borderColor: '#ff4500' },
  followBtnText:      { color: '#fff', fontWeight: '700', fontSize: 14 },
  username:           { color: '#fff', fontWeight: '700', fontSize: 17, marginTop: 10 },
  bio:                { color: '#aaa', fontSize: 13, marginTop: 4, lineHeight: 18 },
  statsRow:           { flexDirection: 'row', gap: 28, marginTop: 14, marginBottom: 14 },
  statItem:           { alignItems: 'center' },
  statNum:            { color: '#fff', fontWeight: '700', fontSize: 17 },
  statLabel:          { color: '#888', fontSize: 11, marginTop: 2 },

  // seller rep card
  repCard:            { backgroundColor: '#111', borderRadius: 12, borderWidth: 1, borderColor: '#ffd70033', padding: 12, marginBottom: 14 },
  repTitle:           { color: '#ffd700', fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginBottom: 6 },
  repRow:             { flexDirection: 'row', alignItems: 'center', gap: 6 },
  repStar:            { color: '#f59e0b', fontSize: 14, letterSpacing: 1 },
  repRating:          { color: '#fff', fontWeight: '700', fontSize: 15 },
  repNoRating:        { color: '#555', fontSize: 13 },
  repSales:           { color: '#888', fontSize: 13 },
  repTierRow:         { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  repTierTxt:         { color: '#aaa', fontSize: 12 },

  // tab bar
  tabBar:             { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#1a1a1a', marginTop: 6, position: 'relative' },
  tabBtn:             { flex: 1, paddingVertical: 13, alignItems: 'center' },
  tabTxt:             { color: '#555', fontSize: 13, fontWeight: '600' },
  tabTxtActive:       { color: '#fff' },
  tabIndicator:       { position: 'absolute', bottom: 0, left: 0, width: W / 2, height: 2, backgroundColor: '#ff4500', borderRadius: 1 },

  // posts grid
  cell:               { width: CELL, height: CELL, margin: 1 },
  cellImage:          { width: '100%', height: '100%' },
  cellPlaceholder:    { backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center' },
  ytBadge:            { position: 'absolute', bottom: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 4, padding: 2 },
  emptyGrid:          { alignItems: 'center', paddingVertical: 40, gap: 10 },
  emptyGridText:      { color: '#555', fontSize: 14 },

  // listings grid
  listingsGrid:       { padding: 12, gap: 10 },
  listColLeft:        { flex: 1, marginRight: 5 },
  listColRight:       { flex: 1, marginLeft: 5 },
  listCard:           { backgroundColor: '#111', borderRadius: 12, borderWidth: 1, borderColor: '#1e1e2e', overflow: 'hidden', marginBottom: 10 },
  listCardImg:        { width: '100%', height: CARD_W * 0.75 },
  listCardImgPh:      { backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center' },
  listCardBody:       { padding: 10 },
  listCardTitle:      { color: '#e0e8f0', fontSize: 13, fontWeight: '600', lineHeight: 18, marginBottom: 6 },
  listCardMeta:       { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginBottom: 6 },
  listCardCond:       { borderWidth: 1, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  listCardCondTxt:    { fontSize: 10, fontWeight: '700' },
  listCardFree:       { backgroundColor: '#22c55e15', borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2 },
  listCardFreeTxt:    { color: '#22c55e', fontSize: 10, fontWeight: '600' },
  listCardPrice:      { color: '#ff4500', fontSize: 15, fontWeight: '900' },
});
