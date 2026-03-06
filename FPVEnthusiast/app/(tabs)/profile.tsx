// app/(tabs)/profile.tsx
import React, {
  useState, useEffect, useCallback, useMemo,
} from 'react';
import {
  View, Text, Image, StyleSheet, ScrollView, TouchableOpacity,
  FlatList, Modal, TextInput, ActivityIndicator,
  Alert, Switch, Dimensions, Platform, KeyboardAvoidingView,
  RefreshControl, StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth }          from '../../src/context/AuthContext';
import { useProfile }       from '../../src/hooks/useProfile';
import { useYouTubeAuth }   from '../../src/hooks/useYouTubeAuth';
import { supabase }         from '../../src/services/supabase';
import PostCard             from '../../src/components/PostCard';
import type { FeedPost }    from '../../src/hooks/useFeed';
import { useFollow }        from '../../src/hooks/useFollow';
import FollowListModal      from '../../src/components/FollowListModal';
import { useMute }          from '../../src/hooks/useMute';
import MuteListModal        from '../../src/components/MuteListModal';

const { width: W } = Dimensions.get('window');
const CELL = (W - 4) / 3;

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface Post {
  id: string;
  user_id: string;
  content?: string;
  caption?: string;
  media_url?: string | null;
  social_url?: string | null;
  embed_url?: string | null;
  thumbnail_url?: string | null;
  platform?: string | null;
  media_type?: 'image' | 'video' | null;
  like_count?: number;
  likes_count?: number;
  comment_count?: number;
  comments_count?: number;
  created_at?: string;
  users?: { id?: string; username: string; avatar_url?: string | null } | null;
}

interface Build {
  id: string;
  user_id: string;
  name: string;
  frame?: string | null;
  motors?: string | null;
  fc?: string | null;
  vtx?: string | null;
  camera?: string | null;
  notes?: string | null;
  created_at?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toFeedPost(p: Post): FeedPost {
  return {
    ...p,
    like_count:    p.like_count    ?? p.likes_count    ?? 0,
    comment_count: p.comment_count ?? p.comments_count ?? 0,
    isLiked: false,
    users: p.users
      ? { id: p.users.id ?? null, username: p.users.username ?? null, avatar_url: p.users.avatar_url ?? null }
      : null,
  } as FeedPost;
}

function thumbnailUri(post: Post): string | null {
  if (post.thumbnail_url) return post.thumbnail_url;
  const candidates = [post.media_url, post.social_url, post.embed_url];
  for (const url of candidates) {
    if (!url) continue;
    const m = url.match(
      /(?:youtube(?:-nocookie)?\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/,
    );
    if (m?.[1]) return `https://img.youtube.com/vi/${m[1]}/hqdefault.jpg`;
  }
  if (
    post.media_url &&
    !post.media_url.match(/\.(mp4|mov|webm)(\?|$)/i) &&
    !post.media_url.match(/youtu/i)
  ) {
    return post.media_url;
  }
  return null;
}

// ─── Small components ─────────────────────────────────────────────────────────

const StatBox = ({
  value, label, icon,
}: { value: number | string; label: string; icon?: string }) => (
  <View style={styles.statBox}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      {icon && <Ionicons name={icon as any} size={16} color="#ff4500" />}
      <Text style={styles.statValue}>{value}</Text>
    </View>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={styles.emptyState}>
      <Ionicons name={icon as any} size={48} color="#333" />
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const { user, signOut } = useAuth() as {
    user: { id: string; email?: string } | null;
    signOut: () => void;
  };

  const {
    profile, loading: profileLoading, updating,
    fetchProfile, updateProfile, validateUsername,
    uploadAvatar, uploadHeaderImage, updateSocialLinks,
  } = useProfile(user?.id ?? undefined);

  const {
    linked: ytLinked, loading: ytAuthLoading,
    promptAsync: promptYouTubeAuth, unlinkYouTube,
  } = useYouTubeAuth(user?.id);

  // ── Follow system ─────────────────────────────────────────────────────────
  const {
    followersCount,
    followingCount,
  } = useFollow(user?.id ?? '', user?.id);

  // ── Mute system ───────────────────────────────────────────────────────────
  const {
    mutedIds,
    mutedUsers,
    loading: muteLoading,
    unmuteUser,
    fetchMutedUsers,
  } = useMute(user?.id);

  // ── Tab / data state ──────────────────────────────────────────────────────
  const [activeTab,   setActiveTab]   = useState<'posts' | 'media' | 'feed' | 'builds'>('posts');
  const [myPosts,     setMyPosts]     = useState<Post[]>([]);
  const [feedPosts,   setFeedPosts]   = useState<Post[]>([]);
  const [builds,      setBuilds]      = useState<Build[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [refreshing,  setRefreshing]  = useState(false);

  // ── Modal visibility ─────────────────────────────────────────────────────
  const [showSettings,    setShowSettings]    = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showSocialLinks, setShowSocialLinks] = useState(false);
  const [showCreateBuild, setShowCreateBuild] = useState(false);
  const [showPostDetail,  setShowPostDetail]  = useState(false);
  const [selectedPost,    setSelectedPost]    = useState<Post | null>(null);
  const [showMuteList,    setShowMuteList]    = useState(false);

  // Follow list modal
  const [followModal, setFollowModal] = useState<'followers' | 'following' | null>(null);

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

  // ── Build fields ──────────────────────────────────────────────────────────
  const [buildName,   setBuildName]   = useState('');
  const [buildFrame,  setBuildFrame]  = useState('');
  const [buildMotors, setBuildMotors] = useState('');
  const [buildFC,     setBuildFC]     = useState('');
  const [buildVTX,    setBuildVTX]    = useState('');
  const [buildCamera, setBuildCamera] = useState('');
  const [buildNotes,  setBuildNotes]  = useState('');

  // ── Seed edit fields from profile ─────────────────────────────────────────
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
  const loadMyPosts = useCallback(async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from('posts')
      .select('*, users(id, username, avatar_url)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    setMyPosts((data as Post[]) ?? []);
  }, [user?.id]);

  // Feed excludes posts from muted users
  const loadFeed = useCallback(async () => {
    const { data } = await supabase
      .from('posts')
      .select('*, users(id, username, avatar_url)')
      .order('created_at', { ascending: false })
      .limit(50);
    const all = (data as Post[]) ?? [];
    // Filter out muted users' posts (mutedIds is a stable ref from useMute)
    setFeedPosts(mutedIds.length > 0 ? all.filter(p => !mutedIds.includes(p.user_id)) : all);
  }, [mutedIds]);

  const loadBuilds = useCallback(async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from('fpv_builds')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    setBuilds((data as Build[]) ?? []);
  }, [user?.id]);

  const loadTabData = useCallback(async (tab: typeof activeTab) => {
    setDataLoading(true);
    try {
      if (tab === 'posts' || tab === 'media') await loadMyPosts();
      else if (tab === 'feed')   await loadFeed();
      else if (tab === 'builds') await loadBuilds();
    } finally {
      setDataLoading(false);
    }
  }, [loadMyPosts, loadFeed, loadBuilds]);

  useEffect(() => { loadTabData(activeTab); }, [activeTab]);

  // Re-filter feed whenever mutedIds changes (user mutes/unmutes someone)
  useEffect(() => {
    if (activeTab === 'feed') loadFeed();
  }, [mutedIds]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchProfile(), loadTabData(activeTab), fetchMutedUsers()]);
    setRefreshing(false);
  }, [fetchProfile, loadTabData, activeTab, fetchMutedUsers]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const mediaPosts = useMemo(
    () => myPosts.filter(p =>
      p.media_type === 'video' || /\.(mp4|mov|webm)(\?|$)/i.test(p.media_url ?? ''),
    ),
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
      user_id: user?.id,
      name:    buildName.trim(),
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
    await loadBuilds();
  }, [user?.id, buildName, buildFrame, buildMotors, buildFC, buildVTX, buildCamera, buildNotes, loadBuilds]);

  const deleteBuild = useCallback((id: string) => {
    Alert.alert('Delete Build', 'Remove this build?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          await supabase.from('fpv_builds').delete().eq('id', id);
          setBuilds(prev => prev.filter(b => b.id !== id));
        },
      },
    ]);
  }, []);

  const handleBannerPress = useCallback(async () => {
    const result = await uploadHeaderImage();
    if (result?.error) { Alert.alert('Banner Upload Failed', result.error); return; }
    if (!result?.canceled) await fetchProfile();
  }, [uploadHeaderImage, fetchProfile]);

  // ── Render helpers ────────────────────────────────────────────────────────
  const renderGridCell = useCallback(({ item }: { item: Post }) => {
    const thumb   = thumbnailUri(item);
    const allUrls = [item.media_url, item.social_url, item.embed_url].filter(Boolean) as string[];
    const isVid   = item.media_type === 'video' || /\.(mp4|mov|webm)(\?|$)/i.test(item.media_url ?? '');
    const isYT    = allUrls.some(u => /youtu/i.test(u));
    const isIG    = item.platform === 'instagram' || (item.social_url ?? '').includes('instagram.com');

    return (
      <TouchableOpacity
        style={styles.gridCell}
        onPress={() => { setSelectedPost(item); setShowPostDetail(true); }}
        activeOpacity={0.8}
      >
        {thumb ? (
          <Image source={{ uri: thumb }} style={styles.gridThumb} resizeMode="cover" />
        ) : isIG ? (
          <View style={[styles.gridThumb, styles.gridIgPlaceholder]}>
            <Ionicons name="logo-instagram" size={28} color="#fff" />
            <Text style={styles.gridIgText}>Instagram</Text>
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
        {isIG && !thumb && (
          <View style={styles.gridIgBadge}>
            <Ionicons name="logo-instagram" size={14} color="#fff" />
          </View>
        )}
      </TouchableOpacity>
    );
  }, []);

  const renderBuild = useCallback(({ item }: { item: Build }) => (
    <View style={styles.buildCard}>
      <View style={styles.buildHeader}>
        <Text style={styles.buildName}>{item.name}</Text>
        <TouchableOpacity onPress={() => deleteBuild(item.id)}>
          <Ionicons name="trash-outline" size={18} color="#e74c3c" />
        </TouchableOpacity>
      </View>
      {([
        ['Frame', item.frame], ['Motors', item.motors], ['FC', item.fc],
        ['VTX', item.vtx],     ['Camera', item.camera],
      ] as [string, string | null | undefined][])
        .filter(([, v]) => !!v)
        .map(([label, val]) => (
          <Text key={label} style={styles.buildSpec}>
            <Text style={styles.buildSpecLabel}>{label}: </Text>{val}
          </Text>
        ))}
      {item.notes ? <Text style={styles.buildNotes}>{item.notes}</Text> : null}
    </View>
  ), [deleteBuild]);

  // ── Loading guard ─────────────────────────────────────────────────────────
  if (profileLoading && !profile) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator size="large" color="#00d4ff" />
      </View>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00d4ff" />}
        stickyHeaderIndices={[3]}
      >
        {/* ── 0: BANNER ─────────────────────────────────────────────────── */}
        <TouchableOpacity onPress={handleBannerPress} activeOpacity={0.85}>
          <View style={styles.bannerWrap}>
            {profile?.header_image_url ? (
              <Image
                key={profile.header_image_url}
                source={{ uri: profile.header_image_url }}
                style={styles.banner}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.banner, styles.bannerPlaceholder]}>
                <Ionicons name="camera" size={28} color="#555" />
                <Text style={styles.bannerHint}>Tap to add banner</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>

        {/* ── 1: HEADER ROW ─────────────────────────────────────────────── */}
        <View style={styles.headerRow}>
          <TouchableOpacity style={styles.avatarWrap} onPress={uploadAvatar}>
            {profile?.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]}>
                <Ionicons name="person" size={34} color="#555" />
              </View>
            )}
            <View style={styles.cameraBadge}>
              <Ionicons name="camera" size={13} color="#fff" />
            </View>
          </TouchableOpacity>
          <View style={styles.headerActions}>
            <TouchableOpacity style={styles.editBtn} onPress={() => setShowEditProfile(true)}>
              <Text style={styles.editBtnText}>Edit Profile</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.gearBtn} onPress={() => setShowSettings(true)}>
              <Ionicons name="settings-outline" size={20} color="#aaa" />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── 2: BIO SECTION ────────────────────────────────────────────── */}
        <View style={styles.bioSection}>
          <Text style={styles.displayName}>{profile?.username ?? 'FPV Pilot'}</Text>
          {profile?.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}

          <View style={styles.statsRow}>
            <StatBox value={myPosts.length} label="Posts" />

            <TouchableOpacity onPress={() => setFollowModal('followers')} activeOpacity={0.7}>
              <StatBox value={followersCount} label="Followers" />
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setFollowModal('following')} activeOpacity={0.7}>
              <StatBox value={followingCount} label="Following" />
            </TouchableOpacity>

            <StatBox value={profile?.total_props ?? 0} label="Props" icon="trophy" />
          </View>

          {/* Social chips */}
          <View style={styles.socialRow}>
            {([
              { icon: 'logo-youtube',   url: profile?.youtube_url   },
              { icon: 'logo-instagram', url: profile?.instagram_url },
              { icon: 'logo-twitter',   url: profile?.twitter_url   },
              { icon: 'logo-tiktok',    url: profile?.tiktok_url    },
              { icon: 'globe-outline',  url: profile?.website_url   },
            ] as { icon: string; url?: string | null }[])
              .filter(s => !!s.url)
              .map(s => (
                <TouchableOpacity key={s.icon} style={styles.socialChip}>
                  <Ionicons name={s.icon as any} size={18} color="#00d4ff" />
                </TouchableOpacity>
              ))}
            <TouchableOpacity style={styles.socialChip} onPress={() => setShowSocialLinks(true)}>
              <Ionicons name="add-circle-outline" size={18} color="#555" />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── 3: TAB BAR (sticky) ───────────────────────────────────────── */}
        <View style={styles.tabBar}>
          {(['posts', 'media', 'feed', 'builds'] as const).map(tab => (
            <TouchableOpacity
              key={tab}
              style={[styles.tabItem, activeTab === tab && styles.tabItemActive]}
              onPress={() => setActiveTab(tab)}
            >
              <Ionicons
                name={
                  tab === 'posts'  ? 'grid-outline'      :
                  tab === 'media'  ? 'film-outline'       :
                  tab === 'feed'   ? 'newspaper-outline'  : 'construct-outline'
                }
                size={18}
                color={activeTab === tab ? '#00d4ff' : '#666'}
              />
              <Text style={[styles.tabLabel, activeTab === tab && styles.tabLabelActive]}>
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── 4: TAB CONTENT ────────────────────────────────────────────── */}
        {dataLoading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color="#00d4ff" />
        ) : (
          <>
            {activeTab === 'posts' && (
              myPosts.length === 0
                ? <EmptyState icon="camera-outline" text="No posts yet" />
                : <FlatList
                    data={myPosts} keyExtractor={i => i.id} renderItem={renderGridCell}
                    numColumns={3} scrollEnabled={false} columnWrapperStyle={styles.gridRow}
                  />
            )}
            {activeTab === 'media' && (
              mediaPosts.length === 0
                ? <EmptyState icon="videocam-outline" text="No videos yet" />
                : <FlatList
                    data={mediaPosts} keyExtractor={i => i.id} renderItem={renderGridCell}
                    numColumns={3} scrollEnabled={false} columnWrapperStyle={styles.gridRow}
                  />
            )}
            {activeTab === 'feed' && (
              feedPosts.length === 0
                ? <EmptyState icon="newspaper-outline" text="Nothing in the feed yet" />
                : <View style={styles.feedList}>
                    {feedPosts.map(p => (
                      <PostCard
                        key={p.id}
                        post={toFeedPost(p)}
                        isVisible={false}
                        shouldAutoplay={false}
                        currentUserId={user?.id ?? undefined}
                        onLike={() => {}}
                        onDelete={(id: string) =>
                          setFeedPosts(prev => prev.filter(fp => fp.id !== id))
                        }
                      />
                    ))}
                  </View>
            )}
            {activeTab === 'builds' && (
              <View>
                {builds.length === 0
                  ? <EmptyState icon="construct-outline" text="No builds logged yet" />
                  : <FlatList
                      data={builds} keyExtractor={i => i.id} renderItem={renderBuild}
                      scrollEnabled={false} contentContainerStyle={{ padding: 12 }}
                    />}
                <TouchableOpacity style={styles.fab} onPress={() => setShowCreateBuild(true)}>
                  <Ionicons name="add" size={28} color="#fff" />
                </TouchableOpacity>
              </View>
            )}
          </>
        )}
        <View style={{ height: 100 }} />
      </ScrollView>

      {/* ── POST DETAIL MODAL ─────────────────────────────────────────────── */}
      <Modal
        visible={showPostDetail} animationType="slide"
        presentationStyle="overFullScreen" onRequestClose={() => setShowPostDetail(false)}
      >
        <View style={styles.detailRoot}>
          <View style={styles.detailHeader}>
            <TouchableOpacity onPress={() => setShowPostDetail(false)}>
              <Ionicons name="arrow-back" size={24} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.detailTitle}>Post</Text>
            <View style={{ width: 24 }} />
          </View>
          <ScrollView>
            {selectedPost && (
              <PostCard
                post={toFeedPost(selectedPost)}
                isVisible={true}
                shouldAutoplay={false}
                currentUserId={user?.id ?? undefined}
                onLike={() => {}}
                onDelete={(id: string) => {
                  setMyPosts(prev => prev.filter(p => p.id !== id));
                  setShowPostDetail(false);
                }}
              />
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* ── SETTINGS MODAL ────────────────────────────────────────────────── */}
      <Modal
        visible={showSettings} animationType="slide"
        presentationStyle="overFullScreen" onRequestClose={() => setShowSettings(false)}
      >
        <View style={styles.modalRoot}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Settings</Text>
            <TouchableOpacity onPress={() => setShowSettings(false)}>
              <Ionicons name="close" size={26} color="#fff" />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody}>

            {/* Account */}
            <View style={styles.settingsSection}>
              <Text style={styles.settingsSectionTitle}>Account</Text>
              <View style={styles.settingsRow}>
                <Text style={styles.settingsLabel}>Email</Text>
                <Text style={styles.settingsValue}>{user?.email ?? '—'}</Text>
              </View>
              <View style={styles.settingsRow}>
                <Text style={styles.settingsLabel}>Username</Text>
                <Text style={styles.settingsValue}>{profile?.username ?? '—'}</Text>
              </View>
            </View>

            {/* Preferences */}
            <View style={styles.settingsSection}>
              <Text style={styles.settingsSectionTitle}>Preferences</Text>
              <View style={styles.settingsRow}>
                <Text style={styles.settingsLabel}>Autoplay Videos</Text>
                <Switch
                  value={profile?.autoplay_videos ?? true}
                  onValueChange={(val: boolean) => { void updateProfile({ autoplay_videos: val }); }}
                  trackColor={{ true: '#00d4ff', false: '#333' }}
                  thumbColor="#fff"
                />
              </View>
            </View>

            {/* Privacy */}
            <View style={styles.settingsSection}>
              <Text style={styles.settingsSectionTitle}>Privacy</Text>

              {/* Muted Users row */}
              <TouchableOpacity
                style={styles.settingsRow}
                onPress={() => {
                  setShowSettings(false);
                  setTimeout(() => setShowMuteList(true), 350);
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Ionicons name="volume-mute-outline" size={20} color="#aaa" />
                  <View>
                    <Text style={styles.settingsLabel}>Muted Users</Text>
                    {mutedUsers.length > 0 && (
                      <Text style={[styles.settingsValue, { fontSize: 11 }]}>
                        {mutedUsers.length} muted
                      </Text>
                    )}
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#555" />
              </TouchableOpacity>
            </View>

            {/* Connected Accounts */}
            <View style={styles.settingsSection}>
              <Text style={styles.settingsSectionTitle}>Connected Accounts</Text>
              <TouchableOpacity
                style={styles.settingsRow}
                onPress={() => { setShowSettings(false); setTimeout(() => setShowSocialLinks(true), 350); }}
              >
                <Text style={styles.settingsLabel}>Social Links</Text>
                <Ionicons name="chevron-forward" size={18} color="#555" />
              </TouchableOpacity>
              <View style={[styles.settingsRow, {
                borderTopWidth: 1, borderTopColor: '#2a2a4a', marginTop: 4, paddingTop: 10,
              }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="logo-youtube" size={20} color="#FF0000" />
                  <View>
                    <Text style={styles.settingsLabel}>YouTube Account</Text>
                    <Text style={[styles.settingsValue, {
                      fontSize: 11, color: ytLinked ? '#4caf50' : '#888',
                    }]}>
                      {ytLinked ? '● Connected — Like & Subscribe enabled' : '○ Not connected'}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={[styles.ytAuthBtn, ytLinked ? styles.ytAuthBtnUnlink : styles.ytAuthBtnLink]}
                  onPress={ytLinked ? unlinkYouTube : () => promptYouTubeAuth()}
                  disabled={ytAuthLoading}
                >
                  {ytAuthLoading
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={styles.ytAuthBtnText}>{ytLinked ? 'Unlink' : 'Connect'}</Text>}
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity style={styles.signOutBtn} onPress={signOut}>
              <Ionicons name="log-out-outline" size={18} color="#e74c3c" />
              <Text style={styles.signOutText}>Sign Out</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      {/* ── EDIT PROFILE MODAL ────────────────────────────────────────────── */}
      <Modal
        visible={showEditProfile} animationType="slide"
        presentationStyle="overFullScreen" onRequestClose={() => setShowEditProfile(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalRoot} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Edit Profile</Text>
            <TouchableOpacity onPress={() => setShowEditProfile(false)}>
              <Ionicons name="close" size={26} color="#fff" />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody}>
            <Text style={styles.inputLabel}>Username</Text>
            <TextInput
              style={[styles.input, usernameError ? styles.inputError : undefined]}
              value={editUsername}
              onChangeText={t => { setEditUsername(t); setUsernameError(''); }}
              placeholder="username" placeholderTextColor="#555" autoCapitalize="none"
            />
            {usernameError ? <Text style={styles.errorText}>{usernameError}</Text> : null}
            <Text style={styles.inputLabel}>Bio</Text>
            <TextInput
              style={[styles.input, { height: 90 }]} value={editBio} onChangeText={setEditBio}
              placeholder="Tell the community about yourself…" placeholderTextColor="#555"
              multiline maxLength={200}
            />
            <Text style={styles.charCount}>{editBio.length}/200</Text>
            <TouchableOpacity
              style={[styles.primaryBtn, updating ? styles.primaryBtnDisabled : undefined]}
              onPress={saveProfile} disabled={updating}
            >
              {updating
                ? <ActivityIndicator size="small" color="#000" />
                : <Text style={styles.primaryBtnText}>Save Changes</Text>}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── SOCIAL LINKS MODAL ────────────────────────────────────────────── */}
      <Modal
        visible={showSocialLinks} animationType="slide"
        presentationStyle="overFullScreen" onRequestClose={() => setShowSocialLinks(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalRoot} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Social Links</Text>
            <TouchableOpacity onPress={() => setShowSocialLinks(false)}>
              <Ionicons name="close" size={26} color="#fff" />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody}>
            {([
              { label: 'YouTube',   icon: 'logo-youtube',   val: editYoutube,   set: setEditYoutube   },
              { label: 'Instagram', icon: 'logo-instagram', val: editInstagram, set: setEditInstagram },
              { label: 'Twitter/X', icon: 'logo-twitter',   val: editTwitter,   set: setEditTwitter   },
              { label: 'TikTok',    icon: 'logo-tiktok',    val: editTiktok,    set: setEditTiktok    },
              { label: 'Website',   icon: 'globe-outline',  val: editWebsite,   set: setEditWebsite   },
            ] as { label: string; icon: string; val: string; set: (v: string) => void }[]).map(
              ({ label, icon, val, set }) => (
                <View key={label}>
                  <Text style={styles.inputLabel}>{label}</Text>
                  <View style={styles.socialInputRow}>
                    <Ionicons name={icon as any} size={20} color="#00d4ff" style={{ marginRight: 8 }} />
                    <TextInput
                      style={[styles.input, { flex: 1 }]} value={val} onChangeText={set}
                      placeholder="https://…" placeholderTextColor="#555"
                      autoCapitalize="none" keyboardType="url"
                    />
                  </View>
                </View>
              ),
            )}
            <TouchableOpacity
              style={[styles.primaryBtn, updating ? styles.primaryBtnDisabled : undefined]}
              onPress={saveSocials} disabled={updating}
            >
              {updating
                ? <ActivityIndicator size="small" color="#000" />
                : <Text style={styles.primaryBtnText}>Save Links</Text>}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── CREATE BUILD MODAL ────────────────────────────────────────────── */}
      <Modal
        visible={showCreateBuild} animationType="slide"
        presentationStyle="overFullScreen" onRequestClose={() => setShowCreateBuild(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalRoot} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>New Build</Text>
            <TouchableOpacity onPress={() => setShowCreateBuild(false)}>
              <Ionicons name="close" size={26} color="#fff" />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody}>
            {([
              { label: 'Build Name *', val: buildName,   set: setBuildName,   ph: 'e.g. Race Day 5"'         },
              { label: 'Frame',        val: buildFrame,  set: setBuildFrame,  ph: 'e.g. ImpulseRC Apex'      },
              { label: 'Motors',       val: buildMotors, set: setBuildMotors, ph: 'e.g. iFlight 2306 2450kv' },
              { label: 'FC',           val: buildFC,     set: setBuildFC,     ph: 'e.g. Betaflight F7'       },
              { label: 'VTX',          val: buildVTX,    set: setBuildVTX,    ph: 'e.g. Rush Tank Ultimate'  },
              { label: 'Camera',       val: buildCamera, set: setBuildCamera, ph: 'e.g. Caddx Ratel 2'       },
            ] as { label: string; val: string; set: (v: string) => void; ph: string }[]).map(
              ({ label, val, set, ph }) => (
                <View key={label}>
                  <Text style={styles.inputLabel}>{label}</Text>
                  <TextInput
                    style={styles.input} value={val} onChangeText={set}
                    placeholder={ph} placeholderTextColor="#555"
                  />
                </View>
              ),
            )}
            <Text style={styles.inputLabel}>Notes</Text>
            <TextInput
              style={[styles.input, { height: 80 }]} value={buildNotes} onChangeText={setBuildNotes}
              placeholder="Tune notes, issues, mods…" placeholderTextColor="#555" multiline
            />
            <TouchableOpacity style={styles.primaryBtn} onPress={createBuild}>
              <Text style={styles.primaryBtnText}>Add Build</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── FOLLOW LIST MODAL ─────────────────────────────────────────────── */}
      {user && (
        <FollowListModal
          visible={followModal !== null}
          type={followModal ?? 'followers'}
          profileUserId={user.id}
          currentUserId={user.id}
          onClose={() => setFollowModal(null)}
        />
      )}

      {/* ── MUTE LIST MODAL ───────────────────────────────────────────────── */}
      <MuteListModal
        visible={showMuteList}
        onClose={() => setShowMuteList(false)}
        mutedUsers={mutedUsers}
        loading={muteLoading}
        onUnmute={async (userId) => {
          await unmuteUser(userId);
        }}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:          { flex: 1, backgroundColor: '#0a0a1a' },
  loadingScreen: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0a0a1a' },

  bannerWrap:        { width: '100%', height: 160, overflow: 'hidden', backgroundColor: '#111' },
  banner:            { width: '100%', height: 160 },
  bannerPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  bannerHint:        { color: '#444', fontSize: 12, marginTop: 6 },

  headerRow: {
    flexDirection: 'row', alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginTop: -36,
    marginBottom: 10,
  },
  avatarWrap:        { position: 'relative' },
  avatar:            { width: 80, height: 80, borderRadius: 40, borderWidth: 3, borderColor: '#0a0a1a' },
  avatarPlaceholder: { backgroundColor: '#1e1e3a', justifyContent: 'center', alignItems: 'center' },
  cameraBadge: {
    position: 'absolute', bottom: 2, right: 2,
    backgroundColor: '#00d4ff', borderRadius: 10,
    width: 20, height: 20, justifyContent: 'center', alignItems: 'center',
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 10 },
  editBtn:       { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: '#00d4ff' },
  editBtnText:   { color: '#00d4ff', fontWeight: '600', fontSize: 13 },
  gearBtn:       { padding: 4 },

  bioSection:  { paddingHorizontal: 16, paddingBottom: 8 },
  displayName: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 4 },
  bio:         { color: '#aaa', fontSize: 13, lineHeight: 18, marginBottom: 10 },

  statsRow:  { flexDirection: 'row', justifyContent: 'space-around', marginVertical: 12 },
  statBox:   { alignItems: 'center' },
  statValue: { color: '#fff', fontSize: 18, fontWeight: '800' },
  statLabel: { color: '#888', fontSize: 11, marginTop: 2 },

  socialRow:  { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4, gap: 8 },
  socialChip: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#1e1e3a', justifyContent: 'center', alignItems: 'center',
  },

  tabBar:         {
    flexDirection: 'row', backgroundColor: '#0a0a1a',
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#1e1e3a',
  },
  tabItem:        { flex: 1, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  tabItemActive:  { borderBottomWidth: 2, borderBottomColor: '#00d4ff' },
  tabLabel:       { color: '#666', fontSize: 10, fontWeight: '600', marginTop: 3 },
  tabLabelActive: { color: '#00d4ff' },

  feedList: { paddingHorizontal: 12 },

  gridRow:              { gap: 2 },
  gridCell:             {
    width: CELL, height: CELL, backgroundColor: '#1a1a2e',
    overflow: 'hidden', position: 'relative', margin: 1,
  },
  gridThumb:            { width: '100%', height: '100%' },
  gridThumbPlaceholder: { justifyContent: 'center', alignItems: 'center', backgroundColor: '#111' },
  gridIgPlaceholder:    { justifyContent: 'center', alignItems: 'center', backgroundColor: '#C13584', gap: 4 },
  gridIgText:           { color: '#fff', fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  gridPlayBadge:        {
    position: 'absolute', top: '50%', left: '50%',
    transform: [{ translateX: -11 }, { translateY: -11 }],
  },
  gridYtBadge: {
    position: 'absolute', bottom: 4, right: 4,
    backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 4, padding: 3,
  },
  gridIgBadge: {
    position: 'absolute', bottom: 4, right: 4,
    backgroundColor: 'rgba(193,53,132,0.85)', borderRadius: 4, padding: 3,
  },

  buildCard:      {
    backgroundColor: '#1a1a2e', borderRadius: 12, padding: 14,
    marginBottom: 12, borderWidth: 1, borderColor: '#2a2a4a',
  },
  buildHeader:    { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  buildName:      { color: '#fff', fontWeight: '700', fontSize: 15 },
  buildSpec:      { color: '#ccc', fontSize: 13, lineHeight: 20 },
  buildSpecLabel: { color: '#00d4ff', fontWeight: '600' },
  buildNotes:     { color: '#888', fontSize: 12, marginTop: 6, fontStyle: 'italic' },

  fab: {
    alignSelf: 'flex-end', margin: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#00d4ff', justifyContent: 'center', alignItems: 'center',
    shadowColor: '#00d4ff', shadowOpacity: 0.5, shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 }, elevation: 8,
  },

  detailRoot:   { flex: 1, backgroundColor: '#0a0a1a' },
  detailHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 54 : 16,
    paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#1e1e3a',
  },
  detailTitle: { color: '#fff', fontWeight: '700', fontSize: 16 },

  modalRoot:   { flex: 1, backgroundColor: '#0a0a1a' },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 54 : 16,
    paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#1e1e3a',
  },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  modalBody:  { padding: 20, gap: 12 },

  settingsSection:      {
    backgroundColor: '#1a1a2e', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: '#2a2a4a',
  },
  settingsSectionTitle: { color: '#888', fontSize: 11, fontWeight: '700', marginBottom: 10, textTransform: 'uppercase' },
  settingsRow:          {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingVertical: 6,
  },
  settingsLabel: { color: '#ccc', fontSize: 14 },
  settingsValue: { color: '#888', fontSize: 14 },

  ytAuthBtn:       { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, minWidth: 80, alignItems: 'center' },
  ytAuthBtnLink:   { backgroundColor: '#FF0000' },
  ytAuthBtnUnlink: { backgroundColor: '#333', borderWidth: 1, borderColor: '#555' },
  ytAuthBtnText:   { color: '#fff', fontWeight: '700', fontSize: 13 },

  signOutBtn:  {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#1a1a2e', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: '#e74c3c33', gap: 8,
  },
  signOutText: { color: '#e74c3c', fontWeight: '700', fontSize: 15 },

  inputLabel:     { color: '#aaa', fontSize: 12, fontWeight: '600', marginBottom: 4 },
  input:          {
    backgroundColor: '#1e1e3a', borderRadius: 10, padding: 12,
    color: '#fff', fontSize: 14, borderWidth: 1, borderColor: '#2a2a4a',
  },
  inputError:     { borderColor: '#e74c3c' },
  errorText:      { color: '#e74c3c', fontSize: 12, marginTop: 2 },
  charCount:      { color: '#555', fontSize: 11, textAlign: 'right' },
  socialInputRow: { flexDirection: 'row', alignItems: 'center' },

  primaryBtn:         { backgroundColor: '#00d4ff', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText:     { color: '#000', fontWeight: '800', fontSize: 15 },

  emptyState: { alignItems: 'center', paddingVertical: 60 },
  emptyText:  { color: '#555', fontSize: 14, marginTop: 12 },
});
