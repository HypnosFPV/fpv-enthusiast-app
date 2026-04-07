import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const projectRefMatch = supabaseUrl?.match(/^https:\/\/([^.]+)\.supabase\.co/i);
const supabaseProjectRef = projectRefMatch?.[1] ?? null;
const supabaseStorageKey = supabaseProjectRef ? `sb-${supabaseProjectRef}-auth-token` : 'supabase.auth.token';

// ── Debug: prints in VS Code terminal when app loads ──────────────────────────
console.log('=== SUPABASE CONFIG CHECK ===');
console.log('URL:', supabaseUrl ?? '❌ UNDEFINED');
console.log('KEY prefix:', supabaseAnonKey ? supabaseAnonKey.substring(0, 12) + '...' : '❌ UNDEFINED');
console.log('KEY length:', supabaseAnonKey?.length ?? 0, 'chars');
console.log('Project ref:', supabaseProjectRef ?? '❌ UNDEFINED');
console.log('Storage key:', supabaseStorageKey);
console.log('==============================');

// ── Guard: crash early with a clear message if values are missing ─────────────
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    '❌ Supabase credentials missing!\n' +
    'Check your .env file has:\n' +
    '  EXPO_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co\n' +
    '  EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...\n' +
    'Then restart with: npx expo start --clear'
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


