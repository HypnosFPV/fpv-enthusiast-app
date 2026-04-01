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
  const paymentKind = pi.metadata?.kind ?? null;

  // ── Handle events ──────────────────────────────────────────────────────────
  if (event.type === 'payment_intent.succeeded') {
    const now = new Date().toISOString();

    if (paymentKind === 'group_custom_theme') {
      const { data: customTheme, error: themeErr } = await supabase
        .from('social_group_custom_themes')
        .update({ status: 'paid', updated_at: now })
        .eq('stripe_payment_intent', pi.id)
        .select('id, group_id, owner_user_id')
        .single();

      if (themeErr || !customTheme) {
        console.error('Custom theme not found for PI', pi.id, themeErr);
        return json({ received: true });
      }

      const { data: existingPreference } = await supabase
        .from('social_group_theme_preferences')
        .select('active_theme_type, active_theme_id, active_animation_variant_id')
        .eq('user_id', customTheme.owner_user_id)
        .eq('group_id', customTheme.group_id)
        .maybeSingle();

      const shouldAutoActivateTheme = !existingPreference
        || (existingPreference.active_theme_type === 'custom' && existingPreference.active_theme_id === customTheme.id);

      if (shouldAutoActivateTheme) {
        await supabase
          .from('social_group_theme_preferences')
          .upsert({
            user_id: customTheme.owner_user_id,
            group_id: customTheme.group_id,
            active_theme_type: 'custom',
            active_theme_id: customTheme.id,
            active_animation_variant_id: 'none',
            updated_at: now,
          }, { onConflict: 'user_id,group_id' });
      }

      return json({ received: true });
    }

    if (paymentKind === 'group_card_animation') {
      const { data: animationPurchase, error: animationErr } = await supabase
        .from('social_group_animation_purchases')
        .update({ status: 'paid', updated_at: now })
        .eq('stripe_payment_intent', pi.id)
        .select('id, group_id, owner_user_id, variant_id')
        .single();

      if (animationErr || !animationPurchase) {
        console.error('Animation purchase not found for PI', pi.id, animationErr);
        return json({ received: true });
      }

      const { data: existingPreference } = await supabase
        .from('social_group_theme_preferences')
        .select('active_theme_type, active_theme_id')
        .eq('user_id', animationPurchase.owner_user_id)
        .eq('group_id', animationPurchase.group_id)
        .maybeSingle();

      await supabase
        .from('social_group_theme_preferences')
        .upsert({
          user_id: animationPurchase.owner_user_id,
          group_id: animationPurchase.group_id,
          active_theme_type: existingPreference?.active_theme_type ?? 'preset',
          active_theme_id: existingPreference?.active_theme_id ?? 'midnight',
          active_animation_variant_id: animationPurchase.variant_id,
          updated_at: now,
        }, { onConflict: 'user_id,group_id' });

      return json({ received: true });
    }

    if (paymentKind === 'profile_appearance') {
      const { data: appearancePurchase, error: appearanceErr } = await supabase
        .from('user_profile_appearance_purchases')
        .update({ status: 'paid', updated_at: now })
        .eq('stripe_payment_intent', pi.id)
        .select('id, owner_user_id, item_type, item_id')
        .single();

      if (appearanceErr || !appearancePurchase) {
        console.error('Profile appearance purchase not found for PI', pi.id, appearanceErr);
        return json({ received: true });
      }

      const { data: existingPreference } = await supabase
        .from('user_profile_appearance_preferences')
        .select('active_theme_id, active_avatar_frame_id, active_avatar_effect_id')
        .eq('user_id', appearancePurchase.owner_user_id)
        .maybeSingle();

      await supabase
        .from('user_profile_appearance_preferences')
        .upsert({
          user_id: appearancePurchase.owner_user_id,
          active_theme_id: appearancePurchase.item_type === 'theme'
            ? appearancePurchase.item_id
            : existingPreference?.active_theme_id ?? 'default',
          active_avatar_frame_id: appearancePurchase.item_type === 'frame'
            ? appearancePurchase.item_id
            : existingPreference?.active_avatar_frame_id ?? 'none',
          active_avatar_effect_id: appearancePurchase.item_type === 'effect'
            ? appearancePurchase.item_id
            : existingPreference?.active_avatar_effect_id ?? 'none',
          updated_at: now,
        }, { onConflict: 'user_id' });

      return json({ received: true });
    }

    const { data: order, error: fetchErr } = await supabase
      .from('marketplace_orders')
      .select('id, listing_id, seller_id, buyer_id, amount_cents')
      .eq('stripe_payment_intent', pi.id)
      .single();

    if (fetchErr || !order) {
      console.error('Order not found for PI', pi.id, fetchErr);
      return json({ received: true });
    }

    await supabase
      .from('marketplace_orders')
      .update({ status: 'paid', paid_at: now, updated_at: now })
      .eq('id', order.id);

    await supabase
      .from('marketplace_listings')
      .update({ status: 'sold', updated_at: now })
      .eq('id', order.listing_id);

    await supabase.from('notifications').insert({
      user_id:    order.seller_id,
      actor_id:   order.buyer_id,
      type:       'new_message',
      entity_id:  order.listing_id,
      entity_type: 'listing',
      body:       `Someone bought your listing for $${(order.amount_cents / 100).toFixed(2)}! Ship it within 3 days.`,
    }).then(({ error }) => { if (error) console.warn('Notify seller error', error); });

  } else if (
    event.type === 'payment_intent.canceled' ||
    event.type === 'payment_intent.payment_failed'
  ) {
    const now = new Date().toISOString();

    if (paymentKind === 'group_custom_theme') {
      await supabase
        .from('social_group_custom_themes')
        .update({ status: 'cancelled', updated_at: now })
        .eq('stripe_payment_intent', pi.id);
      return json({ received: true });
    }

    if (paymentKind === 'group_card_animation') {
      await supabase
        .from('social_group_animation_purchases')
        .update({ status: 'cancelled', updated_at: now })
        .eq('stripe_payment_intent', pi.id);
      return json({ received: true });
    }

    if (paymentKind === 'profile_appearance') {
      await supabase
        .from('user_profile_appearance_purchases')
        .update({ status: 'cancelled', updated_at: now })
        .eq('stripe_payment_intent', pi.id);
      return json({ received: true });
    }

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
