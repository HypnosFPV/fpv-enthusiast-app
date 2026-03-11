// src/hooks/useFeed.ts  — with personalised feed modes
import { useState, useCallback, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { decode } from 'base64-arraybuffer';
import { rankPosts, InterestProfile } from './useFeedAlgorithm';

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
}

interface CreatePostParams {
  mediaUrl: string;
  mediaType: string;
  caption?: string;
  tags?: string[];
  mediaBase64?: string | null;
  thumbnailUrl?: string | null;
}

interface CreateSocialPostParams {
  socialUrl: string;
  platform: string;
  caption?: string;
  tags?: string[];
}

const PAGE_SIZE    = 10;
const POOL_SIZE    = 60;   // For You: fetch this many, then rank & trim

const SELECT = `
  id, user_id, media_url, media_type, thumbnail_url, caption, tags,
  social_url, platform, created_at, likes_count, comments_count,
  users:user_id (id, username, avatar_url)
`;

export function useFeed(
  currentUserId?: string,
  feedMode: FeedMode = 'recent',
  interestProfile?: InterestProfile,
) {
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(0);
  const [followingIds, setFollowingIds] = useState<string[]>([]);

  function mergeIsLiked(rawPosts: any[], likedIds: string[]): FeedPost[] {
    return rawPosts.map(p => ({
      ...p,
      like_count:    p.likes_count    ?? 0,
      comment_count: p.comments_count ?? 0,
      users: Array.isArray(p.users) ? (p.users[0] ?? null) : (p.users ?? null),
      isLiked: likedIds.includes(p.id),
    })) as FeedPost[];
  }

  // ── Fetch the list of users the current user follows ──────────────────
  const loadFollowingIds = useCallback(async () => {
    if (!currentUserId) { setFollowingIds([]); return; }
    const { data } = await supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', currentUserId);
    setFollowingIds((data ?? []).map((r: any) => r.following_id));
  }, [currentUserId]);

  // ── Core fetch ────────────────────────────────────────────────────────
  const fetchPosts = useCallback(async (pageIndex: number): Promise<FeedPost[]> => {

    // ── A. FOR YOU: fetch a larger pool and personalise-rank it ─────────
    if (feedMode === 'for_you' && currentUserId) {
      const from = pageIndex * POOL_SIZE;
      const to   = from + POOL_SIZE - 1;

      const { data, error } = await supabase
        .from('posts')
        .select(SELECT)
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) { console.error('[useFeed] for_you error:', error.message); return []; }
      if (!data?.length) return [];

      const { data: likes } = await supabase
        .from('likes')
        .select('post_id')
        .eq('user_id', currentUserId)
        .in('post_id', data.map((p: any) => p.id));

      const likedIds = (likes ?? []).map((l: any) => l.post_id);
      const merged   = mergeIsLiked(data, likedIds);

      // Rank if we have a profile, else fall back to chronological
      const profile = interestProfile ?? { tagWeights: {}, authorAffinity: {}, topTags: [], topAuthors: [], lastUpdated: 0 };
      const ranked  = rankPosts(merged, profile);

      // Return a PAGE_SIZE slice from the ranked pool
      return ranked.slice(pageIndex === 0 ? 0 : pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE);
    }

    // ── B. FOLLOWING: only posts from people the user follows ────────────
    if (feedMode === 'following' && currentUserId) {
      const ids = followingIds.length > 0 ? followingIds : [];
      if (!ids.length) return [];

      const from = pageIndex * PAGE_SIZE;
      const to   = from + PAGE_SIZE - 1;

      const { data, error } = await supabase
        .from('posts')
        .select(SELECT)
        .in('user_id', ids)
        .order('created_at', { ascending: false })
        .range(from, to);

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

    const { data, error } = await supabase
      .from('posts')
      .select(SELECT)
      .order('created_at', { ascending: false })
      .range(from, to);

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
  }, [currentUserId, feedMode, followingIds, interestProfile]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setPage(0);
    const fresh = await fetchPosts(0);
    setPosts(fresh);
    setLoading(false);
    setRefreshing(false);
  }, [fetchPosts]);

  const loadMore = useCallback(async () => {
    if (loading || refreshing) return;
    const nextPage = page + 1;
    const more = await fetchPosts(nextPage);
    if (more.length > 0) {
      setPosts(prev => [...prev, ...more]);
      setPage(nextPage);
    }
  }, [loading, refreshing, page, fetchPosts]);

  const toggleLike = useCallback(async (postId: string) => {
    if (!currentUserId) return;

    const targetPost = posts.find(p => p.id === postId);
    if (!targetPost) return;

    const isCurrentlyLiked = targetPost.isLiked;
    const delta = isCurrentlyLiked ? -1 : 1;

    setPosts(prev =>
      prev.map(p =>
        p.id === postId
          ? {
              ...p,
              isLiked:     !isCurrentlyLiked,
              like_count:  p.like_count + delta,
              likes_count: (p.likes_count ?? p.like_count) + delta,
            }
          : p
      )
    );

    if (isCurrentlyLiked) {
      await supabase.from('likes').delete()
        .eq('post_id', postId).eq('user_id', currentUserId);
    } else {
      await supabase.from('likes').insert({ post_id: postId, user_id: currentUserId });
      if (targetPost.user_id && targetPost.user_id !== currentUserId) {
        void supabase.from('notifications').insert({
          user_id:  targetPost.user_id,
          actor_id: currentUserId,
          type:     'like',
          post_id:  postId,
        });
      }
    }
  }, [currentUserId, posts]);

  const createPost = useCallback(async ({
    mediaUrl,
    mediaType,
    caption,
    tags,
    mediaBase64,
    thumbnailUrl,
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
  }: CreateSocialPostParams) => {
    if (!currentUserId) return null;

    const { data, error } = await supabase
      .from('posts')
      .insert({ user_id: currentUserId, social_url: socialUrl, platform, caption, tags: tags?.length ? tags : null })
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
    loadFollowingIds();
  }, [loadFollowingIds]);

  // Initial load / refresh when feedMode or userId changes
  useEffect(() => {
    setLoading(true);
    onRefresh();
  }, [feedMode, currentUserId]);

  return {
    posts,
    loading,
    refreshing,
    onRefresh,
    loadMore,
    toggleLike,
    createPost,
    createSocialPost,
    deletePost,
    followingIds,
  };
}
