// app/(tabs)/feed.tsx
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, Pressable,
  Modal, TextInput, ActivityIndicator, Alert, KeyboardAvoidingView,
  RefreshControl, StatusBar, Image,
  Animated, Easing, ScrollView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useFeed, FeedPost, FeedMode } from '../../src/hooks/useFeed';
import { useFeedAlgorithm } from '../../src/hooks/useFeedAlgorithm';
import { useAuth } from '../../src/context/AuthContext';
import { useProfile } from '../../src/hooks/useProfile';
import { useNotificationsContext } from '../../src/context/NotificationsContext';
import { useMute } from '../../src/hooks/useMute';
import { useSocialGroups } from '../../src/hooks/useSocialGroups';
import { PropsToast, usePropsToast } from '../../src/components/PropsToast';
import { detectPlatform } from '../../src/utils/socialMedia';
import { supabase } from '../../src/services/supabase';
import PostCard from '../../src/components/PostCard';
import MentionTextInputComponent from '../../src/components/MentionTextInput';
const MentionTextInput = MentionTextInputComponent as any;

const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 60 };
const FOCUS_REFRESH_DEBOUNCE_MS = 1200;

// ── FPV Tag System ────────────────────────────────────────────────────────────
const MAX_TAGS = 10;

// Weighted tag list: [tag, popularityWeight]
const TAG_POOL: [string, number][] = [
  ['#fpv',         100], ['#freestyle',  95], ['#race',       90],
  ['#bando',        85], ['#cinematic',  80], ['#quad',        78],
  ['#drone',        75], ['#whoop',       72], ['#longrange',   68],
  ['#gopro',        65], ['#miniquad',   62], ['#fpvlife',     60],
  ['#fpvpilot',     58], ['#ripping',    55], ['#proximity',   52],
  ['#5inch',        50], ['#3inch',       48], ['#toothpick',   46],
  ['#cinewhoop',    44], ['#dji',         42], ['#hdvtx',       40],
  ['#analog',       38], ['#betaflight',  36], ['#inav',        34],
  ['#builds',       32], ['#crashes',     30], ['#fpvracing',   28],
  ['#gates',        26], ['#flighttest',  24], ['#outdoors',    22],
  ['#indoors',      20], ['#fpvcommunity',18], ['#newpilot',    16],
  ['#tutorial',     14], ['#tips',        12], ['#review',      10],
];

const TAG_SUGGESTIONS = TAG_POOL.map(([t]) => t);

const TAG_COLORS = ['#ff4500','#00d4ff','#9c27b0','#ff9100','#00e676','#e91e63','#2979FF','#ffcc00'];
const tagColor = (tag: string) =>
  TAG_COLORS[Math.abs(tag.split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % TAG_COLORS.length];

/** Return suggestions ranked by: exact-start > contains > popularity */
function rankSuggestions(query: string, excluded: string[]): string[] {
  if (!query) return TAG_POOL.filter(([t]) => !excluded.includes(t)).slice(0, 6).map(([t]) => t);
  const q = query.toLowerCase().replace(/^#/, '');
  const scored = TAG_POOL
    .filter(([t]) => !excluded.includes(t) && t.replace('#','').includes(q))
    .map(([t, w]) => {
      const clean = t.replace('#','');
      const score = clean.startsWith(q) ? w + 1000 : w;
      return { tag: t, score };
    })
    .sort((a, b) => b.score - a.score);
  return scored.map(s => s.tag);
}
function parseMentions(text: string): string[] {
  const matches = text.match(/@([a-zA-Z0-9_]+)/g) ?? [];
  return [...new Set(matches.map(m => m.slice(1).toLowerCase()))];
}

async function sendMentionNotifications(
  caption: string,
  postId: string | null,
  actorId: string,
) {
  const usernames = parseMentions(caption);
  if (!usernames.length) return;
  const { data: mentioned } = await supabase
    .from('users')
    .select('id, username')
    .in('username', usernames)
    .neq('id', actorId);
  if (!mentioned?.length) return;
  await supabase.from('notifications').insert(
    mentioned.map((u: any) => ({
      user_id:  u.id,
      actor_id: actorId,
      type:     'mention',
      post_id:  postId ?? null,
    }))
  );
}

export default function FeedScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { profile } = useProfile(user?.id);
  // ── Feed Mode ────────────────────────────────────────────────────────────
  const [feedMode, setFeedMode] = useState<FeedMode>('for_you');

  // ── Personalisation algorithm ────────────────────────────────────────────
  const {
    profile: interestProfile,
    trackPostInteraction,
  } = useFeedAlgorithm(user?.id);

  const {
    posts, loading, refreshing,
    loadingMore, hasMore,
    onRefresh, loadMore,
    toggleLike,
    createPost, createSocialPost, deletePost,
    followingIds,
  } = useFeed(user?.id, feedMode, interestProfile);

  // ── Props award hook ────────────────────────────────────────────────────────
  const propsToast = usePropsToast();
  const { unreadCount } = useNotificationsContext();
  const { mutedIds } = useMute(user?.id);
  const { groups, pendingInvites } = useSocialGroups(user?.id);
  const lastRefreshAtRef = useRef(0);
  const hasInitialRefreshRef = useRef(false);
  const visiblePostIdRef = useRef<string | null>(null);
  const canLoadMoreOnMomentumRef = useRef(false);

  // ── Animated title ───────────────────────────────────────────────────────
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
    inputRange: [0, 0.25, 0.5, 0.75, 1],
    outputRange: ['#ff4500', '#ff8c00', '#ffcc00', '#ff6600', '#ff4500'],
  });

  const refreshFeed = useCallback(async (force = false) => {
    if (!user?.id) return;
    const now = Date.now();
    if (!force && now - lastRefreshAtRef.current < FOCUS_REFRESH_DEBOUNCE_MS) {
      return;
    }
    lastRefreshAtRef.current = now;
    await onRefresh();
  }, [user?.id, onRefresh]);

  useEffect(() => {
    if (!user?.id) {
      hasInitialRefreshRef.current = false;
      lastRefreshAtRef.current = 0;
      return;
    }
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      if (hasInitialRefreshRef.current) {
        void refreshFeed(false);
      } else {
        hasInitialRefreshRef.current = true;
      }
      return () => {
        Object.values(viewTimers.current).forEach(timer => {
          clearTimeout(timer);
        });
        viewTimers.current = {};
      };
    }, [refreshFeed])
  );

  // ── Autoplay tracking ────────────────────────────────────────────────────
  const [visiblePostId, setVisiblePostId] = useState<string | null>(null);
  const autoplayEnabled = profile?.autoplay_videos ?? true;
  // Track when a post enters the viewport (view signal for personalisation)
  const viewTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const onViewableItemsChanged = useCallback(({ viewableItems }: any) => {
    const nextVisibleId = autoplayEnabled && viewableItems.length > 0
      ? (viewableItems[0]?.item?.id ?? null)
      : null;

    if (visiblePostIdRef.current !== nextVisibleId) {
      visiblePostIdRef.current = nextVisibleId;
      setVisiblePostId(nextVisibleId);
    }

    const activeIds = new Set<string>(viewableItems.map((entry: any) => entry?.item?.id).filter(Boolean));
    Object.entries(viewTimers.current).forEach(([postId, timer]) => {
      if (!activeIds.has(postId)) {
        clearTimeout(timer);
        delete viewTimers.current[postId];
      }
    });

    if (user?.id && viewableItems.length > 0) {
      const item: FeedPost | undefined = viewableItems[0]?.item;
      if (item?.id && !viewTimers.current[item.id]) {
        viewTimers.current[item.id] = setTimeout(() => {
          delete viewTimers.current[item.id];
          trackPostInteraction('view', item);
        }, 2000);
      }
    }
  }, [autoplayEnabled, user?.id, trackPostInteraction]);

  // ── Modal state ──────────────────────────────────────────────────────────
  const [modalVisible, setModalVisible] = useState(false);
  const [modalMode, setModalMode] = useState<'media' | 'social'>('media');
  const [caption, setCaption] = useState('');
  const [postTags,  setPostTags]  = useState<string[]>([]);
  const [tagInput,  setTagInput]  = useState('');
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);
  const [acSelectedIdx, setAcSelectedIdx] = useState(-1);
  const tagInputRef  = useRef<TextInput>(null);
  const tagInputWrapRef = useRef<View>(null);
  const [socialUrl, setSocialUrl] = useState('');
  const [mediaUri, setMediaUri] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<'image' | 'video'>('image');
  const [mediaBase64, setMediaBase64] = useState<string | null>(null);
  const [videoThumbFrames, setVideoThumbFrames] = useState<string[]>([]);
  const [videoThumbTimes, setVideoThumbTimes]   = useState<number[]>([]);
  const [selectedThumb, setSelectedThumb] = useState<string | null>(null);
  const [thumbsLoading, setThumbsLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [postDestination, setPostDestination] = useState<'public' | 'group'>('public');
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [activeCommunityExpanded, setActiveCommunityExpanded] = useState(false);

  const postableGroups = useMemo(() => groups.filter(group => {
    const role = group.my_role ?? 'member';
    if (role === 'owner' || role === 'admin' || role === 'moderator') return true;
    return group.moderation_mode !== 'read_only' && group.can_post === 'members';
  }), [groups]);

  const selectedGroup = useMemo(() => (
    postableGroups.find(group => group.id === selectedGroupId) ?? null
  ), [postableGroups, selectedGroupId]);

  const detectedPlatform = detectPlatform(socialUrl);

  const groupLookup = useMemo(() => new Map(groups.map(group => [group.id, group])), [groups]);

  useEffect(() => {
    setActiveCommunityExpanded(false);
  }, [visiblePostId]);

  useEffect(() => {
    if (postDestination === 'group' && !selectedGroupId) {
      setSelectedGroupId(postableGroups[0]?.id ?? null);
    }
    if (postDestination === 'public' && selectedGroupId) {
      setSelectedGroupId(null);
    }
  }, [postDestination, postableGroups, selectedGroupId]);

  const resetModal = () => {
    setCaption('');
    setSocialUrl('');
    setMediaUri(null);
    setMediaBase64(null);
    setMediaType('image');
    setPostTags([]);
    setTagInput('');
    setShowTagSuggestions(false);
    setAcSelectedIdx(-1);
    setVideoThumbFrames([]);
    setVideoThumbTimes([]);
    setSelectedThumb(null);
    setThumbsLoading(false);
    setPostDestination('public');
    setSelectedGroupId(null);
  };

  const pickMedia = async () => {
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
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setMediaUri(asset.uri);
      const isVideo = asset.type === 'video';
      setMediaType(isVideo ? 'video' : 'image');
      setMediaBase64(isVideo ? null : (asset.base64 ?? null));

      // ── Generate 24 thumbnail frames spread across the full clip ──────
      if (isVideo) {
        setVideoThumbFrames([]);
        setVideoThumbTimes([]);
        setSelectedThumb(null);
        setThumbsLoading(true);
        try {
          // expo-image-picker returns duration in milliseconds already;
          // do NOT multiply by 1000 (that was the bug causing all frames
          // to be identical — every sample landed past the video end).
          const durationMs = asset.duration ?? 5000; // default 5 s if unknown
          // 24 frames; skip first 2% and last 2% (usually black/blurry)
          const COUNT = 24;
          const frames: string[] = [];
          const times:  number[] = [];
          for (let i = 0; i < COUNT; i++) {
            const pct  = 0.02 + (0.96 * i) / (COUNT - 1);
            const time = Math.max(0, Math.floor(durationMs * pct));
            try {
              const { uri } = await VideoThumbnails.getThumbnailAsync(asset.uri, { time });
              frames.push(uri);
              times.push(time);
            } catch {
              // skip failed frame
            }
          }
          setVideoThumbFrames(frames);
          setVideoThumbTimes(times);
          // Auto-select the frame closest to 33% (often a good establishing shot)
          const autoIdx = Math.round(frames.length * 0.33);
          setSelectedThumb(frames[autoIdx] ?? frames[0] ?? null);
        } catch (e) {
          console.warn('[feed] thumbnail generation failed:', e);
        } finally {
          setThumbsLoading(false);
        }
      }
    }
  };

  // ── Post handler ─────────────────────────────────────────────────────────
  const handlePost = async () => {
    if (creating) return;
    setCreating(true);
    try {
      let newPost: any = null;

      if (modalMode === 'social') {
        const trimmed = socialUrl.trim();
        if (!trimmed) { Alert.alert('Enter a URL'); return; }
        if (postDestination === 'group' && !selectedGroupId) { Alert.alert('Choose a community'); return; }
        newPost = await createSocialPost({
          socialUrl: trimmed,
          platform: detectedPlatform ?? 'unknown',
          caption,
          tags: postTags.length ? postTags : undefined,
          groupId: postDestination === 'group' ? selectedGroupId : null,
          postScope: postDestination,
        });
      } else {
        if (!mediaUri) { Alert.alert('Pick a media file first'); return; }
        if (postDestination === 'group' && !selectedGroupId) { Alert.alert('Choose a community'); return; }
        newPost = await createPost({
          mediaUrl: mediaUri,
          mediaType,
          caption,
          tags: postTags.length ? postTags : undefined,
          mediaBase64,
          thumbnailUrl: mediaType === 'video' ? selectedThumb : null,
          groupId: postDestination === 'group' ? selectedGroupId : null,
          postScope: postDestination,
        });
        if (newPost && (createPost as any).__lastAward) {
          propsToast.show('+50 Props! First post bonus 🎉');
          delete (createPost as any).__lastAward;
        }
      }

      if (user?.id) {
        sendMentionNotifications(caption, newPost?.id ?? null, user.id).catch(err =>
          console.warn('[feed] mention notification failed:', err)
        );
      }

      setModalVisible(false);
      resetModal();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Post failed');
    } finally {
      setCreating(false);
    }
  };

  const handleLike = useCallback((postId: string) => {
    toggleLike(postId);
    // Track like signal for personalisation
    const post = posts.find(p => p.id === postId);
    if (post && user?.id) {
      trackPostInteraction('like', post);
    }
  }, [toggleLike, posts, user?.id, trackPostInteraction]);

  // ── FIXED: async, awaits deletePost, alerts on failure ───────────────────
  const handleDelete = useCallback(async (postId: string): Promise<boolean> => {
    const success = await deletePost(postId);
    if (!success) {
      Alert.alert('Error', 'Could not delete post. Please try again.');
    }
    return success;
  }, [deletePost]);

  const visiblePosts = useMemo(() => (
    mutedIds.length > 0
      ? posts.filter(p => !p.user_id || !mutedIds.includes(p.user_id))
      : posts
  ), [mutedIds, posts]);

  const handleEndReached = useCallback(() => {
    if (!canLoadMoreOnMomentumRef.current || loadingMore || !hasMore) {
      return;
    }
    canLoadMoreOnMomentumRef.current = false;
    void loadMore();
  }, [hasMore, loadMore, loadingMore]);

  const renderPost = useCallback(({ item }: { item: FeedPost }) => {
    const community = item.group_id ? groupLookup.get(item.group_id) : null;
    const groupName = community?.name ?? item.group?.name ?? 'Community';
    const memberCount = community?.member_count ?? null;
    const privacyLabel = community?.privacy === 'invite_only' ? 'invite only' : (community?.privacy ?? null);
    const communityMeta = [
      typeof memberCount === 'number' ? `${memberCount} ${memberCount === 1 ? 'member' : 'members'}` : null,
      privacyLabel,
    ].filter(Boolean).join(' • ');
    const showCommunityBanner = item.id === visiblePostId && !!item.group_id;

    return (
      <View>
        {/* ── "Why this post?" chip — only in For You mode ── */}
        {feedMode === 'for_you' && item.tags && item.tags.length > 0 && (
          <View style={styles.whyChipRow}>
            <Ionicons name="sparkles-outline" size={11} color="#ff4500" />
            <Text style={styles.whyChipText}>
              Based on your interest in{' '}
              <Text style={styles.whyChipTag}>
                {item.tags.filter(t => interestProfile.tagWeights[t]).slice(0, 2).join(', ') || item.tags[0]}
              </Text>
            </Text>
          </View>
        )}

        {showCommunityBanner ? (
          <View style={styles.contextCommunityWrap}>
            <View style={styles.contextCommunityCard}>
              <TouchableOpacity
                style={styles.communitiesBanner}
                activeOpacity={0.84}
                onPress={() => setActiveCommunityExpanded(prev => !prev)}
              >
                <View style={styles.communitiesBannerTextWrap}>
                  <Text style={styles.contextCommunityEyebrow}>Community</Text>
                  <Text style={styles.groupRailName} numberOfLines={1}>{groupName}</Text>
                  <Text style={styles.communitiesBannerMeta} numberOfLines={1}>
                    {communityMeta || 'Open this group and keep browsing related posts.'}
                  </Text>
                </View>
                <View style={styles.communitiesBannerAction}>
                  <Ionicons name={activeCommunityExpanded ? 'chevron-up' : 'chevron-down'} size={18} color="#9cc8ff" />
                </View>
              </TouchableOpacity>

              {activeCommunityExpanded ? (
                <View style={styles.contextCommunityExpandedBody}>
                  <Text style={styles.contextCommunityHint}>
                    You are currently on a community post. Open the group, browse your group list, or discover more communities.
                  </Text>
                  <View style={styles.communitiesQuickRow}>
                    <TouchableOpacity
                      style={styles.communitiesSearchBtn}
                      activeOpacity={0.82}
                      onPress={() => router.push(`/group/${item.group_id}` as any)}
                    >
                      <Ionicons name="enter-outline" size={15} color="#9cc8ff" />
                      <Text style={styles.communitiesSearchBtnText}>Open group</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.communityQuickBtn}
                      activeOpacity={0.82}
                      onPress={() => router.push('/(tabs)/chat')}
                    >
                      <Ionicons name="people-outline" size={16} color="#ffb088" />
                      <Text style={styles.communityQuickBtnText}>Groups</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.communityQuickBtn}
                      activeOpacity={0.82}
                      onPress={() => router.push({ pathname: '/(tabs)/search', params: { tab: 'groups' } } as any)}
                    >
                      <Ionicons name="search-outline" size={16} color="#ffb088" />
                      <Text style={styles.communityQuickBtnText}>Browse</Text>
                    </TouchableOpacity>
                    {pendingInvites.length > 0 ? (
                      <TouchableOpacity
                        style={styles.communityQuickBtn}
                        activeOpacity={0.82}
                        onPress={() => router.push('/(tabs)/chat')}
                      >
                        <Ionicons name="mail-open-outline" size={16} color="#ffb088" />
                        <Text style={styles.communityQuickBtnText}>Invites</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
              ) : null}
            </View>
          </View>
        ) : null}

        <PostCard
          post={item}
          isVisible={item.id === visiblePostId}
          shouldAutoplay={autoplayEnabled}
          currentUserId={user?.id ?? undefined}
          onLike={handleLike}
          onDelete={handleDelete}
        />
      </View>
    );
  }, [activeCommunityExpanded, autoplayEnabled, feedMode, groupLookup, handleDelete, handleLike, interestProfile, pendingInvites.length, router, user?.id, visiblePostId]);

  if (loading && posts.length === 0) {
    return (
      <View style={[styles.container, styles.centered]}>
        <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />
        <ActivityIndicator size="large" color="#ff4500" />
        <Text style={styles.loadingText}>Loading feed...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />

      {/* ── Top Bar ── */}
      <View style={styles.topBar}>
        <Animated.Text style={[styles.topBarTitle, { color: animatedColor }]}>
          FPV Feed
        </Animated.Text>
        <View style={styles.topBarIcons}>
          <TouchableOpacity style={styles.topBarIcon} onPress={() => router.push('/(tabs)/search')}>
            <Ionicons name="search-outline" size={24} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.topBarIcon}
            onPress={() => router.push({ pathname: '/(tabs)/search', params: { tab: 'groups' } } as any)}
          >
            <Ionicons name="people-outline" size={24} color="#fff" />
            {pendingInvites.length > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{pendingInvites.length > 9 ? '9+' : pendingInvites.length}</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.topBarIcon} onPress={() => router.push('/(tabs)/notifications')}>
            <Ionicons name="notifications-outline" size={24} color="#fff" />
            {unreadCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Feed Mode Tabs ── */}
      <View style={styles.feedTabs}>
        {([
          { key: 'for_you',   label: '✦ For You'  },
          { key: 'following', label: 'Following'  },
          { key: 'recent',    label: 'Recent'     },
        ] as const).map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.feedTab, feedMode === tab.key && styles.feedTabActive]}
            onPress={() => setFeedMode(tab.key)}
            activeOpacity={0.75}
          >
            <Text style={[styles.feedTabText, feedMode === tab.key && styles.feedTabTextActive]}>
              {tab.label}
            </Text>
            {feedMode === tab.key && <View style={styles.feedTabUnderline} />}
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Following empty state ── */}
      {feedMode === 'following' && !loading && followingIds.length === 0 && (
        <View style={styles.followingEmpty}>
          <Ionicons name="people-outline" size={44} color="#333" />
          <Text style={styles.followingEmptyTitle}>No one followed yet</Text>
          <Text style={styles.followingEmptySubtitle}>Follow pilots to see their posts here.</Text>
        </View>
      )}

      {/* ── Feed List ── */}
      <FlatList
        data={visiblePosts}
        keyExtractor={item => item.id}
        renderItem={renderPost}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#ff4500" />
        }
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.35}
        onMomentumScrollBegin={() => { canLoadMoreOnMomentumRef.current = true; }}
        onScrollBeginDrag={() => { canLoadMoreOnMomentumRef.current = true; }}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={VIEWABILITY_CONFIG}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={Platform.OS === 'android'}
        initialNumToRender={4}
        maxToRenderPerBatch={4}
        windowSize={7}
        updateCellsBatchingPeriod={50}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
        contentContainerStyle={visiblePosts.length === 0 ? styles.emptyContainer : undefined}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="videocam-outline" size={64} color="#333" />
            <Text style={styles.emptyTitle}>No posts yet</Text>
            <Text style={styles.emptySubtitle}>Be the first to post!</Text>
          </View>
        }
        ListFooterComponent={
          visiblePosts.length > 0 ? (
            loadingMore ? (
              <View style={styles.footerLoader}>
                <ActivityIndicator size="small" color="#ff4500" />
                <Text style={styles.footerLoaderText}>Loading more posts...</Text>
              </View>
            ) : !hasMore ? (
              <View style={styles.footerEnd}>
                <View style={styles.footerEndLine} />
                <Text style={styles.footerEndText}>{"You\u2019re all caught up 🎉"}</Text>
                <View style={styles.footerEndLine} />
              </View>
            ) : null
          ) : null
        }
      />

      {/* ── FAB ── */}
      <TouchableOpacity style={styles.fab} onPress={() => setModalVisible(true)}>
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>

      {/* ── New Post Modal ── */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => { setModalVisible(false); resetModal(); }}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
        <View style={styles.modalOverlay}>
          <ScrollView
            style={styles.modalContainer}
            contentContainerStyle={styles.modalContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            automaticallyAdjustKeyboardInsets
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New Post</Text>
              <TouchableOpacity onPress={() => { setModalVisible(false); resetModal(); }}>
                <Ionicons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>

            {/* Mode toggle */}
            <View style={styles.modeToggle}>
              <TouchableOpacity
                style={[styles.modeBtn, modalMode === 'media' && styles.modeBtnActive]}
                onPress={() => setModalMode('media')}
              >
                <Ionicons name="image-outline" size={16} color={modalMode === 'media' ? '#fff' : '#888'} />
                <Text style={[styles.modeBtnText, modalMode === 'media' && styles.modeBtnTextActive]}>Media</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modeBtn, modalMode === 'social' && styles.modeBtnActive]}
                onPress={() => setModalMode('social')}
              >
                <Ionicons name="link-outline" size={16} color={modalMode === 'social' ? '#fff' : '#888'} />
                <Text style={[styles.modeBtnText, modalMode === 'social' && styles.modeBtnTextActive]}>Social Link</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.audienceCard}>
              <View style={styles.audienceHeader}>
                <Text style={styles.audienceLabel}>Post destination</Text>
                <Text style={styles.audienceHint}>Choose whether this lands in the public feed or one of your communities.</Text>
              </View>
              <View style={styles.audienceToggle}>
                <TouchableOpacity
                  style={[styles.audienceBtn, postDestination === 'public' && styles.audienceBtnActive]}
                  onPress={() => setPostDestination('public')}
                >
                  <Ionicons name="globe-outline" size={15} color={postDestination === 'public' ? '#fff' : '#888'} />
                  <Text style={[styles.audienceBtnText, postDestination === 'public' && styles.audienceBtnTextActive]}>Public feed</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.audienceBtn, postDestination === 'group' && styles.audienceBtnActive, postableGroups.length === 0 && styles.audienceBtnDisabled]}
                  onPress={() => postableGroups.length > 0 && setPostDestination('group')}
                  disabled={postableGroups.length === 0}
                >
                  <Ionicons name="people-outline" size={15} color={postDestination === 'group' ? '#fff' : '#888'} />
                  <Text style={[styles.audienceBtnText, postDestination === 'group' && styles.audienceBtnTextActive]}>Community</Text>
                </TouchableOpacity>
              </View>
              {postDestination === 'group' ? (
                postableGroups.length > 0 ? (
                  <>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.groupChoiceRow}
                    >
                      {postableGroups.map(group => {
                        const active = selectedGroupId === group.id;
                        return (
                          <TouchableOpacity
                            key={group.id}
                            style={[styles.groupChoiceChip, active && styles.groupChoiceChipActive]}
                            onPress={() => setSelectedGroupId(group.id)}
                            activeOpacity={0.82}
                          >
                            <Ionicons name={active ? 'checkmark-circle' : 'people-circle-outline'} size={15} color={active ? '#ffb089' : '#9a9a9a'} />
                            <Text style={[styles.groupChoiceChipText, active && styles.groupChoiceChipTextActive]} numberOfLines={1}>
                              {group.name}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                    {selectedGroup ? (
                      <Text style={styles.groupAudienceMeta}>
                        Members of {selectedGroup.name} will see this in the group feed and on the community page.
                      </Text>
                    ) : null}
                  </>
                ) : (
                  <Text style={styles.groupAudienceMeta}>
                    Join or create a community in Messages before posting to a group.
                  </Text>
                )
              ) : (
                <Text style={styles.groupAudienceMeta}>This post will be visible in the public feed.</Text>
              )}
            </View>

            {modalMode === 'media' ? (
              <>
                {/* ── Media preview + pick button ─────────────────────── */}
                <TouchableOpacity style={styles.mediaPicker} onPress={pickMedia}>
                  {mediaUri ? (
                    mediaType === 'video' ? (
                      selectedThumb ? (
                        /* key forces Image to re-mount when selection changes */
                        <Image
                          key={selectedThumb}
                          source={{ uri: selectedThumb }}
                          style={styles.mediaPreview}
                        />
                      ) : (
                        <View style={styles.mediaPlaceholder}>
                          <Ionicons name="videocam" size={40} color="#ff4500" />
                          <Text style={styles.mediaPlaceholderText}>
                            {thumbsLoading ? 'Generating frames…' : 'Video selected'}
                          </Text>
                        </View>
                      )
                    ) : (
                      <Image source={{ uri: mediaUri }} style={styles.mediaPreview} />
                    )
                  ) : (
                    <View style={styles.mediaPlaceholder}>
                      <Ionicons name="cloud-upload-outline" size={40} color="#666" />
                      <Text style={styles.mediaPlaceholderText}>Tap to pick image or video</Text>
                    </View>
                  )}
                </TouchableOpacity>
                {/* Change video shortcut shown once a video is loaded */}
                {mediaType === 'video' && mediaUri && !thumbsLoading && (
                  <TouchableOpacity style={styles.changeVideoBtn} onPress={pickMedia}>
                    <Ionicons name="swap-horizontal-outline" size={13} color="#888" />
                    <Text style={styles.changeVideoBtnText}>Change video</Text>
                  </TouchableOpacity>
                )}

                {mediaType === 'video' && (
                  <View style={styles.thumbPickerWrap}>
                    {thumbsLoading ? (
                      <View style={styles.thumbLoadingRow}>
                        <ActivityIndicator color="#ff4500" size="small" />
                        <Text style={styles.thumbLoadingText}>Scanning video for best frames…</Text>
                      </View>
                    ) : videoThumbFrames.length > 0 ? (
                      <>
                        {/* Label row with selected-time readout */}
                        <View style={styles.thumbLabelRow}>
                          <Text style={styles.thumbPickerLabel}>Choose thumbnail:</Text>
                          {selectedThumb && videoThumbTimes.length > 0 && (() => {
                            const selIdx = videoThumbFrames.indexOf(selectedThumb);
                            const ms = selIdx >= 0 ? (videoThumbTimes[selIdx] ?? 0) : 0;
                            const ss = String(Math.floor((ms / 1000) % 60)).padStart(2, '0');
                            const mm = String(Math.floor(ms / 60000)).padStart(2, '0');
                            return (
                              <Text style={styles.thumbSelectedTime}>{mm}:{ss}</Text>
                            );
                          })()}
                        </View>

                        {/*
                         * FlatList + Pressable instead of ScrollView + TouchableOpacity.
                         * Fixes iOS gesture-recogniser conflict where the outer vertical
                         * ScrollView swallows taps on children of an inner horizontal list.
                         */}
                        <FlatList
                          data={videoThumbFrames}
                          keyExtractor={(_, i) => `thumb-${i}`}
                          horizontal
                          showsHorizontalScrollIndicator={false}
                          contentContainerStyle={styles.thumbPickerRow}
                          keyboardShouldPersistTaps="always"
                          renderItem={({ item: uri, index: i }) => {
                            const isSelected = selectedThumb === uri;
                            // Suggest frames near 25%, 50%, 75% of the clip
                            const relPos = videoThumbFrames.length > 1
                              ? i / (videoThumbFrames.length - 1)
                              : 0;
                            const isSuggested =
                              Math.abs(relPos - 0.25) < 0.04 ||
                              Math.abs(relPos - 0.50) < 0.04 ||
                              Math.abs(relPos - 0.75) < 0.04;
                            const ms = videoThumbTimes[i] ?? 0;
                            const ss = String(Math.floor((ms / 1000) % 60)).padStart(2, '0');
                            const mm = String(Math.floor(ms / 60000)).padStart(2, '0');
                            return (
                              <View style={styles.thumbFrameWrap}>
                                {isSuggested && (
                                  <Text style={styles.thumbSuggestBadge}>⭐</Text>
                                )}
                                <Pressable
                                  onPress={() => setSelectedThumb(uri)}
                                  style={[
                                    styles.thumbFrame,
                                    isSelected && styles.thumbFrameSelected,
                                    isSuggested && !isSelected && styles.thumbFrameSuggested,
                                  ]}
                                >
                                  <Image source={{ uri }} style={styles.thumbFrameImg} />
                                  {isSelected && (
                                    <View style={styles.thumbCheckOverlay}>
                                      <Ionicons name="checkmark-circle" size={22} color="#ff4500" />
                                    </View>
                                  )}
                                </Pressable>
                                <Text style={styles.thumbTimeLabel}>{mm}:{ss}</Text>
                              </View>
                            );
                          }}
                        />
                        <Text style={styles.thumbHint}>⭐ = suggested best frame</Text>
                      </>
                    ) : null}
                  </View>
                )}
              </>
            ) : (
              <View>
                <TextInput
                  style={styles.urlInput}
                  placeholder="Paste YouTube or Instagram URL..."
                  placeholderTextColor="#555"
                  value={socialUrl}
                  onChangeText={setSocialUrl}
                  autoCapitalize="none"
                  keyboardType="url"
                />
                {detectedPlatform && (
                  <View style={[
                    styles.platformBadge,
                    detectedPlatform === 'youtube' ? styles.youtubeBadge : styles.instagramBadge,
                  ]}>
                    <Text style={styles.platformBadgeText}>{detectedPlatform.toUpperCase()}</Text>
                  </View>
                )}
              </View>
            )}

            <MentionTextInput
              inputStyle={styles.captionInput}
              placeholder="Add a caption..."
              placeholderTextColor="#555"
              value={caption}
              onChangeText={setCaption}
              multiline
              maxLength={500}
              currentUserId={user?.id}
              suggestionsAbove={false}
            />


            {/* ── Tags Input ────────────────────────────────────────────── */}
            <View style={styles.tagsBox}>
              <View style={styles.tagsHeader}>
                <Ionicons name="pricetag-outline" size={14} color="#ff4500" />
                <Text style={styles.tagsHeaderText}>Tags</Text>
                <Text style={[styles.tagsCount, postTags.length >= MAX_TAGS && styles.tagsCountFull]}>
                  {postTags.length}/{MAX_TAGS}
                </Text>
              </View>

              {/* Existing tag pills */}
              {postTags.length > 0 && (
                <View style={styles.tagPillsRow}>
                  {postTags.map((tag, idx) => (
                    <TouchableOpacity
                      key={tag}
                      activeOpacity={0.8}
                      style={[styles.tagPill, { borderColor: tagColor(tag) + '99', backgroundColor: tagColor(tag) + '22' }]}
                      onPress={() => setPostTags(prev => prev.filter(t => t !== tag))}
                    >
                      <Text style={[styles.tagPillText, { color: tagColor(tag) }]}>{tag}</Text>
                      <Ionicons name="close-circle" size={13} color={tagColor(tag) + 'cc'} />
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* Tag input row + floating dropdown anchor */}
              {postTags.length < MAX_TAGS && (
                <View
                  ref={tagInputWrapRef}
                  style={styles.tagInputWrap}
                >
                  <Ionicons name="search-outline" size={14} color="#555" style={styles.tagInputIcon} />
                  <TextInput
                    ref={tagInputRef}
                    style={styles.tagInput}
                    placeholder={postTags.length === 0 ? 'Search or create a tag…' : 'Add another tag…'}
                    placeholderTextColor="#444"
                    value={tagInput}
                    onChangeText={text => {
                      if (text.endsWith(',')) {
                        const raw = text.slice(0, -1).trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
                        if (raw.length >= 2 && postTags.length < MAX_TAGS) {
                          const tag = '#' + raw;
                          if (!postTags.includes(tag)) setPostTags(prev => [...prev, tag]);
                        }
                        setTagInput('');
                        setShowTagSuggestions(false);
                        setAcSelectedIdx(-1);
                      } else {
                        const cleaned = text.toLowerCase().replace(/[^a-z0-9#_]/g, '');
                        setTagInput(cleaned);
                        setShowTagSuggestions(cleaned.length > 0);
                        setAcSelectedIdx(-1);
                      }
                    }}
                    onSubmitEditing={() => {
                      const ranked = rankSuggestions(tagInput, postTags);
                      const chosen = acSelectedIdx >= 0 && ranked[acSelectedIdx]
                        ? ranked[acSelectedIdx]
                        : tagInput.trim().length >= 2
                          ? '#' + tagInput.trim().toLowerCase().replace(/[^a-z0-9_]/g, '')
                          : null;
                      if (chosen && postTags.length < MAX_TAGS && !postTags.includes(chosen)) {
                        setPostTags(prev => [...prev, chosen]);
                      }
                      setTagInput('');
                      setShowTagSuggestions(false);
                      setAcSelectedIdx(-1);
                    }}
                    onKeyPress={({ nativeEvent }) => {
                      const ranked = rankSuggestions(tagInput, postTags);
                      if (nativeEvent.key === 'Backspace' && tagInput === '' && postTags.length > 0) {
                        setPostTags(prev => prev.slice(0, -1));
                      } else if (nativeEvent.key === 'ArrowDown') {
                        setAcSelectedIdx(i => Math.min(i + 1, ranked.length - 1));
                      } else if (nativeEvent.key === 'ArrowUp') {
                        setAcSelectedIdx(i => Math.max(i - 1, -1));
                      }
                    }}
                    returnKeyType="done"
                    autoCapitalize="none"
                    autoCorrect={false}
                    maxLength={24}
                  />
                  {tagInput.length > 0 && (
                    <TouchableOpacity
                      onPress={() => { setTagInput(''); setShowTagSuggestions(false); setAcSelectedIdx(-1); }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="close-circle" size={16} color="#555" />
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {/* ── Floating Autocomplete Dropdown ─────────────────────────── */}
              {showTagSuggestions && postTags.length < MAX_TAGS && (() => {
                const ranked = rankSuggestions(tagInput, postTags);
                const q = tagInput.replace(/^#/, '').toLowerCase();
                const exactMatch = '#' + q;
                const showCreate = q.length >= 2 && !TAG_SUGGESTIONS.includes(exactMatch) && !postTags.includes(exactMatch);

                const addTag = (tag: string) => {
                  if (postTags.length < MAX_TAGS && !postTags.includes(tag)) {
                    setPostTags(prev => [...prev, tag]);
                  }
                  setTagInput('');
                  setShowTagSuggestions(false);
                  setAcSelectedIdx(-1);
                };

                return (
                  <View style={styles.acDropdown}>
                    <ScrollView
                      keyboardShouldPersistTaps="always"
                      showsVerticalScrollIndicator={false}
                      style={{ maxHeight: 210 }}
                    >
                      {ranked.length === 0 && !showCreate && (
                        <View style={styles.acEmpty}>
                          <Ionicons name="search-outline" size={18} color="#333" />
                          <Text style={styles.acEmptyText}>No matching tags</Text>
                        </View>
                      )}

                      {ranked.map((tag, idx) => {
                        const clean = tag.replace('#','');
                        const matchStart = clean.indexOf(q);
                        const isSelected = idx === acSelectedIdx;
                        const tc = tagColor(tag);
                        return (
                          <TouchableOpacity
                            key={tag}
                            style={[styles.acRow, isSelected && styles.acRowSelected]}
                            onPress={() => addTag(tag)}
                            activeOpacity={0.75}
                          >
                            {/* Colour dot */}
                            <View style={[styles.acDot, { backgroundColor: tc }]} />

                            {/* Tag name with highlighted match */}
                            <Text style={styles.acTagText}>
                              <Text style={styles.acHash}>#</Text>
                              {matchStart > 0 && (
                                <Text style={styles.acNormal}>{clean.slice(0, matchStart)}</Text>
                              )}
                              <Text style={[styles.acHighlight, { color: tc }]}>
                                {clean.slice(matchStart, matchStart + q.length)}
                              </Text>
                              <Text style={styles.acNormal}>
                                {clean.slice(matchStart + q.length)}
                              </Text>
                            </Text>

                            {/* Popularity badge */}
                            {TAG_POOL.find(([t]) => t === tag)?.[1] && (
                              <View style={[styles.acPopBadge, { backgroundColor: tc + '22', borderColor: tc + '44' }]}>
                                <Ionicons name="flame-outline" size={9} color={tc} />
                                <Text style={[styles.acPopText, { color: tc }]}>
                                  {TAG_POOL.find(([t]) => t === tag)?.[1]}
                                </Text>
                              </View>
                            )}

                            {isSelected && (
                              <Ionicons name="return-down-back-outline" size={13} color="#555" style={{ marginLeft: 4 }} />
                            )}
                          </TouchableOpacity>
                        );
                      })}

                      {/* Create custom tag row */}
                      {showCreate && (
                        <TouchableOpacity
                          style={[styles.acRow, styles.acCreateRow]}
                          onPress={() => addTag(exactMatch)}
                          activeOpacity={0.75}
                        >
                          <Ionicons name="add-circle-outline" size={16} color="#ff4500" />
                          <Text style={styles.acCreateText}>
                            Create{' '}
                            <Text style={styles.acCreateTag}>{exactMatch}</Text>
                          </Text>
                        </TouchableOpacity>
                      )}
                    </ScrollView>
                  </View>
                );
              })()}

              {/* ── Popular chips (shown when input is empty) ──────────────── */}
              {!showTagSuggestions && postTags.length < MAX_TAGS && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.suggestionsScroll}>
                  <View style={styles.suggestionsRow}>
                    {rankSuggestions('', postTags).map(s => (
                      <TouchableOpacity
                        key={s}
                        style={styles.suggestionChip}
                        onPress={() => {
                          if (postTags.length < MAX_TAGS && !postTags.includes(s))
                            setPostTags(prev => [...prev, s]);
                        }}
                      >
                        <View style={[styles.suggestionDot, { backgroundColor: tagColor(s) }]} />
                        <Text style={styles.suggestionChipText}>{s}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              )}
            </View>

            <TouchableOpacity
              style={[styles.postBtn, creating && styles.postBtnDisabled]}
              onPress={handlePost}
              disabled={creating}
            >
              {creating
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={styles.postBtnText}>Post</Text>
              }
            </TouchableOpacity>
          </ScrollView>
        </View>
        </KeyboardAvoidingView>
      </Modal>
    {/* ── Props award toast ─────────────────────────────────────────── */}
    <PropsToast toast={propsToast} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 52, paddingBottom: 12,
    backgroundColor: '#0a0a0a', borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  topBarTitle: { fontSize: 24, fontWeight: '800', letterSpacing: 1.5 },
  topBarIcons: { flexDirection: 'row', alignItems: 'center', gap: 4 } as any,
  topBarIcon: { padding: 6, position: 'relative' },
  badge: {
    position: 'absolute', top: 2, right: 2,
    backgroundColor: '#ff4500', borderRadius: 8,
    minWidth: 16, height: 16,
    justifyContent: 'center', alignItems: 'center', paddingHorizontal: 2,
  },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '700' },
  centered: { justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#666', marginTop: 12, fontSize: 14 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyState: { alignItems: 'center', paddingTop: 80 },
  emptyTitle: { color: '#fff', fontSize: 20, fontWeight: '700', marginTop: 16 },
  emptySubtitle: { color: '#666', fontSize: 14, marginTop: 8 },
  footerLoader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 24 },
  footerLoaderText: { color: '#888', fontSize: 13 },
  footerEnd:        { flexDirection: 'row', alignItems: 'center', paddingVertical: 28, paddingHorizontal: 24, gap: 12 },
  footerEndLine:    { flex: 1, height: 1, backgroundColor: '#1e1e1e' },
  footerEndText:    { color: '#555', fontSize: 12, fontWeight: '500' },
  fab: {
    position: 'absolute', bottom: 24, right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#ff4500',
    justifyContent: 'center', alignItems: 'center',
    elevation: 6, shadowColor: '#ff4500',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 8,
  },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  modalContainer: { backgroundColor: '#111', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '90%' },
  modalContent: { padding: 20, paddingBottom: 40 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  modeToggle: { flexDirection: 'row', backgroundColor: '#1a1a1a', borderRadius: 10, marginBottom: 16, padding: 4 },
  modeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 8, borderRadius: 8, gap: 6 } as any,
  modeBtnActive: { backgroundColor: '#ff4500' },
  modeBtnText: { color: '#888', fontSize: 14, fontWeight: '600' },
  modeBtnTextActive: { color: '#fff' },
  mediaPicker: { backgroundColor: '#1a1a1a', borderRadius: 12, overflow: 'hidden', marginBottom: 12, height: 180 },
  mediaPreview: { width: '100%', height: '100%', resizeMode: 'cover' },
  mediaPlaceholder: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 } as any,
  mediaPlaceholderText: { color: '#666', fontSize: 13 },
  thumbPickerWrap: { marginBottom: 12 },
  thumbPickerLabel: { color: '#888', fontSize: 12, marginBottom: 6 },
  thumbPickerRow: { paddingRight: 8, gap: 8 } as any,
  thumbFrame: { width: 80, height: 56, borderRadius: 8, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent' },
  thumbFrameSelected: { borderColor: '#ff4500' },
  thumbFrameImg: { width: '100%', height: '100%', resizeMode: 'cover' },
  thumbCheckOverlay: { position: 'absolute', bottom: 2, right: 2, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 11 },
  thumbLoadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 } as any,
  thumbLoadingText: { color: '#666', fontSize: 12 },
  urlInput: { backgroundColor: '#1a1a1a', borderRadius: 10, padding: 12, color: '#fff', fontSize: 14, marginBottom: 8 },
  platformBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, marginBottom: 8 },
  youtubeBadge: { backgroundColor: '#ff0000' },
  instagramBadge: { backgroundColor: '#833ab4' },
  platformBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  captionInput: { backgroundColor: '#1a1a1a', borderRadius: 10, padding: 12, color: '#fff', fontSize: 14, minHeight: 80, textAlignVertical: 'top', marginBottom: 12 },
  postBtn: { backgroundColor: '#ff4500', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  postBtnDisabled: { opacity: 0.5 },
  postBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  // ── Tags ────────────────────────────────────────────────────────────────
  tagsBox: {
    backgroundColor: '#0d1117',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1e2a3a',
    padding: 12,
    marginBottom: 12,
  },
  tagsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  tagsHeaderText: {
    color: '#ff4500',
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
  },
  tagsCount: { color: '#444', fontSize: 11, fontWeight: '600' },
  tagsCountFull: { color: '#ff4500' },
  tagPillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  tagPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 5,
  },
  tagPillText: { fontSize: 12, fontWeight: '700' },

  // input row
  tagInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111827',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e2a3a',
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
    gap: 8,
  },
  tagInputIcon: {},
  tagInput: {
    flex: 1,
    color: '#fff',
    fontSize: 13,
    paddingVertical: 0,
  },

  // ── Autocomplete dropdown ─────────────────────────────────────────────
  acDropdown: {
    backgroundColor: '#10121e',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e2a3a',
    marginBottom: 8,
    overflow: 'hidden',
    // subtle shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 8,
  },
  acRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1f2e',
  },
  acRowSelected: {
    backgroundColor: '#1e2a3a',
  },
  acDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  acTagText: {
    flex: 1,
    fontSize: 14,
  },
  acHash: { color: '#555', fontWeight: '700' },
  acNormal: { color: '#ccc' },
  acHighlight: { fontWeight: '800' },

  acPopBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  acPopText: { fontSize: 10, fontWeight: '700' },

  acCreateRow: {
    gap: 8,
    borderBottomWidth: 0,
    backgroundColor: '#ff450010',
  },
  acCreateText: { flex: 1, color: '#888', fontSize: 13 },
  acCreateTag:  { color: '#ff4500', fontWeight: '800' },

  acEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 14,
    justifyContent: 'center',
  },
  acEmptyText: { color: '#333', fontSize: 13 },

  // popular chips row
  suggestionsScroll: { marginTop: 4 },
  suggestionsRow: { flexDirection: 'row', gap: 6, paddingBottom: 2 },
  suggestionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#111827',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#1e2a3a',
  },
  suggestionDot: { width: 6, height: 6, borderRadius: 3 },
  suggestionChipActive: {
    borderColor: '#ff4500',
    backgroundColor: '#ff450015',
  },
  suggestionChipText: { color: '#666', fontSize: 11, fontWeight: '600' },


  audienceCard: {
    backgroundColor: '#151515',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#232323',
    padding: 14,
    marginBottom: 16,
    gap: 10,
  },
  audienceHeader: { gap: 4 },
  audienceLabel: { color: '#fff', fontSize: 14, fontWeight: '700' },
  audienceHint: { color: '#7d7d7d', fontSize: 12, lineHeight: 17 },
  audienceToggle: { flexDirection: 'row', gap: 8 },
  audienceBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#101010',
    borderWidth: 1,
    borderColor: '#262626',
  },
  audienceBtnActive: { backgroundColor: '#2a170e', borderColor: '#834627' },
  audienceBtnDisabled: { opacity: 0.45 },
  audienceBtnText: { color: '#8c8c8c', fontSize: 13, fontWeight: '700' },
  audienceBtnTextActive: { color: '#fff' },
  groupChoiceRow: { gap: 8, paddingTop: 2, paddingBottom: 4 },
  groupChoiceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 220,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: '#101010',
    borderWidth: 1,
    borderColor: '#252525',
  },
  groupChoiceChipActive: { backgroundColor: '#2a170e', borderColor: '#834627' },
  groupChoiceChipText: { color: '#b7b7b7', fontSize: 12, fontWeight: '700' },
  groupChoiceChipTextActive: { color: '#fff' },
  groupAudienceMeta: { color: '#8a8a8a', fontSize: 12, lineHeight: 18 },

  // ── Feed mode tabs ────────────────────────────────────────────────────────

  feedHeaderWrap: {
    paddingTop: 10,
    paddingBottom: 2,
  },
  communitiesCard: {
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 12,
    borderRadius: 18,
    backgroundColor: '#101218',
    borderWidth: 1,
    borderColor: '#1f2630',
    gap: 10,
  },
  communitiesBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  communitiesBannerTextWrap: { flex: 1, minWidth: 0 },
  communitiesTitle: { color: '#fff', fontSize: 17, fontWeight: '800' },
  communitiesBannerMeta: { color: '#9da8ba', fontSize: 12, lineHeight: 17, marginTop: 3 },
  communitiesBannerAction: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#132033',
    borderWidth: 1,
    borderColor: '#29496b',
  },
  communitiesExpandedBody: { gap: 10 },
  communitiesSubtitle: { color: '#7d8696', fontSize: 12, lineHeight: 17 },
  communitiesSearchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#132033',
    borderWidth: 1,
    borderColor: '#29496b',
  },
  communitiesSearchBtnText: { color: '#9cc8ff', fontSize: 12, fontWeight: '700' },
  communitiesQuickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  communityQuickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#1b130f',
    borderWidth: 1,
    borderColor: '#3d2418',
  },
  communityQuickBtnText: { color: '#ffb088', fontSize: 12, fontWeight: '700' },
  communitySectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  communitySectionTitle: { color: '#fff', fontSize: 13, fontWeight: '700' },
  communitySectionMeta: { color: '#6f7b8b', fontSize: 12, fontWeight: '700' },
  groupRail: { gap: 8, paddingVertical: 2 },
  groupRailCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: '#151922',
    borderWidth: 1,
    borderColor: '#222a37',
  },
  groupRailAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2a170e',
    borderWidth: 1,
    borderColor: '#5b3c24',
  },
  groupRailInfo: { flex: 1, minWidth: 0 },
  groupRailName: { color: '#fff', fontSize: 13, fontWeight: '700' },
  groupRailMeta: { color: '#778090', fontSize: 11, lineHeight: 15, marginTop: 2 },
  communityList: { gap: 10 },
  communityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 2,
  },
  communityRowBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
  communityRowAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#132033',
    borderWidth: 1,
    borderColor: '#29496b',
  },
  communityRowInfo: { flex: 1, minWidth: 0 },
  communityRowName: { color: '#f6f7fb', fontSize: 14, fontWeight: '700' },
  communityRowMeta: { color: '#748093', fontSize: 12, lineHeight: 17, marginTop: 2 },
  communityActionBtn: {
    minWidth: 82,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#ff6a2f',
  },
  communityActionBtnJoined: { backgroundColor: '#152335', borderWidth: 1, borderColor: '#284669' },
  communityActionBtnSecondary: { backgroundColor: '#17171f', borderWidth: 1, borderColor: '#303047' },
  communityActionBtnPending: { backgroundColor: '#1e1e25', borderWidth: 1, borderColor: '#35353f' },
  communityActionBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  communityActionBtnTextMuted: { color: '#d8d8e5' },

  feedTabs: {
    flexDirection: 'row',
    backgroundColor: '#0a0a0a',
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
    paddingHorizontal: 4,
  },
  feedTab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    position: 'relative',
  },
  feedTabActive: {},
  feedTabText: {
    color: '#555',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  feedTabTextActive: {
    color: '#fff',
    fontWeight: '800',
  },
  feedTabUnderline: {
    position: 'absolute',
    bottom: 0,
    left: 12,
    right: 12,
    height: 2,
    borderRadius: 2,
    backgroundColor: '#ff4500',
  },

  // ── Following empty state ─────────────────────────────────────────────────
  followingEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: 10,
  },
  followingEmptyTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  followingEmptySubtitle: {
    color: '#555',
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 40,
  },

  // ── "Why this post?" chip ────────────────────────────────────────────────
  whyChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 2,
  },
  whyChipText: {
    color: '#555',
    fontSize: 10,
    fontWeight: '500',
  },
  whyChipTag: {
    color: '#ff4500',
    fontWeight: '700',
  },
  contextCommunityWrap: { paddingHorizontal: 12, paddingTop: 6, paddingBottom: 4 },
  contextCommunityCard: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: '#101218',
    borderWidth: 1,
    borderColor: '#1f2630',
    gap: 10,
  },
  contextCommunityEyebrow: { color: '#9cc8ff', fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 2 },
  contextCommunityExpandedBody: { gap: 10 },
  contextCommunityHint: { color: '#7d8696', fontSize: 12, lineHeight: 17 },
});
