import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14?target=deno';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CATALOG: Record<string, { itemType: 'theme' | 'frame' | 'effect'; amountCents: number; label: string }> = {
  'theme:hypnos_violet': { itemType: 'theme', amountCents: 699, label: 'Hypnos Violet theme' },
  'theme:ember_signal': { itemType: 'theme', amountCents: 799, label: 'Ember Signal theme' },
  'theme:aurora_teal': { itemType: 'theme', amountCents: 999, label: 'Aurora Teal theme' },
  'frame:ion_ring': { itemType: 'frame', amountCents: 399, label: 'Ion Ring avatar frame' },
  'frame:violet_crown': { itemType: 'frame', amountCents: 499, label: 'Violet Crown avatar frame' },
  'frame:solar_forge': { itemType: 'frame', amountCents: 599, label: 'Solar Forge avatar frame' },
  'effect:soft_pulse': { itemType: 'effect', amountCents: 499, label: 'Soft Pulse avatar effect' },
  'effect:star_orbit': { itemType: 'effect', amountCents: 599, label: 'Star Orbit avatar effect' },
  'effect:storm_field': { itemType: 'effect', amountCents: 799, label: 'Storm Field avatar effect' },
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
    const itemType = String(body?.item_type ?? '').trim() as 'theme' | 'frame' | 'effect';
    const itemId = String(body?.item_id ?? '').trim();
    const catalogItem = CATALOG[`${itemType}:${itemId}`];

    if (!catalogItem || catalogItem.itemType !== itemType) {
      return json({ error: 'Unknown profile appearance item.' }, 400);
    }

    const { data: existingPaid } = await supabase
      .from('user_profile_appearance_purchases')
      .select('id')
      .eq('owner_user_id', user.id)
      .eq('item_type', itemType)
      .eq('item_id', itemId)
      .eq('status', 'paid')
      .maybeSingle();

    if (existingPaid?.id) {
      return json({ error: 'You already own this profile appearance item.' }, 409);
    }

    const { data: purchase, error: insertErr } = await supabase
      .from('user_profile_appearance_purchases')
      .upsert({
        owner_user_id: user.id,
        item_type: itemType,
        item_id: itemId,
        status: 'pending_payment',
        purchase_amount_cents: catalogItem.amountCents,
      }, { onConflict: 'owner_user_id,item_type,item_id' })
      .select('id')
      .single();

    if (insertErr || !purchase?.id) {
      return json({ error: insertErr?.message ?? 'Could not create profile appearance purchase.' }, 500);
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2024-04-10',
      httpClient: Stripe.createFetchHttpClient(),
    });

    const paymentIntent = await stripe.paymentIntents.create({
      amount: catalogItem.amountCents,
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: {
        kind: 'profile_appearance',
        profile_appearance_purchase_id: purchase.id,
        item_type: itemType,
        item_id: itemId,
        owner_user_id: user.id,
      },
      description: `FPV Enthusiast profile appearance unlock — ${catalogItem.label}`,
    });

    const { error: updateErr } = await supabase
      .from('user_profile_appearance_purchases')
      .update({
        stripe_payment_intent: paymentIntent.id,
        purchase_amount_cents: catalogItem.amountCents,
      })
      .eq('id', purchase.id);

    if (updateErr) {
      return json({ error: updateErr.message ?? 'Could not save payment intent.' }, 500);
    }

    return json({
      clientSecret: paymentIntent.client_secret,
      purchaseId: purchase.id,
      publishableKey: stripePublishableKey,
      amountCents: catalogItem.amountCents,
    });
  } catch (err) {
    console.error('create-profile-appearance-payment-intent error', err);
    return json({ error: String(err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
