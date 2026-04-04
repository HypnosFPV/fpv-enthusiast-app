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

function log(stage: string, payload: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ fn: 'create-season-pass-payment-intent', stage, ...payload }));
}

serve(async (req) => {
  const requestId = crypto.randomUUID();

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  if (req.method !== 'POST') {
    log('method_not_allowed', { requestId, method: req.method });
    return json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED', requestId }, 405);
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
    const stripePublishableKey = Deno.env.get('STRIPE_PUBLISHABLE_KEY') ?? '';

    log('request_start', {
      requestId,
      hasAuthHeader: !!authHeader,
      hasToken: !!token,
      hasSupabaseUrl: !!supabaseUrl,
      hasServiceRoleKey: !!serviceRoleKey,
      hasStripeSecretKey: !!stripeSecretKey,
      hasStripePublishableKey: !!stripePublishableKey,
    });

    if (!token) {
      return json({ error: 'Unauthorized: missing bearer token.', code: 'UNAUTHORIZED_NO_TOKEN', requestId }, 401);
    }

    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: 'Supabase environment variables are missing.', code: 'MISSING_SUPABASE_ENV', requestId }, 500);
    }
    if (!stripeSecretKey) {
      return json({ error: 'Stripe secret key is not configured.', code: 'MISSING_STRIPE_SECRET', requestId }, 500);
    }
    if (!stripePublishableKey) {
      return json({ error: 'Stripe publishable key is not configured.', code: 'MISSING_STRIPE_PUBLISHABLE', requestId }, 500);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const {
      data: { user },
      error: authErr,
    } = await adminClient.auth.getUser(token);

    if (authErr || !user) {
      log('auth_get_user_failed', {
        requestId,
        authError: authErr?.message ?? null,
        tokenPreview: token ? `${token.slice(0, 12)}...` : null,
      });
      return json({ error: authErr?.message ?? 'Unauthorized', code: 'AUTH_GET_USER_FAILED', requestId }, 401);
    }

    log('auth_ok', { requestId, userId: user.id, hasEmail: !!user.email });

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
      log('season_lookup_failed', {
        requestId,
        requestedSeasonId: requestedSeasonId || null,
        seasonError: seasonErr?.message ?? null,
      });
      return json({ error: seasonErr?.message ?? 'No season is available for purchase.', code: 'SEASON_LOOKUP_FAILED', requestId }, 404);
    }

    if (!season.pass_enabled) {
      return json({ error: 'Season pass is not enabled for this season.', code: 'SEASON_PASS_DISABLED', requestId }, 400);
    }

    if (!['active', 'scheduled'].includes(season.status)) {
      return json({ error: 'This season is not available for pass purchases.', code: 'SEASON_NOT_PURCHASABLE', requestId }, 400);
    }

    const { data: existingPaid, error: existingPaidError } = await adminClient
      .from('user_season_pass_purchases')
      .select('id')
      .eq('user_id', user.id)
      .eq('season_id', season.id)
      .eq('status', 'paid')
      .maybeSingle();

    if (existingPaidError) {
      return json({ error: existingPaidError.message, code: 'EXISTING_PURCHASE_LOOKUP_FAILED', requestId }, 500);
    }

    if (existingPaid?.id) {
      return json({ error: 'You already own this season pass.', code: 'ALREADY_OWNED', requestId }, 409);
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
      return json({ error: insertErr?.message ?? 'Could not create season pass purchase.', code: 'PURCHASE_UPSERT_FAILED', requestId }, 500);
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2024-04-10',
      httpClient: Stripe.createFetchHttpClient(),
    });

    let customer;
    try {
      customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: {
          supabase_user_id: user.id,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return json({ error: `Stripe customer creation failed: ${message}`, code: 'STRIPE_CUSTOMER_CREATE_FAILED', requestId }, 500);
    }

    let ephemeralKey;
    try {
      ephemeralKey = await stripe.ephemeralKeys.create(
        { customer: customer.id },
        { apiVersion: '2024-04-10' },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return json({ error: `Stripe ephemeral key creation failed: ${message}`, code: 'STRIPE_EPHEMERAL_KEY_FAILED', requestId }, 500);
    }

    let paymentIntent;
    try {
      paymentIntent = await stripe.paymentIntents.create({
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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return json({ error: `Stripe payment intent creation failed: ${message}`, code: 'STRIPE_PAYMENT_INTENT_FAILED', requestId }, 500);
    }

    const { error: updateErr } = await adminClient
      .from('user_season_pass_purchases')
      .update({
        stripe_payment_intent: paymentIntent.id,
        purchase_amount_cents: season.pass_price_cents,
      })
      .eq('id', purchase.id);

    if (updateErr) {
      return json({ error: updateErr.message ?? 'Could not save payment intent.', code: 'PURCHASE_UPDATE_FAILED', requestId }, 500);
    }

    log('success', {
      requestId,
      userId: user.id,
      seasonId: season.id,
      purchaseId: purchase.id,
      paymentIntentId: paymentIntent.id,
    });

    return json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentClientSecret: paymentIntent.client_secret,
      ephemeralKeySecret: ephemeralKey.secret,
      customerId: customer.id,
      purchaseId: purchase.id,
      publishableKey: stripePublishableKey,
      amountCents: season.pass_price_cents,
      season,
      requestId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ fn: 'create-season-pass-payment-intent', stage: 'unhandled_exception', requestId, error: message }));
    return json({ error: message, code: 'UNHANDLED_EXCEPTION', requestId }, 500);
  }
});
