// src/hooks/usePushNotifications.ts
// =============================================================================
// Registers the device for Expo push notifications, persists the token in
// Supabase (user_push_tokens table), and wires up foreground/tap handlers.
//
// Usage: call usePushNotifications() once inside a component that is mounted
//        for the lifetime of the session (e.g. app/_layout.tsx or AuthContext).
// =============================================================================

import { useEffect, useRef, useCallback } from 'react';
import { Platform, AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { supabase } from '../services/supabase';
import { useAuth } from '../context/AuthContext';

// ── Foreground notification behaviour ─────────────────────────────────────────
// Show banner + play sound even when the app is in the foreground.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge:  true,
  }),
});

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function usePushNotifications() {
  const { user }       = useAuth();
  const router         = useRouter();
  const notifListener  = useRef<ReturnType<typeof Notifications.addNotificationReceivedListener>>();
  const responseListener = useRef<ReturnType<typeof Notifications.addNotificationResponseReceivedListener>>();

  // ── Save token to Supabase ─────────────────────────────────────────────────
  const saveToken = useCallback(async (token: string) => {
    if (!user?.id) return;
    await supabase
      .from('user_push_tokens')
      .upsert(
        {
          user_id:    user.id,
          token,
          platform:   Platform.OS,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'token' }
      );
  }, [user?.id]);

  // ── Register for push permissions & get token ─────────────────────────────
  const registerForPushNotifications = useCallback(async () => {
    // Push is not available in the simulator / web
    if (!Device.isDevice) return;
    if (Platform.OS === 'web') return;

    // Android: create a default notification channel
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('challenges', {
        name:        'Challenge Notifications',
        importance:  Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor:  '#FF6B35',
      });
      // Also ensure the default channel exists
      await Notifications.setNotificationChannelAsync('default', {
        name:       'Default',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    // Check / request permission
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('[usePushNotifications] Permission not granted');
      return;
    }

    // Get the Expo push token
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;

    try {
      const tokenData = await Notifications.getExpoPushTokenAsync(
        projectId ? { projectId } : undefined
      );
      await saveToken(tokenData.data);
    } catch (err) {
      console.warn('[usePushNotifications] Could not get push token:', err);
    }
  }, [saveToken]);

  // ── Navigate on notification tap ──────────────────────────────────────────
  const handleNotificationResponse = useCallback(
    (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content.data as Record<string, string> | undefined;
      if (!data) return;

      switch (data.navigate) {
        case 'challenges':
          router.push('/(tabs)/challenges');
          break;
        case 'notifications':
          router.push('/(tabs)/notifications');
          break;
        default:
          break;
      }
    },
    [router]
  );

  // ── Effects ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    registerForPushNotifications();
  }, [user, registerForPushNotifications]);

  // Re-register when app returns to foreground (token may have changed)
  useEffect(() => {
    if (!user) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') registerForPushNotifications();
    });
    return () => sub.remove();
  }, [user, registerForPushNotifications]);

  // Foreground notification display listener
  useEffect(() => {
    notifListener.current = Notifications.addNotificationReceivedListener((notification) => {
      // The handler set above already shows the banner.
      // Add any custom in-app toast logic here if desired.
      console.log('[usePushNotifications] Foreground notification:', notification.request.identifier);
    });

    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      handleNotificationResponse
    );

    return () => {
      notifListener.current?.remove();
      responseListener.current?.remove();
    };
  }, [handleNotificationResponse]);

  // Handle the notification that launched the app (cold-start tap)
  useEffect(() => {
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) handleNotificationResponse(response);
    });
  }, [handleNotificationResponse]);
}
