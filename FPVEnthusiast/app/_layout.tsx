// app/_layout.tsx
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StripeProvider } from '@stripe/stripe-react-native';
import { AuthProvider } from '../src/context/AuthContext';
import { NotificationsProvider } from '../src/context/NotificationsContext';
import { ChatProvider } from '../src/context/ChatContext';
import { usePushNotifications } from '../src/hooks/usePushNotifications';

const STRIPE_PK = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';
if (!STRIPE_PK) {
  console.warn('[Stripe] EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set in .env — payments will fail');
} else if (STRIPE_PK.startsWith('pk_live_')) {
  console.warn('[Stripe] .env still uses a LIVE publishable key. If Supabase secrets use test keys the modes will mismatch. Update EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY to your pk_test_... key.');
} else {
  console.log('[Stripe] Using publishable key mode:', STRIPE_PK.startsWith('pk_test_') ? 'TEST ✓' : 'unknown');
}

// Inner component so hooks run inside both providers
function AppContent() {
  const { PermissionModal } = usePushNotifications();
  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index"        options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)"       options={{ headerShown: false }} />
        <Stack.Screen name="login"        options={{ headerShown: false }} />
        <Stack.Screen name="signup"       options={{ headerShown: false }} />
        <Stack.Screen name="user/[id]"    options={{ headerShown: false }} />
        <Stack.Screen name="post/[id]"    options={{ headerShown: false }} />
        <Stack.Screen name="listing/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="settings"      options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="chat/[roomId]" options={{ headerShown: false, animation: 'slide_from_right' }} />
      </Stack>

      {/* Push notification pre-prompt modal (iOS only, shown once on first launch) */}
      {PermissionModal}
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StripeProvider
        publishableKey={STRIPE_PK}
        merchantIdentifier="merchant.com.fpventhusiast"
        urlScheme="fpventhusiast"
      >
        <AuthProvider>
          <NotificationsProvider>
            <ChatProvider>
              <AppContent />
            </ChatProvider>
          </NotificationsProvider>
        </AuthProvider>
      </StripeProvider>
    </GestureHandlerRootView>
  );
}
