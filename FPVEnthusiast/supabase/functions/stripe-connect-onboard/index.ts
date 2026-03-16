// supabase/functions/stripe-connect-onboard/index.ts
// Two-step Stripe Connect Express onboarding:
//  POST { action: 'create_account' } → creates account + returns onboardingUrl
//  POST { action: 'check_status'   } → checks charges_enabled, marks DB row

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
    const auth = req.headers.get('Authorization');
    if (!auth) return j({ error: 'Unauthorized' }, 401);

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: { user }, error: ae } = await sb.auth.getUser(auth.replace('Bearer ', ''));
    if (ae || !user) return j({ error: 'Auth failed' }, 401);

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
      apiVersion: '2024-04-10', httpClient: Stripe.createFetchHttpClient(),
    });
    const { action, return_url } = await req.json();

    // ── CREATE ACCOUNT ───────────────────────────────────────────────────────
    if (action === 'create_account') {
      const { data: sp } = await sb.from('seller_profiles')
        .select('stripe_account_id, stripe_onboarded').eq('user_id', user.id).maybeSingle();

      if (sp?.stripe_account_id && sp.stripe_onboarded)
        return j({ alreadyOnboarded: true, accountId: sp.stripe_account_id });

      let accountId = sp?.stripe_account_id;
      if (!accountId) {
        const acct = await stripe.accounts.create({
          type: 'express', country: 'US', email: user.email!,
          capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
          business_type: 'individual',
          metadata: { supabase_user_id: user.id },
        });
        accountId = acct.id;
        await sb.rpc('upsert_seller_profile', { p_stripe_account_id: accountId, p_stripe_onboarded: false });
      }

      const base = return_url ?? 'fpventhusiast://stripe-connect-return';
      const link = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: `${base}?status=refresh`,
        return_url:  `${base}?status=complete`,
        type: 'account_onboarding',
        collect: 'eventually_due',
      });
      return j({ accountId, onboardingUrl: link.url });
    }

    // ── CHECK STATUS ─────────────────────────────────────────────────────────
    if (action === 'check_status') {
      const { data: sp } = await sb.from('seller_profiles')
        .select('stripe_account_id, stripe_onboarded').eq('user_id', user.id).maybeSingle();
      if (!sp?.stripe_account_id) return j({ onboarded: false, payoutsEnabled: false, accountId: null });

      const acct = await stripe.accounts.retrieve(sp.stripe_account_id);
      const onboarded = !!(acct.charges_enabled && acct.details_submitted);
      if (onboarded && !sp.stripe_onboarded) {
        await sb.rpc('upsert_seller_profile', { p_stripe_account_id: sp.stripe_account_id, p_stripe_onboarded: true });
        await sb.from('seller_profiles').update({ verification_tier: 3, updated_at: new Date().toISOString() }).eq('user_id', user.id);
      }
      return j({ onboarded, payoutsEnabled: acct.payouts_enabled ?? false, accountId: sp.stripe_account_id,
        chargesEnabled: acct.charges_enabled, detailsSubmitted: acct.details_submitted });
    }

    return j({ error: 'Unknown action' }, 400);
  } catch (err) {
    console.error('stripe-connect-onboard', err);
    return j({ error: String(err) }, 500);
  }
});
