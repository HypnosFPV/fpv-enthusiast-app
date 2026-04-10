// src/utils/marketplaceNotifications.ts
// Send in-app DB notification + Expo push to a user for marketplace events.

import { logNotificationLifecycle, shouldSendPushForNotificationType } from '../constants/notificationPolicy';
import { supabase } from '../services/supabase';
import { insertAppNotification } from './notificationHelpers';

type NotifType = 'new_message' | 'new_offer' | 'offer_accepted' | 'offer_declined' | 'offer_countered';

interface MarketplaceNotifParams {
  recipientId:   string;   // user to notify
  actorId:       string;   // who triggered it
  type:          NotifType;
  listingId:     string;
  listingTitle:  string;
  extraMessage?: string;   // e.g. "$150.00 offer"
}

/** Insert in-app notification row + fire-and-forget Expo push. */
export async function sendMarketplaceNotification(p: MarketplaceNotifParams) {
  const messages: Record<NotifType, string> = {
    new_message:    `sent you a message about "${p.listingTitle}"`,
    new_offer:      `made an offer of ${p.extraMessage ?? ''} on "${p.listingTitle}"`,
    offer_accepted: `accepted your offer on "${p.listingTitle}"`,
    offer_declined: `declined your offer on "${p.listingTitle}"`,
    offer_countered: `sent a counter-offer on "${p.listingTitle}"`,
  };

  const bodies: Record<NotifType, string> = {
    new_message:    `New message on "${p.listingTitle}"`,
    new_offer:      `New offer: ${p.extraMessage ?? ''} on "${p.listingTitle}"`,
    offer_accepted: `Your offer on "${p.listingTitle}" was accepted!`,
    offer_declined: `Your offer on "${p.listingTitle}" was declined.`,
    offer_countered: `The seller countered your offer on "${p.listingTitle}" at ${p.extraMessage ?? "a new price"}.`,
  };

  const titles: Record<NotifType, string> = {
    new_message:    '💬 New Message',
    new_offer:      '🏷️ New Offer Received',
    offer_accepted: '✅ Offer Accepted!',
    offer_declined: '❌ Offer Declined',
    offer_countered:'↩️ Counter Offer',
  };

  // 1. Insert in-app notification. The DB trigger now applies user notification
  // preferences globally. If no row comes back, the user opted out, so skip push.
  const { data: inserted, error: insertError } = await insertAppNotification({
    recipientId: p.recipientId,
    actorId: p.actorId,
    type: p.type,
    title: titles[p.type],
    body: bodies[p.type],
    message: messages[p.type],
    listingId: p.listingId,
    entityId: p.listingId,
    entityType: 'listing',
    data: {
      listing_id: p.listingId,
      listingId: p.listingId,
      navigate: 'marketplace',
      type: p.type,
    },
  });

  if (insertError) {
    logNotificationLifecycle('insert_error', {
      source: 'marketplaceNotifications',
      type: p.type,
      userId: p.recipientId,
      reason: insertError.message,
      extra: { listing_id: p.listingId },
    });
    console.warn('[marketplaceNotif] in-app insert error:', insertError.message);
    return;
  }

  if (!inserted?.id) {
    logNotificationLifecycle('push_skipped', {
      source: 'marketplaceNotifications',
      type: p.type,
      userId: p.recipientId,
      reason: 'notification_filtered_or_not_inserted',
      extra: { listing_id: p.listingId },
    });
    return;
  }

  logNotificationLifecycle('inserted', {
    source: 'marketplaceNotifications',
    type: p.type,
    userId: p.recipientId,
    notificationId: inserted.id,
    extra: { listing_id: p.listingId },
  });

  if (!shouldSendPushForNotificationType(p.type)) {
    logNotificationLifecycle('push_skipped', {
      source: 'marketplaceNotifications',
      type: p.type,
      userId: p.recipientId,
      notificationId: inserted.id,
      reason: 'push_matrix_disabled',
      extra: { listing_id: p.listingId },
    });
    return;
  }

  // 2. Look up recipient's push token and send Expo push.
  const { data, error: tokenError } = await supabase
    .from('user_push_tokens')
    .select('token')
    .eq('user_id', p.recipientId)
    .limit(1)
    .maybeSingle();

  if (tokenError) {
    logNotificationLifecycle('push_error', {
      source: 'marketplaceNotifications',
      type: p.type,
      userId: p.recipientId,
      notificationId: inserted.id,
      reason: tokenError.message,
      extra: { listing_id: p.listingId },
    });
    console.warn('[marketplaceNotif] push token lookup error:', tokenError.message);
    return;
  }

  if (!data?.token) {
    logNotificationLifecycle('push_skipped', {
      source: 'marketplaceNotifications',
      type: p.type,
      userId: p.recipientId,
      notificationId: inserted.id,
      reason: 'missing_push_token',
      extra: { listing_id: p.listingId },
    });
    return;
  }

  try {
    const resp = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        to:    data.token,
        title: titles[p.type],
        body:  bodies[p.type],
        data:  { navigate: 'marketplace', listing_id: p.listingId, listingId: p.listingId, type: p.type },
        sound: 'default',
        badge: 1,
      }),
    });

    if (!resp.ok) {
      const errorBody = await resp.text();
      logNotificationLifecycle('push_error', {
        source: 'marketplaceNotifications',
        type: p.type,
        userId: p.recipientId,
        notificationId: inserted.id,
        reason: `expo_status_${resp.status}`,
        extra: { listing_id: p.listingId, error_body: errorBody },
      });
      console.warn('[marketplaceNotif] push send failed:', resp.status, errorBody);
      return;
    }

    logNotificationLifecycle('push_sent', {
      source: 'marketplaceNotifications',
      type: p.type,
      userId: p.recipientId,
      notificationId: inserted.id,
      extra: { listing_id: p.listingId },
    });
  } catch (e) {
    logNotificationLifecycle('push_error', {
      source: 'marketplaceNotifications',
      type: p.type,
      userId: p.recipientId,
      notificationId: inserted.id,
      reason: e instanceof Error ? e.message : String(e),
      extra: { listing_id: p.listingId },
    });
    console.warn('[marketplaceNotif] push send error:', e);
  }
}
