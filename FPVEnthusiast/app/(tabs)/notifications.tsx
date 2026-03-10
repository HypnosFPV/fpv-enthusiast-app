// app/(tabs)/notifications.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Notification grouping system:
//   • Like/comment/mention on same post → merged: "John and 2 others liked your post"
//   • Follows → merged: "John, Alice, and 3 others started following you"
//   • Reply on same comment → merged: "John and 1 other replied to your comment"
//   • Stacked avatar strip (up to 3 overlapping circles) for grouped rows
//   • Swipe-delete removes entire group at once
//   • Today / Yesterday / Earlier section buckets
//   • Stagger-in row animations
//   • Animated cycling-colour title (same as FPV Feed)
//   • Left-border unread accent + orange dot
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Image, ActivityIndicator, RefreshControl, Animated,
  Modal, Pressable, SectionList, Easing,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../src/context/AuthContext';
import { AppNotification } from '../../src/hooks/useNotifications';
import { useNotificationsContext } from '../../src/context/NotificationsContext';
import { useFollows } from '../../src/hooks/useFollows';

// ─── Grouped notification type (pure display, no DB change) ──────────────────
interface GroupedNotif {
  groupKey:   string;
  type:       AppNotification['type'];
  post_id:    string | null;
  comment_id: string | null;
  /** All raw notification IDs belonging to this group */
  ids:        string[];
  /** Unique actors, most-recent first, deduped by actor_id */
  actors:     Array<{ id: string | null; username: string; avatar_url: string | null }>;
  /** False if ANY notification in the group is unread */
  read:       boolean;
  /** Timestamp of the newest notification */
  created_at: string;
  post:       { thumbnail_url: string | null } | null;
  message:    string | null;
}

// ─── Grouping engine ──────────────────────────────────────────────────────────
/**
 * Groups a sorted (newest-first) notification list.
 * Key strategy:
 *   like / comment / mention  →  type__post_id
 *   follow                    →  follow__all
 *   reply                     →  reply__comment_id  (fall back to post_id)
 */
function groupNotifications(notifs: AppNotification[]): GroupedNotif[] {
  const map = new Map<string, GroupedNotif>();
  const order: string[] = [];          // preserve insertion order

  for (const n of notifs) {
    let key: string;
    if (n.type === 'follow') {
      key = 'follow__all';
    } else if (n.type === 'reply') {
      key = `reply__${n.comment_id ?? n.post_id ?? 'x'}`;
    } else {
      key = `${n.type}__${n.post_id ?? 'x'}`;
    }

    const actor: GroupedNotif['actors'][number] = {
      id:         n.actor_id,
      username:   (n.actor as any)?.username   ?? 'Someone',
      avatar_url: (n.actor as any)?.avatar_url ?? null,
    };

    if (map.has(key)) {
      const g = map.get(key)!;
      // Dedup actors by id
      if (!g.actors.some(a => a.id === actor.id)) {
        g.actors.push(actor);
      }
      g.ids.push(n.id);
      if (!n.read) g.read = false;
      // Keep newest created_at
      if (n.created_at > g.created_at) g.created_at = n.created_at;
    } else {
      const g: GroupedNotif = {
        groupKey:   key,
        type:       n.type,
        post_id:    n.post_id,
        comment_id: n.comment_id,
        ids:        [n.id],
        actors:     [actor],
        read:       n.read,
        created_at: n.created_at,
        post:       (n.post as any) ?? null,
        message:    n.message,
      };
      map.set(key, g);
      order.push(key);
    }
  }

  // Re-sort by newest created_at
  return order
    .map(k => map.get(k)!)
    .sort((a, b) => (b.created_at > a.created_at ? 1 : -1));
}

// ─── Label builder ────────────────────────────────────────────────────────────
const ACTION_VERB: Record<AppNotification['type'], string> = {
  like:    'liked your post',
  comment: 'commented on your post',
  follow:  'started following you',
  mention: 'mentioned you',
  reply:   'replied to your comment',
};

function buildLabel(actors: GroupedNotif['actors'], type: AppNotification['type']): {
  prefix: string;
  suffix: string;
} {
  const verb = ACTION_VERB[type] ?? type;
  const names = actors.map(a => a.username);

  if (names.length === 1) {
    return { prefix: names[0], suffix: verb };
  }
  if (names.length === 2) {
    return { prefix: `${names[0]} and ${names[1]}`, suffix: verb };
  }
  const others = names.length - 2;
  return {
    prefix: `${names[0]}, ${names[1]}, and ${others} other${others > 1 ? 's' : ''}`,
    suffix: verb,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60)    return `${diff}s`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

/** Buckets GroupedNotifs into Today / Yesterday / Earlier sections */
function groupByDate(groups: GroupedNotif[]): Array<{ title: string; data: GroupedNotif[] }> {
  const now       = new Date();
  const today     = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;

  const buckets: Record<string, GroupedNotif[]> = {
    Today: [], Yesterday: [], Earlier: [],
  };

  for (const g of groups) {
    const t = new Date(g.created_at).getTime();
    if (t >= today)          buckets.Today.push(g);
    else if (t >= yesterday) buckets.Yesterday.push(g);
    else                     buckets.Earlier.push(g);
  }

  return Object.entries(buckets)
    .filter(([, data]) => data.length > 0)
    .map(([title, data]) => ({ title, data }));
}

// ─── Type metadata ─────────────────────────────────────────────────────────
const TYPE_META: Record<string, { icon: string; color: string }> = {
  like:    { icon: 'heart',            color: '#e74c3c' },
  comment: { icon: 'chatbubble',       color: '#3498db' },
  follow:  { icon: 'person-add',       color: '#2ecc71' },
  mention: { icon: 'at-circle',        color: '#f39c12' },
  reply:   { icon: 'return-down-back', color: '#9b59b6' },
};

// ─── Avatar Stack ─────────────────────────────────────────────────────────────
// Shows up to 3 stacked/overlapping avatars for grouped rows
function AvatarStack({ actors }: { actors: GroupedNotif['actors'] }) {
  const shown = actors.slice(0, 3);
  const meta  = TYPE_META[actors[0]?.id ? 'like' : 'like']; // just for fallback

  return (
    <View style={stackStyles.wrap}>
      {shown.map((a, i) => (
        <View
          key={a.id ?? i}
          style={[
            stackStyles.circle,
            { marginLeft: i === 0 ? 0 : -10, zIndex: shown.length - i },
          ]}
        >
          {a.avatar_url ? (
            <Image source={{ uri: a.avatar_url }} style={stackStyles.img} />
          ) : (
            <View style={[stackStyles.img, stackStyles.placeholder]}>
              <Ionicons name="person" size={16} color="#555" />
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

const stackStyles = StyleSheet.create({
  wrap:        { flexDirection: 'row', alignItems: 'center' },
  circle:      { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: '#0d0d0d' },
  img:         { width: '100%', height: '100%', borderRadius: 20 },
  placeholder: { backgroundColor: '#1e1e2e', justifyContent: 'center', alignItems: 'center' },
});

// ─── Follow Action Sheet ───────────────────────────────────────────────────────
function FollowActionSheet({
  visible, actorId, actorName, actorAvatar, otherCount,
  currentUserId, onViewProfile, onClose,
}: {
  visible:       boolean;
  actorId:       string;
  actorName:     string;
  actorAvatar:   string | null;
  otherCount:    number;          // 0 = solo follow, >0 = show "and N others"
  currentUserId: string;
  onViewProfile: () => void;
  onClose:       () => void;
}) {
  const { isFollowing, toggling, toggle } = useFollows(currentUserId, actorId);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.sheetUser}>
          {actorAvatar ? (
            <Image source={{ uri: actorAvatar }} style={styles.sheetAvatar} />
          ) : (
            <View style={[styles.sheetAvatar, styles.sheetAvatarPlaceholder]}>
              <Ionicons name="person" size={28} color="#555" />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.sheetName}>@{actorName}</Text>
            <Text style={styles.sheetSubtitle}>
              {otherCount > 0
                ? `and ${otherCount} other${otherCount > 1 ? 's' : ''} started following you`
                : 'started following you'}
            </Text>
          </View>
        </View>

        <View style={styles.sheetDivider} />

        <TouchableOpacity
          style={[styles.sheetBtn, isFollowing && styles.sheetBtnFollowing]}
          onPress={toggle}
          disabled={toggling}
          activeOpacity={0.8}
        >
          {toggling ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Ionicons
                name={isFollowing ? 'checkmark-circle' : 'person-add'}
                size={20}
                color={isFollowing ? '#aaa' : '#fff'}
              />
              <Text style={[styles.sheetBtnText, isFollowing && styles.sheetBtnTextFollowing]}>
                {isFollowing ? 'Following' : 'Follow Back'}
              </Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.sheetBtnSecondary} onPress={onViewProfile} activeOpacity={0.8}>
          <Ionicons name="person-outline" size={20} color="#ff4500" />
          <Text style={styles.sheetBtnSecondaryText}>View Profile →</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.sheetCancel} onPress={onClose} activeOpacity={0.7}>
          <Text style={styles.sheetCancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

// ─── Swipe delete ─────────────────────────────────────────────────────────────
function DeleteAction({
  progress, onDelete,
}: {
  progress: Animated.AnimatedInterpolation<number>;
  onDelete: () => void;
}) {
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] });
  return (
    <Animated.View style={[styles.deleteAction, { transform: [{ scale }] }]}>
      <TouchableOpacity style={styles.deleteBtn} onPress={onDelete}>
        <Ionicons name="trash-outline" size={22} color="#fff" />
        <Text style={styles.deleteBtnText}>Delete</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ─── Grouped Notification Row ─────────────────────────────────────────────────
function GroupedNotifRow({
  item,
  index,
  onPress,
  onDelete,
}: {
  item:     GroupedNotif;
  index:    number;
  onPress:  (g: GroupedNotif) => void;
  onDelete: (ids: string[]) => void;
}) {
  const swipeRef  = useRef<Swipeable>(null);
  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(18)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1, duration: 260,
        delay: Math.min(index * 35, 350), useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0, duration: 260,
        delay: Math.min(index * 35, 350), useNativeDriver: true,
      }),
    ]).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const meta   = TYPE_META[item.type] ?? TYPE_META.like;
  const { prefix, suffix } = buildLabel(item.actors, item.type);
  const thumb  = item.post?.thumbnail_url ?? null;
  const isGrouped = item.actors.length > 1;

  const handleDelete = () => {
    swipeRef.current?.close();
    onDelete(item.ids);
  };

  return (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
      <Swipeable
        ref={swipeRef}
        friction={2}
        overshootRight={false}
        renderRightActions={(progress) => (
          <DeleteAction progress={progress} onDelete={handleDelete} />
        )}
      >
        <TouchableOpacity
          style={[styles.row, !item.read && styles.rowUnread]}
          onPress={() => onPress(item)}
          activeOpacity={0.75}
        >
          {/* Left unread accent bar */}
          {!item.read && <View style={styles.unreadBar} />}

          {/* ── Avatar area ─────────────────────────────── */}
          <View style={styles.avatarArea}>
            {isGrouped ? (
              // Stacked avatars for grouped
              <AvatarStack actors={item.actors} />
            ) : (
              // Single avatar with type badge
              <View style={styles.avatarWrap}>
                {item.actors[0]?.avatar_url ? (
                  <Image source={{ uri: item.actors[0].avatar_url }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarPlaceholder]}>
                    <Ionicons name="person" size={20} color="#555" />
                  </View>
                )}
              </View>
            )}
            {/* Type badge — always shown, anchored bottom-right of avatar area */}
            <View style={[styles.iconBadge, { backgroundColor: meta.color }]}>
              <Ionicons name={meta.icon as any} size={10} color="#fff" />
            </View>
          </View>

          {/* ── Text ──────────────────────────────────────── */}
          <View style={styles.rowBody}>
            <Text style={styles.rowText} numberOfLines={2}>
              <Text style={styles.bold}>{prefix}</Text>
              {' '}<Text style={styles.rowTextMuted}>{suffix}</Text>
            </Text>
            {item.message ? (
              <Text style={styles.messagePreview} numberOfLines={1}>"{item.message}"</Text>
            ) : null}
            <View style={styles.rowMeta}>
              <Text style={styles.timeText}>{timeAgo(item.created_at)}</Text>
              {isGrouped && (
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{item.actors.length}</Text>
                </View>
              )}
            </View>
          </View>

          {/* ── Post thumbnail ────────────────────────────── */}
          {thumb ? (
            <Image source={{ uri: thumb }} style={styles.postThumb} resizeMode="cover" />
          ) : null}

          {/* Chevron */}
          <Ionicons name="chevron-forward" size={14} color="#444" style={{ marginLeft: 4 }} />

          {/* Unread dot */}
          {!item.read && <View style={styles.unreadDot} />}
        </TouchableOpacity>
      </Swipeable>
    </Animated.View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function NotificationsScreen() {
  const { user } = useAuth();
  const router   = useRouter();

  const {
    notifications,
    loading,
    unreadCount,
    fetchNotifications,
    markAllRead,
    markReadBulk,
    deleteNotificationBulk,
    clearAll,
  } = useNotificationsContext();

  // ── Animated cycling title ────────────────────────────────────────────────
  const animValue = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.timing(animValue, {
        toValue: 1, duration: 3000, easing: Easing.linear, useNativeDriver: false,
      })
    ).start();
  }, [animValue]);
  const animatedColor = animValue.interpolate({
    inputRange:  [0,         0.25,      0.5,       0.75,      1        ],
    outputRange: ['#ff4500', '#ff8c00', '#ffcc00', '#ff6600', '#ff4500'],
  });

  // ── Follow action sheet ───────────────────────────────────────────────────
  const [followSheet, setFollowSheet] = useState<{
    actorId:     string;
    actorName:   string;
    actorAvatar: string | null;
    otherCount:  number;
  } | null>(null);

  // ── Focus refresh ─────────────────────────────────────────────────────────
  useFocusEffect(
    useCallback(() => { fetchNotifications(); }, [fetchNotifications])
  );

  // ── Group then section ────────────────────────────────────────────────────
  const grouped  = useMemo(() => groupNotifications(notifications), [notifications]);
  const sections = useMemo(() => groupByDate(grouped), [grouped]);

  // Unread group count (for "N unread" label — count groups not raw rows)
  const unreadGroupCount = useMemo(() => grouped.filter(g => !g.read).length, [grouped]);

  // ── Handle tap ────────────────────────────────────────────────────────────
  const handlePress = useCallback(async (g: GroupedNotif) => {
    // Mark all IDs in group as read
    const unreadIds = g.ids; // markReadBulk is idempotent for already-read
    if (!g.read) await markReadBulk(unreadIds);

    if (g.type === 'follow') {
      setFollowSheet({
        actorId:     g.actors[0]?.id ?? '',
        actorName:   g.actors[0]?.username ?? 'User',
        actorAvatar: g.actors[0]?.avatar_url ?? null,
        otherCount:  Math.max(0, g.actors.length - 1),
      });
    } else if (g.post_id) {
      router.push({
        pathname: '/post/[id]',
        params: {
          id: g.post_id,
          ...(g.comment_id ? { comment_id: g.comment_id } : {}),
        },
      });
    }
  }, [markReadBulk, router]);

  const handleViewProfile = useCallback(() => {
    if (!followSheet?.actorId) return;
    setFollowSheet(null);
    router.push({ pathname: '/user/[id]', params: { id: followSheet.actorId } });
  }, [followSheet, router]);

  // ── Handle swipe delete ───────────────────────────────────────────────────
  const handleDelete = useCallback((ids: string[]) => {
    deleteNotificationBulk(ids);
  }, [deleteNotificationBulk]);

  if (loading && !notifications.length) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#ff4500" />
      </View>
    );
  }

  return (
    <View style={styles.container}>

      {/* ── Header ── */}
      <View style={styles.header}>
        <View>
          <Animated.Text style={[styles.title, { color: animatedColor }]}>
            Notifications
          </Animated.Text>
          {unreadGroupCount > 0 && (
            <Text style={styles.unreadLabel}>
              {unreadGroupCount} unread
            </Text>
          )}
        </View>
        <View style={styles.headerActions}>
          {unreadCount > 0 && (
            <TouchableOpacity style={styles.markAllBtn} onPress={markAllRead}>
              <Ionicons name="checkmark-done-outline" size={13} color="#888" style={{ marginRight: 4 }} />
              <Text style={styles.markAllText}>Mark read</Text>
            </TouchableOpacity>
          )}
          {notifications.length > 0 && (
            <TouchableOpacity style={[styles.markAllBtn, styles.clearAllBtn]} onPress={clearAll}>
              <Ionicons name="trash-outline" size={13} color="#c0392b" style={{ marginRight: 4 }} />
              <Text style={[styles.markAllText, { color: '#c0392b' }]}>Clear all</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Swipe hint ── */}
      {grouped.length > 0 && (
        <View style={styles.swipeHint}>
          <Ionicons name="arrow-back-outline" size={12} color="#555" />
          <Text style={styles.swipeHintText}>Swipe left to delete</Text>
        </View>
      )}

      {/* ── Sectioned grouped list ── */}
      {sections.length === 0 ? (
        <View style={styles.emptyContainer}>
          <View style={styles.empty}>
            <Ionicons name="notifications-off-outline" size={64} color="#222" />
            <Text style={styles.emptyTitle}>All caught up!</Text>
            <Text style={styles.emptySubtitle}>
              When someone likes, comments, or follows you — it shows up here.
            </Text>
          </View>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={g => g.groupKey}
          renderSectionHeader={({ section: { title } }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderText}>{title}</Text>
            </View>
          )}
          renderItem={({ item, index }) => (
            <GroupedNotifRow
              item={item}
              index={index}
              onPress={handlePress}
              onDelete={handleDelete}
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={fetchNotifications}
              tintColor="#ff4500"
            />
          }
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
        />
      )}

      {/* ── Follow Action Sheet ── */}
      {followSheet && user && (
        <FollowActionSheet
          visible={!!followSheet}
          actorId={followSheet.actorId}
          actorName={followSheet.actorName}
          actorAvatar={followSheet.actorAvatar}
          otherCount={followSheet.otherCount}
          currentUserId={user.id}
          onViewProfile={handleViewProfile}
          onClose={() => setFollowSheet(null)}
        />
      )}

    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d0d0d' },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0d0d0d' },

  header: {
    paddingTop: 56, paddingBottom: 14, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
  },
  title:         { fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  unreadLabel:   { color: '#ff4500', fontSize: 12, fontWeight: '600', marginTop: 2 },
  headerActions: { flexDirection: 'row', gap: 8, paddingBottom: 2 },
  markAllBtn: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 14, borderWidth: 1, borderColor: '#2a2a2a',
    backgroundColor: '#161616',
  },
  markAllText: { color: '#888', fontSize: 12, fontWeight: '500' },
  clearAllBtn: { borderColor: '#3a1a1a', backgroundColor: '#1a0a0a' },

  swipeHint: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 16, paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: '#111',
  },
  swipeHintText: { color: '#444', fontSize: 11, fontStyle: 'italic' },

  sectionHeader: {
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6,
    backgroundColor: '#0d0d0d',
  },
  sectionHeaderText: {
    color: '#555', fontSize: 12, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 1,
  },

  listContent:    { paddingBottom: 120 },
  emptyContainer: { flex: 1 },

  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 13, paddingLeft: 16, paddingRight: 12,
    borderBottomWidth: 1, borderBottomColor: '#111',
    backgroundColor: '#0d0d0d',
  },
  rowUnread:  { backgroundColor: '#110800' },
  unreadBar: {
    position: 'absolute', left: 0, top: 0, bottom: 0,
    width: 3, backgroundColor: '#ff4500', borderRadius: 2,
  },

  // Avatar area (holds stack OR single + badge)
  avatarArea: { position: 'relative', marginRight: 2 },
  avatarWrap: { position: 'relative' },
  avatar:     { width: 48, height: 48, borderRadius: 24 },
  avatarPlaceholder: { backgroundColor: '#1e1e2e', justifyContent: 'center', alignItems: 'center' },
  iconBadge: {
    position: 'absolute', bottom: -2, right: -2,
    width: 18, height: 18, borderRadius: 9,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: '#0d0d0d',
  },

  rowBody:        { flex: 1, marginHorizontal: 12 },
  rowText:        { color: '#ddd', fontSize: 14, lineHeight: 20 },
  rowTextMuted:   { color: '#aaa', fontWeight: '400' },
  bold:           { fontWeight: '700', color: '#fff' },
  messagePreview: { color: '#666', fontSize: 13, marginTop: 2, fontStyle: 'italic' },

  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  timeText: { color: '#555', fontSize: 12 },

  // "3" pill badge shown next to timestamp for grouped rows
  countBadge: {
    backgroundColor: '#1e1e1e',
    borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 1, borderColor: '#333',
  },
  countBadgeText: { color: '#888', fontSize: 11, fontWeight: '600' },

  postThumb:  { width: 48, height: 48, borderRadius: 8 },
  unreadDot:  { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ff4500', marginLeft: 8 },

  deleteAction:  { width: 90, justifyContent: 'center', alignItems: 'center', backgroundColor: '#c0392b' },
  deleteBtn:     { flex: 1, width: '100%', justifyContent: 'center', alignItems: 'center', gap: 4 },
  deleteBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },

  empty:         { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 120, gap: 14 },
  emptyTitle:    { color: '#fff', fontSize: 20, fontWeight: '800' },
  emptySubtitle: { color: '#555', fontSize: 14, textAlign: 'center', paddingHorizontal: 48, lineHeight: 21 },

  // ── Follow Action Sheet ──────────────────────────────────────────────────
  sheetBackdrop:          { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    backgroundColor: '#161616',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingBottom: 44, paddingTop: 6,
  },
  sheetUser:              { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 18 },
  sheetAvatar:            { width: 58, height: 58, borderRadius: 29 },
  sheetAvatarPlaceholder: { backgroundColor: '#2a2a3a', justifyContent: 'center', alignItems: 'center' },
  sheetName:              { color: '#fff', fontSize: 17, fontWeight: '700' },
  sheetSubtitle:          { color: '#888', fontSize: 13, marginTop: 2 },
  sheetDivider:           { height: 1, backgroundColor: '#222', marginHorizontal: 20, marginBottom: 8 },
  sheetBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: 16, marginTop: 8, paddingVertical: 16, paddingHorizontal: 20,
    borderRadius: 14, backgroundColor: '#ff4500',
  },
  sheetBtnFollowing:     { backgroundColor: '#1e1e1e', borderWidth: 1, borderColor: '#333' },
  sheetBtnText:          { color: '#fff', fontSize: 16, fontWeight: '700' },
  sheetBtnTextFollowing: { color: '#888' },
  sheetBtnSecondary: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: 16, marginTop: 10, paddingVertical: 16, paddingHorizontal: 20,
    borderRadius: 14, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#ff4500',
  },
  sheetBtnSecondaryText: { color: '#ff4500', fontSize: 16, fontWeight: '600' },
  sheetCancel:     { alignItems: 'center', marginTop: 14, paddingVertical: 12 },
  sheetCancelText: { color: '#555', fontSize: 15 },
});
