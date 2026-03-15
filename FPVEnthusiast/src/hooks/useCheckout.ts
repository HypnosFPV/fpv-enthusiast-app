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
//
// Fix (2026-03-15): Replaced state-based readiness check with a useRef so
// confirmPayment() never sees a stale 'loading' snapshot from a React
// batched-state update.  The ref is set synchronously inside initCheckout
// right before the function returns { ok:true }, guaranteeing that
// confirmPayment() can always trust it.
// =============================================================================

import { useState, useCallback, useRef } from 'react';
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

// Synchronous ref shape — updated immediately (not via React batching)
interface ReadyRef {
  ready:   boolean;
  orderId: string | null;
}

export function useCheckout() {
  const [state, setState] = useState<CheckoutState>(INITIAL);

  // ── Synchronous readiness ref ──────────────────────────────────────────────
  // React batches setState calls, so confirmPayment() cannot rely on
  // state.status being 'ready' immediately after initCheckout() returns.
  // We keep a ref that is set synchronously before initCheckout resolves,
  // ensuring confirmPayment() always reads the correct value.
  const readyRef = useRef<ReadyRef>({ ready: false, orderId: null });

  const reset = useCallback(() => {
    readyRef.current = { ready: false, orderId: null };
    setState(INITIAL);
  }, []);

  // ── Step 1: create PaymentIntent on server, init payment sheet ────────────
  const initCheckout = useCallback(async (
    listingId: string,
    offerId?: string,
  ): Promise<{ ok: boolean; error?: string }> => {
    // Clear previous readiness so a stale ref never leaks into a new checkout
    readyRef.current = { ready: false, orderId: null };
    setState({ ...INITIAL, status: 'loading' });

    try {
      // Force a session refresh so the access_token is always fresh.
      // supabase.auth.refreshSession() rotates the token even if it hasn't
      // expired yet, guaranteeing the Supabase gateway won't reject with
      // "Invalid JWT" due to a near-expiry or stale cached token.
      // Falls back to getSession() if the refresh itself fails (e.g. offline).
      let session: import('@supabase/supabase-js').Session | null = null;
      try {
        const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
        if (refreshErr || !refreshed.session) {
          // Refresh failed — try the cached session as last resort
          const { data: cached } = await supabase.auth.getSession();
          session = cached.session;
        } else {
          session = refreshed.session;
        }
      } catch {
        const { data: cached } = await supabase.auth.getSession();
        session = cached.session;
      }
      if (!session) {
        return fail('Not signed in. Please log in and try again.');
      }

      // Use supabase.functions.invoke so the client automatically:
      //  • refreshes an expired JWT before sending
      //  • injects the correct Authorization + apikey headers
      // This eliminates the "Invalid JWT" error caused by a stale access_token.
      const { data, error: fnErr } = await supabase.functions.invoke(
        'create-payment-intent',
        { body: { listing_id: listingId, offer_id: offerId } },
      );

      // Extract the most informative error message available:
      //  • data.error  — custom message returned by the edge function
      //  • fnErr.context?.json() — raw gateway response body (e.g. "Invalid JWT")
      //  • fnErr.message — generic SDK error
      if (fnErr || !data?.clientSecret) {
        let msg = data?.error;
        if (!msg && fnErr) {
          try {
            const body = await (fnErr as any).context?.json?.();
            msg = body?.message ?? body?.error ?? fnErr.message;
          } catch {
            msg = fnErr.message;
          }
        }
        console.error('[Checkout] edge function error:', msg, 'fnErr:', fnErr);
        return fail(msg ?? 'Server error — please try again');
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
        returnURL:                 'fpventhusiast://stripe-redirect',
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

      // ── CRITICAL: update the ref BEFORE setState and BEFORE returning ──────
      // setState is batched by React and will not be visible to confirmPayment()
      // if it is called synchronously after initCheckout() returns.
      // The ref is updated synchronously here, so confirmPayment() can always
      // trust readyRef.current.ready === true when it runs.
      readyRef.current = { ready: true, orderId };
      setState({ status: 'ready', orderId, error: null, amountCents });
      return { ok: true };

    } catch (err) {
      return fail(String(err));
    }

    function fail(msg: string) {
      readyRef.current = { ready: false, orderId: null };
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
    // Use the ref instead of state.status — the ref is updated synchronously
    // inside initCheckout(), so it is always correct even if React has not yet
    // flushed the corresponding setState({ status: 'ready' }) call.
    if (!readyRef.current.ready) {
      console.warn('[Checkout] confirmPayment called before sheet was ready');
      return { ok: false, orderId: null, error: 'Payment sheet not initialised' };
    }

    const currentOrderId = readyRef.current.orderId;

    setState(s => ({ ...s, status: 'processing' }));

    const { error } = await presentPaymentSheet();

    if (error) {
      // User cancelled — code is 'Canceled'
      if (error.code === 'Canceled') {
        setState(s => ({ ...s, status: 'ready' }));
        return { ok: false, orderId: null, error: 'cancelled' };
      }
      readyRef.current = { ready: false, orderId: null };
      setState(s => ({ ...s, status: 'error', error: error.message }));
      return { ok: false, orderId: null, error: error.message };
    }

    readyRef.current = { ready: false, orderId: null };
    setState(s => ({ ...s, status: 'success' }));
    return { ok: true, orderId: currentOrderId };
  // confirmPayment no longer depends on state — it reads from the ref.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { initCheckout, confirmPayment, checkoutState: state, resetCheckout: reset };
}
