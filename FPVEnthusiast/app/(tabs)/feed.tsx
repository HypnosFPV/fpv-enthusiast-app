// app/(tabs)/feed.tsx
import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  Modal, TextInput, Image, ActivityIndicator,
  KeyboardAvoidingView, Platform, Alert, RefreshControl,
} from 'react-native';
import { Ionicons }     from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useFeed }      from '../../src/hooks/useFeed';
import { useAuth }      from '../../src/context/AuthContext';
import { useProfile }   from '../../src/hooks/useProfile';
import PostCard         from '../../src/components/PostCard';
import { detectPlatform, PLATFORM_CONFIG } from '../../src/utils/socialMedia';
import { supabase }     from '../../src/services/supabase';

// ─── Post type ────────────────────────────────────────────────────────────────
interface Post {
  id: string;
  user_id: string;
  caption?: string | null;
  content?: string | null;
  media_url?: string | null;
  media_type?: string | null;
  source_url?: string | null;
  embed_url?: string | null;
  thumbnail_url?: string | null;
  source_platform?: string | null;
  like_count?: number;
  comment_count?: number;
  isLiked?: boolean;
  created_at?: string;
  users?: { username: string; avatar_url?: string | null } | null;
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function FeedScreen() {
  const { user }                    = useAuth();
  const { profile }                 = useProfile(user?.id);

  // autoplay_videos defaults to true if not set yet
  const autoplayEnabled = profile?.autoplay_videos !== false;

  const {
    posts: rawPosts,
    loading,
    refreshing,
    creating,
    onRefresh,
    createPost,
    createSocialPost,
    deletePost,
  } = useFeed();

  const posts = rawPosts as Post[];

  // ── Modal state ────────────────────────────────────────────────────────────
  const [modalVisible,     setModalVisible]     = useState(false);
  const [mode,             setMode]             = useState<'media' | 'social'>('media');
  const [caption,          setCaption]          = useState('');
  const [mediaUri,         setMediaUri]         = useState<string | null>(null);
  const [socialUrl,        setSocialUrl]        = useState('');
  const [detectedPlatform, setDetectedPlatform] = useState<string | null>(null);

  // ── Autoplay: track which post is most visible on screen ──────────────────
  const [visiblePostId, setVisiblePostId] = useState<string | null>(null);

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 60,
  }).current;

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems.length > 0) {
      setVisiblePostId(viewableItems[0].item.id);
    } else {
      setVisiblePostId(null);
    }
  }).current;

  // ── Handlers ───────────────────────────────────────────────────────────────
  const pickMedia = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo access to post media.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setMediaUri(result.assets[0].uri);
    }
  };

  const handleSocialUrl = (url: string) => {
    setSocialUrl(url);
    setDetectedPlatform(detectPlatform(url));
  };

  const handlePost = async () => {
    try {
      if (mode === 'social') {
        if (!socialUrl.trim()) { Alert.alert('Enter a URL'); return; }
        if (!detectedPlatform) {
          Alert.alert('Unsupported URL', 'Paste a YouTube, Instagram, TikTok, or Facebook link.');
          return;
        }
        await createSocialPost({ caption, sourceUrl: socialUrl });
      } else {
        if (!mediaUri && !caption.trim()) { Alert.alert('Add a photo or caption'); return; }
        await createPost({ caption, mediaUri: mediaUri ?? undefined, mediaType: 'image' });
      }
      closeModal();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  };

  const closeModal = () => {
    setModalVisible(false);
    setCaption('');
    setMediaUri(null);
    setSocialUrl('');
    setDetectedPlatform(null);
    setMode('media');
  };

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#ff4500" />
      </View>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>

      <View style={styles.topBar}>
        <Text style={styles.topBarTitle}>FPV Feed</Text>
      </View>

      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <PostCard
            post={item}
            currentUserId={user?.id}
            onDelete={deletePost}
            // autoplay only fires if the Settings toggle is ON
            autoplay={autoplayEnabled && visiblePostId === item.id}
          />
        )}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#ff4500"
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="videocam-outline" size={64} color="#444" />
            <Text style={styles.emptyTitle}>No posts yet</Text>
            <Text style={styles.emptySubtitle}>
              Be the first to share your FPV content!
            </Text>
          </View>
        }
        contentContainerStyle={
          posts.length === 0 ? styles.emptyContainer : styles.listContent
        }
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        showsVerticalScrollIndicator={false}
      />

      <TouchableOpacity
        style={styles.fab}
        onPress={() => setModalVisible(true)}
      >
        {creating
          ? <ActivityIndicator size="small" color="#fff" />
          : <Ionicons name="add" size={28} color="#fff" />
        }
      </TouchableOpacity>

      <Modal
        visible={modalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeModal}
      >
        <KeyboardAvoidingView
          style={styles.modal}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={closeModal}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>New Post</Text>
            <TouchableOpacity onPress={handlePost} disabled={creating}>
              {creating
                ? <ActivityIndicator size="small" color="#ff4500" />
                : <Text style={styles.modalPost}>Post</Text>
              }
            </TouchableOpacity>
          </View>

          <View style={styles.modeRow}>
            <TouchableOpacity
              style={[styles.modeBtn, mode === 'media' && styles.modeBtnActive]}
              onPress={() => setMode('media')}
            >
              <Ionicons name="image-outline" size={16} color={mode === 'media' ? '#fff' : '#888'} />
              <Text style={[styles.modeBtnText, mode === 'media' && styles.modeBtnTextActive]}>Media</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeBtn, mode === 'social' && styles.modeBtnActive]}
              onPress={() => setMode('social')}
            >
              <Ionicons name="share-social-outline" size={16} color={mode === 'social' ? '#fff' : '#888'} />
              <Text style={[styles.modeBtnText, mode === 'social' && styles.modeBtnTextActive]}>Social Link</Text>
            </TouchableOpacity>
          </View>

          {mode === 'media' && (
            <View style={styles.modalBody}>
              <TouchableOpacity style={styles.mediaPicker} onPress={pickMedia}>
                {mediaUri ? (
                  <Image source={{ uri: mediaUri }} style={styles.mediaPreview} resizeMode="cover" />
                ) : (
                  <View style={styles.mediaPlaceholder}>
                    <Ionicons name="image-outline" size={48} color="#555" />
                    <Text style={styles.mediaPlaceholderText}>Tap to choose photo</Text>
                  </View>
                )}
              </TouchableOpacity>
              <TextInput
                style={styles.captionInput}
                placeholder="Write a caption..."
                placeholderTextColor="#666"
                value={caption}
                onChangeText={setCaption}
                multiline
                maxLength={500}
              />
            </View>
          )}

          {mode === 'social' && (
            <View style={styles.modalBody}>
              <TextInput
                style={styles.urlInput}
                placeholder="Paste YouTube, Instagram, TikTok, or Facebook URL..."
                placeholderTextColor="#666"
                value={socialUrl}
                onChangeText={handleSocialUrl}
                autoCapitalize="none"
                keyboardType="url"
              />
              {detectedPlatform && PLATFORM_CONFIG[detectedPlatform] && (
                <View style={[styles.detectedBadge, { backgroundColor: PLATFORM_CONFIG[detectedPlatform].color }]}>
                  <Ionicons name={PLATFORM_CONFIG[detectedPlatform].icon as any} size={16} color="#fff" />
                  <Text style={styles.detectedText}>{PLATFORM_CONFIG[detectedPlatform].name} detected ✓</Text>
                </View>
              )}
              <TextInput
                style={styles.captionInput}
                placeholder="Add a caption (optional)..."
                placeholderTextColor="#666"
                value={caption}
                onChangeText={setCaption}
                multiline
                maxLength={500}
              />
            </View>
          )}

        </KeyboardAvoidingView>
      </Modal>

    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#0d0d0d' },
  center:      { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0d0d0d' },
  topBar:      { paddingTop: 56, paddingBottom: 12, paddingHorizontal: 16, backgroundColor: '#0d0d0d', borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  topBarTitle: { color: '#ff4500', fontSize: 22, fontWeight: '800' },
  listContent:    { paddingTop: 8, paddingBottom: 100 },
  emptyContainer: { flex: 1 },
  empty:          { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 120, gap: 12 },
  emptyTitle:     { color: '#fff', fontSize: 20, fontWeight: '700' },
  emptySubtitle:  { color: '#666', fontSize: 14, textAlign: 'center', paddingHorizontal: 40 },
  fab: {
    position: 'absolute', bottom: 90, right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#ff4500',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#ff4500', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 8, elevation: 8,
  },
  modal:       { flex: 1, backgroundColor: '#0d0d0d' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#222', paddingTop: 56 },
  modalCancel: { color: '#888', fontSize: 16 },
  modalTitle:  { color: '#fff', fontSize: 18, fontWeight: '700' },
  modalPost:   { color: '#ff4500', fontSize: 16, fontWeight: '700' },
  modeRow:           { flexDirection: 'row', margin: 16, gap: 10 },
  modeBtn:           { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#333' },
  modeBtnActive:     { backgroundColor: '#ff4500', borderColor: '#ff4500' },
  modeBtnText:       { color: '#888', fontWeight: '600' },
  modeBtnTextActive: { color: '#fff' },
  modalBody:            { flex: 1, padding: 16 },
  mediaPicker:          { borderRadius: 12, overflow: 'hidden', marginBottom: 16, backgroundColor: '#1a1a1a', height: 220 },
  mediaPreview:         { width: '100%', height: '100%' },
  mediaPlaceholder:     { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 },
  mediaPlaceholderText: { color: '#555', fontSize: 14 },
  captionInput:  { backgroundColor: '#1a1a1a', borderRadius: 10, padding: 12, color: '#fff', fontSize: 15, minHeight: 80, textAlignVertical: 'top', borderWidth: 1, borderColor: '#333' },
  urlInput:      { backgroundColor: '#1a1a1a', borderRadius: 10, padding: 12, color: '#fff', fontSize: 14, marginBottom: 12, borderWidth: 1, borderColor: '#333' },
  detectedBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, marginBottom: 12 },
  detectedText:  { color: '#fff', fontWeight: '600', fontSize: 14 },
});
