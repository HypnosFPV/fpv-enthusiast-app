// src/components/PropsToast.tsx
// Lightweight animated props-award toast with optional celebration mode.
// Usage:
//   import { PropsToast, usePropsToast } from '../components/PropsToast';
//   const toast = usePropsToast();
//   toast.show('+50 Props! First post bonus 🎉');
//   toast.show('+35 props bonus', { celebrate: true });
//   <PropsToast toast={toast} />

import React, { useRef, useState, useCallback } from 'react';
import {
  Animated,
  Easing,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';

export interface PropsToastShowOptions {
  celebrate?: boolean;
}

// ─── Hook ──────────────────────────────────────────────────────────────────────
export interface PropsToastHandle {
  show: (message: string, options?: PropsToastShowOptions) => void;
  visible: boolean;
  message: string;
  celebrate: boolean;
  opacity: Animated.Value;
  translateY: Animated.Value;
  scale: Animated.Value;
  sparkleOpacity: Animated.Value;
  sparkleOffset: Animated.Value;
}

export function usePropsToast(): PropsToastHandle {
  const [message, setMessage] = useState('');
  const [visible, setVisible] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;
  const scale = useRef(new Animated.Value(0.96)).current;
  const sparkleOpacity = useRef(new Animated.Value(0)).current;
  const sparkleOffset = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((msg: string, options?: PropsToastShowOptions) => {
    if (timerRef.current) clearTimeout(timerRef.current);

    const shouldCelebrate = !!options?.celebrate;
    setMessage(msg);
    setCelebrate(shouldCelebrate);
    setVisible(true);

    opacity.setValue(0);
    translateY.setValue(20);
    scale.setValue(0.96);
    sparkleOpacity.setValue(shouldCelebrate ? 1 : 0);
    sparkleOffset.setValue(0);

    if (shouldCelebrate) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    }

    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.timing(scale, {
          toValue: shouldCelebrate ? 1.06 : 1,
          duration: shouldCelebrate ? 220 : 180,
          easing: Easing.out(Easing.back(1.4)),
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1,
          duration: 180,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      ...(shouldCelebrate
        ? [
            Animated.parallel([
              Animated.timing(sparkleOpacity, {
                toValue: 1,
                duration: 120,
                useNativeDriver: true,
              }),
              Animated.timing(sparkleOffset, {
                toValue: -16,
                duration: 700,
                easing: Easing.out(Easing.quad),
                useNativeDriver: true,
              }),
            ]),
          ]
        : []),
    ]).start(() => {
      if (shouldCelebrate) {
        Animated.timing(sparkleOpacity, {
          toValue: 0,
          duration: 380,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }).start();
      }
    });

    timerRef.current = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: -10,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 0.98,
          duration: 240,
          useNativeDriver: true,
        }),
        Animated.timing(sparkleOpacity, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start(() => setVisible(false));
    }, shouldCelebrate ? 3400 : 3000);
  }, [opacity, translateY, scale, sparkleOpacity, sparkleOffset]);

  return {
    show,
    visible,
    message,
    celebrate,
    opacity,
    translateY,
    scale,
    sparkleOpacity,
    sparkleOffset,
  };
}

// ─── Component ─────────────────────────────────────────────────────────────────
interface Props {
  toast: PropsToastHandle;
}

export function PropsToast({ toast }: Props) {
  if (!toast.visible) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          opacity: toast.opacity,
          transform: [{ translateY: toast.translateY }, { scale: toast.scale }],
        },
      ]}
      pointerEvents="none"
    >
      {toast.celebrate ? (
        <>
          <Animated.Text
            style={[
              styles.sparkle,
              styles.sparkleLeft,
              {
                opacity: toast.sparkleOpacity,
                transform: [
                  { translateY: toast.sparkleOffset },
                  { translateX: toast.sparkleOffset.interpolate({ inputRange: [-16, 0], outputRange: [-8, 0] }) },
                  { rotate: '-12deg' },
                ],
              },
            ]}
          >
            ✨
          </Animated.Text>
          <Animated.Text
            style={[
              styles.sparkle,
              styles.sparkleRight,
              {
                opacity: toast.sparkleOpacity,
                transform: [
                  { translateY: toast.sparkleOffset },
                  { translateX: toast.sparkleOffset.interpolate({ inputRange: [-16, 0], outputRange: [8, 0] }) },
                  { rotate: '12deg' },
                ],
              },
            ]}
          >
            ✦
          </Animated.Text>
        </>
      ) : null}
      <View style={[styles.pill, toast.celebrate ? styles.pillCelebrate : null]}>
        <Text style={styles.propIcon}>{toast.celebrate ? '✨' : '🏆'}</Text>
        <Text style={styles.text}>{toast.message}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 40,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 9999,
    pointerEvents: 'none',
  } as any,
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    borderColor: '#ffd700',
    borderWidth: 1.5,
    borderRadius: 30,
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 8,
    shadowColor: '#ffd700',
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
  },
  pillCelebrate: {
    backgroundColor: '#182317',
    borderColor: '#8ee3b0',
    shadowColor: '#8ee3b0',
    shadowOpacity: 0.5,
  },
  propIcon: {
    fontSize: 18,
  },
  text: {
    color: '#ffd700',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  sparkle: {
    position: 'absolute',
    top: -6,
    fontSize: 18,
    color: '#8ee3b0',
    textShadowColor: 'rgba(142, 227, 176, 0.35)',
    textShadowRadius: 8,
  },
  sparkleLeft: {
    left: '24%',
  },
  sparkleRight: {
    right: '24%',
  },
});
