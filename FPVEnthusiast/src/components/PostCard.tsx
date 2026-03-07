// src/components/PostCard.tsx
import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  View, Text, Image, TouchableOpacity, StyleSheet,
  AppState, Modal, Alert, ActivityIndicator, TextInput,
  Dimensions, Linking, Platform, FlatList, KeyboardAvoidingView,
  Keyboard, PanResponder, ScrollView,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../services/supabase';
import MentionTextInputComponent from './MentionTextInput';
import MentionText from './MentionText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const MentionTextInput = MentionTextInputComponent as any;

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) ' +
  'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

const { width } = Dimensions.get('window');

function getYoutubeVideoId(url?: string | null): string | null {
  if (!url) return null;
  const m = url.match(
    /(?:youtube(?:-nocookie)?\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
  );
  return m ? m[1] : null;
}

function detectPlatform(url?: string | null): string {
  if (!url) return 'unknown';
  if (url.includes('youtube.com') || url.includes('youtu.be') || url.includes('youtube-nocookie.com')) return 'youtube';
  if (url.includes('instagram.com')) return 'instagram';
  if (url.includes('tiktok.com')) return 'tiktok';
  if (url.includes('facebook.com') || url.includes('fb.watch')) return 'facebook';
  if (url.includes('twitter.com') || url.includes('x.com')) return 'twitter';
  return 'unknown';
}

function timeAgo(dateStr?: string | null): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  if (days < 7) return days + 'd ago';
  if (days < 30) return Math.floor(days / 7) + 'w ago';
  if (days < 365) return Math.floor(days / 30) + 'mo ago';
  return Math.floor(days / 365) + 'y ago';
}

function openYouTubeApp(videoId: string): void {
  const appUrl = 'youtube://watch?v=' + videoId;
  const webUrl = 'https://www.youtube.com/watch?v=' + videoId;
  Linking.canOpenURL(appUrl)
    .then(function (s) { return Linking.openURL(s ? appUrl : webUrl); })
    .catch(function () { return Linking.openURL(webUrl); });
}

function buildYouTubeHtml(videoId: string, startSeconds?: number): string {
  const start = startSeconds || 0;
  const src =
    'https://www.youtube-nocookie.com/embed/' + videoId +
    '?autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1' +
    '&fs=0&iv_load_policy=3&controls=1&disablekb=0&enablejsapi=1' +
    '&start=' + start + '&origin=https://www.youtube-nocookie.com';
  return [
    '<!DOCTYPE html><html><head>',
    '<meta charset="utf-8"/>',
    '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"/>',
    '<meta name="referrer" content="strict-origin-when-cross-origin"/>',
    '<style>*{margin:0;padding:0;box-sizing:border-box;background:#000}html,body{width:100%;height:100%;overflow:hidden}iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:none}</style></head><body>',
    '<iframe id="yt" src="' + src + '" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture" allowfullscreen></iframe>',
    '<script>',
    'var ifr=document.getElementById("yt");',
    'function sendCmd(c){ifr.contentWindow.postMessage(JSON.stringify({event:"command",func:c,args:[]}),"*");}',
    'window.addEventListener("message",function(e){try{var d=typeof e.data==="string"?JSON.parse(e.data):e.data;if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify(d));}catch(x){}});',
    'document.addEventListener("message",function(e){try{var m=JSON.parse(e.data);if(m.command)sendCmd(m.command);}catch(x){}});',
    '</script></body></html>',
  ].join('');
}

function injectCmd(ref: React.RefObject<WebView | null>, cmd: string): void {
  ref.current && ref.current.injectJavaScript(
    '(function(){var f=document.getElementById("yt");if(f)f.contentWindow.postMessage(JSON.stringify({event:"command",func:"' + cmd + '",args:[]}),"*");})();true;'
  );
}

interface PostData {
  id: string;
  user_id?: string | null;
  media_url?: string | null;
  social_url?: string | null;
  embed_url?: string | null;
  media_type?: string | null;
  platform?: string | null;
  thumbnail_url?: string | null;
  caption?: string | null;
  created_at?: string | null;
  isLiked?: boolean;
  likeCount?: number;
  commentCount?: number;
  likes_count?: number;
  comments_count?: number;
  users?: { id?: string | null; username?: string | null; avatar_url?: string | null } | null;
}

interface Comment {
  id: string;
  user_id?: string | null;
  post_id?: string | null;
  content?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  likes_count?: number;
  users?: { id?: string | null; username?: string | null; avatar_url?: string | null } | null;
}

interface CommentLikeState { liked: boolean; count: number; }

interface Props {
  post: PostData;
  isVisible?: boolean;
  shouldAutoplay?: boolean;   // ← ADD THIS LINE
  currentUserId?: string | null;
  onLike?: (postId: string, currentlyLiked: boolean) => void;
  onDelete?: (postId: string) => void;
  onCaptionUpdate?: (postId: string, caption: string) => void;
  autoplay?: boolean;
}


export default function PostCard(props: Props) {
  const { post, currentUserId, onLike, onDelete, onCaptionUpdate } = props;

  const webViewRef = useRef<WebView | null>(null);
  const commentInputRef = useRef<TextInput | null>(null);
  const flatListRef = useRef<FlatList<Comment> | null>(null);

  const [isYtReady, setIsYtReady] = useState(false);
  const [ytError, setYtError] = useState(false);
  const [isMuted, setIsMuted] = useState(true);

  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);

  const [localCommentCount, setLocalCommentCount] = useState(
    post.comments_count ?? post.commentCount ?? 0
  );

  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState('');
  const [showOwnerMenu, setShowOwnerMenu] = useState(false);
  const [showEditCaption, setShowEditCaption] = useState(false);
  const [editCaptionText, setEditCaptionText] = useState(post.caption || '');
  const [commentLikes, setCommentLikes] = useState<Record<string, CommentLikeState>>({});

  const isOwner = !!currentUserId && currentUserId === post.user_id;
  const insets = useSafeAreaInsets();

  const commentsPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 5,
      onPanResponderRelease: (_, g) => {
        if (g.dy > 50) setShowComments(false);
      },
    })
  ).current;

  const resolvedPlatform: string = (function () {
    if (post.platform && post.platform !== 'unknown') return post.platform;
    const a = detectPlatform(post.media_url); if (a !== 'unknown') return a;
    const b = detectPlatform(post.social_url); if (b !== 'unknown') return b;
    if (post.media_type === 'social_embed') { const c = detectPlatform(post.embed_url); if (c !== 'unknown') return c; }
    return 'unknown';
  })();

  const videoId: string | null = resolvedPlatform !== 'youtube' ? null :
    (getYoutubeVideoId(post.media_url) || getYoutubeVideoId(post.social_url) || getYoutubeVideoId(post.embed_url) || null);

  const thumbnail = post.thumbnail_url || (videoId ? 'https://img.youtube.com/vi/' + videoId + '/hqdefault.jpg' : null);

  const inject = useCallback(function (cmd: string) { injectCmd(webViewRef, cmd); }, []);

  useFocusEffect(useCallback(function () {
  const canPlay = props.shouldAutoplay ?? props.autoplay ?? true;
  if (resolvedPlatform === 'youtube' && isYtReady && !ytError && canPlay) {
    inject('playVideo');
  }
  return function () {
    if (resolvedPlatform === 'youtube') inject('pauseVideo');
  };
}, [resolvedPlatform, isYtReady, ytError, inject, props.shouldAutoplay, props.autoplay]));


  const shouldAutoplayRef = useRef(props.shouldAutoplay ?? props.autoplay ?? true);
useEffect(function () {
  shouldAutoplayRef.current = props.shouldAutoplay ?? props.autoplay ?? true;
}, [props.shouldAutoplay, props.autoplay]);

useEffect(function () {
  if (resolvedPlatform !== 'youtube') return;
  const sub = AppState.addEventListener('change', function (s) {
    if (s === 'active' && isYtReady && !ytError && shouldAutoplayRef.current) inject('playVideo');
    if (s === 'background') inject('pauseVideo');
  });
  return function () { sub.remove(); };
}, [resolvedPlatform, isYtReady, ytError, inject]);

  useEffect(function () {
  if (resolvedPlatform !== 'youtube' || !isYtReady || ytError) return;
  const canPlay = props.isVisible && (props.shouldAutoplay ?? props.autoplay ?? true);
  canPlay ? inject('playVideo') : inject('pauseVideo');
}, [props.isVisible, props.shouldAutoplay, props.autoplay, resolvedPlatform, isYtReady, ytError, inject]);

  const handleMessage = useCallback(function (e: { nativeEvent: { data: string } }) {
    try {
      const d = JSON.parse(e.nativeEvent.data);
      if (d.event === 'onReady') setIsYtReady(true);
      if (d.event === 'onError' && [2, 100, 101, 150, 152, 153].includes(d.info)) setYtError(true);
    } catch (_) { }
  }, []);

  const handleInstagramOpen = useCallback(function () {
    Alert.alert('Opening Instagram',
      'Embedded playback is not supported. You\'ll be redirected to Instagram.\n\nCome back after viewing — this app is your one-stop FPV hub! 🚁',
      [{ text: 'Cancel', style: 'cancel' },
      { text: 'Open', onPress: function () { const u = post.social_url || post.media_url; if (u) Linking.openURL(u); } }]
    );
  }, [post.social_url, post.media_url]);

  const fetchCommentLikes = useCallback(async function (loaded: Comment[]) {
    const map: Record<string, CommentLikeState> = {};
    loaded.forEach(function (c) { map[c.id] = { liked: false, count: c.likes_count ?? 0 }; });
    if (!currentUserId || !loaded.length) { setCommentLikes(map); return; }
    try {
      const { data } = await supabase.from('comment_likes').select('comment_id')
        .eq('user_id', currentUserId).in('comment_id', loaded.map(function (c) { return c.id; }));
      const liked = new Set((data ?? []).map(function (l: any) { return l.comment_id; }));
      loaded.forEach(function (c) { map[c.id] = { liked: liked.has(c.id), count: c.likes_count ?? 0 }; });
    } catch (_) { }
    setCommentLikes(map);
  }, [currentUserId]);

  const fetchComments = useCallback(async function () {
    setCommentsLoading(true);
    try {
      const r = await supabase.from('comments')
        .select('*, users:user_id(id,username,avatar_url)')
        .eq('post_id', post.id).order('created_at', { ascending: true });
      if (r.error) throw r.error;
      const data: Comment[] = r.data || [];
      setComments(data);
      await fetchCommentLikes(data);
      setTimeout(function () { flatListRef.current?.scrollToEnd({ animated: false }); }, 150);
    } catch (err: any) { console.error('[PostCard] fetchComments:', err.message); }
    finally { setCommentsLoading(false); }
  }, [post.id, fetchCommentLikes]);

  const handleOpenComments = useCallback(function () {
    setShowComments(true);
    fetchComments();
  }, [fetchComments]);

  const handleSubmitComment = useCallback(async function () {
    const text = newComment.trim();
    if (!text || !currentUserId || submittingComment) return;
    commentInputRef.current?.blur();
    setSubmittingComment(true);
    setLocalCommentCount(function (n) { return n + 1; });
    try {
      const r = await supabase.from('comments')
        .insert({ post_id: post.id, user_id: currentUserId, content: text });
      if (r.error) throw r.error;
      if (post.user_id && post.user_id !== currentUserId) {
        void supabase.from('notifications').insert({
          user_id: post.user_id, actor_id: currentUserId, type: 'comment', post_id: post.id,
        });
      }
      setNewComment('');
      await fetchComments();
    } catch (err: any) {
      setLocalCommentCount(function (n) { return Math.max(0, n - 1); });
      console.error('[PostCard] submitComment:', err.message);
    } finally { setSubmittingComment(false); }
  }, [newComment, currentUserId, submittingComment, post.id, post.user_id, fetchComments]);

  const handleEditComment = useCallback(async function (id: string, txt: string) {
    const text = txt.trim();
    if (!text || !currentUserId) return;
    try {
      const r = await supabase.from('comments')
        .update({ content: text, updated_at: new Date().toISOString() })
        .eq('id', id).eq('user_id', currentUserId);
      if (r.error) { Alert.alert('Error', 'Could not save edit.'); return; }
      setEditingCommentId(null); setEditingCommentText('');
      await fetchComments();
    } catch (err: any) { console.error('[PostCard] editComment:', err.message); }
  }, [currentUserId, fetchComments]);

  const handleDeleteComment = useCallback(async function (id: string) {
    if (!currentUserId) return;
    Alert.alert('Delete Comment', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async function () {
          const r = await supabase.from('comments').delete().eq('id', id).eq('user_id', currentUserId);
          if (!r.error) {
            setLocalCommentCount(function (n) { return Math.max(0, n - 1); });
            await fetchComments();
          }
        }
      },
    ]);
  }, [currentUserId, fetchComments]);

  const handleCommentLike = useCallback(async function (id: string) {
    if (!currentUserId) return;
    const cur = commentLikes[id] ?? { liked: false, count: 0 };
    const nl = !cur.liked;
    setCommentLikes(function (p) { return { ...p, [id]: { liked: nl, count: nl ? cur.count + 1 : Math.max(cur.count - 1, 0) } }; });
    try {
      nl
        ? await supabase.from('comment_likes').insert({ comment_id: id, user_id: currentUserId })
        : await supabase.from('comment_likes').delete().eq('comment_id', id).eq('user_id', currentUserId);
    } catch (_) { setCommentLikes(function (p) { return { ...p, [id]: cur }; }); }
  }, [currentUserId, commentLikes]);

  const handleDeletePost = useCallback(function () {
    Alert.alert('Delete Post', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: function () { setShowOwnerMenu(false); if (onDelete) onDelete(post.id); } },
    ]);
  }, [post.id, onDelete]);

  const handleSaveCaption = useCallback(async function () {
    const r = await supabase.from('posts').update({ caption: editCaptionText }).eq('id', post.id).eq('user_id', currentUserId);
    if (r.error) { Alert.alert('Error', 'Could not update caption.'); return; }
    setShowEditCaption(false);
    if (onCaptionUpdate) onCaptionUpdate(post.id, editCaptionText);
  }, [editCaptionText, post.id, currentUserId, onCaptionUpdate]);

  // ── Media renderer ────────────────────────────────────────────────────────
  function renderMedia() {
    if (resolvedPlatform === 'youtube' && videoId) {
      if (ytError) {
        return (
          <TouchableOpacity style={styles.thumbContainer} onPress={function () { openYouTubeApp(videoId); }} activeOpacity={0.9}>
            {thumbnail ? <Image source={{ uri: thumbnail }} style={styles.thumb} resizeMode="cover" /> : <View style={[styles.thumb, styles.thumbDark]} />}
            <View style={styles.ytErrorOverlay}><Ionicons name="logo-youtube" size={40} color="#FF0000" /><Text style={styles.ytOpenText}>Open in YouTube</Text></View>
          </TouchableOpacity>
        );
      }
      return (
        <View style={styles.videoContainer}>
          <WebView ref={webViewRef} source={{ html: buildYouTubeHtml(videoId), baseUrl: 'https://www.youtube-nocookie.com' }}
            style={styles.webView} onMessage={handleMessage} allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false}
            userAgent={MOBILE_UA} javaScriptEnabled domStorageEnabled allowsFullscreenVideo={false} scrollEnabled={false} />
          <TouchableOpacity style={styles.muteBtn} onPress={function () { inject(isMuted ? 'unMute' : 'mute'); setIsMuted(function (p) { return !p; }); }}>
            <Ionicons name={isMuted ? 'volume-mute' : 'volume-high'} size={18} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.openYtBtn} onPress={function () { openYouTubeApp(videoId); }}>
            <Ionicons name="logo-youtube" size={16} color="#FF0000" />
          </TouchableOpacity>
        </View>
      );
    }
    if (resolvedPlatform === 'youtube') {
      return (
        <TouchableOpacity style={styles.thumbContainer} onPress={function () { if (post.media_url) Linking.openURL(post.media_url); }} activeOpacity={0.9}>
          <View style={[styles.thumb, styles.thumbDark]}><Ionicons name="logo-youtube" size={48} color="#FF0000" /><Text style={styles.ytOpenText}>YouTube Video</Text></View>
        </TouchableOpacity>
      );
    }
    if (resolvedPlatform === 'instagram') {
      return (
        <TouchableOpacity style={styles.igContainer} onPress={handleInstagramOpen} activeOpacity={0.85}>
          <View style={styles.igInner}><Ionicons name="logo-instagram" size={48} color="#fff" /><Text style={styles.igLabel}>Instagram Post</Text><Text style={styles.igSub}>Tap to open</Text></View>
          <View style={styles.platformBadge}><Ionicons name="logo-instagram" size={16} color="#fff" /></View>
        </TouchableOpacity>
      );
    }
    if (['tiktok', 'facebook', 'twitter'].includes(resolvedPlatform)) {
      const icon: any = resolvedPlatform === 'tiktok' ? 'musical-notes' : resolvedPlatform === 'facebook' ? 'logo-facebook' : 'logo-twitter';
      const label = resolvedPlatform === 'tiktok' ? 'TikTok Video' : resolvedPlatform === 'facebook' ? 'Facebook Post' : 'Twitter/X Post';
      return (
        <TouchableOpacity style={styles.socialContainer} onPress={function () { const u = post.social_url || post.media_url; if (u) Linking.openURL(u); }} activeOpacity={0.85}>
          <Ionicons name={icon} size={40} color="#fff" /><Text style={styles.socialLabel}>{label}</Text><Text style={styles.socialSub}>Tap to open</Text>
        </TouchableOpacity>
      );
    }
    if (post.media_type === 'social_embed') {
      const u = post.media_url || post.embed_url;
      return (
        <TouchableOpacity style={styles.socialContainer} onPress={function () { if (u) Linking.openURL(u); }} activeOpacity={0.85}>
          <Ionicons name="link-outline" size={40} color="#fff" /><Text style={styles.socialLabel}>External Link</Text>
          {u ? <Text style={styles.socialSub} numberOfLines={1}>{u}</Text> : null}
        </TouchableOpacity>
      );
    }
    if (post.media_url) {
      if (post.media_type === 'video') {
        return (
          <TouchableOpacity style={styles.thumbContainer} onPress={function () { if (post.media_url) Linking.openURL(post.media_url); }} activeOpacity={0.9}>
            <View style={[styles.thumb, styles.thumbDark]}><Ionicons name="videocam" size={48} color="#fff" /><Text style={styles.ytOpenText}>Tap to play</Text></View>
          </TouchableOpacity>
        );
      }
      // ✅ FIX: aspectRatio applied directly to Image — reliable cross-platform sizing.
      // Old pattern (<View aspectRatio><Image height="100%">) can miscalculate on some RN
      // versions causing the image to render at wrong dimensions (appears stretched).
      return (
        <Image
          source={{ uri: post.media_url }}
          style={styles.postImage}
          resizeMode="cover"
        />
      );
    }
    return null;
  }

  // ── Comment row ───────────────────────────────────────────────────────────
  function renderComment(info: { item: Comment }) {
    const c = info.item;
    const isMine = !!currentUserId && currentUserId === c.user_id;
    const edited = c.updated_at && c.created_at && c.updated_at !== c.created_at;
    const lk = commentLikes[c.id] ?? { liked: false, count: 0 };

    if (editingCommentId === c.id) {
      return (
        <View style={styles.commentRow}>
          <TextInput style={styles.editCommentInput} value={editingCommentText} onChangeText={setEditingCommentText} multiline autoFocus />
          <View style={styles.editCommentActions}>
            <TouchableOpacity onPress={function () { handleEditComment(c.id, editingCommentText); }} style={styles.editCommentBtn}>
              <Text style={styles.editCommentBtnText}>Save</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={function () { setEditingCommentId(null); setEditingCommentText(''); }} style={[styles.editCommentBtn, styles.cancelEditBtn]}>
              <Text style={styles.editCommentBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    return (
      <View style={styles.commentRow}>
        <View style={styles.commentAvatarWrap}>
          {c.users?.avatar_url
            ? <Image source={{ uri: c.users.avatar_url }} style={styles.commentAvatarImg} />
            : <View style={styles.commentAvatarFallback}>
                <Text style={styles.commentAvatarInitial}>{(c.users?.username || '?')[0].toUpperCase()}</Text>
              </View>
          }
        </View>
        <View style={styles.commentBubble}>
          <View style={styles.commentBubbleHeader}>
            <Text style={styles.commentUsername} numberOfLines={1}>{c.users?.username || 'Unknown'}</Text>
            {isMine ? (
              <View style={styles.commentOwnerIcons}>
                <TouchableOpacity onPress={function () { setEditingCommentId(c.id); setEditingCommentText(c.content || ''); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 4 }}>
                  <Ionicons name="pencil-outline" size={13} color="#4fc3f7" />
                </TouchableOpacity>
                <TouchableOpacity onPress={function () { handleDeleteComment(c.id); }} hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}>
                  <Ionicons name="trash-outline" size={13} color="#e74c3c" />
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
          <MentionText text={c.content ?? ''} style={styles.commentText} />
          <View style={styles.commentMeta}>
            <Text style={styles.commentTime}>{timeAgo(c.created_at)}</Text>
            {edited ? <Text style={styles.commentEdited}>  edited</Text> : null}
            <TouchableOpacity style={styles.commentLikeBtn} onPress={function () { handleCommentLike(c.id); }}>
              <Ionicons name={lk.liked ? 'heart' : 'heart-outline'} size={12} color={lk.liked ? '#e74c3c' : '#666'} />
              {lk.count > 0 ? <Text style={styles.commentLikeCount}>{lk.count}</Text> : null}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  // ── Comment input ─────────────────────────────────────────────────────────
  function renderCommentInput() {
    if (!currentUserId) return null;
    const hasText = newComment.trim().length > 0;
    return (
      <View style={[styles.commentInputRow, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <View style={styles.commentInputInner}>
          <MentionTextInput
            containerStyle={styles.commentInputWrap}
            inputStyle={styles.commentInput}
            placeholder="Add a comment..."
            placeholderTextColor="#555"
            value={newComment}
            onChangeText={setNewComment}
            multiline={true}
            maxLength={500}
            currentUserId={currentUserId}
            suggestionsAbove={true}
          />
          <TouchableOpacity
            onPress={function () { if (!submittingComment && newComment.trim()) { handleSubmitComment(); } }}
            activeOpacity={0.7}
            style={[styles.commentSendBtn, hasText ? styles.commentSendBtnActive : styles.commentSendBtnInactive]}
          >
            {submittingComment
              ? <ActivityIndicator size="small" color="#fff" />
              : <Ionicons name="send" size={15} color={hasText ? '#fff' : '#3a3a5a'} />
            }
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.avatarWrap}>
          {post.users?.avatar_url
            ? <Image source={{ uri: post.users.avatar_url }} style={styles.avatar} />
            : <View style={styles.avatarFallback}>
                <Text style={styles.avatarInitial}>{(post.users?.username || '?')[0].toUpperCase()}</Text>
              </View>
          }
        </View>
        <View style={styles.headerInfo}>
          <Text style={styles.username}>{post.users?.username || 'Unknown'}</Text>
          <Text style={styles.timestamp}>{timeAgo(post.created_at)}</Text>
        </View>
        {isOwner ? (
          <TouchableOpacity onPress={function () { setShowOwnerMenu(true); }} style={styles.menuBtn}>
            <Ionicons name="ellipsis-horizontal" size={20} color="#666" />
          </TouchableOpacity>
        ) : null}
      </View>

      {renderMedia()}

      {post.caption
        ? <View style={styles.captionWrap}><MentionText text={post.caption ?? ''} style={styles.caption} /></View>
        : null}

      <View style={styles.actions}>
        <TouchableOpacity style={styles.actionBtn} onPress={function () { if (onLike) onLike(post.id, post.isLiked || false); }}>
          <Ionicons name={post.isLiked ? 'heart' : 'heart-outline'} size={22} color={post.isLiked ? '#e74c3c' : '#666'} />
          <Text style={styles.actionCount}>{post.likes_count ?? post.likeCount ?? 0}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={handleOpenComments}>
          <Ionicons name="chatbubble-outline" size={20} color="#666" />
          <Text style={styles.actionCount}>{localCommentCount}</Text>
        </TouchableOpacity>
      </View>

      {/* Comments Modal */}
      <Modal visible={showComments} animationType="slide" transparent onRequestClose={function () { setShowComments(false); }}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
          <View style={styles.commentsSheet}>
            <View style={styles.dragHandleContainer} {...commentsPanResponder.panHandlers}>
              <View style={styles.dragHandle} />
            </View>
            <View style={styles.commentsHeader}>
              <Text style={styles.commentsTitle}>Comments</Text>
              <TouchableOpacity onPress={function () { setShowComments(false); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close-circle" size={26} color="#444" />
              </TouchableOpacity>
            </View>
            <View style={{ flex: 1 }}>
              {commentsLoading ? (
                <View style={styles.loadingWrap}><ActivityIndicator color="#4fc3f7" size="large" /></View>
              ) : (
                <FlatList
                  ref={flatListRef}
                  data={comments}
                  keyExtractor={function (c) { return c.id; }}
                  keyboardShouldPersistTaps="always"
                  renderItem={renderComment}
                  style={styles.commentsList}
                  contentContainerStyle={styles.commentsListContent}
                  ListEmptyComponent={
                    <View style={styles.emptyWrap}>
                      <Ionicons name="chatbubbles-outline" size={40} color="#333" />
                      <Text style={styles.noComments}>No comments yet</Text>
                      <Text style={styles.noCommentsSub}>Be the first to comment!</Text>
                    </View>
                  }
                />
              )}
            </View>
            <View>{renderCommentInput()}</View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Owner Menu Modal */}
      <Modal visible={showOwnerMenu} transparent animationType="fade" onRequestClose={function () { setShowOwnerMenu(false); }}>
        <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={function () { setShowOwnerMenu(false); }}>
          <View style={styles.menuSheet}>
            <View style={styles.dragHandle} />
            <TouchableOpacity style={styles.menuItem} onPress={function () { setShowOwnerMenu(false); setEditCaptionText(post.caption || ''); setShowEditCaption(true); }}>
              <Ionicons name="create-outline" size={20} color="#ccc" />
              <Text style={styles.menuItemText}>Edit Caption</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.menuItem, { borderBottomWidth: 0 }]} onPress={handleDeletePost}>
              <Ionicons name="trash-outline" size={20} color="#e74c3c" />
              <Text style={[styles.menuItemText, { color: '#e74c3c' }]}>Delete Post</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuCancel} onPress={function () { setShowOwnerMenu(false); }}>
              <Text style={styles.menuCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Edit Caption Modal */}
      <Modal visible={showEditCaption} transparent animationType="slide" onRequestClose={function () { setShowEditCaption(false); }}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.editCaptionSheet}>
            <Text style={styles.editCaptionTitle}>Edit Caption</Text>
            <MentionTextInput
              value={editCaptionText}
              onChangeText={setEditCaptionText}
              inputStyle={styles.editCaptionInput}
              multiline
              placeholder="Write a caption"
              placeholderTextColor="#555"
              autoFocus
              currentUserId={currentUserId}
              suggestionsAbove={false}
            />
            <View style={styles.editCaptionActions}>
              <TouchableOpacity style={styles.editCaptionCancel} onPress={function () { setShowEditCaption(false); }}>
                <Text style={styles.editCaptionCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.editCaptionSave} onPress={handleSaveCaption}>
                <Text style={styles.editCaptionSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  card: { backgroundColor: '#13132a', marginBottom: 10, borderRadius: 14, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 6, elevation: 4 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12 },
  avatarWrap: { marginRight: 10 },
  avatar: { width: 38, height: 38, borderRadius: 19 },
  avatarFallback: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#2a2a4e', alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: '#4fc3f7', fontWeight: '700', fontSize: 16 },
  headerInfo: { flex: 1 },
  username: { color: '#f0f0f0', fontWeight: '700', fontSize: 14, letterSpacing: 0.2 },
  timestamp: { color: '#666', fontSize: 11, marginTop: 1 },
  menuBtn: { padding: 6 },
  videoContainer: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', position: 'relative' },
  webView: { flex: 1, backgroundColor: '#000' },
  muteBtn: { position: 'absolute', bottom: 10, right: 48, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 20, padding: 6 },
  openYtBtn: { position: 'absolute', bottom: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 20, padding: 6 },
  // Used for video/YouTube thumbnails (16:9 wrapper + fill child)
  thumbContainer: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' },
  thumb: { width: '100%', height: '100%' },
  thumbDark: { backgroundColor: '#0a0a1a', justifyContent: 'center', alignItems: 'center' },
  ytErrorOverlay: { position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' } as any,
  ytOpenText: { color: '#fff', marginTop: 8, fontSize: 13 },
  igContainer: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#833ab4', justifyContent: 'center', alignItems: 'center' },
  igInner: { alignItems: 'center' },
  igLabel: { color: '#fff', fontSize: 15, fontWeight: '600', marginTop: 8 },
  igSub: { color: 'rgba(255,255,255,0.65)', fontSize: 12, marginTop: 4 },
  platformBadge: { position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 12, padding: 5 },
  socialContainer: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#16213e', justifyContent: 'center', alignItems: 'center' },
  socialLabel: { color: '#fff', fontSize: 15, fontWeight: '600', marginTop: 8 },
  socialSub: { color: '#888', fontSize: 11, marginTop: 4, paddingHorizontal: 16, textAlign: 'center' },
  // ✅ FIX: aspectRatio on the Image itself — eliminates stretch caused by
  //         height:'100%' inside an aspectRatio container mismeasuring in RN.
  postImage: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' },
  captionWrap: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 6 },
  caption: { color: '#ddd', fontSize: 14, lineHeight: 21 },
  actions: { flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#252540' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', marginRight: 20 },
  actionCount: { color: '#888', fontSize: 13, marginLeft: 5, fontWeight: '500' },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  commentsSheet: { flex: 1, maxHeight: '85%', backgroundColor: '#0f0f23', borderTopLeftRadius: 22, borderTopRightRadius: 22 },
  dragHandleContainer: { width: '100%', alignItems: 'center', paddingVertical: 10 },
  dragHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#444', alignSelf: 'center' },
  commentsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#1e1e3a' },
  commentsTitle: { color: '#fff', fontWeight: '700', fontSize: 17 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 32 },
  commentsList: { flex: 1 },
  commentsListContent: { paddingTop: 4, paddingBottom: 4 },
  emptyWrap: { alignItems: 'center', paddingVertical: 40 },
  noComments: { color: '#555', fontSize: 15, fontWeight: '600', marginTop: 12 },
  noCommentsSub: { color: '#444', fontSize: 13, marginTop: 4 },
  commentRow: { flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 10, alignItems: 'flex-start' },
  commentAvatarWrap: { marginRight: 10, marginTop: 2 },
  commentAvatarImg: { width: 34, height: 34, borderRadius: 17 },
  commentAvatarFallback: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#1e1e3a', alignItems: 'center', justifyContent: 'center' },
  commentAvatarInitial: { color: '#4fc3f7', fontWeight: '700', fontSize: 14 },
  commentBubble: { flex: 1, backgroundColor: '#161630', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  commentBubbleHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 },
  commentUsername: { color: '#e0e0ff', fontWeight: '700', fontSize: 13, flex: 1 },
  commentOwnerIcons: { flexDirection: 'row', alignItems: 'center', gap: 10, marginLeft: 8 } as any,
  commentText: { color: '#c8c8e0', fontSize: 14, lineHeight: 20 },
  commentMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 6, flexWrap: 'wrap', gap: 6 } as any,
  commentTime: { color: '#555', fontSize: 11 },
  commentEdited: { color: '#444', fontSize: 11, fontStyle: 'italic' },
  commentLikeBtn: { flexDirection: 'row', alignItems: 'center', gap: 3 } as any,
  commentLikeCount: { color: '#666', fontSize: 11 },
  editCommentInput: { flex: 1, backgroundColor: '#1e1e3a', color: '#fff', borderRadius: 8, padding: 10, fontSize: 14 },
  editCommentActions: { flexDirection: 'row', marginTop: 8 },
  editCommentBtn: { backgroundColor: '#4fc3f7', borderRadius: 6, paddingHorizontal: 14, paddingVertical: 6, marginRight: 8 },
  cancelEditBtn: { backgroundColor: '#2a2a4e' },
  editCommentBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  commentInputRow: { paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#1e1e3a', backgroundColor: '#0f0f23' },
  commentInputInner: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  commentInputWrap: { flex: 1, minWidth: 0 },
  commentInput: { backgroundColor: '#1a1a35', color: '#ffffff', borderRadius: 18, paddingTop: 10, paddingBottom: 10, paddingLeft: 14, paddingRight: 14, fontSize: 15, lineHeight: 20, borderWidth: 1, borderColor: '#252545', minHeight: 42, maxHeight: 120 },
  commentSendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginBottom: 1 },
  commentSendBtnActive: { backgroundColor: '#4fc3f7' },
  commentSendBtnInactive: { backgroundColor: '#2a2a48' },
  menuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  menuSheet: { backgroundColor: '#0f0f23', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingBottom: 34 },
  menuItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#1e1e3a' },
  menuItemText: { color: '#e0e0e0', fontSize: 16, marginLeft: 14 },
  menuCancel: { paddingVertical: 16, alignItems: 'center' },
  menuCancelText: { color: '#666', fontSize: 16 },
  editCaptionSheet: { backgroundColor: '#0f0f23', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 34 },
  editCaptionTitle: { color: '#fff', fontWeight: '700', fontSize: 18, marginBottom: 16 },
  editCaptionInput: { backgroundColor: '#1a1a35', color: '#fff', borderRadius: 10, padding: 14, fontSize: 15, minHeight: 80, textAlignVertical: 'top', borderWidth: 1, borderColor: '#252545' },
  editCaptionActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 16 },
  editCaptionCancel: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, backgroundColor: '#1a1a35' },
  editCaptionCancelText: { color: '#888', fontSize: 15 },
  editCaptionSave: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, backgroundColor: '#4fc3f7', marginLeft: 12 },
  editCaptionSaveText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
