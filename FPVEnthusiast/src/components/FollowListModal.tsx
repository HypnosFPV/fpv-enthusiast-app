// src/components/FollowListModal.tsx  — Premium redesign
import React, { useEffect, useState, useCallback } from 'react';
import {
  Modal, View, Text, FlatList, TouchableOpacity,
  Image, StyleSheet, ActivityIndicator, Alert,
  TextInput, StatusBar, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../services/supabase';
import { useFollow, FollowUser } from '../hooks/useFollow';

// ── colour tokens ──────────────────────────────────────────────────────────
const C = {
  bg:         '#080814',
  surface:    '#10101e',
  card:       '#13132a',
  border:     '#1e2040',
  cyan:       '#00d4ff',
  cyanDim:    '#00d4ff22',
  orange:     '#ff4500',
  text:       '#ffffff',
  textSub:    '#888aaa',
  textMuted:  '#40425a',
  red:        '#ff4040',
  redDim:     '#ff404022',
};

interface Props {
  visible:        boolean;
  type:           'followers' | 'following';
  profileUserId:  string;
  currentUserId:  string;
  onClose:        () => void;
  onCountChange?: () => void;
}

// ── helpers ────────────────────────────────────────────────────────────────
const AVATAR_COLORS = ['#ff4500','#00d4ff','#9c27b0','#ff9100','#00e676','#e91e63'];
const avatarColor   = (id: string) => AVATAR_COLORS[id.charCodeAt(0) % AVATAR_COLORS.length];
const initials      = (username: string) => username.slice(0, 2).toUpperCase();

export default function FollowListModal({
  visible, type, profileUserId, currentUserId, onClose, onCountChange,
}: Props) {
  const router = useRouter();
  const { fetchFollowers, fetchFollowing, removeFollower, unfollowUser } =
    useFollow(profileUserId, currentUserId);

  const [list,      setList]      = useState<FollowUser[]>([]);
  const [filtered,  setFiltered]  = useState<FollowUser[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [query,     setQuery]     = useState('');
  const [actioning, setActioning] = useState<string | null>(null);
  // ids that currentUser already follows (for "Follow Back" on followers tab)
  const [myFollowing, setMyFollowing] = useState<Set<string>>(new Set());

  // ── load list ─────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setQuery('');

    const listPromise = type === 'followers' ? fetchFollowers() : fetchFollowing();

    // Also fetch who the current user follows (for "Follow Back" logic)
    const myIdsPromise = type === 'followers' && currentUserId
      ? supabase
          .from('follows')
          .select('following_id')
          .eq('follower_id', currentUserId)
          .then(({ data }) => new Set((data ?? []).map((r: any) => r.following_id as string)))
      : Promise.resolve(new Set<string>());

    const [data, myIds] = await Promise.all([listPromise, myIdsPromise]);
    setList(data);
    setFiltered(data);
    setMyFollowing(myIds);
    setLoading(false);
  }, [type, fetchFollowers, fetchFollowing, currentUserId]);

  useEffect(() => {
    if (visible) load();
    else { setList([]); setFiltered([]); setQuery(''); }
  }, [visible, load]);

  // ── search filter ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!query.trim()) { setFiltered(list); return; }
    const q = query.toLowerCase();
    setFiltered(list.filter(u => u.username.toLowerCase().includes(q)));
  }, [query, list]);

  // ── remove / unfollow ─────────────────────────────────────────────────────
  const handleAction = useCallback((item: FollowUser) => {
    const label   = type === 'followers' ? 'Remove' : 'Unfollow';
    const message = type === 'followers'
      ? `Remove @${item.username} from your followers?`
      : `Unfollow @${item.username}?`;

    Alert.alert(label, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: label,
        style: 'destructive',
        onPress: async () => {
          setActioning(item.id);
          if (type === 'followers') await removeFollower(item.id);
          else await unfollowUser(item.id);
          setList(prev => prev.filter(u => u.id !== item.id));
          onCountChange?.();
          setActioning(null);
        },
      },
    ]);
  }, [type, removeFollower, unfollowUser, onCountChange]);

  // ── follow back ───────────────────────────────────────────────────────────
  const handleFollowBack = useCallback(async (item: FollowUser) => {
    if (!currentUserId) return;
    setActioning(item.id + '_fb');
    await supabase.from('follows').upsert(
      { follower_id: currentUserId, following_id: item.id },
      { onConflict: 'follower_id,following_id' },
    );
    setMyFollowing(prev => new Set([...prev, item.id]));
    onCountChange?.();
    setActioning(null);
  }, [currentUserId, onCountChange]);

  // ── navigate ──────────────────────────────────────────────────────────────
  const goToProfile = useCallback((username: string) => {
    onClose();
    router.push({ pathname: '/profile/[username]', params: { username } });
  }, [router, onClose]);

  // ── row ───────────────────────────────────────────────────────────────────
  const renderItem = ({ item }: { item: FollowUser }) => {
    const isSelf        = item.id === currentUserId;
    const isActingMain  = actioning === item.id;
    const isActingFB    = actioning === item.id + '_fb';
    const alreadyFollow = myFollowing.has(item.id);
    const showFollowBack = type === 'followers' && !isSelf && !alreadyFollow;
    const bgColor       = avatarColor(item.id);

    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => goToProfile(item.username)}
        activeOpacity={0.75}
      >
        {/* Avatar */}
        <View style={[styles.avatarRing, { borderColor: bgColor + '66' }]}>
          {item.avatar_url ? (
            <Image source={{ uri: item.avatar_url }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: bgColor + '28' }]}>
              <Text style={[styles.avatarInitials, { color: bgColor }]}>{initials(item.username)}</Text>
            </View>
          )}
        </View>

        {/* Name */}
        <View style={styles.nameBlock}>
          <Text style={styles.username} numberOfLines={1}>@{item.username}</Text>
          {isSelf && <Text style={styles.youLabel}>You</Text>}
          {!isSelf && alreadyFollow && type === 'followers' && (
            <Text style={styles.mutualLabel}>✓ Following</Text>
          )}
        </View>

        {/* Buttons */}
        {!isSelf && (
          <View style={styles.btnRow}>
            {showFollowBack && (
              <TouchableOpacity
                style={[styles.pill, styles.pillCyan]}
                onPress={() => handleFollowBack(item)}
                disabled={isActingFB}
                activeOpacity={0.8}
              >
                {isActingFB
                  ? <ActivityIndicator size={11} color={C.cyan} />
                  : <>
                      <Ionicons name="person-add-outline" size={11} color={C.cyan} style={{ marginRight: 3 }} />
                      <Text style={[styles.pillText, { color: C.cyan }]}>Follow</Text>
                    </>
                }
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.pill, type === 'followers' ? styles.pillRed : styles.pillGray]}
              onPress={() => handleAction(item)}
              disabled={isActingMain}
              activeOpacity={0.8}
            >
              {isActingMain
                ? <ActivityIndicator size={11} color={type === 'followers' ? C.red : C.textSub} />
                : <Text style={[styles.pillText, { color: type === 'followers' ? C.red : C.textSub }]}>
                    {type === 'followers' ? 'Remove' : 'Unfollow'}
                  </Text>
              }
            </TouchableOpacity>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const isFollowers = type === 'followers';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View style={styles.root}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <LinearGradient colors={[C.surface, C.bg]} style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.backBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="arrow-back" size={22} color={C.text} />
          </TouchableOpacity>

          <View style={styles.headerCenter}>
            <Text style={styles.title}>{isFollowers ? 'Followers' : 'Following'}</Text>
            {!loading && list.length > 0 && (
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{list.length}</Text>
              </View>
            )}
          </View>

          {/* accent dot right side — cyan for followers, orange for following */}
          <View style={[styles.headerAccentDot, { backgroundColor: isFollowers ? C.cyan : C.orange }]} />
        </LinearGradient>

        {/* thin accent line under header */}
        <View style={[styles.accentLine, { backgroundColor: isFollowers ? C.cyan : C.orange }]} />

        {/* ── Search ─────────────────────────────────────────────────────── */}
        {!loading && list.length > 0 && (
          <View style={styles.searchWrap}>
            <Ionicons name="search-outline" size={16} color={C.textMuted} style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder={`Search ${isFollowers ? 'followers' : 'following'}…`}
              placeholderTextColor={C.textMuted}
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
              autoCapitalize="none"
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery('')}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close-circle" size={16} color={C.textMuted} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ── Body ───────────────────────────────────────────────────────── */}
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={C.cyan} size="large" />
            <Text style={styles.loadingText}>Loading…</Text>
          </View>
        ) : list.length === 0 ? (
          <View style={styles.center}>
            <View style={styles.emptyCircle}>
              <Ionicons name="people-outline" size={44} color={C.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>
              {isFollowers ? 'No followers yet' : 'Not following anyone'}
            </Text>
            <Text style={styles.emptySub}>
              {isFollowers
                ? 'When FPV pilots follow you they appear here'
                : 'Follow other FPV pilots to see them here'}
            </Text>
          </View>
        ) : filtered.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="search-outline" size={36} color={C.textMuted} />
            <Text style={styles.emptyTitle}>No results for "{query}"</Text>
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={u => u.id}
            renderItem={renderItem}
            contentContainerStyle={{ paddingBottom: 48, paddingTop: 6 }}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>
    </Modal>
  );
}

const PT = Platform.OS === 'ios' ? 56 : (StatusBar.currentHeight ?? 24) + 10;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  // header
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: PT, paddingBottom: 14, paddingHorizontal: 14,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: C.card, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.border,
  },
  headerCenter: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 8,
  },
  title: { color: C.text, fontSize: 18, fontWeight: '800', letterSpacing: 0.3 },
  countBadge: {
    backgroundColor: C.card, borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 2,
    borderWidth: 1, borderColor: C.border,
  },
  countBadgeText: { color: C.textSub, fontSize: 12, fontWeight: '700' },
  headerAccentDot: { width: 8, height: 8, borderRadius: 4 },
  accentLine: { height: 2, opacity: 0.65 },

  // search
  searchWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.card, borderRadius: 12,
    marginHorizontal: 14, marginTop: 12, marginBottom: 4,
    paddingHorizontal: 12, paddingVertical: 9,
    borderWidth: 1, borderColor: C.border,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, color: C.text, fontSize: 14, paddingVertical: 0 },

  // row
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 10,
  },
  avatarRing: {
    width: 52, height: 52, borderRadius: 26, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  avatar: { width: 46, height: 46, borderRadius: 23 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { fontSize: 17, fontWeight: '800' },

  nameBlock: { flex: 1, justifyContent: 'center', gap: 2 },
  username:  { color: C.text, fontSize: 15, fontWeight: '700' },
  youLabel:  { color: C.cyan, fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },
  mutualLabel: { color: '#00e676', fontSize: 11, fontWeight: '600' },

  // buttons
  btnRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pill: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderRadius: 20, paddingHorizontal: 13, paddingVertical: 7,
    borderWidth: 1, minWidth: 74,
  },
  pillCyan: { backgroundColor: C.cyanDim, borderColor: C.cyan + '55' },
  pillRed:  { backgroundColor: C.redDim,  borderColor: C.red  + '55' },
  pillGray: { backgroundColor: C.card,    borderColor: C.border },
  pillText: { fontSize: 12, fontWeight: '700' },

  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: C.border, marginHorizontal: 14,
  },

  // states
  center: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 40, paddingBottom: 60,
  },
  loadingText: { color: C.textSub, marginTop: 12, fontSize: 14 },
  emptyCircle: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  emptyTitle: {
    color: C.text, fontSize: 16, fontWeight: '700',
    textAlign: 'center', marginBottom: 6,
  },
  emptySub: {
    color: C.textSub, fontSize: 13, textAlign: 'center', lineHeight: 19,
  },
});
