import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  KeyboardAvoidingView,
  Platform,
  Pressable,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { decode } from 'base64-arraybuffer';
import PostCard from '../../src/components/PostCard';
import { useAuth } from '../../src/context/AuthContext';
import {
  SocialGroup,
  SocialGroupMember,
  SocialGroupModerationMode,
  SocialGroupPermission,
  SocialGroupPrivacy,
  useSocialGroups,
} from '../../src/hooks/useSocialGroups';
import { useResolvedGroupTheme } from '../../src/hooks/useGroupThemes';
import { supabase } from '../../src/services/supabase';
import { detectPlatform } from '../../src/utils/socialMedia';

interface PendingInvite {
  id: string;
  invited_user_id: string;
  created_at: string;
  role: string;
  invited_user?: {
    id?: string | null;
    username?: string | null;
    avatar_url?: string | null;
  } | null;
}

interface PendingJoinRequest {
  id: string;
  user_id: string;
  created_at: string;
  status: 'pending' | 'approved' | 'declined' | 'cancelled';
  user?: {
    id?: string | null;
    username?: string | null;
    avatar_url?: string | null;
  } | null;
}

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
    moderatePost,
    updateGroupSettings,
    deleteGroup,
    respondToJoinRequest,
  } = useSocialGroups(user?.id);
  const { theme: activeTheme } = useResolvedGroupTheme(user?.id, groupId);

  const scrollRef = useRef<ScrollView | null>(null);

  const [group, setGroup] = useState<SocialGroup | null>(null);
  const [members, setMembers] = useState<SocialGroupMember[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [joinRequests, setJoinRequests] = useState<PendingJoinRequest[]>([]);
  const [posts, setPosts] = useState<GroupPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingPosts, setLoadingPosts] = useState(true);
  const [loadingMemberMeta, setLoadingMemberMeta] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'posts' | 'members' | 'moderation' | 'about'>('posts');
  const [composerMode, setComposerMode] = useState<'text' | 'media' | 'social'>('text');
  const [draft, setDraft] = useState('');
  const [socialUrl, setSocialUrl] = useState('');
  const [mediaUri, setMediaUri] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<'image' | 'video'>('image');
  const [mediaBase64, setMediaBase64] = useState<string | null>(null);
  const [selectedThumb, setSelectedThumb] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [memberResults, setMemberResults] = useState<{ id: string; username: string; avatar_url: string | null }[]>([]);
  const [savingSettings, setSavingSettings] = useState(false);
  const [moderatingPostId, setModeratingPostId] = useState<string | null>(null);
  const [respondingJoinRequestId, setRespondingJoinRequestId] = useState<string | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [deletingGroup, setDeletingGroup] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [privacyDraft, setPrivacyDraft] = useState<SocialGroupPrivacy>('private');
  const [canPostDraft, setCanPostDraft] = useState<SocialGroupPermission>('members');
  const [canChatDraft, setCanChatDraft] = useState<SocialGroupPermission>('members');
  const [canInviteDraft, setCanInviteDraft] = useState<SocialGroupPermission>('mods');
  const [moderationModeDraft, setModerationModeDraft] = useState<SocialGroupModerationMode>('normal');

  const fetchGroup = useCallback(async () => {
    if (!groupId) return;

    setLoadingPosts(true);
    setLoadingMemberMeta(true);

    const [{ data: groupData, error: groupError }, { data: memberData, error: memberError }] = await Promise.all([
      supabase
        .from('social_groups')
        .select(`
          id, name, description, privacy, avatar_url, cover_url,
          created_by, chat_room_id, can_post, can_chat, can_invite,
          moderation_mode, pinned_post_id, created_at, updated_at
        `)
        .eq('id', groupId)
        .single(),
      supabase
        .from('social_group_members')
        .select(`
          group_id, user_id, role, invited_by, joined_at, last_seen_at,
          user:user_id ( id, username, avatar_url )
        `)
        .eq('group_id', groupId)
        .order('joined_at', { ascending: true }),
    ]);

    if (groupError || !groupData) {
      console.warn('[group] fetchGroup error:', groupError?.message);
      setGroup(null);
      setMembers([]);
      setPendingInvites([]);
      setJoinRequests([]);
      setPosts([]);
      setLoading(false);
      setLoadingPosts(false);
      setLoadingMemberMeta(false);
      setRefreshing(false);
      return;
    }

    if (memberError) {
      console.warn('[group] fetchMembers error:', memberError.message);
    }

    const normalizedMembers = (memberData ?? []) as SocialGroupMember[];
    const myRole = normalizedMembers.find(member => member.user_id === user?.id)?.role ?? null;
    const normalizedGroup: SocialGroup = {
      ...(groupData as SocialGroup),
      my_role: myRole as any,
      member_count: normalizedMembers.length,
    };

    setGroup(normalizedGroup);
    setDescriptionDraft(groupData.description ?? '');
    setPrivacyDraft(groupData.privacy as SocialGroupPrivacy);
    setCanPostDraft(groupData.can_post as SocialGroupPermission);
    setCanChatDraft(groupData.can_chat as SocialGroupPermission);
    setCanInviteDraft(groupData.can_invite as SocialGroupPermission);
    setModerationModeDraft((groupData.moderation_mode ?? 'normal') as SocialGroupModerationMode);
    setMembers(normalizedMembers);
    setLoading(false);

    const canReviewJoinRequests = !!myRole && ((groupData.can_invite as SocialGroupPermission) === 'members' || ['owner', 'admin', 'moderator'].includes(myRole));

    const [{ data: inviteData }, { data: postData, error: postError }, requestResult] = await Promise.all([
      supabase
        .from('social_group_invites')
        .select(`
          id, invited_user_id, created_at, role,
          invited_user:invited_user_id ( id, username, avatar_url )
        `)
        .eq('group_id', groupId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false }),
      supabase
        .from('posts')
        .select(`
          id, user_id, media_url, media_type, thumbnail_url, caption,
          social_url, platform, created_at, likes_count, comments_count,
          group:group_id ( id, name ),
          users:user_id ( id, username, avatar_url )
        `)
        .eq('group_id', groupId)
        .order('created_at', { ascending: false })
        .limit(50),
      canReviewJoinRequests
        ? supabase
            .from('social_group_join_requests')
            .select(`
              id, user_id, created_at, status,
              user:user_id ( id, username, avatar_url )
            `)
            .eq('group_id', groupId)
            .eq('status', 'pending')
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [] as any[] }),
    ]);

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

    const joinRequestData = ((requestResult?.data ?? []) as any[]).map((request) => ({
      ...request,
      user: Array.isArray(request.user) ? (request.user[0] ?? null) : (request.user ?? null),
    })) as PendingJoinRequest[];

    setPendingInvites(((inviteData ?? []) as any[]).map((invite) => ({
      ...invite,
      invited_user: Array.isArray(invite.invited_user) ? (invite.invited_user[0] ?? null) : (invite.invited_user ?? null),
    })) as PendingInvite[]);
    setJoinRequests(joinRequestData);
    setPosts(mergePostLikes(postData ?? [], likedIds));
    setLoadingPosts(false);
    setLoadingMemberMeta(false);
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
  const isReadOnly = group?.moderation_mode === 'read_only';
  const canInviteUsers = !!group && (group.can_invite === 'members' || canModerate);
  const canPost = !!group && (canModerate || (!isReadOnly && group.can_post === 'members'));
  const canChat = !!group && (group.can_chat === 'members' || canModerate);
  const manageableMembers = useMemo(
    () => members.filter(member => member.user_id !== user?.id),
    [members, user?.id]
  );
  const pendingMemberActionsCount = pendingInvites.length + joinRequests.length;
  const moderationQueue = useMemo(() => posts.slice(0, 12), [posts]);
  const themedCardStyle = useMemo(
    () => ({
      backgroundColor: activeTheme.surfaceSecondaryColor,
      borderColor: activeTheme.borderColor,
    }),
    [activeTheme.borderColor, activeTheme.surfaceSecondaryColor]
  );
  const themeOverlayOpacity = Math.max(0.14, Math.min(0.42, (activeTheme.overlayStrength ?? 72) / 180));
  const groupBannerUri = activeTheme.bannerImageUrl ?? group?.cover_url ?? null;

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
    const target = posts.find(post => post.id === postId);
    if (!target) return false;

    setModeratingPostId(postId);
    try {
      if (target.user_id === user?.id) {
        const { error } = await supabase
          .from('posts')
          .delete()
          .eq('id', postId)
          .eq('user_id', user?.id ?? '');

        if (error) {
          throw error;
        }
      } else if (groupId && canModerate) {
        const ok = await moderatePost(groupId, postId, 'Removed from group moderation tools');
        if (!ok) {
          Alert.alert('Error', 'Could not remove that post.');
          return false;
        }
      } else {
        Alert.alert('Not allowed', 'You do not have permission to remove this post.');
        return false;
      }

      setPosts(prev => prev.filter(post => post.id !== postId));
      return true;
    } catch (error: any) {
      Alert.alert('Error', error?.message ?? 'Could not delete post.');
      return false;
    } finally {
      setModeratingPostId(current => (current === postId ? null : current));
    }
  };

  const resetComposer = useCallback(() => {
    setDraft('');
    setSocialUrl('');
    setMediaUri(null);
    setMediaType('image');
    setMediaBase64(null);
    setSelectedThumb(null);
    setComposerMode('text');
  }, []);

  const pickMedia = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Camera roll access is required.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 0.8,
      base64: true,
      exif: false,
    });

    if (result.canceled || !result.assets[0]) {
      return;
    }

    const asset = result.assets[0];
    const isVideo = asset.type === 'video';
    setMediaUri(asset.uri);
    setMediaType(isVideo ? 'video' : 'image');
    setMediaBase64(isVideo ? null : (asset.base64 ?? null));
    setSelectedThumb(null);
    setComposerMode('media');

    if (isVideo) {
      try {
        const durationMs = Math.max(asset.duration ?? 3000, 1500);
        const { uri } = await VideoThumbnails.getThumbnailAsync(asset.uri, {
          time: Math.floor(durationMs * 0.33),
        });
        setSelectedThumb(uri);
      } catch (error) {
        console.warn('[group] thumbnail generation failed:', error);
      }
    }
  }, []);

  const uploadSelectedMedia = useCallback(async () => {
    if (!user?.id || !mediaUri) {
      return null;
    }

    let arrayBuffer: ArrayBuffer;
    let ext: string;
    let mime: string;

    if (mediaType === 'video') {
      ext = mediaUri.split('.').pop()?.split('?')[0]?.toLowerCase() ?? 'mp4';
      mime = ext === 'mov' ? 'video/quicktime' : 'video/mp4';
      const resp = await fetch(mediaUri);
      arrayBuffer = await resp.arrayBuffer();
    } else if (mediaBase64) {
      arrayBuffer = decode(mediaBase64);
      ext = 'jpg';
      mime = 'image/jpeg';
    } else {
      ext = mediaUri.split('.').pop()?.split('?')[0]?.toLowerCase() ?? 'jpg';
      mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'heic' ? 'image/heic' : 'image/jpeg';
      const resp = await fetch(mediaUri);
      arrayBuffer = await resp.arrayBuffer();
    }

    if (arrayBuffer.byteLength === 0) {
      throw new Error('Selected media could not be read.');
    }

    const storagePath = `${user.id}/${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from('posts')
      .upload(storagePath, arrayBuffer, { contentType: mime, upsert: false });

    if (uploadError) {
      throw uploadError;
    }

    const { data: publicData } = supabase.storage.from('posts').getPublicUrl(storagePath);
    let thumbnailUrl: string | null = null;

    if (mediaType === 'video' && selectedThumb) {
      try {
        const thumbResp = await fetch(selectedThumb);
        const thumbBuf = await thumbResp.arrayBuffer();
        if (thumbBuf.byteLength > 0) {
          const thumbPath = `${user.id}/${Date.now()}_thumb.jpg`;
          const { error: thumbError } = await supabase.storage
            .from('posts')
            .upload(thumbPath, thumbBuf, { contentType: 'image/jpeg', upsert: false });
          if (!thumbError) {
            const { data: thumbData } = supabase.storage.from('posts').getPublicUrl(thumbPath);
            thumbnailUrl = thumbData.publicUrl;
          }
        }
      } catch (error) {
        console.warn('[group] thumbnail upload failed:', error);
      }
    }

    return {
      mediaUrl: publicData.publicUrl,
      thumbnailUrl,
    };
  }, [mediaBase64, mediaType, mediaUri, selectedThumb, user?.id]);

  const insertGroupPost = useCallback(async (payload: {
    caption?: string | null;
    media_url?: string | null;
    media_type?: string | null;
    thumbnail_url?: string | null;
    social_url?: string | null;
    platform?: string | null;
  }) => {
    if (!user?.id || !groupId) {
      return null;
    }

    const { data, error } = await supabase
      .from('posts')
      .insert({
        user_id: user.id,
        group_id: groupId,
        post_scope: 'group',
        caption: payload.caption ?? null,
        media_url: payload.media_url ?? null,
        media_type: payload.media_type ?? null,
        thumbnail_url: payload.thumbnail_url ?? null,
        social_url: payload.social_url ?? null,
        platform: payload.platform ?? null,
      })
      .select(`
        id, user_id, media_url, media_type, thumbnail_url, caption,
        social_url, platform, created_at, likes_count, comments_count,
        group:group_id ( id, name ),
        users:user_id ( id, username, avatar_url )
      `)
      .single();

    if (error) {
      throw error;
    }

    return data;
  }, [groupId, user?.id]);

  const handlePost = async () => {
    if (!user?.id || !groupId || posting) return;

    const trimmedCaption = draft.trim();
    const trimmedUrl = socialUrl.trim();

    if (composerMode === 'text' && !trimmedCaption) {
      return;
    }
    if (composerMode === 'social' && !trimmedUrl) {
      Alert.alert('Link required', 'Paste a link to share in this group.');
      return;
    }
    if (composerMode === 'media' && !mediaUri) {
      Alert.alert('Media required', 'Choose a photo or video first.');
      return;
    }

    setPosting(true);

    try {
      let data: any = null;

      if (composerMode === 'text') {
        data = await insertGroupPost({
          caption: trimmedCaption,
        });
      } else if (composerMode === 'social') {
        data = await insertGroupPost({
          caption: trimmedCaption || null,
          social_url: trimmedUrl,
          platform: detectPlatform(trimmedUrl) ?? 'unknown',
        });
      } else {
        const uploaded = await uploadSelectedMedia();
        data = await insertGroupPost({
          caption: trimmedCaption || null,
          media_url: uploaded?.mediaUrl ?? null,
          media_type: mediaType,
          thumbnail_url: uploaded?.thumbnailUrl ?? null,
        });
      }

      if (!data) {
        Alert.alert('Error', 'Could not post to the group.');
        return;
      }

      setPosts(prev => [mergePostLikes([data], [])[0], ...prev]);
      resetComposer();
      setTab('posts');
    } catch (error: any) {
      Alert.alert('Error', error?.message ?? 'Could not post to the group.');
    } finally {
      setPosting(false);
    }
  };

  const searchUsers = useCallback(async (q: string) => {
    setMemberSearch(q);
    if (q.trim().length < 2) {
      setMemberResults([]);
      return;
    }
    const existingIds = new Set([
      ...members.map(member => member.user_id),
      ...pendingInvites.map(invite => invite.invited_user_id),
    ]);
    const { data } = await supabase
      .from('users')
      .select('id, username, avatar_url')
      .ilike('username', `%${q.trim()}%`)
      .neq('id', user?.id ?? '')
      .limit(15);
    setMemberResults(((data ?? []) as any[]).filter(item => !existingIds.has(item.id)));
  }, [members, pendingInvites, user?.id]);

  const handleInvite = async (userId: string) => {
    if (!groupId) return;
    const ok = await addMember(groupId, userId, 'member');
    if (!ok) {
      Alert.alert('Error', 'Could not send that invite.');
      return;
    }
    Alert.alert('Invite sent', 'They will appear in Members after they accept the invite.');
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
      moderationMode: moderationModeDraft,
    });
    setSavingSettings(false);
    if (!ok) {
      Alert.alert('Error', 'Could not save group settings.');
      return;
    }
    await fetchGroup();
    Alert.alert('Saved', 'Community settings updated.');
  };

  const handleModeratePostPress = (post: GroupPost) => {
    const actorLabel = post.user_id === user?.id ? 'Delete your post?' : 'Remove this post?';
    const message = post.user_id === user?.id
      ? 'This cannot be undone.'
      : 'This will remove the post for everyone in the group.';

    Alert.alert(actorLabel, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: post.user_id === user?.id ? 'Delete' : 'Remove',
        style: 'destructive',
        onPress: async () => {
          await handleDeletePost(post.id);
        },
      },
    ]);
  };

  const handleDeleteGroup = () => {
    if (!groupId || !group || myRole !== 'owner' || deletingGroup) return;

    if (deleteConfirmName.trim() !== group.name) {
      Alert.alert('Confirmation needed', `Type ${group.name} exactly to delete this group.`);
      return;
    }

    Alert.alert(
      'Delete group?',
      'This permanently removes the group, its posts, and the related chat room. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete group',
          style: 'destructive',
          onPress: async () => {
            setDeletingGroup(true);
            const result = await deleteGroup(groupId, deleteConfirmName.trim());
            setDeletingGroup(false);

            if (!result.ok) {
              Alert.alert('Error', result.errorMessage ?? 'Could not delete the group.');
              return;
            }

            setDeleteConfirmName('');
            router.replace('/(tabs)/feed' as any);
          },
        },
      ]
    );
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
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 84 : 0}
    >
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
        <View style={styles.headerActionsRow}>
          {canManage ? (
            <TouchableOpacity
              style={styles.headerActionBtn}
              onPress={() => router.push(`/group-theme/${group.id}` as any)}
            >
              <Ionicons name="color-palette-outline" size={20} color="#ff9b68" />
            </TouchableOpacity>
          ) : null}
          {group.chat_room_id ? (
            <TouchableOpacity
              style={[styles.headerActionBtn, !canChat && { opacity: 0.55 }]}
              onPress={() => canChat ? router.push(`/chat/${group.chat_room_id}` as any) : Alert.alert('Chat limited', 'Only moderators can chat in this group right now.')}
            >
              <Ionicons name="chatbubble-ellipses-outline" size={20} color="#ff9b68" />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#ff6a2f" />}
        contentContainerStyle={{ paddingBottom: myRole === 'owner' ? 200 : 32 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      >
        <View style={[styles.heroCard, { backgroundColor: activeTheme.surfaceColor, borderColor: activeTheme.borderColor }]}> 
          {groupBannerUri ? <Image source={{ uri: groupBannerUri }} style={styles.heroBannerImage} /> : null}
          {groupBannerUri ? <View style={[styles.heroBannerOverlay, { backgroundColor: `rgba(0,0,0,${themeOverlayOpacity})` }]} /> : null}
          <View style={styles.heroCardContent}>
            <Avatar uri={group.avatar_url} size={58} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.heroTitle, { color: activeTheme.textColor }]}>{group.name}</Text>
              <Text style={[styles.heroMeta, { color: activeTheme.accentColor }]}>
                {group.privacy === 'public' ? 'Public community' : group.privacy === 'invite_only' ? 'Invite only' : 'Private community'}
                {group.moderation_mode === 'read_only' ? ' • Read only mode' : ''}
              </Text>
              {!!group.description && <Text style={[styles.heroDescription, { color: activeTheme.mutedTextColor }]}>{group.description}</Text>}
              <View style={styles.heroStatsRow}>
                <View style={[styles.heroStatChip, { backgroundColor: activeTheme.chipBackgroundColor, borderColor: activeTheme.borderColor }]}> 
                  <Ionicons name="people-outline" size={14} color={activeTheme.chipTextColor} />
                  <Text style={[styles.heroStatText, { color: activeTheme.chipTextColor }]}>{members.length} members</Text>
                </View>
                <View style={[styles.heroStatChip, { backgroundColor: activeTheme.chipBackgroundColor, borderColor: activeTheme.borderColor }]}> 
                  <Ionicons name="albums-outline" size={14} color={activeTheme.chipTextColor} />
                  <Text style={[styles.heroStatText, { color: activeTheme.chipTextColor }]}>{posts.length} posts</Text>
                </View>
                <View style={[styles.heroStatChip, { backgroundColor: activeTheme.chipBackgroundColor, borderColor: activeTheme.borderColor }]}> 
                  <Ionicons name="create-outline" size={14} color={activeTheme.accentColor} />
                  <Text style={[styles.heroStatText, { color: activeTheme.chipTextColor }]}>
                    {group.can_post === 'members' && !isReadOnly ? 'Members can post' : isReadOnly ? 'Read only' : 'Moderators post'}
                  </Text>
                </View>
              </View>
              {canManage ? (
                <View style={styles.heroAdminActionsWrap}>
                  <Text style={[styles.heroAdminHint, { color: activeTheme.mutedTextColor }]}>Admin shortcut: update the group photo, banner, and theme from one place.</Text>
                  <TouchableOpacity
                    style={[styles.heroAppearanceBtn, { backgroundColor: activeTheme.chipBackgroundColor, borderColor: activeTheme.borderColor }]}
                    onPress={() => router.push(`/group-theme/${group.id}` as any)}
                  >
                    <Ionicons name="color-palette-outline" size={16} color={activeTheme.chipTextColor} />
                    <Text style={[styles.heroAppearanceBtnText, { color: activeTheme.chipTextColor }]}>Customize appearance</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        <View style={styles.tabsRow}>
          <TouchableOpacity
            style={[styles.tabBtn, { backgroundColor: tab === 'posts' ? activeTheme.chipBackgroundColor : activeTheme.surfaceSecondaryColor, borderColor: activeTheme.borderColor }, tab === 'posts' && styles.tabBtnActive]}
            onPress={() => setTab('posts')}
          >
            <Text style={[styles.tabBtnText, { color: tab === 'posts' ? activeTheme.chipTextColor : activeTheme.mutedTextColor }, tab === 'posts' && styles.tabBtnTextActive]}>Posts</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabBtn, { backgroundColor: tab === 'members' ? activeTheme.chipBackgroundColor : activeTheme.surfaceSecondaryColor, borderColor: activeTheme.borderColor }, tab === 'members' && styles.tabBtnActive]}
            onPress={() => setTab('members')}
          >
            <View style={styles.tabBtnLabelRow}>
              <Text style={[styles.tabBtnText, { color: tab === 'members' ? activeTheme.chipTextColor : activeTheme.mutedTextColor }, tab === 'members' && styles.tabBtnTextActive]}>Members</Text>
              {canModerate && pendingMemberActionsCount > 0 ? (
                <View style={styles.tabBtnBadge}>
                  <Text style={styles.tabBtnBadgeText}>{pendingMemberActionsCount}</Text>
                </View>
              ) : null}
            </View>
          </TouchableOpacity>
          {canModerate ? (
            <TouchableOpacity
              style={[styles.tabBtn, { backgroundColor: tab === 'moderation' ? activeTheme.chipBackgroundColor : activeTheme.surfaceSecondaryColor, borderColor: activeTheme.borderColor }, tab === 'moderation' && styles.tabBtnActive]}
              onPress={() => setTab('moderation')}
            >
              <Text style={[styles.tabBtnText, { color: tab === 'moderation' ? activeTheme.chipTextColor : activeTheme.mutedTextColor }, tab === 'moderation' && styles.tabBtnTextActive]}>Moderation</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={[styles.tabBtn, { backgroundColor: tab === 'about' ? activeTheme.chipBackgroundColor : activeTheme.surfaceSecondaryColor, borderColor: activeTheme.borderColor }, tab === 'about' && styles.tabBtnActive]}
            onPress={() => setTab('about')}
          >
            <Text style={[styles.tabBtnText, { color: tab === 'about' ? activeTheme.chipTextColor : activeTheme.mutedTextColor }, tab === 'about' && styles.tabBtnTextActive]}>About</Text>
          </TouchableOpacity>
        </View>

        {tab === 'posts' ? (
          <>
            <View style={[styles.card, themedCardStyle]}>
              <Text style={styles.cardTitle}>Post to {group.name}</Text>
              <Text style={styles.cardSubtitle}>
                {canPost
                  ? isReadOnly
                    ? 'Read only mode is active for members. Moderator posts still appear in the feed.'
                    : 'Share text updates, embedded links, or media with this community.'
                  : 'Only moderators can post in this group right now.'}
              </Text>

              <View style={styles.composerModeRow}>
                {([
                  { key: 'text', label: 'Text', icon: 'chatbubble-ellipses-outline' },
                  { key: 'social', label: 'Link', icon: 'link-outline' },
                  { key: 'media', label: 'Media', icon: 'image-outline' },
                ] as const).map(option => (
                  <TouchableOpacity
                    key={option.key}
                    style={[
                      styles.composerModeChip,
                      composerMode === option.key && styles.composerModeChipActive,
                      !canPost && { opacity: 0.55 },
                    ]}
                    disabled={!canPost}
                    onPress={() => {
                      setComposerMode(option.key);
                      if (option.key === 'media' && !mediaUri) {
                        void pickMedia();
                      }
                    }}
                  >
                    <Ionicons
                      name={option.icon as any}
                      size={15}
                      color={composerMode === option.key ? '#ff9b68' : '#8a8a8a'}
                    />
                    <Text style={[
                      styles.composerModeChipText,
                      composerMode === option.key && styles.composerModeChipTextActive,
                    ]}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {composerMode === 'social' ? (
                <TextInput
                  style={[styles.urlInput, !canPost && { opacity: 0.55 }]}
                  editable={!!canPost}
                  placeholder={canPost ? 'Paste YouTube, Instagram, TikTok, etc.' : 'Posting restricted'}
                  placeholderTextColor="#666"
                  value={socialUrl}
                  onChangeText={setSocialUrl}
                  autoCapitalize="none"
                  keyboardType="url"
                />
              ) : null}

              {composerMode === 'media' ? (
                <>
                  <TouchableOpacity
                    style={[styles.mediaPicker, !canPost && { opacity: 0.55 }]}
                    disabled={!canPost}
                    onPress={() => void pickMedia()}
                    activeOpacity={0.82}
                  >
                    {mediaUri ? (
                      mediaType === 'video' ? (
                        selectedThumb ? (
                          <Image source={{ uri: selectedThumb }} style={styles.mediaPreview} />
                        ) : (
                          <View style={styles.mediaPlaceholder}>
                            <Ionicons name="videocam-outline" size={32} color="#ff9b68" />
                            <Text style={styles.mediaPlaceholderText}>Video selected</Text>
                          </View>
                        )
                      ) : (
                        <Image source={{ uri: mediaUri }} style={styles.mediaPreview} />
                      )
                    ) : (
                      <View style={styles.mediaPlaceholder}>
                        <Ionicons name="cloud-upload-outline" size={32} color="#666" />
                        <Text style={styles.mediaPlaceholderText}>Tap to choose a photo or video</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                  {mediaUri ? (
                    <Text style={styles.mediaMetaText}>
                      {mediaType === 'video' ? 'Video will upload with a generated thumbnail.' : 'Image selected and ready to upload.'}
                    </Text>
                  ) : null}
                </>
              ) : null}

              <TextInput
                style={[styles.textArea, !canPost && { opacity: 0.55 }]}
                editable={!!canPost}
                multiline
                placeholder={
                  canPost
                    ? composerMode === 'text'
                      ? 'Share an update with your group…'
                      : composerMode === 'social'
                        ? 'Add an optional caption…'
                        : 'Add an optional caption for this media…'
                    : 'Posting restricted'
                }
                placeholderTextColor="#666"
                value={draft}
                onChangeText={setDraft}
              />
              <TouchableOpacity
                style={[
                  styles.primaryBtn,
                  (!canPost || posting || (composerMode === 'text' && !draft.trim()) || (composerMode === 'social' && !socialUrl.trim()) || (composerMode === 'media' && !mediaUri)) && { opacity: 0.45 },
                ]}
                disabled={!canPost || posting || (composerMode === 'text' && !draft.trim()) || (composerMode === 'social' && !socialUrl.trim()) || (composerMode === 'media' && !mediaUri)}
                onPress={handlePost}
              >
                {posting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.primaryBtnText}>Post to group</Text>}
              </TouchableOpacity>
            </View>

            {loadingPosts ? (
              <View style={[styles.emptyCard, themedCardStyle]}>
                <ActivityIndicator color="#ff6a2f" size="small" />
                <Text style={styles.emptyTitle}>Loading posts…</Text>
              </View>
            ) : posts.length === 0 ? (
              <View style={[styles.emptyCard, themedCardStyle]}>
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
                  canManagePost={canModerate}
                />
              </View>
            ))}
          </>
        ) : null}

        {tab === 'members' ? (
          <View style={[styles.card, themedCardStyle]}>
            <View style={styles.membersHeader}>
              <View style={styles.membersHeaderTextWrap}>
                <Text style={styles.cardTitle}>Members</Text>
                <Text style={styles.cardSubtitle}>Browse the roster, pending invites, join requests, and who runs this community.</Text>
              </View>
              {canInviteUsers ? (
                <TouchableOpacity style={styles.secondaryBtn} onPress={() => setShowInviteModal(true)}>
                  <Ionicons name="person-add-outline" size={16} color="#ff9b68" />
                  <Text style={styles.secondaryBtnText}>Invite</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {loadingMemberMeta ? (
              <View style={styles.inlineLoadingWrap}>
                <ActivityIndicator color="#ff6a2f" size="small" />
                <Text style={styles.inlineLoadingText}>Refreshing invites and join requests…</Text>
              </View>
            ) : null}

            {pendingInvites.length > 0 ? (
              <View style={styles.pendingInvitesWrap}>
                <Text style={styles.pendingInvitesTitle}>Pending invites</Text>
                {pendingInvites.map(invite => (
                  <View key={invite.id} style={styles.pendingInviteRow}>
                    <Avatar uri={invite.invited_user?.avatar_url} size={38} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.memberName}>{invite.invited_user?.username ?? invite.invited_user_id}</Text>
                      <Text style={styles.pendingInviteMeta}>Awaiting response • sent {timeAgo(invite.created_at)} ago</Text>
                    </View>
                    <View style={styles.pendingInvitePill}>
                      <Text style={styles.pendingInvitePillText}>{invite.role.toUpperCase()}</Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            {joinRequests.length > 0 ? (
              <View style={styles.pendingInvitesWrap}>
                <Text style={styles.pendingInvitesTitle}>Join requests</Text>
                {joinRequests.map(request => {
                  const approving = respondingJoinRequestId === `${request.id}:approve`;
                  const declining = respondingJoinRequestId === `${request.id}:decline`;
                  const busy = approving || declining;
                  return (
                    <View key={request.id} style={styles.pendingInviteRow}>
                      <Avatar uri={request.user?.avatar_url} size={38} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.memberName}>{request.user?.username ?? request.user_id}</Text>
                        <Text style={styles.pendingInviteMeta}>Requested access {timeAgo(request.created_at)} ago</Text>
                      </View>
                      <View style={styles.joinRequestActions}>
                        <TouchableOpacity
                          style={[styles.joinRequestBtn, styles.joinRequestBtnGhost, busy && { opacity: 0.55 }]}
                          disabled={busy}
                          onPress={() => handleRespondToJoinRequest(request.id, 'decline')}
                        >
                          {declining ? <ActivityIndicator size="small" color="#a8a8a8" /> : <Text style={[styles.joinRequestBtnText, styles.joinRequestBtnGhostText]}>Decline</Text>}
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.joinRequestBtn, busy && { opacity: 0.55 }]}
                          disabled={busy}
                          onPress={() => handleRespondToJoinRequest(request.id, 'approve')}
                        >
                          {approving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.joinRequestBtnText}>Approve</Text>}
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : null}

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

        {tab === 'moderation' ? (
          <View style={[styles.card, themedCardStyle]}>
            <Text style={styles.cardTitle}>Moderation console</Text>
            <Text style={styles.cardSubtitle}>Admins manage members. Moderators can quickly remove posts that break the rules.</Text>

            <View style={styles.moderationBanner}>
              <Ionicons name="shield-checkmark-outline" size={18} color="#ff9b68" />
              <Text style={styles.moderationBannerText}>
                {canManage
                  ? 'Tap any member below to change roles or remove them from the group.'
                  : 'You can remove posts here, but only owners and admins can change member roles.'}
              </Text>
            </View>

            {canManage ? (
              <View style={styles.moderationSection}>
                <Text style={styles.sectionTitle}>Member actions</Text>
                <Text style={styles.sectionHint}>Promote trusted members, demote roles, or remove them from the group.</Text>
                {manageableMembers.length > 0 ? manageableMembers.map(member => (
                  <TouchableOpacity
                    key={member.user_id}
                    style={styles.moderationRow}
                    onPress={() => handleMemberPress(member)}
                    activeOpacity={0.82}
                  >
                    <Avatar uri={member.user?.avatar_url} size={40} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.memberName}>{member.user?.username ?? member.user_id}</Text>
                      <Text style={styles.memberMeta}>Current role: {member.role}</Text>
                    </View>
                    <View style={styles.manageBadge}>
                      <Text style={styles.manageBadgeText}>Manage</Text>
                    </View>
                  </TouchableOpacity>
                )) : (
                  <Text style={styles.emptySearch}>No other members to manage yet.</Text>
                )}
              </View>
            ) : null}

            <View style={styles.moderationSection}>
              <Text style={styles.sectionTitle}>Recent posts</Text>
              <Text style={styles.sectionHint}>Use this queue to remove spam, abusive posts, or off-topic content.</Text>
              {moderationQueue.length > 0 ? moderationQueue.map(post => {
                const isBusy = moderatingPostId === post.id;
                return (
                  <View key={post.id} style={styles.modPostCard}>
                    <View style={styles.modPostHeader}>
                      <Avatar uri={post.users?.avatar_url} size={36} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.memberName}>{post.users?.username ?? 'Unknown pilot'}</Text>
                        <Text style={styles.memberMeta}>Posted {timeAgo(post.created_at)} ago</Text>
                      </View>
                    </View>
                    <Text style={styles.modPostCaption} numberOfLines={3}>
                      {post.caption?.trim() || 'Media post with no caption'}
                    </Text>
                    <TouchableOpacity
                      style={[styles.destructiveBtn, isBusy && { opacity: 0.6 }]}
                      disabled={isBusy}
                      onPress={() => handleModeratePostPress(post)}
                    >
                      {isBusy ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <>
                          <Ionicons name="trash-outline" size={16} color="#fff" />
                          <Text style={styles.destructiveBtnText}>
                            {post.user_id === user?.id ? 'Delete your post' : 'Remove post'}
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                );
              }) : (
                <Text style={styles.emptySearch}>No posts need attention right now.</Text>
              )}
            </View>
          </View>
        ) : null}

        {tab === 'about' ? (
          <View style={[styles.card, themedCardStyle]}>
            <Text style={styles.cardTitle}>Community settings</Text>
            <Text style={styles.cardSubtitle}>Owners and admins can tune who posts, chats, invites, and whether the group is temporarily read only.</Text>

            <View style={[styles.appearanceBanner, { backgroundColor: activeTheme.surfaceColor, borderColor: activeTheme.borderColor }]}> 
              <View style={{ flex: 1 }}>
                <Text style={[styles.sectionTitle, { color: activeTheme.textColor }]}>Appearance studio</Text>
                <Text style={[styles.appearanceBannerText, { color: activeTheme.mutedTextColor }]}>Edit the group photo and banner, switch free presets, and preview premium custom themes without leaving this community.</Text>
              </View>
              <TouchableOpacity
                style={[styles.secondaryBtn, { backgroundColor: activeTheme.chipBackgroundColor, borderColor: activeTheme.borderColor }]}
                onPress={() => router.push(`/group-theme/${group.id}` as any)}
              >
                <Ionicons name="color-palette-outline" size={16} color={activeTheme.chipTextColor} />
                <Text style={[styles.secondaryBtnText, { color: activeTheme.chipTextColor }]}>Edit photo & theme</Text>
              </TouchableOpacity>
            </View>

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

            <Text style={styles.label}>Posting mode</Text>
            <View style={styles.choicesRow}>
              {([
                { key: 'normal', label: 'Normal' },
                { key: 'read_only', label: 'Read only for members' },
              ] as { key: SocialGroupModerationMode; label: string }[]).map(option => (
                <TouchableOpacity
                  key={option.key}
                  disabled={!canManage}
                  style={[styles.choicePill, moderationModeDraft === option.key && styles.choicePillActive, !canManage && { opacity: 0.55 }]}
                  onPress={() => setModerationModeDraft(option.key)}
                >
                  <Text style={[styles.choiceText, moderationModeDraft === option.key && styles.choiceTextActive]}>{option.label}</Text>
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

            {myRole === 'owner' ? (
              <View style={styles.dangerCard}>
                <Text style={styles.dangerTitle}>Danger zone</Text>
                <Text style={styles.dangerText}>Type <Text style={styles.dangerHighlight}>{group.name}</Text> to permanently delete this group, all group posts, and the linked chat room.</Text>
                <TextInput
                  style={styles.dangerInput}
                  value={deleteConfirmName}
                  onChangeText={setDeleteConfirmName}
                  onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 180)}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                  keyboardAppearance="dark"
                  placeholder={`Type ${group.name}`}
                  placeholderTextColor="#666"
                />
                <TouchableOpacity
                  style={[styles.destructiveBtn, (deletingGroup || deleteConfirmName.trim() !== group.name) && { opacity: 0.5 }]}
                  disabled={deletingGroup || deleteConfirmName.trim() !== group.name}
                  onPress={handleDeleteGroup}
                >
                  {deletingGroup ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="warning-outline" size={16} color="#fff" />
                      <Text style={styles.destructiveBtnText}>Delete group permanently</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      <Modal visible={showInviteModal} animationType="slide" transparent onRequestClose={() => setShowInviteModal(false)}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <Pressable style={styles.modalBackdrop} onPress={() => setShowInviteModal(false)} />
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
              contentContainerStyle={styles.modalListContent}
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
                  : <Text style={styles.emptySearch}>Search for a pilot to invite</Text>
              }
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </KeyboardAvoidingView>
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
  headerActionsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
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
    overflow: 'hidden',
  },
  heroCardContent: {
    flexDirection: 'row',
    gap: 12,
    zIndex: 1,
  },
  heroBannerImage: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  heroBannerOverlay: {
    ...StyleSheet.absoluteFillObject,
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
  tabBtnLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tabBtnBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ff6a2f',
  },
  tabBtnBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
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
    alignSelf: 'flex-start',
    flexShrink: 1,
    gap: 6,
    backgroundColor: '#1b130f',
    borderWidth: 1,
    borderColor: '#3d2418',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  secondaryBtnText: { color: '#ff9b68', fontSize: 12, fontWeight: '700' },

  membersHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 6,
  },
  membersHeaderTextWrap: { flex: 1, minWidth: 0 },
  pendingInvitesWrap: {
    marginTop: 10,
    marginBottom: 6,
    borderRadius: 14,
    backgroundColor: '#151515',
    borderWidth: 1,
    borderColor: '#232323',
    overflow: 'hidden',
  },
  pendingInvitesTitle: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 4,
  },
  pendingInviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#202020',
  },
  pendingInviteMeta: { color: '#7c7c7c', fontSize: 12, marginTop: 2 },
  pendingInvitePill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#5b3c24',
    backgroundColor: '#2a170e',
  },
  pendingInvitePillText: { color: '#ff9b68', fontSize: 10, fontWeight: '800' },
  joinRequestActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  joinRequestBtn: {
    minWidth: 74,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ff6a2f',
  },
  joinRequestBtnGhost: {
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#2c2c2c',
  },
  joinRequestBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  joinRequestBtnGhostText: { color: '#b5b5b5' },
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
  heroStatsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  heroAdminActionsWrap: { marginTop: 14, gap: 10 },
  heroAdminHint: { fontSize: 12, lineHeight: 17 },
  heroAppearanceBtn: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  heroAppearanceBtnText: { fontSize: 12, fontWeight: '800' },
  heroStatChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#151a22',
    borderWidth: 1,
    borderColor: '#242b37',
  },
  heroStatText: { color: '#cfd6e3', fontSize: 12, fontWeight: '600' },

  composerModeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14, marginBottom: 12 },
  composerModeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: '#151515',
    borderWidth: 1,
    borderColor: '#282828',
  },
  composerModeChipActive: { backgroundColor: '#2a170e', borderColor: '#834627' },
  composerModeChipText: { color: '#9a9a9a', fontSize: 12, fontWeight: '600' },
  composerModeChipTextActive: { color: '#ff9b68' },
  urlInput: {
    backgroundColor: '#151515',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#262626',
    color: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    marginBottom: 12,
  },
  mediaPicker: {
    height: 176,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#262626',
    backgroundColor: '#151515',
    marginBottom: 8,
  },
  mediaPreview: { width: '100%', height: '100%', resizeMode: 'cover' },
  mediaPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  mediaPlaceholderText: { color: '#7b7b7b', fontSize: 13 },
  mediaMetaText: { color: '#7c7c7c', fontSize: 12, lineHeight: 18, marginBottom: 12 },

  choicesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  moderationBanner: {
    marginTop: 14,
    marginBottom: 8,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#3d2418',
    backgroundColor: '#1b130f',
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  moderationBannerText: { flex: 1, color: '#d7b29d', fontSize: 13, lineHeight: 18 },
  appearanceBanner: {
    marginTop: 14,
    marginBottom: 10,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  appearanceBannerText: { fontSize: 12, lineHeight: 18 },
  moderationSection: { marginTop: 18 },
  sectionTitle: { color: '#fff', fontSize: 14, fontWeight: '700' },
  sectionHint: { color: '#7e7e7e', fontSize: 12, lineHeight: 18, marginTop: 4, marginBottom: 8 },
  moderationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#202020',
  },
  manageBadge: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#132033',
    borderWidth: 1,
    borderColor: '#29496b',
  },
  manageBadgeText: { color: '#9cc8ff', fontSize: 11, fontWeight: '800' },
  modPostCard: {
    marginTop: 10,
    padding: 14,
    borderRadius: 16,
    backgroundColor: '#151515',
    borderWidth: 1,
    borderColor: '#232323',
  },
  modPostHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  modPostCaption: { color: '#d8d8d8', fontSize: 13, lineHeight: 19, marginTop: 10 },
  destructiveBtn: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#c24e39',
    borderRadius: 12,
    paddingVertical: 12,
  },
  destructiveBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  dangerCard: {
    marginTop: 20,
    padding: 14,
    borderRadius: 16,
    backgroundColor: '#1a1010',
    borderWidth: 1,
    borderColor: '#5b2b2b',
  },
  dangerTitle: { color: '#ffb4a6', fontSize: 15, fontWeight: '700' },
  dangerText: { color: '#d1a29c', fontSize: 13, lineHeight: 19, marginTop: 8 },
  dangerHighlight: { color: '#fff', fontWeight: '800' },
  dangerInput: {
    marginTop: 12,
    backgroundColor: '#130c0c',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#5b2b2b',
    color: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
  },
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
  inlineLoadingWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  inlineLoadingText: { color: '#8c8c97', fontSize: 13 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalBackdrop: { flex: 1 },
  modalSheet: {
    backgroundColor: '#111',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingBottom: 24,
    maxHeight: '82%',
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
  modalListContent: { paddingBottom: 28 },
  emptySearch: { color: '#666', textAlign: 'center', padding: 20 },
});
