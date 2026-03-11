// app/(tabs)/feed.tsx
import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  Modal, TextInput, ActivityIndicator, Alert,
  RefreshControl, StatusBar, Image,
  Animated, Easing, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useFeed, FeedPost } from '../../src/hooks/useFeed';
import { useAuth } from '../../src/context/AuthContext';
import { useProfile } from '../../src/hooks/useProfile';
import { useNotificationsContext } from '../../src/context/NotificationsContext';
import { useMute } from '../../src/hooks/useMute';
import { detectPlatform } from '../../src/utils/socialMedia';
import { supabase } from '../../src/services/supabase';
import PostCard from '../../src/components/PostCard';
import MentionTextInputComponent from '../../src/components/MentionTextInput';
const MentionTextInput = MentionTextInputComponent as any;

const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 60 };


// ── FPV Tag Suggestions ───────────────────────────────────────────────────────
const MAX_TAGS = 10;
const TAG_SUGGESTIONS = [
  '#fpv', '#freestyle', '#race', '#bando', '#cinematic',
  '#quad', '#drone', '#whoop', '#longrange', '#gopro',
  '#miniquad', '#fpvlife', '#fpvpilot', '#ripping', '#proximity',
];
const TAG_COLORS = ['#ff4500','#00d4ff','#9c27b0','#ff9100','#00e676','#e91e63','#2979FF','#ffcc00'];
const tagColor = (tag: string) => TAG_COLORS[Math.abs(tag.split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % TAG_COLORS.length];
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
  const {
    posts, loading, refreshing,
    onRefresh, loadMore,
    toggleLike,
    createPost, createSocialPost, deletePost,
  } = useFeed(user?.id);
  const { unreadCount } = useNotificationsContext();
  const { mutedIds } = useMute(user?.id);

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

  useEffect(() => {
    if (user?.id) onRefresh();
  }, [user?.id]);

  // ── Autoplay tracking ────────────────────────────────────────────────────
  const [visiblePostId, setVisiblePostId] = useState<string | null>(null);
  const autoplayEnabled = profile?.autoplay_videos ?? true;
  const onViewableItemsChanged = useCallback(({ viewableItems }: any) => {
    setVisiblePostId(
      autoplayEnabled && viewableItems.length > 0
        ? viewableItems[0].item.id
        : null
    );
  }, [autoplayEnabled]);

  // ── Modal state ──────────────────────────────────────────────────────────
  const [modalVisible, setModalVisible] = useState(false);
  const [modalMode, setModalMode] = useState<'media' | 'social'>('media');
  const [caption, setCaption] = useState('');
  const [postTags,  setPostTags]  = useState<string[]>([]);
  const [tagInput,  setTagInput]  = useState('');
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);
  const [socialUrl, setSocialUrl] = useState('');
  const [mediaUri, setMediaUri] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<'image' | 'video'>('image');
  const [mediaBase64, setMediaBase64] = useState<string | null>(null);
  const [videoThumbFrames, setVideoThumbFrames] = useState<string[]>([]);
  const [selectedThumb, setSelectedThumb] = useState<string | null>(null);
  const [thumbsLoading, setThumbsLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  const detectedPlatform = detectPlatform(socialUrl);

  const resetModal = () => {
    setCaption('');
    setSocialUrl('');
    setMediaUri(null);
    setMediaBase64(null);
    setMediaType('image');
    setPostTags([]);
    setTagInput('');
    setShowTagSuggestions(false);
    setVideoThumbFrames([]);
    setSelectedThumb(null);
    setThumbsLoading(false);
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

      // ── Generate 12 thumbnail frames spread across the full clip ──────
      if (isVideo) {
        setVideoThumbFrames([]);
        setSelectedThumb(null);
        setThumbsLoading(true);
        try {
          const durationMs = (asset.duration ?? 5) * 1000;
          const COUNT = 12;
          const frames: string[] = [];
          for (let i = 0; i < COUNT; i++) {
            const pct  = 0.02 + (0.96 * i) / (COUNT - 1);
            const time = Math.max(0, Math.floor(durationMs * pct));
            try {
              const { uri } = await VideoThumbnails.getThumbnailAsync(asset.uri, { time });
              frames.push(uri);
            } catch {
              // skip failed frame, keep generating
            }
          }
          setVideoThumbFrames(frames);
          setSelectedThumb(frames[0] ?? null);
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
        newPost = await createSocialPost({
          socialUrl: trimmed,
          platform: detectedPlatform ?? 'unknown',
          caption,
          tags: postTags.length ? postTags : undefined,
        });
      } else {
        if (!mediaUri) { Alert.alert('Pick a media file first'); return; }
        newPost = await createPost({
          mediaUrl: mediaUri,
          mediaType,
          caption,
          tags: postTags.length ? postTags : undefined,
          mediaBase64,
          thumbnailUrl: mediaType === 'video' ? selectedThumb : null,
        });
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
  }, [toggleLike]);

  // ── FIXED: async, awaits deletePost, alerts on failure ───────────────────
  const handleDelete = useCallback(async (postId: string): Promise<boolean> => {
    const success = await deletePost(postId);
    if (!success) {
      Alert.alert('Error', 'Could not delete post. Please try again.');
    }
    return success;
  }, [deletePost]);

  const visiblePosts = mutedIds.length > 0
    ? posts.filter(p => !p.user_id || !mutedIds.includes(p.user_id))
    : posts;

  const renderPost = useCallback(({ item }: { item: FeedPost }) => (
    <PostCard
      post={item}
      isVisible={item.id === visiblePostId}
      shouldAutoplay={autoplayEnabled}
      currentUserId={user?.id ?? undefined}
      onLike={handleLike}
      onDelete={handleDelete}
    />
  ), [visiblePostId, autoplayEnabled, user?.id, handleLike, handleDelete]);

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

      {/* ── Feed List ── */}
      <FlatList
        data={visiblePosts}
        keyExtractor={item => item.id}
        renderItem={renderPost}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#ff4500" />
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={VIEWABILITY_CONFIG}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={visiblePosts.length === 0 ? styles.emptyContainer : undefined}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="videocam-outline" size={64} color="#333" />
            <Text style={styles.emptyTitle}>No posts yet</Text>
            <Text style={styles.emptySubtitle}>Be the first to post!</Text>
          </View>
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
        <View style={styles.modalOverlay}>
          <ScrollView
            style={styles.modalContainer}
            contentContainerStyle={styles.modalContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
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

            {modalMode === 'media' ? (
              <>
                <TouchableOpacity style={styles.mediaPicker} onPress={pickMedia}>
                  {mediaUri ? (
                    mediaType === 'video' ? (
                      selectedThumb ? (
                        <Image source={{ uri: selectedThumb }} style={styles.mediaPreview} />
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

                {mediaType === 'video' && (
                  <View style={styles.thumbPickerWrap}>
                    <Text style={styles.thumbPickerLabel}>Choose thumbnail frame:</Text>
                    {thumbsLoading ? (
                      <View style={styles.thumbLoadingRow}>
                        <ActivityIndicator color="#ff4500" size="small" />
                        <Text style={styles.thumbLoadingText}>Generating 12 frames…</Text>
                      </View>
                    ) : videoThumbFrames.length > 0 ? (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbPickerRow}>
                        {videoThumbFrames.map((uri, i) => (
                          <TouchableOpacity
                            key={i}
                            onPress={() => setSelectedThumb(uri)}
                            style={[styles.thumbFrame, selectedThumb === uri && styles.thumbFrameSelected]}
                          >
                            <Image source={{ uri }} style={styles.thumbFrameImg} />
                            {selectedThumb === uri && (
                              <View style={styles.thumbCheckOverlay}>
                                <Ionicons name="checkmark-circle" size={22} color="#ff4500" />
                              </View>
                            )}
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
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
                <Text style={styles.tagsCount}>{postTags.length}/{MAX_TAGS}</Text>
              </View>

              {/* Existing tag pills */}
              {postTags.length > 0 && (
                <View style={styles.tagPillsRow}>
                  {postTags.map(tag => (
                    <View key={tag} style={[styles.tagPill, { borderColor: tagColor(tag) + '88', backgroundColor: tagColor(tag) + '1a' }]}>
                      <Text style={[styles.tagPillText, { color: tagColor(tag) }]}>{tag}</Text>
                      <TouchableOpacity
                        onPress={() => setPostTags(prev => prev.filter(t => t !== tag))}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      >
                        <Ionicons name="close" size={12} color={tagColor(tag)} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}

              {/* Tag text input */}
              {postTags.length < MAX_TAGS && (
                <TextInput
                  style={styles.tagInput}
                  placeholder={postTags.length === 0 ? 'Add tags (e.g. freestyle, race)…' : 'Add another tag…'}
                  placeholderTextColor="#444"
                  value={tagInput}
                  onChangeText={text => {
                    // Comma or space triggers add
                    if (text.endsWith(',') || text.endsWith(' ')) {
                      const raw = text.slice(0, -1).trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
                      if (raw.length > 0 && postTags.length < MAX_TAGS) {
                        const tag = raw.startsWith('#') ? raw : '#' + raw;
                        if (!postTags.includes(tag)) setPostTags(prev => [...prev, tag]);
                      }
                      setTagInput('');
                    } else {
                      setTagInput(text.toLowerCase().replace(/[^a-z0-9#_]/g, ''));
                      setShowTagSuggestions(text.length > 0);
                    }
                  }}
                  onSubmitEditing={() => {
                    const raw = tagInput.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
                    if (raw.length > 0 && postTags.length < MAX_TAGS) {
                      const tag = raw.startsWith('#') ? raw : '#' + raw;
                      if (!postTags.includes(tag)) setPostTags(prev => [...prev, tag]);
                    }
                    setTagInput('');
                    setShowTagSuggestions(false);
                  }}
                  onKeyPress={({ nativeEvent }) => {
                    if (nativeEvent.key === 'Backspace' && tagInput === '' && postTags.length > 0) {
                      setPostTags(prev => prev.slice(0, -1));
                    }
                  }}
                  returnKeyType="done"
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={22}
                />
              )}

              {/* Suggestions row */}
              {!showTagSuggestions && postTags.length < MAX_TAGS && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.suggestionsScroll}>
                  <View style={styles.suggestionsRow}>
                    {TAG_SUGGESTIONS.filter(s => !postTags.includes(s)).slice(0, 8).map(s => (
                      <TouchableOpacity
                        key={s}
                        style={styles.suggestionChip}
                        onPress={() => {
                          if (postTags.length < MAX_TAGS && !postTags.includes(s))
                            setPostTags(prev => [...prev, s]);
                        }}
                      >
                        <Text style={styles.suggestionChipText}>{s}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              )}

              {/* Filtered suggestions while typing */}
              {showTagSuggestions && tagInput.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.suggestionsScroll}>
                  <View style={styles.suggestionsRow}>
                    {TAG_SUGGESTIONS
                      .filter(s => s.includes(tagInput.replace('#','')) && !postTags.includes(s))
                      .map(s => (
                        <TouchableOpacity
                          key={s}
                          style={[styles.suggestionChip, styles.suggestionChipActive]}
                          onPress={() => {
                            if (postTags.length < MAX_TAGS && !postTags.includes(s)) {
                              setPostTags(prev => [...prev, s]);
                              setTagInput('');
                              setShowTagSuggestions(false);
                            }
                          }}
                        >
                          <Text style={styles.suggestionChipText}>{s}</Text>
                        </TouchableOpacity>
                      ))
                    }
                  </View>
                </ScrollView>
              )}
            </View>

            <TouchableOpacity
              style={[styles.postBtn, creating && styles.postBtnDisabled]}
              onPressIn={handlePost}
              disabled={creating}
            >
              {creating
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={styles.postBtnText}>Post</Text>
              }
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
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
    backgroundColor: '#111827',
    borderRadius: 12,
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
  tagsCount: {
    color: '#444',
    fontSize: 11,
    fontWeight: '600',
  },
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
  tagPillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  tagInput: {
    color: '#fff',
    fontSize: 13,
    paddingVertical: 6,
    paddingHorizontal: 2,
    borderBottomWidth: 1,
    borderBottomColor: '#1e2a3a',
    marginBottom: 8,
  },
  suggestionsScroll: {
    marginTop: 4,
  },
  suggestionsRow: {
    flexDirection: 'row',
    gap: 6,
    paddingBottom: 2,
  },
  suggestionChip: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#2a2a4a',
  },
  suggestionChipActive: {
    borderColor: '#ff4500',
    backgroundColor: '#ff450015',
  },
  suggestionChipText: {
    color: '#888',
    fontSize: 11,
    fontWeight: '600',
  },
});