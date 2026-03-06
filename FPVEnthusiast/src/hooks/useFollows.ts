// src/hooks/useFollows.ts
// Handles follow / unfollow between two users.
// Requires the `follows` table from SUPABASE_ADDITIONS.sql.

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase';

export interface UseFollowsReturn {
  isFollowing: boolean;
  loading:     boolean;   // initial check
  toggling:    boolean;   // in-flight follow/unfollow
  follow:      () => Promise<void>;
  unfollow:    () => Promise<void>;
  toggle:      () => Promise<void>;
}

/**
 * @param currentUserId  The logged-in user's id.
 * @param targetUserId   The profile being viewed.
 */
export function useFollows(
  currentUserId?: string,
  targetUserId?:  string,
): UseFollowsReturn {
  const [isFollowing, setIsFollowing] = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [toggling,    setToggling]    = useState(false);

  // ── Check current follow state ─────────────────────────────────────────────
  const checkFollowing = useCallback(async () => {
    if (!currentUserId || !targetUserId || currentUserId === targetUserId) return;
    setLoading(true);
    const { data } = await supabase
      .from('follows')
      .select('id')
      .eq('follower_id',  currentUserId)
      .eq('following_id', targetUserId)
      .maybeSingle();
    setIsFollowing(!!data);
    setLoading(false);
  }, [currentUserId, targetUserId]);

  useEffect(() => { checkFollowing(); }, [checkFollowing]);

  // ── Follow ─────────────────────────────────────────────────────────────────
  const follow = useCallback(async () => {
    if (!currentUserId || !targetUserId) return;
    setToggling(true);
    setIsFollowing(true); // optimistic
    const { error } = await supabase.from('follows').insert({
      follower_id:  currentUserId,
      following_id: targetUserId,
    });
    if (error) {
      setIsFollowing(false); // rollback on failure
      console.error('[useFollows] follow:', error.message);
    }
    setToggling(false);
  }, [currentUserId, targetUserId]);

  // ── Unfollow ───────────────────────────────────────────────────────────────
  const unfollow = useCallback(async () => {
    if (!currentUserId || !targetUserId) return;
    setToggling(true);
    setIsFollowing(false); // optimistic
    const { error } = await supabase
      .from('follows')
      .delete()
      .eq('follower_id',  currentUserId)
      .eq('following_id', targetUserId);
    if (error) {
      setIsFollowing(true); // rollback on failure
      console.error('[useFollows] unfollow:', error.message);
    }
    setToggling(false);
  }, [currentUserId, targetUserId]);

  // ── Toggle ─────────────────────────────────────────────────────────────────
  const toggle = useCallback(async () => {
    if (isFollowing) await unfollow();
    else             await follow();
  }, [isFollowing, follow, unfollow]);

  return { isFollowing, loading, toggling, follow, unfollow, toggle };
}
