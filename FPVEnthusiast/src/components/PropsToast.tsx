// src/components/PropsToast.tsx
// Lightweight animated props-award toast (no external deps needed).
// Usage:
//   import { PropsToast, usePropsToast } from '../components/PropsToast';
//   const toast = usePropsToast();
//   toast.show('+50 Props! First post bonus 🎉');
//   <PropsToast toast={toast} />

import React, { useRef, useState, useCallback } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  View,
  Platform,
} from 'react-native';

// ─── Hook ──────────────────────────────────────────────────────────────────────
export interface PropsToastHandle {
  show: (message: string) => void;
  visible: boolean;
  message: string;
  opacity: Animated.Value;
  translateY: Animated.Value;
}

export function usePropsToast(): PropsToastHandle {
  const [message, setMessage]   = useState('');
  const [visible, setVisible]   = useState(false);
  const opacity    = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((msg: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setMessage(msg);
    setVisible(true);

    // reset
    opacity.setValue(0);
    translateY.setValue(20);

    // fade + slide in
    Animated.parallel([
      Animated.timing(opacity,    { toValue: 1,  duration: 300, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0,  duration: 300, useNativeDriver: true }),
    ]).start();

    // auto-dismiss after 3 s
    timerRef.current = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity,    { toValue: 0, duration: 400, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: -10, duration: 400, useNativeDriver: true }),
      ]).start(() => setVisible(false));
    }, 3000);
  }, [opacity, translateY]);

  return { show, visible, message, opacity, translateY };
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
        { opacity: toast.opacity, transform: [{ translateY: toast.translateY }] },
      ]}
      pointerEvents="none"
    >
      <View style={styles.pill}>
        <Text style={styles.propIcon}>🏆</Text>
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
  propIcon: {
    fontSize: 18,
  },
  text: {
    color: '#ffd700',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
