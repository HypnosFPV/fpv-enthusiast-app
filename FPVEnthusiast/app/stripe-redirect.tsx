// app/stripe-redirect.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Deep-link landing page for Stripe redirect-based payment methods (Amazon Pay,
// etc.).  When Stripe opens the payment provider in Safari / an in-app browser,
// it uses the returnURL to navigate back to the app.  Expo Router picks up that
// URL and renders this screen.
//
// The screen has no visible UI — it simply navigates back immediately so the
// user lands back on the listing screen where they started checkout.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';

export default function StripeRedirectScreen() {
  const router = useRouter();

  useEffect(() => {
    // Stripe has redirected back — go back to wherever the user came from.
    // Use a tiny delay so the navigator is fully mounted before we pop.
    const t = setTimeout(() => {
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/(tabs)/marketplace');
      }
    }, 100);
    return () => clearTimeout(t);
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator size="large" color="#ff6b35" />
    </View>
  );
}
