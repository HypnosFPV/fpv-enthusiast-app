import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { GroupCardAnimationVariantId } from '../constants/groupThemes';

const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

interface Props {
  width: number;
  height: number;
  accentColor: string;
  borderColor: string;
  active: boolean;
  variant: GroupCardAnimationVariantId;
  cornerRadius?: number;
}

export default function GroupCardAnimationBorder({
  width,
  height,
  accentColor,
  borderColor,
  active,
  variant,
  cornerRadius = 14,
}: Props) {
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const sweepAnim = useRef(new Animated.Value(0)).current;
  const orbitAnim = useRef(new Animated.Value(0)).current;
  const sideAnim = useRef(new Animated.Value(0)).current;
  const pulseLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const sweepLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const orbitLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const sideLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  const isBasic = variant === 'basic';
  const isStandard = variant === 'standard';
  const isPremium = variant === 'premium';

  const pulseRange = isPremium ? [0.55, 1] : isStandard ? [0.45, 0.98] : [0.35, 0.92];
  const glowRange = isPremium ? [0.28, 0.62] : isStandard ? [0.22, 0.5] : [0.16, 0.4];
  const thicknessRange = isPremium ? [2.4, 4.2] : isStandard ? [2.2, 3.8] : [2, 3.4];
  const pulseDuration = isPremium ? 850 : isStandard ? 980 : 1100;
  const topSweepDuration = isPremium ? 1800 : isStandard ? 2200 : 2600;

  useEffect(() => {
    pulseLoopRef.current?.stop?.();
    sweepLoopRef.current?.stop?.();
    orbitLoopRef.current?.stop?.();
    sideLoopRef.current?.stop?.();
    pulseAnim.stopAnimation();
    sweepAnim.stopAnimation();
    orbitAnim.stopAnimation();
    sideAnim.stopAnimation();

    if (!active || width < 40 || height < 40 || variant === 'none') {
      pulseAnim.setValue(0);
      sweepAnim.setValue(0);
      orbitAnim.setValue(0);
      sideAnim.setValue(0);
      return;
    }

    pulseLoopRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: pulseDuration, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        Animated.timing(pulseAnim, { toValue: 0, duration: pulseDuration, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      ]),
    );
    sweepLoopRef.current = Animated.loop(
      Animated.timing(sweepAnim, { toValue: 1, duration: topSweepDuration, easing: Easing.linear, useNativeDriver: true }),
    );

    if (!isBasic) {
      orbitLoopRef.current = Animated.loop(
        Animated.timing(orbitAnim, { toValue: 1, duration: isPremium ? 2600 : 3200, easing: Easing.linear, useNativeDriver: true }),
      );
      orbitLoopRef.current.start();
    }

    if (isPremium) {
      sideLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(sideAnim, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(sideAnim, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]),
      );
      sideLoopRef.current.start();
    }

    pulseLoopRef.current.start();
    sweepLoopRef.current.start();

    return () => {
      pulseLoopRef.current?.stop?.();
      sweepLoopRef.current?.stop?.();
      orbitLoopRef.current?.stop?.();
      sideLoopRef.current?.stop?.();
      pulseAnim.stopAnimation();
      sweepAnim.stopAnimation();
      orbitAnim.stopAnimation();
      sideAnim.stopAnimation();
    };
  }, [active, height, isBasic, isPremium, orbitAnim, pulseAnim, pulseDuration, sideAnim, sweepAnim, topSweepDuration, variant, width]);

  const edgeOpacity = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: pulseRange });
  const glowOpacity = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: glowRange });
  const edgeThickness = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: thicknessRange });
  const sweepOpacity = sweepAnim.interpolate({ inputRange: [0, 0.1, 0.5, 0.9, 1], outputRange: [0, 0.95, 0.35, 0.95, 0] });
  const sweepTranslateX = sweepAnim.interpolate({ inputRange: [0, 1], outputRange: [-width * 0.3, width * 0.88] });
  const bottomSweepTranslateX = orbitAnim.interpolate({ inputRange: [0, 1], outputRange: [width * 0.82, -width * 0.36] });
  const leftSweepTranslateY = orbitAnim.interpolate({ inputRange: [0, 1], outputRange: [height * 0.82, -height * 0.22] });
  const rightSweepTranslateY = orbitAnim.interpolate({ inputRange: [0, 1], outputRange: [-height * 0.22, height * 0.82] });
  const sideGlowOpacity = sideAnim.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.62] });

  const edgeInset = Math.max(10, Math.round(cornerRadius * 0.72));
  const sideStart = Math.max(18, Math.round(cornerRadius * 3));
  const sideHeight = Math.max(64, height - sideStart * 2);

  const dynamicStyles = useMemo(() => ({
    wrap: {
      borderRadius: cornerRadius,
    },
    glow: {
      borderRadius: cornerRadius,
    },
    topEdge: {
      borderTopLeftRadius: cornerRadius,
      borderTopRightRadius: cornerRadius,
    },
    bottomEdge: {
      borderBottomLeftRadius: cornerRadius,
      borderBottomRightRadius: cornerRadius,
    },
    leftEdge: {
      borderTopLeftRadius: cornerRadius,
      borderBottomLeftRadius: cornerRadius,
    },
    rightEdge: {
      borderTopRightRadius: cornerRadius,
      borderBottomRightRadius: cornerRadius,
    },
    bottomSweep: {
      top: undefined,
      bottom: edgeInset,
    },
    leftSweep: {
      top: sideStart,
      left: 0,
      width: 10,
      height: sideHeight,
    },
    rightSweep: {
      top: sideStart,
      left: undefined,
      right: 0,
      width: 10,
      height: sideHeight,
    },
    premiumTopGlow: {
      top: edgeInset + 12,
      left: edgeInset + 4,
      right: edgeInset + 4,
    },
    premiumBottomGlow: {
      bottom: edgeInset + 12,
      left: edgeInset + 4,
      right: edgeInset + 4,
    },
  }), [cornerRadius, edgeInset, sideHeight, sideStart]);

  return (
    <Animated.View pointerEvents="none" style={[styles.groupAnimWrap, dynamicStyles.wrap, { opacity: edgeOpacity }]}>
      <Animated.View style={[styles.groupAnimGlow, dynamicStyles.glow, { opacity: glowOpacity, shadowColor: accentColor, borderColor }]} />
      <AnimatedLinearGradient colors={[accentColor, borderColor, accentColor]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.groupAnimTopEdge, dynamicStyles.topEdge, { height: edgeThickness }]} />
      <AnimatedLinearGradient colors={[accentColor, borderColor, accentColor]} start={{ x: 1, y: 0 }} end={{ x: 0, y: 0 }} style={[styles.groupAnimBottomEdge, dynamicStyles.bottomEdge, { height: edgeThickness }]} />
      <AnimatedLinearGradient colors={[accentColor, borderColor, accentColor]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={[styles.groupAnimLeftEdge, dynamicStyles.leftEdge, { width: edgeThickness }]} />
      <AnimatedLinearGradient colors={[accentColor, borderColor, accentColor]} start={{ x: 0, y: 1 }} end={{ x: 0, y: 0 }} style={[styles.groupAnimRightEdge, dynamicStyles.rightEdge, { width: edgeThickness }]} />
      <Animated.View style={[styles.groupAnimSweep, { transform: [{ translateX: sweepTranslateX }], opacity: sweepOpacity }]}>
        <LinearGradient colors={['transparent', accentColor, '#ffffff', accentColor, 'transparent']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.groupAnimSweepFill} />
      </Animated.View>
      {!isBasic ? (
        <>
          <Animated.View style={[styles.groupAnimSweep, dynamicStyles.bottomSweep, { transform: [{ translateX: bottomSweepTranslateX }], opacity: sweepOpacity }]}>
            <LinearGradient colors={['transparent', accentColor, '#ffffff', accentColor, 'transparent']} start={{ x: 1, y: 0.5 }} end={{ x: 0, y: 0.5 }} style={styles.groupAnimSweepFill} />
          </Animated.View>
          <Animated.View style={[styles.groupAnimSweep, dynamicStyles.leftSweep, { transform: [{ translateY: leftSweepTranslateY }], opacity: sweepOpacity }]}>
            <LinearGradient colors={['transparent', accentColor, '#ffffff', accentColor, 'transparent']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={styles.groupAnimSweepFill} />
          </Animated.View>
          <Animated.View style={[styles.groupAnimSweep, dynamicStyles.rightSweep, { transform: [{ translateY: rightSweepTranslateY }], opacity: sweepOpacity }]}>
            <LinearGradient colors={['transparent', accentColor, '#ffffff', accentColor, 'transparent']} start={{ x: 0.5, y: 1 }} end={{ x: 0.5, y: 0 }} style={styles.groupAnimSweepFill} />
          </Animated.View>
        </>
      ) : null}
      {isPremium ? (
        <>
          <Animated.View style={[styles.groupAnimPremiumLine, dynamicStyles.premiumTopGlow, { backgroundColor: '#ffffff', opacity: sideGlowOpacity }]} />
          <Animated.View style={[styles.groupAnimPremiumLine, dynamicStyles.premiumBottomGlow, { backgroundColor: accentColor, opacity: sideGlowOpacity }]} />
        </>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  groupAnimWrap: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
  },
  groupAnimGlow: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
    shadowOpacity: 0.26,
    shadowRadius: 16,
  },
  groupAnimTopEdge: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  groupAnimBottomEdge: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  groupAnimLeftEdge: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
  },
  groupAnimRightEdge: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
  },
  groupAnimSweep: {
    position: 'absolute',
    top: 10,
    left: 0,
    width: 84,
    height: 10,
    overflow: 'hidden',
  },
  groupAnimSweepFill: {
    flex: 1,
  },
  groupAnimPremiumLine: {
    position: 'absolute',
    height: 1,
  },
});
