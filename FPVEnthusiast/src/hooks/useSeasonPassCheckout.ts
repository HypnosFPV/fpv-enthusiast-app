import { useCallback, useRef, useState } from 'react';
import * as Linking from 'expo-linking';
import {
  initStripe,
  initPaymentSheet,
  presentPaymentSheet,
} from '@stripe/stripe-react-native';
import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
  type Session,
} from '@supabase/supabase-js';
import { supabase } from '../services/supabase';

export interface SeasonPassCheckoutInput {
  seasonId?: string | null;
}

export type SeasonPassCheckoutStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'processing'
  | 'success'
  | 'error';

export interface SeasonPassCheckoutState {
  status: SeasonPassCheckoutStatus;
  purchaseId: string | null;
  amountCents: number | null;
  seasonId: string | null;
  error: string | null;
  errorCode?: string | null;
  requestId?: string | null;
}

const INITIAL: SeasonPassCheckoutState = {
  status: 'idle',
  purchaseId: null,
  amountCents: null,
  seasonId: null,
  error: null,
  errorCode: null,
  requestId: null,
};

interface ReadyRef {
  ready: boolean;
  purchaseId: string | null;
  seasonId: string | null;
}

interface ParsedCheckoutError {
  message: string;
  code: string | null;
  requestId: string | null;
}

async function parseCheckoutError(error: unknown): Promise<ParsedCheckoutError> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json();
      const message =
        typeof body?.error === 'string'
          ? body.error
          : typeof body?.message === 'string'
            ? body.message
            : error.message;

      return {
        message: message || 'Edge Function returned a non-2xx status code.',
        code: typeof body?.code === 'string' ? body.code : null,
        requestId: typeof body?.requestId === 'string' ? body.requestId : null,
      };
    } catch {
      try {
        const rawText = await error.context.text();
        return {
          message: rawText || error.message || 'Edge Function returned a non-2xx status code.',
          code: null,
          requestId: null,
        };
      } catch {
        return {
          message: error.message || 'Edge Function returned a non-2xx status code.',
          code: null,
          requestId: null,
        };
      }
    }
  }

  if (error instanceof FunctionsRelayError) {
    return {
      message: `Functions relay error: ${error.message}`,
      code: 'FUNCTIONS_RELAY_ERROR',
      requestId: null,
    };
  }

  if (error instanceof FunctionsFetchError) {
    return {
      message: `Functions fetch error: ${error.message}`,
      code: 'FUNCTIONS_FETCH_ERROR',
      requestId: null,
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      code: null,
      requestId: null,
    };
  }

  return {
    message: 'Unknown checkout error.',
    code: null,
    requestId: null,
  };
}

function buildVisibleErrorMessage(parsed: ParsedCheckoutError) {
  const parts = [parsed.message];

  if (parsed.code) {
    parts.push(`Code: ${parsed.code}`);
  }

  if (parsed.requestId) {
    parts.push(`Request ID: ${parsed.requestId}`);
  }

  return parts.join('\n');
}

async function getValidSessionForFunctions(): Promise<Session> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

  if (sessionError) {
    throw new Error(`Could not read auth session: ${sessionError.message}`);
  }

  let session = sessionData.session;

  if (!session?.access_token) {
    throw new Error('You are not signed in. Please sign in again.');
  }

  const expiresSoon = !!session.expires_at && session.expires_at * 1000 <= Date.now() + 60_000;

  if (expiresSoon) {
    const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();

    if (refreshError || !refreshData.session?.access_token) {
      throw new Error('Your session expired. Please sign in again.');
    }

    session = refreshData.session;
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();

    if (refreshError || !refreshData.session?.access_token) {
      throw new Error('Your session is invalid. Please sign out and sign back in.');
    }

    session = refreshData.session;
  }

  if (!session?.access_token) {
    throw new Error('No valid auth token is available. Please sign in again.');
  }

  return session;
}

export function useSeasonPassCheckout() {
  const [state, setState] = useState<SeasonPassCheckoutState>(INITIAL);
  const readyRef = useRef<ReadyRef>({
    ready: false,
    purchaseId: null,
    seasonId: null,
  });

  const resetCheckout = useCallback(() => {
    readyRef.current = { ready: false, purchaseId: null, seasonId: null };
    setState(INITIAL);
  }, []);

  const initCheckout = useCallback(async ({ seasonId }: SeasonPassCheckoutInput = {}) => {
    readyRef.current = { ready: false, purchaseId: null, seasonId: null };
    setState({ ...INITIAL, status: 'loading', seasonId: seasonId ?? null });

    try {
      const session = await getValidSessionForFunctions();

      const { data, error } = await supabase.functions.invoke(
        'create-season-pass-payment-intent',
        {
          body: seasonId ? { seasonId } : {},
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }
      );

      if (error) {
        throw error;
      }

      const clientSecret = data?.paymentIntentClientSecret ?? data?.clientSecret ?? null;
      const customerId = data?.customerId ?? null;
      const ephemeralKeySecret = data?.ephemeralKeySecret ?? null;
      const resolvedSeasonId = data?.season?.id ?? seasonId ?? null;

      if (!clientSecret || !data?.purchaseId || !resolvedSeasonId) {
        throw new Error(data?.error ?? 'Could not start season pass checkout.');
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
        customerEphemeralKeySecret:
          customerId && ephemeralKeySecret ? ephemeralKeySecret : undefined,
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
        throw new Error(initErr.message);
      }

      readyRef.current = {
        ready: true,
        purchaseId: data.purchaseId as string,
        seasonId: resolvedSeasonId,
      };
      setState({
        status: 'ready',
        purchaseId: data.purchaseId as string,
        amountCents: data.amountCents ?? null,
        seasonId: resolvedSeasonId,
        error: null,
        errorCode: null,
        requestId: data?.requestId ?? null,
      });

      return {
        ok: true as const,
        purchaseId: data.purchaseId as string,
        amountCents: data.amountCents as number | undefined,
        seasonId: resolvedSeasonId,
        requestId: data?.requestId ?? null,
      };
    } catch (err: any) {
      const parsed = await parseCheckoutError(err);
      const message = buildVisibleErrorMessage(parsed);

      console.error('[SeasonPassCheckout:initCheckout]', {
        message: parsed.message,
        code: parsed.code,
        requestId: parsed.requestId,
        raw: err,
      });

      setState({
        status: 'error',
        purchaseId: null,
        amountCents: null,
        seasonId: seasonId ?? null,
        error: message,
        errorCode: parsed.code,
        requestId: parsed.requestId,
      });
      return {
        ok: false as const,
        error: message,
        code: parsed.code,
        requestId: parsed.requestId,
      };
    }
  }, []);

  const confirmCheckout = useCallback(async () => {
    if (!readyRef.current.ready) {
      return {
        ok: false as const,
        purchaseId: null,
        seasonId: null,
        error: 'Payment sheet not initialised',
      };
    }

    const currentPurchaseId = readyRef.current.purchaseId;
    const currentSeasonId = readyRef.current.seasonId;
    setState((prev) => ({ ...prev, status: 'processing', error: null, errorCode: null }));

    try {
      const { error } = await presentPaymentSheet();

      if (error) {
        if (error.code === 'Canceled') {
          setState((prev) => ({ ...prev, status: 'ready' }));
          return {
            ok: false as const,
            purchaseId: null,
            seasonId: currentSeasonId,
            error: 'cancelled',
          };
        }

        throw new Error(error.message);
      }

      readyRef.current = { ready: false, purchaseId: null, seasonId: null };
      setState((prev) => ({ ...prev, status: 'success' }));
      return {
        ok: true as const,
        purchaseId: currentPurchaseId,
        seasonId: currentSeasonId,
      };
    } catch (err: any) {
      const parsed = await parseCheckoutError(err);
      const message = buildVisibleErrorMessage(parsed);

      console.error('[SeasonPassCheckout:confirmCheckout]', {
        message: parsed.message,
        code: parsed.code,
        requestId: parsed.requestId,
        raw: err,
      });

      readyRef.current = { ready: false, purchaseId: null, seasonId: null };
      setState((prev) => ({
        ...prev,
        status: 'error',
        error: message,
        errorCode: parsed.code,
        requestId: parsed.requestId,
      }));
      return {
        ok: false as const,
        purchaseId: null,
        seasonId: currentSeasonId,
        error: message,
        code: parsed.code,
        requestId: parsed.requestId,
      };
    }
  }, []);

  return {
    initCheckout,
    confirmCheckout,
    checkoutState: state,
    resetCheckout,
  };
}
