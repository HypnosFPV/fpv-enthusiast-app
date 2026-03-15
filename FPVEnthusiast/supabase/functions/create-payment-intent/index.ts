// supabase/functions/create-payment-intent/index.ts
// =============================================================================
// Edge Function: create-payment-intent
//
// Called by the buyer when they tap "Buy Now".
//
// POST body:
//   { listing_id: uuid, offer_id?: uuid }
//
// Flow:
//   1. Verify caller is authenticated (JWT).
//   2. Load the listing + seller_profile (for stripe_account_id).
//   3. Compute amounts: total, 5 % platform fee, seller payout.
//   4. Create a Stripe PaymentIntent with automatic_payment_methods.
//   5. Insert a marketplace_orders row with status = 'pending'.
//   6. Return { clientSecret, orderId, publishableKey }.
//
// Environment variables required (Supabase → Project Settings → Edge Functions):
//   STRIPE_SECRET_KEY          — sk_live_… / sk_test_…
//   STRIPE_PUBLISHABLE_KEY     — pk_live_… / pk_test_…
//   SUPABASE_URL               — injected automatically
//   SUPABASE_SERVICE_ROLE_KEY  — injected automatically
// =============================================================================

import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe           from 'https://esm.sh/stripe@14?target=deno';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PLATFORM_FEE_PCT = 0.05; // 5 %

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    // ── Auth ──────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Resolve the calling user from their JWT
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) {
      // Log the actual auth error so it's visible in Supabase function logs
      console.error('Auth error:', authErr?.message ?? 'no user returned', 'token prefix:', token.slice(0, 20));
      return json({ error: `Auth failed: ${authErr?.message ?? 'invalid token'}` }, 401);
    }

    const buyerId = user.id;

    // ── Body ──────────────────────────────────────────────────────────────────
    const { listing_id, offer_id } = await req.json();
    if (!listing_id) return json({ error: 'listing_id required' }, 400);

    // ── Load listing ──────────────────────────────────────────────────────────
    const { data: listing, error: listErr } = await supabase
      .from('marketplace_listings')
      .select('id, title, price, seller_id, status, listing_type')
      .eq('id', listing_id)
      .single();

    if (listErr || !listing) return json({ error: 'Listing not found' }, 404);
    // Allow checkout for 'active' listings (Buy Now) AND 'pending_sale' (accepted offer awaiting payment)
    if (!['active', 'pending_sale'].includes(listing.status)) {
      return json({ error: 'Listing not available for purchase' }, 400);
    }
    if (listing.seller_id === buyerId) return json({ error: 'Cannot buy your own listing' }, 400);

    // ── Determine price ───────────────────────────────────────────────────────
    let amountCents = Math.round(listing.price * 100);

    if (offer_id) {
      const { data: offer } = await supabase
        .from('marketplace_offers')
        .select('amount_cents, counter_amount_cents, status')
        .eq('id', offer_id)
        .eq('buyer_id', buyerId)
        .single();

      if (offer && offer.status === 'accepted') {
        amountCents = offer.counter_amount_cents ?? offer.amount_cents;
      }
    }

    const platformFeeCents  = Math.round(amountCents * PLATFORM_FEE_PCT);
    const sellerPayoutCents = amountCents - platformFeeCents;

    // ── Load seller Stripe account ─────────────────────────────────────────────
    const { data: sellerProfile } = await supabase
      .from('seller_profiles')
      .select('stripe_account_id, stripe_onboarded')
      .eq('user_id', listing.seller_id)
      .maybeSingle();

    const stripeAccountId = sellerProfile?.stripe_account_id;

    // ── Create Stripe PaymentIntent ───────────────────────────────────────────
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
      apiVersion: '2024-04-10',
      httpClient: Stripe.createFetchHttpClient(),
    });

    const piParams: Stripe.PaymentIntentCreateParams = {
      amount:   amountCents,
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: {
        listing_id,
        buyer_id:  buyerId,
        seller_id: listing.seller_id,
        offer_id:  offer_id ?? '',
      },
      description: `FPV Enthusiast — ${listing.title}`,
    };

    // If seller has a connected Stripe account, split payment (application fee)
    if (stripeAccountId && sellerProfile?.stripe_onboarded) {
      piParams.application_fee_amount = platformFeeCents;
      piParams.transfer_data          = { destination: stripeAccountId };
    }

    const paymentIntent = await stripe.paymentIntents.create(piParams);

    // ── Reuse or create pending order ───────────────────────────────────────
    // If the buyer already has a 'pending' order for this listing (e.g., from
    // a previous abandoned payment attempt), reuse it and update the
    // stripe_payment_intent to the new PI rather than creating a duplicate row.
    // This prevents the "Payment Pending" banner from appearing on subsequent
    // visits after a cancelled checkout.
    const { data: existingOrder } = await supabase
      .from('marketplace_orders')
      .select('id')
      .eq('listing_id', listing_id)
      .eq('buyer_id', buyerId)
      .eq('status', 'pending')
      .maybeSingle();

    let orderId: string;

    if (existingOrder?.id) {
      // Update the existing order with the fresh PaymentIntent
      const { error: updateErr } = await supabase
        .from('marketplace_orders')
        .update({
          amount_cents:        amountCents,
          platform_fee_cents:  platformFeeCents,
          seller_payout_cents: sellerPayoutCents,
          stripe_payment_intent: paymentIntent.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingOrder.id);

      if (updateErr) {
        console.error('Order update error', JSON.stringify(updateErr));
        return json({ error: updateErr.message ?? 'Could not update order' }, 500);
      }
      orderId = existingOrder.id;
    } else {
      // Create fresh order
      const { data: order, error: orderErr } = await supabase
        .from('marketplace_orders')
        .insert({
          listing_id,
          buyer_id:            buyerId,
          seller_id:           listing.seller_id,
          amount_cents:        amountCents,
          platform_fee_cents:  platformFeeCents,
          seller_payout_cents: sellerPayoutCents,
          stripe_payment_intent: paymentIntent.id,
          status: 'pending',
        })
        .select('id')
        .single();

      if (orderErr || !order) {
        console.error('Order insert error', JSON.stringify(orderErr));
        return json({ error: orderErr?.message ?? 'Could not create order' }, 500);
      }
      orderId = order.id;
    }

    return json({
      clientSecret:   paymentIntent.client_secret,
      orderId,
      publishableKey: Deno.env.get('STRIPE_PUBLISHABLE_KEY'),
      amountCents,
    });

  } catch (err) {
    console.error('create-payment-intent error', err);
    return json({ error: String(err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
