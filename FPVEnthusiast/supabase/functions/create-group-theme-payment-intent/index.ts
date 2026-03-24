import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14?target=deno';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CUSTOM_THEME_PRICE_CENTS = 299;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) {
      return json({ error: `Auth failed: ${authErr?.message ?? 'invalid token'}` }, 401);
    }

    const body = await req.json();
    const groupId = body?.group_id as string | undefined;
    const themeName = String(body?.theme_name ?? '').trim();
    const accentColor = String(body?.accent_color ?? '').trim();
    const surfaceColor = String(body?.surface_color ?? '').trim();
    const surfaceSecondaryColor = String(body?.surface_secondary_color ?? '').trim();
    const borderColor = String(body?.border_color ?? '').trim();
    const chipBackgroundColor = String(body?.chip_background_color ?? '').trim();
    const chipTextColor = String(body?.chip_text_color ?? '').trim();
    const textColor = String(body?.text_color ?? '#ffffff').trim();
    const mutedTextColor = String(body?.muted_text_color ?? '#b8bfd9').trim();
    const bannerImageUrl = body?.banner_image_url ? String(body.banner_image_url) : null;
    const cardImageUrl = body?.card_image_url ? String(body.card_image_url) : null;
    const overlayStrength = Number(body?.overlay_strength ?? 72);

    if (!groupId) return json({ error: 'group_id required' }, 400);
    if (themeName.length < 3 || themeName.length > 60) return json({ error: 'Theme name must be 3-60 characters.' }, 400);
    if (!accentColor || !surfaceColor || !surfaceSecondaryColor || !borderColor || !chipBackgroundColor || !chipTextColor) {
      return json({ error: 'Missing theme colors.' }, 400);
    }

    const { data: membership } = await supabase
      .from('social_group_members')
      .select('group_id')
      .eq('group_id', groupId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!membership?.group_id) {
      return json({ error: 'You must be a group member to create a custom theme for this group.' }, 403);
    }

    const { data: groupData } = await supabase
      .from('social_groups')
      .select('name')
      .eq('id', groupId)
      .maybeSingle();

    const { data: customTheme, error: insertErr } = await supabase
      .from('social_group_custom_themes')
      .insert({
        group_id: groupId,
        owner_user_id: user.id,
        name: themeName,
        accent_color: accentColor,
        surface_color: surfaceColor,
        surface_secondary_color: surfaceSecondaryColor,
        border_color: borderColor,
        chip_background_color: chipBackgroundColor,
        chip_text_color: chipTextColor,
        text_color: textColor,
        muted_text_color: mutedTextColor,
        banner_image_url: bannerImageUrl,
        card_image_url: cardImageUrl,
        overlay_strength: Math.max(20, Math.min(92, Math.round(overlayStrength))),
        status: 'pending_payment',
        purchase_amount_cents: CUSTOM_THEME_PRICE_CENTS,
      })
      .select('id')
      .single();

    if (insertErr || !customTheme?.id) {
      return json({ error: insertErr?.message ?? 'Could not create theme draft.' }, 500);
    }

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
      apiVersion: '2024-04-10',
      httpClient: Stripe.createFetchHttpClient(),
    });

    const paymentIntent = await stripe.paymentIntents.create({
      amount: CUSTOM_THEME_PRICE_CENTS,
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: {
        kind: 'group_custom_theme',
        custom_theme_id: customTheme.id,
        group_id: groupId,
        owner_user_id: user.id,
      },
      description: `FPV Enthusiast custom group theme — ${groupData?.name ?? 'Community'} / ${themeName}`,
    });

    const { error: updateErr } = await supabase
      .from('social_group_custom_themes')
      .update({
        stripe_payment_intent: paymentIntent.id,
        purchase_amount_cents: CUSTOM_THEME_PRICE_CENTS,
      })
      .eq('id', customTheme.id);

    if (updateErr) {
      return json({ error: updateErr.message ?? 'Could not save payment intent.' }, 500);
    }

    return json({
      clientSecret: paymentIntent.client_secret,
      customThemeId: customTheme.id,
      publishableKey: Deno.env.get('STRIPE_PUBLISHABLE_KEY'),
      amountCents: CUSTOM_THEME_PRICE_CENTS,
    });
  } catch (err) {
    console.error('create-group-theme-payment-intent error', err);
    return json({ error: String(err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
