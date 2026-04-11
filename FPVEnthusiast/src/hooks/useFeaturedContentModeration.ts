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

export type FeaturedModerationBackendStatus = 'ready' | 'fallback' | 'unavailable';

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

interface FeaturedContentRequestRow {
  id: string;
  owner_user_id: string;
  content_kind: 'post' | 'event';
  post_id: string | null;
  event_id: string | null;
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
}

function isMissingRpcError(error: { code?: string; message?: string } | null, functionName: string) {
  if (!error) return false;
  const message = (error.message ?? '').toLowerCase();
  return error.code === 'PGRST202'
    || (message.includes(functionName.toLowerCase()) && message.includes('schema cache'))
    || message.includes('could not find the function');
}

function isMissingTableError(error: { code?: string; message?: string } | null, tableName: string) {
  if (!error) return false;
  const message = (error.message ?? '').toLowerCase();
  return error.code === 'PGRST205'
    || (message.includes(tableName.toLowerCase()) && message.includes('schema cache'))
    || message.includes('could not find the table');
}

function compactTitle(value: string | null | undefined, fallback: string) {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed;
}

export function useFeaturedContentModeration() {
  const [queue, setQueue] = useState<FeaturedModerationQueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [backendStatus, setBackendStatus] = useState<FeaturedModerationBackendStatus>('ready');

  const loadQueueFallback = useCallback(async () => {
    const { data, error } = await supabase
      .from('featured_content_requests')
      .select(`
        id,
        owner_user_id,
        content_kind,
        post_id,
        event_id,
        feature_kind,
        payment_method,
        status,
        moderation_status,
        duration_hours,
        banner_label,
        banner_image_url,
        livestream_platform,
        livestream_url,
        moderation_flags,
        moderation_reason,
        moderation_score,
        created_at
      `)
      .order('created_at', { ascending: false });

    if (error) {
      if (isMissingTableError(error, 'featured_content_requests')) {
        setBackendStatus('unavailable');
        setQueue([]);
        return [] as FeaturedModerationQueueItem[];
      }
      console.error('[useFeaturedContentModeration] loadQueue fallback:', error.message);
      return [] as FeaturedModerationQueueItem[];
    }

    const requestRows = (data ?? []) as FeaturedContentRequestRow[];
    const ownerIds = Array.from(new Set(requestRows.map(row => row.owner_user_id).filter(Boolean)));
    const postIds = Array.from(new Set(requestRows.map(row => row.post_id).filter(Boolean))) as string[];
    const eventIds = Array.from(new Set(requestRows.map(row => row.event_id).filter(Boolean))) as string[];

    const [usersResult, postsResult, eventsResult] = await Promise.all([
      ownerIds.length
        ? supabase.from('users').select('id, username').in('id', ownerIds)
        : Promise.resolve({ data: [], error: null }),
      postIds.length
        ? supabase.from('posts').select('id, caption').in('id', postIds)
        : Promise.resolve({ data: [], error: null }),
      eventIds.length
        ? supabase.from('race_events').select('id, event_name').in('id', eventIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    const usernameById = new Map(
      (((usersResult as any).data ?? []) as Array<{ id: string; username: string | null }>).map((user) => [user.id, user.username]),
    );
    const postTitleById = new Map(
      (((postsResult as any).data ?? []) as Array<{ id: string; caption: string | null }>).map((post) => [post.id, compactTitle(post.caption, 'Post')]),
    );
    const eventTitleById = new Map(
      (((eventsResult as any).data ?? []) as Array<{ id: string; event_name: string | null }>).map((event) => [event.id, compactTitle(event.event_name, 'Event')]),
    );

    const mappedRows = requestRows.map((row) => ({
      request_id: row.id,
      owner_user_id: row.owner_user_id,
      owner_username: usernameById.get(row.owner_user_id) ?? null,
      content_kind: row.content_kind,
      feature_kind: row.feature_kind,
      payment_method: row.payment_method,
      status: row.status,
      moderation_status: row.moderation_status,
      duration_hours: row.duration_hours,
      banner_label: row.banner_label,
      banner_image_url: row.banner_image_url,
      livestream_platform: row.livestream_platform,
      livestream_url: row.livestream_url,
      moderation_flags: row.moderation_flags,
      moderation_reason: row.moderation_reason,
      moderation_score: row.moderation_score,
      created_at: row.created_at,
      target_id: row.post_id ?? row.event_id ?? row.id,
      target_title: row.content_kind === 'event'
        ? eventTitleById.get(row.event_id ?? '') ?? 'Event'
        : postTitleById.get(row.post_id ?? '') ?? 'Post',
    })) as FeaturedModerationQueueItem[];

    setBackendStatus('fallback');
    setQueue(mappedRows);
    return mappedRows;
  }, []);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_get_featured_content_requests');
      if (error) {
        if (isMissingRpcError(error, 'admin_get_featured_content_requests')) {
          return await loadQueueFallback();
        }
        console.error('[useFeaturedContentModeration] loadQueue:', error.message);
        return [] as FeaturedModerationQueueItem[];
      }
      const rows = (data ?? []) as FeaturedModerationQueueItem[];
      setBackendStatus('ready');
      setQueue(rows);
      return rows;
    } finally {
      setLoading(false);
    }
  }, [loadQueueFallback]);

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
        if (isMissingRpcError(error, 'admin_review_featured_content_request')) {
          setBackendStatus('unavailable');
          console.warn('[useFeaturedContentModeration] reviewRequest: featured moderation RPC is missing in the database. Apply the featured content migration before using admin review actions.');
          return false;
        }
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
    backendStatus,
    loadQueue,
    reviewRequest,
  };
}
