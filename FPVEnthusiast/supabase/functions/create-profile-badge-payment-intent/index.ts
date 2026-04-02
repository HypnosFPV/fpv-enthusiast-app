import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.25.0?target=deno';

type ProfileBadgeDefinition = {
  id: string;
  name: string;
  tier: 'common' | 'rare' | 'epic' | 'legendary' | 'seasonal';
  priceCents: number;
  description: string;
  accentColor: string;
  iconName: string;
  limited: boolean;
};

const PROFILE_BADGES: ProfileBadgeDefinition[] = [
  {
    id: 'founder_signal',
    name: 'Founder Signal',
    tier: 'rare',
    priceCents: 299,
    description: 'Early supporter energy with a clean neon founder mark.',
    accentColor: '#8b5cf6',
    iconName: 'sparkles-outline',
    limited: false,
  },
  {
    id: 'aerial_ace',
    name: 'Aerial Ace',
    tier: 'common',
    priceCents: 399,
    description: 'Fast, sharp, and unmistakably FPV.',
    accentColor: '#06b6d4',
    iconName: 'rocket-outline',
    limited: false,
  },
  {
    id: 'midnight_orbit',
    name: 'Midnight Orbit',
    tier: 'epic',
    priceCents: 499,
    description: 'Dark premium badge with orbit-core styling.',
    accentColor: '#0ea5e9',
    iconName: 'planet-outline',
    limited: false,
  },
  {
    id: 'storm_chaser',
    name: 'Storm Chaser',
    tier: 'epic',
    priceCents: 599,
    description: 'Electric storm styling for aggressive profile flex.',
    accentColor: '#f59e0b',
    iconName: 'flash-outline',
    limited: false,
  },
  {
    id: 'season_zero',
    name: 'Season Zero',
    tier: 'legendary',
    priceCents: 799,
    description: 'A premium first-wave collectible for early adopters.',
    accentColor: '#ef4444',
    iconName: 'trophy-outline',
    limited: true,
  },
];

function getProfileBadge(badgeId?: string | null) {
  if (!badgeId) return null;
  return PROFILE_BADGES.find((badge) => badge.id === badgeId) ?? null;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
    const STRIPE_PUBLISHABLE_KEY = Deno.env.get('STRIPE_PUBLISHABLE_KEY') ?? '';

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return json({ error: 'Supabase environment variables are missing' }, 500);
    }

    if (!STRIPE_SECRET_KEY || !STRIPE_PUBLISHABLE_KEY) {
      return json({ error: 'Stripe environment variables are missing' }, 500);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'Missing authorization header' }, 401);
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const body = await req.json().catch(() => null);
    const badgeId = body?.badgeId;

    if (!badgeId || typeof badgeId !== 'string') {
      return json({ error: 'badgeId is required' }, 400);
    }

    const badge = getProfileBadge(badgeId);
    if (!badge) {
      return json({ error: 'Badge not found' }, 404);
    }

    const { data: existingUnlock, error: existingUnlockError } = await adminClient
      .from('user_profile_badge_unlocks')
      .select('id, status')
      .eq('owner_user_id', user.id)
      .eq('badge_id', badge.id)
      .maybeSingle();

    if (existingUnlockError) {
      return json({ error: existingUnlockError.message }, 500);
    }

    if (existingUnlock?.status === 'paid' || existingUnlock?.status === 'granted') {
      return json({ error: 'Badge already owned' }, 409);
    }

    const stripe = new Stripe(STRIPE_SECRET_KEY, {
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
      amount: badge.priceCents,
      currency: 'usd',
      customer: customer.id,
      automatic_payment_methods: { enabled: true },
      description: `Unlock ${badge.name} profile badge`,
      receipt_email: user.email ?? undefined,
      metadata: {
        kind: 'profile_badge',
        owner_user_id: user.id,
        badge_id: badge.id,
      },
    });

    const { error: upsertError } = await adminClient
      .from('user_profile_badge_unlocks')
      .upsert(
        {
          owner_user_id: user.id,
          badge_id: badge.id,
          status: 'pending_payment',
          unlock_source: 'stripe',
          unlock_amount_cents: badge.priceCents,
          stripe_payment_intent: paymentIntent.id,
          meta: {
            badge_name: badge.name,
            badge_tier: badge.tier,
          },
        },
        {
          onConflict: 'owner_user_id,badge_id',
        },
      );

    if (upsertError) {
      return json({ error: upsertError.message }, 500);
    }

    return json({
      paymentIntentClientSecret: paymentIntent.client_secret,
      ephemeralKeySecret: ephemeralKey.secret,
      customerId: customer.id,
      publishableKey: STRIPE_PUBLISHABLE_KEY,
      badge: {
        id: badge.id,
        name: badge.name,
        priceCents: badge.priceCents,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return json({ error: message }, 500);
  }
});
