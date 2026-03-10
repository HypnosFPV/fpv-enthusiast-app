// app/(tabs)/notifications.tsx
// Full notifications screen with:
//   • Animated cycling-colour title (same style as FPV Feed)
//   • Comment/like/mention → navigates to post detail (/post/[id])
//   • Follow → Follow Back / View Profile action sheet
//   • Reply → navigates to post detail with comment_id param
//   • Section grouping: Today / Yesterday / Earlier
//   • Stagger-animated row entrance
//   • Left-border unread indicator (+ orange dot)
//   • Visual badge on each type icon
//   • Swipe-left to delete
//   • Mark all read + Clear all header buttons
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
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

// ─── Helpers ──────────────────────────────────────────────────────────────────
function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60)    return `${diff}s`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

/** Buckets notifications into Today / Yesterday / Earlier sections */
function groupByDate(notifications: AppNotification[]): Array<{ title: string; data: AppNotification[] }> {
  const now       = new Date();
  const today     = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;

  const groups: Record<string, AppNotification[]> = {
    Today:     [],
    Yesterday: [],
    Earlier:   [],
  };

  for (const n of notifications) {
    const t = new Date(n.created_at).getTime();
    if (t >= today)          groups.Today.push(n);
    else if (t >= yesterday) groups.Yesterday.push(n);
    else                     groups.Earlier.push(n);
  }

  return Object.entries(groups)
    .filter(([, data]) => data.length > 0)
    .map(([title, data]) => ({ title, data }));
}

// ─── Type metadata ─────────────────────────────────────────────────────────
const TYPE_META: Record<
  string,
  { icon: string; color: string; label: (actor: string) => string }
> = {
  like:    { icon: 'heart',            color: '#e74c3c', label: (a) => `${a} liked your post`          },
  comment: { icon: 'chatbubble',       color: '#3498db', label: (a) => `${a} commented on your post`   },
  follow:  { icon: 'person-add',       color: '#2ecc71', label: (a) => `${a} started following you`    },
  mention: { icon: 'at-circle',        color: '#f39c12', label: (a) => `${a} mentioned you`            },
  reply:   { icon: 'return-down-back', color: '#9b59b6', label: (a) => `${a} replied to your comment`  },
};

// ─── Follow Action Sheet ───────────────────────────────────────────────────────
function FollowActionSheet({
  visible, actorId, actorName, actorAvatar, currentUserId, onViewProfile, onClose,
}: {
  visible:       boolean;
  actorId:       string;
  actorName:     string;
  actorAvatar:   string | null;
  currentUserId: string;
  onViewProfile: () => void;
  onClose:       () => void;
}) {
  const { isFollowing, toggling, toggle } = useFollows(currentUserId, actorId);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose} />
      <View style={styles.sheet}>
        {/* User info */}
        <View style={styles.sheetUser}>
          {actorAvatar ? (
            <Image source={{ uri: actorAvatar }} style={styles.sheetAvatar} />
          ) : (
            <View style={[styles.sheetAvatar, styles.sheetAvatarPlaceholder]}>
              <Ionicons name="person" size={28} color="#555" />
            </View>
          )}
          <View>
            <Text style={styles.sheetName}>@{actorName}</Text>
            <Text style={styles.sheetSubtitle}>started following you</Text>
          </View>
        </View>

        <View style={styles.sheetDivider} />

        {/* Follow Back */}
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

        {/* View Profile */}
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

// ─── Swipe-to-delete action ────────────────────────────────────────────────────
function DeleteAction({
  progress,
  onDelete,
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

// ─── Notification Row ─────────────────────────────────────────────────────────
function NotifRow({
  item,
  index,
  onPress,
  onDelete,
}: {
  item:     AppNotification;
  index:    number;
  onPress:  (n: AppNotification) => void;
  onDelete: (id: string) => void;
}) {
  const swipeRef  = useRef<Swipeable>(null);
  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(18)).current;

  // Stagger-in animation on mount
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 260,
        delay: Math.min(index * 35, 350),
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 260,
        delay: Math.min(index * 35, 350),
        useNativeDriver: true,
      }),
    ]).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const meta   = TYPE_META[item.type] ?? TYPE_META.like;
  const actor  = (item.actor as any)?.username ?? 'Someone';
  const thumb  = (item.post  as any)?.thumbnail_url ?? null;
  const avatar = (item.actor as any)?.avatar_url ?? null;

  const isActionable = item.type === 'follow' || !!item.post_id;

  const handleDelete = () => {
    swipeRef.current?.close();
    onDelete(item.id);
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
          disabled={!isActionable}
        >
          {/* Left unread accent bar */}
          {!item.read && <View style={styles.unreadBar} />}

          {/* Avatar + type badge */}
          <View style={styles.avatarWrap}>
            {avatar ? (
              <Image source={{ uri: avatar }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]}>
                <Ionicons name="person" size={20} color="#555" />
              </View>
            )}
            <View style={[styles.iconBadge, { backgroundColor: meta.color }]}>
              <Ionicons name={meta.icon as any} size={10} color="#fff" />
            </View>
          </View>

          {/* Text */}
          <View style={styles.rowBody}>
            <Text style={styles.rowText} numberOfLines={2}>
              <Text style={styles.bold}>{actor}</Text>
              {' '}{meta.label(actor).replace(actor + ' ', '')}
            </Text>
            {item.message ? (
              <Text style={styles.messagePreview} numberOfLines={1}>"{item.message}"</Text>
            ) : null}
            <Text style={styles.timeText}>{timeAgo(item.created_at)}</Text>
          </View>

          {/* Post thumbnail */}
          {thumb ? (
            <Image source={{ uri: thumb }} style={styles.postThumb} resizeMode="cover" />
          ) : null}

          {/* Chevron for tappable items */}
          {isActionable && (
            <Ionicons name="chevron-forward" size={14} color="#444" style={{ marginLeft: 4 }} />
          )}

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
    markRead,
    deleteNotification,
    clearAll,
  } = useNotificationsContext();

  // ── Animated cycling title (same as FPV Feed) ─────────────────────────────
  const animValue = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.timing(animValue, {
        toValue:         1,
        duration:        3000,
        easing:          Easing.linear,
        useNativeDriver: false,
      })
    ).start();
  }, [animValue]);
  const animatedColor = animValue.interpolate({
    inputRange:  [0,        0.25,      0.5,       0.75,      1       ],
    outputRange: ['#ff4500','#ff8c00', '#ffcc00', '#ff6600', '#ff4500'],
  });

  // ── Follow action sheet state ─────────────────────────────────────────────
  const [followSheet, setFollowSheet] = useState<{
    actorId:     string;
    actorName:   string;
    actorAvatar: string | null;
  } | null>(null);

  // ── Refresh list on focus ─────────────────────────────────────────────────
  useFocusEffect(
    useCallback(() => {
      fetchNotifications();
    }, [fetchNotifications])
  );

  // ── Handle notification tap ───────────────────────────────────────────────
  const handlePress = useCallback(async (n: AppNotification) => {
    if (!n.read) await markRead(n.id);

    if (n.type === 'follow') {
      setFollowSheet({
        actorId:     n.actor_id ?? '',
        actorName:   (n.actor as any)?.username ?? 'User',
        actorAvatar: (n.actor as any)?.avatar_url ?? null,
      });
    } else if (n.post_id) {
      // comment / like / mention / reply → post detail screen
      router.push({
        pathname: '/post/[id]',
        params: {
          id: n.post_id,
          ...(n.comment_id ? { comment_id: n.comment_id } : {}),
        },
      });
    }
  }, [markRead, router]);

  const handleViewProfile = useCallback(() => {
    if (!followSheet?.actorId) return;
    setFollowSheet(null);
    router.push({ pathname: '/user/[id]', params: { id: followSheet.actorId } });
  }, [followSheet, router]);

  // ── Group by date ─────────────────────────────────────────────────────────
  const sections = groupByDate(notifications);

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
          {/* Animated cycling-colour title */}
          <Animated.Text style={[styles.title, { color: animatedColor }]}>
            Notifications
          </Animated.Text>
          {unreadCount > 0 && (
            <Text style={styles.unreadLabel}>{unreadCount} unread</Text>
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
      {notifications.length > 0 && (
        <View style={styles.swipeHint}>
          <Ionicons name="arrow-back-outline" size={12} color="#555" />
          <Text style={styles.swipeHintText}>Swipe left to delete</Text>
        </View>
      )}

      {/* ── Sectioned List ── */}
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
          keyExtractor={n => n.id}
          renderSectionHeader={({ section: { title } }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderText}>{title}</Text>
            </View>
          )}
          renderItem={({ item, index }) => (
            <NotifRow
              item={item}
              index={index}
              onPress={handlePress}
              onDelete={deleteNotification}
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
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingLeft: 16,
    paddingRight: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#111',
    backgroundColor: '#0d0d0d',
  },
  rowUnread: { backgroundColor: '#110800' },

  unreadBar: {
    position: 'absolute',
    left: 0, top: 0, bottom: 0,
    width: 3,
    backgroundColor: '#ff4500',
    borderRadius: 2,
  },

  rowBody:        { flex: 1, marginHorizontal: 12 },
  rowText:        { color: '#ddd', fontSize: 14, lineHeight: 20 },
  bold:           { fontWeight: '700', color: '#fff' },
  messagePreview: { color: '#666', fontSize: 13, marginTop: 2, fontStyle: 'italic' },
  timeText:       { color: '#555', fontSize: 12, marginTop: 4 },

  avatarWrap:        { position: 'relative' },
  avatar:            { width: 48, height: 48, borderRadius: 24 },
  avatarPlaceholder: { backgroundColor: '#1e1e2e', justifyContent: 'center', alignItems: 'center' },
  iconBadge: {
    position: 'absolute', bottom: -2, right: -2,
    width: 18, height: 18, borderRadius: 9,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: '#0d0d0d',
  },

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
    marginHorizontal: 16, marginTop: 8,
    paddingVertical: 16, paddingHorizontal: 20,
    borderRadius: 14, backgroundColor: '#ff4500',
  },
  sheetBtnFollowing:     { backgroundColor: '#1e1e1e', borderWidth: 1, borderColor: '#333' },
  sheetBtnText:          { color: '#fff', fontSize: 16, fontWeight: '700' },
  sheetBtnTextFollowing: { color: '#888' },

  sheetBtnSecondary: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: 16, marginTop: 10,
    paddingVertical: 16, paddingHorizontal: 20,
    borderRadius: 14, backgroundColor: '#1a1a1a',
    borderWidth: 1, borderColor: '#ff4500',
  },
  sheetBtnSecondaryText: { color: '#ff4500', fontSize: 16, fontWeight: '600' },

  sheetCancel:     { alignItems: 'center', marginTop: 14, paddingVertical: 12 },
  sheetCancelText: { color: '#555', fontSize: 15 },
});
