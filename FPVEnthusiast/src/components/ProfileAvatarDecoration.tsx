import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Image, StyleSheet, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { ResolvedProfileAppearance } from '../constants/profileAppearance';

interface Props {
  appearance: ResolvedProfileAppearance;
  avatarUrl?: string | null;
  size: number;
  editable?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  delayLongPress?: number;
  fallbackIconSize?: number;
}

export default function ProfileAvatarDecoration({
  appearance,
  avatarUrl,
  size,
  editable = false,
  onPress,
  onLongPress,
  delayLongPress = 120,
  fallbackIconSize = 34,
}: Props) {
  const pulse = useRef(new Animated.Value(0)).current;
  const orbit = useRef(new Animated.Value(0)).current;
  const storm = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let pulseLoop: Animated.CompositeAnimation | null = null;
    let orbitLoop: Animated.CompositeAnimation | null = null;
    let stormLoop: Animated.CompositeAnimation | null = null;

    if (appearance.effect.effectStyle === 'pulse') {
      pulseLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1, duration: 1300, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 0, duration: 1300, useNativeDriver: true }),
        ]),
      );
      pulseLoop.start();
    }

    if (appearance.effect.effectStyle === 'orbit') {
      orbitLoop = Animated.loop(
        Animated.timing(orbit, { toValue: 1, duration: 4200, useNativeDriver: true }),
      );
      orbitLoop.start();
    }

    if (appearance.effect.effectStyle === 'storm') {
      stormLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(storm, { toValue: 1, duration: 900, useNativeDriver: true }),
          Animated.timing(storm, { toValue: 0, duration: 900, useNativeDriver: true }),
        ]),
      );
      stormLoop.start();
    }

    return () => {
      pulseLoop?.stop?.();
      orbitLoop?.stop?.();
      stormLoop?.stop?.();
      pulse.stopAnimation();
      orbit.stopAnimation();
      storm.stopAnimation();
      pulse.setValue(0);
      orbit.setValue(0);
      storm.setValue(0);
    };
  }, [appearance.effect.effectStyle, orbit, pulse, storm]);

  const wrapSize = size + 24;
  const frameColors = useMemo(() => [appearance.frame.primaryColor, appearance.frame.secondaryColor], [appearance.frame.primaryColor, appearance.frame.secondaryColor]);
  const orbitSpin = orbit.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const stormScale = storm.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.06] });
  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.18] });
  const pulseOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.42, 0] });
  const stormOpacity = storm.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.42] });

  return (
    <View style={[styles.wrap, { width: wrapSize, height: wrapSize }]}> 
      {appearance.effect.effectStyle === 'pulse' ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.effectRing,
            {
              width: size + 14,
              height: size + 14,
              borderRadius: (size + 14) / 2,
              borderColor: appearance.effect.accentColor,
              opacity: pulseOpacity,
              transform: [{ scale: pulseScale }],
            },
          ]}
        />
      ) : null}

      {appearance.effect.effectStyle === 'storm' ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.stormRing,
            {
              width: size + 20,
              height: size + 20,
              borderRadius: (size + 20) / 2,
              borderColor: appearance.effect.accentColor,
              opacity: stormOpacity,
              transform: [{ scale: stormScale }],
              shadowColor: appearance.effect.accentColor,
            },
          ]}
        />
      ) : null}

      {appearance.effect.effectStyle === 'orbit' ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.orbitWrap,
            {
              width: size + 22,
              height: size + 22,
              borderRadius: (size + 22) / 2,
              transform: [{ rotate: orbitSpin }],
            },
          ]}
        >
          <View style={[styles.orbitDot, { top: -2, left: '50%', marginLeft: -4, backgroundColor: appearance.effect.accentColor }]} />
          <View style={[styles.orbitDotSmall, { bottom: 6, right: 2, backgroundColor: appearance.effect.accentColor }]} />
        </Animated.View>
      ) : null}

      <LinearGradient
        colors={frameColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          styles.frame,
          {
            width: size + 10,
            height: size + 10,
            borderRadius: (size + 10) / 2,
            shadowColor: appearance.frame.primaryColor,
          },
        ]}
      >
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={onPress}
          onLongPress={onLongPress}
          delayLongPress={delayLongPress}
          style={[
            styles.avatarTouch,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: '#171726',
            },
          ]}
        >
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={{ width: size, height: size, borderRadius: size / 2 }} />
          ) : (
            <View style={[styles.fallback, { width: size, height: size, borderRadius: size / 2 }]}>
              <Ionicons name="person" size={fallbackIconSize} color="#666" />
            </View>
          )}
          {editable ? (
            <View style={[styles.cameraBadge, { backgroundColor: appearance.theme.accentColor }]}>
              <Ionicons name="camera" size={13} color="#fff" />
            </View>
          ) : null}
        </TouchableOpacity>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  frame: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 5,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  avatarTouch: {
    overflow: 'hidden',
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1e1e3a',
  },
  cameraBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    borderRadius: 10,
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  effectRing: {
    position: 'absolute',
    borderWidth: 2,
  },
  stormRing: {
    position: 'absolute',
    borderWidth: 2,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 14,
    elevation: 8,
  },
  orbitWrap: {
    position: 'absolute',
  },
  orbitDot: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 6,
    elevation: 5,
  },
  orbitDotSmall: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.65,
    shadowRadius: 4,
    elevation: 4,
  },
});
