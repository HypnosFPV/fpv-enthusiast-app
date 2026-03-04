// src/components/YouTubeContentBrowser.tsx

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  Image,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Modal,
  StyleSheet,
  Dimensions,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  YTVideo,
  YTChannel,
  resolveChannel,
  fetchChannelVideos,
  formatDuration,
  formatCount,
} from '../services/youtubeApi';

const { width: SCREEN_W } = Dimensions.get('window');
const THUMB_W = (SCREEN_W - 48) / 2;

interface Props {
  onPost: (videos: YTVideo[], caption: string) => Promise<void>;
  onChannelLinked?: (channel: YTChannel) => void;
  initialChannel?: YTChannel | null;
}

export default function YouTubeContentBrowser({ onPost, onChannelLinked, initialChannel }: Props) {
  const [channelInput, setChannelInput] = useState('');
  const [channel,      setChannel]      = useState<YTChannel | null>(initialChannel ?? null);
  const [linkLoading,  setLinkLoading]  = useState(false);
  const [linkError,    setLinkError]    = useState('');
  const [videos,       setVideos]       = useState<YTVideo[]>([]);
  const [nextPage,     setNextPage]     = useState<string | undefined>();
  const [listLoading,  setListLoading]  = useState(false);
  const [listError,    setListError]    = useState('');
  const [selected,     setSelected]     = useState<Set<string>>(new Set());
  const [postModal,    setPostModal]    = useState(false);
  const [caption,      setCaption]      = useState('');
  const [posting,      setPosting]      = useState(false);
  const [postError,    setPostError]    = useState('');

  useEffect(() => {
    if (channel?.uploadsPlaylistId) {
      loadVideos(channel.uploadsPlaylistId);
    }
  }, [channel?.uploadsPlaylistId]);

  const loadVideos = useCallback(async (playlistId: string, page?: string) => {
    setListLoading(true);
    setListError('');
    try {
      const { videos: newVids, nextPageToken } = await fetchChannelVideos(playlistId, 20, page);
      setVideos(prev => page ? [...prev, ...newVids] : newVids);
      setNextPage(nextPageToken);
    } catch (e: any) {
      setListError(e.message ?? 'Failed to load videos.');
    } finally {
      setListLoading(false);
    }
  }, []);

  const handleLinkChannel = async () => {
    const trimmed = channelInput.trim();
    if (!trimmed) { setLinkError('Please enter a YouTube channel URL or handle.'); return; }
    setLinkLoading(true);
    setLinkError('');
    try {
      const ch = await resolveChannel(trimmed);
      setChannel(ch);
      onChannelLinked?.(ch);
    } catch (e: any) {
      setLinkError(e.message ?? 'Failed to find channel.');
    } finally {
      setLinkLoading(false);
    }
  };

  const toggleSelect = (videoId: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(videoId) ? next.delete(videoId) : next.add(videoId);
      return next;
    });
  };

  const handlePost = async () => {
    const selectedVids = videos.filter(v => selected.has(v.videoId));
    if (!selectedVids.length) return;
    setPosting(true);
    setPostError('');
    try {
      await onPost(selectedVids, caption.trim());
      setSelected(new Set());
      setCaption('');
      setPostModal(false);
      Alert.alert('✅ Posted!', `${selectedVids.length} video${selectedVids.length > 1 ? 's' : ''} added to the feed.`);
    } catch (e: any) {
      setPostError(e.message ?? 'Failed to post. Try again.');
    } finally {
      setPosting(false);
    }
  };

  // ── If no channel linked yet, show the link input UI ──────────────────────
  if (!channel) {
    return (
      <View style={styles.linkCard}>
        <Ionicons name="logo-youtube" size={48} color="#FF0000" />
        <Text style={styles.linkTitle}>Link Your YouTube Channel</Text>
        <Text style={styles.linkSub}>
          Paste your channel URL, handle (@yourname), or channel ID below.
        </Text>
        <TextInput
          style={styles.linkInput}
          placeholder="e.g.  @FPVPilot  or  youtube.com/@FPVPilot"
          placeholderTextColor="#555"
          value={channelInput}
          onChangeText={text => { setChannelInput(text); setLinkError(''); }}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={handleLinkChannel}
        />
        {linkError ? <Text style={styles.errorText}>{linkError}</Text> : null}
        <TouchableOpacity
          style={[styles.linkBtn, linkLoading && { opacity: 0.6 }]}
          onPress={handleLinkChannel}
          disabled={linkLoading}
        >
          {linkLoading
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={styles.linkBtnText}>Connect Channel</Text>}
        </TouchableOpacity>
      </View>
    );
  }

  // ── Channel is linked — show video grid ──────────────────────────────────
  return (
    <View style={styles.container}>

      {/* Channel info bar */}
      <View style={styles.channelHeader}>
        {channel.thumbnail
          ? <Image source={{ uri: channel.thumbnail }} style={styles.channelAvatar} />
          : (
            <View style={[styles.channelAvatar, { backgroundColor: '#222', alignItems: 'center', justifyContent: 'center' }]}>
              <Ionicons name="logo-youtube" size={22} color="#FF0000" />
            </View>
          )}
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={styles.channelName} numberOfLines={1}>{channel.title}</Text>
          {channel.customUrl ? <Text style={styles.channelHandle}>{channel.customUrl}</Text> : null}
          <Text style={styles.channelStats}>
            {formatCount(channel.subscriberCount)} subs · {formatCount(channel.videoCount)} videos
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => { setChannel(null); setVideos([]); setSelected(new Set()); }}
          style={styles.unlinkBtn}
        >
          <Text style={styles.unlinkText}>Unlink</Text>
        </TouchableOpacity>
      </View>

      {/* Selection bar — only visible when videos are tapped/checked */}
      {selected.size > 0 && (
        <View style={styles.selectionBar}>
          <Text style={styles.selectionText}>{selected.size} selected</Text>
          <TouchableOpacity style={styles.postBarBtn} onPress={() => setPostModal(true)}>
            <Ionicons name="paper-plane-outline" size={14} color="#fff" />
            <Text style={styles.postBarBtnText}>Post to Feed</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setSelected(new Set())} style={{ marginLeft: 8 }}>
            <Ionicons name="close-circle" size={22} color="#777" />
          </TouchableOpacity>
        </View>
      )}

      <Text style={styles.hintText}>Tap a video to select it, then post to the feed.</Text>

      {/* Video grid */}
      {listLoading && videos.length === 0 ? (
        <ActivityIndicator color="#FF0000" size="large" style={{ marginTop: 60 }} />
      ) : listError ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{listError}</Text>
          <TouchableOpacity onPress={() => loadVideos(channel.uploadsPlaylistId)}>
            <Text style={{ color: '#FF0000', marginTop: 8 }}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={videos}
          keyExtractor={v => v.videoId}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={{ paddingBottom: 40, paddingTop: 8 }}
          onEndReached={() => { if (nextPage && !listLoading) loadVideos(channel.uploadsPlaylistId, nextPage); }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={listLoading ? <ActivityIndicator color="#FF0000" style={{ margin: 20 }} /> : null}
          ListEmptyComponent={
            <Text style={[styles.hintText, { textAlign: 'center', marginTop: 40 }]}>
              No videos found on this channel.
            </Text>
          }
          renderItem={({ item }) => {
            const isSelected = selected.has(item.videoId);
            return (
              <TouchableOpacity
                style={[styles.videoCard, isSelected && styles.videoCardSelected]}
                onPress={() => toggleSelect(item.videoId)}
                activeOpacity={0.75}
              >
                <View>
                  <Image source={{ uri: item.thumbnail }} style={styles.thumbnail} resizeMode="cover" />
                  {item.duration && (
                    <View style={styles.durationBadge}>
                      <Text style={styles.durationText}>{formatDuration(item.duration)}</Text>
                    </View>
                  )}
                  {isSelected && (
                    <View style={styles.checkOverlay}>
                      <Ionicons name="checkmark-circle" size={36} color="#4CAF50" />
                    </View>
                  )}
                </View>
                <View style={styles.videoInfo}>
                  <Text style={styles.videoTitle} numberOfLines={2}>{item.title}</Text>
                  <Text style={styles.videoMeta}>{formatCount(item.viewCount)} views</Text>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}

      {/* Post confirmation modal */}
      <Modal
        visible={postModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPostModal(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalWrap}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Post to Feed</Text>
            <TouchableOpacity onPress={() => setPostModal(false)}>
              <Ionicons name="close" size={24} color="#fff" />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
            <Text style={styles.fieldLabel}>Selected videos:</Text>
            {videos.filter(v => selected.has(v.videoId)).map(v => (
              <View key={v.videoId} style={styles.previewRow}>
                <Image source={{ uri: v.thumbnail }} style={styles.previewThumb} resizeMode="cover" />
                <Text style={styles.previewTitle} numberOfLines={2}>{v.title}</Text>
              </View>
            ))}
            <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Add a caption (optional):</Text>
            <TextInput
              style={styles.captionInput}
              placeholder="Write something about these videos..."
              placeholderTextColor="#555"
              value={caption}
              onChangeText={setCaption}
              multiline
              maxLength={500}
            />
            <Text style={styles.charCount}>{caption.length}/500</Text>
            {postError ? <Text style={styles.errorText}>{postError}</Text> : null}
          </ScrollView>

          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={[styles.postBtn, posting && { opacity: 0.6 }]}
              onPress={handlePost}
              disabled={posting}
            >
              {posting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Ionicons name="paper-plane" size={16} color="#fff" />
                  <Text style={styles.postBtnText}>
                    Post {selected.size} Video{selected.size > 1 ? 's' : ''} to Feed
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container:         { flex: 1, backgroundColor: '#0a0a0a' },
  linkCard:          { margin: 20, padding: 24, backgroundColor: '#141414', borderRadius: 16, alignItems: 'center', borderWidth: 1, borderColor: '#2a2a2a' },
  linkTitle:         { color: '#fff', fontSize: 18, fontWeight: '700', marginTop: 14, textAlign: 'center' },
  linkSub:           { color: '#888', fontSize: 13, textAlign: 'center', marginTop: 8, marginBottom: 18, lineHeight: 20 },
  linkInput:         { width: '100%', backgroundColor: '#1e1e1e', color: '#fff', padding: 13, borderRadius: 10, fontSize: 14, marginBottom: 10, borderWidth: 1, borderColor: '#333' },
  linkBtn:           { backgroundColor: '#FF0000', borderRadius: 10, paddingVertical: 13, paddingHorizontal: 32, marginTop: 4 },
  linkBtnText:       { color: '#fff', fontWeight: '700', fontSize: 15 },
  channelHeader:     { flexDirection: 'row', alignItems: 'center', padding: 14, backgroundColor: '#111', borderBottomWidth: 1, borderBottomColor: '#222' },
  channelAvatar:     { width: 50, height: 50, borderRadius: 25 },
  channelName:       { color: '#fff', fontWeight: '700', fontSize: 15 },
  channelHandle:     { color: '#aaa', fontSize: 12, marginTop: 1 },
  channelStats:      { color: '#666', fontSize: 11, marginTop: 2 },
  unlinkBtn:         { paddingHorizontal: 10, paddingVertical: 6 },
  unlinkText:        { color: '#FF4444', fontSize: 13, fontWeight: '600' },
  selectionBar:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 9, backgroundColor: '#1a1a1a', marginHorizontal: 12, marginTop: 8, borderRadius: 10, borderWidth: 1, borderColor: '#333' },
  selectionText:     { color: '#ddd', flex: 1, fontSize: 13 },
  postBarBtn:        { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FF0000', paddingVertical: 7, paddingHorizontal: 14, borderRadius: 8, gap: 6 },
  postBarBtnText:    { color: '#fff', fontWeight: '700', fontSize: 13 },
  hintText:          { color: '#555', fontSize: 12, paddingHorizontal: 14, paddingTop: 6 },
  row:               { justifyContent: 'space-between', paddingHorizontal: 12, marginBottom: 12 },
  videoCard:         { width: THUMB_W, backgroundColor: '#141414', borderRadius: 10, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent' },
  videoCardSelected: { borderColor: '#4CAF50' },
  thumbnail:         { width: THUMB_W, height: THUMB_W * 0.56 },
  durationBadge:     { position: 'absolute', bottom: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.82)', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  durationText:      { color: '#fff', fontSize: 11, fontWeight: '600' },
  checkOverlay:      { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.40)', alignItems: 'center', justifyContent: 'center' },
  videoInfo:         { padding: 8 },
  videoTitle:        { color: '#e0e0e0', fontSize: 12, fontWeight: '500', lineHeight: 16 },
  videoMeta:         { color: '#666', fontSize: 11, marginTop: 4 },
  errorContainer:    { alignItems: 'center', marginTop: 40 },
  errorText:         { color: '#FF6B6B', fontSize: 13, textAlign: 'center', marginVertical: 8 },
  modalWrap:         { flex: 1, backgroundColor: '#0a0a0a' },
  modalHeader:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#222' },
  modalTitle:        { color: '#fff', fontWeight: '700', fontSize: 17 },
  previewRow:        { flexDirection: 'row', gap: 12, marginBottom: 12, alignItems: 'center', backgroundColor: '#141414', padding: 8, borderRadius: 8 },
  previewThumb:      { width: 80, height: 50, borderRadius: 6 },
  previewTitle:      { flex: 1, color: '#ccc', fontSize: 13, lineHeight: 18 },
  fieldLabel:        { color: '#999', fontSize: 13, marginBottom: 8 },
  captionInput:      { backgroundColor: '#141414', color: '#fff', padding: 12, borderRadius: 10, fontSize: 14, minHeight: 90, textAlignVertical: 'top', borderWidth: 1, borderColor: '#2a2a2a' },
  charCount:         { color: '#555', fontSize: 11, textAlign: 'right', marginTop: 4 },
  modalFooter:       { padding: 16, borderTopWidth: 1, borderTopColor: '#1e1e1e' },
  postBtn:           { backgroundColor: '#FF0000', borderRadius: 12, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  postBtnText:       { color: '#fff', fontWeight: '700', fontSize: 16 },
});
