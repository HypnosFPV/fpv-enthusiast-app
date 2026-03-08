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
import { useNotifications } from '../../src/hooks/useNotifications';
import { useMute } from '../../src/hooks/useMute';
import { detectPlatform } from '../../src/utils/socialMedia';
import { supabase } from '../../src/services/supabase';
import PostCard from '../../src/components/PostCard';
import MentionTextInputComponent from '../../src/components/MentionTextInput';
const MentionTextInput = MentionTextInputComponent as any;

const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 60 };

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
  const { unreadCount } = useNotifications(user?.id);
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
        });
      } else {
        if (!mediaUri) { Alert.alert('Pick a media file first'); return; }
        newPost = await createPost({
          mediaUrl: mediaUri,
          mediaType,
          caption,
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
});