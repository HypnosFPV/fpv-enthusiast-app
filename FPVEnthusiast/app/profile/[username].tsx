// app/profile/[username].tsx
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, Image, StyleSheet, FlatList, TouchableOpacity,
  Dimensions, ActivityIndicator, ScrollView, Modal,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../../src/services/supabase';
import { useAuth } from '../../src/context/AuthContext';
import PostCard from '../../src/components/PostCard';
import { useFollow } from '../../src/hooks/useFollow';
import type { FeedPost } from '../../src/hooks/useFeed';

const { width: W } = Dimensions.get('window');
const CELL = (W - 4) / 3;

// ─── interfaces ──────────────────────────────────────────────────────────────

interface Profile {
  id: string;
  username: string;
  bio?: string;
  avatar_url?: string;
  header_image_url?: string;
  followers_count?: number;
  following_count?: number;
}

interface Post {
  id: string;
  user_id: string;
  caption?: string;
  media_url?: string;
  media_type?: string;
  platform?: string;
  created_at: string;
  likes_count?: number;
  comments_count?: number;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function getYoutubeVideoId(url: string): string | null {
  const patterns = [
    /youtu\.be\/([^?&]+)/,
    /youtube\.com\/watch\?v=([^?&]+)/,
    /youtube\.com\/embed\/([^?&]+)/,
    /youtube-nocookie\.com\/embed\/([^?&]+)/,
    /youtube\.com\/shorts\/([^?&]+)/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

function isInstagramUrl(url: string): boolean {
  return /instagram\.com/i.test(url);
}

function thumbnailUri(post: Post): string | null {
  // ✅ Broadened guard — catches file:// (Android) and file:/ (iOS single-slash)
  if (!post.media_url || post.media_url.startsWith('file:')) return null;

  // YouTube → mqdefault thumbnail
  const vid = getYoutubeVideoId(post.media_url);
  if (vid) return `https://img.youtube.com/vi/${vid}/mqdefault.jpg`;

  // Direct image file
  if (/\.(jpg|jpeg|png|gif|webp)/i.test(post.media_url)) return post.media_url;

  // Instagram — handled as gradient in renderGridCell
  return null;
}

function toFeedPost(p: Post, profile: Profile): FeedPost {
  const isSocialEmbed = p.media_type === 'social_embed';
  return {
    id:            p.id,
    user_id:       p.user_id,
    caption:       p.caption      ?? '',
    media_url:     isSocialEmbed  ? null                  : (p.media_url ?? null),
    media_type:    p.media_type   ?? null,
    platform:      p.platform     ?? null,
    social_url:    isSocialEmbed  ? (p.media_url ?? null) : null,
    created_at:    p.created_at,
    like_count:    p.likes_count    ?? 0,
    comment_count: p.comments_count ?? 0,
    isLiked:       false,
    users: {
      id:         profile.id,
      username:   profile.username,
      avatar_url: profile.avatar_url ?? null,
    },
  } as FeedPost;
}

// ─── stat box ─────────────────────────────────────────────────────────────────

function StatBox({ label, value }: { label: string; value: number | string }) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// ─── main screen ─────────────────────────────────────────────────────────────

export default function UserProfileScreen() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const router = useRouter();
  const { user: currentUser } = useAuth();

  const [profile,      setProfile]      = useState<Profile | null>(null);
  const [posts,        setPosts]        = useState<Post[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [notFound,     setNotFound]     = useState(false);
  const [activeTab,    setActiveTab]    = useState<'grid' | 'feed'>('grid');
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);

  const {
    isFollowing, followersCount, followingCount,
    toggling, checkingFollow, toggleFollow,
  } = useFollow(profile?.id ?? '', currentUser?.id);

  useEffect(() => {
    if (!username) return;
    (async () => {
      setLoading(true);
      const { data: prof, error } = await supabase
        .from('users')
        .select('id, username, bio, avatar_url, header_image_url, followers_count, following_count')
        .eq('username', username)
        .single();

      if (error || !prof) { setNotFound(true); setLoading(false); return; }
      setProfile(prof);

      const { data: postData } = await supabase
        .from('posts')
        .select('id, user_id, caption, media_url, media_type, platform, created_at, likes_count, comments_count')
        .eq('user_id', prof.id)
        .order('created_at', { ascending: false });

      setPosts(postData ?? []);
      setLoading(false);
    })();
  }, [username]);

  // ── grid cell ─────────────────────────────────────────────────────────────
  const renderGridCell = useCallback(({ item }: { item: Post }) => {
    const thumb = thumbnailUri(item);
    const isYT  = !!item.media_url && !!getYoutubeVideoId(item.media_url);
    const isIG  = !!item.media_url && isInstagramUrl(item.media_url);
    const isVid = item.media_type === 'video';

    return (
      <TouchableOpacity style={styles.cell} onPress={() => setSelectedPost(item)} activeOpacity={0.8}>

        {/* ── thumbnail / placeholder ─────────────────────────────── */}
        {thumb ? (
          <Image source={{ uri: thumb }} style={styles.cellImg} />
        ) : isIG ? (
          // ✅ Instagram gradient — uses expo-linear-gradient (run: npx expo install expo-linear-gradient)
          <LinearGradient
            colors={['#405de6', '#5851db', '#833ab4', '#c13584', '#e1306c', '#fd1d1d']}
            start={{ x: 0, y: 1 }}
            end={{ x: 1, y: 0 }}
            style={styles.cellImg}
          >
            <View style={styles.igInner}>
              <Ionicons name="logo-instagram" size={30} color="#fff" />
              <Text style={styles.igLabel}>Instagram</Text>
            </View>
          </LinearGradient>
        ) : (
          <View style={[styles.cellImg, styles.cellPlaceholder]}>
            <Ionicons name="videocam-outline" size={24} color="#555" />
          </View>
        )}

        {/* ── badges ──────────────────────────────────────────────── */}
        {isYT && (
          <View style={styles.ytBadge}>
            <Ionicons name="logo-youtube" size={12} color="#fff" />
          </View>
        )}
        {isIG && (
          <View style={styles.igBadge}>
            <Ionicons name="logo-instagram" size={12} color="#fff" />
          </View>
        )}
        {isVid && !isYT && !isIG && (
          <View style={styles.playBadge}>
            <Ionicons name="play" size={12} color="#fff" />
          </View>
        )}

      </TouchableOpacity>
    );
  }, []);

  // ── guard states ──────────────────────────────────────────────────────────
  if (loading) return (
    <View style={styles.loadingScreen}>
      <ActivityIndicator color="#7c3aed" size="large" />
    </View>
  );

  if (notFound || !profile) return (
    <View style={styles.loadingScreen}>
      <Ionicons name="person-outline" size={48} color="#555" />
      <Text style={{ color: '#888', marginTop: 12 }}>User not found</Text>
      <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 20 }}>
        <Text style={{ color: '#7c3aed' }}>Go back</Text>
      </TouchableOpacity>
    </View>
  );

  const isOwnProfile = currentUser?.id === profile.id;

  return (
    <View style={styles.root}>

      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.topBarTitle} numberOfLines={1}>@{profile.username}</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>

        <View style={styles.bannerWrap}>
          {profile.header_image_url
            ? <Image source={{ uri: profile.header_image_url }} style={styles.banner} resizeMode="cover" />
            : <View style={[styles.banner, styles.bannerPlaceholder]} />}
        </View>

        <View style={styles.avatarRow}>
          {profile.avatar_url
            ? <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
            : <View style={[styles.avatar, styles.avatarPlaceholder]}>
                <Ionicons name="person" size={36} color="#555" />
              </View>}

          {!isOwnProfile && !checkingFollow && (
            <TouchableOpacity
              style={[styles.followBtn, isFollowing && styles.followingBtn]}
              onPress={toggleFollow}
              disabled={toggling}
              activeOpacity={0.8}
            >
              {toggling
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={[styles.followBtnText, isFollowing && styles.followingBtnText]}>
                    {isFollowing ? 'Following' : 'Follow'}
                  </Text>}
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.bioSection}>
          <Text style={styles.usernameText}>@{profile.username}</Text>
          {!!profile.bio && <Text style={styles.bioText}>{profile.bio}</Text>}
        </View>

        <View style={styles.statsRow}>
          <StatBox label="Posts"     value={posts.length} />
          <StatBox label="Followers" value={followersCount} />
          <StatBox label="Following" value={followingCount} />
        </View>

        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'grid' && styles.tabActive]}
            onPress={() => setActiveTab('grid')}
          >
            <Ionicons name="grid-outline" size={20} color={activeTab === 'grid' ? '#7c3aed' : '#666'} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'feed' && styles.tabActive]}
            onPress={() => setActiveTab('feed')}
          >
            <Ionicons name="list-outline" size={20} color={activeTab === 'feed' ? '#7c3aed' : '#666'} />
          </TouchableOpacity>
        </View>

        {activeTab === 'grid' ? (
          <FlatList
            data={posts}
            keyExtractor={p => p.id}
            numColumns={3}
            renderItem={renderGridCell}
            scrollEnabled={false}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={{ color: '#555' }}>No posts yet</Text>
              </View>
            }
          />
        ) : (
          posts.map(p => (
            <PostCard
              key={p.id}
              post={toFeedPost(p, profile)}
              isVisible={false}
              shouldAutoplay={false}
              currentUserId={currentUser?.id ?? undefined}
              onLike={() => {}}
              onDelete={() => {}}
            />
          ))
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      <Modal
        visible={!!selectedPost}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setSelectedPost(null)}
      >
        <View style={styles.overlayRoot}>
          <TouchableOpacity style={styles.overlayBack} onPress={() => setSelectedPost(null)}>
            <Ionicons name="arrow-back" size={22} color="#fff" />
            <Text style={{ color: '#fff', marginLeft: 8 }}>Back</Text>
          </TouchableOpacity>
          {selectedPost && (
            <ScrollView>
              <PostCard
                post={toFeedPost(selectedPost, profile)}
                isVisible={true}
                shouldAutoplay={false}
                currentUserId={currentUser?.id ?? undefined}
                onLike={() => {}}
                onDelete={() => setSelectedPost(null)}
              />
            </ScrollView>
          )}
        </View>
      </Modal>
    </View>
  );
}

// ─── styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:              { flex: 1, backgroundColor: '#0f0f23' },
  scroll:            { flex: 1 },
  loadingScreen:     { flex: 1, backgroundColor: '#0f0f23', alignItems: 'center', justifyContent: 'center' },

  topBar:            { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                       paddingHorizontal: 14, paddingTop: 52, paddingBottom: 10,
                       backgroundColor: '#0f0f23', zIndex: 10 },
  backBtn:           { padding: 4 },
  topBarTitle:       { color: '#fff', fontSize: 16, fontWeight: '700', flex: 1, textAlign: 'center' },

  bannerWrap:        { width: '100%', height: 160, overflow: 'hidden' },
  banner:            { width: '100%', height: 160 },
  bannerPlaceholder: { backgroundColor: '#1a1a2e' },

  avatarRow:         { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
                       paddingHorizontal: 16, marginTop: -44 },
  avatar:            { width: 88, height: 88, borderRadius: 44,
                       borderWidth: 3, borderColor: '#0f0f23' },
  avatarPlaceholder: { backgroundColor: '#1e1e3a', alignItems: 'center', justifyContent: 'center' },

  followBtn:         { backgroundColor: '#7c3aed', borderRadius: 20,
                       paddingHorizontal: 22, paddingVertical: 9, marginBottom: 4 },
  followingBtn:      { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#7c3aed' },
  followBtnText:     { color: '#fff', fontSize: 14, fontWeight: '700' },
  followingBtnText:  { color: '#7c3aed' },

  bioSection:        { paddingHorizontal: 16, marginTop: 10 },
  usernameText:      { color: '#fff', fontSize: 16, fontWeight: '700' },
  bioText:           { color: '#aaa', fontSize: 13, marginTop: 4, lineHeight: 18 },

  statsRow:          { flexDirection: 'row', justifyContent: 'space-around',
                       paddingVertical: 14, marginTop: 10,
                       borderTopWidth: StyleSheet.hairlineWidth,    borderTopColor: '#1e1e3a',
                       borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#1e1e3a' },
  statBox:           { alignItems: 'center', flex: 1 },
  statValue:         { color: '#fff', fontSize: 17, fontWeight: '700' },
  statLabel:         { color: '#888', fontSize: 11, marginTop: 2 },

  tabBar:            { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth,
                       borderBottomColor: '#1e1e3a', marginTop: 4 },
  tab:               { flex: 1, alignItems: 'center', paddingVertical: 10 },
  tabActive:         { borderBottomWidth: 2, borderBottomColor: '#7c3aed' },

  cell:              { width: CELL, height: CELL, margin: 1, backgroundColor: '#1a1a2e' },
  cellImg:           { width: '100%', height: '100%' },
  cellPlaceholder:   { alignItems: 'center', justifyContent: 'center', backgroundColor: '#1a1a2e' },

  igInner:           { flex: 1, alignItems: 'center', justifyContent: 'center' },
  igLabel:           { color: '#fff', fontSize: 9, fontWeight: '600',
                       marginTop: 4, letterSpacing: 0.5 },

  ytBadge:           { position: 'absolute', bottom: 4, left: 4,
                       backgroundColor: '#ff0000', borderRadius: 4, padding: 2 },
  igBadge:           { position: 'absolute', bottom: 4, left: 4,
                       backgroundColor: '#833ab4', borderRadius: 4, padding: 2 },
  playBadge:         { position: 'absolute', bottom: 4, right: 4,
                       backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 4, padding: 2 },
  empty:             { alignItems: 'center', paddingVertical: 60 },

  overlayRoot:       { flex: 1, backgroundColor: '#0f0f23' },
  overlayBack:       { flexDirection: 'row', alignItems: 'center',
                       paddingTop: 52, paddingBottom: 10, paddingHorizontal: 14 },
});
