// app/post/[id].tsx
// Post detail screen — opened from notification taps (like, comment, mention, reply)
// Shows the single post via PostCard (which already has the full comment sheet built-in)
// and auto-opens the comment sheet when a comment_id param is present.
import React, { useEffect, useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Modal,
  ScrollView,
  TextInput,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../src/services/supabase';
import { useAuth } from '../../src/context/AuthContext';
import PostCard from '../../src/components/PostCard';
import { useFeaturedContent } from '../../src/hooks/useFeaturedContent';

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

const OPEN_REQUEST_STATUSES = new Set([
  'pending_moderation',
  'needs_review',
  'approved',
  'pending_payment',
  'scheduled',
  'active',
]);

const STATUS_COPY: Record<string, { label: string; tone: string; description: string }> = {
  pending_moderation: {
    label: 'Pending moderation',
    tone: '#ffb84d',
    description: 'Automatic screening is reviewing your request.',
  },
  needs_review: {
    label: 'Needs review',
    tone: '#ffd24d',
    description: 'A moderator needs to review this request manually.',
  },
  approved: {
    label: 'Approved',
    tone: '#52d273',
    description: 'Approved by moderation. Payment/activation is the next step.',
  },
  pending_payment: {
    label: 'Pending payment',
    tone: '#6ecbff',
    description: 'Your request passed moderation and is waiting for payment/activation.',
  },
  scheduled: {
    label: 'Scheduled',
    tone: '#9d8cff',
    description: 'This featured slot has been scheduled.',
  },
  active: {
    label: 'Active',
    tone: '#ff8a4c',
    description: 'Your post is currently featured.',
  },
  rejected: {
    label: 'Rejected',
    tone: '#ff6b6b',
    description: 'This request was rejected and will not run.',
  },
  cancelled: {
    label: 'Cancelled',
    tone: '#8f96a3',
    description: 'This request was cancelled.',
  },
  expired: {
    label: 'Expired',
    tone: '#8f96a3',
    description: 'The featured run has finished.',
  },
};

export default function PostDetailScreen() {
  const { id, comment_id } = useLocalSearchParams<{ id: string; comment_id?: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [post, setPost] = useState<PostData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showFeatureModal, setShowFeatureModal] = useState(false);
  const [bannerLabel, setBannerLabel] = useState('');
  const [userProps, setUserProps] = useState(0);
  const [lifetimeProps, setLifetimeProps] = useState(0);
  const [loadingWallet, setLoadingWallet] = useState(false);

  const {
    requests,
    submitting,
    moderatingId,
    actionId,
    loadMyRequests,
    submitPostRequest,
    cancelRequest,
  } = useFeaturedContent(user?.id ?? null);

  const isOwner = !!post?.user_id && post.user_id === user?.id;

  const latestPostRequest = useMemo(
    () => requests.find((item) => item.post_id === post?.id) ?? null,
    [requests, post?.id]
  );

  const hasOpenRequest = !!latestPostRequest && OPEN_REQUEST_STATUSES.has(latestPostRequest.status);
  const featureStatus = latestPostRequest ? (STATUS_COPY[latestPostRequest.status] ?? {
    label: latestPostRequest.status,
    tone: '#8f96a3',
    description: 'Current featured request status.',
  }) : null;

  const refreshWallet = useCallback(async () => {
    if (!user?.id) {
      setUserProps(0);
      setLifetimeProps(0);
      return;
    }

    setLoadingWallet(true);
    try {
      const { data } = await supabase
        .from('users')
        .select('total_props, lifetime_props')
        .eq('id', user.id)
        .single();

      setUserProps(data?.total_props ?? 0);
      setLifetimeProps(data?.lifetime_props ?? data?.total_props ?? 0);
    } finally {
      setLoadingWallet(false);
    }
  }, [user?.id]);

  const refreshFeaturedState = useCallback(async () => {
    if (!user?.id) return;
    await Promise.allSettled([loadMyRequests(), refreshWallet()]);
  }, [user?.id, loadMyRequests, refreshWallet]);

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

  useEffect(() => {
    fetchPost();
  }, [fetchPost]);

  useEffect(() => {
    if (user?.id) {
      loadMyRequests();
    }
  }, [user?.id, loadMyRequests]);

  useEffect(() => {
    if (showFeatureModal && isOwner) {
      refreshFeaturedState();
    }
  }, [showFeatureModal, isOwner, refreshFeaturedState]);

  const handleOpenFeature = useCallback(() => {
    if (!isOwner) {
      Alert.alert('Owners only', 'Only the owner of this post can submit it for featured placement.');
      return;
    }
    setShowFeatureModal(true);
  }, [isOwner]);

  const handleSubmitFeaturedRequest = useCallback(async () => {
    if (!post?.id) return;
    if (hasOpenRequest) {
      Alert.alert('Already submitted', 'This post already has an open featured request.');
      return;
    }

    const response = await submitPostRequest({
      postId: post.id,
      paymentMethod: 'props',
      durationHours: 24,
      bannerLabel: bannerLabel.trim() || null,
    });

    await refreshFeaturedState();

    if (!response?.ok) {
      Alert.alert('Could not submit featured request', response?.error ?? 'Please try again.');
      return;
    }

    const moderationDecision = response.auto_moderation?.decision;
    if (moderationDecision === 'reject') {
      Alert.alert(
        'Request submitted',
        'Your request was created, but automatic moderation rejected it. You can adjust the content and try again later.'
      );
    } else if (moderationDecision === 'needs_review') {
      Alert.alert(
        'Request submitted',
        'Your featured request is now in the manual review queue.'
      );
    } else if (moderationDecision === 'approve') {
      Alert.alert(
        'Request submitted',
        'Your request passed screening and moved forward in the featured workflow.'
      );
    } else {
      Alert.alert(
        'Request submitted',
        'Your featured request was created. Moderation status will update shortly.'
      );
    }

    setShowFeatureModal(false);
    setBannerLabel('');
  }, [post?.id, hasOpenRequest, submitPostRequest, bannerLabel, refreshFeaturedState]);

  const handleCancelFeaturedRequest = useCallback(() => {
    if (!latestPostRequest?.id) return;

    Alert.alert(
      'Cancel featured request?',
      'This will cancel the current featured request for this post.',
      [
        { text: 'Keep request', style: 'cancel' },
        {
          text: 'Cancel request',
          style: 'destructive',
          onPress: async () => {
            const ok = await cancelRequest(latestPostRequest.id);
            await refreshFeaturedState();
            if (!ok) {
              Alert.alert('Could not cancel request', 'Please try again in a moment.');
              return;
            }
            Alert.alert('Request cancelled', 'The featured request was cancelled.');
          },
        },
      ]
    );
  }, [latestPostRequest?.id, cancelRequest, refreshFeaturedState]);

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

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backTouch}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Post</Text>
        {isOwner ? (
          <TouchableOpacity onPress={handleOpenFeature} style={styles.featureHeaderBtn}>
            <Ionicons name="sparkles" size={15} color="#0a0a0a" />
            <Text style={styles.featureHeaderBtnText}>Feature</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      <PostCard
        post={post}
        currentUserId={user?.id ?? null}
        isVisible={true}
        shouldAutoplay={false}
        initialCommentId={comment_id ?? null}
        onDelete={async () => {
          router.back();
          return true;
        }}
        onLike={() => {}}
        onCaptionUpdate={(_postId: string, caption: string) => {
          setPost((prev) => (prev && prev.id === post.id ? { ...prev, caption } : prev));
        }}
      />

      <Modal
        visible={showFeatureModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowFeatureModal(false)}
      >
        <View style={styles.sheetRoot}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sheetTitle}>⚡ Feature this Post</Text>
              <Text style={styles.sheetSubtitle} numberOfLines={2}>
                {post.caption?.trim() || 'This post has no caption.'}
              </Text>
            </View>
            <TouchableOpacity onPress={() => setShowFeatureModal(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={24} color="#666" />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.sheetContent}>
            <View style={styles.infoCard}>
              <View style={styles.infoCardHeader}>
                <Text style={styles.infoCardIcon}>🚀</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.infoCardTitle}>24-hour post spotlight</Text>
                  <Text style={styles.infoCardMeta}>Owner-only request · moderation first · props payment flow</Text>
                </View>
              </View>
              <Text style={styles.infoCardBody}>
                Submit this post for featured placement. The request is automatically screened first, then it can move to manual review or payment/activation depending on the moderation outcome.
              </Text>
            </View>

            <View style={styles.balanceCard}>
              <View style={styles.balanceRow}>
                <Text style={styles.balanceLabel}>Spendable props</Text>
                <Text style={styles.balanceValue}>{loadingWallet ? 'Loading…' : `${userProps.toLocaleString()} props`}</Text>
              </View>
              <View style={[styles.balanceRow, { marginTop: 8 }] }>
                <Text style={styles.balanceLabel}>Lifetime props</Text>
                <Text style={[styles.balanceValue, { color: '#ffcc66' }]}>{loadingWallet ? 'Loading…' : `${lifetimeProps.toLocaleString()} props`}</Text>
              </View>
            </View>

            {featureStatus && latestPostRequest ? (
              <View style={styles.statusCard}>
                <View style={styles.statusRow}>
                  <Text style={styles.sectionLabel}>Current request</Text>
                  <View style={[styles.statusPill, { borderColor: featureStatus.tone, backgroundColor: `${featureStatus.tone}20` }]}>
                    <Text style={[styles.statusPillText, { color: featureStatus.tone }]}>{featureStatus.label}</Text>
                  </View>
                </View>
                <Text style={styles.statusDescription}>{featureStatus.description}</Text>
                {!!latestPostRequest.moderation_reason && (
                  <Text style={styles.statusReason}>Reason: {latestPostRequest.moderation_reason}</Text>
                )}
                {!!latestPostRequest.banner_label && (
                  <Text style={styles.statusMeta}>Banner label: {latestPostRequest.banner_label}</Text>
                )}
              </View>
            ) : null}

            <View style={styles.formCard}>
              <Text style={styles.sectionLabel}>Optional banner label</Text>
              <Text style={styles.fieldHelp}>Up to 40 characters. This can appear with the featured placement.</Text>
              <TextInput
                value={bannerLabel}
                onChangeText={(value) => setBannerLabel(value.slice(0, 40))}
                placeholder="Weekend Rip Session"
                placeholderTextColor="#666"
                style={styles.textInput}
                maxLength={40}
              />
              <Text style={styles.charCount}>{bannerLabel.length}/40</Text>
            </View>

            <View style={styles.notesCard}>
              <Text style={styles.sectionLabel}>What happens next</Text>
              <Text style={styles.noteLine}>• Automatic moderation runs immediately after submission.</Text>
              <Text style={styles.noteLine}>• Safe requests can move toward payment/activation.</Text>
              <Text style={styles.noteLine}>• Borderline requests are routed to the admin review queue.</Text>
              <Text style={styles.noteLine}>• Rejected requests will not be activated.</Text>
            </View>
          </ScrollView>

          <View style={styles.sheetFooter}>
            {hasOpenRequest && latestPostRequest ? (
              <TouchableOpacity
                style={[styles.footerBtn, styles.cancelBtn, actionId === latestPostRequest.id && styles.footerBtnDisabled]}
                onPress={handleCancelFeaturedRequest}
                disabled={actionId === latestPostRequest.id}
              >
                {actionId === latestPostRequest.id
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.footerBtnText}>Cancel request</Text>}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={[styles.footerBtn, styles.secondaryBtn]} onPress={() => setShowFeatureModal(false)}>
                <Text style={styles.footerBtnText}>Close</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[
                styles.footerBtn,
                styles.primaryBtn,
                (submitting || moderatingId !== null || hasOpenRequest) && styles.footerBtnDisabled,
              ]}
              onPress={handleSubmitFeaturedRequest}
              disabled={submitting || moderatingId !== null || hasOpenRequest}
            >
              {submitting || moderatingId !== null ? (
                <ActivityIndicator color="#0a0a0a" size="small" />
              ) : (
                <Text style={[styles.footerBtnText, styles.primaryBtnText]}>
                  {hasOpenRequest ? 'Request already open' : 'Submit featured request'}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  center: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  header: {
    paddingTop: 52,
    paddingBottom: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  backTouch: { padding: 4 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  featureHeaderBtn: {
    minWidth: 84,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#ffcc33',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
  },
  featureHeaderBtnText: { color: '#0a0a0a', fontSize: 13, fontWeight: '800' },
  errorTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  errorSub: { color: '#666', fontSize: 14, textAlign: 'center', paddingHorizontal: 40 },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#ff4500',
  },
  backBtnText: { color: '#ff4500', fontSize: 14, fontWeight: '600' },
  sheetRoot: { flex: 1, backgroundColor: '#111' },
  sheetHandle: {
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#2d2d2d',
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 6,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1e1e1e',
  },
  sheetTitle: { color: '#fff', fontSize: 24, fontWeight: '800' },
  sheetSubtitle: { color: '#9aa0aa', fontSize: 14, marginTop: 6 },
  sheetContent: { padding: 20, paddingBottom: 28, gap: 16 },
  infoCard: {
    backgroundColor: '#171717',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#252525',
  },
  infoCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  infoCardIcon: { fontSize: 22 },
  infoCardTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  infoCardMeta: { color: '#8f96a3', fontSize: 12, marginTop: 2 },
  infoCardBody: { color: '#d4d7dd', fontSize: 14, lineHeight: 21 },
  balanceCard: {
    backgroundColor: '#141414',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#212121',
  },
  balanceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  balanceLabel: { color: '#8f96a3', fontSize: 13, fontWeight: '600' },
  balanceValue: { color: '#fff', fontSize: 15, fontWeight: '700' },
  statusCard: {
    backgroundColor: '#151515',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#242424',
    gap: 8,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  statusPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statusPillText: { fontSize: 12, fontWeight: '700' },
  statusDescription: { color: '#d4d7dd', fontSize: 14, lineHeight: 20 },
  statusReason: { color: '#ffb3b3', fontSize: 13, lineHeight: 19 },
  statusMeta: { color: '#aeb4bf', fontSize: 13 },
  formCard: {
    backgroundColor: '#151515',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#242424',
  },
  sectionLabel: { color: '#fff', fontSize: 15, fontWeight: '700' },
  fieldHelp: { color: '#8f96a3', fontSize: 13, lineHeight: 18, marginTop: 6, marginBottom: 12 },
  textInput: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#303030',
    backgroundColor: '#0f0f0f',
    color: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  charCount: { color: '#6d7480', fontSize: 12, textAlign: 'right', marginTop: 8 },
  notesCard: {
    backgroundColor: '#121212',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#222',
    gap: 8,
  },
  noteLine: { color: '#d4d7dd', fontSize: 13, lineHeight: 19 },
  sheetFooter: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderTopColor: '#1e1e1e',
    backgroundColor: '#111',
  },
  footerBtn: {
    flex: 1,
    minHeight: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  footerBtnDisabled: { opacity: 0.55 },
  footerBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  secondaryBtn: { backgroundColor: '#242424' },
  cancelBtn: { backgroundColor: '#402124' },
  primaryBtn: { backgroundColor: '#ffcc33' },
  primaryBtnText: { color: '#0a0a0a' },
});
