// src/hooks/useStripeConnect.ts
// Manages Stripe Connect Express seller onboarding:
//  • startOnboarding()  – calls Edge Function → opens browser → returns
//  • checkStatus()      – polls Edge Function to confirm charges_enabled
//  • sellerProfile      – cached seller_profiles row (stripe_onboarded, avg_rating, etc.)

import { useState, useCallback, useEffect } from 'react';
import { Linking, Alert } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '../services/supabase';

export interface SellerProfile {
  stripe_account_id:  string | null;
  stripe_onboarded:   boolean;
  avg_rating:         number | null;
  total_sales:        number;
  verification_tier:  number;
}

interface UseStripeConnectResult {
  sellerProfile:    SellerProfile | null;
  loading:          boolean;
  onboarding:       boolean;
  checking:         boolean;
  startOnboarding:  () => Promise<void>;
  checkStatus:      () => Promise<void>;
  refreshProfile:   () => Promise<void>;
}

// EDGE_URL removed — now using supabase.functions.invoke() which handles URL + auth

export function useStripeConnect(userId?: string | null): UseStripeConnectResult {
  const [sellerProfile, setSellerProfile] = useState<SellerProfile | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [onboarding, setOnboarding] = useState(false);
  const [checking,   setChecking]   = useState(false);

  const refreshProfile = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const { data } = await supabase
        .from('seller_profiles')
        .select('stripe_account_id, stripe_onboarded, avg_rating, total_sales, verification_tier')
        .eq('user_id', userId)
        .maybeSingle();
      setSellerProfile(data ?? {
        stripe_account_id: null, stripe_onboarded: false,
        avg_rating: null, total_sales: 0, verification_tier: 0,
      });
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { refreshProfile(); }, [refreshProfile]);

  // ── callEdge: use supabase.functions.invoke() instead of raw fetch() ────────
  // Raw fetch() + getSession() was causing "Edge Function error" because:
  //  1. The Supabase gateway verifies the JWT before the function runs.
  //  2. A near-expired token from getSession() (not refreshed) gets rejected
  //     with { "message": "Invalid JWT" } — note "message" not "error".
  //  3. The hook read json.error (null) → fell back to 'Edge Function error'.
  // supabase.functions.invoke() auto-refreshes the JWT and injects the correct
  // Authorization + apikey headers, exactly like useCheckout.ts does.
  const callEdge = useCallback(async (body: object) => {
    const { data, error: fnErr } = await supabase.functions.invoke(
      'stripe-connect-onboard',
      { body },
    );
    if (fnErr) {
      // Try to surface a meaningful message from the gateway or function body
      let msg: string = fnErr.message ?? 'Edge Function error';
      try {
        const bodyJson = await (fnErr as any).context?.json?.();
        msg = bodyJson?.error ?? bodyJson?.message ?? msg;
      } catch { /* ignore parse errors */ }
      throw new Error(msg);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }, []);

  const startOnboarding = useCallback(async () => {
    setOnboarding(true);
    try {
      const result = await callEdge({
        action:     'create_account',
        return_url: 'fpventhusiast://stripe-connect-return',
      });

      if (result.alreadyOnboarded) {
        Alert.alert('Already Connected', 'Your Stripe account is fully set up — you can receive payouts.');
        await refreshProfile();
        return;
      }

      if (!result.onboardingUrl) throw new Error('No onboarding URL returned');

      // Open Stripe-hosted onboarding in an in-app browser
      const browserResult = await WebBrowser.openAuthSessionAsync(
        result.onboardingUrl,
        'fpventhusiast://stripe-connect-return',
      );

      if (browserResult.type === 'success') {
        const url = browserResult.url;
        const status = url.includes('status=complete') ? 'complete'
                     : url.includes('status=refresh')  ? 'refresh'
                     : 'unknown';

        if (status === 'complete') {
          // Give Stripe a moment to process
          await new Promise(r => setTimeout(r, 1500));
          await checkStatus();
        } else if (status === 'refresh') {
          Alert.alert(
            'Session Expired',
            'Your onboarding session expired. Tap "Set Up Payouts" to try again.',
          );
        }
      }
    } catch (e: any) {
      Alert.alert('Onboarding Error', e.message ?? 'Something went wrong. Please try again.');
    } finally {
      setOnboarding(false);
    }
  }, [callEdge, refreshProfile]);

  const checkStatus = useCallback(async () => {
    setChecking(true);
    try {
      const result = await callEdge({ action: 'check_status' });
      if (result.onboarded) {
        Alert.alert('🎉 Payouts Enabled!', "Your Stripe account is verified. You'll receive payouts automatically after buyers confirm delivery.");
      } else {
        Alert.alert(
          'Not Complete',
          'Stripe still needs more information. Tap "Set Up Payouts" to finish.',
        );
      }
      await refreshProfile();
    } catch (e: any) {
      Alert.alert('Check Failed', e.message ?? 'Could not verify status.');
    } finally {
      setChecking(false);
    }
  }, [callEdge, refreshProfile]);

  return { sellerProfile, loading, onboarding, checking, startOnboarding, checkStatus, refreshProfile };
}
