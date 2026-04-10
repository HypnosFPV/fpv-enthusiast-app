export type NotificationType =
  | 'like'
  | 'comment'
  | 'follow'
  | 'mention'
  | 'reply'
  | 'comment_reply'
  | 'challenge_voting_open'
  | 'challenge_voting_closing'
  | 'challenge_result'
  | 'new_message'
  | 'new_offer'
  | 'offer_accepted'
  | 'offer_declined'
  | 'offer_countered'
  | 'marketplace_dispute'
  | 'dispute_resolved'
  | 'item_sold'
  | 'item_delivered'
  | 'item_shipped'
  | 'payment_received'
  | 'group_invite'
  | 'daily_check_in';

const PUSH_ENABLED_TYPES = new Set<NotificationType>([
  'challenge_voting_open',
  'challenge_voting_closing',
  'challenge_result',
  'new_message',
  'new_offer',
  'offer_accepted',
  'offer_declined',
  'offer_countered',
  'marketplace_dispute',
  'dispute_resolved',
  'item_sold',
  'item_delivered',
  'item_shipped',
  'payment_received',
  'group_invite',
]);

export function shouldSendPushForNotificationType(type: string | null | undefined): type is NotificationType {
  if (!type) return false;
  return PUSH_ENABLED_TYPES.has(type as NotificationType);
}

export function logNotificationLifecycle(
  event:
    | 'inserted'
    | 'insert_error'
    | 'push_sent'
    | 'push_skipped'
    | 'push_error',
  context: {
    source: string;
    type?: string | null;
    userId?: string | null;
    notificationId?: string | null;
    reason?: string | null;
    extra?: Record<string, unknown>;
  },
) {
  const payload = {
    event,
    source: context.source,
    type: context.type ?? null,
    user_id: context.userId ?? null,
    notification_id: context.notificationId ?? null,
    reason: context.reason ?? null,
    ...(context.extra ? { extra: context.extra } : {}),
  };

  try {
    console.log('[notification-lifecycle]', JSON.stringify(payload));
  } catch {
    console.log('[notification-lifecycle]', payload);
  }
}
