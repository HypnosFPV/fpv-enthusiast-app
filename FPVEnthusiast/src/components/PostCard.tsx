import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Linking,
  Modal,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Animated,
  Image,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../services/supabase';
import { useYouTubeAuth } from '../hooks/useYouTubeAuth';
import { likeYouTubeVideo, subscribeToChannel } from '../utils/youtubeApi';

// ─── Constants ────────────────────────────────────────────────────────────────
const YT_API_KEY = 'AIzaSyExample'; // ← replace with your real key
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface PostData {
  id: string;
  user_id: string;
  caption?: string | null;
  media_url?: string | null;
  media_type?: string | null;
  thumbnail_url?: string | null;
  source_url?: string | null;
  embed_url?: string | null;
  source_platform?: string | null;
  like_count?: number | null;
  comment_count?: number | null;
  created_at?: string;
  isLiked?: boolean;
  users?: {
    id?: string;
    username: string;
    avatar_url?: string | null;
  } | null;
}

interface Props {
  post: PostData;
  currentUserId?: string;
  onDelete?: (id: string) => void;
  onCaptionUpdate?: (id: string, caption: string) => void;
  visiblePostId?: string | null;
  autoplay?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getYoutubeVideoId(url?: string | null): string | null {
  if (!url) return null;
  const m = url.match(
    /(?:youtu\.be\/|(?:www\.)?youtube(?:-nocookie)?\.com\/(?:watch\?v=|embed\/|shorts\/|v\/))([A-Za-z0-9_-]{11})/
  );
  return m ? m[1] : null;
}

function getYoutubeThumbnail(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

function getInstagramShortcode(url?: string | null): string | null {
  if (!url) return null;
  const m = url.match(/instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

type SocialPlatform = 'youtube' | 'instagram' | 'tiktok' | 'twitter' | 'facebook' | 'other';

function detectPlatform(post: PostData): SocialPlatform {
  const p = (post.source_platform ?? '').toLowerCase();
  if (p === 'youtube') return 'youtube';
  if (p === 'instagram') return 'instagram';
  if (p === 'tiktok') return 'tiktok';
  if (p === 'twitter' || p === 'x') return 'twitter';
  if (p === 'facebook') return 'facebook';
  const url = post.source_url ?? post.embed_url ?? post.media_url ?? '';
  if (/youtube|youtu\.be|youtube-nocookie/.test(url)) return 'youtube';
  if (/instagram\.com/.test(url)) return 'instagram';
  if (/tiktok\.com/.test(url)) return 'tiktok';
  if (/twitter\.com|x\.com/.test(url)) return 'twitter';
  if (/facebook\.com/.test(url)) return 'facebook';
  return 'other';
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
}

function buildYouTubeHtml(videoId: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<style>
  * { margin:0; padding:0; box-sizing:border-box; background:#000; }
  html, body { width:100%; height:100%; overflow:hidden; }
  iframe { width:100%; height:100%; border:none; }
</style>
</head>
<body>
<iframe
  id="yt"
  src="https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&playsinline=1&rel=0&modestbranding=1&enablejsapi=1&origin=https://www.youtube-nocookie.com"
  allow="autoplay; fullscreen; encrypted-media"
  allowfullscreen
></iframe>
<script>
  // Force play on the video element once it exists
  function tryPlay() {
    var v = document.querySelector('video');
    if (v) {
      v.play().catch(function(){});
    } else {
      setTimeout(tryPlay, 500);
    }
  }
  setTimeout(tryPlay, 800);

  // Listen for YouTube iframe API errors
  window.addEventListener('message', function(e) {
    if (e.data && typeof e.data === 'string') {
      try {
        var d = JSON.parse(e.data);
        if (d.event === 'infoDelivery' && d.info && d.info.title) {
          var t = d.info.title;
          if (t.startsWith('YT_ERROR:')) {
            window.ReactNativeWebView.postMessage(t);
          }
        }
        if (d.event === 'onError') {
          window.ReactNativeWebView.postMessage('YT_ERROR:' + (d.info || 0));
        }
      } catch(ex) {}
    }
  });
<\/script>
</body>
</html>`;
}

async function getChannelIdForVideo(videoId: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${YT_API_KEY}`
    );
    const json = await res.json();
    return json?.items?.[0]?.snippet?.channelId ?? null;
  } catch {
    return null;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function PostCard({
  post,
  currentUserId,
  onDelete,
  onCaptionUpdate,
  visiblePostId,
  autoplay,
}: Props) {
  const { accessToken: ytToken } = useYouTubeAuth(currentUserId);

  // Like / comment state
  const [liked, setLiked] = useState(post.isLiked ?? false);
  const [likeCount, setLikeCount] = useState(post.like_count ?? 0);
  const [commentCount, setCommentCount] = useState(post.comment_count ?? 0);
  const heartAnim = useRef(new Animated.Value(0)).current;

  // YouTube state
  const [ytPlaying, setYtPlaying] = useState(false);
  const [isYtReady, setIsYtReady] = useState(false);
  const [ytError, setYtError] = useState(false);
  const [ytLiked, setYtLiked] = useState(false);
  const [ytSubscribed, setYtSubscribed] = useState(false);

  // Modals
  const [commentModalVisible, setCommentModalVisible] = useState(false);
  const [editCaptionVisible, setEditCaptionVisible] = useState(false);
  const [editCaptionText, setEditCaptionText] = useState(post.caption ?? '');
  const [comments, setComments] = useState<any[]>([]);
  const [newComment, setNewComment] = useState('');
  const [ownerMenuVisible, setOwnerMenuVisible] = useState(false);

  const isOwner = currentUserId === post.user_id;
  const platform = detectPlatform(post);

  // Reset when post changes
  useEffect(() => {
    setIsYtReady(false);
    setYtError(false);
    setYtPlaying(false);
    setLiked(post.isLiked ?? false);
    setLikeCount(post.like_count ?? 0);
    setCommentCount(post.comment_count ?? 0);
  }, [post.id]);

  // Pause YouTube when scrolled off screen
  useEffect(() => {
    if (visiblePostId !== post.id) {
      setYtPlaying(false);
    }
  }, [visiblePostId, post.id]);

  // ─── Like ──────────────────────────────────────────────────────────────────
  const handleLike = useCallback(async () => {
    const next = !liked;
    setLiked(next);
    setLikeCount((c) => c + (next ? 1 : -1));
    Animated.sequence([
      Animated.timing(heartAnim, { toValue: 1, duration: 150, useNativeDriver: true }),
      Animated.timing(heartAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
    ]).start();
    try {
      if (next) {
        await supabase.from('likes').insert({ post_id: post.id, user_id: currentUserId });
      } else {
        await supabase.from('likes').delete().match({ post_id: post.id, user_id: currentUserId });
      }
    } catch {
      setLiked(!next);
      setLikeCount((c) => c + (next ? -1 : 1));
    }
  }, [liked, post.id, currentUserId]);

  // ─── Comments ──────────────────────────────────────────────────────────────
  const loadComments = useCallback(async () => {
    const { data } = await supabase
      .from('comments')
      .select('*, users(username, avatar_url)')
      .eq('post_id', post.id)
      .order('created_at', { ascending: true });
    setComments(data ?? []);
  }, [post.id]);

  const handleAddComment = useCallback(async () => {
    if (!newComment.trim()) return;
    await supabase
      .from('comments')
      .insert({ post_id: post.id, user_id: currentUserId, content: newComment.trim() });
    setNewComment('');
    setCommentCount((c) => c + 1);
    loadComments();
  }, [newComment, post.id, currentUserId, loadComments]);

  // ─── YouTube API actions ───────────────────────────────────────────────────
  const handleYtLike = useCallback(async () => {
    const videoId = getYoutubeVideoId(post.source_url ?? post.embed_url);
    if (!videoId || !ytToken) return;
    try {
      await likeYouTubeVideo(videoId, ytToken);
      setYtLiked(true);
    } catch {
      Alert.alert('Error', 'Could not like video. Make sure you are signed in with YouTube.');
    }
  }, [post.source_url, post.embed_url, ytToken]);

  const handleYtSubscribe = useCallback(async () => {
    const videoId = getYoutubeVideoId(post.source_url ?? post.embed_url);
    if (!videoId || !ytToken) return;
    try {
      const channelId = await getChannelIdForVideo(videoId);
      if (!channelId) throw new Error('No channel');
      await subscribeToChannel(channelId, ytToken);
      setYtSubscribed(true);
    } catch {
      Alert.alert('Error', 'Could not subscribe. Make sure you are signed in with YouTube.');
    }
  }, [post.source_url, post.embed_url, ytToken]);

  // ─── Instagram tap ─────────────────────────────────────────────────────────
  const handleInstagramOpen = useCallback(async () => {
    const url = post.source_url ?? post.embed_url ?? post.media_url ?? '';
    const shortcode = getInstagramShortcode(url);
    const universalLink = shortcode
      ? `https://www.instagram.com/p/${shortcode}/`
      : url;

    Alert.alert(
      'Opening Instagram',
      'Embedded playback is not supported for Instagram. You will be redirected to the Instagram app or browser.',
      [
        {
          text: 'Open',
          onPress: async () => {
            const appLink = shortcode
              ? `instagram://media?id=${shortcode}`
              : 'instagram://';
            const canOpen = await Linking.canOpenURL(appLink).catch(() => false);
            if (canOpen) {
              await Linking.openURL(appLink);
            } else {
              await Linking.openURL(universalLink);
            }
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }, [post.source_url, post.embed_url, post.media_url]);

  // ─── Delete / edit ─────────────────────────────────────────────────────────
  const handleDelete = useCallback(async () => {
    Alert.alert('Delete Post', 'Are you sure?', [
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await supabase.from('posts').delete().eq('id', post.id);
          onDelete?.(post.id);
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [post.id, onDelete]);

  const handleSaveCaption = useCallback(async () => {
    await supabase
      .from('posts')
      .update({ caption: editCaptionText })
      .eq('id', post.id);
    onCaptionUpdate?.(post.id, editCaptionText);
    setEditCaptionVisible(false);
  }, [post.id, editCaptionText, onCaptionUpdate]);

  // ─── Media renderer ────────────────────────────────────────────────────────
  const renderMedia = () => {

    // ── YouTube ──────────────────────────────────────────────────────────────
    if (platform === 'youtube') {
      const videoId = getYoutubeVideoId(
        post.source_url ?? post.embed_url ?? post.media_url
      );

      if (!videoId) {
        return (
          <View style={styles.mediaWrap}>
            <View style={styles.ytFallback}>
              <Ionicons name="logo-youtube" size={40} color="#ff0000" />
              <Text style={styles.ytFallbackText}>YouTube video unavailable</Text>
            </View>
          </View>
        );
      }

      if (ytError) {
        return (
          <View style={styles.mediaWrap}>
            <View style={styles.ytFallback}>
              <Ionicons name="warning-outline" size={36} color="#ff6b6b" />
              <Text style={styles.ytFallbackText}>Video unavailable</Text>
              <TouchableOpacity
                style={styles.ytOpenBtn}
                onPress={() =>
                  Linking.openURL(`https://www.youtube.com/watch?v=${videoId}`)
                }
              >
                <Text style={styles.ytOpenBtnText}>Open in YouTube</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      }

      // Thumbnail / tap to play
      if (!ytPlaying) {
        const thumb = post.thumbnail_url ?? getYoutubeThumbnail(videoId);
        return (
          <TouchableOpacity
            style={styles.mediaWrap}
            activeOpacity={0.9}
            onPress={() => setYtPlaying(true)}
          >
            <Image
              source={{ uri: thumb }}
              style={styles.mediaCover}
              resizeMode="cover"
            />
            <View style={StyleSheet.absoluteFill}>
              <View style={styles.ytThumbOverlay}>
                <View style={styles.ytPlayBtnCircle}>
                  <Ionicons name="play" size={28} color="#fff" />
                </View>
              </View>
            </View>
            <View style={styles.platformBadge}>
              <Ionicons name="logo-youtube" size={14} color="#ff0000" />
            </View>
          </TouchableOpacity>
        );
      }

      // Playing: WebView
      return (
        <View style={styles.mediaWrap}>
          <WebView
            source={{
              html: buildYouTubeHtml(videoId),
              baseUrl: 'https://www.youtube-nocookie.com',
            }}
            style={styles.webview}
            userAgent={MOBILE_UA}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            allowsInlineMediaPlayback={true}
            mediaPlaybackRequiresUserAction={false}
            allowsFullscreenVideo={true}
            onLoadEnd={() => setIsYtReady(true)}
            onMessage={(e) => {
              const msg = e.nativeEvent.data ?? '';
              if (msg.startsWith('YT_ERROR:')) {
                const code = parseInt(msg.replace('YT_ERROR:', ''), 10);
                if ([2, 100, 101, 150, 152, 153].includes(code)) {
                  setYtError(true);
                }
              }
            }}
            onError={() => setYtError(true)}
          />
          {!isYtReady && (
            <View style={styles.ytLoader}>
              <ActivityIndicator color="#ff0000" size="large" />
            </View>
          )}
          <View style={styles.platformBadge}>
            <Ionicons name="logo-youtube" size={14} color="#ff0000" />
          </View>
        </View>
      );
    }

    // ── Instagram ────────────────────────────────────────────────────────────
    if (platform === 'instagram') {
      return (
        <TouchableOpacity
          style={styles.mediaWrap}
          activeOpacity={0.85}
          onPress={handleInstagramOpen}
        >
          {post.thumbnail_url ? (
            <>
              <Image
                source={{ uri: post.thumbnail_url }}
                style={styles.mediaCover}
                resizeMode="cover"
              />
              <View style={styles.igThumbOverlay}>
                <View style={styles.igOpenPill}>
                  <Ionicons name="logo-instagram" size={14} color="#fff" />
                  <Text style={styles.igOpenPillText}>Watch on Instagram</Text>
                </View>
              </View>
            </>
          ) : (
            <LinearGradient
              colors={['#833ab4', '#fd1d1d', '#fcb045']}
              style={styles.igCard}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <View style={styles.igCardInner}>
                <Ionicons name="logo-instagram" size={48} color="#fff" />
                <Text style={styles.igCardTitle}>Instagram Post</Text>
                <Text style={styles.igCardSub}>Tap to open</Text>
              </View>
            </LinearGradient>
          )}
          <View style={styles.platformBadge}>
            <Ionicons name="logo-instagram" size={14} color="#fff" />
          </View>
        </TouchableOpacity>
      );
    }

    // ── TikTok ────────────────────────────────────────────────────────────────
    if (platform === 'tiktok') {
      const url = post.source_url ?? post.embed_url ?? post.media_url ?? '';
      return (
        <TouchableOpacity
          style={styles.mediaWrap}
          activeOpacity={0.85}
          onPress={() => Linking.openURL(url)}
        >
          {post.thumbnail_url ? (
            <Image
              source={{ uri: post.thumbnail_url }}
              style={styles.mediaCover}
              resizeMode="cover"
            />
          ) : (
            <View style={[styles.igCard, { backgroundColor: '#010101' }]}>
              <View style={styles.igCardInner}>
                <Ionicons name="musical-notes" size={48} color="#fff" />
                <Text style={styles.igCardTitle}>TikTok Video</Text>
                <Text style={styles.igCardSub}>Tap to open</Text>
              </View>
            </View>
          )}
          <View style={styles.platformBadge}>
            <Ionicons name="musical-notes" size={14} color="#fff" />
          </View>
        </TouchableOpacity>
      );
    }

    // ── Twitter/X ─────────────────────────────────────────────────────────────
    if (platform === 'twitter') {
      const url = post.source_url ?? post.embed_url ?? post.media_url ?? '';
      return (
        <TouchableOpacity
          style={styles.mediaWrap}
          activeOpacity={0.85}
          onPress={() => Linking.openURL(url)}
        >
          <View style={[styles.igCard, { backgroundColor: '#000' }]}>
            <View style={styles.igCardInner}>
              <Ionicons name="logo-twitter" size={48} color="#1DA1F2" />
              <Text style={styles.igCardTitle}>Post on X</Text>
              <Text style={styles.igCardSub}>Tap to open</Text>
            </View>
          </View>
          <View style={styles.platformBadge}>
            <Ionicons name="logo-twitter" size={14} color="#1DA1F2" />
          </View>
        </TouchableOpacity>
      );
    }

    // ── Facebook ──────────────────────────────────────────────────────────────
    if (platform === 'facebook') {
      const url = post.source_url ?? post.embed_url ?? post.media_url ?? '';
      return (
        <TouchableOpacity
          style={styles.mediaWrap}
          activeOpacity={0.85}
          onPress={() => Linking.openURL(url)}
        >
          <View style={[styles.igCard, { backgroundColor: '#1877F2' }]}>
            <View style={styles.igCardInner}>
              <Ionicons name="logo-facebook" size={48} color="#fff" />
              <Text style={styles.igCardTitle}>Facebook Post</Text>
              <Text style={styles.igCardSub}>Tap to open</Text>
            </View>
          </View>
          <View style={styles.platformBadge}>
            <Ionicons name="logo-facebook" size={14} color="#fff" />
          </View>
        </TouchableOpacity>
      );
    }

    // ── Generic image ─────────────────────────────────────────────────────────
    if (post.media_url) {
      return (
        <View style={styles.mediaWrap}>
          <Image
            source={{ uri: post.media_url }}
            style={styles.mediaCover}
            resizeMode="cover"
          />
        </View>
      );
    }

    return null;
  };

  const heartScale = heartAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.4],
  });

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={styles.card}>

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.avatar}>
          {post.users?.avatar_url ? (
            <Image source={{ uri: post.users.avatar_url }} style={styles.avatarImg} />
          ) : (
            <Ionicons name="person-circle" size={36} color="#888" />
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.username}>{post.users?.username ?? 'Unknown'}</Text>
          {post.created_at ? (
            <Text style={styles.timestamp}>{timeAgo(post.created_at)}</Text>
          ) : null}
        </View>
        {isOwner && (
          <TouchableOpacity
            onPress={() => setOwnerMenuVisible(true)}
            style={styles.moreBtn}
          >
            <Ionicons name="ellipsis-horizontal" size={20} color="#aaa" />
          </TouchableOpacity>
        )}
      </View>

      {/* Media */}
      {renderMedia()}

      {/* YouTube controls while playing */}
      {platform === 'youtube' && ytPlaying && !ytError && (
        <View style={styles.ytControls}>
          <TouchableOpacity
            style={[styles.ytPill, ytLiked && styles.ytPillActive]}
            onPress={handleYtLike}
          >
            <Ionicons
              name={ytLiked ? 'thumbs-up' : 'thumbs-up-outline'}
              size={14}
              color={ytLiked ? '#fff' : '#aaa'}
            />
            <Text style={[styles.ytPillText, ytLiked && { color: '#fff' }]}>Like</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.ytPill, ytSubscribed && styles.ytPillActive]}
            onPress={handleYtSubscribe}
          >
            <Ionicons
              name="notifications-outline"
              size={14}
              color={ytSubscribed ? '#fff' : '#aaa'}
            />
            <Text style={[styles.ytPillText, ytSubscribed && { color: '#fff' }]}>
              Subscribe
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Caption */}
      {!!post.caption && (
        <View style={styles.captionRow}>
          <Text style={styles.usernameInline}>{post.users?.username ?? ''}</Text>
          <Text style={styles.captionText}> {post.caption}</Text>
        </View>
      )}

      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity onPress={handleLike} style={styles.actionBtn}>
          <Animated.View style={{ transform: [{ scale: heartScale }] }}>
            <Ionicons
              name={liked ? 'heart' : 'heart-outline'}
              size={24}
              color={liked ? '#e74c3c' : '#ccc'}
            />
          </Animated.View>
          <Text style={styles.actionCount}>{likeCount}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => { loadComments(); setCommentModalVisible(true); }}
          style={styles.actionBtn}
        >
          <Ionicons name="chatbubble-outline" size={22} color="#ccc" />
          <Text style={styles.actionCount}>{commentCount}</Text>
        </TouchableOpacity>
      </View>

      {/* ── Comment Modal ── */}
      <Modal visible={commentModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Comments</Text>
            <ScrollView style={{ flex: 1 }}>
              {comments.map((c) => (
                <View key={c.id} style={styles.commentRow}>
                  <Text style={styles.commentUser}>{c.users?.username ?? 'User'}</Text>
                  <Text style={styles.commentText}> {c.content}</Text>
                </View>
              ))}
            </ScrollView>
            <View style={styles.commentInputRow}>
              <TextInput
                style={styles.commentInput}
                placeholder="Add a comment…"
                placeholderTextColor="#666"
                value={newComment}
                onChangeText={setNewComment}
              />
              <TouchableOpacity onPress={handleAddComment}>
                <Ionicons name="send" size={22} color="#6c63ff" />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.modalClose}
              onPress={() => setCommentModalVisible(false)}
            >
              <Text style={styles.modalCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Owner Menu Modal ── */}
      <Modal visible={ownerMenuVisible} animationType="fade" transparent>
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setOwnerMenuVisible(false)}
        >
          <View style={styles.ownerMenu}>
            <TouchableOpacity
              style={styles.ownerMenuItem}
              onPress={() => { setOwnerMenuVisible(false); setEditCaptionVisible(true); }}
            >
              <Ionicons name="pencil-outline" size={18} color="#ccc" />
              <Text style={styles.ownerMenuText}>Edit Caption</Text>
            </TouchableOpacity>
            <View style={styles.ownerDivider} />
            <TouchableOpacity
              style={styles.ownerMenuItem}
              onPress={() => { setOwnerMenuVisible(false); handleDelete(); }}
            >
              <Ionicons name="trash-outline" size={18} color="#e74c3c" />
              <Text style={[styles.ownerMenuText, { color: '#e74c3c' }]}>Delete Post</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Edit Caption Modal ── */}
      <Modal visible={editCaptionVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Edit Caption</Text>
            <TextInput
              style={styles.editCaptionInput}
              value={editCaptionText}
              onChangeText={setEditCaptionText}
              multiline
              placeholderTextColor="#666"
              placeholder="Write a caption…"
            />
            <TouchableOpacity style={styles.saveBtn} onPress={handleSaveCaption}>
              <Text style={styles.saveBtnText}>Save</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.modalClose}
              onPress={() => setEditCaptionVisible(false)}
            >
              <Text style={styles.modalCloseText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  card: {
    backgroundColor: '#1a1a2e',
    marginBottom: 12,
    borderRadius: 12,
    overflow: 'hidden',
  },
  header: { flexDirection: 'row', alignItems: 'center', padding: 12 },
  avatar: { marginRight: 10 },
  avatarImg: { width: 36, height: 36, borderRadius: 18 },
  username: { color: '#fff', fontWeight: '700', fontSize: 14 },
  timestamp: { color: '#888', fontSize: 11 },
  moreBtn: { padding: 4 },

  mediaWrap: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: '#000',
    position: 'relative',
  },
  mediaCover: { width: '100%', height: '100%' },
  webview: { flex: 1, backgroundColor: '#000' },

  platformBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 10,
    padding: 4,
  },

  ytThumbOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  ytPlayBtnCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingLeft: 4,
  },
  ytLoader: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  ytFallback: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#111',
  },
  ytFallbackText: { color: '#888', fontSize: 13 },
  ytOpenBtn: {
    marginTop: 8,
    backgroundColor: '#ff0000',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  ytOpenBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  ytControls: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  ytPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: '#444',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  ytPillActive: { backgroundColor: '#6c63ff', borderColor: '#6c63ff' },
  ytPillText: { color: '#aaa', fontSize: 12, fontWeight: '600' },

  igCard: { width: '100%', height: '100%' },
  igCardInner: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
  },
  igCardTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  igCardSub: { color: 'rgba(255,255,255,0.8)', fontSize: 13 },
  igThumbOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.25)',
    justifyContent: 'flex-end',
    padding: 14,
  },
  igOpenPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(193,53,132,0.9)',
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  igOpenPillText: { color: '#fff', fontSize: 13, fontWeight: '600' },

  captionRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingTop: 6,
    flexWrap: 'wrap',
  },
  usernameInline: { color: '#fff', fontWeight: '700', fontSize: 13 },
  captionText: { color: '#ddd', fontSize: 13, flexShrink: 1 },

  actions: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 16,
  },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  actionCount: { color: '#aaa', fontSize: 13 },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#1e1e2e',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '75%',
  },
  modalTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  modalClose: { marginTop: 12, alignItems: 'center' },
  modalCloseText: { color: '#888', fontSize: 14 },

  commentRow: { flexDirection: 'row', paddingVertical: 6, flexWrap: 'wrap' },
  commentUser: { color: '#fff', fontWeight: '700', fontSize: 13 },
  commentText: { color: '#ddd', fontSize: 13 },
  commentInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderColor: '#333',
    paddingTop: 10,
    gap: 10,
  },
  commentInput: {
    flex: 1,
    color: '#fff',
    backgroundColor: '#2a2a3e',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 13,
  },

  editCaptionInput: {
    color: '#fff',
    backgroundColor: '#2a2a3e',
    borderRadius: 10,
    padding: 12,
    minHeight: 100,
    textAlignVertical: 'top',
    fontSize: 14,
    marginBottom: 12,
  },
  saveBtn: {
    backgroundColor: '#6c63ff',
    borderRadius: 20,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 8,
  },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  ownerMenu: {
    backgroundColor: '#1e1e2e',
    borderRadius: 14,
    marginHorizontal: 20,
    marginBottom: 40,
    overflow: 'hidden',
  },
  ownerMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
  },
  ownerMenuText: { color: '#ccc', fontSize: 15 },
  ownerDivider: { height: 1, backgroundColor: '#333' },
});
