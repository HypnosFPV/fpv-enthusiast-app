// app/post/[id].tsx
// Post detail screen — opened from notification taps (like, comment, mention, reply)
// Shows the single post via PostCard (which already has the full comment sheet built-in)
// and auto-opens the comment sheet when a comment_id param is present.
import React, { useEffect, useRef } from 'react';
import {
  View, Text, ActivityIndicator, StyleSheet,
  TouchableOpacity, StatusBar,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../src/services/supabase';
import { useAuth } from '../../src/context/AuthContext';
import PostCard from '../../src/components/PostCard';
import { useState, useCallback } from 'react';

interface PostData {
  id: string;
  user_id?: string | null;
  media_url?: string | null;
  social_url?: string | null;
  embed_url?: string | null;
  media_type?: string | null;
  platform?: string | null;
  thumbnail_url?: string | null;
  caption?: string | null;
  created_at?: string | null;
  isLiked?: boolean;
  like_count?: number;
  comment_count?: number;
  likes_count?: number;
  comments_count?: number;
  users?: { id?: string | null; username?: string | null; avatar_url?: string | null } | null;
}

export default function PostDetailScreen() {
  const { id, comment_id } = useLocalSearchParams<{ id: string; comment_id?: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [post, setPost] = useState<PostData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPost = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchErr } = await supabase
        .from('posts')
        .select(`
          id, user_id, media_url, media_type, thumbnail_url, caption,
          social_url, platform, created_at, likes_count, comments_count,
          users:user_id (id, username, avatar_url)
        `)
        .eq('id', id)
        .single();

      if (fetchErr || !data) {
        setError('Post not found or has been deleted.');
        return;
      }

      // Check if current user has liked this post
      let isLiked = false;
      if (user?.id) {
        const { data: likeData } = await supabase
          .from('likes')
          .select('post_id')
          .eq('user_id', user.id)
          .eq('post_id', id)
          .maybeSingle();
        isLiked = !!likeData;
      }

      const p = data as any;
      setPost({
        ...p,
        like_count: p.likes_count ?? 0,
        comment_count: p.comments_count ?? 0,
        users: Array.isArray(p.users) ? (p.users[0] ?? null) : (p.users ?? null),
        isLiked,
      });
    } catch (e: any) {
      setError('Failed to load post.');
    } finally {
      setLoading(false);
    }
  }, [id, user?.id]);

  useEffect(() => { fetchPost(); }, [fetchPost]);

  if (loading) {
    return (
      <View style={styles.center}>
        <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />
        <ActivityIndicator size="large" color="#ff4500" />
      </View>
    );
  }

  if (error || !post) {
    return (
      <View style={styles.center}>
        <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />
        <Ionicons name="alert-circle-outline" size={56} color="#333" />
        <Text style={styles.errorTitle}>Post unavailable</Text>
        <Text style={styles.errorSub}>{error ?? 'This post may have been deleted.'}</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={16} color="#ff4500" />
          <Text style={styles.backBtnText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />

      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backTouch}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Post</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* ── Post ── */}
      {/* PostCard already contains the full comment sheet with openComments prop */}
      <PostCard
        post={post}
        currentUserId={user?.id ?? null}
        isVisible={true}
        shouldAutoplay={false}
        // Pass the comment_id so PostCard can highlight/scroll to it
        // (PostCard will open comments automatically when commentId prop is set)
        initialCommentId={comment_id ?? null}
        onDelete={async (postId: string) => {
          router.back();
          return true;
        }}
        onLike={() => {}}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  center: {
    flex: 1, backgroundColor: '#0a0a0a',
    justifyContent: 'center', alignItems: 'center', gap: 12,
  },
  header: {
    paddingTop: 52, paddingBottom: 12, paddingHorizontal: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  backTouch: { padding: 4 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  errorTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  errorSub: { color: '#666', fontSize: 14, textAlign: 'center', paddingHorizontal: 40 },
  backBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 8, paddingHorizontal: 20, paddingVertical: 10,
    borderRadius: 20, borderWidth: 1, borderColor: '#ff4500',
  },
  backBtnText: { color: '#ff4500', fontSize: 14, fontWeight: '600' },
});
