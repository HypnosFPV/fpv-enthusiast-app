// app/(tabs)/notifications.tsx
import React, { useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  Image, ActivityIndicator, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../src/context/AuthContext';
import { useNotifications, AppNotification } from '../../src/hooks/useNotifications';

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

// ─── Notification Row ─────────────────────────────────────────────────────────
function NotifRow({
  item,
  onPress,
}: {
  item: AppNotification;
  onPress: (n: AppNotification) => void;
}) {
  const meta   = TYPE_META[item.type] ?? TYPE_META.like;
  const actor  = (item.actor as any)?.username ?? 'Someone';
  const thumb  = (item.post  as any)?.thumbnail_url ?? null;
  const avatar = (item.actor as any)?.avatar_url ?? null;

  return (
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
  } = useNotifications(user?.id);

  // ── Mark all read + clear badge as soon as screen is opened ──────────────
  useFocusEffect(
    useCallback(() => {
      if (unreadCount > 0) markAllRead();
    }, [unreadCount, markAllRead])
  );

  const handlePress = useCallback(async (n: AppNotification) => {
    if (!n.read) await markRead(n.id);

    if (n.type === 'follow') {
      // ── FIX: navigate by username via /profile/[username] ────────────────
      const username = (n.actor as any)?.username;
      if (username) {
        router.push({ pathname: '/profile/[username]', params: { username } });
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
        {unreadCount > 0 && (
          <TouchableOpacity style={styles.markAllBtn} onPress={markAllRead}>
            <Text style={styles.markAllText}>Mark all read</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── List ── */}
      <FlatList
        data={notifications}
        keyExtractor={n => n.id}
        renderItem={({ item }) => (
          <NotifRow item={item} onPress={handlePress} />
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

  header:      { paddingTop: 56, paddingBottom: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#1a1a1a', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title:       { color: '#fff', fontSize: 22, fontWeight: '800' },
  markAllBtn:  { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: '#333' },
  markAllText: { color: '#888', fontSize: 13 },

  listContent:    { paddingBottom: 100 },
  emptyContainer: { flex: 1 },

  row:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#111' },
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

  empty:         { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 120, gap: 12 },
  emptyTitle:    { color: '#fff', fontSize: 18, fontWeight: '700' },
  emptySubtitle: { color: '#666', fontSize: 14, textAlign: 'center', paddingHorizontal: 40 },
});
