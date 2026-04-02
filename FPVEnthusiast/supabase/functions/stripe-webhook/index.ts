// supabase/functions/stripe-webhook/index.ts
// =============================================================================
// Edge Function: stripe-webhook
//
// Receives Stripe webhook events and updates marketplace orders, custom themes,
// group animation unlocks, profile appearance purchases, and profile badge unlocks.
//
// Events handled:
//   payment_intent.succeeded      → mark purchase/order 'paid'
//   payment_intent.canceled       → mark purchase/order 'cancelled'
//   payment_intent.payment_failed → mark purchase/order 'cancelled'
//
// Webhook endpoint to register in Stripe Dashboard:
//   https://<project-ref>.supabase.co/functions/v1/stripe-webhook
// =============================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { getPropsBonusForPrice } from '../../../src/constants/profilePurchaseBonuses.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

async function awardPurchasePropsBonus(
  supabase: any,
  ownerUserId: string | null,
  amountCents: number,
  eventType: string,
  referenceId: string,
) {
  if (!ownerUserId) return;

  const propsBonus = getPropsBonusForPrice(amountCents);
  if (propsBonus <= 0) return;

  const { data, error } = await supabase.rpc('award_props', {
    p_user_id: ownerUserId,
    p_event_type: eventType,
    p_props: propsBonus,
    p_reference_id: referenceId,
  });

  if (error) {
    console.error('Props bonus award failed', { ownerUserId, amountCents, eventType, referenceId, error });
    return;
  }

  console.log('Props bonus award result', { ownerUserId, propsBonus, eventType, referenceId, awarded: data });
}

async function handleProfileAppearancePaymentStatus(
  supabase: any,
  pi: Stripe.PaymentIntent,
  status: 'paid' | 'cancelled',
) {
  const now = new Date().toISOString();

  let ownerUserId = pi.metadata?.owner_user_id ?? null;
  let itemType = pi.metadata?.item_type ?? null;
  let itemId = pi.metadata?.item_id ?? null;
  let amountCents = Number(pi.amount_received ?? pi.amount ?? 0);

  const updatePayload: Record<string, unknown> = {
    status,
    updated_at: now,
  };

  const { data: updatedPurchase, error: updateErr } = await supabase
    .from('user_profile_appearance_purchases')
    .update(updatePayload)
    .eq('stripe_payment_intent', pi.id)
    .select('owner_user_id, item_type, item_id, purchase_amount_cents')
    .maybeSingle();

  if (updateErr) {
    console.error('Profile appearance purchase update failed', pi.id, updateErr);
    throw updateErr;
  }

  if (updatedPurchase) {
    ownerUserId = updatedPurchase.owner_user_id ?? ownerUserId;
    itemType = updatedPurchase.item_type ?? itemType;
    itemId = updatedPurchase.item_id ?? itemId;
    amountCents = Number(updatedPurchase.purchase_amount_cents ?? amountCents);
  } else if (ownerUserId && itemType && itemId) {
    const { error: fallbackErr } = await supabase
      .from('user_profile_appearance_purchases')
      .update(updatePayload)
      .eq('owner_user_id', ownerUserId)
      .eq('item_type', itemType)
      .eq('item_id', itemId)
      .eq('status', 'pending_payment');

    if (fallbackErr) {
      console.error('Profile appearance fallback update failed', pi.id, fallbackErr);
      throw fallbackErr;
    }
  }

  if (status !== 'paid' || !ownerUserId || !itemType || !itemId) {
    return;
  }

  const { data: existingPreference, error: prefError } = await supabase
    .from('user_profile_appearance_preferences')
    .select('active_theme_id, active_avatar_frame_id, active_avatar_effect_id')
    .eq('user_id', ownerUserId)
    .maybeSingle();

  if (prefError) {
    console.error('Profile appearance preference fetch failed', ownerUserId, prefError);
    throw prefError;
  }

  const nextPreference = {
    user_id: ownerUserId,
    active_theme_id: existingPreference?.active_theme_id ?? 'default',
    active_avatar_frame_id: existingPreference?.active_avatar_frame_id ?? 'none',
    active_avatar_effect_id: existingPreference?.active_avatar_effect_id ?? 'none',
    updated_at: now,
  };

  if (itemType === 'theme') {
    nextPreference.active_theme_id = itemId;
  } else if (itemType === 'frame') {
    nextPreference.active_avatar_frame_id = itemId;
  } else if (itemType === 'effect') {
    nextPreference.active_avatar_effect_id = itemId;
  } else {
    console.warn('Unknown profile appearance item_type', itemType);
    return;
  }

  const { error: upsertPrefErr } = await supabase
    .from('user_profile_appearance_preferences')
    .upsert(nextPreference, { onConflict: 'user_id' });

  if (upsertPrefErr) {
    console.error('Profile appearance preference upsert failed', ownerUserId, upsertPrefErr);
    throw upsertPrefErr;
  }

  await awardPurchasePropsBonus(supabase, ownerUserId, amountCents, 'profile_appearance_purchase_bonus', pi.id);
}

async function handleProfileBadgePaymentStatus(
  supabase: any,
  pi: Stripe.PaymentIntent,
  status: 'paid' | 'cancelled',
) {
  const now = new Date().toISOString();

  let ownerUserId = pi.metadata?.owner_user_id ?? null;
  let badgeId = pi.metadata?.badge_id ?? null;
  let amountCents = Number(pi.amount_received ?? pi.amount ?? 0);

  const updatePayload: Record<string, unknown> = {
    status,
    updated_at: now,
  };

  if (status === 'paid') {
    updatePayload.purchased_at = now;
  }

  const { data: updatedUnlock, error: updateErr } = await supabase
    .from('user_profile_badge_unlocks')
    .update(updatePayload)
    .eq('stripe_payment_intent', pi.id)
    .select('owner_user_id, badge_id, unlock_amount_cents')
    .maybeSingle();

  if (updateErr) {
    console.error('Profile badge unlock update failed', pi.id, updateErr);
    throw updateErr;
  }

  if (updatedUnlock) {
    ownerUserId = updatedUnlock.owner_user_id ?? ownerUserId;
    badgeId = updatedUnlock.badge_id ?? badgeId;
    amountCents = Number(updatedUnlock.unlock_amount_cents ?? amountCents);
  } else if (ownerUserId && badgeId) {
    const { error: fallbackErr } = await supabase
      .from('user_profile_badge_unlocks')
      .update(updatePayload)
      .eq('owner_user_id', ownerUserId)
      .eq('badge_id', badgeId)
      .eq('status', 'pending_payment');

    if (fallbackErr) {
      console.error('Profile badge fallback update failed', pi.id, fallbackErr);
      throw fallbackErr;
    }
  }

  if (status !== 'paid' || !ownerUserId || !badgeId) {
    return;
  }

  const { data: existingPreference, error: prefError } = await supabase
    .from('user_profile_badge_preferences')
    .select('featured_badge_ids')
    .eq('user_id', ownerUserId)
    .maybeSingle();

  if (prefError) {
    console.error('Profile badge preference fetch failed', ownerUserId, prefError);
    throw prefError;
  }

  const currentFeatured = Array.isArray(existingPreference?.featured_badge_ids)
    ? existingPreference.featured_badge_ids.filter((value: unknown): value is string => typeof value === 'string' && value.length > 0)
    : [];

  if (currentFeatured.length === 0) {
    const { error: upsertPrefErr } = await supabase
      .from('user_profile_badge_preferences')
      .upsert(
        {
          user_id: ownerUserId,
          featured_badge_ids: [badgeId],
          updated_at: now,
        },
        { onConflict: 'user_id' },
      );

    if (upsertPrefErr) {
      console.error('Profile badge preference upsert failed', ownerUserId, upsertPrefErr);
      throw upsertPrefErr;
    }
  }

  await awardPurchasePropsBonus(supabase, ownerUserId, amountCents, 'profile_badge_purchase_bonus', pi.id);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!stripeSecretKey || !webhookSecret || !supabaseUrl || !supabaseServiceRoleKey) {
    console.error('Missing required webhook environment variables');
    return new Response('Server configuration error', { status: 500 });
  }

  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: '2024-04-10',
    httpClient: Stripe.createFetchHttpClient(),
  });

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

  const sig = req.headers.get('stripe-signature') ?? '';
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed', err);
    return new Response('Webhook Error', { status: 400 });
  }

  const pi = event.data.object as Stripe.PaymentIntent;
  const paymentKind = pi.metadata?.kind ?? null;

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

      const shouldAutoActivateTheme =
        !existingPreference ||
        (
          existingPreference.active_theme_type === 'custom' &&
          existingPreference.active_theme_id === customTheme.id
        );

      if (shouldAutoActivateTheme) {
        await supabase
          .from('social_group_theme_preferences')
          .upsert(
            {
              user_id: customTheme.owner_user_id,
              group_id: customTheme.group_id,
              active_theme_type: 'custom',
              active_theme_id: customTheme.id,
              active_animation_variant_id: existingPreference?.active_animation_variant_id ?? 'none',
              updated_at: now,
            },
            { onConflict: 'user_id,group_id' },
          );
      }

      return json({ received: true });
    }

    if (paymentKind === 'group_card_animation') {
      const { data: purchaseRow, error: fetchPurchaseErr } = await supabase
        .from('social_group_animation_purchases')
        .select('id, group_id, owner_user_id, variant_id, status')
        .eq('stripe_payment_intent', pi.id)
        .maybeSingle();

      if (fetchPurchaseErr || !purchaseRow) {
        console.error('Animation purchase not found for PI', pi.id, fetchPurchaseErr);
        return json({ received: true });
      }

      const { data: existingPaid } = await supabase
        .from('social_group_animation_purchases')
        .select('id')
        .eq('owner_user_id', purchaseRow.owner_user_id)
        .eq('variant_id', purchaseRow.variant_id)
        .eq('status', 'paid')
        .neq('id', purchaseRow.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (existingPaid?.id) {
        const { error: archiveErr } = await supabase
          .from('social_group_animation_purchases')
          .update({ status: 'archived', updated_at: now })
          .eq('id', purchaseRow.id);

        if (archiveErr) {
          console.error('Could not archive duplicate animation purchase', purchaseRow.id, archiveErr);
        }

        const { data: existingPreference } = await supabase
          .from('social_group_theme_preferences')
          .select('active_theme_type, active_theme_id')
          .eq('user_id', purchaseRow.owner_user_id)
          .eq('group_id', purchaseRow.group_id)
          .maybeSingle();

        await supabase
          .from('social_group_theme_preferences')
          .upsert(
            {
              user_id: purchaseRow.owner_user_id,
              group_id: purchaseRow.group_id,
              active_theme_type: existingPreference?.active_theme_type ?? 'preset',
              active_theme_id: existingPreference?.active_theme_id ?? 'midnight',
              active_animation_variant_id: purchaseRow.variant_id,
              updated_at: now,
            },
            { onConflict: 'user_id,group_id' },
          );

        return json({ received: true, deduplicated: true });
      }

      const { data: animationPurchase, error: animationErr } = await supabase
        .from('social_group_animation_purchases')
        .update({ status: 'paid', updated_at: now })
        .eq('id', purchaseRow.id)
        .select('id, group_id, owner_user_id, variant_id')
        .single();

      if (animationErr || !animationPurchase) {
        console.error('Animation purchase could not be marked paid for PI', pi.id, animationErr);
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
        .upsert(
          {
            user_id: animationPurchase.owner_user_id,
            group_id: animationPurchase.group_id,
            active_theme_type: existingPreference?.active_theme_type ?? 'preset',
            active_theme_id: existingPreference?.active_theme_id ?? 'midnight',
            active_animation_variant_id: animationPurchase.variant_id,
            updated_at: now,
          },
          { onConflict: 'user_id,group_id' },
        );

      return json({ received: true });
    }

    if (paymentKind === 'profile_appearance') {
      await handleProfileAppearancePaymentStatus(supabase, pi, 'paid');
      return json({ received: true });
    }

    if (paymentKind === 'profile_badge') {
      await handleProfileBadgePaymentStatus(supabase, pi, 'paid');
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

    await supabase
      .from('notifications')
      .insert({
        user_id: order.seller_id,
        actor_id: order.buyer_id,
        type: 'new_message',
        entity_id: order.listing_id,
        entity_type: 'listing',
        body: `Someone bought your listing for $${(order.amount_cents / 100).toFixed(2)}! Ship it within 3 days.`,
      })
      .then(({ error }) => {
        if (error) console.warn('Notify seller error', error);
      });

    return json({ received: true });
  }

  if (
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
      await handleProfileAppearancePaymentStatus(supabase, pi, 'cancelled');
      return json({ received: true });
    }

    if (paymentKind === 'profile_badge') {
      await handleProfileBadgePaymentStatus(supabase, pi, 'cancelled');
      return json({ received: true });
    }

    await supabase
      .from('marketplace_orders')
      .update({ status: 'cancelled', cancelled_at: now, updated_at: now })
      .eq('stripe_payment_intent', pi.id);

    return json({ received: true });
  }

  return json({ received: true });
});
