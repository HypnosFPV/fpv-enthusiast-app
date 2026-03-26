// src/components/PostCard.tsx
import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, Image, TouchableOpacity, StyleSheet,
  AppState, Modal, Alert, ActivityIndicator, TextInput,
  Dimensions, Linking, Platform, FlatList, KeyboardAvoidingView,
  Keyboard, PanResponder, ScrollView, Animated, Pressable, Easing,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useRouter } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../services/supabase';
import MentionTextInputComponent from './MentionTextInput';
import MentionText from './MentionText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ImageZoomModal from './ImageZoomModal';
import { useResolvedGroupTheme } from '../hooks/useGroupThemes';
import { GroupCardAnimationVariantId } from '../constants/groupThemes';
import GroupCardAnimationBorder from './GroupCardAnimationBorder';

const MentionTextInput = MentionTextInputComponent as any;

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) ' +
  'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

const { width } = Dimensions.get('window');

// ── double-tap threshold ──────────────────────────────────────────────────────
const DOUBLE_TAP_DELAY = 220; // ms — window to detect double-tap

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

const PC_TAG_COLORS = ['#ff4500','#00d4ff','#9c27b0','#ff9100','#00e676','#e91e63','#2979FF','#ffcc00'];
function AnimatedGroupBorder({
  width,
  height,
  accentColor,
  borderColor,
  active,
  variant,
}: {
  width: number;
  height: number;
  accentColor: string;
  borderColor: string;
  active: boolean;
  variant: GroupCardAnimationVariantId;
}) {
  return (
    <GroupCardAnimationBorder
      width={width}
      height={height}
      accentColor={accentColor}
      borderColor={borderColor}
      active={active}
      variant={variant}
      cornerRadius={14}
    />
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
  tags?: string[] | null;
  created_at?: string | null;
  isLiked?: boolean;
  like_count?: number;
  comment_count?: number;
  likeCount?: number;
  commentCount?: number;
  likes_count?: number;
  comments_count?: number;
  users?: { id?: string | null; username?: string | null; avatar_url?: string | null } | null;
  group?: { id?: string | null; name?: string | null } | null;
}

const COMMENTS_PAGE = 10; // how many top-level threads to show at once

interface Comment {
  id: string;
  user_id?: string | null;
  post_id?: string | null;
  parent_id?: string | null;   // null = top-level, set = reply
  content?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  likes_count?: number;
  users?: { id?: string | null; username?: string | null; avatar_url?: string | null } | null;
  group?: { id?: string | null; name?: string | null } | null;
}

interface CommentLikeState { liked: boolean; count: number; }

interface Props {
  post: PostData;
  isVisible?: boolean;
  shouldAutoplay?: boolean;
  currentUserId?: string | null;
  onLike?: (postId: string, currentlyLiked: boolean) => void;
  onDelete?: (postId: string) => void | Promise<boolean | void>;
  onCaptionUpdate?: (postId: string, caption: string) => void;
  canManagePost?: boolean;
  autoplay?: boolean;
}

// ── Inline video player (expo-video) ──────────────────────────────────────────
// onDoubleTap: called when user double-taps the video area (for like overlay)
function NativeVideoPlayer({
  uri,
  thumbnailUri,
  onDoubleTap,
}: {
  uri: string;
  thumbnailUri?: string | null;
  onDoubleTap?: () => void;
}) {
  const [playing, setPlaying]       = useState(false);
  const [muted, setMuted]           = useState(false);
  const [ready, setReady]           = useState(false);
  const [errored, setErrored]       = useState(false);
  const [showPoster, setShowPoster] = useState(true);

  // Double-tap detection inside the video player
  const lastTapNV = useRef<number>(0);
  const singleTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const player = useVideoPlayer({ uri }, p => {
    p.loop  = true;
    p.muted = false;
  });

  useEffect(() => {
    const sub = player.addListener('statusChange', ({ status }: { status: string }) => {
      if (status === 'readyToPlay') setReady(true);
      if (status === 'error')       { setErrored(true); setReady(true); }
    });
    return () => sub.remove();
  }, [player]);

  useEffect(() => {
    const sub = player.addListener('playingChange', ({ isPlaying }: { isPlaying: boolean }) => {
      setPlaying(isPlaying);
      if (isPlaying) setShowPoster(false);
    });
    return () => sub.remove();
  }, [player]);

  const togglePlay = useCallback(() => {
    if (playing) { player.pause(); }
    else         { player.play(); setShowPoster(false); }
  }, [playing, player]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    player.muted = next;
    setMuted(next);
  }, [muted, player]);

  // Timer-based tap: single tap → play/pause, double tap → like overlay
  const handleVideoTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTapNV.current < DOUBLE_TAP_DELAY) {
      // Double tap detected
      if (singleTapTimer.current) {
        clearTimeout(singleTapTimer.current);
        singleTapTimer.current = null;
      }
      onDoubleTap?.();
      lastTapNV.current = 0;
    } else {
      // First tap — wait to see if double tap follows
      lastTapNV.current = now;
      singleTapTimer.current = setTimeout(() => {
        togglePlay();
        singleTapTimer.current = null;
      }, DOUBLE_TAP_DELAY + 30);
    }
  }, [togglePlay, onDoubleTap]);

  if (errored) {
    return (
      <View style={nvStyles.wrap}>
        <Ionicons name="alert-circle-outline" size={36} color="#555" />
        <Text style={nvStyles.errorText}>Unable to play video</Text>
      </View>
    );
  }

  return (
    <View style={nvStyles.wrap}>
      <VideoView
        player={player}
        style={nvStyles.video}
        contentFit="contain"
        nativeControls={false}
      />
      {showPoster && !!thumbnailUri && (
        <Image source={{ uri: thumbnailUri }} style={nvStyles.poster} resizeMode="cover" />
      )}
      {!ready && (
        <View style={nvStyles.overlay}>
          <ActivityIndicator color="#ff4500" size="large" />
        </View>
      )}
      {ready && !errored && (
        <>
          {/* Full-area tap zone handles single (play/pause) and double (like) */}
          <TouchableOpacity style={nvStyles.playOverlay} onPress={handleVideoTap} activeOpacity={0.85}>
            {!playing && (
              <View style={nvStyles.playBtn}>
                <Ionicons name="play" size={38} color="#fff" />
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={nvStyles.muteBtn} onPress={toggleMute}>
            <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={18} color="#fff" />
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const nvStyles = StyleSheet.create({
  wrap: {
    width,
    height: width * 0.75,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  video:   { width: '100%', height: '100%' },
  poster:  { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  playOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center', alignItems: 'center',
  },
  playBtn: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center', alignItems: 'center',
  },
  muteBtn: {
    position: 'absolute', bottom: 10, right: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 14, padding: 5,
  },
  errorText: { color: '#666', fontSize: 13, marginTop: 8 },
});
// ─────────────────────────────────────────────────────────────────────────────

export default function PostCard(props: Props) {
  const { post, currentUserId, onLike, onDelete, onCaptionUpdate, canManagePost } = props;
  const router = useRouter();

  const webViewRef = useRef<WebView | null>(null);
  const commentInputRef = useRef<TextInput | null>(null);
  const flatListRef = useRef<FlatList<Comment> | null>(null);

  const [isYtReady, setIsYtReady] = useState(false);
  const [ytError, setYtError] = useState(false);
  const [isMuted, setIsMuted] = useState(true);

  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsPage, setCommentsPage]       = useState(1); // pages of COMMENTS_PAGE threads
  const [newComment, setNewComment] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);

  const [localCommentCount, setLocalCommentCount] = useState(
    post.comment_count ?? post.comments_count ?? post.commentCount ?? 0
  );

  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState('');
  const [showOwnerMenu, setShowOwnerMenu] = useState(false);
  const [showEditCaption, setShowEditCaption] = useState(false);
  const [editCaptionText, setEditCaptionText] = useState(post.caption || '');
  const [replyingTo, setReplyingTo]           = useState<Comment | null>(null);
  const [commentLikes, setCommentLikes] = useState<Record<string, CommentLikeState>>({});
  // emoji reactions: { [comment_id]: { [emoji]: count } }
  const [commentReactions, setCommentReactions] = useState<Record<string, Record<string, number>>>({});
  // which emojis the current user has already reacted with: { [comment_id]: Set<emoji> }
  const [myReactions, setMyReactions] = useState<Record<string, string[]>>({});
  // which comment bubble is showing the emoji picker popover
  const [reactionPickerForId, setReactionPickerForId] = useState<string | null>(null);
  const [zoomUri, setZoomUri] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [tagsExpanded, setTagsExpanded] = useState(false);

  // ── like animation state ─────────────────────────────────────────────────
  const [localLiked, setLocalLiked] = useState(post.isLiked ?? false);
  const [localLikeCount, setLocalLikeCount] = useState(
    post.like_count ?? post.likes_count ?? post.likeCount ?? 0
  );
  useEffect(() => { setLocalLiked(post.isLiked ?? false); }, [post.isLiked]);
  // Close reaction picker when comments modal closes
  useEffect(() => { if (!showComments) setReactionPickerForId(null); }, [showComments]);
  useEffect(() => {
    setLocalLikeCount(post.like_count ?? post.likes_count ?? post.likeCount ?? 0);
  }, [post.like_count, post.likes_count, post.likeCount]);

  // Animated values
  const likeScaleAnim  = useRef(new Animated.Value(1)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const overlayScale   = useRef(new Animated.Value(0.3)).current;

  // ── double-tap timing ────────────────────────────────────────────────────
  // lastTapRef: timestamp of last tap on media area
  // singleTapTimerRef: fires the "single tap" action if no second tap follows
  const lastTapRef        = useRef<number>(0);
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── heart bounce (button tap + double-tap) ───────────────────────────────
  const runHeartBounce = useCallback(() => {
    likeScaleAnim.setValue(0.7);
    Animated.spring(likeScaleAnim, {
      toValue: 1, friction: 3, tension: 200, useNativeDriver: true,
    }).start();
  }, [likeScaleAnim]);

  // ── big overlay heart (double-tap) ───────────────────────────────────────
  const runOverlayHeart = useCallback(() => {
    overlayOpacity.setValue(1);
    overlayScale.setValue(0.3);
    Animated.parallel([
      Animated.spring(overlayScale, {
        toValue: 1, friction: 4, tension: 180, useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.delay(600),
        Animated.timing(overlayOpacity, {
          toValue: 0, duration: 400, useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [overlayOpacity, overlayScale]);

  // ── core double-tap like action ──────────────────────────────────────────
  const fireLikeFromDoubleTap = useCallback(() => {
    if (!localLiked && onLike) {
      setLocalLiked(true);
      setLocalLikeCount(prev => prev + 1);
      onLike(post.id, false);
    }
    runOverlayHeart();
    runHeartBounce();
  }, [localLiked, onLike, post.id, runOverlayHeart, runHeartBounce]);

  // ── timer-based tap handler ─────────────────────────────────────────────
  // We MUST delay the single-tap action (zoom/link-open) until we know no
  // second tap is coming — otherwise the zoom modal opens immediately and
  // swallows the second tap, making double-tap undetectable.
  //
  // Delay = DOUBLE_TAP_DELAY + 30ms (250ms total — feels fast, not broken).
  // Double-tap window = 220ms — tight enough that intentional double-taps
  // are always caught before zoom opens.
  const handleMediaTap = useCallback((onSingleTap?: () => void) => {
    const now = Date.now();
    if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
      // ── Double tap ──
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      fireLikeFromDoubleTap();
      lastTapRef.current = 0; // reset so third tap doesn't re-trigger
    } else {
      // ── First tap — start short timer ──
      // 250ms total delay: fast enough to feel responsive, long enough to
      // detect a second tap before zoom opens and blocks touch events.
      lastTapRef.current = now;
      if (onSingleTap) {
        singleTapTimerRef.current = setTimeout(() => {
          singleTapTimerRef.current = null;
          onSingleTap();
        }, DOUBLE_TAP_DELAY + 30);
      }
    }
  }, [fireLikeFromDoubleTap]);

  // ── like button press ────────────────────────────────────────────────────
  const handleLikePress = useCallback(() => {
    if (!onLike) return;
    const nowLiked = !localLiked;
    setLocalLiked(nowLiked);
    setLocalLikeCount(prev => nowLiked ? prev + 1 : Math.max(0, prev - 1));
    runHeartBounce();
    onLike(post.id, localLiked);
  }, [onLike, localLiked, post.id, runHeartBounce]);

  const isOwner = !!currentUserId && currentUserId === post.user_id;
  const canOpenOwnerMenu = isOwner || !!canManagePost;
  const deleteActionLabel = isOwner ? 'Delete Post' : 'Remove Post';
  const insets = useSafeAreaInsets();
  const isGroupPost = !!post.group?.id;
  const { theme: resolvedGroupTheme } = useResolvedGroupTheme(currentUserId ?? undefined, post.group?.id ?? undefined);
  const activeGroupTheme = isGroupPost ? resolvedGroupTheme : null;
  const groupAnimationVariantId = activeGroupTheme?.animationVariantId ?? 'none';
  const isPremiumGroupCard = !!activeGroupTheme && groupAnimationVariantId === 'premium';
  const themedCardStyle = useMemo(() => activeGroupTheme ? ({
    backgroundColor: isPremiumGroupCard ? 'transparent' : activeGroupTheme.surfaceColor,
    borderColor: isPremiumGroupCard ? 'transparent' : activeGroupTheme.borderColor,
    borderWidth: isPremiumGroupCard ? 0 : 1,
  }) : null, [activeGroupTheme, isPremiumGroupCard]);
  const themedHeaderText = useMemo(() => activeGroupTheme ? ({ color: activeGroupTheme.textColor }) : null, [activeGroupTheme]);
  const themedMutedText = useMemo(() => activeGroupTheme ? ({ color: activeGroupTheme.mutedTextColor }) : null, [activeGroupTheme]);
  const themedGroupChipStyle = useMemo(() => activeGroupTheme ? ({
    backgroundColor: activeGroupTheme.chipBackgroundColor,
    borderColor: activeGroupTheme.borderColor,
  }) : null, [activeGroupTheme]);
  const themedGroupChipText = useMemo(() => activeGroupTheme ? ({ color: activeGroupTheme.chipTextColor }) : null, [activeGroupTheme]);
  const themedCaptionStyle = useMemo(() => activeGroupTheme ? ({ color: activeGroupTheme.textColor }) : null, [activeGroupTheme]);
  const themedActionsStyle = useMemo(() => activeGroupTheme ? ({ borderTopColor: activeGroupTheme.borderColor }) : null, [activeGroupTheme]);
  const shouldAnimateGroupCard = !!activeGroupTheme && groupAnimationVariantId !== 'none' && isGroupPost && !!props.isVisible;
  const [cardFrame, setCardFrame] = useState({ width: 0, height: 0 });

  const commentsPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 5,
      onPanResponderRelease: (_, g) => { if (g.dy > 50) setShowComments(false); },
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
    if (resolvedPlatform === 'youtube' && isYtReady && !ytError && canPlay) inject('playVideo');
    return function () { if (resolvedPlatform === 'youtube') inject('pauseVideo'); };
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
      'Embedded playback is not supported. You\'ll be redirected to Instagram.\n\nCome back after viewing  this app is your one-stop FPV hub! ',
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

  const REACTION_EMOJIS = ['👍','❤️','😂','😮','😢','🔥'];

  const fetchCommentReactions = useCallback(async function (commentIds: string[]) {
    if (!commentIds.length) return;
    try {
      const { data } = await supabase
        .from('comment_reactions')
        .select('comment_id, emoji, user_id')
        .in('comment_id', commentIds);
      if (!data) return;
      const counts: Record<string, Record<string, number>> = {};
      const mine: Record<string, string[]> = {};
      for (const row of data) {
        const cid = row.comment_id as string;
        const em  = row.emoji as string;
        counts[cid] = counts[cid] ?? {};
        counts[cid][em] = (counts[cid][em] ?? 0) + 1;
        if (currentUserId && row.user_id === currentUserId) {
          mine[cid] = mine[cid] ?? [];
          if (!mine[cid].includes(em)) mine[cid].push(em);
        }
      }
      setCommentReactions(counts);
      setMyReactions(mine);
    } catch (_) {}
  }, [currentUserId]);

  const handleCommentReact = useCallback(async function (commentId: string, emoji: string) {
    if (!currentUserId) return;
    setReactionPickerForId(null);
    const already = (myReactions[commentId] ?? []).includes(emoji);
    // optimistic update
    setCommentReactions(prev => {
      const c = { ...(prev[commentId] ?? {}) };
      c[emoji] = Math.max((c[emoji] ?? 0) + (already ? -1 : 1), 0);
      if (c[emoji] === 0) delete c[emoji];
      return { ...prev, [commentId]: c };
    });
    setMyReactions(prev => {
      const arr = [...(prev[commentId] ?? [])];
      if (already) return { ...prev, [commentId]: arr.filter(e => e !== emoji) };
      return { ...prev, [commentId]: [...arr, emoji] };
    });
    try {
      if (already) {
        await supabase.from('comment_reactions')
          .delete()
          .eq('comment_id', commentId)
          .eq('user_id', currentUserId)
          .eq('emoji', emoji);
      } else {
        await supabase.from('comment_reactions')
          .insert({ comment_id: commentId, user_id: currentUserId, emoji });
      }
    } catch (_) {
      await fetchCommentReactions([commentId]);
    }
  }, [currentUserId, myReactions, fetchCommentReactions]);

  const fetchComments = useCallback(async function () {
    setCommentsLoading(true);
    try {
      const r = await supabase.from('comments')
        .select('*, users:user_id(id,username,avatar_url)')
        .eq('post_id', post.id)
        .order('created_at', { ascending: true });
      if (r.error) throw r.error;
      const data: Comment[] = r.data || [];
      setComments(data);
      await fetchCommentLikes(data);
      await fetchCommentReactions(data.map(function (c: Comment) { return c.id; }));
      setTimeout(function () { flatListRef.current?.scrollToEnd({ animated: false }); }, 150);
    } catch (err: any) {
      console.error('[PostCard] fetchComments:', err.message);
    } finally { setCommentsLoading(false); }
  }, [post.id, fetchCommentLikes, fetchCommentReactions]);

  const handleOpenComments = useCallback(function () {
    setCommentsPage(1);   // always start at newest when reopening
    setShowComments(true);
    fetchComments();
  }, [fetchComments]);

  const handleSubmitComment = useCallback(async function () {
    const text = newComment.trim();
    if (!text || !currentUserId || submittingComment) return;

    // ── Clear input + dismiss keyboard IMMEDIATELY so button goes grey on first tap ──
    setNewComment('');
    Keyboard.dismiss();
    setSubmittingComment(true);
    setLocalCommentCount(function (n) { return n + 1; });
    const parentId = replyingTo?.id ?? null;
    const replyTarget = replyingTo;
    setReplyingTo(null);

    try {
      const r = await supabase.from('comments')
        .insert({ post_id: post.id, user_id: currentUserId, content: text,
                  parent_id: parentId ?? undefined });
      if (r.error) throw r.error;
      // Notify post owner (if not self and not a reply to someone else)
      if (!parentId && post.user_id && post.user_id !== currentUserId) {
        void supabase.from('notifications').insert({
          user_id: post.user_id, actor_id: currentUserId, type: 'comment', post_id: post.id,
        });
      }
      // Notify the comment author when replying to their comment
      if (parentId && replyTarget?.user_id && replyTarget.user_id !== currentUserId) {
        void supabase.from('notifications').insert({
          user_id: replyTarget.user_id, actor_id: currentUserId,
          type: 'comment_reply', post_id: post.id,
        });
      }
      await fetchComments();
    } catch (err: any) {
      // On failure put the text back so the user can retry
      setNewComment(text);
      setLocalCommentCount(function (n) { return Math.max(0, n - 1); });
      console.error('[PostCard] submitComment:', err.message);
    } finally { setSubmittingComment(false); }
  }, [newComment, currentUserId, submittingComment, replyingTo, post.id, post.user_id, fetchComments]);

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
      {
        text: 'Delete', style: 'destructive', onPress: async function () {
          setShowOwnerMenu(false);
          setDeleting(true);
          try {
            const result = onDelete ? await onDelete(post.id) : undefined;
            if (result === false) Alert.alert('Error', 'Could not delete post. Please try again.');
          } catch (e: any) {
            Alert.alert('Error', e?.message ?? 'Could not delete post.');
          } finally { setDeleting(false); }
        }
      },
    ]);
  }, [post.id, onDelete]);

  const handleSaveCaption = useCallback(async function () {
    const r = await supabase.from('posts').update({ caption: editCaptionText }).eq('id', post.id).eq('user_id', currentUserId);
    if (r.error) { Alert.alert('Error', 'Could not update caption.'); return; }
    setShowEditCaption(false);
    if (onCaptionUpdate) onCaptionUpdate(post.id, editCaptionText);
  }, [editCaptionText, post.id, currentUserId, onCaptionUpdate]);

  // ── Media renderer ────────────────────────────────────────────────────────
  //
  // KEY FIX: wrapWithDoubleTap now takes an optional onSingleTap callback.
  // There is NO inner TouchableOpacity competing for the touch — the outer
  // wrapper is the ONLY touch handler. Single-tap fires after DOUBLE_TAP_DELAY
  // if no second tap follows; double-tap fires the like overlay immediately.
  //
  function wrapWithDoubleTap(child: React.ReactNode, onSingleTap?: () => void) {
    return (
      <TouchableOpacity
        activeOpacity={1}
        onPress={function () { handleMediaTap(onSingleTap); }}
        style={styles.mediaTapWrapper}
      >
        {child}
        {/* Big overlay heart — absolutely positioned, pointerEvents none so it
            never interferes with taps */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.overlayHeartContainer,
            { opacity: overlayOpacity, transform: [{ scale: overlayScale }] },
          ]}
        >
          <Ionicons name="heart" size={100} color="rgba(255,255,255,0.9)" />
        </Animated.View>
      </TouchableOpacity>
    );
  }

  function renderMedia() {
    // ── YouTube embed (WebView) ──
    // WebView captures ALL native touches — we cannot intercept them from RN.
    // Double-tap is not supported on the live player; it IS supported on the
    // error-fallback thumbnail below.
    if (resolvedPlatform === 'youtube' && videoId) {
      if (ytError) {
        // Error thumbnail — full double-tap support, single tap opens YouTube
        return wrapWithDoubleTap(
          <View style={styles.thumbContainer}>
            {thumbnail
              ? <Image source={{ uri: thumbnail }} style={styles.thumb} resizeMode="cover" />
              : <View style={[styles.thumb, styles.thumbDark]} />}
            <View style={styles.ytErrorOverlay}>
              <Ionicons name="logo-youtube" size={40} color="#FF0000" />
              <Text style={styles.ytOpenText}>Open in YouTube</Text>
            </View>
          </View>,
          function () { openYouTubeApp(videoId); }
        );
      }
      // Live player — WebView eats touches; we just render it normally
      return (
        <View style={styles.videoContainer}>
          <WebView
            ref={webViewRef}
            source={{ html: buildYouTubeHtml(videoId), baseUrl: 'https://www.youtube-nocookie.com' }}
            style={styles.webView}
            onMessage={handleMessage}
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            userAgent={MOBILE_UA}
            javaScriptEnabled
            domStorageEnabled
            allowsFullscreenVideo={false}
            scrollEnabled={false}
          />
          <TouchableOpacity
            style={styles.muteBtn}
            onPress={function () { inject(isMuted ? 'unMute' : 'mute'); setIsMuted(function (p) { return !p; }); }}
          >
            <Ionicons name={isMuted ? 'volume-mute' : 'volume-high'} size={18} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.openYtBtn} onPress={function () { openYouTubeApp(videoId); }}>
            <Ionicons name="logo-youtube" size={16} color="#FF0000" />
          </TouchableOpacity>
        </View>
      );
    }

    // ── YouTube link only (no video ID) ──
    if (resolvedPlatform === 'youtube') {
      return wrapWithDoubleTap(
        <View style={[styles.thumbContainer, styles.thumbDark]}>
          <Ionicons name="logo-youtube" size={48} color="#FF0000" />
          <Text style={styles.ytOpenText}>YouTube Video</Text>
        </View>,
        function () { if (post.media_url) Linking.openURL(post.media_url); }
      );
    }

    // ── Instagram ──
    // Inner content is a plain View (no inner TouchableOpacity) so the
    // outer wrapWithDoubleTap is the sole touch handler.
    if (resolvedPlatform === 'instagram') {
      return wrapWithDoubleTap(
        <View style={styles.igContainer}>
          <View style={styles.igInner}>
            <Ionicons name="logo-instagram" size={48} color="#fff" />
            <Text style={styles.igLabel}>Instagram Post</Text>
            <Text style={styles.igSub}>Tap to open</Text>
          </View>
          <View style={styles.platformBadge}>
            <Ionicons name="logo-instagram" size={16} color="#fff" />
          </View>
        </View>,
        handleInstagramOpen
      );
    }

    // ── TikTok / Facebook / Twitter ──
    if (['tiktok', 'facebook', 'twitter'].includes(resolvedPlatform)) {
      const icon: any = resolvedPlatform === 'tiktok' ? 'musical-notes' : resolvedPlatform === 'facebook' ? 'logo-facebook' : 'logo-twitter';
      const label = resolvedPlatform === 'tiktok' ? 'TikTok Video' : resolvedPlatform === 'facebook' ? 'Facebook Post' : 'Twitter/X Post';
      return wrapWithDoubleTap(
        <View style={styles.socialContainer}>
          <Ionicons name={icon} size={40} color="#fff" />
          <Text style={styles.socialLabel}>{label}</Text>
          <Text style={styles.socialSub}>Tap to open</Text>
        </View>,
        function () { const u = post.social_url || post.media_url; if (u) Linking.openURL(u); }
      );
    }

    // ── Generic social embed ──
    if (post.media_type === 'social_embed') {
      const u = post.media_url || post.embed_url;
      return wrapWithDoubleTap(
        <View style={styles.socialContainer}>
          <Ionicons name="link-outline" size={40} color="#fff" />
          <Text style={styles.socialLabel}>External Link</Text>
          {u ? <Text style={styles.socialSub} numberOfLines={1}>{u}</Text> : null}
        </View>,
        function () { if (u) Linking.openURL(u); }
      );
    }

    // ── Uploaded media ──
    if (post.media_url) {
      if (post.media_type === 'video') {
        // NativeVideoPlayer handles double-tap internally and calls fireLikeFromDoubleTap
        return (
          <View style={{ position: 'relative' }}>
            <NativeVideoPlayer
              uri={post.media_url}
              thumbnailUri={post.thumbnail_url}
              onDoubleTap={fireLikeFromDoubleTap}
            />
            {/* Overlay heart is rendered here too so it shows over the video */}
            <Animated.View
              pointerEvents="none"
              style={[
                styles.overlayHeartContainer,
                { opacity: overlayOpacity, transform: [{ scale: overlayScale }] },
              ]}
            >
              <Ionicons name="heart" size={100} color="rgba(255,255,255,0.9)" />
            </Animated.View>
          </View>
        );
      }
      // Plain image — NO inner TouchableOpacity; single tap opens zoom after delay
      return wrapWithDoubleTap(
        <Image source={{ uri: post.media_url }} style={styles.postImage} resizeMode="cover" />,
        function () { setZoomUri(post.media_url!); }
      );
    }

    return null;
  }

  // ── Single comment bubble (shared by top-level and replies) ──────────────
  function renderCommentBubble(c: Comment, isReply: boolean) {
    const isMine = !!currentUserId && currentUserId === c.user_id;
    const edited = c.updated_at && c.created_at && c.updated_at !== c.created_at;
    const lk = commentLikes[c.id] ?? { liked: false, count: 0 };

    if (editingCommentId === c.id) {
      return (
        <View style={[styles.commentRow, isReply && styles.replyRow]}>
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

    const rxns = commentReactions[c.id] ?? {};
    const myRxns = myReactions[c.id] ?? [];
    const hasRxns = Object.keys(rxns).some(e => rxns[e] > 0);

    return (
      <View key={c.id} style={[styles.commentRow, isReply && styles.replyRow]}>
        {isReply && <View style={styles.replyThreadLine} />}
        <View style={styles.commentAvatarWrap}>
          {c.users?.avatar_url
            ? <Image source={{ uri: c.users.avatar_url }}
                     style={isReply ? styles.replyAvatarImg : styles.commentAvatarImg} />
            : <View style={[styles.commentAvatarFallback, isReply && styles.replyAvatarFallback]}>
                <Text style={styles.commentAvatarInitial}>{(c.users?.username || '?')[0].toUpperCase()}</Text>
              </View>
          }
        </View>
        <View style={{ flex: 1 }}>
        {/* Reaction picker popover */}
        {reactionPickerForId === c.id && (
          <View style={styles.reactionPickerWrap}>
            {REACTION_EMOJIS.map(em => (
              <TouchableOpacity
                key={em}
                style={[styles.reactionPickerBtn, myRxns.includes(em) && styles.reactionPickerBtnActive]}
                onPress={function () { handleCommentReact(c.id, em); }}
                activeOpacity={0.7}
              >
                <Text style={styles.reactionPickerEmoji}>{em}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={styles.reactionPickerClose}
              onPress={function () { setReactionPickerForId(null); }}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Ionicons name="close" size={13} color="#888" />
            </TouchableOpacity>
          </View>
        )}
        <Pressable
          onLongPress={function () { setReactionPickerForId(reactionPickerForId === c.id ? null : c.id); }}
          delayLongPress={350}
          style={styles.commentBubble}
        >
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
            <TouchableOpacity style={styles.commentLikeBtn} onPress={function () { handleCommentLike(c.id); }} hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}>
              <Ionicons name={lk.liked ? 'heart' : 'heart-outline'} size={12} color={lk.liked ? '#e74c3c' : '#666'} />
              {lk.count > 0 ? <Text style={styles.commentLikeCount}>{lk.count}</Text> : null}
            </TouchableOpacity>
            {/* Reply button — only on top-level comments */}
            {!isReply && (
              <TouchableOpacity
                style={styles.replyBtn}
                onPress={function () {
                  setReplyingTo(c);
                  setTimeout(function () { commentInputRef.current?.focus(); }, 80);
                }}
              >
                <Ionicons name="return-down-forward-outline" size={12} color="#4fc3f7" />
                <Text style={styles.replyBtnText}>Reply</Text>
              </TouchableOpacity>
            )}
            {/* React button — always visible, opens emoji picker */}
            {currentUserId && (
              <TouchableOpacity
                style={styles.reactBtn}
                onPress={function () { setReactionPickerForId(reactionPickerForId === c.id ? null : c.id); }}
                hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
              >
                <Text style={styles.reactBtnEmoji}>
                  {(myReactions[c.id] ?? []).length > 0
                    ? (myReactions[c.id])[0]
                    : '😊'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </Pressable>
        {/* Reaction pills */}
        {hasRxns && (
          <View style={styles.reactionPillsRow}>
            {REACTION_EMOJIS.filter(em => (rxns[em] ?? 0) > 0).map(em => (
              <TouchableOpacity
                key={em}
                style={[styles.reactionPill, myRxns.includes(em) && styles.reactionPillMine]}
                onPress={function () { handleCommentReact(c.id, em); }}
                activeOpacity={0.7}
              >
                <Text style={styles.reactionPillEmoji}>{em}</Text>
                <Text style={[styles.reactionPillCount, myRxns.includes(em) && styles.reactionPillCountMine]}>
                  {rxns[em]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        </View>
      </View>
    );
  }

  // ── Comment row — renders parent + any replies below it ───────────────────
  function renderComment(info: { item: Comment }) {
    const c = info.item;
    // Only render top-level comments here; replies are rendered inline below
    if (c.parent_id) return null;
    const replies = comments.filter(function (r) { return r.parent_id === c.id; });
    return (
      <View>
        {renderCommentBubble(c, false)}
        {replies.map(function (reply) { return renderCommentBubble(reply, true); })}
      </View>
    );
  }

  // ── Comment input ─────────────────────────────────────────────────────────
  function renderCommentInput() {
    if (!currentUserId) return null;
    const hasText = newComment.trim().length > 0;
    return (
      <View style={[styles.commentInputRow, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        {/* Replying-to banner */}
        {replyingTo && (
          <View style={styles.replyingToBanner}>
            <Ionicons name="return-down-forward-outline" size={12} color="#4fc3f7" style={{ marginRight: 4 }} />
            <Text style={styles.replyingToText} numberOfLines={1}>
              Replying to{' '}
              <Text style={styles.replyingToName}>@{replyingTo.users?.username || 'Unknown'}</Text>
            </Text>
            <TouchableOpacity
              onPress={function () { setReplyingTo(null); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{ marginLeft: 'auto' } as any}
            >
              <Ionicons name="close-circle" size={15} color="#555" />
            </TouchableOpacity>
          </View>
        )}
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
            onPress={function () { if (!submittingComment && newComment.trim()) handleSubmitComment(); }}
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
    <View style={styles.cardShell}>
      {activeGroupTheme && shouldAnimateGroupCard && cardFrame.width > 0 && cardFrame.height > 0 ? (
        <AnimatedGroupBorder
          width={cardFrame.width}
          height={cardFrame.height}
          accentColor={activeGroupTheme.accentColor}
          borderColor={activeGroupTheme.borderColor}
          active={shouldAnimateGroupCard}
          variant={groupAnimationVariantId}
        />
      ) : null}
      <View
        style={[styles.card, activeGroupTheme && !isPremiumGroupCard && styles.themedCard, themedCardStyle]}
        onLayout={(event) => {
          const nextWidth = Math.round(event.nativeEvent.layout.width);
          const nextHeight = Math.round(event.nativeEvent.layout.height);
          setCardFrame((prev) => (prev.width === nextWidth && prev.height === nextHeight ? prev : { width: nextWidth, height: nextHeight }));
        }}
      >
        {activeGroupTheme?.cardImageUrl && !isPremiumGroupCard ? (
          <>
            <Image source={{ uri: activeGroupTheme.cardImageUrl }} style={styles.themedCardImage} resizeMode="cover" />
            <View style={[styles.themedCardOverlay, { backgroundColor: `rgba(0,0,0,${Math.max(0.08, Math.min(0.32, (activeGroupTheme.overlayStrength ?? 72) / 180))})` }]} />
          </>
        ) : null}
        <View style={styles.header}>
        <View style={styles.avatarWrap}>
          {post.users?.avatar_url
            ? <Image source={{ uri: post.users.avatar_url }} style={styles.avatar} />
            : <View style={styles.avatarFallback}>
                <Text style={[styles.avatarInitial, themedGroupChipText]}>{(post.users?.username || '?')[0].toUpperCase()}</Text>
              </View>
          }
        </View>
        <View style={styles.headerInfo}>
          <Text style={[styles.username, themedHeaderText]}>{post.users?.username || 'Unknown'}</Text>
          <Text style={[styles.timestamp, themedMutedText]}>{timeAgo(post.created_at)}</Text>
          {post.group?.id && post.group?.name ? (
            <TouchableOpacity
              style={[styles.groupLinkChip, themedGroupChipStyle]}
              activeOpacity={0.8}
              onPress={() => router.push(`/group/${post.group?.id}` as any)}
            >
              <Ionicons name="people-outline" size={11} color={activeGroupTheme?.chipTextColor ?? '#9cc8ff'} />
              <Text style={[styles.groupLinkText, themedGroupChipText]} numberOfLines={1}>
                View group • {post.group.name}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
        {canOpenOwnerMenu ? (
          <TouchableOpacity onPress={function () { setShowOwnerMenu(true); }} style={styles.menuBtn}>
            <Ionicons name="ellipsis-horizontal" size={20} color={activeGroupTheme?.mutedTextColor ?? '#666'} />
          </TouchableOpacity>
        ) : null}
      </View>

      {renderMedia()}

      {post.caption
        ? <View style={styles.captionWrap}><MentionText text={post.caption ?? ''} style={[styles.caption, themedCaptionStyle]} /></View>
        : null}

      {/* ── Tags (collapsible) ──────────────────────────────────────────── */}
      {post.tags && post.tags.length > 0 && (
        <View style={styles.tagsSection}>
          {/* Collapsed bar: icon + first tag names inline + count + chevron */}
          <TouchableOpacity
            style={styles.tagsCollapseBar}
            onPress={function () { setTagsExpanded(function (v) { return !v; }); }}
            activeOpacity={0.75}
          >
            <Ionicons name="pricetag-outline" size={11} color="#555" />
            <View style={styles.tagsInlineList}>
              {post.tags.slice(0, tagsExpanded ? 0 : 3).map(function (tag) {
                const TC = PC_TAG_COLORS[Math.abs(tag.split('').reduce(function (a, c) { return a + c.charCodeAt(0); }, 0)) % PC_TAG_COLORS.length];
                return (
                  <Text key={tag} style={[styles.tagsInlineTag, { color: TC }]}>
                    #{tag}
                  </Text>
                );
              })}
              {!tagsExpanded && post.tags.length > 3 && (
                <Text style={styles.tagsInlineMore}>+{post.tags.length - 3}</Text>
              )}
              {tagsExpanded && (
                <Text style={styles.tagsExpandedLabel}>Tags</Text>
              )}
            </View>
            <Ionicons
              name={tagsExpanded ? 'chevron-up-outline' : 'chevron-down-outline'}
              size={12}
              color="#444"
            />
          </TouchableOpacity>

          {/* Expanded chips grid */}
          {tagsExpanded && (
            <View style={styles.postTagsRow}>
              {post.tags.map(function (tag) {
                const TC = PC_TAG_COLORS[Math.abs(tag.split('').reduce(function (a, c) { return a + c.charCodeAt(0); }, 0)) % PC_TAG_COLORS.length];
                return (
                  <View key={tag} style={[styles.postTag, { backgroundColor: TC + '18', borderColor: TC + '44' }]}>
                    <Text style={[styles.postTagText, { color: TC }]}>#{tag}</Text>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      )}

      {/* ── Action bar ──────────────────────────────────────────────────── */}
      <View style={[styles.actions, themedActionsStyle]}>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={handleLikePress}
          activeOpacity={0.7}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 8 }}
        >
          <Animated.View style={{ transform: [{ scale: likeScaleAnim }] }}>
            <Ionicons
              name={localLiked ? 'heart' : 'heart-outline'}
              size={26}
              color={localLiked ? '#e74c3c' : (activeGroupTheme?.mutedTextColor ?? '#666')}
            />
          </Animated.View>
          <Text style={[styles.actionCount, themedMutedText, localLiked && styles.actionCountLiked]}>
            {localLikeCount}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionBtn}
          onPress={handleOpenComments}
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 12 }}
        >
          <Ionicons
            name={localCommentCount > 0 ? 'chatbubble' : 'chatbubble-outline'}
            size={24}
            color={localCommentCount > 0 ? (activeGroupTheme?.accentColor ?? '#4fc3f7') : (activeGroupTheme?.mutedTextColor ?? '#666')}
          />
          <Text style={[
            styles.actionCount,
            themedMutedText,
            localCommentCount > 0 && styles.actionCountComment,
            localCommentCount > 0 && activeGroupTheme ? { color: activeGroupTheme.accentColor } : null,
          ]}>
            {localCommentCount}
          </Text>
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
                (() => {
                  const topLevel = comments.filter(function (c) { return !c.parent_id; });
                  const visible  = topLevel.slice(
                    Math.max(0, topLevel.length - commentsPage * COMMENTS_PAGE)
                  );
                  const hasMore  = topLevel.length > commentsPage * COMMENTS_PAGE;
                  return (
                    <FlatList
                      ref={flatListRef}
                      data={visible}
                      keyExtractor={function (c) { return c.id; }}
                      keyboardShouldPersistTaps="always"
                      renderItem={renderComment}
                      style={styles.commentsList}
                      contentContainerStyle={styles.commentsListContent}
                      ListHeaderComponent={
                        hasMore ? (
                          <TouchableOpacity
                            style={styles.loadMoreBtn}
                            onPress={function () { setCommentsPage(function (p) { return p + 1; }); }}
                          >
                            <Ionicons name="chevron-up-outline" size={14} color="#4fc3f7" />
                            <Text style={styles.loadMoreText}>
                              Load {Math.min(COMMENTS_PAGE, topLevel.length - commentsPage * COMMENTS_PAGE)} older comments
                            </Text>
                          </TouchableOpacity>
                        ) : null
                      }
                      ListEmptyComponent={
                        <View style={styles.emptyWrap}>
                          <Ionicons name="chatbubbles-outline" size={40} color="#333" />
                          <Text style={styles.noComments}>No comments yet</Text>
                          <Text style={styles.noCommentsSub}>Be the first to comment!</Text>
                        </View>
                      }
                    />
                  );
                })()
              )}
            </View>
            <View>{renderCommentInput()}</View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Owner Menu Modal */}
      <Modal visible={showOwnerMenu} transparent animationType="fade" onRequestClose={function () { setShowOwnerMenu(false); }}>
        <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={function () { if (!deleting) setShowOwnerMenu(false); }}>
          <View style={styles.menuSheet}>
            <View style={styles.dragHandle} />
            {isOwner ? (
              <TouchableOpacity style={styles.menuItem} onPress={function () { setShowOwnerMenu(false); setEditCaptionText(post.caption || ''); setShowEditCaption(true); }}>
                <Ionicons name="create-outline" size={20} color="#ccc" />
                <Text style={styles.menuItemText}>Edit Caption</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[styles.menuItem, { borderBottomWidth: 0 }]}
              onPress={deleting ? undefined : handleDeletePost}
              disabled={deleting}
            >
              {deleting
                ? <ActivityIndicator size="small" color="#e74c3c" />
                : <Ionicons name="trash-outline" size={20} color="#e74c3c" />
              }
              <Text style={[styles.menuItemText, { color: '#e74c3c' }]}>
                {deleting ? 'Deleting…' : deleteActionLabel}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuCancel} onPress={function () { if (!deleting) setShowOwnerMenu(false); }}>
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

      {/* Pinch-Zoom Modal */}
      <ImageZoomModal
        visible={!!zoomUri}
        uri={zoomUri}
        onClose={function () { setZoomUri(null); }}
      />
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  cardShell: {
    position: 'relative',
    marginBottom: 10,
    borderRadius: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  card: { backgroundColor: '#13132a', borderRadius: 14, overflow: 'hidden', position: 'relative', zIndex: 1 },
  themedCard: { borderWidth: 1 },
  themedCardImage: { ...StyleSheet.absoluteFillObject, opacity: 0.4 },
  themedCardOverlay: { ...StyleSheet.absoluteFillObject },
  groupAnimWrap: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 14,
    zIndex: 2,
  },
  groupAnimGlow: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 14,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 12,
    shadowOpacity: 0.9,
    elevation: 10,
  },
  groupAnimTopEdge: { position: 'absolute', top: 0, left: 0, right: 0, borderTopLeftRadius: 14, borderTopRightRadius: 14 },
  groupAnimBottomEdge: { position: 'absolute', bottom: 0, left: 0, right: 0, borderBottomLeftRadius: 14, borderBottomRightRadius: 14 },
  groupAnimLeftEdge: { position: 'absolute', top: 0, bottom: 0, left: 0, borderTopLeftRadius: 14, borderBottomLeftRadius: 14 },
  groupAnimRightEdge: { position: 'absolute', top: 0, bottom: 0, right: 0, borderTopRightRadius: 14, borderBottomRightRadius: 14 },
  groupAnimSweep: {
    position: 'absolute',
    top: 10,
    width: 72,
    height: 10,
    borderRadius: 999,
    overflow: 'hidden',
  },
  groupAnimSweepFill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12 },
  avatarWrap: { marginRight: 10 },
  avatar: { width: 38, height: 38, borderRadius: 19 },
  avatarFallback: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#2a2a4e', alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: '#4fc3f7', fontWeight: '700', fontSize: 16 },
  headerInfo: { flex: 1 },
  username: { color: '#f0f0f0', fontWeight: '700', fontSize: 14, letterSpacing: 0.2 },
  timestamp: { color: '#666', fontSize: 11, marginTop: 1 },
  groupLinkChip: {
    marginTop: 7,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#132033',
    borderWidth: 1,
    borderColor: '#29496b',
    maxWidth: '100%',
  },
  groupLinkText: { color: '#9cc8ff', fontSize: 11, fontWeight: '700', flexShrink: 1 },
  menuBtn: { padding: 6 },
  videoContainer: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', position: 'relative' },
  webView: { flex: 1, backgroundColor: '#000' },
  muteBtn: { position: 'absolute', bottom: 10, right: 48, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 20, padding: 6 },
  openYtBtn: { position: 'absolute', bottom: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 20, padding: 6 },
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
  postImage: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' },
  captionWrap: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 6 },
  caption: { color: '#ddd', fontSize: 14, lineHeight: 21 },
  actions: { flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#252540' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', marginRight: 20, paddingVertical: 8, paddingHorizontal: 4 },
  actionCount: { color: '#888', fontSize: 13, marginLeft: 5, fontWeight: '500' },
  actionCountLiked: { color: '#e74c3c' },
  actionCountComment: { color: '#4fc3f7' },
  commentIconWrap: { position: 'relative' },
  commentCountBadge: {
    position: 'absolute',
    top: -5,
    right: -6,
    minWidth: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#ff4500',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  commentCountBadgeText: { color: '#fff', fontSize: 8, fontWeight: '800' },
  // load-more button
  loadMoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginTop: 6,
    marginBottom: 2,
    borderRadius: 10,
    backgroundColor: '#12122a',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#1e1e3a',
  } as any,
  loadMoreText: { color: '#4fc3f7', fontSize: 12, fontWeight: '600' },
  // ── double-tap wrapper & overlay ──────────────────────────────────────────
  mediaTapWrapper: { position: 'relative' },
  overlayHeartContainer: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center', alignItems: 'center',
    pointerEvents: 'none',
  } as any,
  // ─────────────────────────────────────────────────────────────────────────
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
  commentMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  commentTime: { color: '#555', fontSize: 11 },
  commentEdited: { color: '#444', fontSize: 11 },
  commentLikeBtn: { flexDirection: 'row', alignItems: 'center', marginLeft: 10, gap: 3, paddingVertical: 4, paddingHorizontal: 4 } as any,
  commentLikeCount: { color: '#666', fontSize: 11 },
  // ── Reply styles ────────────────────────────────────────
  replyRow: {
    paddingLeft: 42,
    paddingTop: 4,
    marginLeft: 14,          // align thread line with parent avatar centre
    borderLeftWidth: 1.5,
    borderLeftColor: '#2a2a4a',
    borderStyle: 'solid',
  },
  replyThreadLine: {
    // kept for backwards compat but hidden — border on replyRow does the job
    display: 'none',
  } as any,
  replyAvatarImg: { width: 26, height: 26, borderRadius: 13 },
  replyAvatarFallback: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#1e1e3a', alignItems: 'center', justifyContent: 'center' },
  replyBtn: { flexDirection: 'row', alignItems: 'center', marginLeft: 10, gap: 3 } as any,
  replyBtnText: { color: '#4fc3f7', fontSize: 11, fontWeight: '600' },
  replyingToBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#12122a',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#1e1e3a',
    paddingHorizontal: 14,
    paddingVertical: 7,
  } as any,
  replyingToText: { color: '#888', fontSize: 12, flex: 1 },
  replyingToName: { color: '#4fc3f7', fontWeight: '700' },
  commentInputRow: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#1e1e3a', backgroundColor: '#0f0f23', paddingTop: 8, paddingHorizontal: 12 },
  commentInputInner: { flexDirection: 'row', alignItems: 'flex-end' },
  commentInputWrap: { flex: 1, marginRight: 8 },
  commentInput: { color: '#e0e0ff', fontSize: 14, maxHeight: 100, paddingVertical: 8 },
  commentSendBtn: { width: 34, height: 34, borderRadius: 17, justifyContent: 'center', alignItems: 'center', marginBottom: 2 },
  commentSendBtnActive: { backgroundColor: '#ff4500' },
  commentSendBtnInactive: { backgroundColor: '#1e1e3a' },
  menuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  menuSheet: { backgroundColor: '#1a1a2e', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 8, paddingBottom: 34 },
  menuItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#252540', gap: 14 } as any,
  menuItemText: { color: '#ccc', fontSize: 16 },
  menuCancel: { marginTop: 8, marginHorizontal: 16, backgroundColor: '#252540', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  menuCancelText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  editCaptionSheet: { backgroundColor: '#1a1a2e', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 34 },
  editCaptionTitle: { color: '#fff', fontSize: 17, fontWeight: '700', marginBottom: 14 },
  editCaptionInput: { color: '#e0e0ff', fontSize: 15, minHeight: 80, textAlignVertical: 'top', backgroundColor: '#0f0f23', borderRadius: 10, padding: 12 },
  editCaptionActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 14, gap: 12 } as any,
  editCaptionCancel: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 8, backgroundColor: '#252540' },
  editCaptionCancelText: { color: '#aaa', fontSize: 15 },
  editCaptionSave: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 8, backgroundColor: '#ff4500' },
  editCaptionSaveText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  editCommentInput: { color: '#e0e0ff', fontSize: 14, backgroundColor: '#0f0f23', borderRadius: 8, padding: 8, marginBottom: 6, minHeight: 50 },
  editCommentActions: { flexDirection: 'row', gap: 8 } as any,
  editCommentBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: '#ff4500' },
  cancelEditBtn: { backgroundColor: '#252540' },
  editCommentBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },

  // ── Emoji Reactions ─────────────────────────────────────────────────────
  reactionPickerWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    borderRadius: 24,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginBottom: 6,
    alignSelf: 'flex-start',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 6,
  } as any,
  reactionPickerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 2,
  },
  reactionPickerBtnActive: {
    backgroundColor: 'rgba(255,69,0,0.25)',
  },
  reactionPickerEmoji: { fontSize: 22 },
  reactionPickerClose: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#252540',
    marginLeft: 4,
  },
  reactionPillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginTop: 4,
    marginBottom: 2,
    paddingHorizontal: 2,
  } as any,
  reactionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e1e3a',
    borderRadius: 12,
    paddingHorizontal: 7,
    paddingVertical: 3,
    gap: 3,
    borderWidth: 1,
    borderColor: '#252550',
  } as any,
  reactionPillMine: {
    backgroundColor: 'rgba(255,69,0,0.18)',
    borderColor: '#ff4500',
  },
  reactionPillEmoji: { fontSize: 13 },
  reactionPillCount: { color: '#888', fontSize: 11, fontWeight: '600' },
  reactionPillCountMine: { color: '#ff7040' },
  // ── Tags ──────────────────────────────────────────────────────────────────
  tagsSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#1a1a30',
  },
  tagsCollapseBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 7,
    gap: 6,
  } as any,
  tagsInlineList: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
    gap: 6,
    overflow: 'hidden',
  } as any,
  tagsInlineTag: {
    fontSize: 12,
    fontWeight: '600',
  },
  tagsInlineMore: {
    fontSize: 11,
    color: '#555',
    fontWeight: '500',
  },
  tagsExpandedLabel: {
    fontSize: 12,
    color: '#666',
    fontWeight: '600',
  },
  postTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 14,
    paddingTop: 2,
    paddingBottom: 10,
  },
  postTag: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  postTagText: {
    fontSize: 11,
    fontWeight: '600',
  },
  // ── React button ─────────────────────────────────────────────────────────
  reactBtn: {
    marginLeft: 8,
    paddingHorizontal: 2,
  },
  reactBtnEmoji: { fontSize: 13 },
});
