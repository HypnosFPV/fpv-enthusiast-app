// src/hooks/useSellerOnboarding.ts
// Handles the full Stripe Connect Express onboarding lifecycle:
//   1. createAccount()  → calls edge function, opens Stripe web flow
//   2. checkStatus()    → polls edge function after user returns
//   3. Persists result to seller_profiles via edge function

import { useState, useCallback, useEffect } from 'react';
import * as WebBrowser from 'expo-web-browser';
import * as Linking    from 'expo-linking';
import { supabase }    from '../services/supabase';

export type OnboardStatus =
  | 'idle'
  | 'loading'
  | 'opening_browser'
  | 'checking'
  | 'onboarded'
  | 'incomplete'
  | 'error';

export interface SellerProfile {
  stripe_account_id:  string | null;
  stripe_onboarded:   boolean;
  verification_tier:  number;
  avg_rating:         number | null;
  total_sales:        number;
}

export function useSellerOnboarding(userId: string | undefined) {
  const [status,        setStatus]        = useState<OnboardStatus>('idle');
  const [sellerProfile, setSellerProfile] = useState<SellerProfile | null>(null);
  const [error,         setError]         = useState<string | null>(null);

  // ── Load existing seller profile ─────────────────────────────────────────
  const fetchProfile = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from('seller_profiles')
      .select('stripe_account_id, stripe_onboarded, verification_tier, avg_rating, total_sales')
      .eq('user_id', userId)
      .maybeSingle();
    if (data) setSellerProfile(data as SellerProfile);
  }, [userId]);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  // ── Invoke the edge function ──────────────────────────────────────────────
  const callEdge = useCallback(async (body: object) => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error('Not authenticated');

    const supabaseUrl = (supabase as any).supabaseUrl as string;
    const res = await fetch(`${supabaseUrl}/functions/v1/stripe-connect-onboard`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body:    JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error ?? 'Edge function error');
    return data;
  }, []);

  // ── Step 1: Start onboarding ──────────────────────────────────────────────
  const startOnboarding = useCallback(async () => {
    try {
      setError(null);
      setStatus('loading');

      const returnUrl = Linking.createURL('stripe-connect-return');
      const result = await callEdge({ action: 'create_account', return_url: returnUrl });

      if (result.alreadyOnboarded) {
        setStatus('onboarded');
        await fetchProfile();
        return;
      }

      setStatus('opening_browser');
      const browserResult = await WebBrowser.openAuthSessionAsync(
        result.onboardingUrl,
        returnUrl,
      );

      // Whether or not the browser closed cleanly, check Stripe status
      setStatus('checking');
      await checkStatus();

    } catch (err: any) {
      setError(err.message ?? String(err));
      setStatus('error');
    }
  }, [callEdge, fetchProfile]);

  // ── Step 2: Check completion status ──────────────────────────────────────
  const checkStatus = useCallback(async () => {
    try {
      setStatus('checking');
      const result = await callEdge({ action: 'check_status' });
      if (result.onboarded) {
        setStatus('onboarded');
        await fetchProfile();
      } else {
        setStatus('incomplete');
      }
      return result;
    } catch (err: any) {
      setError(err.message ?? String(err));
      setStatus('error');
    }
  }, [callEdge, fetchProfile]);

  return {
    status,
    sellerProfile,
    error,
    startOnboarding,
    checkStatus,
    fetchProfile,
    isOnboarded: sellerProfile?.stripe_onboarded ?? false,
  };
}
