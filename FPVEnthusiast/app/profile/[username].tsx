// app/profile/[username].tsx
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, Image, FlatList, TouchableOpacity,
  StyleSheet, Dimensions, ActivityIndicator,
  Modal, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { FontAwesome5 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../../src/services/supabase';
import { useFollow } from '../../src/hooks/useFollow';
import { useAuth } from '../../src/context/AuthContext';
import PostCard from '../../src/components/PostCard';
import ProfileAvatarDecoration from '../../src/components/ProfileAvatarDecoration';
import ProfileBannerMedia from '../../src/components/ProfileBannerMedia';
import { useResolvedProfileAppearance } from '../../src/hooks/useProfileAppearance';
import { useResolvedProfileBadges } from '../../src/hooks/useProfileBadges';
import ProfileBadgeRow from '../../src/components/ProfileBadgeRow';

const { width: SCREEN_W } = Dimensions.get('window');
const CELL = SCREEN_W / 3;
const PROFILE_LIST_PROPS = {
  removeClippedSubviews: true,
  initialNumToRender: 12,
  maxToRenderPerBatch: 12,
  windowSize: 7,
  updateCellsBatchingPeriod: 50,
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface Post {
  id: string;
  user_id: string;
  caption: string | null;
  media_url: string | null;
  media_type: string | null;
  platform: string | null;
  created_at: string;
  likes_count: number | null;
  comments_count: number | null;
}

interface Profile {
  id: string;
  username: string;
  avatar_url: string | null;
  header_image_url: string | null;
  header_video_url: string | null;
  bio: string | null;
  followers_count: number;
  following_count: number;
  posts_count?: number;
}

// PostData shape expected by PostCard
interface PostData {
  id: string;
  user_id?: string | null;
  media_url?: string | null;
  social_url?: string | null;
  embed_url?: string | null;
  media_type?: string | null;
  platform?: string | null;
  thumbnail_url?: string | null;
  caption?: string | null;
  created_at?: string | null;
  isLiked?: boolean;
  likeCount?: number;
  commentCount?: number;
  likes_count?: number;
  comments_count?: number;
  users?: { id?: string | null; username?: string | null; avatar_url?: string | null } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getYoutubeVideoId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(
    /(?:youtube(?:-nocookie)?\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
  );
  return m ? m[1] : null;
}

function isInstagramUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.toLowerCase().includes('instagram');
}

function thumbnailUri(post: Post): string | null {
  const url = post.media_url;
  if (!url || url.startsWith('file:')) return null;
  if (isInstagramUrl(url)) return null;
  const ytId = getYoutubeVideoId(url);
  if (ytId) return `https://img.youtube.com/vi/${ytId}/mqdefault.jpg`;
  if (/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(url)) return url;
  return null;
}

/**
 * Convert raw DB Post row → PostData shape for PostCard.
 * When media_type === 'social_embed', move media_url → social_url
 * so PostCard's resolvedPlatform detection works correctly.
 */
function toPostData(p: Post, profile: Profile): PostData {
  const isSocialEmbed = p.media_type === 'social_embed';
  return {
    id: p.id,
    user_id: p.user_id,
    caption: p.caption ?? '',
    media_url: isSocialEmbed ? null : (p.media_url ?? null),
    social_url: isSocialEmbed ? (p.media_url ?? null) : null,
    embed_url: null,
    media_type: p.media_type ?? null,
    platform: p.platform ?? null,
    thumbnail_url: null,
    created_at: p.created_at,
    likes_count: p.likes_count ?? 0,
    comments_count: p.comments_count ?? 0,
    isLiked: false,
    users: {
      id: profile.id,
      username: profile.username,
      avatar_url: profile.avatar_url ?? null,
    },
  };
}

// ─── StatBox ──────────────────────────────────────────────────────────────────

function StatBox({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function UserProfileScreen() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const router = useRouter();
  const { user: currentUser } = useAuth();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loadingPosts, setLoadingPosts] = useState(true);
  const [activeTab, setActiveTab] = useState<'grid' | 'feed'>('grid');
  const [selectedPost, setSelectedPost] = useState<PostData | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const { appearance } = useResolvedProfileAppearance(profile?.id);
  const { featuredBadges } = useResolvedProfileBadges(profile?.id);

  // useFollow(profileUserId, currentUserId) — matches the real hook signature
  const {
    isFollowing,
    followersCount,
    toggleFollow,
  } = useFollow(profile?.id ?? '', currentUser?.id);

  // ── Fetch profile + posts ──────────────────────────────────────────────────
  useEffect(() => {
    if (!username) return;
    const fetchData = async () => {
      setLoadingProfile(true);
      setLoadingPosts(true);
      try {
        const { data: profileData, error: profileError } = await supabase
          .from('users')
          .select('id, username, avatar_url, header_image_url, header_video_url, bio, followers_count, following_count')
          .eq('username', username)
          .single();

        if (profileError || !profileData) {
          console.error('[Profile] fetch error:', profileError);
          setProfile(null);
          setPosts([]);
          return;
        }

        const [{ data: postsData, error: postsError }, { count: postsCount, error: postsCountError }] = await Promise.all([
          supabase
            .from('posts')
            .select('id, user_id, caption, media_url, media_type, platform, created_at, likes_count, comments_count')
            .eq('user_id', profileData.id)
            .order('created_at', { ascending: false })
            .limit(60),
          supabase
            .from('posts')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', profileData.id),
        ]);

        if (postsCountError) {
          console.warn('[Profile] posts count fetch error:', postsCountError);
        }

        setProfile({
          ...(profileData as Profile),
          posts_count: postsCount ?? postsData?.length ?? 0,
        });
        setLoadingProfile(false);

        if (postsError) {
          console.error('[Profile] posts fetch error:', postsError);
          setPosts([]);
        } else {
          setPosts((postsData ?? []) as Post[]);
        }
      } finally {
        setLoadingProfile(false);
        setLoadingPosts(false);
      }
    };
    fetchData();
  }, [username]);

  // ── Grid cell renderer ─────────────────────────────────────────────────────
  const renderGridCell = useCallback(
    ({ item }: { item: Post }) => {
      const thumb = thumbnailUri(item);
      const ytId = getYoutubeVideoId(item.media_url);
      // Read from raw Post.media_url — NOT from toPostData output
      // (toPostData moves it to social_url, which doesn't exist on Post)
      const isIG = isInstagramUrl(item.media_url);

      const handlePress = () => {
        if (!profile) return;
        setSelectedPost(toPostData(item, profile));
        setModalVisible(true);
      };

      return (
        <TouchableOpacity style={styles.gridCell} onPress={handlePress} activeOpacity={0.85}>

          {/* Instagram gradient placeholder */}
          {isIG && !thumb && (
            <LinearGradient
              colors={['#405de6', '#5851db', '#833ab4', '#c13584', '#e1306c', '#fd1d1d']}
              start={{ x: 0, y: 1 }}
              end={{ x: 1, y: 0 }}
              style={styles.igPlaceholder}
            >
              <FontAwesome5 name="instagram" size={28} color="#fff" />
              <Text style={styles.igPlaceholderLabel}>Instagram</Text>
            </LinearGradient>
          )}

          {/* YouTube / image thumbnail */}
          {thumb && (
            <Image source={{ uri: thumb }} style={styles.gridThumb} resizeMode="cover" />
          )}

          {/* Generic placeholder for local video / unknown */}
          {!isIG && !thumb && (
            <View style={styles.gridPlaceholder}>
              <Ionicons name="camera-outline" size={28} color="#555" />
            </View>
          )}

          {/* YouTube badge */}
          {ytId && (
            <View style={[styles.badge, styles.ytBadge]}>
              <FontAwesome5 name="youtube" size={10} color="#fff" />
            </View>
          )}

          {/* Instagram badge */}
          {isIG && (
            <View style={[styles.badge, styles.igBadge]}>
              <FontAwesome5 name="instagram" size={10} color="#fff" />
            </View>
          )}

          {/* Generic video badge */}
          {!ytId && !isIG && item.media_type === 'video' && (
            <View style={[styles.badge, styles.videoBadge]}>
              <Ionicons name="play" size={10} color="#fff" />
            </View>
          )}
        </TouchableOpacity>
      );
    },
    [profile]
  );

  // ── Feed item renderer ─────────────────────────────────────────────────────
  const renderFeedItem = useCallback(
    ({ item }: { item: Post }) => {
      if (!profile) return null;
      return (
        <PostCard
          post={toPostData(item, profile)}
          currentUserId={currentUser?.id ?? undefined}
        />
      );
    },
    [profile, currentUser]
  );

  // ── Loading / not found states ─────────────────────────────────────────────
  if (loadingProfile) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#ff4500" />
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>User not found</Text>
      </View>
    );
  }

  const isOwnProfile = currentUser?.id === profile.id;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>@{profile.username}</Text>
          <View style={{ width: 40 }} />
        </View>

        <ProfileBannerMedia
          imageUrl={profile.header_image_url}
          videoUrl={profile.header_video_url}
          height={176}
          startColor={appearance.theme.bannerStartColor}
          endColor={appearance.theme.bannerEndColor}
          emptyHint="Profile banner"
        />

        {/* Avatar + Bio */}
        <View style={[styles.bioSection, { marginTop: -44 }]}>
          <ProfileAvatarDecoration
            appearance={appearance}
            avatarUrl={profile.avatar_url}
            size={88}
            fallbackIconSize={40}
          />
          <Text style={[styles.usernameText, { color: appearance.theme.textColor }]}>@{profile.username}</Text>
          {profile.bio ? <Text style={[styles.bioText, { color: appearance.theme.mutedTextColor }]}>{profile.bio}</Text> : null}
          {featuredBadges.length ? (
            <View style={{ marginTop: 12, alignSelf: 'stretch' }}>
              <ProfileBadgeRow
                badges={featuredBadges}
                accentColor={appearance.theme.accentColor}
                borderColor={appearance.theme.borderColor}
                textColor={appearance.theme.textColor}
                mutedTextColor={appearance.theme.mutedTextColor}
              />
            </View>
          ) : null}
        </View>

        {/* Stats */}
        <View style={[styles.statsRow, { borderColor: appearance.theme.borderColor }]}>
          <StatBox value={profile.posts_count ?? 0} label="Posts" />
          <StatBox value={followersCount} label="Followers" />
          <StatBox value={profile.following_count ?? 0} label="Following" />
        </View>

        {/* Follow button — hide on own profile */}
        {!isOwnProfile && (
          <TouchableOpacity
            style={[styles.followBtn, { backgroundColor: appearance.theme.accentColor }, isFollowing && styles.followingBtn]}
            onPress={toggleFollow}
            activeOpacity={0.8}
          >
            <Text style={styles.followBtnText}>{isFollowing ? 'Following' : 'Follow'}</Text>
          </TouchableOpacity>
        )}

        {/* Tab bar */}
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'grid' && styles.activeTab, activeTab === 'grid' && { borderBottomColor: appearance.theme.accentColor }]}
            onPress={() => setActiveTab('grid')}
          >
            <Ionicons name="grid-outline" size={20} color={activeTab === 'grid' ? appearance.theme.accentColor : '#888'} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'feed' && styles.activeTab, activeTab === 'feed' && { borderBottomColor: appearance.theme.accentColor }]}
            onPress={() => setActiveTab('feed')}
          >
            <Ionicons name="list-outline" size={20} color={activeTab === 'feed' ? appearance.theme.accentColor : '#888'} />
          </TouchableOpacity>
        </View>

        {/* Content */}
        {loadingPosts ? (
          <View style={styles.postsLoadingWrap}>
            <ActivityIndicator size="small" color="#ff4500" />
            <Text style={styles.postsLoadingText}>Loading posts…</Text>
          </View>
        ) : activeTab === 'grid' ? (
          <FlatList
            key="profile-grid-3"
            data={posts}
            keyExtractor={(p) => p.id}
            numColumns={3}
            renderItem={renderGridCell}
            scrollEnabled={false}
            getItemLayout={(_, index) => {
              const row = Math.floor(index / 3);
              return { length: CELL, offset: CELL * row, index };
            }}
            {...PROFILE_LIST_PROPS}
          />
        ) : (
          <FlatList
            key="profile-feed-list"
            data={posts}
            keyExtractor={(p) => p.id}
            renderItem={renderFeedItem}
            scrollEnabled={false}
            {...PROFILE_LIST_PROPS}
          />
        )}
      </ScrollView>

      {/* Post detail modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <TouchableOpacity style={styles.modalClose} onPress={() => setModalVisible(false)}>
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          {selectedPost && (
            <PostCard
              post={selectedPost}
              isVisible
              currentUserId={currentUser?.id ?? undefined}
            />
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  scrollContent: { paddingBottom: 40 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0a0a0a' },
  errorText: { color: '#fff', fontSize: 16 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8,
  },
  backBtn: { padding: 4 },
  headerTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },

  bioSection: { alignItems: 'center', paddingHorizontal: 16, marginTop: 10 },
  avatar: { width: 88, height: 88, borderRadius: 44, backgroundColor: '#333' },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  usernameText: { color: '#fff', fontSize: 18, fontWeight: '700', marginTop: 10 },
  bioText: { color: '#aaa', fontSize: 14, marginTop: 4, textAlign: 'center', lineHeight: 18 },

  statsRow: {
    flexDirection: 'row', justifyContent: 'space-around',
    paddingVertical: 14, paddingHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#2a2a2a', marginTop: 14,
  },
  statBox: { alignItems: 'center', flex: 1 },
  statValue: { color: '#fff', fontSize: 17, fontWeight: '700' },
  statLabel: { color: '#aaa', fontSize: 11, marginTop: 2 },

  followBtn: {
    marginHorizontal: 16, marginTop: 14, paddingVertical: 10,
    borderRadius: 8, backgroundColor: '#ff4500', alignItems: 'center',
  },
  followingBtn: { backgroundColor: '#333' },
  followBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  tabBar: {
    flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#2a2a2a', marginTop: 14,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 10 },
  activeTab: { borderBottomWidth: 2, borderBottomColor: '#ff4500' },

  gridCell: { width: CELL, height: CELL, backgroundColor: '#1a1a1a', position: 'relative' },
  gridThumb: { width: '100%', height: '100%' },
  gridPlaceholder: {
    width: '100%', height: '100%',
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#1a1a1a',
  },

  igPlaceholder: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  igPlaceholderLabel: { color: '#fff', fontSize: 11, fontWeight: '600', marginTop: 6 },

  badge: {
    position: 'absolute', bottom: 5, right: 5,
    borderRadius: 4, paddingHorizontal: 4, paddingVertical: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  ytBadge: { backgroundColor: '#FF0000' },
  igBadge: { backgroundColor: '#C13584', right: undefined, left: 5 },
  videoBadge: { backgroundColor: 'rgba(0,0,0,0.65)' },

  postsLoadingWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 28, gap: 10 },
  postsLoadingText: { color: '#9a9a9a', fontSize: 13 },
  modalContainer: { flex: 1, backgroundColor: '#0a0a0a' },
  modalClose: { padding: 12, alignSelf: 'flex-end' },
});
