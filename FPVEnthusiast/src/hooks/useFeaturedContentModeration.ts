import { useCallback, useState } from 'react';
import { supabase } from '../services/supabase';

export interface FeaturedModerationQueueItem {
  request_id: string;
  owner_user_id: string;
  owner_username: string | null;
  content_kind: 'post' | 'event';
  feature_kind: 'post_spotlight' | 'event_spotlight' | 'livestream_spotlight';
  payment_method: 'props' | 'iap';
  status: string;
  moderation_status: string;
  duration_hours: number;
  banner_label: string | null;
  banner_image_url: string | null;
  livestream_platform: string | null;
  livestream_url: string | null;
  moderation_flags: string[] | null;
  moderation_reason: string | null;
  moderation_score: number | null;
  created_at: string;
  target_id: string;
  target_title: string | null;
}

interface ReviewParams {
  requestId: string;
  decision: 'approve' | 'reject' | 'needs_review';
  reason?: string | null;
  flags?: string[];
  summary?: Record<string, any> | null;
  score?: number | null;
  priceCents?: number | null;
  propsCost?: number | null;
}

export function useFeaturedContentModeration() {
  const [queue, setQueue] = useState<FeaturedModerationQueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_get_featured_content_requests');
      if (error) {
        console.error('[useFeaturedContentModeration] loadQueue:', error.message);
        return [] as FeaturedModerationQueueItem[];
      }
      const rows = (data ?? []) as FeaturedModerationQueueItem[];
      setQueue(rows);
      return rows;
    } finally {
      setLoading(false);
    }
  }, []);

  const reviewRequest = useCallback(async (params: ReviewParams) => {
    setActionId(params.requestId);
    try {
      const { data, error } = await supabase.rpc('admin_review_featured_content_request', {
        p_request_id: params.requestId,
        p_decision: params.decision,
        p_reason: params.reason ?? null,
        p_flags: params.flags ?? null,
        p_summary: params.summary ?? null,
        p_score: params.score ?? null,
        p_price_cents: params.priceCents ?? null,
        p_props_cost: params.propsCost ?? null,
      });

      if (error) {
        console.error('[useFeaturedContentModeration] reviewRequest:', error.message);
        return false;
      }

      if (data) {
        await loadQueue();
      }

      return !!data;
    } finally {
      setActionId(null);
    }
  }, [loadQueue]);

  return {
    queue,
    loading,
    actionId,
    loadQueue,
    reviewRequest,
  };
}
