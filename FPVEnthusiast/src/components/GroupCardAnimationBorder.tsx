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
  const cornerAnim = useRef(new Animated.Value(0)).current;

  const pulseLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const orbitLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const chaseLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const cornerLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  const isBasic = variant === 'basic';
  const isStandard = variant === 'standard';
  const isPremium = variant === 'premium';

  const edgeThickness = isPremium ? 4 : isStandard ? 3 : 2;
  const secondaryThickness = isPremium ? 3 : 2;
  const outerSpread = isPremium ? 10 : isStandard ? 8 : 6;
  const edgeInset = Math.max(Math.round(cornerRadius * 0.72), 11);
  const sideInset = Math.max(Math.round(cornerRadius * 0.88), 13);

  useEffect(() => {
    pulseLoopRef.current?.stop?.();
    orbitLoopRef.current?.stop?.();
    chaseLoopRef.current?.stop?.();
    cornerLoopRef.current?.stop?.();

    pulseAnim.stopAnimation();
    orbitAnim.stopAnimation();
    chaseAnim.stopAnimation();
    cornerAnim.stopAnimation();

    if (!active || width < 40 || height < 40 || variant === 'none') {
      pulseAnim.setValue(0);
      orbitAnim.setValue(0);
      chaseAnim.setValue(0);
      cornerAnim.setValue(0);
      return;
    }

    pulseLoopRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: isPremium ? 820 : isStandard ? 980 : 1160,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: isPremium ? 820 : isStandard ? 980 : 1160,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );

    orbitLoopRef.current = Animated.loop(
      Animated.timing(orbitAnim, {
        toValue: 1,
        duration: isPremium ? 1900 : isStandard ? 2550 : 2350,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );

    if (!isBasic) {
      chaseLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.delay(isPremium ? 120 : 220),
          Animated.timing(chaseAnim, {
            toValue: 1,
            duration: isPremium ? 1600 : 2300,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
          Animated.timing(chaseAnim, {
            toValue: 0,
            duration: 0,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
        ]),
      );
    }

    if (isPremium) {
      cornerLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(cornerAnim, {
            toValue: 1,
            duration: 680,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(cornerAnim, {
            toValue: 0,
            duration: 820,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      );
    }

    pulseLoopRef.current.start();
    orbitLoopRef.current.start();
    chaseLoopRef.current?.start?.();
    cornerLoopRef.current?.start?.();

    return () => {
      pulseLoopRef.current?.stop?.();
      orbitLoopRef.current?.stop?.();
      chaseLoopRef.current?.stop?.();
      cornerLoopRef.current?.stop?.();
      pulseAnim.stopAnimation();
      orbitAnim.stopAnimation();
      chaseAnim.stopAnimation();
      cornerAnim.stopAnimation();
    };
  }, [active, chaseAnim, cornerAnim, height, isBasic, isPremium, isStandard, orbitAnim, pulseAnim, variant, width]);

  const edgeOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: isPremium ? [0.74, 1] : isStandard ? [0.58, 0.92] : [0.4, 0.82],
  });
  const glowOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: isPremium ? [0.34, 0.76] : isStandard ? [0.16, 0.34] : [0.08, 0.18],
  });
  const auraOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: isPremium ? [0.18, 0.42] : isStandard ? [0.08, 0.18] : [0.03, 0.08],
  });
  const auraScale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: isPremium ? [0.992, 1.02] : isStandard ? [0.995, 1.012] : [0.998, 1.006],
  });
  const edgeScaleX = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: isPremium ? [0.985, 1.015] : isStandard ? [0.99, 1.01] : [0.995, 1.004],
  });
  const edgeScaleY = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: isPremium ? [0.985, 1.02] : isStandard ? [0.992, 1.014] : [0.996, 1.006],
  });
  const cornerOpacity = cornerAnim.interpolate({ inputRange: [0, 1], outputRange: [0.22, 0.95] });
  const cornerScale = cornerAnim.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1.24] });

  const horizontalSweepWidth = clamp(width * (isPremium ? 0.38 : isStandard ? 0.32 : 0.28), 96, isPremium ? 188 : 152);
  const verticalSweepHeight = clamp(height * (isPremium ? 0.34 : isStandard ? 0.28 : 0.24), 82, isPremium ? 164 : 128);

  const topTravel = Math.max(width - edgeInset * 2, horizontalSweepWidth + 12);
  const sideTravel = Math.max(height - sideInset * 2, verticalSweepHeight + 12);

  const topCometX = orbitAnim.interpolate({ inputRange: [0, 1], outputRange: [-horizontalSweepWidth, topTravel] });
  const rightCometY = orbitAnim.interpolate({ inputRange: [0, 1], outputRange: [-verticalSweepHeight, sideTravel] });
  const bottomCometX = orbitAnim.interpolate({ inputRange: [0, 1], outputRange: [topTravel, -horizontalSweepWidth] });
  const leftCometY = orbitAnim.interpolate({ inputRange: [0, 1], outputRange: [sideTravel, -verticalSweepHeight] });

  const secondaryTopX = chaseAnim.interpolate({ inputRange: [0, 1], outputRange: [topTravel * 0.42, -horizontalSweepWidth] });
  const secondaryRightY = chaseAnim.interpolate({ inputRange: [0, 1], outputRange: [sideTravel * 0.18, -verticalSweepHeight] });
  const secondaryBottomX = chaseAnim.interpolate({ inputRange: [0, 1], outputRange: [-horizontalSweepWidth, topTravel] });
  const secondaryLeftY = chaseAnim.interpolate({ inputRange: [0, 1], outputRange: [-verticalSweepHeight, sideTravel] });

  const primaryCometOpacity = orbitAnim.interpolate({
    inputRange: [0, 0.08, 0.5, 0.92, 1],
    outputRange: [0, 1, isPremium ? 0.72 : 0.56, 1, 0],
  });
  const secondaryCometOpacity = chaseAnim.interpolate({
    inputRange: [0, 0.08, 0.5, 0.92, 1],
    outputRange: [0, 0.94, isPremium ? 0.66 : 0.44, 0.94, 0],
  });

  const dynamicStyles = useMemo(
    () => ({
      wrap: {
        top: -outerSpread,
        right: -outerSpread,
        bottom: -outerSpread,
        left: -outerSpread,
      },
      aura: {
        top: outerSpread - 1,
        right: outerSpread - 1,
        bottom: outerSpread - 1,
        left: outerSpread - 1,
        borderRadius: cornerRadius + 2,
      },
      glow: {
        top: outerSpread - 2,
        right: outerSpread - 2,
        bottom: outerSpread - 2,
        left: outerSpread - 2,
        borderRadius: cornerRadius + 4,
      },
      topEdge: {
        top: outerSpread - Math.round(edgeThickness / 2),
        left: outerSpread + edgeInset,
        right: outerSpread + edgeInset,
        height: edgeThickness,
      },
      bottomEdge: {
        bottom: outerSpread - Math.round(edgeThickness / 2),
        left: outerSpread + edgeInset,
        right: outerSpread + edgeInset,
        height: edgeThickness,
      },
      leftEdge: {
        top: outerSpread + sideInset,
        bottom: outerSpread + sideInset,
        left: outerSpread - Math.round(edgeThickness / 2),
        width: edgeThickness,
      },
      rightEdge: {
        top: outerSpread + sideInset,
        bottom: outerSpread + sideInset,
        right: outerSpread - Math.round(edgeThickness / 2),
        width: edgeThickness,
      },
      topCometTrack: {
        top: outerSpread - Math.round((isPremium ? 12 : 10) / 2),
        left: outerSpread + edgeInset,
      },
      rightCometTrack: {
        top: outerSpread + sideInset,
        right: outerSpread - Math.round((isPremium ? 12 : 10) / 2),
      },
      bottomCometTrack: {
        bottom: outerSpread - Math.round((isPremium ? 12 : 10) / 2),
        left: outerSpread + edgeInset,
      },
      leftCometTrack: {
        top: outerSpread + sideInset,
        left: outerSpread - Math.round((isPremium ? 12 : 10) / 2),
      },
      secondaryTopTrack: {
        top: outerSpread + 5,
        left: outerSpread + edgeInset,
      },
      secondaryRightTrack: {
        top: outerSpread + sideInset,
        right: outerSpread + 4,
      },
      secondaryBottomTrack: {
        bottom: outerSpread + 5,
        left: outerSpread + edgeInset,
      },
      secondaryLeftTrack: {
        top: outerSpread + sideInset,
        left: outerSpread + 4,
      },
      cornerTopLeft: { top: outerSpread - 3, left: outerSpread - 3 },
      cornerTopRight: { top: outerSpread - 3, right: outerSpread - 3 },
      cornerBottomLeft: { bottom: outerSpread - 3, left: outerSpread - 3 },
      cornerBottomRight: { bottom: outerSpread - 3, right: outerSpread - 3 },
    }),
    [cornerRadius, edgeInset, edgeThickness, isPremium, outerSpread, sideInset],
  );

  return (
    <Animated.View pointerEvents="none" style={[styles.wrap, dynamicStyles.wrap]}>
      <Animated.View
        style={[
          styles.aura,
          dynamicStyles.aura,
          {
            opacity: auraOpacity,
            borderColor: accentColor,
            shadowColor: accentColor,
            transform: [{ scale: auraScale }],
          },
        ]}
      />

      <Animated.View
        style={[
          styles.glow,
          dynamicStyles.glow,
          {
            opacity: glowOpacity,
            borderColor,
            shadowColor: accentColor,
            transform: [{ scale: auraScale }],
          },
        ]}
      />

      <Animated.View style={[styles.edgeHorizontal, dynamicStyles.topEdge, { opacity: edgeOpacity, transform: [{ scaleX: edgeScaleX }] }]}>
        <LinearGradient colors={[accentColor, '#ffffff', borderColor, accentColor]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.gradientFill} />
      </Animated.View>
      <Animated.View style={[styles.edgeHorizontal, dynamicStyles.bottomEdge, { opacity: edgeOpacity, transform: [{ scaleX: edgeScaleX }] }]}>
        <LinearGradient colors={[accentColor, borderColor, '#ffffff', accentColor]} start={{ x: 1, y: 0.5 }} end={{ x: 0, y: 0.5 }} style={styles.gradientFill} />
      </Animated.View>
      <Animated.View style={[styles.edgeVertical, dynamicStyles.leftEdge, { opacity: edgeOpacity, transform: [{ scaleY: edgeScaleY }] }]}>
        <LinearGradient colors={[accentColor, '#ffffff', borderColor, accentColor]} start={{ x: 0.5, y: 1 }} end={{ x: 0.5, y: 0 }} style={styles.gradientFill} />
      </Animated.View>
      <Animated.View style={[styles.edgeVertical, dynamicStyles.rightEdge, { opacity: edgeOpacity, transform: [{ scaleY: edgeScaleY }] }]}>
        <LinearGradient colors={[accentColor, '#ffffff', borderColor, accentColor]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={styles.gradientFill} />
      </Animated.View>

      <Animated.View
        style={[
          styles.horizontalComet,
          dynamicStyles.topCometTrack,
          {
            width: horizontalSweepWidth,
            height: isPremium ? 12 : isStandard ? 10 : 8,
            opacity: primaryCometOpacity,
            transform: [{ translateX: topCometX }],
          },
        ]}
      >
        <LinearGradient colors={['transparent', accentColor, '#ffffff', accentColor, 'transparent']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.gradientFill} />
      </Animated.View>

      {!isBasic ? (
        <>
          <Animated.View
            style={[
              styles.verticalComet,
              dynamicStyles.rightCometTrack,
              {
                width: isPremium ? 12 : 10,
                height: verticalSweepHeight,
                opacity: primaryCometOpacity,
                transform: [{ translateY: rightCometY }],
              },
            ]}
          >
            <LinearGradient colors={['transparent', accentColor, '#ffffff', accentColor, 'transparent']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={styles.gradientFill} />
          </Animated.View>
          <Animated.View
            style={[
              styles.horizontalComet,
              dynamicStyles.bottomCometTrack,
              {
                width: horizontalSweepWidth,
                height: isPremium ? 12 : 10,
                opacity: primaryCometOpacity,
                transform: [{ translateX: bottomCometX }],
              },
            ]}
          >
            <LinearGradient colors={['transparent', accentColor, '#ffffff', accentColor, 'transparent']} start={{ x: 1, y: 0.5 }} end={{ x: 0, y: 0.5 }} style={styles.gradientFill} />
          </Animated.View>
          <Animated.View
            style={[
              styles.verticalComet,
              dynamicStyles.leftCometTrack,
              {
                width: isPremium ? 12 : 10,
                height: verticalSweepHeight,
                opacity: primaryCometOpacity,
                transform: [{ translateY: leftCometY }],
              },
            ]}
          >
            <LinearGradient colors={['transparent', accentColor, '#ffffff', accentColor, 'transparent']} start={{ x: 0.5, y: 1 }} end={{ x: 0.5, y: 0 }} style={styles.gradientFill} />
          </Animated.View>
        </>
      ) : null}

      {isPremium ? (
        <>
          <Animated.View
            style={[
              styles.horizontalComet,
              styles.secondaryComet,
              dynamicStyles.secondaryTopTrack,
              {
                width: horizontalSweepWidth * 0.8,
                height: secondaryThickness + 3,
                opacity: secondaryCometOpacity,
                transform: [{ translateX: secondaryTopX }],
              },
            ]}
          >
            <LinearGradient colors={['transparent', borderColor, '#ffffff', accentColor, 'transparent']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.gradientFill} />
          </Animated.View>
          <Animated.View
            style={[
              styles.verticalComet,
              styles.secondaryComet,
              dynamicStyles.secondaryRightTrack,
              {
                width: secondaryThickness + 3,
                height: verticalSweepHeight * 0.78,
                opacity: secondaryCometOpacity,
                transform: [{ translateY: secondaryRightY }],
              },
            ]}
          >
            <LinearGradient colors={['transparent', borderColor, '#ffffff', accentColor, 'transparent']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={styles.gradientFill} />
          </Animated.View>
          <Animated.View
            style={[
              styles.horizontalComet,
              styles.secondaryComet,
              dynamicStyles.secondaryBottomTrack,
              {
                width: horizontalSweepWidth * 0.8,
                height: secondaryThickness + 3,
                opacity: secondaryCometOpacity,
                transform: [{ translateX: secondaryBottomX }],
              },
            ]}
          >
            <LinearGradient colors={['transparent', accentColor, '#ffffff', borderColor, 'transparent']} start={{ x: 1, y: 0.5 }} end={{ x: 0, y: 0.5 }} style={styles.gradientFill} />
          </Animated.View>
          <Animated.View
            style={[
              styles.verticalComet,
              styles.secondaryComet,
              dynamicStyles.secondaryLeftTrack,
              {
                width: secondaryThickness + 3,
                height: verticalSweepHeight * 0.78,
                opacity: secondaryCometOpacity,
                transform: [{ translateY: secondaryLeftY }],
              },
            ]}
          >
            <LinearGradient colors={['transparent', accentColor, '#ffffff', borderColor, 'transparent']} start={{ x: 0.5, y: 1 }} end={{ x: 0.5, y: 0 }} style={styles.gradientFill} />
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
            >
              <View style={[styles.cornerBurstCore, { backgroundColor: accentColor }]} />
            </Animated.View>
          ))}
        </>
      ) : null}
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
    shadowOpacity: 0.32,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
  },
  glow: {
    position: 'absolute',
    borderWidth: 1,
    shadowOpacity: 0.44,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  edgeHorizontal: {
    position: 'absolute',
    borderRadius: 999,
    overflow: 'hidden',
  },
  edgeVertical: {
    position: 'absolute',
    borderRadius: 999,
    overflow: 'hidden',
  },
  horizontalComet: {
    position: 'absolute',
    borderRadius: 999,
    overflow: 'hidden',
    shadowOpacity: 0.6,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  verticalComet: {
    position: 'absolute',
    borderRadius: 999,
    overflow: 'hidden',
    shadowOpacity: 0.6,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  secondaryComet: {
    shadowOpacity: 0.75,
    shadowRadius: 12,
  },
  cornerBurst: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.9,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  cornerBurstCore: {
    width: 5,
    height: 5,
    borderRadius: 999,
    opacity: 0.95,
  },
  gradientFill: {
    flex: 1,
  },
});
