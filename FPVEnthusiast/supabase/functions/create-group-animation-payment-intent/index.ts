import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14?target=deno';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const VARIANT_PRICES: Record<string, number> = {
  basic: 99,
  standard: 199,
  premium: 299,
};

const VARIANT_LABELS: Record<string, string> = {
  basic: 'Basic sweep',
  standard: 'Standard glow',
  premium: 'Premium aura',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
    const stripePublishableKey = Deno.env.get('STRIPE_PUBLISHABLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: 'Supabase environment variables are missing.' }, 500);
    }
    if (!stripeSecretKey) {
      return json({ error: 'Stripe secret key is not configured.' }, 500);
    }
    if (!stripePublishableKey) {
      return json({ error: 'Stripe publishable key is not configured.' }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) {
      return json({ error: `Auth failed: ${authErr?.message ?? 'invalid token'}` }, 401);
    }

    const body = await req.json();
    const groupId = typeof body?.group_id === 'string' ? body.group_id : undefined;
    const variantId = String(body?.variant_id ?? '').trim();
    const amountCents = VARIANT_PRICES[variantId];

    if (!groupId) return json({ error: 'group_id required' }, 400);
    if (!amountCents) return json({ error: 'variant_id must be basic, standard, or premium.' }, 400);

    const { data: groupData, error: groupErr } = await supabase
      .from('social_groups')
      .select('id, name, created_by')
      .eq('id', groupId)
      .maybeSingle();

    if (groupErr || !groupData?.id) {
      return json({ error: groupErr?.message ?? 'Group not found.' }, 404);
    }

    const { data: membership } = await supabase
      .from('social_group_members')
      .select('group_id')
      .eq('group_id', groupId)
      .eq('user_id', user.id)
      .maybeSingle();

    const isOwner = groupData.created_by === user.id;
    const isMember = membership?.group_id === groupId;
    if (!isOwner && !isMember) {
      return json({ error: 'You must be a group owner or member to unlock animation for this group.' }, 403);
    }

    const { data: existingPaid } = await supabase
      .from('social_group_animation_purchases')
      .select('id')
      .eq('owner_user_id', user.id)
      .eq('group_id', groupId)
      .eq('variant_id', variantId)
      .eq('status', 'paid')
      .maybeSingle();

    if (existingPaid?.id) {
      return json({ error: 'You already own this animation variant for this group.' }, 409);
    }

    const { data: purchase, error: insertErr } = await supabase
      .from('social_group_animation_purchases')
      .insert({
        group_id: groupId,
        owner_user_id: user.id,
        variant_id: variantId,
        status: 'pending_payment',
        purchase_amount_cents: amountCents,
      })
      .select('id')
      .single();

    if (insertErr || !purchase?.id) {
      return json({ error: insertErr?.message ?? 'Could not create animation purchase.' }, 500);
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2024-04-10',
      httpClient: Stripe.createFetchHttpClient(),
    });

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: {
        kind: 'group_card_animation',
        animation_purchase_id: purchase.id,
        variant_id: variantId,
        group_id: groupId,
        owner_user_id: user.id,
      },
      description: `FPV Enthusiast group card animation — ${groupData.name ?? 'Community'} / ${VARIANT_LABELS[variantId] ?? variantId}`,
    });

    const { error: updateErr } = await supabase
      .from('social_group_animation_purchases')
      .update({
        stripe_payment_intent: paymentIntent.id,
        purchase_amount_cents: amountCents,
      })
      .eq('id', purchase.id);

    if (updateErr) {
      return json({ error: updateErr.message ?? 'Could not save payment intent.' }, 500);
    }

    return json({
      clientSecret: paymentIntent.client_secret,
      purchaseId: purchase.id,
      publishableKey: stripePublishableKey,
      amountCents,
    });
  } catch (err) {
    console.error('create-group-animation-payment-intent error', err);
    return json({ error: String(err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
