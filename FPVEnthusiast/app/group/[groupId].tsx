import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Alert,
  Image,
  Modal,
  FlatList,
  RefreshControl,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import PostCard from '../../src/components/PostCard';
import { useAuth } from '../../src/context/AuthContext';
import {
  SocialGroup,
  SocialGroupMember,
  SocialGroupPermission,
  SocialGroupPrivacy,
  useSocialGroups,
} from '../../src/hooks/useSocialGroups';
import { supabase } from '../../src/services/supabase';

interface GroupPost {
  id: string;
  user_id?: string | null;
  media_url?: string | null;
  media_type?: string | null;
  thumbnail_url?: string | null;
  caption?: string | null;
  social_url?: string | null;
  platform?: string | null;
  created_at?: string | null;
  like_count: number;
  comment_count: number;
  isLiked: boolean;
  likes_count?: number;
  comments_count?: number;
  users?: {
    id?: string | null;
    username?: string | null;
    avatar_url?: string | null;
  } | null;
  group?: {
    id?: string | null;
    name?: string | null;
  } | null;
}

function timeAgo(iso?: string | null) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return `${Math.floor(d / 7)}w`;
}

function roleColor(role: string) {
  if (role === 'owner') return '#ff9b68';
  if (role === 'admin') return '#9cc8ff';
  if (role === 'moderator') return '#c6b0ff';
  return '#a2a2a2';
}

function mergePostLikes(rawPosts: any[], likedIds: string[]): GroupPost[] {
  return rawPosts.map(p => ({
    ...p,
    like_count: p.likes_count ?? 0,
    comment_count: p.comments_count ?? 0,
    users: Array.isArray(p.users) ? (p.users[0] ?? null) : (p.users ?? null),
    group: Array.isArray(p.group) ? (p.group[0] ?? null) : (p.group ?? null),
    isLiked: likedIds.includes(p.id),
  })) as GroupPost[];
}

function Avatar({ uri, size = 44 }: { uri?: string | null; size?: number }) {
  if (uri) {
    return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  }
  return (
    <View style={[styles.avatarFallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <Ionicons name="people-outline" size={Math.round(size * 0.42)} color="#909090" />
    </View>
  );
}

export default function GroupDetailScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const {
    addMember,
    updateMemberRole,
    removeMember,
    updateGroupSettings,
  } = useSocialGroups(user?.id);

  const [group, setGroup] = useState<SocialGroup | null>(null);
  const [members, setMembers] = useState<SocialGroupMember[]>([]);
  const [posts, setPosts] = useState<GroupPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'posts' | 'members' | 'about'>('posts');
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [memberResults, setMemberResults] = useState<{ id: string; username: string; avatar_url: string | null }[]>([]);
  const [savingSettings, setSavingSettings] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [privacyDraft, setPrivacyDraft] = useState<SocialGroupPrivacy>('private');
  const [canPostDraft, setCanPostDraft] = useState<SocialGroupPermission>('members');
  const [canChatDraft, setCanChatDraft] = useState<SocialGroupPermission>('members');
  const [canInviteDraft, setCanInviteDraft] = useState<SocialGroupPermission>('mods');

  const fetchGroup = useCallback(async () => {
    if (!groupId) return;

    const { data: groupData, error: groupError } = await supabase
      .from('social_groups')
      .select(`
        id, name, description, privacy, avatar_url, cover_url,
        created_by, chat_room_id, can_post, can_chat, can_invite,
        created_at, updated_at
      `)
      .eq('id', groupId)
      .single();

    if (groupError || !groupData) {
      console.warn('[group] fetchGroup error:', groupError?.message);
      setGroup(null);
      setMembers([]);
      setPosts([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const { data: memberData } = await supabase
      .from('social_group_members')
      .select(`
        group_id, user_id, role, invited_by, joined_at, last_seen_at,
        user:user_id ( id, username, avatar_url )
      `)
      .eq('group_id', groupId)
      .order('joined_at', { ascending: true });

    const { data: postData, error: postError } = await supabase
      .from('posts')
      .select(`
        id, user_id, media_url, media_type, thumbnail_url, caption,
        social_url, platform, created_at, likes_count, comments_count,
        group:group_id ( id, name ),
        users:user_id ( id, username, avatar_url )
      `)
      .eq('group_id', groupId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (postError) {
      console.warn('[group] fetchPosts error:', postError.message);
    }

    let likedIds: string[] = [];
    const postIds = (postData ?? []).map((post: any) => post.id);
    if (user?.id && postIds.length > 0) {
      const { data: likes } = await supabase
        .from('likes')
        .select('post_id')
        .eq('user_id', user.id)
        .in('post_id', postIds);
      likedIds = (likes ?? []).map((row: any) => row.post_id);
    }

    const myRole = ((memberData ?? []) as SocialGroupMember[]).find(member => member.user_id === user?.id)?.role ?? null;

    const normalizedGroup: SocialGroup = {
      ...(groupData as SocialGroup),
      my_role: myRole as any,
      member_count: (memberData ?? []).length,
    };

    setGroup(normalizedGroup);
    setDescriptionDraft(groupData.description ?? '');
    setPrivacyDraft(groupData.privacy as SocialGroupPrivacy);
    setCanPostDraft(groupData.can_post as SocialGroupPermission);
    setCanChatDraft(groupData.can_chat as SocialGroupPermission);
    setCanInviteDraft(groupData.can_invite as SocialGroupPermission);
    setMembers((memberData ?? []) as SocialGroupMember[]);
    setPosts(mergePostLikes(postData ?? [], likedIds));
    setLoading(false);
    setRefreshing(false);
  }, [groupId, user?.id]);

  useEffect(() => {
    fetchGroup();
  }, [fetchGroup]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchGroup();
  };

  const myRole = useMemo(() => members.find(member => member.user_id === user?.id)?.role ?? null, [members, user?.id]);
  const canManage = myRole === 'owner' || myRole === 'admin';
  const canModerate = canManage || myRole === 'moderator';
  const canInviteUsers = !!group && (group.can_invite === 'members' || canModerate);
  const canPost = !!group && (group.can_post === 'members' || canModerate);
  const canChat = !!group && (group.can_chat === 'members' || canModerate);

  const handleToggleLike = async (postId: string) => {
    if (!user?.id) return;
    const target = posts.find(post => post.id === postId);
    if (!target) return;
    const isCurrentlyLiked = target.isLiked;
    const delta = isCurrentlyLiked ? -1 : 1;

    setPosts(prev => prev.map(post => post.id === postId
      ? {
          ...post,
          isLiked: !isCurrentlyLiked,
          like_count: post.like_count + delta,
          likes_count: (post.likes_count ?? post.like_count) + delta,
        }
      : post
    ));

    if (isCurrentlyLiked) {
      await supabase.from('likes').delete().eq('post_id', postId).eq('user_id', user.id);
    } else {
      await supabase.from('likes').insert({ post_id: postId, user_id: user.id });
    }
  };

  const handleDeletePost = async (postId: string) => {
    const { error } = await supabase.from('posts').delete().eq('id', postId).eq('user_id', user?.id ?? '');
    if (error) {
      Alert.alert('Error', 'Could not delete post.');
      return false;
    }
    setPosts(prev => prev.filter(post => post.id !== postId));
    return true;
  };

  const handlePost = async () => {
    if (!user?.id || !groupId || !draft.trim() || posting) return;
    setPosting(true);
    const { data, error } = await supabase
      .from('posts')
      .insert({
        user_id: user.id,
        caption: draft.trim(),
        group_id: groupId,
        post_scope: 'group',
      })
      .select(`
        id, user_id, media_url, media_type, thumbnail_url, caption,
        social_url, platform, created_at, likes_count, comments_count,
        group:group_id ( id, name ),
        users:user_id ( id, username, avatar_url )
      `)
      .single();

    setPosting(false);

    if (error || !data) {
      Alert.alert('Error', error?.message ?? 'Could not post to the group.');
      return;
    }

    setPosts(prev => [mergePostLikes([data], [])[0], ...prev]);
    setDraft('');
    setTab('posts');
  };

  const searchUsers = useCallback(async (q: string) => {
    setMemberSearch(q);
    if (q.trim().length < 2) {
      setMemberResults([]);
      return;
    }
    const existingIds = new Set(members.map(member => member.user_id));
    const { data } = await supabase
      .from('users')
      .select('id, username, avatar_url')
      .ilike('username', `%${q.trim()}%`)
      .neq('id', user?.id ?? '')
      .limit(15);
    setMemberResults(((data ?? []) as any[]).filter(item => !existingIds.has(item.id)));
  }, [members, user?.id]);

  const handleInvite = async (userId: string) => {
    if (!groupId) return;
    const ok = await addMember(groupId, userId, 'member');
    if (!ok) {
      Alert.alert('Error', 'Could not add that member.');
      return;
    }
    setShowInviteModal(false);
    setMemberSearch('');
    setMemberResults([]);
    await fetchGroup();
  };

  const handleMemberPress = (member: SocialGroupMember) => {
    if (!canManage || member.user_id === user?.id || !groupId) return;

    const isProtected = myRole === 'admin' && (member.role === 'owner' || member.role === 'admin');
    if (isProtected) return;

    Alert.alert(
      member.user?.username ?? 'Manage member',
      `Current role: ${member.role}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Make admin', onPress: async () => {
          const ok = await updateMemberRole(groupId, member.user_id, 'admin');
          if (ok) await fetchGroup();
        } },
        { text: 'Make moderator', onPress: async () => {
          const ok = await updateMemberRole(groupId, member.user_id, 'moderator');
          if (ok) await fetchGroup();
        } },
        { text: 'Make member', onPress: async () => {
          const ok = await updateMemberRole(groupId, member.user_id, 'member');
          if (ok) await fetchGroup();
        } },
        { text: 'Remove', style: 'destructive', onPress: async () => {
          const ok = await removeMember(groupId, member.user_id);
          if (ok) await fetchGroup();
        } },
      ]
    );
  };

  const saveSettings = async () => {
    if (!groupId || !canManage) return;
    setSavingSettings(true);
    const ok = await updateGroupSettings(groupId, {
      description: descriptionDraft,
      privacy: privacyDraft,
      canPost: canPostDraft,
      canChat: canChatDraft,
      canInvite: canInviteDraft,
    });
    setSavingSettings(false);
    if (!ok) {
      Alert.alert('Error', 'Could not save group settings.');
      return;
    }
    await fetchGroup();
    Alert.alert('Saved', 'Community settings updated.');
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color="#ff6a2f" size="large" />
      </View>
    );
  }

  if (!group) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Ionicons name="alert-circle-outline" size={42} color="#666" />
        <Text style={styles.emptyTitle}>Group not found</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerIconBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>{group.name}</Text>
          <Text style={styles.headerSubtitle}>
            {(group.member_count ?? members.length)} members • {group.privacy.replace('_', ' ')}
          </Text>
        </View>
        {group.chat_room_id ? (
          <TouchableOpacity
            style={[styles.headerActionBtn, !canChat && { opacity: 0.55 }]}
            onPress={() => canChat ? router.push(`/chat/${group.chat_room_id}` as any) : Alert.alert('Chat limited', 'Only moderators can chat in this group right now.')}
          >
            <Ionicons name="chatbubble-ellipses-outline" size={20} color="#ff9b68" />
          </TouchableOpacity>
        ) : null}
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#ff6a2f" />}
        contentContainerStyle={{ paddingBottom: 32 }}
      >
        <View style={styles.heroCard}>
          <Avatar uri={group.avatar_url} size={58} />
          <View style={{ flex: 1 }}>
            <Text style={styles.heroTitle}>{group.name}</Text>
            <Text style={styles.heroMeta}>
              {group.privacy === 'public' ? 'Public community' : group.privacy === 'invite_only' ? 'Invite only' : 'Private community'}
            </Text>
            {!!group.description && <Text style={styles.heroDescription}>{group.description}</Text>}
          </View>
        </View>

        <View style={styles.tabsRow}>
          {[
            { key: 'posts', label: 'Posts' },
            { key: 'members', label: 'Members' },
            { key: 'about', label: 'About' },
          ].map(item => (
            <TouchableOpacity
              key={item.key}
              style={[styles.tabBtn, tab === item.key && styles.tabBtnActive]}
              onPress={() => setTab(item.key as typeof tab)}
            >
              <Text style={[styles.tabBtnText, tab === item.key && styles.tabBtnTextActive]}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {tab === 'posts' ? (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Post to {group.name}</Text>
              <Text style={styles.cardSubtitle}>
                {canPost ? 'This post will appear in the feed for group members.' : 'Only moderators can post in this group right now.'}
              </Text>
              <TextInput
                style={[styles.textArea, !canPost && { opacity: 0.55 }]}
                editable={!!canPost}
                multiline
                placeholder={canPost ? 'Share an update with your group…' : 'Posting restricted'}
                placeholderTextColor="#666"
                value={draft}
                onChangeText={setDraft}
              />
              <TouchableOpacity
                style={[styles.primaryBtn, (!canPost || !draft.trim() || posting) && { opacity: 0.45 }]}
                disabled={!canPost || !draft.trim() || posting}
                onPress={handlePost}
              >
                {posting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.primaryBtnText}>Post to group</Text>}
              </TouchableOpacity>
            </View>

            {posts.length === 0 ? (
              <View style={styles.emptyCard}>
                <Ionicons name="albums-outline" size={42} color="#333" />
                <Text style={styles.emptyTitle}>No group posts yet</Text>
                <Text style={styles.emptySubtitle}>Your first post here will also show up in the member feed.</Text>
              </View>
            ) : posts.map(post => (
              <View key={post.id} style={{ marginTop: 8 }}>
                <PostCard
                  post={post}
                  currentUserId={user?.id ?? undefined}
                  onLike={handleToggleLike}
                  onDelete={handleDeletePost}
                />
              </View>
            ))}
          </>
        ) : null}

        {tab === 'members' ? (
          <View style={styles.card}>
            <View style={styles.membersHeader}>
              <View>
                <Text style={styles.cardTitle}>Members</Text>
                <Text style={styles.cardSubtitle}>Owners and admins can change roles or remove members.</Text>
              </View>
              {canInviteUsers ? (
                <TouchableOpacity style={styles.secondaryBtn} onPress={() => setShowInviteModal(true)}>
                  <Ionicons name="person-add-outline" size={16} color="#ff9b68" />
                  <Text style={styles.secondaryBtnText}>Invite</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {members.map(member => (
              <TouchableOpacity
                key={member.user_id}
                style={styles.memberRow}
                activeOpacity={canManage && member.user_id !== user?.id ? 0.75 : 1}
                onPress={() => handleMemberPress(member)}
              >
                <Avatar uri={member.user?.avatar_url} size={42} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.memberName}>{member.user?.username ?? member.user_id}</Text>
                  <Text style={styles.memberMeta}>Joined {timeAgo(member.joined_at)} ago</Text>
                </View>
                <View style={[styles.rolePill, { backgroundColor: roleColor(member.role) + '22', borderColor: roleColor(member.role) + '55' }]}>
                  <Text style={[styles.rolePillText, { color: roleColor(member.role) }]}>{member.role.toUpperCase()}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        {tab === 'about' ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Community settings</Text>
            <Text style={styles.cardSubtitle}>Moderators can tune who posts, chats, and invites members.</Text>

            <Text style={styles.label}>Description</Text>
            <TextInput
              style={[styles.textArea, !canManage && { opacity: 0.55 }]}
              editable={canManage}
              multiline
              value={descriptionDraft}
              onChangeText={setDescriptionDraft}
              placeholder="What is this community about?"
              placeholderTextColor="#666"
            />

            <Text style={styles.label}>Privacy</Text>
            <View style={styles.choicesRow}>
              {(['public', 'private', 'invite_only'] as SocialGroupPrivacy[]).map(option => (
                <TouchableOpacity
                  key={option}
                  disabled={!canManage}
                  style={[styles.choicePill, privacyDraft === option && styles.choicePillActive, !canManage && { opacity: 0.55 }]}
                  onPress={() => setPrivacyDraft(option)}
                >
                  <Text style={[styles.choiceText, privacyDraft === option && styles.choiceTextActive]}>
                    {option.replace('_', ' ')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Who can post?</Text>
            <View style={styles.choicesRow}>
              {(['members', 'mods'] as SocialGroupPermission[]).map(option => (
                <TouchableOpacity
                  key={option}
                  disabled={!canManage}
                  style={[styles.choicePill, canPostDraft === option && styles.choicePillActive, !canManage && { opacity: 0.55 }]}
                  onPress={() => setCanPostDraft(option)}
                >
                  <Text style={[styles.choiceText, canPostDraft === option && styles.choiceTextActive]}>{option === 'mods' ? 'Moderators only' : 'Members'}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Who can chat?</Text>
            <View style={styles.choicesRow}>
              {(['members', 'mods'] as SocialGroupPermission[]).map(option => (
                <TouchableOpacity
                  key={option}
                  disabled={!canManage}
                  style={[styles.choicePill, canChatDraft === option && styles.choicePillActive, !canManage && { opacity: 0.55 }]}
                  onPress={() => setCanChatDraft(option)}
                >
                  <Text style={[styles.choiceText, canChatDraft === option && styles.choiceTextActive]}>{option === 'mods' ? 'Moderators only' : 'Members'}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Who can invite?</Text>
            <View style={styles.choicesRow}>
              {(['members', 'mods'] as SocialGroupPermission[]).map(option => (
                <TouchableOpacity
                  key={option}
                  disabled={!canManage}
                  style={[styles.choicePill, canInviteDraft === option && styles.choicePillActive, !canManage && { opacity: 0.55 }]}
                  onPress={() => setCanInviteDraft(option)}
                >
                  <Text style={[styles.choiceText, canInviteDraft === option && styles.choiceTextActive]}>{option === 'mods' ? 'Moderators only' : 'Members'}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {canManage ? (
              <TouchableOpacity
                style={[styles.primaryBtn, savingSettings && { opacity: 0.55 }]}
                disabled={savingSettings}
                onPress={saveSettings}
              >
                {savingSettings ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.primaryBtnText}>Save settings</Text>}
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      <Modal visible={showInviteModal} animationType="slide" transparent onRequestClose={() => setShowInviteModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Invite members</Text>
              <TouchableOpacity onPress={() => setShowInviteModal(false)}>
                <Ionicons name="close" size={22} color="#aaa" />
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.modalInput}
              value={memberSearch}
              onChangeText={searchUsers}
              placeholder="Search usernames"
              placeholderTextColor="#666"
              autoFocus
            />

            <FlatList
              data={memberResults}
              keyExtractor={item => item.id}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.memberRow} onPress={() => handleInvite(item.id)}>
                  <Avatar uri={item.avatar_url} size={42} />
                  <Text style={styles.memberName}>{item.username}</Text>
                  <Ionicons name="add-circle-outline" size={18} color="#ff9b68" />
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                memberSearch.trim().length >= 2
                  ? <Text style={styles.emptySearch}>No matching users</Text>
                  : <Text style={styles.emptySearch}>Search for a pilot to add</Text>
              }
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  centered: { alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 54,
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#222',
    backgroundColor: '#101010',
  },
  headerIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#151515',
  },
  headerActionBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1b130f',
    borderWidth: 1,
    borderColor: '#3d2418',
  },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  headerSubtitle: { color: '#777', fontSize: 12, marginTop: 2 },

  heroCard: {
    margin: 16,
    marginBottom: 0,
    backgroundColor: '#111',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    padding: 16,
    flexDirection: 'row',
    gap: 12,
  },
  heroTitle: { color: '#fff', fontSize: 20, fontWeight: '700' },
  heroMeta: { color: '#ff9b68', fontSize: 12, fontWeight: '600', marginTop: 4 },
  heroDescription: { color: '#bdbdbd', fontSize: 14, lineHeight: 20, marginTop: 8 },

  tabsRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 14 },
  tabBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: '#121212',
    borderWidth: 1,
    borderColor: '#262626',
  },
  tabBtnActive: { backgroundColor: '#2a170e', borderColor: '#834627' },
  tabBtnText: { color: '#8f8f8f', fontSize: 13, fontWeight: '600' },
  tabBtnTextActive: { color: '#ff9b68' },

  card: {
    marginTop: 14,
    marginHorizontal: 16,
    backgroundColor: '#111',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    padding: 16,
  },
  emptyCard: {
    marginHorizontal: 16,
    marginTop: 14,
    alignItems: 'center',
    padding: 28,
    backgroundColor: '#111',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1e1e1e',
  },
  cardTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  cardSubtitle: { color: '#7e7e7e', fontSize: 13, lineHeight: 18, marginTop: 4 },
  label: { color: '#d8d8d8', fontSize: 13, fontWeight: '700', marginTop: 14, marginBottom: 6 },
  textArea: {
    minHeight: 100,
    backgroundColor: '#171717',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#252525',
    color: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    textAlignVertical: 'top',
    fontSize: 15,
  },
  primaryBtn: {
    marginTop: 14,
    backgroundColor: '#ff6a2f',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1b130f',
    borderWidth: 1,
    borderColor: '#3d2418',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  secondaryBtnText: { color: '#ff9b68', fontSize: 12, fontWeight: '700' },

  membersHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#202020',
  },
  memberName: { flex: 1, color: '#f1f1f1', fontSize: 15, fontWeight: '600' },
  memberMeta: { color: '#7c7c7c', fontSize: 12, marginTop: 2 },
  rolePill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  rolePillText: { fontSize: 10, fontWeight: '800' },

  choicesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choicePill: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: '#151515',
    borderWidth: 1,
    borderColor: '#282828',
  },
  choicePillActive: { backgroundColor: '#2a170e', borderColor: '#834627' },
  choiceText: { color: '#9a9a9a', fontSize: 12, fontWeight: '600' },
  choiceTextActive: { color: '#ff9b68' },

  avatarFallback: { backgroundColor: '#1b1b1b', alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { color: '#f1f1f1', fontSize: 18, fontWeight: '700', marginTop: 12 },
  emptySubtitle: { color: '#6f6f6f', fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 8 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: '#111',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingBottom: 24,
    maxHeight: '78%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#212121',
  },
  modalTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  modalInput: {
    margin: 16,
    marginBottom: 8,
    backgroundColor: '#171717',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#262626',
    color: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  emptySearch: { color: '#666', textAlign: 'center', padding: 20 },
});
