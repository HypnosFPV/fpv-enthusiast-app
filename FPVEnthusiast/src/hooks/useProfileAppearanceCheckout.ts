import { useCallback, useRef, useState } from 'react';
import * as Linking from 'expo-linking';
import { initStripe, initPaymentSheet, presentPaymentSheet } from '@stripe/stripe-react-native';
import { supabase } from '../services/supabase';
import {
  type ProfileAppearanceItemType,
  getProfileAppearanceCatalogItem,
} from '../constants/profileAppearance';

export interface ProfileAppearanceCheckoutInput {
  itemType: ProfileAppearanceItemType;
  itemId: string;
}

export type ProfileAppearanceCheckoutStatus = 'idle' | 'loading' | 'ready' | 'processing' | 'success' | 'error';

export interface ProfileAppearanceCheckoutState {
  status: ProfileAppearanceCheckoutStatus;
  purchaseId: string | null;
  amountCents: number | null;
  error: string | null;
}

const INITIAL: ProfileAppearanceCheckoutState = {
  status: 'idle',
  purchaseId: null,
  amountCents: null,
  error: null,
};

interface ReadyRef {
  ready: boolean;
  purchaseId: string | null;
}

export function useProfileAppearanceCheckout() {
  const [state, setState] = useState<ProfileAppearanceCheckoutState>(INITIAL);
  const readyRef = useRef<ReadyRef>({ ready: false, purchaseId: null });

  const resetCheckout = useCallback(() => {
    readyRef.current = { ready: false, purchaseId: null };
    setState(INITIAL);
  }, []);

  const initCheckout = useCallback(async ({ itemType, itemId }: ProfileAppearanceCheckoutInput) => {
    readyRef.current = { ready: false, purchaseId: null };
    setState({ ...INITIAL, status: 'loading' });

    try {
      const { data, error } = await supabase.functions.invoke('create-profile-appearance-payment-intent', {
        body: {
          item_type: itemType,
          item_id: itemId,
        },
      });

      const clientSecret = data?.paymentIntentClientSecret ?? data?.clientSecret ?? null;
      const customerId = data?.customerId ?? null;
      const ephemeralKeySecret = data?.ephemeralKeySecret ?? null;

      if (error || !clientSecret || !data?.purchaseId) {
        const message = data?.error ?? error?.message ?? 'Could not start profile appearance checkout.';
        setState({ status: 'error', purchaseId: null, amountCents: null, error: message });
        return { ok: false as const, error: message };
      }

      if (data.publishableKey) {
        await initStripe({
          publishableKey: data.publishableKey,
          merchantIdentifier: 'merchant.com.fpventhusiast',
        });
      }

      const item = getProfileAppearanceCatalogItem(itemType, itemId);
      const { error: initErr } = await initPaymentSheet({
        merchantDisplayName: 'FPV Enthusiast Profile Studio',
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
            primary: ('accentColor' in item ? item.accentColor : ('primaryColor' in item ? item.primaryColor : item.accentColor)),
            background: '#09090f',
            componentBackground: '#12121d',
            primaryText: '#ffffff',
            secondaryText: '#9aa0bc',
            componentText: '#ffffff',
            placeholderText: '#6b7280',
            error: '#ff6b6b',
          },
        },
        primaryButtonLabel: `Unlock ${item.name}`,
      });

      if (initErr) {
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
