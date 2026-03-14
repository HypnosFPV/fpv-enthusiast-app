// src/hooks/useNotifications.ts
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface AppNotification {
  id:         string;
  user_id:    string;
  actor_id:   string | null;
  type:       'like' | 'comment' | 'follow' | 'mention' | 'reply'
            | 'challenge_voting_open' | 'challenge_voting_closing' | 'challenge_result';
  post_id:    string | null;
  comment_id: string | null;
  message:      string | null;
  challenge_id: string | null;
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

  // ── Mark multiple IDs as read (for grouped notifications) ─────────────────
  const markReadBulk = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    await supabase
      .from('notifications')
      .update({ read: true })
      .in('id', ids);
    setNotifications(prev => {
      const next = prev.map(n => ids.includes(n.id) ? { ...n, read: true } : n);
      setUnreadCount(next.filter(n => !n.read).length);
      return next;
    });
  }, []);

  // ── Delete single notification ─────────────────────────────────────────────
  const deleteNotification = useCallback(async (id: string) => {
    const { error } = await supabase.from('notifications').delete().eq('id', id);
    if (error) {
      console.warn('[useNotifications] delete blocked, marking read instead:', error.message);
      await supabase.from('notifications').update({ read: true }).eq('id', id);
    }
    setNotifications(prev => {
      const next = prev.filter(n => n.id !== id);
      setUnreadCount(next.filter(n => !n.read).length);
      return next;
    });
  }, []);

  // ── Delete multiple notifications (for grouped swipe-delete) ──────────────
  const deleteNotificationBulk = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    const { error } = await supabase
      .from('notifications')
      .delete()
      .in('id', ids);
    if (error) {
      console.warn('[useNotifications] bulk delete blocked, marking read instead:', error.message);
      await supabase.from('notifications').update({ read: true }).in('id', ids);
    }
    setNotifications(prev => {
      const next = prev.filter(n => !ids.includes(n.id));
      setUnreadCount(next.filter(n => !n.read).length);
      return next;
    });
  }, []);

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
    actorId:     string;
    type:        AppNotification['type'];
    postId?:     string;
    commentId?:  string;
    message?:    string;
  }) => {
    if (params.recipientId === params.actorId) return;
    await supabase.from('notifications').insert({
      user_id:    params.recipientId,
      actor_id:   params.actorId,
      type:       params.type,
      post_id:    params.postId    ?? null,
      comment_id: params.commentId ?? null,
      message:    params.message   ?? null,
    });
  }, []);


  // ── Notification preferences ───────────────────────────────────────────────
  const [challengePrefs, setChallengePrefs] = useState<{
    challenge_voting:  boolean;
    challenge_closing: boolean;
    challenge_results: boolean;
  } | null>(null);

  const loadPreferences = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from('notification_preferences')
      .select('challenge_voting, challenge_closing, challenge_results')
      .eq('user_id', userId)
      .single();
    if (data) setChallengePrefs(data);
  }, [userId]);

  const updatePreferences = useCallback(async (prefs: Partial<{
    challenge_voting:  boolean;
    challenge_closing: boolean;
    challenge_results: boolean;
  }>) => {
    if (!userId) return;
    await supabase
      .from('notification_preferences')
      .upsert({ user_id: userId, ...prefs, updated_at: new Date().toISOString() },
               { onConflict: 'user_id' });
    setChallengePrefs(prev => prev ? { ...prev, ...prefs } : null);
  }, [userId]);

  // ── Real-time subscription ─────────────────────────────────────────────────
  useEffect(() => {
    if (!userId) return;
    fetchNotifications();
    loadPreferences();

    const channel = supabase
      .channel(`notifications_user_${userId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        async (payload) => {
          const { data } = await supabase
            .from('notifications')
            .select(`*, actor:actor_id ( username, avatar_url ), post:post_id ( thumbnail_url, caption )`)
            .eq('id', (payload.new as { id: string }).id)
            .single();
          if (data) {
            setNotifications(prev => [data as AppNotification, ...prev]);
            setUnreadCount(prev => prev + 1);
          }
        }
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => {
          const updated = payload.new as { id: string; read: boolean };
          setNotifications(prev => {
            const next = prev.map(n => n.id === updated.id ? { ...n, read: updated.read } : n);
            setUnreadCount(next.filter(n => !n.read).length);
            return next;
          });
        }
      )
      .on('postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
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
    markReadBulk,
    deleteNotification,
    deleteNotificationBulk,
    clearAll,
    sendNotification,
    // Challenge notification preferences
    challengePrefs,
    loadPreferences,
    updatePreferences,
  };
}
