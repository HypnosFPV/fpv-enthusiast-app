// supabase/functions/stripe-webhook/index.ts
// =============================================================================
// Edge Function: stripe-webhook
//
// Receives Stripe webhook events and updates marketplace_orders accordingly.
//
// Events handled:
//   payment_intent.succeeded   → mark order 'paid', notify seller
//   payment_intent.canceled    → mark order 'cancelled'
//   payment_intent.payment_failed → mark order 'cancelled'
//
// Webhook endpoint to register in Stripe Dashboard:
//   https://<project-ref>.supabase.co/functions/v1/stripe-webhook
// Events to select: payment_intent.succeeded, payment_intent.canceled,
//                   payment_intent.payment_failed
//
// Environment variables:
//   STRIPE_SECRET_KEY         — for verifying webhook signature
//   STRIPE_WEBHOOK_SECRET     — whsec_… from Stripe Dashboard
//   SUPABASE_URL              — injected automatically
//   SUPABASE_SERVICE_ROLE_KEY — injected automatically
// =============================================================================

import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe           from 'https://esm.sh/stripe@14?target=deno';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
    apiVersion: '2024-04-10',
    httpClient: Stripe.createFetchHttpClient(),
  });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // ── Verify Stripe signature ────────────────────────────────────────────────
  const sig     = req.headers.get('stripe-signature') ?? '';
  const secret  = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, sig, secret);
  } catch (err) {
    console.error('Webhook signature verification failed', err);
    return new Response('Webhook Error', { status: 400 });
  }

  const pi = event.data.object as Stripe.PaymentIntent;

  // ── Handle events ──────────────────────────────────────────────────────────
  if (event.type === 'payment_intent.succeeded') {
    const now = new Date().toISOString();

    const { data: order, error: fetchErr } = await supabase
      .from('marketplace_orders')
      .select('id, listing_id, seller_id, buyer_id, amount_cents')
      .eq('stripe_payment_intent', pi.id)
      .single();

    if (fetchErr || !order) {
      console.error('Order not found for PI', pi.id, fetchErr);
      return json({ received: true });
    }

    // Update order → paid
    await supabase
      .from('marketplace_orders')
      .update({ status: 'paid', paid_at: now, updated_at: now })
      .eq('id', order.id);

    // Mark listing sold
    await supabase
      .from('marketplace_listings')
      .update({ status: 'sold', updated_at: now })
      .eq('id', order.listing_id);

    // Notify seller
    await supabase.from('notifications').insert({
      user_id:    order.seller_id,
      actor_id:   order.buyer_id,
      type:       'new_message',   // closest existing type; extend if needed
      entity_id:  order.listing_id,
      entity_type: 'listing',
      body:       `Someone bought your listing for $${(order.amount_cents / 100).toFixed(2)}! Ship it within 3 days.`,
    }).then(({ error }) => { if (error) console.warn('Notify seller error', error); });

  } else if (
    event.type === 'payment_intent.canceled' ||
    event.type === 'payment_intent.payment_failed'
  ) {
    const now = new Date().toISOString();
    await supabase
      .from('marketplace_orders')
      .update({ status: 'cancelled', cancelled_at: now, updated_at: now })
      .eq('stripe_payment_intent', pi.id);
  }

  return json({ received: true });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
