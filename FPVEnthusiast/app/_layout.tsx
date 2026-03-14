// app/_layout.tsx
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider } from '../src/context/AuthContext';
import { NotificationsProvider } from '../src/context/NotificationsContext';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <NotificationsProvider>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index"    options={{ headerShown: false }} />
            <Stack.Screen name="(tabs)"   options={{ headerShown: false }} />
            <Stack.Screen name="login"    options={{ headerShown: false }} />
            <Stack.Screen name="signup"   options={{ headerShown: false }} />
            <Stack.Screen name="user/[id]" options={{ headerShown: false }} />
            <Stack.Screen name="post/[id]" options={{ headerShown: false }} />
            <Stack.Screen name="listing/[id]" options={{ headerShown: false }} />
          </Stack>
        </NotificationsProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
