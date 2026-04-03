import { useCallback, useRef, useState } from 'react';
import * as Linking from 'expo-linking';
import { initStripe, initPaymentSheet, presentPaymentSheet } from '@stripe/stripe-react-native';
import { supabase } from '../services/supabase';

export interface SeasonPassCheckoutInput {
  seasonId?: string | null;
}

export type SeasonPassCheckoutStatus = 'idle' | 'loading' | 'ready' | 'processing' | 'success' | 'error';

export interface SeasonPassCheckoutState {
  status: SeasonPassCheckoutStatus;
  purchaseId: string | null;
  amountCents: number | null;
  seasonId: string | null;
  error: string | null;
}

const INITIAL: SeasonPassCheckoutState = {
  status: 'idle',
  purchaseId: null,
  amountCents: null,
  seasonId: null,
  error: null,
};

interface ReadyRef {
  ready: boolean;
  purchaseId: string | null;
  seasonId: string | null;
}

export function useSeasonPassCheckout() {
  const [state, setState] = useState<SeasonPassCheckoutState>(INITIAL);
  const readyRef = useRef<ReadyRef>({ ready: false, purchaseId: null, seasonId: null });

  const resetCheckout = useCallback(() => {
    readyRef.current = { ready: false, purchaseId: null, seasonId: null };
    setState(INITIAL);
  }, []);

  const initCheckout = useCallback(async ({ seasonId }: SeasonPassCheckoutInput = {}) => {
    readyRef.current = { ready: false, purchaseId: null, seasonId: null };
    setState({ ...INITIAL, status: 'loading', seasonId: seasonId ?? null });

    try {
      const { data, error } = await supabase.functions.invoke('create-season-pass-payment-intent', {
        body: seasonId ? { seasonId } : {},
      });

      const clientSecret = data?.paymentIntentClientSecret ?? data?.clientSecret ?? null;
      const customerId = data?.customerId ?? null;
      const ephemeralKeySecret = data?.ephemeralKeySecret ?? null;
      const resolvedSeasonId = data?.season?.id ?? seasonId ?? null;

      if (error || !clientSecret || !data?.purchaseId || !resolvedSeasonId) {
        const message = data?.error ?? error?.message ?? 'Could not start season pass checkout.';
        setState({ status: 'error', purchaseId: null, amountCents: null, seasonId: resolvedSeasonId, error: message });
        return { ok: false as const, error: message };
      }

      if (data.publishableKey) {
        await initStripe({
          publishableKey: data.publishableKey,
          merchantIdentifier: 'merchant.com.fpventhusiast',
        });
      }

      const { error: initErr } = await initPaymentSheet({
        merchantDisplayName: 'FPV Enthusiast Season Pass',
        paymentIntentClientSecret: clientSecret,
        customerId: customerId ?? undefined,
        customerEphemeralKeySecret: customerId && ephemeralKeySecret ? ephemeralKeySecret : undefined,
        returnURL: Linking.createURL('stripe-redirect'),
        billingDetailsCollectionConfiguration: {
          name: 'never',
          phone: 'never',
          email: 'never',
          address: 'never',
        },
        style: 'alwaysDark',
        appearance: {
          colors: {
            primary: '#8b63ff',
            background: '#09090f',
            componentBackground: '#12121d',
            primaryText: '#ffffff',
            secondaryText: '#9aa0bc',
            componentText: '#ffffff',
            placeholderText: '#6b7280',
            error: '#ff6b6b',
          },
        },
        primaryButtonLabel: `Unlock ${data?.season?.name ?? 'Season Pass'}`,
      });

      if (initErr) {
        setState({ status: 'error', purchaseId: null, amountCents: null, seasonId: resolvedSeasonId, error: initErr.message });
        return { ok: false as const, error: initErr.message };
      }

      readyRef.current = { ready: true, purchaseId: data.purchaseId as string, seasonId: resolvedSeasonId };
      setState({
        status: 'ready',
        purchaseId: data.purchaseId as string,
        amountCents: data.amountCents ?? null,
        seasonId: resolvedSeasonId,
        error: null,
      });

      return {
        ok: true as const,
        purchaseId: data.purchaseId as string,
        amountCents: data.amountCents as number | undefined,
        seasonId: resolvedSeasonId,
      };
    } catch (err: any) {
      const message = String(err?.message ?? err ?? 'Unknown checkout error');
      setState({ status: 'error', purchaseId: null, amountCents: null, seasonId: seasonId ?? null, error: message });
      return { ok: false as const, error: message };
    }
  }, []);

  const confirmCheckout = useCallback(async () => {
    if (!readyRef.current.ready) {
      return { ok: false as const, purchaseId: null, seasonId: null, error: 'Payment sheet not initialised' };
    }

    const currentPurchaseId = readyRef.current.purchaseId;
    const currentSeasonId = readyRef.current.seasonId;
    setState((prev) => ({ ...prev, status: 'processing', error: null }));

    const { error } = await presentPaymentSheet();

    if (error) {
      if (error.code === 'Canceled') {
        setState((prev) => ({ ...prev, status: 'ready' }));
        return { ok: false as const, purchaseId: null, seasonId: currentSeasonId, error: 'cancelled' };
      }

      readyRef.current = { ready: false, purchaseId: null, seasonId: null };
      setState((prev) => ({ ...prev, status: 'error', error: error.message }));
      return { ok: false as const, purchaseId: null, seasonId: currentSeasonId, error: error.message };
    }

    readyRef.current = { ready: false, purchaseId: null, seasonId: null };
    setState((prev) => ({ ...prev, status: 'success' }));
    return { ok: true as const, purchaseId: currentPurchaseId, seasonId: currentSeasonId };
  }, []);

  return {
    initCheckout,
    confirmCheckout,
    checkoutState: state,
    resetCheckout,
  };
}
