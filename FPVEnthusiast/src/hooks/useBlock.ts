// src/hooks/useBlock.ts
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase';

export interface BlockedUser {
  id: string;
  username: string;
  avatar_url?: string | null;
}

export function useBlock(currentUserId?: string) {
  const [blockedIds, setBlockedIds] = useState<string[]>([]);
  const [loading,    setLoading]    = useState(false);

  // load all blocked ids on mount
  useEffect(() => {
    if (!currentUserId) return;
    supabase
      .from('blocks')
      .select('blocked_id')
      .eq('blocker_id', currentUserId)
      .then(({ data }) => setBlockedIds(data?.map(r => r.blocked_id) ?? []));
  }, [currentUserId]);

  const isBlocked = useCallback(
    (userId: string) => blockedIds.includes(userId),
    [blockedIds],
  );

  const blockUser = useCallback(async (targetId: string) => {
    if (!currentUserId || loading) return;
    setLoading(true);
    // 1. insert block row
    await supabase.from('blocks').insert({ blocker_id: currentUserId, blocked_id: targetId });
    // 2. remove any follow in both directions
    await Promise.all([
      supabase.from('follows').delete()
        .eq('follower_id', currentUserId).eq('following_id', targetId),
      supabase.from('follows').delete()
        .eq('follower_id', targetId).eq('following_id', currentUserId),
    ]);
    setBlockedIds(prev => [...prev, targetId]);
    setLoading(false);
  }, [currentUserId, loading]);

  const unblockUser = useCallback(async (targetId: string) => {
    if (!currentUserId || loading) return;
    setLoading(true);
    await supabase.from('blocks').delete()
      .eq('blocker_id', currentUserId).eq('blocked_id', targetId);
    setBlockedIds(prev => prev.filter(id => id !== targetId));
    setLoading(false);
  }, [currentUserId, loading]);

  const fetchBlockedUsers = useCallback(async (): Promise<BlockedUser[]> => {
    if (!currentUserId) return [];
    const { data: rows } = await supabase
      .from('blocks').select('blocked_id').eq('blocker_id', currentUserId);
    if (!rows?.length) return [];
    const { data: users } = await supabase
      .from('users').select('id, username, avatar_url')
      .in('id', rows.map(r => r.blocked_id));
    return (users ?? []) as BlockedUser[];
  }, [currentUserId]);

  return { blockedIds, isBlocked, blockUser, unblockUser, fetchBlockedUsers, loading };
}