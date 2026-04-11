// src/hooks/useFeed.ts  — with personalised feed modes
import { useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '../services/supabase';
import { decode } from 'base64-arraybuffer';
import { rankPosts, InterestProfile } from './useFeedAlgorithm';
import { insertAppNotification } from '../utils/notificationHelpers';

export type FeedMode = 'for_you' | 'following' | 'recent';

export interface FeedPost {
  id: string;
  user_id?: string | null;
  media_url?: string | null;
  media_type?: string | null;
  thumbnail_url?: string | null;
  caption?: string | null;
  social_url?: string | null;
  platform?: string | null;
  created_at?: string | null;
  group_id?: string | null;
  post_scope?: 'public' | 'group' | null;
  like_count: number;
  comment_count: number;
  isLiked: boolean;
  likes_count?: number;
  comments_count?: number;
  tags?: string[] | null;
  users?: {
    id?: string | null;
    username?: string | null;
    avatar_url?: string | null;
  } | null;
  group?: {
    id?: string | null;
    name?: string | null;
  } | null;
}

interface CreatePostParams {
  mediaUrl: string;
  mediaType: string;
  caption?: string;
  tags?: string[];
  mediaBase64?: string | null;
  thumbnailUrl?: string | null;
  groupId?: string | null;
  postScope?: 'public' | 'group';
}

interface CreateSocialPostParams {
  socialUrl: string;
  platform: string;
  caption?: string;
  tags?: string[];
  groupId?: string | null;
  postScope?: 'public' | 'group';
}

const PAGE_SIZE    = 10;
const POOL_SIZE    = 60;   // For You: fetch this many, then rank & trim

const SELECT = `
  id, user_id, media_url, media_type, thumbnail_url, caption, tags,
  social_url, platform, created_at, likes_count, comments_count,
  group_id, post_scope,
  users:user_id (id, username, avatar_url),
  group:group_id ( id, name )
`;

export function useFeed(
  currentUserId?: string,
  feedMode: FeedMode = 'recent',
  interestProfile?: InterestProfile,
) {
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);
  const [followingIds, setFollowingIds] = useState<string[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const followingIdsRef = useRef<string[]>([]);
  const groupIdsRef = useRef<string[]>([]);
  const pendingLikeIdsRef = useRef<Set<string>>(new Set());
  const interestProfileRef = useRef<InterestProfile | undefined>(interestProfile);

  useEffect(() => {
    interestProfileRef.current = interestProfile;
  }, [interestProfile]);

  function mergeIsLiked(rawPosts: any[], likedIds: string[]): FeedPost[] {
    return rawPosts.map(p => ({
      ...p,
      like_count:    p.likes_count    ?? 0,
      comment_count: p.comments_count ?? 0,
      users: Array.isArray(p.users) ? (p.users[0] ?? null) : (p.users ?? null),
      group: Array.isArray(p.group) ? (p.group[0] ?? null) : (p.group ?? null),
      isLiked: likedIds.includes(p.id),
    })) as FeedPost[];
  }

  function uniqueById<T extends { id: string }>(items: T[]): T[] {
    const seen = new Set<string>();
    return items.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }

  const applyGroupVisibility = (query: any, visibleGroupIds: string[] = groupIdsRef.current): any => {
    if (visibleGroupIds.length > 0) {
      return query.or(`group_id.is.null,group_id.in.(${visibleGroupIds.join(',')})`);
    }
    return query.is('group_id', null);
  };

  // ── Fetch the list of users the current user follows ──────────────────
  const loadFollowingIds = useCallback(async (): Promise<string[]> => {
    if (!currentUserId) {
      followingIdsRef.current = [];
      setFollowingIds([]);
      return [];
    }
    const { data } = await supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', currentUserId);
    const ids = (data ?? []).map((r: any) => r.following_id);
    followingIdsRef.current = ids;
    setFollowingIds(ids);
    return ids;
  }, [currentUserId]);

  const loadGroupIds = useCallback(async (): Promise<string[]> => {
    if (!currentUserId) {
      groupIdsRef.current = [];
      setGroupIds([]);
      return [];
    }
    const { data } = await supabase
      .from('social_group_members')
      .select('group_id')
      .eq('user_id', currentUserId);
    const ids = (data ?? []).map((row: any) => row.group_id);
    groupIdsRef.current = ids;
    setGroupIds(ids);
    return ids;
  }, [currentUserId]);

  // ── Core fetch ────────────────────────────────────────────────────────
  const fetchPosts = useCallback(async (
    pageIndex: number,
    overrides?: { groupIds?: string[]; followingIds?: string[] }
  ): Promise<FeedPost[]> => {
    const visibleGroupIds = overrides?.groupIds ?? groupIdsRef.current;
    const visibleFollowingIds = overrides?.followingIds ?? followingIdsRef.current;

    // ── A. FOR YOU: fetch a larger pool and personalise-rank it ─────────
    if (feedMode === 'for_you' && currentUserId) {
      const from = pageIndex * POOL_SIZE;
      const to   = from + POOL_SIZE - 1;

      const feedQuery = applyGroupVisibility(
        supabase
          .from('posts')
          .select(SELECT)
          .order('created_at', { ascending: false })
          .range(from, to),
        visibleGroupIds,
      );

      const { data, error } = await feedQuery;

      if (error) { console.error('[useFeed] for_you error:', error.message); return []; }
      if (!data?.length && visibleGroupIds.length === 0) return [];

      let pool = [...(data ?? [])] as any[];
      if (pageIndex === 0 && visibleGroupIds.length > 0) {
        const { data: groupPosts, error: groupPostsError } = await supabase
          .from('posts')
          .select(SELECT)
          .in('group_id', visibleGroupIds)
          .order('created_at', { ascending: false })
          .limit(12);
        if (groupPostsError) {
          console.warn('[useFeed] group boost fetch error:', groupPostsError.message);
        } else if (groupPosts?.length) {
          pool = uniqueById([...(groupPosts as any[]), ...pool]);
        }
      }
      if (!pool.length) return [];

      const { data: likes } = await supabase
        .from('likes')
        .select('post_id')
        .eq('user_id', currentUserId)
        .in('post_id', pool.map((p: any) => p.id));

      const likedIds = (likes ?? []).map((l: any) => l.post_id);
      const merged   = mergeIsLiked(pool, likedIds);

      // Rank if we have a profile, else fall back to chronological
      const profile = interestProfileRef.current ?? { tagWeights: {}, authorAffinity: {}, topTags: [], topAuthors: [], lastUpdated: 0 };
      const ranked  = rankPosts(merged, profile);

      if (pageIndex === 0) {
        const promotedGroups = merged
          .filter(post => !!post.group_id)
          .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime())
          .slice(0, 2);
        return uniqueById([...promotedGroups, ...ranked]).slice(0, PAGE_SIZE);
      }

      // Each page already fetches its own chronological pool window, so return
      // the top PAGE_SIZE posts from the ranked subset for that window.
      return ranked.slice(0, PAGE_SIZE);
    }

    // ── B. FOLLOWING: only posts from people the user follows ────────────
    if (feedMode === 'following' && currentUserId) {
      const ids = visibleFollowingIds.length > 0 ? visibleFollowingIds : [];
      if (!ids.length) return [];

      const from = pageIndex * PAGE_SIZE;
      const to   = from + PAGE_SIZE - 1;

      const feedQuery = applyGroupVisibility(
        supabase
          .from('posts')
          .select(SELECT)
          .in('user_id', ids)
          .order('created_at', { ascending: false })
          .range(from, to),
        visibleGroupIds,
      );

      const { data, error } = await feedQuery;

      if (error) { console.error('[useFeed] following error:', error.message); return []; }
      if (!data?.length) return [];

      const { data: likes } = await supabase
        .from('likes')
        .select('post_id')
        .eq('user_id', currentUserId)
        .in('post_id', data.map((p: any) => p.id));

      const likedIds = (likes ?? []).map((l: any) => l.post_id);
      return mergeIsLiked(data, likedIds);
    }

    // ── C. RECENT: chronological (original behaviour) ────────────────────
    const from = pageIndex * PAGE_SIZE;
    const to   = from + PAGE_SIZE - 1;

    const feedQuery = applyGroupVisibility(
      supabase
        .from('posts')
        .select(SELECT)
        .order('created_at', { ascending: false })
        .range(from, to),
      visibleGroupIds,
    );

    const { data, error } = await feedQuery;

    if (error) { console.error('[useFeed] fetchPosts error:', error.message); return []; }
    if (!data) return [];

    if (!currentUserId) return mergeIsLiked(data, []);

    const { data: likes } = await supabase
      .from('likes')
      .select('post_id')
      .eq('user_id', currentUserId)
      .in('post_id', data.map((p: any) => p.id));

    const likedIds = (likes ?? []).map((l: any) => l.post_id);
    return mergeIsLiked(data, likedIds);
  }, [currentUserId, feedMode]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setPage(0);
    setHasMore(true);
    const [nextFollowingIds, nextGroupIds] = await Promise.all([loadFollowingIds(), loadGroupIds()]);
    const fresh = await fetchPosts(0, { followingIds: nextFollowingIds, groupIds: nextGroupIds });
    setPosts(fresh);
    setHasMore(fresh.length === PAGE_SIZE);
    setLoading(false);
    setRefreshing(false);
  }, [fetchPosts, loadFollowingIds, loadGroupIds]);

  const loadMore = useCallback(async () => {
    // Guard: skip if initial load, pull-to-refresh, already fetching more, or no pages left
    if (loading || refreshing || loadingMore || !hasMore) return;
    setLoadingMore(true);
    const nextPage = page + 1;
    const more = await fetchPosts(nextPage);
    if (more.length > 0) {
      // Deduplicate by id in case real-time inserts shifted the window
      setPosts(prev => {
        const existingIds = new Set(prev.map(p => p.id));
        const unique = more.filter(p => !existingIds.has(p.id));
        return [...prev, ...unique];
      });
      setPage(nextPage);
    }
    // If we got fewer than PAGE_SIZE posts, there's nothing left
    setHasMore(more.length === PAGE_SIZE);
    setLoadingMore(false);
  }, [loading, refreshing, loadingMore, hasMore, page, fetchPosts]);

  const toggleLike = useCallback(async (postId: string): Promise<boolean> => {
    if (!currentUserId || pendingLikeIdsRef.current.has(postId)) return false;

    let nextLiked: boolean | null = null;
    let postOwnerId: string | null = null;

    setPosts(prev => prev.map(p => {
      if (p.id !== postId) return p;
      const wasLiked = !!p.isLiked;
      const currentCount = p.like_count ?? p.likes_count ?? 0;
      const nextCount = Math.max(0, currentCount + (wasLiked ? -1 : 1));
      nextLiked = !wasLiked;
      postOwnerId = p.user_id ?? null;
      return {
        ...p,
        isLiked: !wasLiked,
        like_count: nextCount,
        likes_count: nextCount,
      };
    }));

    if (nextLiked === null) return false;

    pendingLikeIdsRef.current.add(postId);

    try {
      if (nextLiked) {
        const { error } = await supabase.from('likes').insert({ post_id: postId, user_id: currentUserId });
        if (error) throw error;

        if (postOwnerId && postOwnerId !== currentUserId) {
          void insertAppNotification({
            recipientId: postOwnerId,
            actorId: currentUserId,
            type: 'like',
            postId,
            entityId: postId,
            entityType: 'post',
            title: '❤️ New like',
            body: 'Someone liked your post.',
            message: 'liked your post',
            data: { navigate: 'post' },
          });
        }
      } else {
        const { error } = await supabase.from('likes').delete()
          .eq('post_id', postId).eq('user_id', currentUserId);
        if (error) throw error;
      }

      return true;
    } catch (error: any) {
      console.warn('[useFeed] toggleLike rollback:', error?.message ?? error);
      setPosts(prev => prev.map(p => {
        if (p.id !== postId) return p;
        const currentCount = p.like_count ?? p.likes_count ?? 0;
        const rollbackCount = Math.max(0, currentCount + (nextLiked ? -1 : 1));
        return {
          ...p,
          isLiked: !nextLiked,
          like_count: rollbackCount,
          likes_count: rollbackCount,
        };
      }));
      return false;
    } finally {
      pendingLikeIdsRef.current.delete(postId);
    }
  }, [currentUserId]);

  const createPost = useCallback(async ({
    mediaUrl,
    mediaType,
    caption,
    tags,
    mediaBase64,
    thumbnailUrl,
    groupId,
    postScope = groupId ? 'group' : 'public',
  }: CreatePostParams) => {
    if (!currentUserId) return null;

    let finalUrl = mediaUrl;

    if (!mediaUrl.startsWith('http://') && !mediaUrl.startsWith('https://')) {
      try {
        let arrayBuffer: ArrayBuffer;
        let ext: string;
        let mime: string;

        if (mediaType === 'video') {
          ext  = mediaUrl.split('.').pop()?.split('?')[0]?.toLowerCase() ?? 'mp4';
          mime = ext === 'mov' ? 'video/quicktime' : 'video/mp4';
          console.log('[useFeed] fetching video (no compression)...');
          const resp = await fetch(mediaUrl);
          arrayBuffer = await resp.arrayBuffer();
          console.log('[useFeed] video fetch byteLength:', arrayBuffer.byteLength);

        } else if (mediaBase64) {
          arrayBuffer = decode(mediaBase64);
          ext  = 'jpg';
          mime = 'image/jpeg';
          console.log('[useFeed] using picker base64, byteLength:', arrayBuffer.byteLength);

        } else {
          ext  = mediaUrl.split('.').pop()?.split('?')[0]?.toLowerCase() ?? 'jpg';
          mime = ext === 'png'  ? 'image/png'
               : ext === 'heic' ? 'image/heic'
               : ext === 'webp' ? 'image/webp'
               : 'image/jpeg';
          const resp = await fetch(mediaUrl);
          arrayBuffer = await resp.arrayBuffer();
          console.log('[useFeed] image fetch byteLength:', arrayBuffer.byteLength);
        }

        if (arrayBuffer.byteLength === 0) {
          console.error('[useFeed] empty buffer — aborting upload');
          return null;
        }

        const storagePath = `${currentUserId}/${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('posts')
          .upload(storagePath, arrayBuffer, { contentType: mime, upsert: false });

        if (upErr) {
          console.error('[useFeed] storage upload failed:', upErr.message);
          return null;
        }

        const { data: urlData } = supabase.storage.from('posts').getPublicUrl(storagePath);
        finalUrl = urlData.publicUrl;
        console.log('[useFeed] upload success, publicUrl:', finalUrl);

      } catch (e: any) {
        console.error('[useFeed] upload exception:', e.message);
        return null;
      }
    }

    let finalThumbUrl: string | null = null;
    if (thumbnailUrl && mediaType === 'video') {
      try {
        const thumbResp = await fetch(thumbnailUrl);
        const thumbBuf  = await thumbResp.arrayBuffer();

        if (thumbBuf.byteLength > 0) {
          const thumbPath = `${currentUserId}/${Date.now()}_thumb.jpg`;
          const { error: tErr } = await supabase.storage
            .from('posts')
            .upload(thumbPath, thumbBuf, { contentType: 'image/jpeg', upsert: false });

          if (!tErr) {
            const { data: tUrlData } = supabase.storage.from('posts').getPublicUrl(thumbPath);
            finalThumbUrl = tUrlData.publicUrl;
            console.log('[useFeed] thumbnail uploaded:', finalThumbUrl);
          } else {
            console.warn('[useFeed] thumbnail upload error:', tErr.message);
          }
        }
      } catch (e: any) {
        console.warn('[useFeed] thumbnail upload failed:', e.message);
      }
    }

    const { data, error } = await supabase
      .from('posts')
      .insert({
        user_id:       currentUserId,
        media_url:     finalUrl,
        media_type:    mediaType,
        caption,
        tags:          tags?.length ? tags : null,
        thumbnail_url: finalThumbUrl,
        group_id:      groupId ?? null,
        post_scope:    groupId ? postScope : 'public',
      })
      .select(SELECT)
      .single();

    if (error) {
      console.error('[useFeed] createPost error:', JSON.stringify(error));
      return null;
    }
    if (!data) return null;

    const newPost: FeedPost = {
      ...data,
      like_count:    data.likes_count    ?? 0,
      comment_count: data.comments_count ?? 0,
      users: Array.isArray(data.users) ? (data.users[0] ?? null) : (data.users ?? null),
      group: Array.isArray(data.group) ? (data.group[0] ?? null) : (data.group ?? null),
      isLiked: false,
    };
    setPosts(prev => [newPost, ...prev]);

    // ── Props award: first post ever ─────────────────────────────────────────
    if (currentUserId) {
      try {
        await supabase.from('props_log').insert({
          user_id:      currentUserId,
          amount:       50,
          reason:       'first_post',
          reference_id: currentUserId,
        });
        // If insert succeeded (no 23505), signal the screen to show toast
        (createPost as any).__lastAward = { amount: 50, reason: 'first_post' };
      } catch (_) { /* duplicate = already awarded, ignore */ }
    }

    return newPost;
  }, [currentUserId]);

  const createSocialPost = useCallback(async ({
    socialUrl,
    platform,
    caption,
    tags,
    groupId,
    postScope = groupId ? 'group' : 'public',
  }: CreateSocialPostParams) => {
    if (!currentUserId) return null;

    const { data, error } = await supabase
      .from('posts')
      .insert({
        user_id: currentUserId,
        social_url: socialUrl,
        platform,
        caption,
        tags: tags?.length ? tags : null,
        group_id: groupId ?? null,
        post_scope: groupId ? postScope : 'public',
      })
      .select(SELECT)
      .single();

    if (error) {
      console.error('[useFeed] createSocialPost error:', JSON.stringify(error));
      return null;
    }
    if (!data) return null;

    const newPost: FeedPost = {
      ...data,
      like_count:    data.likes_count    ?? 0,
      comment_count: data.comments_count ?? 0,
      users: Array.isArray(data.users) ? (data.users[0] ?? null) : (data.users ?? null),
      group: Array.isArray(data.group) ? (data.group[0] ?? null) : (data.group ?? null),
      isLiked: false,
    };
    setPosts(prev => [newPost, ...prev]);
    return newPost;
  }, [currentUserId]);

  const deletePost = useCallback(async (postId: string): Promise<boolean> => {
    console.log('[useFeed] deleting post:', postId);
    const { error } = await supabase
      .from('posts')
      .delete()
      .eq('id', postId);

    if (error) {
      console.error('[useFeed] deletePost error:', JSON.stringify(error));
      return false;
    }

    setPosts(prev => prev.filter(p => p.id !== postId));
    console.log('[useFeed] post deleted successfully');
    return true;
  }, []);

  // Load following IDs once userId is known
  useEffect(() => {
    if (!currentUserId) return;
    const channel = supabase
      .channel(`feed_memberships_${currentUserId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'social_group_members', filter: `user_id=eq.${currentUserId}` },
        () => { void onRefresh(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [currentUserId, onRefresh]);

  // Initial load / refresh when feedMode or userId changes
  useEffect(() => {
    if (!currentUserId) {
      setPosts([]);
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
      setHasMore(true);
      setPage(0);
      followingIdsRef.current = [];
      groupIdsRef.current = [];
      setFollowingIds([]);
      setGroupIds([]);
      return;
    }

    setLoading(true);
    void onRefresh();
  }, [feedMode, currentUserId, onRefresh]);

  return {
    posts,
    loading,
    refreshing,
    loadingMore,
    hasMore,
    onRefresh,
    loadMore,
    toggleLike,
    createPost,
    createSocialPost,
    deletePost,
    followingIds,
  };
}
