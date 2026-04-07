// app/(tabs)/profile.tsx
import React, {
  useState, useEffect, useCallback, useMemo, useRef,
} from 'react';
import {
  View, Text, Image, StyleSheet, ScrollView, TouchableOpacity,
  FlatList, Modal, TextInput, ActivityIndicator,
  Alert, Switch, Dimensions, Platform, KeyboardAvoidingView,
  RefreshControl, StatusBar, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import PropIcon from '../../src/components/icons/PropIcon';
import { useRouter }        from 'expo-router';
import { useAuth }          from '../../src/context/AuthContext';
import { useProfile }       from '../../src/hooks/useProfile';
import { useYouTubeAuth }   from '../../src/hooks/useYouTubeAuth';
import { useMultiGP }       from '../../src/hooks/useMultiGP';
import { supabase }         from '../../src/services/supabase';
import PostCard             from '../../src/components/PostCard';
import type { FeedPost }    from '../../src/hooks/useFeed';
import { useFollow }        from '../../src/hooks/useFollow';
import FollowListModal      from '../../src/components/FollowListModal';
import { useMute }          from '../../src/hooks/useMute';
import MuteListModal        from '../../src/components/MuteListModal';
import { PropsToast, usePropsToast } from '../../src/components/PropsToast';
import { useStripeConnect } from '../../src/hooks/useStripeConnect';
import ProfileAvatarDecoration from '../../src/components/ProfileAvatarDecoration';
import ProfileBannerMedia from '../../src/components/ProfileBannerMedia';
import { useResolvedProfileAppearance } from '../../src/hooks/useProfileAppearance';
import { useResolvedProfileBadges } from '../../src/hooks/useProfileBadges';
import ProfileBadgeRow from '../../src/components/ProfileBadgeRow';

const { width: W } = Dimensions.get('window');
const CELL = (W - 4) / 3;
const TAB_BAR_H = 46;

const PROPS_HISTORY_LABEL_MAP: Record<string, string> = {
  first_post: '✍️ First post',
  easter_egg: '🥚 Easter egg found',
  first_challenge_entry: '🏁 First challenge entry',
  profile_complete: '✅ Profile complete',
  follower_10: '👥 10 followers milestone',
  follower_50: '👥 50 followers milestone',
  follower_100: '👥 100 followers milestone',
  follower_milestone_10: '👥 10 followers milestone',
  follower_milestone_50: '👥 50 followers milestone',
  follower_milestone_100: '👥 100 followers milestone',
  post_votes_10: '👍 10 votes on a post',
  post_votes_50: '👍 50 votes on a post',
  post_votes_100: '👍 100 votes on a post',
  post_vote_milestone_10: '👍 10 votes on a post',
  post_vote_milestone_50: '👍 50 votes on a post',
  post_vote_milestone_100: '👍 100 votes on a post',
  challenge_winner_1: '🥇 Weekly challenge · 1st place',
  challenge_winner_2: '🥈 Weekly challenge · 2nd place',
  challenge_winner_3: '🥉 Weekly challenge · 3rd place',
  featured_boost: '⚡ Featured listing boost',
  featured_sold_bonus: '🏷️ Featured sale bonus',
  profile_appearance_purchase_bonus: '🎨 Profile appearance purchase bonus',
  profile_badge_purchase_bonus: '🏅 Profile badge purchase bonus',
};

function formatPropsHistoryLabel(item: { reason: string; label?: string | null }) {
  if (item.label) return item.label;
  return PROPS_HISTORY_LABEL_MAP[item.reason] ?? item.reason.replace(/_/g, ' ');
}

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface Post {
  id: string; user_id: string; content?: string; caption?: string;
  media_url?: string | null; social_url?: string | null; embed_url?: string | null;
  thumbnail_url?: string | null; platform?: string | null;
  media_type?: 'image' | 'video' | null;
  like_count?: number; likes_count?: number;
  comment_count?: number; comments_count?: number;
  created_at?: string;
  users?: { id?: string; username: string; avatar_url?: string | null } | null;
}

interface Build {
  id: string; user_id: string; name: string;
  frame?: string | null; motors?: string | null; fc?: string | null;
  vtx?: string | null; camera?: string | null; notes?: string | null;
  created_at?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isRemoteUrl(url?: string | null): url is string {
  return typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'));
}

function resolveStorageUrl(url?: string | null): string | null {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('file://')) return null;  // ← local device path, no public URL possible
  try {
    const { data } = supabase.storage.from('posts').getPublicUrl(url);
    return data?.publicUrl ?? null;
  } catch (_e) {
    return null;
  }
}

function toFeedPost(p: Post): FeedPost {
  return {
    ...p,
    like_count:    p.like_count    ?? p.likes_count    ?? 0,
    comment_count: p.comment_count ?? p.comments_count ?? 0,
    isLiked: false,
    media_url:   resolveStorageUrl(p.media_url)  ?? null,
    social_url:  isRemoteUrl(p.social_url)  ? p.social_url  : null,
    embed_url:   isRemoteUrl(p.embed_url)   ? p.embed_url   : null,
    users: p.users
      ? { id: p.users.id ?? null, username: p.users.username ?? null, avatar_url: p.users.avatar_url ?? null }
      : null,
  } as FeedPost;
}

function thumbnailUri(post: Post): string | null {
  // For direct video uploads: thumbnail_url is the frame saved during upload — use it first
  if (post.media_type === 'video' || /\.(mp4|mov|webm)(\?|$)/i.test(post.media_url ?? '')) {
    const t = resolveStorageUrl(post.thumbnail_url);
    if (t && !t.startsWith('file://')) return t;
    // No thumbnail saved yet — fall through to show placeholder
    return null;
  }

  // Check all URL candidates in order
  const candidates = [post.thumbnail_url, post.media_url, post.social_url, post.embed_url];
  for (const raw of candidates) {
    if (!raw) continue;
    if (raw.startsWith('file://')) continue;                        // skip local paths
    const url = resolveStorageUrl(raw);
    if (!url) continue;
    if (url.toLowerCase().includes('instagram')) continue;          // skip instagram

    // YouTube → use thumbnail API
    const m = url.match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    if (m?.[1]) return `https://img.youtube.com/vi/${m[1]}/hqdefault.jpg`;

    // Skip video files
    if (url.match(/\.(mp4|mov|webm)(\?|$)/i)) continue;

    // Plain image URL — return it
    return url;
  }
  return null;
}


// ─── Small components ─────────────────────────────────────────────────────────

// ─── Animated StatBox ──────────────────────────────────────────────────────────
// Props:
//   displayValue  – the number to show (string values skip count-up)
//   animatedValue – Animated.Value that drives the count-up (0 → displayValue)
//   scaleAnim     – Animated.Value for pulse-on-tap (passed in for tappable cells)
//   accentAnim    – Animated.Value for accent-bar brightness on tap
const StatBox = ({
  displayValue,
  label,
  icon,
  tappable,
  accentColor = '#ffffff',
  animatedValue,
  scaleAnim,
  accentAnim,
  renderIcon,
}: {
  displayValue: number | string;
  label: string;
  icon?: string;
  tappable?: boolean;
  accentColor?: string;
  animatedValue?: Animated.Value;
  renderIcon?: (color: string) => React.ReactNode;
  scaleAnim?: Animated.Value;
  accentAnim?: Animated.Value;
}) => {
  // Displayed text: interpolate count-up if animatedValue provided and value is numeric
  const isNumeric = typeof displayValue === 'number';

  // Pulse scale (default 1 if not tappable)
  const scale = scaleAnim ?? new Animated.Value(1);

  // Accent opacity glow (default 0.8)
  const accentOpacity = accentAnim
    ? accentAnim.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1] })
    : 0.85;

  return (
    <Animated.View style={[styles.statBox, { transform: [{ scale }] }]}>
      {/* Coloured top-accent bar with glow on tap */}
      <Animated.View
        style={[
          styles.statTopAccent,
          { backgroundColor: accentColor, opacity: accentOpacity },
        ]}
      />
      {/* Value row — count-up or static */}
      <View style={styles.statValueRow}>
        {renderIcon ? renderIcon(accentColor) : (icon && <Ionicons name={icon as any} size={15} color={accentColor} />)}
        {isNumeric && animatedValue ? (
          <AnimatedCountText
            animValue={animatedValue}
            target={displayValue as number}
            style={[styles.statValue, { color: accentColor }]}
          />
        ) : (
          <Text style={[styles.statValue, { color: accentColor }]}>{displayValue}</Text>
        )}
      </View>
      {/* Label row */}
      <View style={styles.statLabelRow}>
        <Text style={styles.statLabel}>{label}</Text>
        {tappable && (
          <Ionicons name="chevron-forward" size={9} color="#444" style={{ marginLeft: 2 }} />
        )}
      </View>
    </Animated.View>
  );
};

// ─── Count-up helper ───────────────────────────────────────────────────────────
function AnimatedCountText({
  animValue,
  target,
  style,
}: {
  animValue: Animated.Value;
  target: number;
  style?: any;
}) {
  const [display, setDisplay] = React.useState(0);
  React.useEffect(() => {
    const id = animValue.addListener(({ value }) => {
      setDisplay(Math.round(value * target));
    });
    return () => animValue.removeListener(id);
  }, [animValue, target]);
  return <Text style={style}>{display}</Text>;
}

function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={styles.emptyState}>
      <Ionicons name={icon as any} size={48} color="#333" />
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

function PostGridCell({ item, onPress }: { item: Post; onPress: () => void }) {
  const [imgFailed, setImgFailed] = useState(false);
  const thumb   = thumbnailUri(item);
  const allUrls = [item.media_url, item.social_url, item.embed_url].filter(Boolean) as string[];
  const isVid   = item.media_type === 'video' || /\.(mp4|mov|webm)(\?|$)/i.test(item.media_url ?? '');
  const isYT    = allUrls.some(u => /youtu/i.test(u));
  const isIG    =
    item.platform === 'instagram' ||
    (item.social_url ?? '').toLowerCase().includes('instagram') ||
    (item.media_url  ?? '').toLowerCase().includes('instagram');
  const hasTextOnlyContent = !thumb && !isIG && !isVid && !allUrls.length && !!item.caption?.trim();
  const textPreview = item.caption?.trim().slice(0, 56) ?? '';

  return (
    <TouchableOpacity style={styles.gridCell} onPress={onPress} activeOpacity={0.8}>
      {thumb && !imgFailed ? (
        <Image
          source={{ uri: thumb }}
          style={styles.gridThumb}
          resizeMode="cover"
          onError={() => setImgFailed(true)}
        />
      ) : isIG ? (
        <View style={[styles.gridThumb, styles.gridIgPlaceholder]}>
          <Ionicons name="logo-instagram" size={26} color="#fff" />
          <Text style={styles.gridIgText}>Instagram</Text>
          <Text style={styles.gridIgSub}>Tap to open</Text>
        </View>
      ) : hasTextOnlyContent ? (
        <View style={[styles.gridThumb, styles.gridTextPlaceholder]}>
          <View style={styles.gridTextBadge}>
            <Ionicons name="document-text-outline" size={12} color="#9cc8ff" />
            <Text style={styles.gridTextBadgeLabel}>Text post</Text>
          </View>
          <Text style={styles.gridTextPreview} numberOfLines={4}>
            {textPreview}
          </Text>
        </View>
      ) : (
        <View style={[styles.gridThumb, styles.gridThumbPlaceholder]}>
          <Ionicons name={isVid ? 'videocam' : 'image-outline'} size={28} color="#444" />
        </View>
      )}
      {isVid && !isYT && (
        <View style={styles.gridPlayBadge}>
          <Ionicons name="play-circle" size={22} color="rgba(255,255,255,0.85)" />
        </View>
      )}
      {isYT && (
        <View style={styles.gridYtBadge}>
          <Ionicons name="logo-youtube" size={14} color="#fff" />
        </View>
      )}
      {isIG && (
        <View style={styles.gridIgBadge}>
          <Ionicons name="logo-instagram" size={14} color="#fff" />
        </View>
      )}
    </TouchableOpacity>
  );
}

// ─── Tab config ───────────────────────────────────────────────────────────────

const TABS = [
  { key: 'posts',    label: 'Posts',    icon: 'grid-outline'       },
  { key: 'media',    label: 'Media',    icon: 'film-outline'       },
  { key: 'builds',   label: 'Builds',   icon: 'construct-outline'  },
  { key: 'listings', label: 'Listings', icon: 'pricetag-outline'   },
  { key: 'saved',    label: 'Saved',    icon: 'bookmark-outline'   },
] as const;

type TabKey = typeof TABS[number]['key'];

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth() as {
    user: { id: string; email?: string } | null;
    signOut: () => void;
  };
  const [isAdmin, setIsAdmin] = React.useState(false);
  useEffect(() => {
    if (!user) return;
    supabase.from('users').select('is_admin').eq('id', user.id).single()
      .then(({ data }) => setIsAdmin(data?.is_admin === true));
  }, [user?.id]);

  const {
    profile, loading: profileLoading, updating,
    fetchProfile, updateProfile, validateUsername,
    uploadAvatar, uploadHeaderImage, uploadHeaderVideo, updateSocialLinks,
  } = useProfile(user?.id ?? undefined);

  const { appearance: profileAppearance } = useResolvedProfileAppearance(user?.id ?? undefined);
  const { featuredBadges } = useResolvedProfileBadges(user?.id ?? undefined);

  const {
    linked: ytLinked, loading: ytAuthLoading,
    promptAsync: promptYouTubeAuth, unlinkYouTube,
  } = useYouTubeAuth(user?.id);

  const {
    connection: mgpConnection, loading: mgpLoading, saving: mgpSaving,
    validating: mgpValidating, syncing: mgpSyncing,
    validateKey: mgpValidateKey, saveConnection: mgpSaveConnection,
    toggleActive: mgpToggleActive, disconnect: mgpDisconnect, triggerSync: mgpTriggerSync,
  } = useMultiGP(user?.id);

  const { followersCount, followingCount } = useFollow(user?.id ?? '', user?.id);

  const {
    mutedUsers, loading: muteLoading,
    unmuteUser, fetchMutedUsers,
  } = useMute(user?.id);

  const {
    sellerProfile: stripeProfile, loading: stripeLoading,
    onboarding: stripeOnboarding, checking: stripeChecking,
    startOnboarding: stripeStartOnboarding,
    checkStatus: stripeCheckStatus,
    refreshProfile: stripeRefreshProfile,
  } = useStripeConnect(user?.id);

  // ── Tab / data state ──────────────────────────────────────────────────────
  const [activeTab,   setActiveTab]   = useState<TabKey>('posts');
  const [myPosts,       setMyPosts]       = useState<Post[]>([]);
  const [builds,        setBuilds]        = useState<Build[]>([]);
  const [myListings,    setMyListings]    = useState<any[]>([]);
  const [savedListings, setSavedListings] = useState<any[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [refreshing,  setRefreshing]  = useState(false);
  const loadedTabsRef = useRef<Set<TabKey>>(new Set());

  // ── Modal visibility ──────────────────────────────────────────────────────
  const [showSettings,    setShowSettings]    = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showSocialLinks, setShowSocialLinks] = useState(false);
  const [showCreateBuild, setShowCreateBuild] = useState(false);
  const [showPostDetail,  setShowPostDetail]  = useState(false);
  const [selectedPost,    setSelectedPost]    = useState<Post | null>(null);
  const [showMuteList,    setShowMuteList]    = useState(false);
  const [showMultiGP,     setShowMultiGP]     = useState(false);
  const [showStripeConnect, setShowStripeConnect] = useState(false);
  const [followModal,     setFollowModal]     = useState<'followers' | 'following' | null>(null);
  const [showPropsLog,    setShowPropsLog]    = useState(false);
  const [propsLog,        setPropsLog]        = useState<{ id: string; amount: number; reason: string; created_at: string; isSpend?: boolean; label?: string; reference_id?: string }[]>([]);
  const [propsLogLoading, setPropsLogLoading] = useState(false);

  // ── Stats card animations ──────────────────────────────────────────────────
  // Shared count-up progress values (0 → 1, driven together)
  const countProgress  = useRef(new Animated.Value(0)).current;   // 0→1 for all count-ups
  // Per-stat stagger refs (each advances slightly later)
  const countPosts     = useRef(new Animated.Value(0)).current;
  const countFollowers = useRef(new Animated.Value(0)).current;
  const countFollowing = useRef(new Animated.Value(0)).current;
  const countProps     = useRef(new Animated.Value(0)).current;

  // Card slide-in
  const cardSlideY   = useRef(new Animated.Value(14)).current;
  const cardOpacity  = useRef(new Animated.Value(0)).current;

  // Per-cell pulse (scale) for tappable stats
  const scaleFollowers = useRef(new Animated.Value(1)).current;
  const scaleFollowing = useRef(new Animated.Value(1)).current;
  const accentFollowers = useRef(new Animated.Value(0)).current;
  const accentFollowing = useRef(new Animated.Value(0)).current;

  // Fire count-up whenever real values arrive (followers / following load async)
  const lastAnimatedKey = useRef('');
  useEffect(() => {
    const key = `${myPosts.length}-${followersCount}-${followingCount}-${profile?.total_props ?? 0}`;
    if (key === lastAnimatedKey.current) return;
    lastAnimatedKey.current = key;

    // Reset
    countPosts.setValue(0);
    countFollowers.setValue(0);
    countFollowing.setValue(0);
    countProps.setValue(0);
    cardSlideY.setValue(14);
    cardOpacity.setValue(0);

    // Staggered count-up  (80 ms gap per cell, 750 ms duration each)
    const dur = 750;
    const stagger = 80;
    Animated.parallel([
      // Card entrance
      Animated.timing(cardSlideY,  { toValue: 0, duration: 400, useNativeDriver: true }),
      Animated.timing(cardOpacity, { toValue: 1, duration: 350, useNativeDriver: true }),
      // Count-ups
      Animated.sequence([
        Animated.delay(0),
        Animated.timing(countPosts,     { toValue: 1, duration: dur, useNativeDriver: false }),
      ]),
      Animated.sequence([
        Animated.delay(stagger),
        Animated.timing(countFollowers, { toValue: 1, duration: dur, useNativeDriver: false }),
      ]),
      Animated.sequence([
        Animated.delay(stagger * 2),
        Animated.timing(countFollowing, { toValue: 1, duration: dur, useNativeDriver: false }),
      ]),
      Animated.sequence([
        Animated.delay(stagger * 3),
        Animated.timing(countProps,     { toValue: 1, duration: dur, useNativeDriver: false }),
      ]),
    ]).start();
  }, [myPosts.length, followersCount, followingCount, profile?.total_props]);

  // Pulse helper — spring scale + accent glow on press
  const pulseStat = (scaleRef: Animated.Value, accentRef: Animated.Value) => {
    Animated.parallel([
      Animated.sequence([
        Animated.spring(scaleRef, { toValue: 1.13, useNativeDriver: true, speed: 40, bounciness: 14 }),
        Animated.spring(scaleRef, { toValue: 1.0,  useNativeDriver: true, speed: 20, bounciness: 6  }),
      ]),
      Animated.sequence([
        Animated.timing(accentRef, { toValue: 1, duration: 120, useNativeDriver: false }),
        Animated.timing(accentRef, { toValue: 0, duration: 300, useNativeDriver: false }),
      ]),
    ]).start();
  };

  // ── Edit profile fields ───────────────────────────────────────────────────
  const [editUsername,  setEditUsername]  = useState('');
  const [editBio,       setEditBio]       = useState('');
  const [usernameError, setUsernameError] = useState('');

  // ── Social link fields ────────────────────────────────────────────────────
  const [editWebsite,   setEditWebsite]   = useState('');
  const [editYoutube,   setEditYoutube]   = useState('');
  const [editInstagram, setEditInstagram] = useState('');
  const [editTwitter,   setEditTwitter]   = useState('');
  const [editTiktok,    setEditTiktok]    = useState('');

  // ── MultiGP fields ────────────────────────────────────────────────────────
  const [mgpKeyInput,    setMgpKeyInput]    = useState('');
  const [mgpValidResult, setMgpValidResult] = useState<{
    valid: boolean; chapterName: string | null;
    chapterId: string | null; error?: string;
  } | null>(null);
  const [mgpSyncMsg,  setMgpSyncMsg]  = useState('');
  const [showMgpHelp, setShowMgpHelp] = useState(false);

  // ── Build fields ──────────────────────────────────────────────────────────
  const [buildName,   setBuildName]   = useState('');
  const [buildFrame,  setBuildFrame]  = useState('');
  const [buildMotors, setBuildMotors] = useState('');
  const [buildFC,     setBuildFC]     = useState('');
  const [buildVTX,    setBuildVTX]    = useState('');
  const [buildCamera, setBuildCamera] = useState('');
  const [buildNotes,  setBuildNotes]  = useState('');

  // ── 🥚 Easter Egg state ───────────────────────────────────────────────────
  const [eggTapCount, setEggTapCount] = useState(0);
  const [eggVisible,  setEggVisible]  = useState(false);
  const eggSpin                        = useRef(new Animated.Value(0)).current;
  const eggTapTimer                    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const propsToast                     = usePropsToast();
  const eggSpinAnim                    = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (!profile) return;
    setEditUsername(profile.username       ?? '');
    setEditBio(profile.bio                 ?? '');
    setEditWebsite(profile.website_url     ?? '');
    setEditYoutube(profile.youtube_url     ?? '');
    setEditInstagram(profile.instagram_url ?? '');
    setEditTwitter(profile.twitter_url     ?? '');
    setEditTiktok(profile.tiktok_url       ?? '');
  }, [profile]);

  // ── Data loaders ──────────────────────────────────────────────────────────
  const loadPropsLog = useCallback(async () => {
    if (!user?.id) return;
    setPropsLogLoading(true);
    try {
      // 1. props_log — profile_complete, easter_egg, first_challenge_entry
      const { data: logData } = await supabase
        .from('props_log')
        .select('id, amount, reason, created_at, reference_id')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(40);

      // 2. props_events — challenge wins, follower milestones, first_post (via award_props)
      const { data: eventsData } = await supabase
        .from('props_events')
        .select('id, props_amount, event_type, created_at, reference_id')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(40);

      const seasonRewardTrackIds = Array.from(new Set(
        (eventsData ?? [])
          .filter((r: any) => r.event_type === 'season_track_reward')
          .map((r: any) => String(r.reference_id ?? '').split(':')[0])
          .filter(Boolean),
      ));

      let seasonRewardLabelByTrackId: Record<string, string> = {};
      if (seasonRewardTrackIds.length > 0) {
        const { data: seasonRewardDetails } = await supabase
          .from('season_track_reward_details')
          .select('id, level_number, track_type, display_name')
          .in('id', seasonRewardTrackIds);

        seasonRewardLabelByTrackId = Object.fromEntries(
          (seasonRewardDetails ?? []).map((row: any) => {
            const parts = ['🎁 Season reward'];
            parts.push(`L${row.level_number}`);
            if (row.track_type === 'premium') parts.push('Premium');
            if (row.display_name) parts.push(row.display_name);
            return [row.id, parts.join(' • ')];
          }),
        );
      }

      // 3. featured_purchases — spend events (props only)
      const { data: spendData } = await supabase
        .from('featured_purchases')
        .select('id, props_spent, created_at')
        .eq('user_id', user.id)
        .eq('purchase_type', 'props')
        .order('created_at', { ascending: false })
        .limit(20);

      // Normalise to { id, amount, reason, created_at, isSpend? }
      const earned1 = (logData ?? []).map((r: any) => ({
        id:           r.id,
        amount:       r.amount,
        reason:       r.reason,
        created_at:   r.created_at,
        reference_id: r.reference_id,
      }));
      const earned2 = (eventsData ?? []).map((r: any) => {
        const trackId = String(r.reference_id ?? '').split(':')[0];
        return {
          id:           r.id,
          amount:       r.props_amount,
          reason:       r.event_type,
          created_at:   r.created_at,
          reference_id: r.reference_id,
          label:        r.event_type === 'season_track_reward'
            ? (seasonRewardLabelByTrackId[trackId] ?? '🎁 Season reward')
            : undefined,
        };
      });
      const spent = (spendData ?? []).map((r: any) => ({
        id:         r.id,
        amount:     -(r.props_spent ?? 0),
        reason:     'featured_boost',
        created_at: r.created_at,
        isSpend:    true,
      }));

      // Merge all, de-dupe by id, sort newest-first, cap at 30
      const seenIds = new Set<string>();
      const merged = [...earned1, ...earned2, ...spent]
        .filter(e => { if (seenIds.has(e.id)) return false; seenIds.add(e.id); return true; })
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 30);

      setPropsLog(merged);
    } finally {
      setPropsLogLoading(false);
    }
  }, [user?.id]);

  const loadMyPosts = useCallback(async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from('posts').select('*, users(id, username, avatar_url)')
      .eq('user_id', user.id).order('created_at', { ascending: false });
    setMyPosts((data as Post[]) ?? []);
  }, [user?.id]);

  const loadBuilds = useCallback(async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from('fpv_builds').select('*')
      .eq('user_id', user.id).order('created_at', { ascending: false });
    setBuilds((data as Build[]) ?? []);
  }, [user?.id]);

  const loadBoostHistory = useCallback(async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from('featured_purchases')
      .select(`
        id, ends_at, duration_hrs, props_spent, purchase_type, amount_usd, created_at,
        marketplace_listings (
          id, title,
          listing_images ( url, is_primary )
        )
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(30);
    setBoostHistory(data ?? []);
  }, [user?.id]);

  const loadMyListings = useCallback(async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from('marketplace_listings')
      .select(`
        id, title, price, status, condition, created_at,
        listing_images ( url, is_primary )
      `)
      .eq('seller_id', user.id)
      .in('status', ['active', 'pending_sale'])
      .order('created_at', { ascending: false })
      .limit(50);
    setMyListings(data ?? []);
  }, [user?.id]);

  const loadSavedListings = useCallback(async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from('listing_watchlist')
      .select(`
        listing_id,
        marketplace_listings (
          id, title, price, status, condition, created_at,
          listing_images ( url, is_primary )
        )
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    setSavedListings((data ?? []).map((r: any) => r.marketplace_listings).filter(Boolean));
  }, [user?.id]);

  const loadTabData = useCallback(async (tab: TabKey, force = false) => {
    if (!force && loadedTabsRef.current.has(tab)) return;
    setDataLoading(true);
    try {
      if (tab === 'posts' || tab === 'media') {
        await loadMyPosts();
        loadedTabsRef.current.add('posts');
        loadedTabsRef.current.add('media');
      } else if (tab === 'builds') {
        await loadBuilds();
        loadedTabsRef.current.add('builds');
      } else if (tab === 'listings') {
        await loadMyListings();
        loadedTabsRef.current.add('listings');
      } else if (tab === 'saved') {
        await loadSavedListings();
        loadedTabsRef.current.add('saved');
      }
    } finally { setDataLoading(false); }
  }, [loadMyPosts, loadBuilds, loadMyListings, loadSavedListings]);

  useEffect(() => { loadTabData(activeTab); }, [activeTab]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    loadedTabsRef.current.clear();
    await Promise.all([fetchProfile(), loadTabData(activeTab, true), fetchMutedUsers()]);
    setRefreshing(false);
  }, [fetchProfile, loadTabData, activeTab, fetchMutedUsers]);

  const mediaPosts = useMemo(
    () => myPosts.filter(p => {
      const allUrls = [p.media_url, p.social_url, p.embed_url].filter(Boolean) as string[];
      const primaryUrl = p.media_url ?? '';
      const isVideo = p.media_type === 'video' || /\.(mp4|mov|webm)(\?|$)/i.test(primaryUrl);
      const isInstagram =
        p.platform === 'instagram' ||
        (p.social_url ?? '').toLowerCase().includes('instagram') ||
        (p.media_url ?? '').toLowerCase().includes('instagram');
      const thumb = thumbnailUri(p);
      return isVideo || isInstagram || !!thumb || allUrls.length > 0;
    }),
    [myPosts],
  );

  // ── Save handlers ─────────────────────────────────────────────────────────
  const saveProfile = useCallback(async () => {
    setUsernameError('');
    const { valid, message } = await validateUsername(editUsername.trim());
    if (!valid) { setUsernameError(message ?? ''); return; }
    const result = await updateProfile({ username: editUsername.trim(), bio: editBio.trim() });
    if (result?.error) { Alert.alert('Error', result.error); return; }
    setShowEditProfile(false);
    // ── Award profile complete props (once, when username + bio both filled) ──
    if (user?.id && editUsername.trim() && editBio.trim()) {
      supabase.from('props_log').insert({
        user_id: user.id, amount: 30,
        reason: 'profile_complete', reference_id: user.id,
      }).then(({ error }) => {
        if (!error) propsToast.show('+30 Props! Profile complete ✈️');
      });
    }
  }, [editUsername, editBio, validateUsername, updateProfile]);

  const saveSocials = useCallback(async () => {
    const result = await updateSocialLinks({
      website_url:   editWebsite.trim()   || undefined,
      youtube_url:   editYoutube.trim()   || undefined,
      instagram_url: editInstagram.trim() || undefined,
      twitter_url:   editTwitter.trim()   || undefined,
      tiktok_url:    editTiktok.trim()    || undefined,
    });
    if (result?.error) { Alert.alert('Error', result.error); return; }
    setShowSocialLinks(false);
  }, [editWebsite, editYoutube, editInstagram, editTwitter, editTiktok, updateSocialLinks]);

  const createBuild = useCallback(async () => {
    if (!buildName.trim()) { Alert.alert('Name required'); return; }
    const { error } = await supabase.from('fpv_builds').insert({
      user_id: user?.id, name: buildName.trim(),
      frame:   buildFrame.trim()  || null,
      motors:  buildMotors.trim() || null,
      fc:      buildFC.trim()     || null,
      vtx:     buildVTX.trim()    || null,
      camera:  buildCamera.trim() || null,
      notes:   buildNotes.trim()  || null,
    });
    if (error) { Alert.alert('Error', error.message); return; }
    setBuildName(''); setBuildFrame(''); setBuildMotors('');
    setBuildFC(''); setBuildVTX(''); setBuildCamera(''); setBuildNotes('');
    setShowCreateBuild(false);
    loadedTabsRef.current.delete('builds');
    await loadBuilds();
    loadedTabsRef.current.add('builds');
  }, [user?.id, buildName, buildFrame, buildMotors, buildFC, buildVTX, buildCamera, buildNotes, loadBuilds]);

  const deleteBuild = useCallback((id: string) => {
    Alert.alert('Delete Build', 'Remove this build?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await supabase.from('fpv_builds').delete().eq('id', id);
        setBuilds(prev => prev.filter(b => b.id !== id));
      }},
    ]);
  }, []);

  const handleBannerPress = useCallback(() => {
    Alert.alert('Profile header', 'Choose how your profile header should look to visitors.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Photo',
        onPress: async () => {
          const result = await uploadHeaderImage();
          if (result?.error) { Alert.alert('Banner Upload Failed', result.error); return; }
          if (!result?.canceled) await fetchProfile();
        },
      },
      {
        text: 'Loop Video',
        onPress: async () => {
          const result = await uploadHeaderVideo();
          if (result?.error) { Alert.alert('Header Video Upload Failed', result.error); return; }
          if (!result?.canceled) await fetchProfile();
        },
      },
    ]);
  }, [uploadHeaderImage, uploadHeaderVideo, fetchProfile]);

  const handleMgpValidate = useCallback(async () => {
    if (!mgpKeyInput.trim()) { Alert.alert('Enter your API key first'); return; }
    setMgpValidResult(await mgpValidateKey(mgpKeyInput.trim()));
  }, [mgpKeyInput, mgpValidateKey]);

  const handleMgpConnect = useCallback(async () => {
    if (!mgpValidResult?.valid) return;
    const result = await mgpSaveConnection(mgpKeyInput.trim(), mgpValidResult.chapterName, mgpValidResult.chapterId);
    if (result?.error) { Alert.alert('Error', result.error); return; }
    setMgpKeyInput(''); setMgpValidResult(null);
    Alert.alert('✅ Connected!', `${mgpValidResult.chapterName ?? 'Chapter'} linked successfully.`);
  }, [mgpValidResult, mgpKeyInput, mgpSaveConnection]);

  const handleMgpSync = useCallback(async () => {
    setMgpSyncMsg('Syncing…');
    const result = await mgpTriggerSync();
    setMgpSyncMsg(result.error ? `Error: ${result.error}` : `✅ ${result.synced} races synced`);
    setTimeout(() => setMgpSyncMsg(''), 3000);
  }, [mgpTriggerSync]);

  const handleMgpDisconnect = useCallback(() => {
    Alert.alert('Disconnect MultiGP', 'Remove this chapter connection?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: async () => {
        await mgpDisconnect(); setShowMultiGP(false);
      }},
    ]);
  }, [mgpDisconnect]);

  // ── 🥚 Easter egg handlers ────────────────────────────────────────────────
  const handleAvatarEggTap = useCallback(() => {
    if (eggTapTimer.current) clearTimeout(eggTapTimer.current);
    setEggTapCount(prev => {
      const next = prev + 1;
      if (next >= 7) {
        setEggVisible(true);
        eggSpin.setValue(0);
        // ── Award easter egg props (once ever) ─────────────────────────────────
        if (user?.id) {
          supabase.from('props_log').insert({
            user_id: user.id, amount: 150,
            reason: 'easter_egg', reference_id: user.id,
          }).then(({ error }) => {
            if (!error) propsToast.show('+150 Props! Easter egg found 🥚');
          });
        }
        eggSpinAnim.current = Animated.loop(
          Animated.timing(eggSpin, {
            toValue: 1,
            duration: 2800,
            useNativeDriver: true,
          })
        );
        eggSpinAnim.current.start();
        return 0;
      }
      eggTapTimer.current = setTimeout(() => setEggTapCount(0), 2000);
      return next;
    });
  }, [eggSpin, user?.id, propsToast]);

  const closeEgg = useCallback(() => {
    eggSpinAnim.current?.stop();
    eggSpin.setValue(0);
    setEggVisible(false);
    setEggTapCount(0);
  }, [eggSpin]);

  // ── Render helpers ────────────────────────────────────────────────────────
  const deleteOwnPost = useCallback(async (id: string) => {
    const { error } = await supabase
      .from('posts')
      .delete()
      .eq('id', id)
      .eq('user_id', user?.id ?? '');
    if (error) {
      Alert.alert('Error', 'Could not delete post. Please try again.');
      return false;
    }
    setMyPosts(prev => prev.filter(p => p.id !== id));
    setSelectedPost(prev => (prev?.id === id ? null : prev));
    setShowPostDetail(false);
    return true;
  }, [user?.id]);

  const renderGridCell = useCallback(({ item }: { item: Post }) => (
    <PostGridCell
      item={item}
      onPress={() => { setSelectedPost(item); setShowPostDetail(true); }}
    />
  ), []);

  const renderPostListItem = useCallback(({ item }: { item: Post }) => (
    <View style={styles.profilePostCardWrap}>
      <PostCard
        post={toFeedPost(item)}
        isVisible={true}
        shouldAutoplay={false}
        currentUserId={user?.id ?? undefined}
        onLike={() => {}}
        onDelete={deleteOwnPost}
      />
    </View>
  ), [deleteOwnPost, user?.id]);

  const renderBuild = useCallback(({ item }: { item: Build }) => (
    <View style={styles.buildCard}>
      <View style={styles.buildHeader}>
        <Text style={styles.buildName}>{item.name}</Text>
        <TouchableOpacity onPress={() => deleteBuild(item.id)}>
          <Ionicons name="trash-outline" size={18} color="#e74c3c" />
        </TouchableOpacity>
      </View>
      {(['Frame','Motors','FC','VTX','Camera'] as const)
        .map(k => [k, item[k.toLowerCase() as keyof Build]] as [string, unknown])
        .filter(([, v]) => !!v)
        .map(([label, val]) => (
          <Text key={label} style={styles.buildSpec}>
            <Text style={styles.buildSpecLabel}>{label}: </Text>{val as string}
          </Text>
        ))}
      {item.notes ? <Text style={styles.buildNotes}>{item.notes}</Text> : null}
    </View>
  ), [deleteBuild]);

  if (profileLoading && !profile) {
    return <View style={styles.loadingScreen}><ActivityIndicator size="large" color="#00d4ff" /></View>;
  }

  // ── Tab bar ───────────────────────────────────────────────────────────────
  const TabBar = (
    <View style={styles.tabBar}>
      {TABS.map(tab => {
        const active = activeTab === tab.key;
        return (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tabItem, active && styles.tabItemActive, active && { borderBottomColor: profileAppearance.theme.accentColor, backgroundColor: `${profileAppearance.theme.accentColor}12` }]}
            onPress={() => setActiveTab(tab.key)}
            activeOpacity={0.7}
          >
            <Ionicons name={tab.icon as any} size={16} color={active ? profileAppearance.theme.accentColor : '#555'} />
            <Text style={active ? [styles.tabLabelActive, { color: profileAppearance.theme.accentColor }] : styles.tabLabel}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />

      {/* ── HEADER ──────────────────────────────────────────────────────── */}
      <View style={styles.headerContainer}>
        {/* BANNER */}
        <TouchableOpacity onPress={handleBannerPress} activeOpacity={0.85}>
          <View style={styles.bannerWrap}>
            <ProfileBannerMedia
              imageUrl={profile?.header_image_url}
              videoUrl={profile?.header_video_url}
              height={200}
              startColor={profileAppearance.theme.bannerStartColor}
              endColor={profileAppearance.theme.bannerEndColor}
              emptyHint="Tap to add a banner image or short loop video"
              editable
            />
          </View>
        </TouchableOpacity>

        {/* HEADER ROW */}
        <View style={styles.headerRow}>
          {/* 🥚 Avatar — short press = upload, long press (rapid 7×) = easter egg */}
          <View style={styles.avatarWrap}>
            <ProfileAvatarDecoration
              appearance={profileAppearance}
              avatarUrl={profile?.avatar_url}
              size={84}
              editable
              onPress={uploadAvatar}
              onLongPress={handleAvatarEggTap}
              delayLongPress={120}
              fallbackIconSize={34}
            />
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity style={[styles.editBtn, { borderColor: profileAppearance.theme.accentColor }]} onPress={() => setShowEditProfile(true)}>
              <Text style={[styles.editBtnText, { color: profileAppearance.theme.accentColor }]}>Edit Profile</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.editBtn, { borderColor: profileAppearance.theme.borderColor, paddingHorizontal: 14 }]} onPress={() => router.push('/profile-appearance')}>
              <Text style={[styles.editBtnText, { color: '#fff' }]}>Studio</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.gearBtn} onPress={() => router.push('/settings')}>
              <Ionicons name="settings-outline" size={20} color="#aaa" />
            </TouchableOpacity>
          </View>
        </View>

        {/* BIO */}
        <View style={styles.bioSection}>
          <Text style={[styles.displayName, { color: profileAppearance.theme.textColor }]}>{profile?.username ?? 'FPV Pilot'}</Text>
          {profile?.bio ? <Text style={[styles.bio, { color: profileAppearance.theme.mutedTextColor }]}>{profile.bio}</Text> : null}
          {featuredBadges.length ? (
            <View style={{ marginTop: 12, alignSelf: 'stretch' }}>
              <ProfileBadgeRow
                badges={featuredBadges}
                accentColor={profileAppearance.theme.accentColor}
                borderColor={profileAppearance.theme.borderColor}
                textColor={profileAppearance.theme.textColor}
                mutedTextColor={profileAppearance.theme.mutedTextColor}
              />
            </View>
          ) : null}
          <Animated.View
            style={[
              styles.statsCard,
              {
                opacity: cardOpacity,
                transform: [{ translateY: cardSlideY }],
                backgroundColor: profileAppearance.theme.surfaceColor,
                borderColor: profileAppearance.theme.borderColor,
              },
            ]}
          >
            {/* Posts — count-up, no pulse */}
            <StatBox
              displayValue={myPosts.length}
              label="Posts"
              accentColor="#ffffff"
              animatedValue={countPosts}
            />
            <View style={styles.statDivider} />

            {/* Followers — count-up + pulse on tap */}
            <TouchableOpacity
              style={styles.statItem}
              onPress={() => {
                pulseStat(scaleFollowers, accentFollowers);
                setFollowModal('followers');
              }}
              activeOpacity={0.85}
            >
              <StatBox
                displayValue={followersCount}
                label="Followers"
                tappable
                accentColor={profileAppearance.theme.accentColor}
                animatedValue={countFollowers}
                scaleAnim={scaleFollowers}
                accentAnim={accentFollowers}
              />
            </TouchableOpacity>
            <View style={styles.statDivider} />

            {/* Following — count-up + pulse on tap */}
            <TouchableOpacity
              style={styles.statItem}
              onPress={() => {
                pulseStat(scaleFollowing, accentFollowing);
                setFollowModal('following');
              }}
              activeOpacity={0.85}
            >
              <StatBox
                displayValue={followingCount}
                label="Following"
                tappable
                accentColor={profileAppearance.theme.accentColor}
                animatedValue={countFollowing}
                scaleAnim={scaleFollowing}
                accentAnim={accentFollowing}
              />
            </TouchableOpacity>
            <View style={styles.statDivider} />

            {/* Props — count-up, tappable → history modal */}
            <TouchableOpacity
              onPress={() => { setShowPropsLog(true); loadPropsLog(); }}
              activeOpacity={0.75}
              style={{ flex: 1, alignItems: 'center' }}
            >
              <StatBox
                displayValue={profile?.total_props ?? 0}
                label="Props"
                accentColor="#ffd700"
                animatedValue={countProps}
                renderIcon={(c) => <PropIcon size={15} color={c} focused />}
              />
            </TouchableOpacity>
          </Animated.View>
          <View style={styles.socialRow}>
            {([
              { icon: 'logo-youtube',   url: profile?.youtube_url },
              { icon: 'logo-instagram', url: profile?.instagram_url },
              { icon: 'logo-twitter',   url: profile?.twitter_url },
              { icon: 'logo-tiktok',    url: profile?.tiktok_url },
              { icon: 'globe-outline',  url: profile?.website_url },
            ] as { icon: string; url?: string | null }[]).filter(s => !!s.url).map(s => (
              <TouchableOpacity key={s.icon} style={styles.socialChip}>
                <Ionicons name={s.icon as any} size={18} color={profileAppearance.theme.accentColor} />
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={[styles.socialChip, { borderWidth: 1, borderColor: profileAppearance.theme.borderColor }]} onPress={() => setShowSocialLinks(true)}>
              <Ionicons name="add-circle-outline" size={18} color={profileAppearance.theme.accentColor} />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* ── TAB BAR ─────────────────────────────────────────────────────── */}
      {TabBar}

      {/* ── TAB CONTENT ─────────────────────────────────────────────────── */}
      <ScrollView
        style={styles.contentScroll}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled={true}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={profileAppearance.theme.accentColor} />
        }
      >
        {(dataLoading && !loadedTabsRef.current.has(activeTab)) ? (
          <ActivityIndicator style={{ marginTop: 40 }} color="#00d4ff" />
        ) : (
          <>
            {activeTab === 'posts' && (
              myPosts.length === 0
                ? <EmptyState icon="camera-outline" text="No posts yet" />
                : <FlatList
                    data={myPosts}
                    keyExtractor={i => i.id}
                    renderItem={renderPostListItem}
                    scrollEnabled={false}
                    contentContainerStyle={styles.profilePostsList}
                  />
            )}
            {activeTab === 'media' && (
              mediaPosts.length === 0
                ? <EmptyState icon="images-outline" text="No media yet" />
                : <FlatList data={mediaPosts} keyExtractor={i => i.id} renderItem={renderGridCell} numColumns={3} scrollEnabled={false} columnWrapperStyle={styles.gridRow} />
            )}
            {activeTab === 'builds' && (
              <View>
                {builds.length === 0
                  ? <EmptyState icon="construct-outline" text="No builds logged yet" />
                  : <FlatList data={builds} keyExtractor={i => i.id} renderItem={renderBuild} scrollEnabled={false} contentContainerStyle={{ padding: 12 }} />
                }
                <TouchableOpacity style={styles.fab} onPress={() => setShowCreateBuild(true)}>
                  <Ionicons name="add" size={28} color="#fff" />
                </TouchableOpacity>
              </View>
            )}
            {activeTab === 'boosts' && (
              <View style={{ padding: 12, gap: 10 }}>
                {boostHistory.length === 0 ? (
                  <EmptyState icon="flash-outline" text="No featured boosts yet" />
                ) : (
                  boostHistory.map((b: any) => {
                    const listing = b.marketplace_listings;
                    const img = listing?.listing_images?.find((i: any) => i.is_primary) ?? listing?.listing_images?.[0];
                    const endsAt = new Date(b.ends_at);
                    const now = Date.now();
                    const isActive = endsAt.getTime() > now;
                    const hoursLeft = Math.max(0, Math.ceil((endsAt.getTime() - now) / 3_600_000));
                    const hoursTotal = b.duration_hrs ?? 24;
                    const progress = isActive ? Math.max(0, 1 - hoursLeft / hoursTotal) : 1;
                    return (
                      <View key={b.id} style={{
                        backgroundColor: '#1a1a1a', borderRadius: 12, padding: 12,
                        borderWidth: 1, borderColor: isActive ? '#ffcc0044' : '#333',
                        flexDirection: 'row', gap: 10, alignItems: 'center',
                      }}>
                        {img?.url ? (
                          <Image source={{ uri: img.url }} style={{ width: 56, height: 56, borderRadius: 8 }} />
                        ) : (
                          <View style={{ width: 56, height: 56, borderRadius: 8, backgroundColor: '#333', alignItems: 'center', justifyContent: 'center' }}>
                            <Ionicons name="image-outline" size={22} color="#666" />
                          </View>
                        )}
                        <View style={{ flex: 1, gap: 3 }}>
                          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }} numberOfLines={1}>
                            {listing?.title ?? 'Listing removed'}
                          </Text>
                          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                            {isActive ? (
                              <View style={{ backgroundColor: '#ffcc0022', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: '#ffcc0066' }}>
                                <Text style={{ color: '#ffcc00', fontSize: 10, fontWeight: '700' }}>⚡ ACTIVE</Text>
                              </View>
                            ) : (
                              <View style={{ backgroundColor: '#33333388', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                                <Text style={{ color: '#666', fontSize: 10, fontWeight: '700' }}>EXPIRED</Text>
                              </View>
                            )}
                            <Text style={{ color: '#888', fontSize: 11 }}>
                              {b.props_spent
                                ? `🌀 ${(b.props_spent).toLocaleString()} props`
                                : b.amount_usd
                                ? `💳 $${Number(b.amount_usd).toFixed(2)}`
                                : '🌀 Props'}
                            </Text>
                          </View>
                          {/* Progress bar */}
                          <View style={{ height: 3, backgroundColor: '#333', borderRadius: 2, marginTop: 2 }}>
                            <View style={{ height: 3, backgroundColor: isActive ? '#ffcc00' : '#444', borderRadius: 2, width: `${Math.round(progress * 100)}%` }} />
                          </View>
                          <Text style={{ color: '#666', fontSize: 10 }}>
                            {isActive
                              ? `⏱ ${hoursLeft}h remaining of ${hoursTotal}h`
                              : `Ended ${endsAt.toLocaleDateString()}`}
                          </Text>
                        </View>
                      </View>
                    );
                  })
                )}
              </View>
            )}
            {activeTab === 'listings' && (
              <View style={{ padding: 12, gap: 10 }}>
                {myListings.length === 0 ? (
                  <EmptyState icon="pricetag-outline" text="No active listings" />
                ) : (
                  myListings.map((l: any) => {
                    const img = l.listing_images?.find((i: any) => i.is_primary) ?? l.listing_images?.[0];
                    const statusColor = l.status === 'active' ? '#22c55e' : '#ffcc00';
                    return (
                      <TouchableOpacity
                        key={l.id}
                        style={{ backgroundColor: '#1a1a1a', borderRadius: 12, padding: 12, flexDirection: 'row', gap: 12, alignItems: 'center', borderWidth: 1, borderColor: '#2a2a2a' }}
                        activeOpacity={0.8}
                        onPress={() => router.push({ pathname: '/listing/[id]', params: { id: l.id } })}
                      >
                        {img?.url ? (
                          <Image source={{ uri: img.url }} style={{ width: 60, height: 60, borderRadius: 8 }} />
                        ) : (
                          <View style={{ width: 60, height: 60, borderRadius: 8, backgroundColor: '#333', alignItems: 'center', justifyContent: 'center' }}>
                            <Ionicons name="image-outline" size={24} color="#666" />
                          </View>
                        )}
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }} numberOfLines={1}>{l.title}</Text>
                          <Text style={{ color: '#ff4500', fontWeight: '700', fontSize: 13, marginTop: 2 }}>${parseFloat(l.price ?? 0).toFixed(2)}</Text>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                            <View style={{ backgroundColor: statusColor + '22', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: statusColor + '66' }}>
                              <Text style={{ color: statusColor, fontSize: 10, fontWeight: '700' }}>{l.status === 'pending_sale' ? 'OFFER ACCEPTED' : 'ACTIVE'}</Text>
                            </View>
                          </View>
                        </View>
                        <Ionicons name="chevron-forward" size={18} color="#555" />
                      </TouchableOpacity>
                    );
                  })
                )}
              </View>
            )}
            {activeTab === 'saved' && (
              <View style={{ padding: 12, gap: 10 }}>
                {savedListings.length === 0 ? (
                  <EmptyState icon="bookmark-outline" text="No saved listings" />
                ) : (
                  savedListings.map((l: any) => {
                    const img = l.listing_images?.find((i: any) => i.is_primary) ?? l.listing_images?.[0];
                    return (
                      <TouchableOpacity
                        key={l.id}
                        style={{ backgroundColor: '#1a1a1a', borderRadius: 12, padding: 12, flexDirection: 'row', gap: 12, alignItems: 'center', borderWidth: 1, borderColor: '#2a2a2a' }}
                        activeOpacity={0.8}
                        onPress={() => router.push({ pathname: '/listing/[id]', params: { id: l.id } })}
                      >
                        {img?.url ? (
                          <Image source={{ uri: img.url }} style={{ width: 60, height: 60, borderRadius: 8 }} />
                        ) : (
                          <View style={{ width: 60, height: 60, borderRadius: 8, backgroundColor: '#333', alignItems: 'center', justifyContent: 'center' }}>
                            <Ionicons name="image-outline" size={24} color="#666" />
                          </View>
                        )}
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }} numberOfLines={1}>{l.title}</Text>
                          <Text style={{ color: '#ff4500', fontWeight: '700', fontSize: 13, marginTop: 2 }}>${parseFloat(l.price ?? 0).toFixed(2)}</Text>
                          <Text style={{ color: '#666', fontSize: 11, marginTop: 2 }}>{l.condition?.replace('_', ' ').toUpperCase()}</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={18} color="#555" />
                      </TouchableOpacity>
                    );
                  })
                )}
              </View>
            )}
          </>
        )}
        <View style={{ height: 100 }} />
      </ScrollView>

      {/* ── POST DETAIL MODAL ─────────────────────────────────────────────── */}
      <Modal visible={showPostDetail} animationType="slide" presentationStyle="overFullScreen" onRequestClose={() => setShowPostDetail(false)}>
        <View style={styles.detailRoot}>
          <View style={styles.detailHeader}>
            <TouchableOpacity onPress={() => setShowPostDetail(false)}><Ionicons name="arrow-back" size={24} color="#fff" /></TouchableOpacity>
            <Text style={styles.detailTitle}>Post</Text>
            <View style={{ width: 24 }} />
          </View>
          <ScrollView>
            {selectedPost && (
              <PostCard post={toFeedPost(selectedPost)} isVisible={true} shouldAutoplay={false}
                currentUserId={user?.id ?? undefined} onLike={() => {}}
                onDelete={deleteOwnPost} />
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* ── SETTINGS MODAL ────────────────────────────────────────────────── */}
      <Modal visible={showSettings} animationType="slide" presentationStyle="overFullScreen" onRequestClose={() => setShowSettings(false)}>
        <View style={styles.modalRoot}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Settings</Text>
            <TouchableOpacity onPress={() => setShowSettings(false)}><Ionicons name="close" size={26} color="#fff" /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody}>

            <View style={styles.settingsSection}>
              <Text style={styles.settingsSectionTitle}>Account</Text>
              <View style={styles.settingsRow}><Text style={styles.settingsLabel}>Email</Text><Text style={styles.settingsValue}>{user?.email ?? '—'}</Text></View>
              <View style={styles.settingsRow}><Text style={styles.settingsLabel}>Username</Text><Text style={styles.settingsValue}>{profile?.username ?? '—'}</Text></View>
            </View>

            <View style={styles.settingsSection}>
              <Text style={styles.settingsSectionTitle}>Preferences</Text>
              <View style={styles.settingsRow}>
                <Text style={styles.settingsLabel}>Autoplay Videos</Text>
                <Switch value={profile?.autoplay_videos ?? true} onValueChange={(val: boolean) => { void updateProfile({ autoplay_videos: val }); }} trackColor={{ true: '#00d4ff', false: '#333' }} thumbColor="#fff" />
              </View>
            </View>


            <View style={styles.settingsSection}>
              <Text style={styles.settingsSectionTitle}>Privacy</Text>
              <TouchableOpacity style={styles.settingsRow} onPress={() => { setShowSettings(false); setTimeout(() => setShowMuteList(true), 350); }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Ionicons name="volume-mute-outline" size={20} color="#aaa" />
                  <View>
                    <Text style={styles.settingsLabel}>Muted Users</Text>
                    {mutedUsers.length > 0 && <Text style={[styles.settingsValue, { fontSize: 11 }]}>{mutedUsers.length} muted</Text>}
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#555" />
              </TouchableOpacity>
            </View>

            <View style={styles.settingsSection}>
              <Text style={styles.settingsSectionTitle}>Marketplace</Text>

              {/* My Orders */}
              <TouchableOpacity style={styles.settingsRow} onPress={() => { setShowSettings(false); setTimeout(() => router.push('/orders'), 350); }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Ionicons name="bag-outline" size={20} color="#aaa" />
                  <Text style={styles.settingsLabel}>My Orders</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#555" />
              </TouchableOpacity>

              {/* Seller Payouts (Stripe Connect) */}
              <View style={[styles.settingsRow, { borderTopWidth: 1, borderTopColor: '#2a2a4a', marginTop: 4, paddingTop: 10 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="card-outline" size={20} color={stripeProfile?.stripe_onboarded ? '#22c55e' : '#f59e0b'} />
                  <View>
                    <Text style={styles.settingsLabel}>Seller Payouts</Text>
                    <Text style={[styles.settingsValue, { fontSize: 11, color: stripeProfile?.stripe_onboarded ? '#4caf50' : '#f59e0b' }]}>
                      {stripeLoading ? 'Loading…'
                        : stripeProfile?.stripe_onboarded
                          ? `● Active — ${stripeProfile.total_sales} sale${stripeProfile.total_sales !== 1 ? 's' : ''}`
                          : stripeProfile?.stripe_account_id
                            ? '⚠ Incomplete — tap to finish setup'
                            : '○ Not set up — sellers need this to get paid'}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={[styles.ytAuthBtn,
                    stripeProfile?.stripe_onboarded ? styles.ytAuthBtnUnlink : styles.ytAuthBtnLink,
                    { backgroundColor: stripeProfile?.stripe_onboarded ? '#1a1a2e' : '#0057d9' }]}
                  onPress={stripeProfile?.stripe_onboarded ? stripeCheckStatus : stripeStartOnboarding}
                  disabled={stripeOnboarding || stripeChecking || stripeLoading}
                >
                  {stripeOnboarding || stripeChecking
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={styles.ytAuthBtnText}>
                        {stripeProfile?.stripe_onboarded ? 'View' : stripeProfile?.stripe_account_id ? 'Continue' : 'Set Up'}
                      </Text>
                  }
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.settingsSection}>
              <Text style={styles.settingsSectionTitle}>Connected Accounts</Text>
              <TouchableOpacity style={styles.settingsRow} onPress={() => { setShowSettings(false); setTimeout(() => setShowSocialLinks(true), 350); }}>
                <Text style={styles.settingsLabel}>Social Links</Text>
                <Ionicons name="chevron-forward" size={18} color="#555" />
              </TouchableOpacity>

              {/* YouTube */}
              <View style={[styles.settingsRow, { borderTopWidth: 1, borderTopColor: '#2a2a4a', marginTop: 4, paddingTop: 10 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="logo-youtube" size={20} color="#FF0000" />
                  <View>
                    <Text style={styles.settingsLabel}>YouTube Account</Text>
                    <Text style={[styles.settingsValue, { fontSize: 11, color: ytLinked ? '#4caf50' : '#888' }]}>
                      {ytLinked ? '● Connected — Like & Subscribe enabled' : '○ Not connected'}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity style={[styles.ytAuthBtn, ytLinked ? styles.ytAuthBtnUnlink : styles.ytAuthBtnLink]} onPress={ytLinked ? unlinkYouTube : () => promptYouTubeAuth()} disabled={ytAuthLoading}>
                  {ytAuthLoading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.ytAuthBtnText}>{ytLinked ? 'Unlink' : 'Connect'}</Text>}
                </TouchableOpacity>
              </View>

              {/* MultiGP */}
              <View style={[styles.settingsRow, { borderTopWidth: 1, borderTopColor: '#2a2a4a', marginTop: 4, paddingTop: 10 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="radio-outline" size={20} color="#ff4500" />
                  <View>
                    <Text style={styles.settingsLabel}>MultiGP Chapter</Text>
                    <Text style={[styles.settingsValue, { fontSize: 11, color: mgpConnection?.is_active ? '#4caf50' : '#888' }]}>
                      {mgpConnection ? (mgpConnection.is_active ? `● ${mgpConnection.chapter_name ?? 'Connected'}` : `○ ${mgpConnection.chapter_name ?? 'Paused'}`) : '○ Not connected'}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity style={[styles.ytAuthBtn, mgpConnection ? styles.ytAuthBtnUnlink : styles.ytAuthBtnLink]} onPress={() => { setShowSettings(false); setTimeout(() => setShowMultiGP(true), 350); }} disabled={mgpLoading}>
                  {mgpLoading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.ytAuthBtnText}>{mgpConnection ? 'Manage' : 'Connect'}</Text>}
                </TouchableOpacity>
              </View>
            </View>

            {isAdmin && (
              <TouchableOpacity
                style={styles.adminBtn}
                onPress={() => router.push('/(tabs)/admin')}
              >
                <Ionicons name="shield-checkmark-outline" size={18} color="#FF9800" />
                <Text style={styles.adminBtnTxt}>🛡 Map Moderation</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.signOutBtn} onPress={signOut}>
              <Ionicons name="log-out-outline" size={18} color="#e74c3c" />
              <Text style={styles.signOutText}>Sign Out</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      {/* ── MULTIGP MODAL ─────────────────────────────────────────────────── */}
      <Modal visible={showMultiGP} animationType="slide" presentationStyle="overFullScreen" onRequestClose={() => setShowMultiGP(false)}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>MultiGP Chapter</Text>
            <TouchableOpacity onPress={() => setShowMultiGP(false)}><Ionicons name="close" size={26} color="#fff" /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody}>
            {mgpConnection ? (
              <View>
                <View style={styles.mgpConnectedCard}>
                  <Ionicons name="radio" size={32} color="#ff4500" />
                  <View style={{ marginLeft: 12, flex: 1 }}>
                    <Text style={styles.mgpChapterName}>{mgpConnection.chapter_name ?? 'Chapter Connected'}</Text>
                    <Text style={styles.mgpChapterId}>{mgpConnection.chapter_id ? `ID: ${mgpConnection.chapter_id}` : ''}</Text>
                    {mgpConnection.last_synced_at && <Text style={styles.mgpLastSync}>Last sync: {new Date(mgpConnection.last_synced_at).toLocaleString()}</Text>}
                  </View>
                </View>
                {mgpSyncMsg ? <Text style={styles.mgpSyncMsg}>{mgpSyncMsg}</Text> : null}
                <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: '#ff4500', marginTop: 16 }]} onPress={handleMgpSync} disabled={mgpSyncing}>
                  {mgpSyncing ? <ActivityIndicator size="small" color="#fff" /> : <><Ionicons name="sync-outline" size={16} color="#fff" style={{ marginRight: 6 }} /><Text style={[styles.primaryBtnText, { color: '#fff' }]}>Sync Now</Text></>}
                </TouchableOpacity>
                <View style={[styles.settingsRow, { marginTop: 16 }]}>
                  <Text style={styles.settingsLabel}>Auto-sync enabled</Text>
                  <Switch value={mgpConnection.is_active} onValueChange={mgpToggleActive} trackColor={{ true: '#ff4500', false: '#333' }} thumbColor="#fff" />
                </View>
                <TouchableOpacity style={[styles.signOutBtn, { marginTop: 24 }]} onPress={handleMgpDisconnect}>
                  <Ionicons name="unlink-outline" size={18} color="#e74c3c" />
                  <Text style={styles.signOutText}>Disconnect Chapter</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View>
                <Text style={styles.mgpInstructions}>Enter your MultiGP Timing System API key to link your chapter. Upcoming races will auto-sync to the map.</Text>
                <Text style={styles.mgpHint}>Find your key at multigp.com → Chapter Dashboard → Settings → Timing System Key</Text>
                <TouchableOpacity style={styles.mgpHelpLink} onPress={() => setShowMgpHelp(prev => !prev)}>
                  <Ionicons name="help-circle-outline" size={15} color="#00d4ff" />
                  <Text style={styles.mgpHelpLinkText}>{showMgpHelp ? 'Hide instructions ▲' : 'How do I find my API key? ▼'}</Text>
                </TouchableOpacity>
                {showMgpHelp && (
                  <View style={styles.mgpHelpBox}>
                    <Text style={styles.mgpHelpTitle}>📡 How to Get Your MultiGP API Key</Text>
                    <Text style={styles.mgpHelpStep}><Text style={styles.mgpHelpNum}>1. </Text>Go to <Text style={styles.mgpHelpBold}>multigp.com</Text> and sign in as a Chapter Organizer</Text>
                    <Text style={styles.mgpHelpStep}><Text style={styles.mgpHelpNum}>2. </Text>Click your chapter name in the top navigation bar</Text>
                    <Text style={styles.mgpHelpStep}><Text style={styles.mgpHelpNum}>3. </Text>Select <Text style={styles.mgpHelpBold}>Chapter Dashboard</Text> from the dropdown</Text>
                    <Text style={styles.mgpHelpStep}><Text style={styles.mgpHelpNum}>4. </Text>Click <Text style={styles.mgpHelpBold}>Chapter Configuration</Text> or <Text style={styles.mgpHelpBold}>Settings</Text> in the left menu</Text>
                    <Text style={styles.mgpHelpStep}><Text style={styles.mgpHelpNum}>5. </Text>Look for <Text style={styles.mgpHelpBold}>Timing System Key</Text> — copy and paste it below</Text>
                    <Text style={styles.mgpHelpNote}>⚠️ Only Chapter Organizers can access this key.</Text>
                    <TouchableOpacity style={styles.mgpHelpClose} onPress={() => setShowMgpHelp(false)}><Text style={styles.mgpHelpCloseText}>Got it ✓</Text></TouchableOpacity>
                  </View>
                )}
                <Text style={styles.inputLabel}>Timing System API Key</Text>
                <TextInput style={styles.input} value={mgpKeyInput} onChangeText={t => { setMgpKeyInput(t); setMgpValidResult(null); }} placeholder="Paste your API key here" placeholderTextColor="#555" autoCapitalize="none" autoCorrect={false} />
                {mgpValidResult && (
                  <View style={[styles.mgpValidResult, { borderColor: mgpValidResult.valid ? '#4caf50' : '#e74c3c' }]}>
                    <Ionicons name={mgpValidResult.valid ? 'checkmark-circle' : 'close-circle'} size={18} color={mgpValidResult.valid ? '#4caf50' : '#e74c3c'} />
                    <Text style={[styles.mgpValidText, { color: mgpValidResult.valid ? '#4caf50' : '#e74c3c' }]}>
                      {mgpValidResult.valid ? `✅ ${mgpValidResult.chapterName ?? 'Valid key'}` : mgpValidResult.error ?? 'Invalid key'}
                    </Text>
                  </View>
                )}
                <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: '#1e1e3a', marginTop: 12 }]} onPress={handleMgpValidate} disabled={mgpValidating}>
                  {mgpValidating ? <ActivityIndicator size="small" color="#00d4ff" /> : <Text style={[styles.primaryBtnText, { color: '#00d4ff' }]}>Validate Key</Text>}
                </TouchableOpacity>
                {mgpValidResult?.valid && (
                  <TouchableOpacity style={[styles.primaryBtn, { marginTop: 10 }]} onPress={handleMgpConnect} disabled={mgpSaving}>
                    {mgpSaving ? <ActivityIndicator size="small" color="#000" /> : <Text style={styles.primaryBtnText}>Connect Chapter</Text>}
                  </TouchableOpacity>
                )}
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── EDIT PROFILE MODAL ────────────────────────────────────────────── */}
      <Modal visible={showEditProfile} animationType="slide" presentationStyle="overFullScreen" onRequestClose={() => setShowEditProfile(false)}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Edit Profile</Text>
            <TouchableOpacity onPress={() => setShowEditProfile(false)}><Ionicons name="close" size={26} color="#fff" /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody}>
            <Text style={styles.inputLabel}>Username</Text>
            <TextInput style={[styles.input, usernameError ? styles.inputError : undefined]} value={editUsername} onChangeText={t => { setEditUsername(t); setUsernameError(''); }} placeholder="username" placeholderTextColor="#555" autoCapitalize="none" />
            {usernameError ? <Text style={styles.errorText}>{usernameError}</Text> : null}
            <Text style={styles.inputLabel}>Bio</Text>
            <TextInput style={[styles.input, { height: 90 }]} value={editBio} onChangeText={setEditBio} placeholder="Tell the community about yourself…" placeholderTextColor="#555" multiline maxLength={200} />
            <Text style={styles.charCount}>{editBio.length}/200</Text>
            <TouchableOpacity style={[styles.primaryBtn, updating ? styles.primaryBtnDisabled : undefined]} onPress={saveProfile} disabled={updating}>
              {updating ? <ActivityIndicator size="small" color="#000" /> : <Text style={styles.primaryBtnText}>Save Changes</Text>}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── SOCIAL LINKS MODAL ────────────────────────────────────────────── */}
      <Modal visible={showSocialLinks} animationType="slide" presentationStyle="overFullScreen" onRequestClose={() => setShowSocialLinks(false)}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Social Links</Text>
            <TouchableOpacity onPress={() => setShowSocialLinks(false)}><Ionicons name="close" size={26} color="#fff" /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody}>
            {([
              { label: 'YouTube',    icon: 'logo-youtube',   val: editYoutube,   set: setEditYoutube   },
              { label: 'Instagram',  icon: 'logo-instagram', val: editInstagram, set: setEditInstagram },
              { label: 'Twitter/X',  icon: 'logo-twitter',   val: editTwitter,   set: setEditTwitter   },
              { label: 'TikTok',     icon: 'logo-tiktok',    val: editTiktok,    set: setEditTiktok    },
              { label: 'Website',    icon: 'globe-outline',  val: editWebsite,   set: setEditWebsite   },
            ] as { label: string; icon: string; val: string; set: (v: string) => void }[]).map(({ label, icon, val, set }) => (
              <View key={label}>
                <Text style={styles.inputLabel}>{label}</Text>
                <View style={styles.socialInputRow}>
                  <Ionicons name={icon as any} size={20} color="#00d4ff" style={{ marginRight: 8 }} />
                  <TextInput style={[styles.input, { flex: 1 }]} value={val} onChangeText={set} placeholder="https://…" placeholderTextColor="#555" autoCapitalize="none" keyboardType="url" />
                </View>
              </View>
            ))}
            <TouchableOpacity style={[styles.primaryBtn, updating ? styles.primaryBtnDisabled : undefined]} onPress={saveSocials} disabled={updating}>
              {updating ? <ActivityIndicator size="small" color="#000" /> : <Text style={styles.primaryBtnText}>Save Links</Text>}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── CREATE BUILD MODAL ────────────────────────────────────────────── */}
      <Modal visible={showCreateBuild} animationType="slide" presentationStyle="overFullScreen" onRequestClose={() => setShowCreateBuild(false)}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>New Build</Text>
            <TouchableOpacity onPress={() => setShowCreateBuild(false)}><Ionicons name="close" size={26} color="#fff" /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody}>
            {([
              { label: 'Build Name *', val: buildName,   set: setBuildName,   ph: 'e.g. Race Day 5"'         },
              { label: 'Frame',        val: buildFrame,  set: setBuildFrame,  ph: 'e.g. ImpulseRC Apex'      },
              { label: 'Motors',       val: buildMotors, set: setBuildMotors, ph: 'e.g. iFlight 2306 2450kv' },
              { label: 'FC',           val: buildFC,     set: setBuildFC,     ph: 'e.g. Betaflight F7'       },
              { label: 'VTX',          val: buildVTX,    set: setBuildVTX,    ph: 'e.g. Rush Tank Ultimate'  },
              { label: 'Camera',       val: buildCamera, set: setBuildCamera, ph: 'e.g. Caddx Ratel 2'       },
            ] as { label: string; val: string; set: (v: string) => void; ph: string }[]).map(({ label, val, set, ph }) => (
              <View key={label}>
                <Text style={styles.inputLabel}>{label}</Text>
                <TextInput style={styles.input} value={val} onChangeText={set} placeholder={ph} placeholderTextColor="#555" />
              </View>
            ))}
            <Text style={styles.inputLabel}>Notes</Text>
            <TextInput style={[styles.input, { height: 80 }]} value={buildNotes} onChangeText={setBuildNotes} placeholder="Tune notes, issues, mods…" placeholderTextColor="#555" multiline />
            <TouchableOpacity style={styles.primaryBtn} onPress={createBuild}><Text style={styles.primaryBtnText}>Add Build</Text></TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── 🥚 EASTER EGG MODAL ───────────────────────────────────────────── */}
      <Modal
        visible={eggVisible}
        animationType="fade"
        transparent={true}
        onRequestClose={closeEgg}
      >
        <View style={styles.eggOverlay}>
          <View style={styles.eggCard}>

            {/* Spinning drone */}
            <Animated.View style={{
              transform: [{
                rotate: eggSpin.interpolate({
                  inputRange:  [0, 1],
                  outputRange: ['0deg', '360deg'],
                }),
              }],
              marginBottom: 16,
            }}>
              <Ionicons name="airplane" size={58} color="#00d4ff" />
            </Animated.View>

            {/* Title */}
            <Text style={styles.eggTitle}>🥚 You found it.</Text>

            {/* Signature */}
            <View style={styles.eggSigBlock}>
              <Text style={styles.eggSigLine}>Built by</Text>
              <Text style={styles.eggSigName}>HypnosFPV</Text>
              <Text style={styles.eggSigSub}>FPV Enthusiast App</Text>
            </View>

            {/* Notes */}
            <View style={styles.eggMeta}>
              <Text style={styles.eggMetaText}>☕  Crafted with caffeine & carbon fiber</Text>
              <Text style={styles.eggMetaText}>📡  Powered by Expo + Supabase</Text>
              <Text style={styles.eggMetaText}>🏁  Keep flying. Always throttle up.</Text>
            </View>

            {/* Close */}
            <TouchableOpacity style={styles.eggCloseBtn} onPress={closeEgg} activeOpacity={0.8}>
              <Text style={styles.eggCloseBtnText}>Back to the skies ✈️</Text>
            </TouchableOpacity>

          </View>
        </View>
      </Modal>

      {/* ── FOLLOW / MUTE MODALS ──────────────────────────────────────────── */}
      {user && <FollowListModal visible={followModal !== null} type={followModal ?? 'followers'} profileUserId={user.id} currentUserId={user.id} onClose={() => setFollowModal(null)} />}
      <MuteListModal visible={showMuteList} onClose={() => setShowMuteList(false)} mutedUsers={mutedUsers} loading={muteLoading} onUnmute={async (userId) => { await unmuteUser(userId); }} />
      {/* ── Props History Modal ──────────────────────────────────────────── */}
      <Modal
        visible={showPropsLog}
        animationType="slide"
        transparent
        onRequestClose={() => setShowPropsLog(false)}
      >
        <View style={styles.plOverlay}>
          <View style={styles.plSheet}>
            {/* Header */}
            <View style={styles.plHeader}>
              <PropIcon size={18} color="#ffd700" focused />
              <Text style={styles.plTitle}>Props History</Text>
              <TouchableOpacity onPress={() => setShowPropsLog(false)} hitSlop={{ top:10,bottom:10,left:10,right:10 }}>
                <Ionicons name="close" size={22} color="#aaa" />
              </TouchableOpacity>
            </View>
            <Text style={styles.plTotal}>
              All-time earned: {(profile?.lifetime_props || profile?.earned_props || profile?.total_props || 0).toLocaleString()} props
            </Text>
            <Text style={[styles.plTotal, { color: '#888', fontSize: 11, marginTop: 2, marginBottom: 4 }]}>
              Spendable balance: {(profile?.total_props ?? 0).toLocaleString()} props
            </Text>
            {/* List */}
            {propsLogLoading ? (
              <ActivityIndicator color="#ffd700" style={{ marginTop: 24 }} />
            ) : propsLog.length === 0 ? (
              <View style={styles.plEmpty}>
                <PropIcon size={36} color="#333" />
                <Text style={styles.plEmptyText}>No props earned yet.{`\n`}Complete actions to earn props!</Text>
              </View>
            ) : (
              <FlatList
                data={propsLog}
                keyExtractor={item => item.id}
                contentContainerStyle={{ paddingBottom: 24 }}
                renderItem={({ item }) => {
                  const label = formatPropsHistoryLabel(item);
                  const date  = new Date(item.created_at).toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' });
                  const isSpend = (item as any).isSpend === true || item.amount < 0;
                  return (
                    <View style={styles.plRow}>
                      <View style={styles.plRowLeft}>
                        <Text style={[styles.plRowLabel, isSpend && { color: '#ffaaaa' }]}>{label}</Text>
                        <Text style={styles.plRowDate}>{date}</Text>
                      </View>
                      <Text style={[styles.plRowAmount, isSpend && { color: '#ff6666', fontSize: 16 }]}>
                        {isSpend ? item.amount.toLocaleString() : `+${item.amount.toLocaleString()}`}
                      </Text>
                    </View>
                  );
                }}
              />
            )}
          </View>
        </View>
      </Modal>

      {/* Props award toast */}
      <PropsToast toast={propsToast} />

    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:          { flex: 1, backgroundColor: '#0a0a1a' },
  loadingScreen: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0a0a1a' },
  emptyState:    { alignItems: 'center', paddingTop: 60, paddingBottom: 40 },
  emptyText:     { color: '#444', fontSize: 14, marginTop: 12 },

  headerContainer: {},
  contentScroll:   { flex: 1 },

  bannerWrap:        { width: '100%', height: 200, overflow: 'hidden', backgroundColor: '#111' },
  banner:            { width: '100%', height: 200 },
  bannerPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  bannerHint:        { color: '#444', fontSize: 12, marginTop: 6 },

  headerRow:         { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: 16, marginTop: -20, marginBottom: 10 },
  avatarWrap:        { position: 'relative' },
  avatar:            { width: 84, height: 84, borderRadius: 42, borderWidth: 3, borderColor: '#0a0a1a' },
  avatarPlaceholder: { backgroundColor: '#1e1e3a', justifyContent: 'center', alignItems: 'center' },
  cameraBadge:       { position: 'absolute', bottom: 2, right: 2, backgroundColor: '#00d4ff', borderRadius: 10, width: 20, height: 20, justifyContent: 'center', alignItems: 'center' },
  headerActions:     { flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 10 },
  editBtn:           { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: '#00d4ff' },
  editBtnText:       { color: '#00d4ff', fontWeight: '600', fontSize: 13 },
  gearBtn:           { padding: 4 },

  bioSection:  { paddingHorizontal: 16, paddingBottom: 12 },
  displayName: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 4 },
  bio:         { color: '#aaa', fontSize: 13, lineHeight: 18, marginBottom: 10 },

  // ── Premium stats card ──────────────────────────────────────────────────
  statsCard: {
    flexDirection: 'row',
    backgroundColor: '#0d1117',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1e2a3a',
    marginVertical: 14,
    overflow: 'hidden',
  },
  statItem: {
    flex: 1,
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  statTopAccent: {
    width: 28,
    height: 2,
    borderRadius: 2,
    marginBottom: 9,
  },
  statValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  statLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 5,
  },
  statLabel: {
    color: '#4a5568',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.0,
    textTransform: 'uppercase',
  },
  statDivider: {
    width: 1,
    backgroundColor: '#1e2a3a',
    marginVertical: 10,
  },

  socialRow:      { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4, gap: 8 },
  socialChip:     { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1e1e3a', justifyContent: 'center', alignItems: 'center' },
  socialInputRow: { flexDirection: 'row', alignItems: 'center' },

  tabBar: {
    flexDirection: 'row',
    width: W,
    height: TAB_BAR_H,
    backgroundColor: '#0d0d1f',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#1e1e3a',
  },
  tabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabItemActive:  { borderBottomColor: '#00d4ff', backgroundColor: 'rgba(0,212,255,0.06)' },
  tabLabel:       { color: '#555', fontSize: 11, fontWeight: '600' },
  tabLabelActive: { color: '#00d4ff', fontSize: 11, fontWeight: '700' },

  feedList: { paddingHorizontal: 12 },
  profilePostsList: { paddingHorizontal: 12, gap: 10 },
  profilePostCardWrap: { marginBottom: 2 },

  gridRow:              { gap: 2 },
  gridCell:             { width: CELL, height: CELL, backgroundColor: '#1a1a2e', overflow: 'hidden', position: 'relative', margin: 1 },
  gridThumb:            { width: '100%', height: '100%' },
  gridThumbPlaceholder: { justifyContent: 'center', alignItems: 'center', backgroundColor: '#111' },
  gridTextPlaceholder:  { justifyContent: 'space-between', backgroundColor: '#111827', padding: 10 },
  gridTextBadge:        { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(20,35,60,0.9)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  gridTextBadgeLabel:   { color: '#9cc8ff', fontSize: 9, fontWeight: '700' },
  gridTextPreview:      { color: '#e5eefc', fontSize: 11, lineHeight: 15, fontWeight: '600' },
  gridIgPlaceholder:    { justifyContent: 'center', alignItems: 'center', backgroundColor: '#C13584', gap: 3 },
  gridIgText:           { color: '#fff', fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  gridIgSub:            { color: 'rgba(255,255,255,0.75)', fontSize: 8, fontWeight: '500' },
  gridPlayBadge:        { position: 'absolute', top: '50%', left: '50%', transform: [{ translateX: -11 }, { translateY: -11 }] },
  gridYtBadge:          { position: 'absolute', bottom: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 4, padding: 3 },
  gridIgBadge:          { position: 'absolute', bottom: 4, right: 4, backgroundColor: 'rgba(193,53,132,0.85)', borderRadius: 4, padding: 3 },

  buildCard:      { backgroundColor: '#1a1a2e', borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#2a2a4a' },
  buildHeader:    { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  buildName:      { color: '#fff', fontWeight: '700', fontSize: 15 },
  buildSpec:      { color: '#ccc', fontSize: 13, lineHeight: 20 },
  buildSpecLabel: { color: '#00d4ff', fontWeight: '600' },
  buildNotes:     { color: '#888', fontSize: 12, marginTop: 6, fontStyle: 'italic' },

  fab: { alignSelf: 'flex-end', margin: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: '#00d4ff', justifyContent: 'center', alignItems: 'center', shadowColor: '#00d4ff', shadowOpacity: 0.5, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 8 },

  detailRoot:   { flex: 1, backgroundColor: '#0a0a1a' },
  detailHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 54 : 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#1e1e3a' },
  detailTitle:  { color: '#fff', fontWeight: '700', fontSize: 16 },

  modalRoot:   { flex: 1, backgroundColor: '#0a0a1a' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 54 : 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#1e1e3a' },
  modalTitle:  { color: '#fff', fontWeight: '700', fontSize: 18 },
  modalBody:   { padding: 16, paddingBottom: 40 },

  settingsSection:      { marginBottom: 24 },
  settingsSectionTitle: { color: '#00d4ff', fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 8 },
  settingsRow:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 },
  settingsLabel:        { color: '#ccc', fontSize: 14 },
  settingsValue:        { color: '#888', fontSize: 13 },

  inputLabel: { color: '#aaa', fontSize: 12, fontWeight: '600', marginBottom: 6, marginTop: 14 },
  input:      { backgroundColor: '#1a1a2e', borderWidth: 1, borderColor: '#2a2a4a', borderRadius: 10, color: '#fff', paddingHorizontal: 14, paddingVertical: 10, fontSize: 14 },
  inputError: { borderColor: '#e74c3c' },
  errorText:  { color: '#e74c3c', fontSize: 12, marginTop: 4 },
  charCount:  { color: '#555', fontSize: 11, textAlign: 'right', marginTop: 4 },

  primaryBtn:         { backgroundColor: '#00d4ff', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 20, flexDirection: 'row', justifyContent: 'center' },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText:     { color: '#000', fontWeight: '700', fontSize: 15 },

  ytAuthBtn:       { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16 },
  ytAuthBtnLink:   { backgroundColor: '#1e3a1e', borderWidth: 1, borderColor: '#4caf50' },
  ytAuthBtnUnlink: { backgroundColor: '#3a1e1e', borderWidth: 1, borderColor: '#e74c3c' },
  ytAuthBtnText:   { color: '#fff', fontSize: 12, fontWeight: '600' },

  adminBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, marginTop: 8, borderRadius: 12, borderWidth: 1, borderColor: '#3d2b00', backgroundColor: '#1a1100' },
  adminBtnTxt:{ color: '#FF9800', fontWeight: '700', fontSize: 14 },
  signOutBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, marginTop: 8, borderRadius: 12, borderWidth: 1, borderColor: '#3a1e1e', backgroundColor: '#1a0a0a' },
  signOutText: { color: '#e74c3c', fontWeight: '600', fontSize: 14 },

  mgpConnectedCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a2e', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#ff4500' },
  mgpChapterName:   { color: '#fff', fontWeight: '700', fontSize: 16 },
  mgpChapterId:     { color: '#888', fontSize: 12, marginTop: 2 },
  mgpLastSync:      { color: '#666', fontSize: 11, marginTop: 4 },
  mgpSyncMsg:       { textAlign: 'center', color: '#00d4ff', fontSize: 13, marginTop: 12, fontWeight: '600' },
  mgpInstructions:  { color: '#ccc', fontSize: 14, lineHeight: 20, marginBottom: 8 },
  mgpHint:          { color: '#666', fontSize: 12, lineHeight: 18, marginBottom: 4, fontStyle: 'italic' },
  mgpValidResult:   { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 8, borderWidth: 1, marginTop: 8, backgroundColor: '#0f0f1a' },
  mgpValidText:     { fontSize: 13, fontWeight: '600', flex: 1 },
  mgpHelpLink:      { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 12, marginTop: 4 },
  mgpHelpLinkText:  { color: '#00d4ff', fontSize: 13, textDecorationLine: 'underline' },
  mgpHelpBox:       { backgroundColor: '#0f1a2e', borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#1e3a5a' },
  mgpHelpTitle:     { color: '#fff', fontWeight: '700', fontSize: 14, marginBottom: 12 },
  mgpHelpStep:      { color: '#ccc', fontSize: 13, lineHeight: 22, marginBottom: 4 },
  mgpHelpNum:       { color: '#00d4ff', fontWeight: '700' },
  mgpHelpBold:      { color: '#fff', fontWeight: '600' },
  mgpHelpNote:      { color: '#888', fontSize: 12, lineHeight: 18, marginTop: 10, fontStyle: 'italic' },
  mgpHelpClose:     { backgroundColor: '#1e3a5a', borderRadius: 8, paddingVertical: 8, alignItems: 'center', marginTop: 12 },
  mgpHelpCloseText: { color: '#00d4ff', fontWeight: '600', fontSize: 13 },

  // ── 🥚 Easter Egg ────────────────────────────────────────────────────────
  eggOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.93)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  eggCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#0d0d1a',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#00d4ff33',
    alignItems: 'center',
    padding: 32,
    shadowColor: '#00d4ff',
    shadowOpacity: 0.4,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 0 },
    elevation: 20,
  },
  eggTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 1,
    marginBottom: 22,
  },
  eggSigBlock: {
    alignItems: 'center',
    marginBottom: 24,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#1e1e3a',
    width: '100%',
  },
  eggSigLine: {
    fontSize: 12,
    color: '#555',
    letterSpacing: 2.5,
    textTransform: 'uppercase',
  },
  eggSigName: {
    fontSize: 36,
    fontWeight: '800',
    color: '#00d4ff',
    letterSpacing: -1,
    marginTop: 4,
  },
  eggSigSub: {
    fontSize: 11,
    color: '#444',
    letterSpacing: 2,
    marginTop: 4,
    textTransform: 'uppercase',
  },
  eggMeta: {
    alignSelf: 'stretch',
    backgroundColor: '#111124',
    borderRadius: 12,
    padding: 14,
    marginBottom: 24,
    gap: 8,
  },
  eggMetaText: {
    fontSize: 13,
    color: '#777',
    lineHeight: 20,
  },
  eggCloseBtn: {
    backgroundColor: '#00d4ff',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 32,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  eggCloseBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#000',
    letterSpacing: 0.5,
  },

  // ── Props History Modal ────────────────────────────────────────────────────
  plOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  plSheet: {
    backgroundColor: '#0f1520',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1.5,
    borderColor: '#ffd700',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 40,
    maxHeight: '70%',
  },
  plHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  plTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.3,
  },
  plTotal: {
    fontSize: 13,
    color: '#ffd700',
    marginBottom: 16,
    marginLeft: 28,
  },
  plRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a2030',
  },
  plRowLeft: {
    flex: 1,
  },
  plRowLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#e0e8f0',
  },
  plRowDate: {
    fontSize: 11,
    color: '#556677',
    marginTop: 2,
  },
  plRowAmount: {
    fontSize: 18,
    fontWeight: '800',
    color: '#ffd700',
    minWidth: 50,
    textAlign: 'right',
  },
  plEmpty: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 14,
  },
  plEmptyText: {
    fontSize: 13,
    color: '#445566',
    textAlign: 'center',
    lineHeight: 20,
  },
});
