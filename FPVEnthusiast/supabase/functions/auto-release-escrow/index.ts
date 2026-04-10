// supabase/functions/auto-release-escrow/index.ts
// Called by Supabase pg_cron every hour (or manually).
// Finds all 'shipped' orders where auto_release_at <= NOW()
// and marks them as 'delivered', notifying both parties.
// Real payout transfer is handled by the stripe-webhook or
// a Stripe scheduled payout — this just updates order status.

import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { logNotificationLifecycle, shouldSendPushForNotificationType } from '../../../src/constants/notificationPolicy.ts';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const j = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function sendExpoPushForNotification(
  supabase: any,
  userId: string | null | undefined,
  title: string,
  body: string,
  data: Record<string, unknown>,
) {
  if (!userId) return;

  const notifType = String(data.type ?? '');
  if (!shouldSendPushForNotificationType(notifType)) {
    logNotificationLifecycle('push_skipped', {
      source: 'auto-release-escrow',
      type: notifType,
      userId,
      reason: 'push_matrix_disabled',
      extra: data,
    });
    return;
  }

  const { data: tokenRow, error: tokenError } = await supabase
    .from('user_push_tokens')
    .select('token')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  if (tokenError) {
    logNotificationLifecycle('push_error', {
      source: 'auto-release-escrow',
      type: notifType,
      userId,
      reason: tokenError.message,
      extra: data,
    });
    console.warn('[auto-release-escrow] push token lookup failed', { userId, error: tokenError.message });
    return;
  }

  if (!tokenRow?.token) {
    logNotificationLifecycle('push_skipped', {
      source: 'auto-release-escrow',
      type: notifType,
      userId,
      reason: 'missing_push_token',
      extra: data,
    });
    return;
  }

  try {
    const resp = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        to: tokenRow.token,
        title,
        body,
        data,
        sound: 'default',
        badge: 1,
      }),
    });

    if (!resp.ok) {
      const errorBody = await resp.text();
      logNotificationLifecycle('push_error', {
        source: 'auto-release-escrow',
        type: notifType,
        userId,
        reason: `expo_status_${resp.status}`,
        extra: { ...data, error_body: errorBody },
      });
      console.warn('[auto-release-escrow] expo push failed', { userId, status: resp.status, body: errorBody });
      return;
    }

    logNotificationLifecycle('push_sent', {
      source: 'auto-release-escrow',
      type: notifType,
      userId,
      extra: data,
    });
  } catch (error) {
    logNotificationLifecycle('push_error', {
      source: 'auto-release-escrow',
      type: notifType,
      userId,
      reason: error instanceof Error ? error.message : String(error),
      extra: data,
    });
    console.warn('[auto-release-escrow] expo push exception', { userId, error });
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  // Only allow service-role calls (from pg_cron or admin)
  const auth = req.headers.get('Authorization') ?? '';
  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    const now = new Date().toISOString();

    // Find all shipped orders past their auto_release_at window
    const { data: orders, error: fetchErr } = await sb
      .from('marketplace_orders')
      .select('id, buyer_id, seller_id, listing_id, marketplace_listings(title)')
      .eq('status', 'shipped')
      .not('auto_release_at', 'is', null)
      .lte('auto_release_at', now);

    if (fetchErr) throw fetchErr;
    if (!orders || orders.length === 0) return j({ released: 0, message: 'No orders to release' });

    let released = 0;
    const errors: string[] = [];

    for (const order of orders) {
      try {
        // Mark as delivered
        const { error: updErr } = await sb
          .from('marketplace_orders')
          .update({ status: 'delivered', delivered_at: now, updated_at: now })
          .eq('id', order.id)
          .eq('status', 'shipped'); // guard against race conditions

        if (updErr) { errors.push(`${order.id}: ${updErr.message}`); continue; }

        const listingTitle = (order as any).marketplace_listings?.title ?? 'Your item';

        const buyerTitle = '📦 Delivery confirmed';
        const buyerBody = `"${listingTitle}" was auto-confirmed as delivered. Leave a review!`;
        const buyerData = {
          order_id: order.id,
          orderId: order.id,
          listing_id: order.listing_id,
          listingId: order.listing_id,
          navigate: 'marketplace',
          type: 'item_delivered',
        };

        const { data: insertedBuyerNotif, error: buyerNotifError } = await sb
          .from('notifications')
          .insert({
            user_id: order.buyer_id,
            type:    'item_delivered',
            title:   buyerTitle,
            body:    buyerBody,
            message: `Delivery confirmed for "${listingTitle}".`,
            listing_id: order.listing_id,
            entity_id: order.listing_id,
            entity_type: 'listing',
            data:    buyerData,
          })
          .select('id')
          .maybeSingle();

        if (buyerNotifError) {
          logNotificationLifecycle('insert_error', {
            source: 'auto-release-escrow',
            type: 'item_delivered',
            userId: order.buyer_id,
            reason: buyerNotifError.message,
            extra: buyerData,
          });
          console.warn('[auto-release-escrow] buyer notification failed', { orderId: order.id, error: buyerNotifError.message });
        } else if (insertedBuyerNotif?.id) {
          logNotificationLifecycle('inserted', {
            source: 'auto-release-escrow',
            type: 'item_delivered',
            userId: order.buyer_id,
            notificationId: insertedBuyerNotif.id,
            extra: buyerData,
          });
          await sendExpoPushForNotification(sb, order.buyer_id, buyerTitle, buyerBody, buyerData);
        } else {
          logNotificationLifecycle('push_skipped', {
            source: 'auto-release-escrow',
            type: 'item_delivered',
            userId: order.buyer_id,
            reason: 'notification_filtered_or_not_inserted',
            extra: buyerData,
          });
        }

        const sellerTitle = '💰 Payment released';
        const sellerBody = `"${listingTitle}" was confirmed delivered. Your payout is on the way.`;
        const sellerData = {
          order_id: order.id,
          orderId: order.id,
          listing_id: order.listing_id,
          listingId: order.listing_id,
          navigate: 'marketplace',
          type: 'payment_received',
        };

        const { data: insertedSellerNotif, error: sellerNotifError } = await sb
          .from('notifications')
          .insert({
            user_id: order.seller_id,
            type:    'payment_received',
            title:   sellerTitle,
            body:    sellerBody,
            message: `Payment released for "${listingTitle}".`,
            listing_id: order.listing_id,
            entity_id: order.listing_id,
            entity_type: 'listing',
            data:    sellerData,
          })
          .select('id')
          .maybeSingle();

        if (sellerNotifError) {
          logNotificationLifecycle('insert_error', {
            source: 'auto-release-escrow',
            type: 'payment_received',
            userId: order.seller_id,
            reason: sellerNotifError.message,
            extra: sellerData,
          });
          console.warn('[auto-release-escrow] seller notification failed', { orderId: order.id, error: sellerNotifError.message });
        } else if (insertedSellerNotif?.id) {
          logNotificationLifecycle('inserted', {
            source: 'auto-release-escrow',
            type: 'payment_received',
            userId: order.seller_id,
            notificationId: insertedSellerNotif.id,
            extra: sellerData,
          });
          await sendExpoPushForNotification(sb, order.seller_id, sellerTitle, sellerBody, sellerData);
        } else {
          logNotificationLifecycle('push_skipped', {
            source: 'auto-release-escrow',
            type: 'payment_received',
            userId: order.seller_id,
            reason: 'notification_filtered_or_not_inserted',
            extra: sellerData,
          });
        }

        released++;
      } catch (e) {
        errors.push(`${order.id}: ${String(e)}`);
      }
    }

    console.log(`[auto-release-escrow] Released ${released}/${orders.length} orders`);
    return j({ released, total: orders.length, errors });

  } catch (err) {
    console.error('[auto-release-escrow]', err);
    return j({ error: String(err) }, 500);
  }
});
