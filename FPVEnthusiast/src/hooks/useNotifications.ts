// src/hooks/useNotifications.ts
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { insertAppNotification, NotificationType } from '../utils/notificationHelpers';

export interface NotificationPreferences {
  challenge_voting: boolean;
  challenge_closing: boolean;
  challenge_results: boolean;
  social_activity: boolean;
  marketplace_activity: boolean;
  group_activity: boolean;
  reward_activity: boolean;
}

const DEFAULT_NOTIFICATION_PREFS: NotificationPreferences = {
  challenge_voting: true,
  challenge_closing: true,
  challenge_results: true,
  social_activity: true,
  marketplace_activity: true,
  group_activity: true,
  reward_activity: true,
};

// ─── Types ────────────────────────────────────────────────────────────────────
export interface AppNotification {
  id:          string;
  user_id:     string;
  actor_id:    string | null;
  type:        NotificationType;
  post_id:      string | null;
  comment_id:   string | null;
  listing_id:   string | null;
  entity_id:    string | null;
  entity_type:  string | null;
  challenge_id: string | null;
  message:      string | null;
  title?:       string | null;
  body?:        string | null;
  data?:        Record<string, any> | null;
  read:         boolean;
  created_at:   string;
  actor?: { username: string | null; avatar_url: string | null } | null;
  post?:  { thumbnail_url: string | null; caption: string | null } | null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useNotifications(userId?: string) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPreferences | null>(null);

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchNotifications = useCallback(async () => {
    if (!userId) return;
    setLoading(true);

    const { data, error } = await supabase
      .from('notifications')
      .select(`
        *,
        actor:actor_id ( username, avatar_url ),
        post:post_id   ( thumbnail_url, caption )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) console.error('[useNotifications] fetch:', error.message);

    const notifs = (data as AppNotification[]) ?? [];
    setNotifications(notifs);
    setUnreadCount(notifs.filter((n) => !n.read).length);
    setLoading(false);
  }, [userId]);

  // ── Mark all read ──────────────────────────────────────────────────────────
  const markAllRead = useCallback(async () => {
    if (!userId) return false;
    const unreadIds = notifications.filter((n) => !n.read).map((n) => n.id);
    if (!unreadIds.length) return true;

    const { data, error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', userId)
      .eq('read', false)
      .select('id');
    if (error) {
      console.warn('[useNotifications] markAllRead failed:', error.message);
      return false;
    }

    const updatedIds = new Set(((data as Array<{ id: string }> | null) ?? []).map((row) => row.id));
    if (!updatedIds.size) {
      console.warn('[useNotifications] markAllRead updated 0 rows; check notifications UPDATE policy', { userId, unreadIds });
      return false;
    }

    setNotifications((prev) => prev.map((n) => (updatedIds.has(n.id) ? { ...n, read: true } : n)));
    setUnreadCount((prev) => Math.max(0, prev - updatedIds.size));
    return true;
  }, [notifications, userId]);

  // ── Mark single read ───────────────────────────────────────────────────────
  const markRead = useCallback(async (id: string) => {
    if (!userId || !id) return false;
    const { data, error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', userId)
      .eq('id', id)
      .select('id');
    if (error) {
      console.warn('[useNotifications] markRead failed:', error.message, { id });
      return false;
    }

    const updatedIds = new Set(((data as Array<{ id: string }> | null) ?? []).map((row) => row.id));
    if (!updatedIds.has(id)) {
      console.warn('[useNotifications] markRead updated 0 rows; check notifications UPDATE policy', { id, userId });
      return false;
    }

    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
    setUnreadCount((prev) => Math.max(0, prev - 1));
    return true;
  }, [userId]);

  // ── Mark multiple IDs as read (for grouped notifications) ─────────────────
  const markReadBulk = useCallback(async (ids: string[]) => {
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
    if (!userId || !uniqueIds.length) return false;
    const { data, error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', userId)
      .in('id', uniqueIds)
      .select('id');
    if (error) {
      console.warn('[useNotifications] markReadBulk failed:', error.message, { ids: uniqueIds });
      return false;
    }

    const updatedIds = new Set(((data as Array<{ id: string }> | null) ?? []).map((row) => row.id));
    if (!updatedIds.size) {
      console.warn('[useNotifications] markReadBulk updated 0 rows; check notifications UPDATE policy', { ids: uniqueIds, userId });
      return false;
    }

    setNotifications((prev) => {
      const next = prev.map((n) => updatedIds.has(n.id) ? { ...n, read: true } : n);
      setUnreadCount(next.filter((n) => !n.read).length);
      return next;
    });
    return true;
  }, [userId]);

  // ── Delete single notification ─────────────────────────────────────────────
  const deleteNotification = useCallback(async (id: string) => {
    if (!userId || !id) return;
    const { data, error } = await supabase.from('notifications').delete().eq('user_id', userId).eq('id', id).select('id');
    if (error) {
      console.warn('[useNotifications] delete blocked, marking read instead:', error.message);
      await supabase.from('notifications').update({ read: true }).eq('user_id', userId).eq('id', id);
    }
    const deletedIds = new Set(((data as Array<{ id: string }> | null) ?? []).map((row) => row.id));
    if (!deletedIds.size && !error) {
      console.warn('[useNotifications] delete updated 0 rows; check notifications DELETE policy', { id, userId });
      return;
    }
    setNotifications((prev) => {
      const next = prev.filter((n) => n.id !== id);
      setUnreadCount(next.filter((n) => !n.read).length);
      return next;
    });
  }, [userId]);

  // ── Delete multiple notifications (for grouped swipe-delete) ──────────────
  const deleteNotificationBulk = useCallback(async (ids: string[]) => {
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
    if (!userId || !uniqueIds.length) return;
    const { data, error } = await supabase
      .from('notifications')
      .delete()
      .eq('user_id', userId)
      .in('id', uniqueIds)
      .select('id');
    if (error) {
      console.warn('[useNotifications] bulk delete blocked, marking read instead:', error.message);
      await supabase.from('notifications').update({ read: true }).eq('user_id', userId).in('id', uniqueIds);
    }
    const deletedIds = new Set(((data as Array<{ id: string }> | null) ?? []).map((row) => row.id));
    if (!deletedIds.size && !error) {
      console.warn('[useNotifications] deleteNotificationBulk deleted 0 rows; check notifications DELETE policy', { ids: uniqueIds, userId });
      return;
    }
    setNotifications((prev) => {
      const next = prev.filter((n) => !deletedIds.has(n.id));
      setUnreadCount(next.filter((n) => !n.read).length);
      return next;
    });
  }, [userId]);

  // ── Clear all notifications ────────────────────────────────────────────────
  const clearAll = useCallback(async () => {
    if (!userId) return;
    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('user_id', userId);
    if (error) {
      console.warn('[useNotifications] clearAll delete blocked, marking all read:', error.message);
      await supabase
        .from('notifications')
        .update({ read: true })
        .eq('user_id', userId)
        .eq('read', false);
    }
    setNotifications([]);
    setUnreadCount(0);
  }, [userId]);

  // ── Send a notification ────────────────────────────────────────────────────
  const sendNotification = useCallback(async (params: {
    recipientId: string;
    actorId?:    string | null;
    type:        AppNotification['type'];
    postId?:     string;
    commentId?:  string;
    message?:    string;
    title?:      string;
    body?:       string;
    entityId?:   string;
    entityType?: string;
    listingId?:  string;
    challengeId?: string;
    data?:       Record<string, any> | null;
  }) => {
    await insertAppNotification(params);
  }, []);

  // ── Notification preferences ───────────────────────────────────────────────
  const loadPreferences = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from('notification_preferences')
      .select('challenge_voting, challenge_closing, challenge_results, social_activity, marketplace_activity, group_activity, reward_activity')
      .eq('user_id', userId)
      .single();
    if (data) {
      setNotificationPrefs({ ...DEFAULT_NOTIFICATION_PREFS, ...(data as Partial<NotificationPreferences>) });
    }
  }, [userId]);

  const updatePreferences = useCallback(async (prefs: Partial<NotificationPreferences>) => {
    if (!userId) return;
    await supabase
      .from('notification_preferences')
      .upsert({ user_id: userId, ...prefs, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    setNotificationPrefs((prev) => ({ ...(prev ?? DEFAULT_NOTIFICATION_PREFS), ...prefs }));
  }, [userId]);

  // ── Real-time subscription ─────────────────────────────────────────────────
  useEffect(() => {
    if (!userId) return;
    fetchNotifications();
    loadPreferences();

    const channel = supabase
      .channel(`notifications_user_${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        async (payload) => {
          const { data } = await supabase
            .from('notifications')
            .select(`*, actor:actor_id ( username, avatar_url ), post:post_id ( thumbnail_url, caption )`)
            .eq('id', (payload.new as { id: string }).id)
            .single();
          if (data) {
            setNotifications((prev) => [data as AppNotification, ...prev]);
            setUnreadCount((prev) => prev + 1);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => {
          const updated = payload.new as { id: string; read: boolean };
          setNotifications((prev) => {
            const next = prev.map((n) => n.id === updated.id ? { ...n, read: updated.read } : n);
            setUnreadCount(next.filter((n) => !n.read).length);
            return next;
          });
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => {
          const deleted = payload.old as { id: string };
          setNotifications((prev) => {
            const next = prev.filter((n) => n.id !== deleted.id);
            setUnreadCount(next.filter((n) => !n.read).length);
            return next;
          });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId, fetchNotifications, loadPreferences]);

  return {
    notifications,
    loading,
    unreadCount,
    fetchNotifications,
    markAllRead,
    markRead,
    markReadBulk,
    deleteNotification,
    deleteNotificationBulk,
    clearAll,
    sendNotification,
    notificationPrefs,
    challengePrefs: notificationPrefs,
    loadPreferences,
    updatePreferences,
  };
}
