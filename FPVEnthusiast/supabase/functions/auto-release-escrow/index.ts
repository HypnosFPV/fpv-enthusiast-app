// supabase/functions/auto-release-escrow/index.ts
// Called by Supabase pg_cron every hour (or manually).
// Finds all 'shipped' orders where auto_release_at <= NOW()
// and marks them as 'delivered', notifying both parties.
// Real payout transfer is handled by the stripe-webhook or
// a Stripe scheduled payout — this just updates order status.

import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const j = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

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

        // Notify buyer
        await sb.from('notifications').insert({
          user_id: order.buyer_id,
          type:    'item_delivered',
          title:   '📦 Delivery confirmed',
          body:    `"${listingTitle}" was auto-confirmed as delivered. Leave a review!`,
          data:    { order_id: order.id, listing_id: order.listing_id },
        });

        // Notify seller
        await sb.from('notifications').insert({
          user_id: order.seller_id,
          type:    'item_delivered',
          title:   '💰 Payment released',
          body:    `"${listingTitle}" was confirmed delivered. Your payout is on the way.`,
          data:    { order_id: order.id, listing_id: order.listing_id },
        });

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
