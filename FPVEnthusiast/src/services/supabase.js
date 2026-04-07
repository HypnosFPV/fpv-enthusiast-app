import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const EXPECTED_SUPABASE_PROJECT_REF = 'iyjtdzcobdbzjonskpgi';
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const projectRefMatch = supabaseUrl?.match(/^https:\/\/([^.]+)\.supabase\.co/i);
export const supabaseProjectRef = projectRefMatch?.[1] ?? null;
const supabaseStorageKey = supabaseProjectRef ? `sb-${supabaseProjectRef}-auth-token` : 'supabase.auth.token';

function decodeJwtPayload(token) {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const json = globalThis.atob ? globalThis.atob(padded) : Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

const anonKeyPayload = supabaseAnonKey ? decodeJwtPayload(supabaseAnonKey) : null;
const anonKeyProjectRef = anonKeyPayload?.ref ?? null;
const anonKeyIssuer = anonKeyPayload?.iss ?? null;

// ── Debug: prints in VS Code terminal when app loads ──────────────────────────
console.log('=== SUPABASE CONFIG CHECK ===');
console.log('URL:', supabaseUrl ?? '❌ UNDEFINED');
console.log('KEY prefix:', supabaseAnonKey ? supabaseAnonKey.substring(0, 12) + '...' : '❌ UNDEFINED');
console.log('KEY length:', supabaseAnonKey?.length ?? 0, 'chars');
console.log('Project ref:', supabaseProjectRef ?? '❌ UNDEFINED');
console.log('Anon key ref:', anonKeyProjectRef ?? '❌ UNDEFINED');
console.log('Anon key issuer:', anonKeyIssuer ?? '❌ UNDEFINED');
console.log('Storage key:', supabaseStorageKey);
console.log('==============================');

// ── Guard: crash early with a clear message if values are missing ─────────────
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    '❌ Supabase credentials missing!\n' +
    'Check your local Expo env has:\n' +
    `  EXPO_PUBLIC_SUPABASE_URL=https://${EXPECTED_SUPABASE_PROJECT_REF}.supabase.co\n` +
    '  EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...\n' +
    'Then restart with: npx expo start --clear'
  );
}

if (supabaseProjectRef !== EXPECTED_SUPABASE_PROJECT_REF) {
  throw new Error(
    '❌ Supabase project mismatch!\n' +
    `Expected project ref: ${EXPECTED_SUPABASE_PROJECT_REF}\n` +
    `Actual project ref: ${supabaseProjectRef ?? 'undefined'}\n` +
    'Update EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY to the correct project, then restart with: npx expo start --clear'
  );
}

if (anonKeyProjectRef && anonKeyProjectRef !== EXPECTED_SUPABASE_PROJECT_REF) {
  throw new Error(
    '❌ Supabase anon key mismatch!\n' +
    `Expected project ref: ${EXPECTED_SUPABASE_PROJECT_REF}\n` +
    `Anon key project ref: ${anonKeyProjectRef}\n` +
    'Your EXPO_PUBLIC_SUPABASE_ANON_KEY is for a different Supabase project. Replace it with the anon key from project iyjtdzcobdbzjonskpgi, then restart with: npx expo start --clear'
  );
}

// ── Create and export the Supabase client ─────────────────────────────────────
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    storageKey: supabaseStorageKey,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});


