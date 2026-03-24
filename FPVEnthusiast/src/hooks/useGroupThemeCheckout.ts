import { useCallback, useRef, useState } from 'react';
import * as Linking from 'expo-linking';
import { initStripe, initPaymentSheet, presentPaymentSheet } from '@stripe/stripe-react-native';
import { supabase } from '../services/supabase';

export interface CustomGroupThemeDraftInput {
  groupId: string;
  name: string;
  accentColor: string;
  surfaceColor: string;
  surfaceSecondaryColor: string;
  borderColor: string;
  chipBackgroundColor: string;
  chipTextColor: string;
  textColor: string;
  mutedTextColor: string;
  bannerImageUrl?: string | null;
  cardImageUrl?: string | null;
  overlayStrength?: number;
}

export type GroupThemeCheckoutStatus = 'idle' | 'loading' | 'ready' | 'processing' | 'success' | 'error';

export interface GroupThemeCheckoutState {
  status: GroupThemeCheckoutStatus;
  customThemeId: string | null;
  amountCents: number | null;
  error: string | null;
}

const INITIAL: GroupThemeCheckoutState = {
  status: 'idle',
  customThemeId: null,
  amountCents: null,
  error: null,
};

interface ReadyRef {
  ready: boolean;
  customThemeId: string | null;
}

export function useGroupThemeCheckout() {
  const [state, setState] = useState<GroupThemeCheckoutState>(INITIAL);
  const readyRef = useRef<ReadyRef>({ ready: false, customThemeId: null });

  const resetCheckout = useCallback(() => {
    readyRef.current = { ready: false, customThemeId: null };
    setState(INITIAL);
  }, []);

  const initCheckout = useCallback(async (draft: CustomGroupThemeDraftInput) => {
    readyRef.current = { ready: false, customThemeId: null };
    setState({ ...INITIAL, status: 'loading' });

    try {
      const { data, error } = await supabase.functions.invoke('create-group-theme-payment-intent', {
        body: {
          group_id: draft.groupId,
          theme_name: draft.name,
          accent_color: draft.accentColor,
          surface_color: draft.surfaceColor,
          surface_secondary_color: draft.surfaceSecondaryColor,
          border_color: draft.borderColor,
          chip_background_color: draft.chipBackgroundColor,
          chip_text_color: draft.chipTextColor,
          text_color: draft.textColor,
          muted_text_color: draft.mutedTextColor,
          banner_image_url: draft.bannerImageUrl ?? null,
          card_image_url: draft.cardImageUrl ?? null,
          overlay_strength: draft.overlayStrength ?? 72,
        },
      });

      if (error || !data?.clientSecret || !data?.customThemeId) {
        const message = data?.error ?? error?.message ?? 'Could not start custom theme checkout.';
        readyRef.current = { ready: false, customThemeId: null };
        setState({ status: 'error', customThemeId: null, amountCents: null, error: message });
        return { ok: false as const, error: message };
      }

      if (data.publishableKey) {
        await initStripe({
          publishableKey: data.publishableKey,
          merchantIdentifier: 'merchant.com.fpventhusiast',
        });
      }

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
            primary: draft.accentColor,
            background: '#0a0a0a',
            componentBackground: draft.surfaceSecondaryColor,
            primaryText: '#ffffff',
            secondaryText: '#a5a5a5',
            componentText: '#ffffff',
            placeholderText: '#6b7280',
            error: '#ff6b6b',
          },
        },
      });

      if (initErr) {
        readyRef.current = { ready: false, customThemeId: null };
        setState({ status: 'error', customThemeId: null, amountCents: null, error: initErr.message });
        return { ok: false as const, error: initErr.message };
      }

      readyRef.current = { ready: true, customThemeId: data.customThemeId };
      setState({
        status: 'ready',
        customThemeId: data.customThemeId,
        amountCents: data.amountCents ?? null,
        error: null,
      });
      return { ok: true as const, customThemeId: data.customThemeId as string, amountCents: data.amountCents as number | undefined };
    } catch (err: any) {
      const message = String(err?.message ?? err ?? 'Unknown checkout error');
      readyRef.current = { ready: false, customThemeId: null };
      setState({ status: 'error', customThemeId: null, amountCents: null, error: message });
      return { ok: false as const, error: message };
    }
  }, []);

  const confirmCheckout = useCallback(async () => {
    if (!readyRef.current.ready) {
      return { ok: false as const, customThemeId: null, error: 'Payment sheet not initialised' };
    }

    const currentCustomThemeId = readyRef.current.customThemeId;
    setState((prev) => ({ ...prev, status: 'processing', error: null }));

    const { error } = await presentPaymentSheet();

    if (error) {
      if (error.code === 'Canceled') {
        setState((prev) => ({ ...prev, status: 'ready' }));
        return { ok: false as const, customThemeId: null, error: 'cancelled' };
      }
      readyRef.current = { ready: false, customThemeId: null };
      setState((prev) => ({ ...prev, status: 'error', error: error.message }));
      return { ok: false as const, customThemeId: null, error: error.message };
    }

    readyRef.current = { ready: false, customThemeId: null };
    setState((prev) => ({ ...prev, status: 'success' }));
    return { ok: true as const, customThemeId: currentCustomThemeId };
  }, []);

  return {
    initCheckout,
    confirmCheckout,
    checkoutState: state,
    resetCheckout,
  };
}
