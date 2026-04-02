import { useCallback, useRef, useState } from 'react';
import * as Linking from 'expo-linking';
import { initStripe, initPaymentSheet, presentPaymentSheet } from '@stripe/stripe-react-native';
import { supabase } from '../services/supabase';
import { getProfileBadge } from '../constants/profileBadges';

export interface ProfileBadgeCheckoutInput {
  badgeId: string;
}

export type ProfileBadgeCheckoutStatus = 'idle' | 'loading' | 'ready' | 'processing' | 'success' | 'error';

export interface ProfileBadgeCheckoutState {
  status: ProfileBadgeCheckoutStatus;
  badgeId: string | null;
  amountCents: number | null;
  error: string | null;
}

const INITIAL: ProfileBadgeCheckoutState = {
  status: 'idle',
  badgeId: null,
  amountCents: null,
  error: null,
};

interface ReadyRef {
  ready: boolean;
  badgeId: string | null;
}

export function useProfileBadgeCheckout() {
  const [state, setState] = useState<ProfileBadgeCheckoutState>(INITIAL);
  const readyRef = useRef<ReadyRef>({ ready: false, badgeId: null });

  const resetCheckout = useCallback(() => {
    readyRef.current = { ready: false, badgeId: null };
    setState(INITIAL);
  }, []);

  const initCheckout = useCallback(async ({ badgeId }: ProfileBadgeCheckoutInput) => {
    readyRef.current = { ready: false, badgeId: null };
    setState({ ...INITIAL, status: 'loading' });

    try {
      const { data, error } = await supabase.functions.invoke('create-profile-badge-payment-intent', {
        body: { badgeId },
      });

      if (error || !data?.paymentIntentClientSecret || !data?.ephemeralKeySecret || !data?.customerId) {
        const message = data?.error ?? error?.message ?? 'Could not start badge checkout.';
        setState({ status: 'error', badgeId: null, amountCents: null, error: message });
        return { ok: false as const, error: message };
      }

      if (data.publishableKey) {
        await initStripe({
          publishableKey: data.publishableKey,
          merchantIdentifier: 'merchant.com.fpventhusiast',
        });
      }

      const badge = getProfileBadge(badgeId);
      const { error: initErr } = await initPaymentSheet({
        merchantDisplayName: 'FPV Enthusiast Badges',
        paymentIntentClientSecret: data.paymentIntentClientSecret,
        customerId: data.customerId,
        customerEphemeralKeySecret: data.ephemeralKeySecret,
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
            primary: badge?.accentColor ?? '#7c5cff',
            background: '#09090f',
            componentBackground: '#12121d',
            primaryText: '#ffffff',
            secondaryText: '#9aa0bc',
            componentText: '#ffffff',
            placeholderText: '#6b7280',
            error: '#ff6b6b',
          },
        },
        primaryButtonLabel: `Unlock ${badge?.name ?? 'Badge'}`,
      });

      if (initErr) {
        setState({ status: 'error', badgeId: null, amountCents: null, error: initErr.message });
        return { ok: false as const, error: initErr.message };
      }

      readyRef.current = { ready: true, badgeId };
      setState({
        status: 'ready',
        badgeId,
        amountCents: data.badge?.priceCents ?? badge?.priceCents ?? null,
        error: null,
      });
      return {
        ok: true as const,
        badgeId,
        amountCents: data.badge?.priceCents ?? badge?.priceCents,
      };
    } catch (err: any) {
      const message = String(err?.message ?? err ?? 'Unknown checkout error');
      setState({ status: 'error', badgeId: null, amountCents: null, error: message });
      return { ok: false as const, error: message };
    }
  }, []);

  const confirmCheckout = useCallback(async () => {
    if (!readyRef.current.ready) {
      return { ok: false as const, badgeId: null, error: 'Payment sheet not initialised' };
    }

    const currentBadgeId = readyRef.current.badgeId;
    setState((prev) => ({ ...prev, status: 'processing', error: null }));

    const { error } = await presentPaymentSheet();

    if (error) {
      if (error.code === 'Canceled') {
        setState((prev) => ({ ...prev, status: 'ready' }));
        return { ok: false as const, badgeId: null, error: 'cancelled' };
      }
      readyRef.current = { ready: false, badgeId: null };
      setState((prev) => ({ ...prev, status: 'error', error: error.message }));
      return { ok: false as const, badgeId: null, error: error.message };
    }

    readyRef.current = { ready: false, badgeId: null };
    setState((prev) => ({ ...prev, status: 'success' }));
    return { ok: true as const, badgeId: currentBadgeId };
  }, []);

  return {
    initCheckout,
    confirmCheckout,
    checkoutState: state,
    resetCheckout,
  };
}
