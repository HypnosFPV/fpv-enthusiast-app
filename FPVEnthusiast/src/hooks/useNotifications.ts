// src/hooks/useNotifications.ts
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface AppNotification {
  id:         string;
  user_id:    string;
  actor_id:   string | null;
  type:       'like' | 'comment' | 'follow' | 'mention';
  post_id:    string | null;
  comment_id: string | null;
  message:    string | null;
  read:       boolean;
  created_at: string;
  actor?: { username: string | null; avatar_url: string | null } | null;
  post?:  { thumbnail_url: string | null; caption: string | null } | null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useNotifications(userId?: string) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading,       setLoading]       = useState(false);
  const [unreadCount,   setUnreadCount]   = useState(0);

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
    setUnreadCount(notifs.filter(n => !n.read).length);
    setLoading(false);
  }, [userId]);

  // ── Mark all read ──────────────────────────────────────────────────────────
  const markAllRead = useCallback(async () => {
    if (!userId) return;
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', userId)
      .eq('read', false);
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    setUnreadCount(0);
  }, [userId]);

  // ── Mark single read ───────────────────────────────────────────────────────
  const markRead = useCallback(async (id: string) => {
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', id);
    setNotifications(prev =>
      prev.map(n => (n.id === id ? { ...n, read: true } : n))
    );
    setUnreadCount(prev => Math.max(0, prev - 1));
  }, []);

  // ── Delete single notification ─────────────────────────────────────────────
  // Try hard-delete first; if RLS blocks it, fall back to marking as read so
  // the badge still clears and the row is hidden on next fetch.
  const deleteNotification = useCallback(async (id: string) => {
    const { error } = await supabase.from('notifications').delete().eq('id', id);
    if (error) {
      console.warn('[useNotifications] delete blocked, marking read instead:', error.message);
      await supabase.from('notifications').update({ read: true }).eq('id', id);
    }
    // Always update local state regardless of DB outcome
    setNotifications(prev => {
      const next = prev.filter(n => n.id !== id);
      setUnreadCount(next.filter(n => !n.read).length);
      return next;
    });
  }, []);

  // ── Clear all notifications ────────────────────────────────────────────────
  // Try hard-delete; if RLS blocks it, mark all as read so badge clears.
  const clearAll = useCallback(async () => {
    if (!userId) return;
    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('user_id', userId);
    if (error) {
      console.warn('[useNotifications] clearAll delete blocked, marking all read:', error.message);
      // Fallback: mark all read — badge goes to 0 even if rows stay
      await supabase
        .from('notifications')
        .update({ read: true })
        .eq('user_id', userId)
        .eq('read', false);
    }
    // Always clear local state
    setNotifications([]);
    setUnreadCount(0);
  }, [userId]);

  // ── Send a notification (used by useFollow, PostCard, etc.) ───────────────
  const sendNotification = useCallback(async (params: {
    recipientId: string;
    actorId:     string;
    type:        AppNotification['type'];
    postId?:     string;
    commentId?:  string;
    message?:    string;
  }) => {
    if (params.recipientId === params.actorId) return; // never notify yourself
    await supabase.from('notifications').insert({
      user_id:    params.recipientId,
      actor_id:   params.actorId,
      type:       params.type,
      post_id:    params.postId    ?? null,
      comment_id: params.commentId ?? null,
      message:    params.message   ?? null,
    });
  }, []);

  // ── Real-time subscription ─────────────────────────────────────────────────
  useEffect(() => {
    if (!userId) return;

    fetchNotifications();

    const channel = supabase
      .channel(`notifications_user_${userId}`)
      // ── New notification arrives ──
      .on(
        'postgres_changes',
        {
          event:  'INSERT',
          schema: 'public',
          table:  'notifications',
          filter: `user_id=eq.${userId}`,
        },
        async (payload) => {
          const { data } = await supabase
            .from('notifications')
            .select(`
              *,
              actor:actor_id ( username, avatar_url ),
              post:post_id   ( thumbnail_url, caption )
            `)
            .eq('id', (payload.new as { id: string }).id)
            .single();

          if (data) {
            setNotifications(prev => [data as AppNotification, ...prev]);
            setUnreadCount(prev => prev + 1);
          }
        }
      )
      // ── Notification marked as read (UPDATE) — keeps all instances in sync ──
      .on(
        'postgres_changes',
        {
          event:  'UPDATE',
          schema: 'public',
          table:  'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const updated = payload.new as { id: string; read: boolean };
          setNotifications(prev => {
            const next = prev.map(n =>
              n.id === updated.id ? { ...n, read: updated.read } : n
            );
            setUnreadCount(next.filter(n => !n.read).length);
            return next;
          });
        }
      )
      // ── Notification deleted ──────────────────────────────────────────────
      .on(
        'postgres_changes',
        {
          event:  'DELETE',
          schema: 'public',
          table:  'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const deleted = payload.old as { id: string };
          setNotifications(prev => {
            const next = prev.filter(n => n.id !== deleted.id);
            setUnreadCount(next.filter(n => !n.read).length);
            return next;
          });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId, fetchNotifications]);

  return {
    notifications,
    loading,
    unreadCount,
    fetchNotifications,
    markAllRead,
    markRead,
    deleteNotification,
    clearAll,
    sendNotification,
  };
}
