import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { GroupCardAnimationVariantId } from '../constants/groupThemes';

interface Props {
  width: number;
  height: number;
  accentColor: string;
  borderColor: string;
  active: boolean;
  variant: GroupCardAnimationVariantId;
  cornerRadius?: number;
}

type ParticleSpec = {
  key: string;
  size: number;
  phase: number;
  style: {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  };
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function phaseOpacity(anim: Animated.Value, phase: number, min: number, max: number) {
  const p0 = phase;
  const p2 = Math.min(phase + 0.22, 0.96);
  const p1 = Math.min(phase + 0.11, p2 - 0.01);
  return anim.interpolate({
    inputRange: [0, p0, p1, p2, 1],
    outputRange: [min, min, max, min, min],
    extrapolate: 'clamp',
  });
}

function phaseScale(anim: Animated.Value, phase: number, min: number, max: number) {
  const p0 = phase;
  const p2 = Math.min(phase + 0.22, 0.96);
  const p1 = Math.min(phase + 0.11, p2 - 0.01);
  return anim.interpolate({
    inputRange: [0, p0, p1, p2, 1],
    outputRange: [min, min, max, min, min],
    extrapolate: 'clamp',
  });
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
  const travelAnim = useRef(new Animated.Value(0)).current;
  const travelSecondaryAnim = useRef(new Animated.Value(0)).current;
  const sparkleAnim = useRef(new Animated.Value(0)).current;

  const pulseLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const travelLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const travelSecondaryLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const sparkleLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  const isBasic = variant === 'basic';
  const isStandard = variant === 'standard';
  const isPremium = variant === 'premium';

  const outerSpread = isPremium ? 12 : isStandard ? 8 : 5;
  const frameInset = Math.max(Math.round(cornerRadius * 0.7), 11);
  const verticalInset = Math.max(Math.round(cornerRadius * 0.84), 13);
  const lineThickness = isPremium ? 2.4 : isStandard ? 1.85 : 1.25;
  const trackThickness = isPremium ? 14 : isStandard ? 10 : 7;
  const primaryCometThickness = isPremium ? 6 : isStandard ? 5 : 4;
  const secondaryCometThickness = isPremium ? 4 : 3;

  const horizontalTrackLength = Math.max(width - frameInset * 2, 40);
  const verticalTrackLength = Math.max(height - verticalInset * 2, 40);
  const primaryHorizontalCometWidth = clamp(horizontalTrackLength * (isPremium ? 0.24 : isStandard ? 0.2 : 0.18), 54, isPremium ? 112 : 86);
  const primaryVerticalCometHeight = clamp(verticalTrackLength * (isPremium ? 0.2 : isStandard ? 0.18 : 0.16), 44, isPremium ? 90 : 68);
  const secondaryHorizontalCometWidth = clamp(horizontalTrackLength * 0.16, 34, 64);
  const secondaryVerticalCometHeight = clamp(verticalTrackLength * 0.15, 28, 58);

  useEffect(() => {
    pulseLoopRef.current?.stop?.();
    travelLoopRef.current?.stop?.();
    travelSecondaryLoopRef.current?.stop?.();
    sparkleLoopRef.current?.stop?.();

    pulseAnim.stopAnimation();
    travelAnim.stopAnimation();
    travelSecondaryAnim.stopAnimation();
    sparkleAnim.stopAnimation();

    if (!active || width < 40 || height < 40 || variant === 'none') {
      pulseAnim.setValue(0);
      travelAnim.setValue(0);
      travelSecondaryAnim.setValue(0);
      sparkleAnim.setValue(0);
      return;
    }

    pulseLoopRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: isPremium ? 1800 : isStandard ? 2050 : 2300,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: isPremium ? 1800 : isStandard ? 2050 : 2300,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );

    travelLoopRef.current = Animated.loop(
      Animated.timing(travelAnim, {
        toValue: 1,
        duration: isPremium ? 3200 : isStandard ? 3600 : 2900,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );

    if (!isBasic) {
      travelSecondaryLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.delay(isPremium ? 180 : 280),
          Animated.timing(travelSecondaryAnim, {
            toValue: 1,
            duration: isPremium ? 3800 : 4400,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
          Animated.timing(travelSecondaryAnim, {
            toValue: 0,
            duration: 0,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
        ]),
      );
    }

    if (isStandard || isPremium) {
      sparkleLoopRef.current = Animated.loop(
        Animated.timing(sparkleAnim, {
          toValue: 1,
          duration: isPremium ? 2400 : 3000,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      );
    }

    pulseLoopRef.current.start();
    travelLoopRef.current.start();
    travelSecondaryLoopRef.current?.start?.();
    sparkleLoopRef.current?.start?.();

    return () => {
      pulseLoopRef.current?.stop?.();
      travelLoopRef.current?.stop?.();
      travelSecondaryLoopRef.current?.stop?.();
      sparkleLoopRef.current?.stop?.();
      pulseAnim.stopAnimation();
      travelAnim.stopAnimation();
      travelSecondaryAnim.stopAnimation();
      sparkleAnim.stopAnimation();
    };
  }, [active, height, isBasic, isPremium, isStandard, pulseAnim, sparkleAnim, travelAnim, travelSecondaryAnim, variant, width]);

  const frameOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: isPremium ? [0.66, 1] : isStandard ? [0.52, 0.84] : [0.34, 0.6],
  });
  const railOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: isPremium ? [0.42, 0.78] : isStandard ? [0.28, 0.52] : [0.18, 0.34],
  });
  const auraOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: isPremium ? [0.18, 0.4] : isStandard ? [0.07, 0.17] : [0.02, 0.06],
  });
  const auraScale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: isPremium ? [0.992, 1.018] : isStandard ? [0.996, 1.01] : [0.998, 1.004],
  });
  const borderScale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: isPremium ? [0.996, 1.006] : isStandard ? [0.998, 1.004] : [0.999, 1.002],
  });

  const primaryOpacity = travelAnim.interpolate({
    inputRange: [0, 0.12, 0.5, 0.88, 1],
    outputRange: [0.18, 0.95, isPremium ? 0.74 : 0.58, 0.95, 0.18],
  });
  const secondaryOpacity = travelSecondaryAnim.interpolate({
    inputRange: [0, 0.12, 0.5, 0.88, 1],
    outputRange: [0.08, 0.82, isPremium ? 0.62 : 0.34, 0.82, 0.08],
  });

  const topTravel = Math.max(horizontalTrackLength - primaryHorizontalCometWidth, 0);
  const sideTravel = Math.max(verticalTrackLength - primaryVerticalCometHeight, 0);
  const secondaryTopTravel = Math.max(horizontalTrackLength - secondaryHorizontalCometWidth, 0);
  const secondarySideTravel = Math.max(verticalTrackLength - secondaryVerticalCometHeight, 0);

  const topX = travelAnim.interpolate({ inputRange: [0, 1], outputRange: [0, topTravel] });
  const rightY = travelAnim.interpolate({ inputRange: [0, 1], outputRange: [0, sideTravel] });
  const bottomX = travelAnim.interpolate({ inputRange: [0, 1], outputRange: [topTravel, 0] });
  const leftY = travelAnim.interpolate({ inputRange: [0, 1], outputRange: [sideTravel, 0] });

  const secondaryTopX = travelSecondaryAnim.interpolate({ inputRange: [0, 1], outputRange: [secondaryTopTravel, 0] });
  const secondaryRightY = travelSecondaryAnim.interpolate({ inputRange: [0, 1], outputRange: [secondarySideTravel, 0] });
  const secondaryBottomX = travelSecondaryAnim.interpolate({ inputRange: [0, 1], outputRange: [0, secondaryTopTravel] });
  const secondaryLeftY = travelSecondaryAnim.interpolate({ inputRange: [0, 1], outputRange: [0, secondarySideTravel] });

  const particleSpecs = useMemo<ParticleSpec[]>(() => {
    if (isPremium) {
      return [
        { key: 'p1', size: 4, phase: 0.02, style: { top: outerSpread - 7, left: outerSpread + 22 } },
        { key: 'p2', size: 5, phase: 0.16, style: { top: outerSpread + 18, right: outerSpread - 5 } },
        { key: 'p3', size: 4, phase: 0.28, style: { bottom: outerSpread - 6, right: outerSpread + 26 } },
        { key: 'p4', size: 3, phase: 0.42, style: { bottom: outerSpread + 20, left: outerSpread - 4 } },
        { key: 'p5', size: 4, phase: 0.56, style: { top: outerSpread + 52, left: outerSpread - 6 } },
        { key: 'p6', size: 3, phase: 0.7, style: { top: outerSpread - 5, right: outerSpread + 48 } },
        { key: 'p7', size: 5, phase: 0.68, style: { bottom: outerSpread - 4, left: outerSpread + 54 } },
      ];
    }

    if (isStandard) {
      return [
        { key: 's1', size: 3, phase: 0.12, style: { top: outerSpread - 5, left: outerSpread + 24 } },
        { key: 's2', size: 3, phase: 0.44, style: { top: outerSpread + 24, right: outerSpread - 3 } },
        { key: 's3', size: 3, phase: 0.6, style: { bottom: outerSpread - 4, left: outerSpread + 42 } },
      ];
    }

    return [];
  }, [isPremium, isStandard, outerSpread]);

  const dynamicStyles = useMemo(
    () => ({
      wrap: {
        top: -outerSpread,
        right: -outerSpread,
        bottom: -outerSpread,
        left: -outerSpread,
      },
      aura: {
        top: outerSpread - 2,
        right: outerSpread - 2,
        bottom: outerSpread - 2,
        left: outerSpread - 2,
        borderRadius: cornerRadius + 4,
      },
      glow: {
        top: outerSpread - 1,
        right: outerSpread - 1,
        bottom: outerSpread - 1,
        left: outerSpread - 1,
        borderRadius: cornerRadius + 2,
      },
      topTrack: {
        top: outerSpread - Math.round(trackThickness / 2),
        left: outerSpread + frameInset,
        width: horizontalTrackLength,
        height: trackThickness,
      },
      bottomTrack: {
        bottom: outerSpread - Math.round(trackThickness / 2),
        left: outerSpread + frameInset,
        width: horizontalTrackLength,
        height: trackThickness,
      },
      leftTrack: {
        top: outerSpread + verticalInset,
        left: outerSpread - Math.round(trackThickness / 2),
        width: trackThickness,
        height: verticalTrackLength,
      },
      rightTrack: {
        top: outerSpread + verticalInset,
        right: outerSpread - Math.round(trackThickness / 2),
        width: trackThickness,
        height: verticalTrackLength,
      },
      frameTop: {
        top: outerSpread,
        left: outerSpread + frameInset,
        right: outerSpread + frameInset,
        height: lineThickness,
      },
      frameBottom: {
        bottom: outerSpread,
        left: outerSpread + frameInset,
        right: outerSpread + frameInset,
        height: lineThickness,
      },
      frameLeft: {
        top: outerSpread + verticalInset,
        bottom: outerSpread + verticalInset,
        left: outerSpread,
        width: lineThickness,
      },
      frameRight: {
        top: outerSpread + verticalInset,
        bottom: outerSpread + verticalInset,
        right: outerSpread,
        width: lineThickness,
      },
      cornerTopLeft: { top: outerSpread - 2, left: outerSpread - 2 },
      cornerTopRight: { top: outerSpread - 2, right: outerSpread - 2 },
      cornerBottomLeft: { bottom: outerSpread - 2, left: outerSpread - 2 },
      cornerBottomRight: { bottom: outerSpread - 2, right: outerSpread - 2 },
    }),
    [cornerRadius, frameInset, horizontalTrackLength, lineThickness, outerSpread, trackThickness, verticalInset, verticalTrackLength],
  );

  return (
    <Animated.View pointerEvents="none" style={[styles.wrap, dynamicStyles.wrap]}>
      <Animated.View
        style={[
          styles.aura,
          dynamicStyles.aura,
          {
            borderColor: accentColor,
            shadowColor: accentColor,
            opacity: auraOpacity,
            transform: [{ scale: auraScale }],
          },
        ]}
      />

      <Animated.View
        style={[
          styles.glow,
          dynamicStyles.glow,
          {
            borderColor,
            shadowColor: accentColor,
            opacity: frameOpacity,
            transform: [{ scale: borderScale }],
          },
        ]}
      />

      <Animated.View style={[styles.frameHorizontal, dynamicStyles.frameTop, { opacity: railOpacity }]}>
        <LinearGradient colors={[accentColor, '#ffffff', borderColor, accentColor]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.fill} />
      </Animated.View>
      <Animated.View style={[styles.frameHorizontal, dynamicStyles.frameBottom, { opacity: railOpacity }]}>
        <LinearGradient colors={[accentColor, borderColor, '#ffffff', accentColor]} start={{ x: 1, y: 0.5 }} end={{ x: 0, y: 0.5 }} style={styles.fill} />
      </Animated.View>
      <Animated.View style={[styles.frameVertical, dynamicStyles.frameLeft, { opacity: railOpacity }]}>
        <LinearGradient colors={[accentColor, '#ffffff', borderColor, accentColor]} start={{ x: 0.5, y: 1 }} end={{ x: 0.5, y: 0 }} style={styles.fill} />
      </Animated.View>
      <Animated.View style={[styles.frameVertical, dynamicStyles.frameRight, { opacity: railOpacity }]}>
        <LinearGradient colors={[accentColor, '#ffffff', borderColor, accentColor]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={styles.fill} />
      </Animated.View>

      <View style={[styles.horizontalTrack, dynamicStyles.topTrack]}>
        <Animated.View style={[styles.primaryHorizontalComet, { width: primaryHorizontalCometWidth, height: primaryCometThickness, opacity: primaryOpacity, shadowColor: accentColor, transform: [{ translateX: topX }] }]}>
          <LinearGradient colors={['transparent', accentColor, '#ffffff', accentColor, 'transparent']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.fill} />
        </Animated.View>
        {!isBasic ? (
          <Animated.View style={[styles.secondaryHorizontalComet, { width: secondaryHorizontalCometWidth, height: secondaryCometThickness, opacity: secondaryOpacity, shadowColor: accentColor, transform: [{ translateX: secondaryTopX }] }]}>
            <LinearGradient colors={['transparent', borderColor, '#ffffff', accentColor, 'transparent']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.fill} />
          </Animated.View>
        ) : null}
      </View>

      {!isBasic ? (
        <View style={[styles.verticalTrack, dynamicStyles.rightTrack]}>
          <Animated.View style={[styles.primaryVerticalComet, { width: primaryCometThickness, height: primaryVerticalCometHeight, opacity: primaryOpacity, shadowColor: accentColor, transform: [{ translateY: rightY }] }]}>
            <LinearGradient colors={['transparent', accentColor, '#ffffff', accentColor, 'transparent']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={styles.fill} />
          </Animated.View>
          <Animated.View style={[styles.secondaryVerticalComet, { width: secondaryCometThickness, height: secondaryVerticalCometHeight, opacity: secondaryOpacity, shadowColor: accentColor, transform: [{ translateY: secondaryRightY }] }]}>
            <LinearGradient colors={['transparent', borderColor, '#ffffff', accentColor, 'transparent']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={styles.fill} />
          </Animated.View>
        </View>
      ) : null}

      {!isBasic ? (
        <View style={[styles.horizontalTrack, dynamicStyles.bottomTrack]}>
          <Animated.View style={[styles.primaryHorizontalComet, { width: primaryHorizontalCometWidth, height: primaryCometThickness, opacity: primaryOpacity, shadowColor: accentColor, transform: [{ translateX: bottomX }] }]}>
            <LinearGradient colors={['transparent', accentColor, '#ffffff', accentColor, 'transparent']} start={{ x: 1, y: 0.5 }} end={{ x: 0, y: 0.5 }} style={styles.fill} />
          </Animated.View>
          <Animated.View style={[styles.secondaryHorizontalComet, { width: secondaryHorizontalCometWidth, height: secondaryCometThickness, opacity: secondaryOpacity, shadowColor: accentColor, transform: [{ translateX: secondaryBottomX }] }]}>
            <LinearGradient colors={['transparent', accentColor, '#ffffff', borderColor, 'transparent']} start={{ x: 1, y: 0.5 }} end={{ x: 0, y: 0.5 }} style={styles.fill} />
          </Animated.View>
        </View>
      ) : null}

      {!isBasic ? (
        <View style={[styles.verticalTrack, dynamicStyles.leftTrack]}>
          <Animated.View style={[styles.primaryVerticalComet, { width: primaryCometThickness, height: primaryVerticalCometHeight, opacity: primaryOpacity, shadowColor: accentColor, transform: [{ translateY: leftY }] }]}>
            <LinearGradient colors={['transparent', accentColor, '#ffffff', accentColor, 'transparent']} start={{ x: 0.5, y: 1 }} end={{ x: 0.5, y: 0 }} style={styles.fill} />
          </Animated.View>
          <Animated.View style={[styles.secondaryVerticalComet, { width: secondaryCometThickness, height: secondaryVerticalCometHeight, opacity: secondaryOpacity, shadowColor: accentColor, transform: [{ translateY: secondaryLeftY }] }]}>
            <LinearGradient colors={['transparent', accentColor, '#ffffff', borderColor, 'transparent']} start={{ x: 0.5, y: 1 }} end={{ x: 0.5, y: 0 }} style={styles.fill} />
          </Animated.View>
        </View>
      ) : null}

      {isPremium ? (
        [
          dynamicStyles.cornerTopLeft,
          dynamicStyles.cornerTopRight,
          dynamicStyles.cornerBottomLeft,
          dynamicStyles.cornerBottomRight,
        ].map((cornerStyle, index) => {
          const phase = index * 0.2;
          const opacity = phaseOpacity(sparkleAnim, phase, 0.14, 0.9);
          const scale = phaseScale(sparkleAnim, phase, 0.82, 1.26);
          return (
            <Animated.View
              key={`corner-spark-${index}`}
              style={[
                styles.cornerSpark,
                cornerStyle,
                {
                  opacity,
                  shadowColor: accentColor,
                  transform: [{ scale }],
                },
              ]}
            >
              <View style={[styles.cornerSparkCore, { backgroundColor: index % 2 === 0 ? accentColor : '#ffffff' }]} />
            </Animated.View>
          );
        })
      ) : null}

      {(isStandard || isPremium) && particleSpecs.length > 0
        ? particleSpecs.map((particle) => {
            const opacity = phaseOpacity(sparkleAnim, particle.phase, 0.08, isPremium ? 0.8 : 0.46);
            const scale = phaseScale(sparkleAnim, particle.phase, 0.72, isPremium ? 1.24 : 1.08);
            return (
              <Animated.View
                key={particle.key}
                style={[
                  styles.particle,
                  particle.style,
                  {
                    width: particle.size,
                    height: particle.size,
                    borderRadius: particle.size / 2,
                    backgroundColor: particle.key.endsWith('2') || particle.key.endsWith('6') ? '#ffffff' : accentColor,
                    shadowColor: accentColor,
                    opacity,
                    transform: [{ scale }],
                  },
                ]}
              />
            );
          })
        : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    zIndex: 12,
  },
  aura: {
    position: 'absolute',
    borderWidth: 1,
    shadowOpacity: 0.28,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 0 },
  },
  glow: {
    position: 'absolute',
    borderWidth: 1,
    shadowOpacity: 0.38,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
  },
  frameHorizontal: {
    position: 'absolute',
    borderRadius: 999,
    overflow: 'hidden',
  },
  frameVertical: {
    position: 'absolute',
    borderRadius: 999,
    overflow: 'hidden',
  },
  horizontalTrack: {
    position: 'absolute',
    overflow: 'hidden',
    borderRadius: 999,
    justifyContent: 'center',
  },
  verticalTrack: {
    position: 'absolute',
    overflow: 'hidden',
    borderRadius: 999,
    alignItems: 'center',
  },
  primaryHorizontalComet: {
    position: 'absolute',
    left: 0,
    borderRadius: 999,
    overflow: 'hidden',
    shadowOpacity: 0.78,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  secondaryHorizontalComet: {
    position: 'absolute',
    left: 0,
    borderRadius: 999,
    overflow: 'hidden',
    shadowOpacity: 0.5,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  primaryVerticalComet: {
    position: 'absolute',
    top: 0,
    borderRadius: 999,
    overflow: 'hidden',
    shadowOpacity: 0.78,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  secondaryVerticalComet: {
    position: 'absolute',
    top: 0,
    borderRadius: 999,
    overflow: 'hidden',
    shadowOpacity: 0.5,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  cornerSpark: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.9,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  cornerSparkCore: {
    width: 5,
    height: 5,
    borderRadius: 999,
    opacity: 0.98,
  },
  particle: {
    position: 'absolute',
    shadowOpacity: 0.8,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 0 },
  },
  fill: {
    flex: 1,
  },
});
