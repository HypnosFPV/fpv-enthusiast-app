// app/user/[id].tsx
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, Image, StyleSheet, ScrollView,
  TouchableOpacity, FlatList, ActivityIndicator,
  Dimensions, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { supabase }     from '../../src/services/supabase';
import { useAuth }      from '../../src/context/AuthContext';
import { useFollows }   from '../../src/hooks/useFollows';
import type { UserProfile } from '../../src/types/profile';

const { width: W } = Dimensions.get('window');
const CELL = (W - 6) / 3;

/* ─── types ──────────────────────────────────────────────────────── */
interface Post {
  id: string;
  media_url:     string | null;
  thumbnail_url: string | null;
  social_url:    string | null;
  platform:      string | null;
  caption:       string | null;
  created_at:    string;
}

/* ─── helpers ─────────────────────────────────────────────────────── */
function thumbUri(post: Post): string | null {
  if (post.thumbnail_url) return post.thumbnail_url;
  if (post.media_url)     return post.media_url;
  if (post.platform === 'youtube' && post.social_url) {
    const m = post.social_url.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    if (m) return `https://img.youtube.com/vi/${m[1]}/mqdefault.jpg`;
  }
  return null;
}

/* ─── component ──────────────────────────────────────────────────── */
export default function UserProfileScreen() {
  const { id }       = useLocalSearchParams<{ id: string }>();
  const router       = useRouter();
  const { user }     = useAuth();

  const [profile,   setProfile]   = useState<UserProfile | null>(null);
  const [posts,     setPosts]     = useState<Post[]>([]);
  const [loadingP,  setLoadingP]  = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [liveFollowersCount, setLiveFollowersCount] = useState(0);
  const [liveFollowingCount, setLiveFollowingCount] = useState(0);

  const {
    isFollowing, toggling,
    toggle: toggleFollow,
  } = useFollows(user?.id, id);

  /* ── fetch data ─────────────────────────────────────────────────── */
  const loadData = useCallback(async () => {
    if (!id) return;
    const [{ data: prof }, { data: postsData }, { count: fc }, { count: fing }] = await Promise.all([
      supabase.from('users').select('*').eq('id', id).single(),
      supabase.from('posts').select('id, media_url, thumbnail_url, social_url, platform, caption, created_at')
        .eq('user_id', id).order('created_at', { ascending: false }).limit(60),
      // FIX: query follows table directly for accurate counts
      supabase.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', id),
      supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', id),
    ]);
    setProfile(prof as UserProfile);
    setPosts((postsData as Post[]) ?? []);
    setLiveFollowersCount(fc ?? 0);
    setLiveFollowingCount(fing ?? 0);
    setLoadingP(false);
  }, [id]);

  useEffect(() => { loadData(); }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  /* ── loading ─────────────────────────────────────────────────────── */
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

  /* ── grid cell ────────────────────────────────────────────────────── */
  const renderCell = ({ item }: { item: Post }) => {
    const uri = thumbUri(item);
    const isYT = item.platform === 'youtube';
    return (
      <TouchableOpacity style={styles.cell} activeOpacity={0.8}>
        {uri
          ? <Image source={{ uri }} style={styles.cellImage} resizeMode="cover" />
          : <View style={[styles.cellImage, styles.cellPlaceholder]}><Ionicons name="image-outline" size={28} color="#444" /></View>
        }
        {isYT && (
          <View style={styles.ytBadge}>
            <Ionicons name="logo-youtube" size={12} color="#ff0000" />
          </View>
        )}
      </TouchableOpacity>
    );
  };

  /* ── main render ──────────────────────────────────────────────────── */
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
        stickyHeaderIndices={[1]}
      >
        {/* banner */}
        {profile.header_image_url
          ? <Image source={{ uri: profile.header_image_url }} style={styles.banner} />
          : <View style={styles.bannerPlaceholder} />
        }

        {/* sticky profile info */}
        <View style={styles.infoBlock}>
          <View style={styles.avatarRow}>
            {profile.avatar_url
              ? <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
              : <View style={[styles.avatar, styles.avatarPlaceholder]}><Ionicons name="person" size={32} color="#555" /></View>
            }
            {!isOwnProfile && (
              <TouchableOpacity
                style={[styles.followBtn, isFollowing && styles.followBtnActive]}
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

          <Text style={styles.username}>@{profile.username ?? 'user'}</Text>
          {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}

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
          </View>
        </View>

        {/* posts grid */}
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
      </ScrollView>
    </View>
  );
}

/* ─── styles ─────────────────────────────────────────────────────── */
const styles = StyleSheet.create({
  container:          { flex: 1, backgroundColor: '#0a0a0a' },
  center:             { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0a0a0a' },
  errorText:          { color: '#888', fontSize: 16 },
  headerBar:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 52, paddingBottom: 10, paddingHorizontal: 16, backgroundColor: '#0a0a0a' },
  headerBarTitle:     { color: '#fff', fontSize: 17, fontWeight: '600' },
  banner:             { width: '100%', height: 160, resizeMode: 'cover' },
  bannerPlaceholder:  { width: '100%', height: 160, backgroundColor: '#1a1a1a' },
  infoBlock:          { backgroundColor: '#0a0a0a', paddingHorizontal: 16, paddingVertical: 12 },
  avatarRow:          { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: -36 },
  avatar:             { width: 80, height: 80, borderRadius: 40, borderWidth: 3, borderColor: '#0a0a0a' },
  avatarPlaceholder:  { backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center' },
  followBtn:          { paddingHorizontal: 22, paddingVertical: 8, borderRadius: 8, backgroundColor: '#ff4500' },
  followBtnActive:    { backgroundColor: '#2a2a2a', borderWidth: 1, borderColor: '#ff4500' },
  followBtnText:      { color: '#fff', fontWeight: '700', fontSize: 14 },
  username:           { color: '#fff', fontWeight: '700', fontSize: 17, marginTop: 10 },
  bio:                { color: '#aaa', fontSize: 13, marginTop: 4, lineHeight: 18 },
  statsRow:           { flexDirection: 'row', gap: 28, marginTop: 14 },
  statItem:           { alignItems: 'center' },
  statNum:            { color: '#fff', fontWeight: '700', fontSize: 17 },
  statLabel:          { color: '#888', fontSize: 11, marginTop: 2 },
  cell:               { width: CELL, height: CELL, margin: 1 },
  cellImage:          { width: '100%', height: '100%' },
  cellPlaceholder:    { backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center' },
  ytBadge:            { position: 'absolute', bottom: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 4, padding: 2 },
  emptyGrid:          { alignItems: 'center', paddingVertical: 40 },
  emptyGridText:      { color: '#555', marginTop: 10, fontSize: 14 },
});
