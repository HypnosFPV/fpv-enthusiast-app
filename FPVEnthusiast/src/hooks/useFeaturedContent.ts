import { useCallback, useState } from 'react';
import { supabase } from '../services/supabase';

export type FeaturedContentKind = 'post' | 'event';
export type FeaturedFeatureKind = 'post_spotlight' | 'event_spotlight' | 'livestream_spotlight';
export type FeaturedPaymentMethod = 'props' | 'iap';
export type FeaturedRequestStatus =
  | 'draft'
  | 'pending_moderation'
  | 'needs_review'
  | 'approved'
  | 'rejected'
  | 'pending_payment'
  | 'scheduled'
  | 'active'
  | 'expired'
  | 'cancelled';
export type FeaturedModerationStatus = 'pending' | 'needs_review' | 'approved' | 'rejected';

export interface FeaturedContentRequest {
  id: string;
  owner_user_id: string;
  content_kind: FeaturedContentKind;
  post_id: string | null;
  event_id: string | null;
  feature_kind: FeaturedFeatureKind;
  payment_method: FeaturedPaymentMethod;
  status: FeaturedRequestStatus;
  moderation_status: FeaturedModerationStatus;
  moderation_provider?: string | null;
  moderation_summary?: Record<string, any> | null;
  moderation_flags?: string[] | null;
  moderation_reason?: string | null;
  moderation_score?: number | null;
  banner_label?: string | null;
  banner_image_url?: string | null;
  livestream_url?: string | null;
  livestream_platform?: string | null;
  livestream_autoplay_muted: boolean;
  duration_hours: number;
  props_cost?: number | null;
  price_cents?: number | null;
  starts_at?: string | null;
  ends_at?: string | null;
  created_at: string;
  updated_at: string;
}

interface SubmitBaseParams {
  featureKind?: FeaturedFeatureKind;
  paymentMethod?: FeaturedPaymentMethod;
  durationHours?: number;
  bannerLabel?: string | null;
  bannerImageUrl?: string | null;
  livestreamUrl?: string | null;
  livestreamPlatform?: string | null;
}

interface SubmitPostParams extends SubmitBaseParams {
  postId: string;
}

interface SubmitEventParams extends SubmitBaseParams {
  eventId: string;
}

export function useFeaturedContent(userId?: string | null) {
  const [requests, setRequests] = useState<FeaturedContentRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);

  const loadMyRequests = useCallback(async () => {
    if (!userId) {
      setRequests([]);
      return [] as FeaturedContentRequest[];
    }

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('featured_content_requests')
        .select('*')
        .eq('owner_user_id', userId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[useFeaturedContent] loadMyRequests:', error.message);
        return [] as FeaturedContentRequest[];
      }

      const rows = (data ?? []) as FeaturedContentRequest[];
      setRequests(rows);
      return rows;
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const submitPostRequest = useCallback(async (params: SubmitPostParams) => {
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('submit_featured_post_request', {
        p_post_id: params.postId,
        p_feature_kind: params.featureKind ?? 'post_spotlight',
        p_payment_method: params.paymentMethod ?? 'props',
        p_duration_hours: params.durationHours ?? 24,
        p_banner_label: params.bannerLabel ?? null,
        p_banner_image_url: params.bannerImageUrl ?? null,
        p_livestream_url: params.livestreamUrl ?? null,
        p_livestream_platform: params.livestreamPlatform ?? null,
      });

      if (error) {
        console.error('[useFeaturedContent] submitPostRequest:', error.message);
        return { ok: false, error: error.message };
      }

      await loadMyRequests();
      return data as { ok: boolean; request_id?: string; error?: string };
    } finally {
      setSubmitting(false);
    }
  }, [loadMyRequests]);

  const submitEventRequest = useCallback(async (params: SubmitEventParams) => {
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('submit_featured_event_request', {
        p_event_id: params.eventId,
        p_feature_kind: params.featureKind ?? 'event_spotlight',
        p_payment_method: params.paymentMethod ?? 'props',
        p_duration_hours: params.durationHours ?? 24,
        p_banner_label: params.bannerLabel ?? null,
        p_banner_image_url: params.bannerImageUrl ?? null,
        p_livestream_url: params.livestreamUrl ?? null,
        p_livestream_platform: params.livestreamPlatform ?? null,
      });

      if (error) {
        console.error('[useFeaturedContent] submitEventRequest:', error.message);
        return { ok: false, error: error.message };
      }

      await loadMyRequests();
      return data as { ok: boolean; request_id?: string; error?: string };
    } finally {
      setSubmitting(false);
    }
  }, [loadMyRequests]);

  const cancelRequest = useCallback(async (requestId: string) => {
    setActionId(requestId);
    try {
      const { data, error } = await supabase.rpc('cancel_featured_content_request', {
        p_request_id: requestId,
      });

      if (error) {
        console.error('[useFeaturedContent] cancelRequest:', error.message);
        return false;
      }

      if (data) {
        setRequests(prev => prev.map(item => (
          item.id === requestId
            ? { ...item, status: 'cancelled' as FeaturedRequestStatus }
            : item
        )));
      }

      return !!data;
    } finally {
      setActionId(null);
    }
  }, []);

  return {
    requests,
    loading,
    submitting,
    actionId,
    loadMyRequests,
    submitPostRequest,
    submitEventRequest,
    cancelRequest,
  };
}
