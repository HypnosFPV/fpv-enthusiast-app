// src/hooks/usePushNotifications.ts
// =============================================================================
// Push notification registration with startup permission request.
//
// Flow:
//   App launch (no auth gate)
//     └─ status === 'undetermined'?
//           iOS     → show pre-prompt modal explaining why → native dialog on "Allow"
//           Android → request native dialog directly (no pre-prompt needed)
//     └─ status === 'granted' → get & save token (if user signed in)
//     └─ status === 'denied'  → nothing (user explicitly declined)
//
//   After sign-in → save/refresh token to Supabase user_push_tokens
//   App foreground → refresh token in case it changed
// =============================================================================

import React, { useEffect, useRef, useCallback, useState } from 'react';
import {
  Platform, AppState, Modal, View, Text,
  TouchableOpacity, StyleSheet,
} from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../services/supabase';
import { useAuth } from '../context/AuthContext';

// ── Foreground notification behaviour ────────────────────────────────────────
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge:  true,
  }),
});

// ─── Hook ────────────────────────────────────────────────────────────────────
export function usePushNotifications() {
  const { user }     = useAuth();
  const router       = useRouter();
  const notifRef     = useRef<ReturnType<typeof Notifications.addNotificationReceivedListener>>();
  const responseRef  = useRef<ReturnType<typeof Notifications.addNotificationResponseReceivedListener>>();
  const askedRef     = useRef(false);   // guard: only show pre-prompt once per session

  // Pre-prompt modal visibility (iOS only)
  const [showPrePrompt, setShowPrePrompt] = useState(false);

  // ── Android channels ─────────────────────────────────────────────────────
  const ensureChannels = useCallback(async () => {
    if (Platform.OS !== 'android') return;
    await Notifications.setNotificationChannelAsync('challenges', {
      name:             'Challenge Notifications',
      importance:       Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor:       '#FF6B35',
    });
    await Notifications.setNotificationChannelAsync('default', {
      name:       'Default',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }, []);

  // ── Get & save Expo push token ────────────────────────────────────────────
  const saveToken = useCallback(async () => {
    if (!user?.id) return;
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;

    // Skip token registration if projectId is missing or still a placeholder
    // (happens in Expo Go before eas init is run)
    const isValidUuid = (id?: string) =>
      !!id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

    if (!isValidUuid(projectId)) {
      console.warn('[usePushNotifications] skipping token — projectId not set. Run: npx eas init');
      return;
    }

    try {
      const tokenData = await Notifications.getExpoPushTokenAsync(
        { projectId: projectId! }
      );
      await supabase
        .from('user_push_tokens')
        .upsert(
          {
            user_id:    user.id,
            token:      tokenData.data,
            platform:   Platform.OS,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'token' }
        );
    } catch (err) {
      console.warn('[usePushNotifications] token error:', err);
    }
  }, [user?.id]);

  // ── Native permission request (called after pre-prompt "Allow" or directly on Android) ──
  const requestNativePermission = useCallback(async () => {
    setShowPrePrompt(false);
    const { status } = await Notifications.requestPermissionsAsync();
    if (status === 'granted') {
      await ensureChannels();
      await saveToken();
    }
  }, [ensureChannels, saveToken]);

  // ── Startup permission check (runs once, no auth gate) ───────────────────
  const checkPermissionOnStartup = useCallback(async () => {
    if (!Device.isDevice)       return;  // simulators don't support push
    if (Platform.OS === 'web')  return;
    if (askedRef.current)       return;  // only once per session
    askedRef.current = true;

    const { status } = await Notifications.getPermissionsAsync();

    if (status === 'granted') {
      // Already granted — ensure channels exist and save token if signed in
      await ensureChannels();
      await saveToken();
      return;
    }

    if (status !== 'undetermined') return;  // 'denied' — respect user choice

    // Permission not yet asked
    if (Platform.OS === 'ios') {
      // iOS: show our custom explanation first (increases opt-in rate)
      // Small delay so the app's main UI is fully visible before the modal appears
      setTimeout(() => setShowPrePrompt(true), 1500);
    } else {
      // Android: request directly after a short delay
      setTimeout(async () => {
        await ensureChannels();
        await requestNativePermission();
      }, 1500);
    }
  }, [ensureChannels, saveToken, requestNativePermission]);

  // ── On mount: check permissions immediately ───────────────────────────────
  useEffect(() => {
    checkPermissionOnStartup();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);   // run once at mount — intentionally empty dep array

  // ── When user signs in: save/refresh token ────────────────────────────────
  useEffect(() => {
    if (!user) return;
    Notifications.getPermissionsAsync().then(({ status }) => {
      if (status === 'granted') saveToken();
    });
  }, [user, saveToken]);

  // ── Re-check when app returns to foreground ───────────────────────────────
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (state) => {
      if (state !== 'active') return;
      const { status } = await Notifications.getPermissionsAsync();
      if (status === 'granted') {
        await ensureChannels();
        await saveToken();
      }
    });
    return () => sub.remove();
  }, [ensureChannels, saveToken]);

  // ── Notification tap handler ──────────────────────────────────────────────
  const handleResponse = useCallback(
    (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content.data as
        Record<string, string> | undefined;
      if (!data) return;
      switch (data.navigate) {
        case 'challenges':    router.push('/(tabs)/challenges');    break;
        case 'notifications': router.push('/(tabs)/notifications'); break;
        default: break;
      }
    },
    [router]
  );

  // ── Foreground + tap listeners ────────────────────────────────────────────
  useEffect(() => {
    notifRef.current    = Notifications.addNotificationReceivedListener(() => {});
    responseRef.current = Notifications.addNotificationResponseReceivedListener(handleResponse);
    return () => {
      notifRef.current?.remove();
      responseRef.current?.remove();
    };
  }, [handleResponse]);

  // Cold-start tap (app was closed, user tapped notification)
  useEffect(() => {
    Notifications.getLastNotificationResponseAsync().then((r) => {
      if (r) handleResponse(r);
    });
  }, [handleResponse]);

  // ── Pre-prompt modal (iOS only) ───────────────────────────────────────────
  const PermissionModal = (
    <Modal
      visible={showPrePrompt}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => setShowPrePrompt(false)}
    >
      <View style={s.overlay}>
        <View style={s.card}>
          {/* Icon */}
          <View style={s.iconWrap}>
            <Ionicons name="notifications" size={36} color="#ff6b35" />
          </View>

          {/* Heading */}
          <Text style={s.heading}>Stay in the Loop</Text>

          {/* Body */}
          <Text style={s.body}>
            FPV Challenges will notify you when:
          </Text>
          <View style={s.bullets}>
            <Text style={s.bullet}>🏆  Voting opens on Saturday</Text>
            <Text style={s.bullet}>⏰  2 hours left to cast your vote</Text>
            <Text style={s.bullet}>🥇  Winners are announced Monday</Text>
          </View>
          <Text style={s.sub}>
            You can change this any time in Profile → Settings.
          </Text>

          {/* Allow button */}
          <TouchableOpacity
            style={s.allowBtn}
            onPress={requestNativePermission}
            activeOpacity={0.85}
          >
            <Ionicons name="notifications-outline" size={18} color="#fff" />
            <Text style={s.allowBtnText}>Allow Notifications</Text>
          </TouchableOpacity>

          {/* Not now */}
          <TouchableOpacity
            style={s.skipBtn}
            onPress={() => setShowPrePrompt(false)}
            activeOpacity={0.7}
          >
            <Text style={s.skipBtnText}>Not Now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  return { PermissionModal };
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  card: {
    backgroundColor: '#13131f',
    borderRadius: 20,
    padding: 28,
    width: '100%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2a2a4a',
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#ff6b3522',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 18,
    borderWidth: 1,
    borderColor: '#ff6b3544',
  },
  heading: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 10,
    textAlign: 'center',
  },
  body: {
    color: '#aaaacc',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 12,
  },
  bullets: {
    alignSelf: 'stretch',
    gap: 8,
    marginBottom: 14,
    paddingHorizontal: 8,
  },
  bullet: {
    color: '#ccccdd',
    fontSize: 14,
    lineHeight: 20,
  },
  sub: {
    color: '#666680',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 17,
  },
  allowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ff6b35',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 32,
    width: '100%',
    justifyContent: 'center',
    marginBottom: 10,
  },
  allowBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  skipBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  skipBtnText: {
    color: '#555570',
    fontSize: 14,
  },
});
