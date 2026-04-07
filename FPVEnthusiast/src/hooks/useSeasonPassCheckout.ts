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

interface CheckoutFunctionResponse {
  clientSecret?: string;
  paymentIntentClientSecret?: string;
  ephemeralKeySecret?: string;
  customerId?: string;
  purchaseId?: string;
  publishableKey?: string;
  amountCents?: number;
  season?: { id?: string; name?: string };
  error?: string;
  message?: string;
  code?: string;
  requestId?: string;
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
      code: typeof (error as Error & { code?: string | null }).code === 'string'
        ? ((error as Error & { code?: string | null }).code ?? null)
        : null,
      requestId: typeof (error as Error & { requestId?: string | null }).requestId === 'string'
        ? ((error as Error & { requestId?: string | null }).requestId ?? null)
        : null,
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

async function getFreshSessionForCheckout(): Promise<Session> {
  let session: Session | null = null;

  try {
    const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
    if (!refreshErr && refreshed.session?.access_token) {
      session = refreshed.session;
    }
  } catch {
    // Fall back to cached session below.
  }

  if (!session) {
    const { data: cached, error: sessionErr } = await supabase.auth.getSession();
    if (sessionErr) {
      throw new Error(`Could not read auth session: ${sessionErr.message}`);
    }
    session = cached.session;
  }

  if (!session?.access_token) {
    throw new Error('You are not signed in. Please sign in again.');
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
      // Mirror the marketplace checkout flow:
      // 1) force a token refresh first
      // 2) call the function through supabase.functions.invoke()
      // The final piece is verify_jwt=false in supabase/config.toml for this function,
      // so Supabase's gateway does not reject a stale mobile token before our function runs.
      await getFreshSessionForCheckout();

      const { data, error: fnErr } = await supabase.functions.invoke(
        'create-season-pass-payment-intent',
        { body: seasonId ? { seasonId } : {} },
      );

      const response = (data ?? {}) as CheckoutFunctionResponse;
      const clientSecret = response.paymentIntentClientSecret ?? response.clientSecret ?? null;
      const customerId = response.customerId ?? null;
      const ephemeralKeySecret = response.ephemeralKeySecret ?? null;
      const resolvedSeasonId = response.season?.id ?? seasonId ?? null;

      if (fnErr || !clientSecret || !response.purchaseId || !resolvedSeasonId) {
        if (fnErr) {
          throw fnErr;
        }

        const error = new Error(response.error ?? response.message ?? 'Could not start season pass checkout.') as Error & {
          code?: string | null;
          requestId?: string | null;
        };
        error.code = response.code ?? null;
        error.requestId = response.requestId ?? null;
        throw error;
      }

      if (response.publishableKey) {
        await initStripe({
          publishableKey: response.publishableKey,
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
        primaryButtonLabel: `Unlock ${response.season?.name ?? 'Season Pass'}`,
      });

      if (initErr) {
        throw new Error(initErr.message);
      }

      readyRef.current = {
        ready: true,
        purchaseId: response.purchaseId,
        seasonId: resolvedSeasonId,
      };
      setState({
        status: 'ready',
        purchaseId: response.purchaseId,
        amountCents: response.amountCents ?? null,
        seasonId: resolvedSeasonId,
        error: null,
        errorCode: null,
        requestId: response.requestId ?? null,
      });

      return {
        ok: true as const,
        purchaseId: response.purchaseId,
        amountCents: response.amountCents as number | undefined,
        seasonId: resolvedSeasonId,
        requestId: response.requestId ?? null,
      };
    } catch (err: unknown) {
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
    } catch (err: unknown) {
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
