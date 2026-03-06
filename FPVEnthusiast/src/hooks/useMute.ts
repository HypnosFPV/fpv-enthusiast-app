// src/hooks/useMute.ts
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase';

export interface MutedUser {
  id: string;
  username: string | null;
  avatar_url: string | null;
}

export function useMute(currentUserId?: string) {
  const [mutedIds,   setMutedIds]   = useState<string[]>([]);
  const [mutedUsers, setMutedUsers] = useState<MutedUser[]>([]);
  const [loading,    setLoading]    = useState(false);

  const fetchMutedUsers = useCallback(async () => {
    if (!currentUserId) return;
    setLoading(true);

    const { data, error } = await supabase
      .from('mutes')
      .select(`
        muted_id,
        muted:muted_id ( id, username, avatar_url )
      `)
      .eq('muter_id', currentUserId);

    if (error) console.error('[useMute] fetch:', error.message);

    const users: MutedUser[] = (data ?? []).map((row: any) => ({
      id:         row.muted?.id         ?? row.muted_id,
      username:   row.muted?.username   ?? null,
      avatar_url: row.muted?.avatar_url ?? null,
    }));

    setMutedUsers(users);
    setMutedIds(users.map(u => u.id));
    setLoading(false);
  }, [currentUserId]);

  useEffect(() => {
    fetchMutedUsers();
  }, [fetchMutedUsers]);

  const isMuted = useCallback(
    (userId: string) => mutedIds.includes(userId),
    [mutedIds],
  );

  const muteUser = useCallback(async (targetId: string) => {
    if (!currentUserId || targetId === currentUserId) return;
    const { error } = await supabase
      .from('mutes')
      .insert({ muter_id: currentUserId, muted_id: targetId });
    if (error) { console.error('[useMute] mute:', error.message); return; }
    setMutedIds(prev => [...prev, targetId]);
    await fetchMutedUsers();
  }, [currentUserId, fetchMutedUsers]);

  const unmuteUser = useCallback(async (targetId: string) => {
    if (!currentUserId) return;
    const { error } = await supabase
      .from('mutes')
      .delete()
      .eq('muter_id', currentUserId)
      .eq('muted_id', targetId);
    if (error) { console.error('[useMute] unmute:', error.message); return; }
    setMutedIds(prev => prev.filter(id => id !== targetId));
    setMutedUsers(prev => prev.filter(u => u.id !== targetId));
  }, [currentUserId]);

  return {
    mutedIds,
    mutedUsers,
    loading,
    isMuted,
    muteUser,
    unmuteUser,
    fetchMutedUsers,
  };
}
