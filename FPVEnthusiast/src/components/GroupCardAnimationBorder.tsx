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

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
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
  const orbitAnim = useRef(new Animated.Value(0)).current;
  const chaseAnim = useRef(new Animated.Value(0)).current;
  const shimmerAnim = useRef(new Animated.Value(0)).current;
  const cornerAnim = useRef(new Animated.Value(0)).current;
  const pulseLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const orbitLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const chaseLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const shimmerLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const cornerLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  const isBasic = variant === 'basic';
  const isStandard = variant === 'standard';
  const isPremium = variant === 'premium';

  const edgePulseRange = isPremium ? [0.78, 1] : isStandard ? [0.58, 0.96] : [0.38, 0.84];
  const glowRange = isPremium ? [0.36, 0.82] : isStandard ? [0.22, 0.48] : [0.14, 0.3];
  const auraRange = isPremium ? [0.28, 0.52] : isStandard ? [0.12, 0.22] : [0.06, 0.12];
  const thicknessRange = isPremium ? [3.2, 5.6] : isStandard ? [2.4, 4.2] : [2, 3.2];
  const pulseDuration = isPremium ? 880 : isStandard ? 980 : 1120;
  const orbitDuration = isPremium ? 2200 : isStandard ? 2800 : 2600;

  useEffect(() => {
    pulseLoopRef.current?.stop?.();
    orbitLoopRef.current?.stop?.();
    chaseLoopRef.current?.stop?.();
    shimmerLoopRef.current?.stop?.();
    cornerLoopRef.current?.stop?.();
    pulseAnim.stopAnimation();
    orbitAnim.stopAnimation();
    chaseAnim.stopAnimation();
    shimmerAnim.stopAnimation();
    cornerAnim.stopAnimation();

    if (!active || width < 40 || height < 40 || variant === 'none') {
      pulseAnim.setValue(0);
      orbitAnim.setValue(0);
      chaseAnim.setValue(0);
      shimmerAnim.setValue(0);
      cornerAnim.setValue(0);
      return;
    }

    pulseLoopRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: pulseDuration, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        Animated.timing(pulseAnim, { toValue: 0, duration: pulseDuration, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      ]),
    );
    orbitLoopRef.current = Animated.loop(
      Animated.timing(orbitAnim, { toValue: 1, duration: orbitDuration, easing: Easing.linear, useNativeDriver: true }),
    );

    if (isPremium) {
      chaseLoopRef.current = Animated.loop(
        Animated.timing(chaseAnim, { toValue: 1, duration: 1700, easing: Easing.linear, useNativeDriver: true }),
      );
      shimmerLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.delay(120),
          Animated.timing(shimmerAnim, { toValue: 1, duration: 2100, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.timing(shimmerAnim, { toValue: 0, duration: 0, easing: Easing.linear, useNativeDriver: true }),
          Animated.delay(260),
        ]),
      );
      cornerLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(cornerAnim, { toValue: 1, duration: 760, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(cornerAnim, { toValue: 0, duration: 760, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]),
      );
      chaseLoopRef.current.start();
      shimmerLoopRef.current.start();
      cornerLoopRef.current.start();
    }

    pulseLoopRef.current.start();
    orbitLoopRef.current.start();

    return () => {
      pulseLoopRef.current?.stop?.();
      orbitLoopRef.current?.stop?.();
      chaseLoopRef.current?.stop?.();
      shimmerLoopRef.current?.stop?.();
      cornerLoopRef.current?.stop?.();
      pulseAnim.stopAnimation();
      orbitAnim.stopAnimation();
      chaseAnim.stopAnimation();
      shimmerAnim.stopAnimation();
      cornerAnim.stopAnimation();
    };
  }, [active, chaseAnim, cornerAnim, height, isPremium, orbitAnim, orbitDuration, pulseAnim, pulseDuration, shimmerAnim, variant, width]);

  const edgeOpacity = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: edgePulseRange });
  const glowOpacity = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: glowRange });
  const auraOpacity = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: auraRange });
  const edgeThickness = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: thicknessRange });
  const cornerOpacity = cornerAnim.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.95] });
  const cornerScale = cornerAnim.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1.18] });
  const sheenOpacity = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: isPremium ? [0.08, 0.2] : [0.05, 0.12] });
  const primaryCometOpacity = orbitAnim.interpolate({ inputRange: [0, 0.08, 0.5, 0.92, 1], outputRange: [0, 1, 0.58, 1, 0] });
  const secondaryCometOpacity = chaseAnim.interpolate({ inputRange: [0, 0.08, 0.5, 0.92, 1], outputRange: [0, 0.95, 0.5, 0.95, 0] });

  const horizontalSweepWidth = clamp(width * (isPremium ? 0.38 : isStandard ? 0.34 : 0.3), 94, isPremium ? 180 : 150);
  const verticalSweepHeight = clamp(height * (isPremium ? 0.34 : isStandard ? 0.3 : 0.26), 74, isPremium ? 150 : 126);
  const cometThickness = isPremium ? 14 : isStandard ? 11 : 8;
  const sideThickness = isPremium ? 12 : isStandard ? 10 : 8;
  const edgeInset = Math.max(8, Math.round(cornerRadius * 0.7));
  const sideInset = Math.max(12, Math.round(cornerRadius * 1.05));

  const topCometX = orbitAnim.interpolate({ inputRange: [0, 1], outputRange: [-horizontalSweepWidth, width] });
  const rightCometY = orbitAnim.interpolate({ inputRange: [0, 1], outputRange: [-verticalSweepHeight, height] });
  const bottomCometX = orbitAnim.interpolate({ inputRange: [0, 1], outputRange: [width, -horizontalSweepWidth] });
  const leftCometY = orbitAnim.interpolate({ inputRange: [0, 1], outputRange: [height, -verticalSweepHeight] });

  const topChaseX = chaseAnim.interpolate({ inputRange: [0, 1], outputRange: [width * 0.28, -horizontalSweepWidth] });
  const rightChaseY = chaseAnim.interpolate({ inputRange: [0, 1], outputRange: [height * 0.18, -verticalSweepHeight] });
  const bottomChaseX = chaseAnim.interpolate({ inputRange: [0, 1], outputRange: [-horizontalSweepWidth, width] });
  const leftChaseY = chaseAnim.interpolate({ inputRange: [0, 1], outputRange: [-verticalSweepHeight, height] });

  const shimmerTranslateX = shimmerAnim.interpolate({ inputRange: [0, 1], outputRange: [-width * 1.25, width * 1.2] });

  const dynamicStyles = useMemo(() => ({
    wrap: { borderRadius: cornerRadius },
    glow: { borderRadius: cornerRadius },
    aura: { borderRadius: cornerRadius + 2 },
    topEdge: { borderTopLeftRadius: cornerRadius, borderTopRightRadius: cornerRadius },
    bottomEdge: { borderBottomLeftRadius: cornerRadius, borderBottomRightRadius: cornerRadius },
    leftEdge: { borderTopLeftRadius: cornerRadius, borderBottomLeftRadius: cornerRadius },
    rightEdge: { borderTopRightRadius: cornerRadius, borderBottomRightRadius: cornerRadius },
    shimmer: {
      top: Math.max(22, height * 0.18),
      width: Math.max(width * 0.62, 180),
      height: Math.max(height * 0.42, 76),
    },
    cornerTopLeft: { top: sideInset - 3, left: sideInset - 3 },
    cornerTopRight: { top: sideInset - 3, right: sideInset - 3 },
    cornerBottomLeft: { bottom: sideInset - 3, left: sideInset - 3 },
    cornerBottomRight: { bottom: sideInset - 3, right: sideInset - 3 },
  }), [cornerRadius, height, sideInset, width]);

  return (
    <Animated.View pointerEvents="none" style={[styles.groupAnimWrap, dynamicStyles.wrap, { opacity: edgeOpacity }]}>
      <Animated.View style={[styles.groupAnimAura, dynamicStyles.aura, { opacity: auraOpacity, shadowColor: accentColor }]} />
      <Animated.View style={[styles.groupAnimGlow, dynamicStyles.glow, { opacity: glowOpacity, shadowColor: accentColor, borderColor }]} />

      <AnimatedLinearGradient colors={[accentColor, '#ffffff', borderColor, accentColor]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.groupAnimTopEdge, dynamicStyles.topEdge, { height: edgeThickness }]} />
      <AnimatedLinearGradient colors={[accentColor, '#ffffff', borderColor, accentColor]} start={{ x: 1, y: 0 }} end={{ x: 0, y: 0 }} style={[styles.groupAnimBottomEdge, dynamicStyles.bottomEdge, { height: edgeThickness }]} />
      <AnimatedLinearGradient colors={[accentColor, '#ffffff', borderColor, accentColor]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={[styles.groupAnimLeftEdge, dynamicStyles.leftEdge, { width: edgeThickness }]} />
      <AnimatedLinearGradient colors={[accentColor, '#ffffff', borderColor, accentColor]} start={{ x: 0, y: 1 }} end={{ x: 0, y: 0 }} style={[styles.groupAnimRightEdge, dynamicStyles.rightEdge, { width: edgeThickness }]} />

      <Animated.View style={[styles.horizontalComet, { top: edgeInset, width: horizontalSweepWidth, height: cometThickness, opacity: primaryCometOpacity, transform: [{ translateX: topCometX }] }]}>
        <LinearGradient colors={['transparent', accentColor, '#ffffff', accentColor, 'transparent']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.gradientFill} />
      </Animated.View>

      {!isBasic ? (
        <>
          <Animated.View style={[styles.verticalComet, { right: edgeInset, width: sideThickness, height: verticalSweepHeight, opacity: primaryCometOpacity, transform: [{ translateY: rightCometY }] }]}>
            <LinearGradient colors={['transparent', accentColor, '#ffffff', accentColor, 'transparent']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={styles.gradientFill} />
          </Animated.View>
          <Animated.View style={[styles.horizontalComet, { bottom: edgeInset, width: horizontalSweepWidth, height: cometThickness, opacity: primaryCometOpacity, transform: [{ translateX: bottomCometX }] }]}>
            <LinearGradient colors={['transparent', accentColor, '#ffffff', accentColor, 'transparent']} start={{ x: 1, y: 0.5 }} end={{ x: 0, y: 0.5 }} style={styles.gradientFill} />
          </Animated.View>
          <Animated.View style={[styles.verticalComet, { left: edgeInset, width: sideThickness, height: verticalSweepHeight, opacity: primaryCometOpacity, transform: [{ translateY: leftCometY }] }]}>
            <LinearGradient colors={['transparent', accentColor, '#ffffff', accentColor, 'transparent']} start={{ x: 0.5, y: 1 }} end={{ x: 0.5, y: 0 }} style={styles.gradientFill} />
          </Animated.View>
        </>
      ) : null}

      {isPremium ? (
        <>
          <Animated.View style={[styles.horizontalComet, styles.premiumSecondaryGlow, { top: edgeInset + 12, width: horizontalSweepWidth * 0.82, height: cometThickness + 2, opacity: secondaryCometOpacity, transform: [{ translateX: topChaseX }] }]}>
            <LinearGradient colors={['transparent', borderColor, '#ffffff', accentColor, 'transparent']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.gradientFill} />
          </Animated.View>
          <Animated.View style={[styles.verticalComet, styles.premiumSecondaryGlow, { right: edgeInset + 12, width: sideThickness + 2, height: verticalSweepHeight * 0.78, opacity: secondaryCometOpacity, transform: [{ translateY: rightChaseY }] }]}>
            <LinearGradient colors={['transparent', borderColor, '#ffffff', accentColor, 'transparent']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={styles.gradientFill} />
          </Animated.View>
          <Animated.View style={[styles.horizontalComet, styles.premiumSecondaryGlow, { bottom: edgeInset + 12, width: horizontalSweepWidth * 0.82, height: cometThickness + 2, opacity: secondaryCometOpacity, transform: [{ translateX: bottomChaseX }] }]}>
            <LinearGradient colors={['transparent', accentColor, '#ffffff', borderColor, 'transparent']} start={{ x: 1, y: 0.5 }} end={{ x: 0, y: 0.5 }} style={styles.gradientFill} />
          </Animated.View>
          <Animated.View style={[styles.verticalComet, styles.premiumSecondaryGlow, { left: edgeInset + 12, width: sideThickness + 2, height: verticalSweepHeight * 0.78, opacity: secondaryCometOpacity, transform: [{ translateY: leftChaseY }] }]}>
            <LinearGradient colors={['transparent', accentColor, '#ffffff', borderColor, 'transparent']} start={{ x: 0.5, y: 1 }} end={{ x: 0.5, y: 0 }} style={styles.gradientFill} />
          </Animated.View>

          <Animated.View style={[styles.premiumSheen, dynamicStyles.shimmer, { opacity: sheenOpacity, transform: [{ translateX: shimmerTranslateX }, { rotate: '-18deg' }] }]}>
            <LinearGradient colors={['transparent', 'rgba(255,255,255,0.0)', 'rgba(255,255,255,0.22)', 'rgba(255,255,255,0.0)', 'transparent']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.gradientFill} />
          </Animated.View>

          {[
            dynamicStyles.cornerTopLeft,
            dynamicStyles.cornerTopRight,
            dynamicStyles.cornerBottomLeft,
            dynamicStyles.cornerBottomRight,
          ].map((cornerStyle, index) => (
            <Animated.View
              key={`corner-${index}`}
              style={[
                styles.cornerBurst,
                cornerStyle,
                {
                  opacity: cornerOpacity,
                  backgroundColor: index % 2 === 0 ? accentColor : '#ffffff',
                  shadowColor: accentColor,
                  transform: [{ scale: cornerScale }],
                },
              ]}
            />
          ))}
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
  groupAnimAura: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
    shadowOpacity: 0.28,
    shadowRadius: 22,
  },
  groupAnimGlow: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
    shadowOpacity: 0.32,
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
  horizontalComet: {
    position: 'absolute',
    left: 0,
    overflow: 'hidden',
    borderRadius: 999,
  },
  verticalComet: {
    position: 'absolute',
    top: 0,
    overflow: 'hidden',
    borderRadius: 999,
  },
  premiumSecondaryGlow: {
    shadowOpacity: 0.26,
    shadowRadius: 10,
  },
  premiumSheen: {
    position: 'absolute',
    left: 0,
    overflow: 'hidden',
    borderRadius: 999,
  },
  gradientFill: {
    flex: 1,
  },
  cornerBurst: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 999,
    shadowOpacity: 0.55,
    shadowRadius: 10,
  },
});
