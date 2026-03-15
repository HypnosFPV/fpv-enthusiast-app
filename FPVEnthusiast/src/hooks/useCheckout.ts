// src/hooks/useCheckout.ts
// =============================================================================
// Stripe checkout hook for React Native (Expo / @stripe/stripe-react-native)
//
// Usage:
//   const { initCheckout, confirmPayment, checkoutState } = useCheckout();
//
//   // 1. Call initCheckout — fetches a PaymentIntent from the edge function
//   const { ok, error } = await initCheckout(listingId, offerId?);
//
//   // 2. Present the payment sheet — handled internally by this hook
//   //    Returns { ok, orderId } on success.
// =============================================================================

import { useState, useCallback } from 'react';
import {
  initStripe,
  initPaymentSheet,
  presentPaymentSheet,
} from '@stripe/stripe-react-native';
import { supabase } from '../services/supabase';

export type CheckoutStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'processing'
  | 'success'
  | 'error';

export interface CheckoutState {
  status:   CheckoutStatus;
  orderId:  string | null;
  error:    string | null;
  amountCents: number | null;
}

const INITIAL: CheckoutState = {
  status:      'idle',
  orderId:     null,
  error:       null,
  amountCents: null,
};

export function useCheckout() {
  const [state, setState] = useState<CheckoutState>(INITIAL);

  const reset = useCallback(() => setState(INITIAL), []);

  // ── Step 1: create PaymentIntent on server, init payment sheet ────────────
  const initCheckout = useCallback(async (
    listingId: string,
    offerId?: string,
  ): Promise<{ ok: boolean; error?: string }> => {
    setState({ ...INITIAL, status: 'loading' });

    try {
      // Use supabase.functions.invoke so the client automatically:
      //  • refreshes an expired JWT before sending
      //  • injects the correct Authorization + apikey headers
      // This eliminates the "Invalid JWT" error caused by a stale access_token.
      const { data, error: fnErr } = await supabase.functions.invoke(
        'create-payment-intent',
        { body: { listing_id: listingId, offer_id: offerId } },
      );

      if (fnErr || !data?.clientSecret) {
        const msg = data?.error ?? fnErr?.message ?? 'Server error';
        return fail(msg);
      }

      const { clientSecret, orderId, publishableKey, amountCents } = data;

      // Re-initialise Stripe with the key the SERVER returned.
      // This guarantees the publishable key and the client_secret are always
      // in the same mode (both test OR both live), regardless of what
      // EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY is set to in the local .env file.
      if (publishableKey) {
        await initStripe({ publishableKey, merchantIdentifier: 'merchant.com.fpventhusiast' });
      }

      // Init Stripe payment sheet
      const { error: initErr } = await initPaymentSheet({
        paymentIntentClientSecret: clientSecret,
        merchantDisplayName:       'FPV Enthusiast Marketplace',
        style:                     'alwaysDark',
        appearance: {
          colors: {
            primary:    '#ff6b35',
            background: '#0a0a0a',
            componentBackground: '#1a1a2e',
            primaryText: '#ffffff',
            secondaryText: '#9ca3af',
            componentText: '#ffffff',
            placeholderText: '#6b7280',
          },
        },
      });

      if (initErr) return fail(initErr.message);

      setState({ status: 'ready', orderId, error: null, amountCents });
      return { ok: true };

    } catch (err) {
      return fail(String(err));
    }

    function fail(msg: string) {
      setState(s => ({ ...s, status: 'error', error: msg }));
      return { ok: false, error: msg };
    }
  }, []);

  // ── Step 2: present the payment sheet ─────────────────────────────────────
  const confirmPayment = useCallback(async (): Promise<{
    ok: boolean;
    orderId: string | null;
    error?: string;
  }> => {
    if (state.status !== 'ready') {
      return { ok: false, orderId: null, error: 'Payment sheet not initialised' };
    }

    setState(s => ({ ...s, status: 'processing' }));

    const { error } = await presentPaymentSheet();

    if (error) {
      // User cancelled — code is 'Canceled'
      if (error.code === 'Canceled') {
        setState(s => ({ ...s, status: 'ready' }));
        return { ok: false, orderId: null, error: 'cancelled' };
      }
      setState(s => ({ ...s, status: 'error', error: error.message }));
      return { ok: false, orderId: null, error: error.message };
    }

    setState(s => ({ ...s, status: 'success' }));
    return { ok: true, orderId: state.orderId };
  }, [state.status, state.orderId]);

  return { initCheckout, confirmPayment, checkoutState: state, resetCheckout: reset };
}
