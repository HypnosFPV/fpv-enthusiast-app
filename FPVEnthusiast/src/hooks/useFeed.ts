// src/hooks/useFeed.ts
import { useState, useCallback, useEffect } from 'react';
import { supabase } from '../services/supabase';
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';

export interface FeedPost {
  id: string;
  user_id?: string | null;
  media_url?: string | null;
  media_type?: string | null;
  caption?: string | null;
  social_url?: string | null;
  platform?: string | null;
  created_at?: string | null;
  like_count: number;
  comment_count: number;
  isLiked: boolean;
  likes_count?: number;
  comments_count?: number;
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
  // ── FIX: accept base64 directly from ImagePicker so we never rely on
  //    FileSystem.readAsStringAsync for images (which returns empty on iOS
  //    for iCloud / HEIC photos and produces 0-byte uploads).
  mediaBase64?: string | null;
}

interface CreateSocialPostParams {
  socialUrl: string;
  platform: string;
  caption?: string;
}

const PAGE_SIZE = 10;

const SELECT = `
  id, user_id, media_url, media_type, caption,
  social_url, platform, created_at, likes_count, comments_count,
  users:user_id (id, username, avatar_url)
`;

export function useFeed(currentUserId?: string) {
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(0);

  function mergeIsLiked(rawPosts: any[], likedIds: string[]): FeedPost[] {
    return rawPosts.map(p => ({
      ...p,
      like_count:    p.likes_count    ?? 0,
      comment_count: p.comments_count ?? 0,
      users: Array.isArray(p.users) ? (p.users[0] ?? null) : (p.users ?? null),
      isLiked: likedIds.includes(p.id),
    })) as FeedPost[];
  }

  const fetchPosts = useCallback(async (pageIndex: number) => {
    const from = pageIndex * PAGE_SIZE;
    const to   = from + PAGE_SIZE - 1;

    const { data, error } = await supabase
      .from('posts')
      .select(SELECT)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      console.error('[useFeed] fetchPosts error:', JSON.stringify(error));
      return [];
    }
    if (!data) return [];

    if (!currentUserId) return mergeIsLiked(data, []);

    const { data: likes, error: likesError } = await supabase
      .from('likes')
      .select('post_id')
      .eq('user_id', currentUserId)
      .in('post_id', data.map((p: any) => p.id));

    if (likesError) console.error('[useFeed] likes error:', JSON.stringify(likesError));

    const likedIds = (likes ?? []).map((l: any) => l.post_id);
    return mergeIsLiked(data, likedIds);
  }, [currentUserId]);

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

  // ── FIX: also sync likes_count so PostCard display updates immediately ───
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
      await supabase
        .from('likes')
        .delete()
        .eq('post_id', postId)
        .eq('user_id', currentUserId);
    } else {
      await supabase
        .from('likes')
        .insert({ post_id: postId, user_id: currentUserId });

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

  // ── FIX: upload file to Supabase Storage, store public URL in DB ─────────
  const createPost = useCallback(async ({
    mediaUrl,
    mediaType,
    caption,
    mediaBase64,
  }: CreatePostParams) => {
    if (!currentUserId) return null;

    let finalUrl = mediaUrl;

    // Only upload if it's a local file (not already a remote URL)
    if (!mediaUrl.startsWith('http://') && !mediaUrl.startsWith('https://')) {
      try {
        let base64String: string;
        let ext: string;
        let mime: string;

        if (mediaType === 'video') {
          // Videos are too large for picker base64; use FileSystem
          ext  = mediaUrl.split('.').pop()?.split('?')[0]?.toLowerCase() ?? 'mp4';
          mime = ext === 'mov' ? 'video/quicktime' : 'video/mp4';
          base64String = await FileSystem.readAsStringAsync(mediaUrl, {
            encoding: 'base64' as any,
          });
          console.log('[useFeed] video filesystem base64 chars:', base64String.length);
        } else if (mediaBase64) {
          // ── PRIMARY PATH: base64 came directly from ImagePicker ──────────
          // ImagePicker with quality:0.8 always transcodes to JPEG, so
          // we can safely use image/jpeg and .jpg extension.
          base64String = mediaBase64;
          ext  = 'jpg';
          mime = 'image/jpeg';
          console.log('[useFeed] using picker base64, chars:', base64String.length);
        } else {
          // ── FALLBACK PATH: no base64 from picker, read from filesystem ───
          ext  = mediaUrl.split('.').pop()?.split('?')[0]?.toLowerCase() ?? 'jpg';
          mime = ext === 'png'  ? 'image/png'
               : ext === 'heic' ? 'image/heic'
               : ext === 'webp' ? 'image/webp'
               : 'image/jpeg';
          base64String = await FileSystem.readAsStringAsync(mediaUrl, {
            encoding: 'base64' as any,
          });
          console.log('[useFeed] filesystem fallback base64 chars:', base64String.length);
        }

        const arrayBuffer = decode(base64String);
        console.log('[useFeed] arrayBuffer byteLength:', arrayBuffer.byteLength);

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

        const { data: urlData } = supabase.storage
          .from('posts')
          .getPublicUrl(storagePath);
        finalUrl = urlData.publicUrl;
        console.log('[useFeed] upload success, publicUrl:', finalUrl);
      } catch (e: any) {
        console.error('[useFeed] upload exception:', e.message);
        return null;
      }
    }

    const { data, error } = await supabase
      .from('posts')
      .insert({
        user_id:    currentUserId,
        media_url:  finalUrl,
        media_type: mediaType,
        caption,
      })
      .select(SELECT)
      .single();

    if (error) { console.error('[useFeed] createPost error:', JSON.stringify(error)); return null; }
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

  const createSocialPost = useCallback(async ({
    socialUrl,
    platform,
    caption,
  }: CreateSocialPostParams) => {
    if (!currentUserId) return null;
    const { data, error } = await supabase
      .from('posts')
      .insert({ user_id: currentUserId, social_url: socialUrl, platform, caption })
      .select(SELECT)
      .single();
    if (error) { console.error('[useFeed] createSocialPost error:', JSON.stringify(error)); return null; }
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

  const deletePost = useCallback(async (postId: string) => {
    await supabase.from('posts').delete().eq('id', postId);
    setPosts(prev => prev.filter(p => p.id !== postId));
  }, []);

  // Initial fetch on mount
  useEffect(() => {
    onRefresh();
  }, []);

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
  };
}
