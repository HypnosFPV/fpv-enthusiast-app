// app/(tabs)/search.tsx
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, FlatList, StyleSheet,
  TouchableOpacity, Image, ActivityIndicator,
  Dimensions, Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { supabase } from '../../src/services/supabase';
import { useAuth } from '../../src/context/AuthContext';
import { useBlock } from '../../src/hooks/useBlock';

const { width } = Dimensions.get('window');
const CELL = (width - 4) / 3;

// ─── Types ────────────────────────────────────────────────────────────────────
interface SearchUser {
  id: string;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
  followers_count: number;
}

interface SearchPost {
  id: string;
  caption: string | null;
  thumbnail_url: string | null;
  video_url: string | null;
  media_url: string | null;
  social_url: string | null;
  user_id: string;
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function UserRow({ item, onPress }: { item: SearchUser; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.userRow} onPress={onPress} activeOpacity={0.75}>
      {item.avatar_url ? (
        <Image source={{ uri: item.avatar_url }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, styles.avatarPlaceholder]}>
          <Ionicons name="person" size={20} color="#555" />
        </View>
      )}
      <View style={styles.userInfo}>
        <Text style={styles.username}>@{item.username ?? 'unknown'}</Text>
        {item.bio ? (
          <Text style={styles.bio} numberOfLines={1}>{item.bio}</Text>
        ) : null}
        <Text style={styles.followerCount}>{item.followers_count ?? 0} followers</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color="#555" />
    </TouchableOpacity>
  );
}

function PostCell({ item, onPress }: { item: SearchPost; onPress: () => void }) {
  // Build thumbnail from whichever URL we have
  const thumb = item.thumbnail_url ?? (() => {
    const candidates = [item.video_url, item.media_url, item.social_url];
    for (const url of candidates) {
      if (!url) continue;
      const m = url.match(
        /(?:youtube(?:-nocookie)?\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/,
      );
      if (m?.[1]) return `https://img.youtube.com/vi/${m[1]}/hqdefault.jpg`;
    }
    return null;
  })();

  const isYT = [item.video_url, item.media_url, item.social_url].some(
    u => u && /youtu/i.test(u),
  );

  return (
    <TouchableOpacity
      style={[styles.cell, { width: CELL, height: CELL }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      {thumb ? (
        <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.cellPlaceholder]}>
          <Ionicons name="image-outline" size={28} color="#444" />
        </View>
      )}
      {isYT && (
        <View style={styles.ytBadge}>
          <Ionicons name="logo-youtube" size={12} color="#fff" />
        </View>
      )}
      {item.caption ? (
        <View style={styles.captionOverlay}>
          <Text style={styles.captionText} numberOfLines={2}>{item.caption}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function SearchScreen() {
  const router   = useRouter();
  const { user } = useAuth() as { user: { id: string } | null };
  const { isBlocked, blockedIds } = useBlock(user?.id);

  const [query,     setQuery]     = useState('');
  const [tab,       setTab]       = useState<'users' | 'posts'>('users');
  const [users,     setUsers]     = useState<SearchUser[]>([]);
  const [posts,     setPosts]     = useState<SearchPost[]>([]);
  const [suggested, setSuggested] = useState<SearchUser[]>([]);
  const [loading,   setLoading]   = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Suggested / discovery list on mount ───────────────────────────────────
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('users')
        .select('id, username, avatar_url, bio, followers_count')
        .neq('id', user?.id ?? '')
        .order('followers_count', { ascending: false })
        .limit(20);

      setSuggested(
        (data ?? []).filter((u: SearchUser) => !isBlocked(u.id)),
      );
    })();
  }, [user?.id, blockedIds]);

  // ── Search ────────────────────────────────────────────────────────────────
  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setUsers([]); setPosts([]); return; }
    setLoading(true);

    const [{ data: uData }, { data: pData }] = await Promise.all([
      supabase
        .from('users')
        .select('id, username, avatar_url, bio, followers_count')
        .ilike('username', `%${q}%`)
        .limit(30),
      supabase
        .from('posts')
        .select('id, caption, thumbnail_url, video_url, media_url, social_url, user_id')
        .ilike('caption', `%${q}%`)
        .limit(30),
    ]);

    setUsers(
      (uData ?? []).filter(
        (u: SearchUser) => u.id !== user?.id && !isBlocked(u.id),
      ),
    );
    setPosts(
      (pData ?? []).filter(
        (p: SearchPost) => !isBlocked(p.user_id),
      ),
    );
    setLoading(false);
  }, [user?.id, isBlocked]);

  const handleQueryChange = (text: string) => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(text), 350);
  };

  const clearSearch = () => {
    setQuery('');
    setUsers([]);
    setPosts([]);
  };

  const handleUserPress = (username: string | null) => {
    if (!username) return;
    Keyboard.dismiss();
    router.push({ pathname: '/profile/[username]', params: { username } });
  };

  const handlePostPress = (postId: string) => {
    Keyboard.dismiss();
    // Adjust this route to match your app's post detail screen
    router.push(`/post/${postId}` as any);
  };

  const hasQuery = query.trim().length > 0;

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Search</Text>
      </View>

      {/* Search bar */}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color="#666" style={styles.searchIcon} />
        <TextInput
          style={styles.input}
          placeholder="Search pilots, captions…"
          placeholderTextColor="#555"
          value={query}
          onChangeText={handleQueryChange}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={clearSearch}>
            <Ionicons name="close-circle" size={18} color="#555" />
          </TouchableOpacity>
        )}
      </View>

      {/* Loading indicator */}
      {loading && (
        <ActivityIndicator color="#f97316" size="small" style={{ marginTop: 16 }} />
      )}

      {/* Tabs — only when a query is active */}
      {hasQuery && !loading && (
        <View style={styles.tabs}>
          {(['users', 'posts'] as const).map(t => (
            <TouchableOpacity
              key={t}
              style={[styles.tab, tab === t && styles.tabActive]}
              onPress={() => setTab(t)}
            >
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                {t === 'users' ? `Users (${users.length})` : `Posts (${posts.length})`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Results or discovery */}
      {hasQuery && !loading ? (
        tab === 'users' ? (
          <FlatList
            data={users}
            keyExtractor={item => item.id}
            renderItem={({ item }) => (
              <UserRow item={item} onPress={() => handleUserPress(item.username)} />
            )}
            ListEmptyComponent={
              <Text style={styles.empty}>No pilots found for "{query}"</Text>
            }
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 120 }}
          />
        ) : (
          <FlatList
            data={posts}
            keyExtractor={item => item.id}
            numColumns={3}
            renderItem={({ item }) => (
              <PostCell item={item} onPress={() => handlePostPress(item.id)} />
            )}
            ListEmptyComponent={
              <Text style={styles.empty}>No posts found for "{query}"</Text>
            }
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 120 }}
            columnWrapperStyle={{ gap: 2 }}
          />
        )
      ) : !loading ? (
        /* Discovery — suggested top pilots */
        <FlatList
          data={suggested}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <UserRow item={item} onPress={() => handleUserPress(item.username)} />
          )}
          ListHeaderComponent={
            <Text style={styles.sectionLabel}>Top Pilots</Text>
          }
          ListEmptyComponent={
            <Text style={styles.empty}>No pilots yet</Text>
          }
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 120 }}
        />
      ) : null}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#0a0a1a' },
  header:      { paddingTop: 56, paddingHorizontal: 16, paddingBottom: 8 },
  headerTitle: { color: '#fff', fontSize: 24, fontWeight: '700' },

  searchBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1a1a2e', borderRadius: 12,
    marginHorizontal: 16, marginBottom: 8,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  searchIcon: { marginRight: 8 },
  input:      { flex: 1, color: '#fff', fontSize: 15 },

  tabs:          { flexDirection: 'row', marginHorizontal: 16, marginBottom: 8 },
  tab:           { flex: 1, paddingVertical: 8, alignItems: 'center', borderBottomWidth: 2, borderColor: 'transparent' },
  tabActive:     { borderColor: '#00d4ff' },
  tabText:       { color: '#888', fontSize: 14, fontWeight: '600' },
  tabTextActive: { color: '#00d4ff' },

  sectionLabel: { color: '#888', fontSize: 13, fontWeight: '600', marginHorizontal: 16, marginVertical: 8 },
  empty:        { color: '#555', textAlign: 'center', marginTop: 48, fontSize: 14 },

  userRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderColor: '#1a1a2e',
  },
  avatar:            { width: 44, height: 44, borderRadius: 22, marginRight: 12 },
  avatarPlaceholder: { backgroundColor: '#1a1a2e', alignItems: 'center', justifyContent: 'center' },
  userInfo:          { flex: 1 },
  username:          { color: '#fff', fontSize: 15, fontWeight: '600' },
  bio:               { color: '#888', fontSize: 13, marginTop: 2 },
  followerCount:     { color: '#555', fontSize: 12, marginTop: 2 },

  cell:            { overflow: 'hidden', backgroundColor: '#1a1a2e', margin: 1 },
  cellPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  ytBadge: {
    position: 'absolute', top: 4, right: 4,
    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 4, padding: 3,
  },
  captionOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.55)', padding: 4,
  },
  captionText: { color: '#fff', fontSize: 10 },
});
