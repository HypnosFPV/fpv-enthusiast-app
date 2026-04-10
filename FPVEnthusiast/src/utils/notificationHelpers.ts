import { NotificationType } from '../constants/notificationPolicy';
import { supabase } from '../services/supabase';

export interface NotificationInsertParams {
  recipientId: string;
  actorId?: string | null;
  type: NotificationType;
  postId?: string | null;
  commentId?: string | null;
  message?: string | null;
  title?: string | null;
  body?: string | null;
  entityId?: string | null;
  entityType?: string | null;
  listingId?: string | null;
  challengeId?: string | null;
  data?: Record<string, any> | null;
  read?: boolean;
}

export function buildNotificationInsert(params: NotificationInsertParams) {
  if (!params.recipientId) return null;
  if (params.actorId && params.recipientId === params.actorId) return null;

  const entityId =
    params.entityId ??
    params.commentId ??
    params.postId ??
    params.listingId ??
    params.challengeId ??
    null;

  const entityType =
    params.entityType ??
    (params.commentId ? 'comment'
      : params.postId ? 'post'
      : params.listingId ? 'listing'
      : params.challengeId ? 'challenge'
      : null);

  const fallbackNavigate =
    params.listingId ? 'marketplace'
      : params.challengeId ? 'challenges'
      : params.postId ? 'post'
      : entityType === 'profile' ? 'profile'
      : entityType === 'social_group' ? 'group'
      : entityType === 'event' ? 'map_event'
      : 'notifications';

  const data = {
    ...(params.data ?? {}),
    navigate: (params.data as any)?.navigate ?? fallbackNavigate,
    ...(params.postId ? { post_id: params.postId, postId: params.postId } : {}),
    ...(params.commentId ? { comment_id: params.commentId, commentId: params.commentId } : {}),
    ...(params.listingId ? { listing_id: params.listingId, listingId: params.listingId } : {}),
    ...(params.challengeId ? { challenge_id: params.challengeId, challengeId: params.challengeId } : {}),
    ...(entityType === 'profile' && entityId ? { user_id: entityId, userId: entityId } : {}),
    ...(entityType === 'social_group' && entityId ? { group_id: entityId, groupId: entityId } : {}),
    ...(entityType === 'event' && entityId ? { event_id: entityId, eventId: entityId } : {}),
  };

  return {
    user_id: params.recipientId,
    actor_id: params.actorId ?? null,
    type: params.type,
    post_id: params.postId ?? null,
    comment_id: params.commentId ?? null,
    message: params.message ?? null,
    title: params.title ?? null,
    body: params.body ?? null,
    entity_id: entityId,
    entity_type: entityType,
    listing_id: params.listingId ?? null,
    challenge_id: params.challengeId ?? null,
    data,
    read: params.read ?? false,
  };
}

export async function insertAppNotification(params: NotificationInsertParams) {
  const payload = buildNotificationInsert(params);
  if (!payload) return { data: null, error: null };
  return supabase.from('notifications').insert(payload).select('id').maybeSingle();
}

export async function insertAppNotificationsBatch(params: NotificationInsertParams[]) {
  const rows = params
    .map((item) => buildNotificationInsert(item))
    .filter(Boolean);

  if (!rows.length) return { data: null, error: null };
  return supabase.from('notifications').insert(rows as any).select('id');
}
