import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.25.0?target=deno';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
    const stripePublishableKey = Deno.env.get('STRIPE_PUBLISHABLE_KEY') ?? '';

    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      return json({ error: 'Supabase environment variables are missing.' }, 500);
    }
    if (!stripeSecretKey) {
      return json({ error: 'Stripe secret key is not configured.' }, 500);
    }
    if (!stripePublishableKey) {
      return json({ error: 'Stripe publishable key is not configured.' }, 500);
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const {
      data: { user },
      error: authErr,
    } = await userClient.auth.getUser();

    if (authErr || !user) {
      return json({ error: authErr?.message ?? 'Unauthorized' }, 401);
    }

    const body = await req.json().catch(() => null);
    const requestedSeasonId = typeof body?.seasonId === 'string' ? body.seasonId.trim() : '';

    let seasonQuery = adminClient
      .from('seasons')
      .select('id, number, name, slug, starts_at, ends_at, pass_price_cents, pass_enabled, status')
      .limit(1);

    if (requestedSeasonId) {
      seasonQuery = seasonQuery.eq('id', requestedSeasonId);
    } else {
      seasonQuery = seasonQuery.eq('status', 'active').order('starts_at', { ascending: false });
    }

    let { data: season, error: seasonErr } = await seasonQuery.maybeSingle();

    if ((!season || seasonErr) && !requestedSeasonId) {
      const fallback = await adminClient
        .from('seasons')
        .select('id, number, name, slug, starts_at, ends_at, pass_price_cents, pass_enabled, status')
        .in('status', ['active', 'scheduled'])
        .order('starts_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      season = fallback.data;
      seasonErr = fallback.error;
    }

    if (seasonErr || !season) {
      return json({ error: seasonErr?.message ?? 'No season is available for purchase.' }, 404);
    }

    if (!season.pass_enabled) {
      return json({ error: 'Season pass is not enabled for this season.' }, 400);
    }

    if (!['active', 'scheduled'].includes(season.status)) {
      return json({ error: 'This season is not available for pass purchases.' }, 400);
    }

    const { data: existingPaid, error: existingPaidError } = await adminClient
      .from('user_season_pass_purchases')
      .select('id')
      .eq('user_id', user.id)
      .eq('season_id', season.id)
      .eq('status', 'paid')
      .maybeSingle();

    if (existingPaidError) {
      return json({ error: existingPaidError.message }, 500);
    }

    if (existingPaid?.id) {
      return json({ error: 'You already own this season pass.' }, 409);
    }

    const { data: purchase, error: insertErr } = await adminClient
      .from('user_season_pass_purchases')
      .upsert(
        {
          user_id: user.id,
          season_id: season.id,
          status: 'pending_payment',
          purchase_amount_cents: season.pass_price_cents,
          meta: {
            season_number: season.number,
            season_name: season.name,
          },
        },
        { onConflict: 'user_id,season_id' },
      )
      .select('id')
      .single();

    if (insertErr || !purchase?.id) {
      return json({ error: insertErr?.message ?? 'Could not create season pass purchase.' }, 500);
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2024-04-10',
      httpClient: Stripe.createFetchHttpClient(),
    });

    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      metadata: {
        supabase_user_id: user.id,
      },
    });

    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customer.id },
      { apiVersion: '2024-04-10' },
    );

    const paymentIntent = await stripe.paymentIntents.create({
      amount: season.pass_price_cents,
      currency: 'usd',
      customer: customer.id,
      automatic_payment_methods: { enabled: true },
      receipt_email: user.email ?? undefined,
      metadata: {
        kind: 'season_pass',
        owner_user_id: user.id,
        season_id: season.id,
        season_number: String(season.number),
        season_slug: season.slug ?? '',
        season_pass_purchase_id: purchase.id,
      },
      description: `FPV Enthusiast ${season.name} Season Pass`,
    });

    const { error: updateErr } = await adminClient
      .from('user_season_pass_purchases')
      .update({
        stripe_payment_intent: paymentIntent.id,
        purchase_amount_cents: season.pass_price_cents,
      })
      .eq('id', purchase.id);

    if (updateErr) {
      return json({ error: updateErr.message ?? 'Could not save payment intent.' }, 500);
    }

    return json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentClientSecret: paymentIntent.client_secret,
      ephemeralKeySecret: ephemeralKey.secret,
      customerId: customer.id,
      purchaseId: purchase.id,
      publishableKey: stripePublishableKey,
      amountCents: season.pass_price_cents,
      season,
    });
  } catch (err) {
    console.error('create-season-pass-payment-intent error', err);
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
});
