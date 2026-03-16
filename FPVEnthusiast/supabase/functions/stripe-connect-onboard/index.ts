// supabase/functions/stripe-connect-onboard/index.ts
// Two-step Stripe Connect Express onboarding:
//  POST { action: 'create_account' } → creates/fetches account + returns onboardingUrl
//  POST { action: 'check_status'   } → checks charges_enabled, marks DB row complete
//
// FIX 2026-03-16: Replaced sb.rpc('upsert_seller_profile') with a direct
// seller_profiles upsert.  The RPC uses auth.uid() internally, but the
// service-role Supabase client has no auth context, so auth.uid() returns NULL
// and the INSERT fails with a NOT NULL constraint on user_id.
// Direct table upsert via the service-role client works correctly.

import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe           from 'https://esm.sh/stripe@14?target=deno';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const j = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return j({ error: 'Unauthorized' }, 401);

    // Service-role client — can read/write any table, bypasses RLS
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Verify the caller's JWT to get their user ID
    const { data: { user }, error: authErr } = await sb.auth.getUser(
      authHeader.replace('Bearer ', ''),
    );
    if (authErr || !user) return j({ error: 'Auth failed' }, 401);

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
      apiVersion: '2024-04-10',
      httpClient: Stripe.createFetchHttpClient(),
    });

    const { action, return_url } = await req.json();

    // ── Helper: upsert seller_profiles row directly (no RPC needed) ──────────
    async function upsertSellerProfile(stripeAccountId: string, onboarded: boolean) {
      const { error } = await sb
        .from('seller_profiles')
        .upsert(
          {
            user_id:          user!.id,
            stripe_account_id: stripeAccountId,
            stripe_onboarded:  onboarded,
            updated_at:        new Date().toISOString(),
          },
          { onConflict: 'user_id' },
        );
      if (error) throw new Error(`DB upsert failed: ${error.message}`);
    }

    // ── CREATE ACCOUNT ───────────────────────────────────────────────────────
    if (action === 'create_account') {
      const { data: sp } = await sb
        .from('seller_profiles')
        .select('stripe_account_id, stripe_onboarded')
        .eq('user_id', user.id)
        .maybeSingle();

      // Already fully onboarded — nothing to do
      if (sp?.stripe_account_id && sp.stripe_onboarded)
        return j({ alreadyOnboarded: true, accountId: sp.stripe_account_id });

      // Reuse existing account ID or create a new Express account
      let accountId = sp?.stripe_account_id ?? null;
      if (!accountId) {
        const acct = await stripe.accounts.create({
          type:          'express',
          country:       'US',
          email:         user.email!,
          capabilities:  { card_payments: { requested: true }, transfers: { requested: true } },
          business_type: 'individual',
          metadata:      { supabase_user_id: user.id },
        });
        accountId = acct.id;
      }

      // Save the account ID before redirecting (onboarded = false until complete)
      await upsertSellerProfile(accountId, false);

      // Generate the hosted onboarding link
      const base = return_url ?? 'fpventhusiast://stripe-connect-return';
      const link = await stripe.accountLinks.create({
        account:     accountId,
        refresh_url: `${base}?status=refresh`,
        return_url:  `${base}?status=complete`,
        type:        'account_onboarding',
        collect:     'eventually_due',
      });

      return j({ accountId, onboardingUrl: link.url });
    }

    // ── CHECK STATUS ─────────────────────────────────────────────────────────
    if (action === 'check_status') {
      const { data: sp } = await sb
        .from('seller_profiles')
        .select('stripe_account_id, stripe_onboarded')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!sp?.stripe_account_id)
        return j({ onboarded: false, payoutsEnabled: false, accountId: null });

      const acct      = await stripe.accounts.retrieve(sp.stripe_account_id);
      const onboarded = !!(acct.charges_enabled && acct.details_submitted);

      // Mark complete + bump verification_tier once Stripe confirms
      if (onboarded && !sp.stripe_onboarded) {
        await upsertSellerProfile(sp.stripe_account_id, true);
        await sb
          .from('seller_profiles')
          .update({ verification_tier: 3, updated_at: new Date().toISOString() })
          .eq('user_id', user.id);
      }

      return j({
        onboarded,
        payoutsEnabled:   acct.payouts_enabled   ?? false,
        chargesEnabled:   acct.charges_enabled   ?? false,
        detailsSubmitted: acct.details_submitted ?? false,
        accountId:        sp.stripe_account_id,
      });
    }

    return j({ error: 'Unknown action' }, 400);

  } catch (err) {
    console.error('[stripe-connect-onboard]', err);
    return j({ error: String(err) }, 500);
  }
});
