// app/(tabs)/search.tsx
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, TextInput, FlatList, StyleSheet,
  TouchableOpacity, Image, ActivityIndicator,
  Dimensions, Keyboard, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../src/services/supabase';
import { useAuth } from '../../src/context/AuthContext';
import { useBlock } from '../../src/hooks/useBlock';
import { useSocialGroups, SocialGroupSearchResult } from '../../src/hooks/useSocialGroups';

const { width } = Dimensions.get('window');
const CELL = (width - 4) / 3;
const SEARCH_LIST_PROPS = {
  keyboardShouldPersistTaps: 'handled' as const,
  removeClippedSubviews: true,
  initialNumToRender: 12,
  maxToRenderPerBatch: 12,
  windowSize: 7,
  updateCellsBatchingPeriod: 50,
};

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
        {item.bio ? <Text style={styles.bio} numberOfLines={1}>{item.bio}</Text> : null}
        <Text style={styles.followerCount}>{item.followers_count ?? 0} followers</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color="#555" />
    </TouchableOpacity>
  );
}

function PostCell({ item, onPress }: { item: SearchPost; onPress: () => void }) {
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

function groupAction(item: SocialGroupSearchResult) {
  if (item.my_role) return { label: 'Open', disabled: false, tone: 'joined' as const };
  if (item.has_pending_invite) return { label: 'Invited', disabled: true, tone: 'pending' as const };
  if (item.has_pending_request) return { label: 'Requested', disabled: true, tone: 'pending' as const };
  if (item.privacy === 'public') return { label: 'Join', disabled: false, tone: 'primary' as const };
  return { label: 'Request', disabled: false, tone: 'secondary' as const };
}

function GroupRow({
  item,
  actionBusy,
  onPress,
  onAction,
}: {
  item: SocialGroupSearchResult;
  actionBusy: boolean;
  onPress: () => void;
  onAction: () => void;
}) {
  const action = groupAction(item);
  const privacyLabel = item.privacy === 'invite_only' ? 'invite only' : item.privacy;

  return (
    <TouchableOpacity style={styles.groupRow} onPress={onPress} activeOpacity={0.78}>
      {item.avatar_url ? (
        <Image source={{ uri: item.avatar_url }} style={styles.groupAvatar} />
      ) : (
        <View style={[styles.groupAvatar, styles.groupAvatarPlaceholder]}>
          <Ionicons name="people-outline" size={20} color="#777" />
        </View>
      )}

      <View style={styles.groupInfo}>
        <View style={styles.groupTitleRow}>
          <Text style={styles.groupName} numberOfLines={1}>{item.name}</Text>
          <View style={styles.groupPrivacyPill}>
            <Text style={styles.groupPrivacyPillText}>{privacyLabel}</Text>
          </View>
        </View>
        {!!item.description && <Text style={styles.groupDescription} numberOfLines={2}>{item.description}</Text>}
        <Text style={styles.groupMeta}>{item.member_count ?? 0} members</Text>
      </View>

      <TouchableOpacity
        style={[
          styles.groupActionBtn,
          action.tone === 'joined' && styles.groupActionBtnJoined,
          action.tone === 'secondary' && styles.groupActionBtnSecondary,
          action.tone === 'pending' && styles.groupActionBtnPending,
          (action.disabled || actionBusy) && { opacity: 0.65 },
        ]}
        disabled={action.disabled || actionBusy}
        onPress={onAction}
      >
        {actionBusy ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text
            style={[
              styles.groupActionBtnText,
              action.tone !== 'primary' && styles.groupActionBtnTextDark,
            ]}
          >
            {action.label}
          </Text>
        )}
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

export default function SearchScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();
  const { user } = useAuth() as { user: { id: string } | null };
  const { isBlocked, blockedIds } = useBlock(user?.id);
  const {
    groups: myGroups,
    discoverableGroups,
    pendingInvites,
    pendingJoinRequests,
    searchGroups,
    requestToJoinGroup,
  } = useSocialGroups(user?.id);

  const initialTab: 'users' | 'posts' | 'groups' = params.tab === 'groups' || params.tab === 'posts' || params.tab === 'users'
    ? params.tab
    : 'users';

  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'users' | 'posts' | 'groups'>(initialTab);
  const [users, setUsers] = useState<SearchUser[]>([]);
  const [posts, setPosts] = useState<SearchPost[]>([]);
  const [groups, setGroups] = useState<SocialGroupSearchResult[]>([]);
  const [suggested, setSuggested] = useState<SearchUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [actingGroupId, setActingGroupId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  }, [user?.id, blockedIds, isBlocked]);

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setUsers([]);
      setPosts([]);
      setGroups([]);
      return;
    }
    setLoading(true);

    const [{ data: uData }, { data: pData }, groupData] = await Promise.all([
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
      searchGroups(q),
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
    setGroups(groupData ?? []);
    setLoading(false);
  }, [user?.id, isBlocked, searchGroups]);

  const handleQueryChange = (text: string) => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void runSearch(text); }, 350);
  };

  const clearSearch = () => {
    setQuery('');
    setUsers([]);
    setPosts([]);
    setGroups([]);
  };

  const handleUserPress = (username: string | null) => {
    if (!username) return;
    Keyboard.dismiss();
    router.push({ pathname: '/profile/[username]', params: { username } });
  };

  const handlePostPress = (postId: string) => {
    Keyboard.dismiss();
    router.push(`/post/${postId}` as any);
  };

  const handleGroupPress = (group: SocialGroupSearchResult) => {
    Keyboard.dismiss();
    if (group.my_role || group.privacy === 'public') {
      router.push(`/group/${group.id}` as any);
      return;
    }
    Alert.alert('Request access', 'Use the button on the right to request access to this community.');
  };

  const handleGroupAction = async (group: SocialGroupSearchResult) => {
    Keyboard.dismiss();

    if (group.my_role) {
      router.push(`/group/${group.id}` as any);
      return;
    }

    if (group.has_pending_invite) {
      Alert.alert('Invite waiting', 'You already have an invite for this community. Check the Messages tab to accept it.');
      return;
    }

    if (group.has_pending_request) {
      Alert.alert('Request pending', 'Your join request is already waiting for review.');
      return;
    }

    setActingGroupId(group.id);
    const status = await requestToJoinGroup(group.id);
    setActingGroupId(null);

    if (!status) {
      Alert.alert('Error', 'Could not process that join request. Please try again.');
      return;
    }

    if (status === 'joined' || status === 'already_member') {
      setGroups(prev => prev.map(item => item.id === group.id
        ? { ...item, my_role: item.my_role ?? 'member', has_pending_invite: false, has_pending_request: false }
        : item));
      router.push(`/group/${group.id}` as any);
      return;
    }

    if (status === 'pending_invite') {
      setGroups(prev => prev.map(item => item.id === group.id
        ? { ...item, has_pending_invite: true }
        : item));
      Alert.alert('Invite waiting', 'You already have an invite for this community. Check the Messages tab to accept it.');
      return;
    }

    if (status === 'pending_request' || status === 'requested') {
      setGroups(prev => prev.map(item => item.id === group.id
        ? { ...item, has_pending_request: true }
        : item));
      Alert.alert('Request sent', 'Your join request has been sent to the community team.');
    }
  };

  const hasQuery = query.trim().length > 0;

  useEffect(() => {
    if (params.tab === 'groups' || params.tab === 'posts' || params.tab === 'users') {
      setTab(params.tab as 'users' | 'posts' | 'groups');
    }
  }, [params.tab]);

  const pendingInviteGroupIds = useMemo(() => new Set(pendingInvites.map(invite => invite.group_id)), [pendingInvites]);
  const pendingRequestGroupIds = useMemo(() => new Set(pendingJoinRequests.map(request => request.group_id)), [pendingJoinRequests]);
  const browseGroups = useMemo(() => {
    const seen = new Set<string>();
    const joined = myGroups.map(group => {
      seen.add(group.id);
      return {
        ...group,
        my_role: group.my_role ?? 'member',
        has_pending_invite: false,
        has_pending_request: false,
      } as SocialGroupSearchResult;
    });
    const discover = discoverableGroups
      .filter(group => !seen.has(group.id))
      .map(group => ({
        ...group,
        has_pending_invite: pendingInviteGroupIds.has(group.id),
        has_pending_request: pendingRequestGroupIds.has(group.id),
      } as SocialGroupSearchResult));
    return [...joined, ...discover];
  }, [discoverableGroups, myGroups, pendingInviteGroupIds, pendingRequestGroupIds]);

  const showTabs = hasQuery || tab === 'groups';

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Search</Text>
      </View>

      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color="#666" style={styles.searchIcon} />
        <TextInput
          style={styles.input}
          placeholder="Search pilots, groups, captions…"
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

      {loading && (
        <ActivityIndicator color="#f97316" size="small" style={{ marginTop: 16 }} />
      )}

      {showTabs && !loading && (
        <View style={styles.tabs}>
          {([
            { key: 'users', label: `Users (${users.length})` },
            { key: 'posts', label: `Posts (${posts.length})` },
            { key: 'groups', label: `Groups (${groups.length})` },
          ] as const).map(item => (
            <TouchableOpacity
              key={item.key}
              style={[styles.tab, tab === item.key && styles.tabActive]}
              onPress={() => setTab(item.key)}
            >
              <Text style={[styles.tabText, tab === item.key && styles.tabTextActive]}>{hasQuery ? item.label : item.key[0].toUpperCase() + item.key.slice(1)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {hasQuery && !loading ? (
        tab === 'users' ? (
          <FlatList
            key="search-users-list"
            data={users}
            keyExtractor={item => item.id}
            renderItem={({ item }) => (
              <UserRow item={item} onPress={() => handleUserPress(item.username)} />
            )}
            ListEmptyComponent={<Text style={styles.empty}>No pilots found for "{query}"</Text>}
            contentContainerStyle={{ paddingBottom: 120 }}
            {...SEARCH_LIST_PROPS}
          />
        ) : tab === 'posts' ? (
          <FlatList
            key="search-posts-grid-3"
            data={posts}
            keyExtractor={item => item.id}
            numColumns={3}
            renderItem={({ item }) => (
              <PostCell item={item} onPress={() => handlePostPress(item.id)} />
            )}
            ListEmptyComponent={<Text style={styles.empty}>No posts found for "{query}"</Text>}
            contentContainerStyle={{ paddingBottom: 120 }}
            columnWrapperStyle={{ gap: 2 }}
            getItemLayout={(_, index) => {
              const row = Math.floor(index / 3);
              return { length: CELL, offset: CELL * row, index };
            }}
            {...SEARCH_LIST_PROPS}
          />
        ) : (
          <FlatList
            key="search-groups-list"
            data={groups}
            keyExtractor={item => item.id}
            renderItem={({ item }) => (
              <GroupRow
                item={item}
                actionBusy={actingGroupId === item.id}
                onPress={() => handleGroupPress(item)}
                onAction={() => void handleGroupAction(item)}
              />
            )}
            ListEmptyComponent={<Text style={styles.empty}>No communities found for "{query}"</Text>}
            contentContainerStyle={{ paddingBottom: 120 }}
            {...SEARCH_LIST_PROPS}
          />
        )
      ) : tab === 'groups' && !loading ? (
        <FlatList
          key="search-browse-groups-list"
          data={browseGroups}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <GroupRow
              item={item}
              actionBusy={actingGroupId === item.id}
              onPress={() => handleGroupPress(item)}
              onAction={() => void handleGroupAction(item)}
            />
          )}
          ListHeaderComponent={<Text style={styles.sectionLabel}>My communities and public groups to join</Text>}
          ListEmptyComponent={<Text style={styles.empty}>No communities available yet. Try searching for one.</Text>}
          contentContainerStyle={{ paddingBottom: 120 }}
          {...SEARCH_LIST_PROPS}
        />
      ) : !loading ? (
        <FlatList
          key="search-suggested-users-list"
          data={suggested}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <UserRow item={item} onPress={() => handleUserPress(item.username)} />
          )}
          ListHeaderComponent={<Text style={styles.sectionLabel}>Top Pilots</Text>}
          ListEmptyComponent={<Text style={styles.empty}>No pilots yet</Text>}
          contentContainerStyle={{ paddingBottom: 120 }}
          {...SEARCH_LIST_PROPS}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a1a' },
  header: { paddingTop: 56, paddingHorizontal: 16, paddingBottom: 8 },
  headerTitle: { color: '#fff', fontSize: 24, fontWeight: '700' },

  searchBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1a1a2e', borderRadius: 12,
    marginHorizontal: 16, marginBottom: 8,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  searchIcon: { marginRight: 8 },
  input: { flex: 1, color: '#fff', fontSize: 15 },

  tabs: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 8 },
  tab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderBottomWidth: 2, borderColor: 'transparent' },
  tabActive: { borderColor: '#00d4ff' },
  tabText: { color: '#888', fontSize: 14, fontWeight: '600' },
  tabTextActive: { color: '#00d4ff' },

  sectionLabel: { color: '#888', fontSize: 13, fontWeight: '600', marginHorizontal: 16, marginVertical: 8 },
  empty: { color: '#555', textAlign: 'center', marginTop: 48, fontSize: 14, paddingHorizontal: 20 },

  userRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderColor: '#1a1a2e',
  },
  avatar: { width: 44, height: 44, borderRadius: 22, marginRight: 12 },
  avatarPlaceholder: { backgroundColor: '#1a1a2e', alignItems: 'center', justifyContent: 'center' },
  userInfo: { flex: 1 },
  username: { color: '#fff', fontSize: 15, fontWeight: '600' },
  bio: { color: '#888', fontSize: 13, marginTop: 2 },
  followerCount: { color: '#555', fontSize: 12, marginTop: 2 },

  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: '#1a1a2e',
  },
  groupAvatar: { width: 48, height: 48, borderRadius: 24 },
  groupAvatarPlaceholder: { backgroundColor: '#1a1a2e', alignItems: 'center', justifyContent: 'center' },
  groupInfo: { flex: 1, minWidth: 0 },
  groupTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  groupName: { flex: 1, color: '#fff', fontSize: 15, fontWeight: '700' },
  groupDescription: { color: '#9a9a9a', fontSize: 13, marginTop: 3 },
  groupMeta: { color: '#666', fontSize: 12, marginTop: 4 },
  groupPrivacyPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#131324',
    borderWidth: 1,
    borderColor: '#2a2a43',
  },
  groupPrivacyPillText: { color: '#8aa4d6', fontSize: 10, fontWeight: '700' },
  groupActionBtn: {
    minWidth: 82,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ff6a2f',
  },
  groupActionBtnJoined: { backgroundColor: '#152335', borderWidth: 1, borderColor: '#284669' },
  groupActionBtnSecondary: { backgroundColor: '#17171f', borderWidth: 1, borderColor: '#303047' },
  groupActionBtnPending: { backgroundColor: '#1e1e25', borderWidth: 1, borderColor: '#35353f' },
  groupActionBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  groupActionBtnTextDark: { color: '#d8d8e5' },

  cell: { overflow: 'hidden', backgroundColor: '#1a1a2e', margin: 1 },
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
