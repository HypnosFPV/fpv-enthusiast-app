// src/hooks/useFeed.js
import { useState, useCallback, useEffect } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import { Alert } from 'react-native';
import { supabase } from '../services/supabase';
import { detectPlatform, getEmbedUrl } from '../utils/socialMedia';
import { useAuth } from '../context/AuthContext';

// ─── YouTube helpers ──────────────────────────────────────────────────────────
function extractYouTubeId(url) {
  if (!url) return null;
  const m = url.match(
    /(?:youtube\.com\/watch\?(?:.*&)?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/
  );
  return m?.[1] ?? null;
}

function youtubeThumbnail(url) {
  const id = extractYouTubeId(url);
  return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null;
}

// ─── Normalise raw Supabase row ───────────────────────────────────────────────
function normalizePost(p) {
  return {
    ...p,
    profiles:      p.profiles ?? p.users ?? null,
    like_count:    p.likes?.length    ?? p.like_count    ?? 0,
    comment_count: p.comments?.length ?? p.comment_count ?? 0,
    isLiked: Array.isArray(p.likes)
      ? p.likes.some(l => l.user_id === p._currentUserId)
      : false,
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useFeed() {
  const { user } = useAuth();

  const [posts,      setPosts]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creating,   setCreating]   = useState(false);
  const [error,      setError]      = useState(null);

  // ─── Fetch posts ────────────────────────────────────────────────────────────
  const fetchPosts = useCallback(async () => {
    try {
      setError(null);
      const { data, error: fetchError } = await supabase
        .from('posts')
        .select(`
          *,
          users ( id, username, avatar_url, is_paid_member ),
          likes ( id, user_id ),
          comments ( id )
        `)
        .order('created_at', { ascending: false });

      if (fetchError) throw fetchError;

      const tagged = (data ?? []).map(p => ({ ...p, _currentUserId: user?.id }));
      setPosts(tagged.map(normalizePost));
    } catch (e) {
      console.error('[useFeed] fetchPosts error:', e);
      setError(e.message ?? 'Failed to load feed.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => { fetchPosts(); }, [fetchPosts]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchPosts();
  }, [fetchPosts]);

  // ─── Toggle like ────────────────────────────────────────────────────────────
  const toggleLike = useCallback(async (postId) => {
    if (!user) return;
    setPosts(prev => prev.map(p => {
      if (p.id !== postId) return p;
      const wasLiked     = p.isLiked;
      const updatedLikes = wasLiked
        ? (p.likes ?? []).filter(l => l.user_id !== user.id)
        : [...(p.likes ?? []), { id: 'temp_' + Date.now(), user_id: user.id }];
      return { ...p, likes: updatedLikes, like_count: updatedLikes.length, isLiked: !wasLiked };
    }));
    try {
      const post    = posts.find(p => p.id === postId);
      const isLiked = post?.isLiked ?? false;
      if (isLiked) {
        await supabase.from('likes').delete().eq('post_id', postId).eq('user_id', user.id);
      } else {
        await supabase.from('likes').insert({ post_id: postId, user_id: user.id });
      }
    } catch (e) {
      console.error('[useFeed] toggleLike error:', e);
      fetchPosts();
    }
  }, [user, posts, fetchPosts]);

  // ─── Upload media post ──────────────────────────────────────────────────────
  const createPost = useCallback(async ({ caption, mediaUri, mediaType }) => {
    if (!user) throw new Error('Not authenticated.');
    setCreating(true);
    try {
      let media_url = null;
      if (mediaUri) {
        const base64 = await FileSystem.readAsStringAsync(mediaUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        const ext   = mediaUri.split('.').pop() ?? 'jpg';
        const path  = `${user.id}/${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from('post-media')
          .upload(path, bytes, { contentType: `${mediaType}/${ext}` });
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from('post-media').getPublicUrl(path);
        media_url = urlData?.publicUrl;
      }
      const { error: insertError } = await supabase.from('posts').insert({
        user_id:    user.id,
        caption:    caption || null,
        media_url,
        media_type: mediaType ?? (media_url ? 'image' : null),
        created_at: new Date().toISOString(),
      });
      if (insertError) throw insertError;
      await fetchPosts();
    } finally {
      setCreating(false);
    }
  }, [user, fetchPosts]);

  // ─── Post a social URL ──────────────────────────────────────────────────────
  // FIX: now auto-extracts thumbnail_url for YouTube links at creation time
  // so the feed thumbnail and profile grid cell both work immediately.
  const createSocialPost = useCallback(async (params) => {
    if (!user) throw new Error('Not authenticated.');

    const sourceUrl = params.sourceUrl ?? params.url ?? params.socialUrl ?? params.source_url ?? '';
    const caption   = params.caption   ?? params.text ?? '';

    if (!sourceUrl) {
      Alert.alert('Error', 'No URL provided.');
      return;
    }

    setCreating(true);
    try {
      const detectedPlatform = detectPlatform(sourceUrl);
      const embedUrl         = detectedPlatform ? getEmbedUrl(sourceUrl, detectedPlatform) : null;

      // ── Auto-generate thumbnail for YouTube ─────────────────────────────
      // For other platforms we leave thumbnail_url null (no public API available).
      const thumbnail_url = detectedPlatform === 'youtube'
        ? youtubeThumbnail(sourceUrl)
        : null;

      console.log('[useFeed] createSocialPost →', {
        sourceUrl,
        caption,
        detectedPlatform,
        embedUrl,
        thumbnail_url,
      });

      const { error: insertError } = await supabase.from('posts').insert({
        user_id:         user.id,
        caption:         caption || null,
        media_type:      'social_embed',
        source_url:      sourceUrl,
        embed_url:       embedUrl ?? sourceUrl,
        source_platform: detectedPlatform ?? 'unknown',
        thumbnail_url,                          // ← THE FIX
        created_at:      new Date().toISOString(),
      });
      if (insertError) throw insertError;
      await fetchPosts();
    } catch (e) {
      console.error('[useFeed] createSocialPost error:', e);
      Alert.alert('Error', e.message);
    } finally {
      setCreating(false);
    }
  }, [user, fetchPosts]);

  // ─── Post YouTube videos from content browser ───────────────────────────────
  // thumbnail_url already provided by the browser — no change needed here
  const createYouTubePost = useCallback(async (videos, caption = '') => {
    if (!user)           throw new Error('Not authenticated.');
    if (!videos?.length) throw new Error('No videos selected.');
    setCreating(true);
    try {
      const inserts = videos.map(v => ({
        user_id:         user.id,
        caption:         caption || v.title || null,
        media_type:      'social_embed',
        source_url:      `https://www.youtube.com/watch?v=${v.videoId}`,
        embed_url:       `https://www.youtube.com/embed/${v.videoId}`,
        source_platform: 'youtube',
        thumbnail_url:   v.thumbnail
          ?? youtubeThumbnail(`https://www.youtube.com/watch?v=${v.videoId}`),
        created_at:      new Date().toISOString(),
      }));
      const { error: insertError } = await supabase.from('posts').insert(inserts);
      if (insertError) throw insertError;
      await fetchPosts();
    } catch (e) {
      console.error('[useFeed] createYouTubePost error:', e);
      Alert.alert('Error', e.message);
    } finally {
      setCreating(false);
    }
  }, [user, fetchPosts]);

  // ─── Delete post (owner only) ───────────────────────────────────────────────
  const deletePost = useCallback(async (postId) => {
    if (!user) return;
    setPosts(prev => prev.filter(p => p.id !== postId));
    try {
      const { error } = await supabase
        .from('posts')
        .delete()
        .eq('id', postId)
        .eq('user_id', user.id);
      if (error) throw error;
    } catch (e) {
      console.error('[useFeed] deletePost error:', e);
      Alert.alert('Error', 'Could not delete post.');
      fetchPosts();
    }
  }, [user, fetchPosts]);

  // ─── Update caption (owner only) ───────────────────────────────────────────
  const updateCaption = useCallback(async (postId, newCaption) => {
    if (!user) return;
    setPosts(prev => prev.map(p =>
      p.id === postId ? { ...p, caption: newCaption } : p
    ));
    try {
      const { error } = await supabase
        .from('posts')
        .update({ caption: newCaption })
        .eq('id', postId)
        .eq('user_id', user.id);
      if (error) throw error;
    } catch (e) {
      console.error('[useFeed] updateCaption error:', e);
      Alert.alert('Error', 'Could not update caption.');
      fetchPosts();
    }
  }, [user, fetchPosts]);

  return {
    posts,
    loading,
    refreshing,
    creating,
    error,
    onRefresh,
    toggleLike,
    createPost,
    createSocialPost,
    createYouTubePost,
    deletePost,
    updateCaption,
  };
}
