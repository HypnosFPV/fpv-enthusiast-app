// src/hooks/useFollow.ts
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase';

export interface FollowUser {
  id: string;
  username: string;
  avatar_url?: string | null;
}

export function useFollow(profileUserId: string, currentUserId?: string) {
  const [isFollowing,    setIsFollowing]    = useState(false);
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [toggling,       setToggling]       = useState(false);
  const [checkingFollow, setCheckingFollow] = useState(true);

  const isOwnProfile = !!currentUserId && currentUserId === profileUserId;

  // ── FIX: query follows table directly instead of stale cached counts ────────
  useEffect(() => {
    if (!profileUserId) return;
    Promise.all([
      supabase
        .from('follows')
        .select('*', { count: 'exact', head: true })
        .eq('following_id', profileUserId),
      supabase
        .from('follows')
        .select('*', { count: 'exact', head: true })
        .eq('follower_id', profileUserId),
    ]).then(([{ count: fc }, { count: fing }]) => {
      setFollowersCount(fc ?? 0);
      setFollowingCount(fing ?? 0);
    });
  }, [profileUserId]);

  // ── check whether current user already follows ────────────────────────────
  useEffect(() => {
    if (!currentUserId || isOwnProfile) {
      setCheckingFollow(false);
      return;
    }
    supabase
      .from('follows')
      .select('id')
      .eq('follower_id', currentUserId)
      .eq('following_id', profileUserId)
      .maybeSingle()
      .then(({ data }) => {
        setIsFollowing(!!data);
        setCheckingFollow(false);
      });
  }, [currentUserId, profileUserId, isOwnProfile]);

  // ── follow / unfollow ─────────────────────────────────────────────────────
  const toggleFollow = useCallback(async () => {
    if (!currentUserId || toggling || isOwnProfile) return;
    setToggling(true);

    if (isFollowing) {
      await supabase
        .from('follows')
        .delete()
        .eq('follower_id', currentUserId)
        .eq('following_id', profileUserId);
      setIsFollowing(false);
      setFollowersCount(c => Math.max(0, c - 1));
    } else {
      await supabase
        .from('follows')
        .insert({ follower_id: currentUserId, following_id: profileUserId });
      setIsFollowing(true);
      setFollowersCount(c => c + 1);

      // ── notify the person being followed ─────────────────────────────────
      await supabase.from('notifications').insert({
        user_id:    profileUserId,  // recipient
        actor_id:   currentUserId,  // who followed
        type:       'follow',
        post_id:    null,
        comment_id: null,
        message:    null,
      });
    }

    setToggling(false);
  }, [currentUserId, profileUserId, isFollowing, toggling, isOwnProfile]);

  // ── fetch followers list (owner only — RLS enforces this) ─────────────────
  const fetchFollowers = useCallback(async (): Promise<FollowUser[]> => {
    const { data: rows } = await supabase
      .from('follows')
      .select('follower_id')
      .eq('following_id', profileUserId);
    if (!rows?.length) return [];
    const ids = rows.map(r => r.follower_id);
    const { data: users } = await supabase
      .from('users')
      .select('id, username, avatar_url')
      .in('id', ids);
    return (users ?? []) as FollowUser[];
  }, [profileUserId]);

  // ── fetch following list (owner only) ─────────────────────────────────────
  const fetchFollowing = useCallback(async (): Promise<FollowUser[]> => {
    const { data: rows } = await supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', profileUserId);
    if (!rows?.length) return [];
    const ids = rows.map(r => r.following_id);
    const { data: users } = await supabase
      .from('users')
      .select('id, username, avatar_url')
      .in('id', ids);
    return (users ?? []) as FollowUser[];
  }, [profileUserId]);

  // ── remove a follower (kick someone who follows YOU) ──────────────────────
  const removeFollower = useCallback(async (followerId: string) => {
    await supabase
      .from('follows')
      .delete()
      .eq('follower_id', followerId)
      .eq('following_id', profileUserId);
    setFollowersCount(c => Math.max(0, c - 1));
  }, [profileUserId]);

  // ── unfollow from your own following list ──────────────────────────────────
  const unfollowUser = useCallback(async (followingId: string) => {
    if (!currentUserId) return;
    await supabase
      .from('follows')
      .delete()
      .eq('follower_id', currentUserId)
      .eq('following_id', followingId);
    setFollowingCount(c => Math.max(0, c - 1));
  }, [currentUserId]);

  return {
    isFollowing,
    followersCount,
    followingCount,
    setFollowersCount,
    setFollowingCount,
    toggling,
    checkingFollow,
    isOwnProfile,
    toggleFollow,
    fetchFollowers,
    fetchFollowing,
    removeFollower,
    unfollowUser,
  };
}
