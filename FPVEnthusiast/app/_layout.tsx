// app/_layout.tsx
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider } from '../src/context/AuthContext';
import { NotificationsProvider } from '../src/context/NotificationsContext';
import { usePushNotifications } from '../src/hooks/usePushNotifications';

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
      </Stack>

      {/* Push notification pre-prompt modal (iOS only, shown once on first launch) */}
      {PermissionModal}
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <NotificationsProvider>
          <AppContent />
        </NotificationsProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
