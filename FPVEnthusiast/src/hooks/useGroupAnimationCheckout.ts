import { useCallback, useRef, useState } from 'react';
import * as Linking from 'expo-linking';
import { initStripe, initPaymentSheet, presentPaymentSheet } from '@stripe/stripe-react-native';
import { supabase } from '../services/supabase';
import { GroupCardAnimationVariantId, getGroupCardAnimationVariant } from '../constants/groupThemes';

export interface GroupAnimationCheckoutInput {
  groupId: string;
  variantId: GroupCardAnimationVariantId;
}

export type GroupAnimationCheckoutStatus = 'idle' | 'loading' | 'ready' | 'processing' | 'success' | 'error';

export interface GroupAnimationCheckoutState {
  status: GroupAnimationCheckoutStatus;
  purchaseId: string | null;
  amountCents: number | null;
  error: string | null;
}

const INITIAL: GroupAnimationCheckoutState = {
  status: 'idle',
  purchaseId: null,
  amountCents: null,
  error: null,
};

interface ReadyRef {
  ready: boolean;
  purchaseId: string | null;
}

export function useGroupAnimationCheckout() {
  const [state, setState] = useState<GroupAnimationCheckoutState>(INITIAL);
  const readyRef = useRef<ReadyRef>({ ready: false, purchaseId: null });

  const resetCheckout = useCallback(() => {
    readyRef.current = { ready: false, purchaseId: null };
    setState(INITIAL);
  }, []);

  const initCheckout = useCallback(async ({ groupId, variantId }: GroupAnimationCheckoutInput) => {
    readyRef.current = { ready: false, purchaseId: null };
    setState({ ...INITIAL, status: 'loading' });

    try {
      const { data, error } = await supabase.functions.invoke('create-group-animation-payment-intent', {
        body: {
          group_id: groupId,
          variant_id: variantId,
        },
      });

      if (error || !data?.clientSecret || !data?.purchaseId) {
        const message = data?.error ?? error?.message ?? 'Could not start animation checkout.';
        readyRef.current = { ready: false, purchaseId: null };
        setState({ status: 'error', purchaseId: null, amountCents: null, error: message });
        return { ok: false as const, error: message };
      }

      if (data.publishableKey) {
        await initStripe({
          publishableKey: data.publishableKey,
          merchantIdentifier: 'merchant.com.fpventhusiast',
        });
      }

      const variant = getGroupCardAnimationVariant(variantId);
      const { error: initErr } = await initPaymentSheet({
        paymentIntentClientSecret: data.clientSecret,
        merchantDisplayName: 'FPV Enthusiast Themes',
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
            primary: '#ff6a2f',
            background: '#0a0a0a',
            componentBackground: '#141414',
            primaryText: '#ffffff',
            secondaryText: '#a5a5a5',
            componentText: '#ffffff',
            placeholderText: '#6b7280',
            error: '#ff6b6b',
          },
        },
        primaryButtonLabel: `Unlock ${variant.name}`,
      });

      if (initErr) {
        readyRef.current = { ready: false, purchaseId: null };
        setState({ status: 'error', purchaseId: null, amountCents: null, error: initErr.message });
        return { ok: false as const, error: initErr.message };
      }

      readyRef.current = { ready: true, purchaseId: data.purchaseId };
      setState({
        status: 'ready',
        purchaseId: data.purchaseId,
        amountCents: data.amountCents ?? null,
        error: null,
      });
      return { ok: true as const, purchaseId: data.purchaseId as string, amountCents: data.amountCents as number | undefined };
    } catch (err: any) {
      const message = String(err?.message ?? err ?? 'Unknown checkout error');
      readyRef.current = { ready: false, purchaseId: null };
      setState({ status: 'error', purchaseId: null, amountCents: null, error: message });
      return { ok: false as const, error: message };
    }
  }, []);

  const confirmCheckout = useCallback(async () => {
    if (!readyRef.current.ready) {
      return { ok: false as const, purchaseId: null, error: 'Payment sheet not initialised' };
    }

    const currentPurchaseId = readyRef.current.purchaseId;
    setState((prev) => ({ ...prev, status: 'processing', error: null }));

    const { error } = await presentPaymentSheet();

    if (error) {
      if (error.code === 'Canceled') {
        setState((prev) => ({ ...prev, status: 'ready' }));
        return { ok: false as const, purchaseId: null, error: 'cancelled' };
      }
      readyRef.current = { ready: false, purchaseId: null };
      setState((prev) => ({ ...prev, status: 'error', error: error.message }));
      return { ok: false as const, purchaseId: null, error: error.message };
    }

    readyRef.current = { ready: false, purchaseId: null };
    setState((prev) => ({ ...prev, status: 'success' }));
    return { ok: true as const, purchaseId: currentPurchaseId };
  }, []);

  return {
    initCheckout,
    confirmCheckout,
    checkoutState: state,
    resetCheckout,
  };
}
