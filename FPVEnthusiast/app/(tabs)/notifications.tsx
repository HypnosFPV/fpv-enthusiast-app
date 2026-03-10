// app/(tabs)/notifications.tsx
import React, { useCallback, useRef } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  Image, ActivityIndicator, RefreshControl, Animated,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../src/context/AuthContext';
import { AppNotification } from '../../src/hooks/useNotifications';
import { useNotificationsContext } from '../../src/context/NotificationsContext';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60)    return `${diff}s`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

const TYPE_META: Record<
  string,
  { icon: string; color: string; label: (actor: string) => string }
> = {
  like:    { icon: 'heart',      color: '#e74c3c', label: (a) => `${a} liked your post`        },
  comment: { icon: 'chatbubble', color: '#3498db', label: (a) => `${a} commented on your post` },
  follow:  { icon: 'person-add', color: '#2ecc71', label: (a) => `${a} started following you`  },
  mention: { icon: 'at-circle',  color: '#f39c12', label: (a) => `${a} mentioned you`          },
};

// ─── Swipe-to-delete action ────────────────────────────────────────────────────
function DeleteAction({ progress, onDelete }: { progress: Animated.AnimatedInterpolation<number>; onDelete: () => void }) {
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
  onPress,
  onDelete,
}: {
  item: AppNotification;
  onPress: (n: AppNotification) => void;
  onDelete: (id: string) => void;
}) {
  const swipeRef = useRef<Swipeable>(null);
  const meta   = TYPE_META[item.type] ?? TYPE_META.like;
  const actor  = (item.actor as any)?.username ?? 'Someone';
  const thumb  = (item.post  as any)?.thumbnail_url ?? null;
  const avatar = (item.actor as any)?.avatar_url ?? null;

  const handleDelete = () => {
    swipeRef.current?.close();
    onDelete(item.id);
  };

  return (
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
          <Text style={styles.timeText}>{timeAgo(item.created_at)}</Text>
        </View>

        {/* Post thumbnail if available */}
        {thumb ? (
          <Image source={{ uri: thumb }} style={styles.postThumb} resizeMode="cover" />
        ) : null}

        {/* Unread dot */}
        {!item.read && <View style={styles.unreadDot} />}
      </TouchableOpacity>
    </Swipeable>
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

  // ── FIX: fetch fresh data then mark all read whenever screen is focused ────
  useFocusEffect(
    useCallback(() => {
      fetchNotifications().then(() => markAllRead());
    }, [fetchNotifications, markAllRead])
  );

  // ── FIX: navigate to user profile by actor_id (not username route) ─────────
  const handlePress = useCallback(async (n: AppNotification) => {
    if (!n.read) await markRead(n.id);

    if (n.type === 'follow') {
      const actorId = n.actor_id;
      if (actorId) {
        router.push({ pathname: '/user/[id]', params: { id: actorId } });
      }
    } else if (n.post_id) {
      // like / comment / mention — go to feed
      // swap for router.push(`/post/${n.post_id}`) when you add a post detail route
      router.push('/(tabs)/feed' as any);
    }
  }, [markRead, router]);

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
        <Text style={styles.title}>Notifications</Text>
        <View style={styles.headerActions}>
          {unreadCount > 0 && (
            <TouchableOpacity style={styles.markAllBtn} onPress={markAllRead}>
              <Text style={styles.markAllText}>Mark all read</Text>
            </TouchableOpacity>
          )}
          {notifications.length > 0 && (
            <TouchableOpacity style={[styles.markAllBtn, styles.clearAllBtn]} onPress={clearAll}>
              <Ionicons name="trash-outline" size={13} color="#888" style={{ marginRight: 4 }} />
              <Text style={styles.markAllText}>Clear all</Text>
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

      {/* ── List ── */}
      <FlatList
        data={notifications}
        keyExtractor={n => n.id}
        renderItem={({ item }) => (
          <NotifRow
            item={item}
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
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="notifications-off-outline" size={60} color="#333" />
            <Text style={styles.emptyTitle}>No notifications yet</Text>
            <Text style={styles.emptySubtitle}>
              When someone likes, comments, or follows you — it shows up here.
            </Text>
          </View>
        }
        contentContainerStyle={
          notifications.length === 0 ? styles.emptyContainer : styles.listContent
        }
        showsVerticalScrollIndicator={false}
      />

    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d0d0d' },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0d0d0d' },

  header:        { paddingTop: 56, paddingBottom: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#1a1a1a', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title:         { color: '#fff', fontSize: 22, fontWeight: '800' },
  headerActions: { flexDirection: 'row', gap: 8 },
  markAllBtn:    { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: '#333' },
  markAllText:   { color: '#888', fontSize: 13 },
  clearAllBtn:   { borderColor: '#3a1a1a' },

  swipeHint:     { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 16, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#111' },
  swipeHintText: { color: '#555', fontSize: 11 },

  listContent:    { paddingBottom: 100 },
  emptyContainer: { flex: 1 },

  row:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#111', backgroundColor: '#0d0d0d' },
  rowUnread: { backgroundColor: '#1a0a00' },
  rowBody:   { flex: 1, marginHorizontal: 12 },
  rowText:   { color: '#ddd', fontSize: 14, lineHeight: 20 },
  bold:      { fontWeight: '700', color: '#fff' },
  timeText:  { color: '#666', fontSize: 12, marginTop: 3 },

  avatarWrap:        { position: 'relative' },
  avatar:            { width: 46, height: 46, borderRadius: 23 },
  avatarPlaceholder: { backgroundColor: '#1e1e2e', justifyContent: 'center', alignItems: 'center' },
  iconBadge:         { position: 'absolute', bottom: -2, right: -2, width: 18, height: 18, borderRadius: 9, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#0d0d0d' },

  postThumb:  { width: 46, height: 46, borderRadius: 6 },
  unreadDot:  { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ff4500', marginLeft: 8 },

  // Swipe delete action
  deleteAction: { width: 90, justifyContent: 'center', alignItems: 'center', backgroundColor: '#c0392b' },
  deleteBtn:    { flex: 1, width: '100%', justifyContent: 'center', alignItems: 'center', gap: 4 },
  deleteBtnText:{ color: '#fff', fontSize: 12, fontWeight: '600' },

  empty:         { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 120, gap: 12 },
  emptyTitle:    { color: '#fff', fontSize: 18, fontWeight: '700' },
  emptySubtitle: { color: '#666', fontSize: 14, textAlign: 'center', paddingHorizontal: 40 },
});
