// src/utils/marketplaceNotifications.ts
// Send in-app DB notification + Expo push to a user for marketplace events.

import { supabase } from '../services/supabase';

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
    offer_declined: `declined your offer on "${p.listingTitle}",`
    offer_countered: `sent a counter-offer on "${p.listingTitle}"`,
  };

  const bodies: Record<NotifType, string> = {
    new_message:    `New message on "${p.listingTitle}"`,
    new_offer:      `New offer: ${p.extraMessage ?? ''} on "${p.listingTitle}"`,
    offer_accepted: `Your offer on "${p.listingTitle}" was accepted!`,
    offer_declined: `Your offer on "${p.listingTitle}" was declined.`,
    offer_countered: `The seller countered your offer on "${p.listingTitle}" at ${p.extraMessage ?? "a new price"}.`,
  };

  // 1. Insert in-app notification (fire-and-forget — don't block UI)
  supabase.from('notifications').insert({
    user_id:    p.recipientId,
    actor_id:   p.actorId,
    type:       p.type,
    message:    messages[p.type],
    post_id:    null,
    comment_id: null,
    read:       false,
  }).then(({ error }) => {
    if (error) console.warn('[marketplaceNotif] in-app insert error:', error.message);
  });

  // 2. Look up recipient's push token and send Expo push (fire-and-forget)
  supabase
    .from('user_push_tokens')
    .select('token')
    .eq('user_id', p.recipientId)
    .limit(1)
    .maybeSingle()
    .then(({ data }) => {
      if (!data?.token) return;
      const titles: Record<NotifType, string> = {
        new_message:    '💬 New Message',
        new_offer:      '🏷️ New Offer Received',
        offer_accepted: '✅ Offer Accepted!',
        offer_declined: '❌ Offer Declined',
        offer_countered: '↩️ Counter Offer',
      };
      fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          to:    data.token,
          title: titles[p.type],
          body:  bodies[p.type],
          data:  { navigate: 'marketplace', listingId: p.listingId, type: p.type },
          sound: 'default',
          badge: 1,
        }),
      }).catch(e => console.warn('[marketplaceNotif] push send error:', e));
    });
}
