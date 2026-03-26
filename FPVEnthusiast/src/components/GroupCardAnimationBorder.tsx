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

function buildSegmentTranslate(anim: Animated.Value, segmentStart: number, distance: number, reverse = false) {
  const from = reverse ? distance : 0;
  const to = reverse ? 0 : distance;

  if (segmentStart === 0) {
    return anim.interpolate({
      inputRange: [0, 1, 4],
      outputRange: [from, to, to],
      extrapolate: 'clamp',
    });
  }

  return anim.interpolate({
    inputRange: [0, segmentStart, segmentStart + 1, 4],
    outputRange: [from, from, to, to],
    extrapolate: 'clamp',
  });
}

function buildSegmentOpacity(anim: Animated.Value, segmentStart: number, peakOpacity: number) {
  const fadeIn = segmentStart + 0.1;
  const fadeOut = segmentStart + 0.84;

  if (segmentStart === 0) {
    return anim.interpolate({
      inputRange: [0, fadeIn, fadeOut, 1, 4],
      outputRange: [0, peakOpacity, peakOpacity, 0, 0],
      extrapolate: 'clamp',
    });
  }

  return anim.interpolate({
    inputRange: [0, segmentStart, fadeIn, fadeOut, segmentStart + 1, 4],
    outputRange: [0, 0, peakOpacity, peakOpacity, 0, 0],
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
  const orbitAnim = useRef(new Animated.Value(0)).current;
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  const pulseLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const orbitLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const shimmerLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  const isBasic = variant === 'basic';
  const isStandard = variant === 'standard';
  const isPremium = variant === 'premium';

  const outerSpread = isPremium ? 34 : isStandard ? 8 : 3;
  const frameInset = Math.max(Math.round(cornerRadius * 0.72), 10);
  const verticalInset = Math.max(Math.round(cornerRadius * 0.82), 12);

  const basicTrackThickness = 4;
  const standardTrackThickness = 7;
  const standardLineThickness = 1.12;
  const premiumFrameThickness = 1.05;

  const horizontalTrackLength = Math.max(width - frameInset * 2, 44);
  const verticalTrackLength = Math.max(height - verticalInset * 2, 44);

  const basicCometWidth = clamp(horizontalTrackLength * 0.22, 48, 86);
  const standardHorizontalCometWidth = clamp(horizontalTrackLength * 0.16, 44, 70);
  const standardVerticalCometHeight = clamp(verticalTrackLength * 0.18, 42, 64);

  useEffect(() => {
    pulseLoopRef.current?.stop?.();
    orbitLoopRef.current?.stop?.();
    shimmerLoopRef.current?.stop?.();

    pulseAnim.stopAnimation();
    orbitAnim.stopAnimation();
    shimmerAnim.stopAnimation();

    if (!active || width < 40 || height < 40 || variant === 'none') {
      pulseAnim.setValue(0);
      orbitAnim.setValue(0);
      shimmerAnim.setValue(0);
      return;
    }

    pulseAnim.setValue(0);
    orbitAnim.setValue(0);
    shimmerAnim.setValue(0);

    pulseLoopRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: isPremium ? 4600 : isStandard ? 3000 : 2600,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: isPremium ? 4600 : isStandard ? 3000 : 2600,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );

    if (isBasic) {
      orbitLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(orbitAnim, {
            toValue: 1,
            duration: 4000,
            easing: Easing.inOut(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(orbitAnim, {
            toValue: 0,
            duration: 4000,
            easing: Easing.inOut(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),
      );
    } else if (isStandard) {
      orbitLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(orbitAnim, {
            toValue: 4,
            duration: 7600,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
          Animated.timing(orbitAnim, {
            toValue: 0,
            duration: 0,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
        ]),
      );
    }

    if (isPremium) {
      shimmerLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(shimmerAnim, {
            toValue: 1,
            duration: 6200,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(shimmerAnim, {
            toValue: 0,
            duration: 6200,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
      );
    }

    pulseLoopRef.current.start();
    orbitLoopRef.current?.start?.();
    shimmerLoopRef.current?.start?.();

    return () => {
      pulseLoopRef.current?.stop?.();
      orbitLoopRef.current?.stop?.();
      shimmerLoopRef.current?.stop?.();
      pulseAnim.stopAnimation();
      orbitAnim.stopAnimation();
      shimmerAnim.stopAnimation();
    };
  }, [active, height, isBasic, isPremium, isStandard, orbitAnim, pulseAnim, shimmerAnim, variant, width]);

  const basicRailOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.14, 0.24],
  });
  const basicSweepOpacity = pulseAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.45, 0.7, 0.5],
  });

  const standardRailOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.34, 0.56],
  });
  const standardGlowOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.08, 0.16],
  });

  const premiumFrameOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.78, 0.96],
  });
  const premiumOuterRingOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.18, 0.28],
  });
  const premiumNearRingOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.22, 0.34],
  });
  const premiumTopHaloOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.12, 0.2],
  });
  const premiumSideHaloOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.08, 0.14],
  });
  const premiumBottomHaloOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.05, 0.09],
  });
  const premiumCornerOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.18, 0.3],
  });
  const premiumTopHaloScale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.97, 1.04],
  });
  const premiumSideHaloScale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.98, 1.03],
  });
  const premiumCornerScale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.94, 1.08],
  });

  const premiumLeftGlintOpacity = shimmerAnim.interpolate({
    inputRange: [0, 0.1, 0.24, 0.42, 1],
    outputRange: [0.04, 0.08, 0.28, 0.06, 0.04],
    extrapolate: 'clamp',
  });
  const premiumRightGlintOpacity = shimmerAnim.interpolate({
    inputRange: [0, 0.48, 0.62, 0.8, 1],
    outputRange: [0.04, 0.04, 0.24, 0.06, 0.04],
    extrapolate: 'clamp',
  });
  const premiumLeftGlintScale = shimmerAnim.interpolate({
    inputRange: [0, 0.24, 1],
    outputRange: [0.92, 1.08, 0.92],
    extrapolate: 'clamp',
  });
  const premiumRightGlintScale = shimmerAnim.interpolate({
    inputRange: [0, 0.62, 1],
    outputRange: [0.92, 1.06, 0.92],
    extrapolate: 'clamp',
  });

  const basicTopX = orbitAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-basicCometWidth, horizontalTrackLength],
    extrapolate: 'clamp',
  });

  const topX = buildSegmentTranslate(orbitAnim, 0, horizontalTrackLength - standardHorizontalCometWidth, false);
  const rightY = buildSegmentTranslate(orbitAnim, 1, verticalTrackLength - standardVerticalCometHeight, false);
  const bottomX = buildSegmentTranslate(orbitAnim, 2, horizontalTrackLength - standardHorizontalCometWidth, true);
  const leftY = buildSegmentTranslate(orbitAnim, 3, verticalTrackLength - standardVerticalCometHeight, true);

  const topOpacity = buildSegmentOpacity(orbitAnim, 0, 0.82);
  const rightOpacity = buildSegmentOpacity(orbitAnim, 1, 0.82);
  const bottomOpacity = buildSegmentOpacity(orbitAnim, 2, 0.82);
  const leftOpacity = buildSegmentOpacity(orbitAnim, 3, 0.82);

  const dynamicStyles = useMemo(
    () => ({
      wrap: {
        top: -outerSpread,
        right: -outerSpread,
        bottom: -outerSpread,
        left: -outerSpread,
      },
      basicTopFrame: {
        top: outerSpread,
        left: outerSpread + frameInset,
        right: outerSpread + frameInset,
        height: 1,
      },
      basicTopTrack: {
        top: outerSpread - Math.round(basicTrackThickness / 2) + 1,
        left: outerSpread + frameInset,
        width: horizontalTrackLength,
        height: basicTrackThickness,
      },
      standardGlow: {
        top: outerSpread - 1,
        right: outerSpread - 1,
        bottom: outerSpread - 1,
        left: outerSpread - 1,
        borderRadius: cornerRadius + 3,
      },
      standardTopFrame: {
        top: outerSpread,
        left: outerSpread + frameInset,
        right: outerSpread + frameInset,
        height: standardLineThickness,
      },
      standardRightFrame: {
        top: outerSpread + verticalInset,
        bottom: outerSpread + verticalInset,
        right: outerSpread,
        width: standardLineThickness,
      },
      standardBottomFrame: {
        bottom: outerSpread,
        left: outerSpread + frameInset,
        right: outerSpread + frameInset,
        height: standardLineThickness,
      },
      standardLeftFrame: {
        top: outerSpread + verticalInset,
        bottom: outerSpread + verticalInset,
        left: outerSpread,
        width: standardLineThickness,
      },
      standardTopTrack: {
        top: outerSpread - Math.round(standardTrackThickness / 2) + 1,
        left: outerSpread + frameInset,
        width: horizontalTrackLength,
        height: standardTrackThickness,
      },
      standardRightTrack: {
        top: outerSpread + verticalInset,
        right: outerSpread - Math.round(standardTrackThickness / 2) + 1,
        width: standardTrackThickness,
        height: verticalTrackLength,
      },
      standardBottomTrack: {
        bottom: outerSpread - Math.round(standardTrackThickness / 2) + 1,
        left: outerSpread + frameInset,
        width: horizontalTrackLength,
        height: standardTrackThickness,
      },
      standardLeftTrack: {
        top: outerSpread + verticalInset,
        left: outerSpread - Math.round(standardTrackThickness / 2) + 1,
        width: standardTrackThickness,
        height: verticalTrackLength,
      },
      premiumOuterSoftRing: {
        top: outerSpread - 14,
        right: outerSpread - 14,
        bottom: outerSpread - 14,
        left: outerSpread - 14,
        borderRadius: cornerRadius + 16,
        borderWidth: 8,
      },
      premiumOuterNearRing: {
        top: outerSpread - 7,
        right: outerSpread - 7,
        bottom: outerSpread - 7,
        left: outerSpread - 7,
        borderRadius: cornerRadius + 9,
        borderWidth: 3,
      },
      premiumFrame: {
        top: outerSpread,
        right: outerSpread,
        bottom: outerSpread,
        left: outerSpread,
        borderRadius: cornerRadius + 1,
        borderWidth: premiumFrameThickness,
      },
      premiumTopHalo: {
        top: outerSpread - 24,
        left: outerSpread + frameInset - 8,
        right: outerSpread + frameInset - 8,
        height: 18,
      },
      premiumBottomHalo: {
        bottom: outerSpread - 22,
        left: outerSpread + frameInset + 8,
        right: outerSpread + frameInset + 8,
        height: 12,
      },
      premiumLeftHalo: {
        top: outerSpread + verticalInset + 2,
        bottom: outerSpread + verticalInset + 10,
        left: outerSpread - 18,
        width: 15,
      },
      premiumRightHalo: {
        top: outerSpread + verticalInset + 2,
        bottom: outerSpread + verticalInset + 10,
        right: outerSpread - 18,
        width: 15,
      },
      premiumCornerTopLeft: {
        top: outerSpread - 18,
        left: outerSpread - 18,
        width: 26,
        height: 26,
      },
      premiumCornerTopRight: {
        top: outerSpread - 18,
        right: outerSpread - 18,
        width: 26,
        height: 26,
      },
      premiumCornerBottomLeft: {
        bottom: outerSpread - 18,
        left: outerSpread - 18,
        width: 22,
        height: 22,
      },
      premiumCornerBottomRight: {
        bottom: outerSpread - 18,
        right: outerSpread - 18,
        width: 22,
        height: 22,
      },
      premiumTopLeftGlint: {
        top: outerSpread - 1,
        left: outerSpread + frameInset + 6,
        width: 34,
        height: 1.6,
      },
      premiumTopRightGlint: {
        top: outerSpread - 1,
        right: outerSpread + frameInset + 6,
        width: 30,
        height: 1.6,
      },
      premiumCornerTopLeftH: {
        top: outerSpread,
        left: outerSpread + 10,
        width: 16,
        height: 1,
      },
      premiumCornerTopLeftV: {
        top: outerSpread + 10,
        left: outerSpread,
        width: 1,
        height: 16,
      },
      premiumCornerTopRightH: {
        top: outerSpread,
        right: outerSpread + 10,
        width: 16,
        height: 1,
      },
      premiumCornerTopRightV: {
        top: outerSpread + 10,
        right: outerSpread,
        width: 1,
        height: 16,
      },
      premiumCornerBottomLeftH: {
        bottom: outerSpread,
        left: outerSpread + 10,
        width: 12,
        height: 1,
      },
      premiumCornerBottomLeftV: {
        bottom: outerSpread + 10,
        left: outerSpread,
        width: 1,
        height: 12,
      },
      premiumCornerBottomRightH: {
        bottom: outerSpread,
        right: outerSpread + 10,
        width: 12,
        height: 1,
      },
      premiumCornerBottomRightV: {
        bottom: outerSpread + 10,
        right: outerSpread,
        width: 1,
        height: 12,
      },
    }),
    [
      basicTrackThickness,
      cornerRadius,
      frameInset,
      horizontalTrackLength,
      outerSpread,
      premiumFrameThickness,
      standardLineThickness,
      standardTrackThickness,
      verticalInset,
      verticalTrackLength,
    ],
  );

  if (isPremium) {
    return (
      <Animated.View pointerEvents="none" style={[styles.wrap, dynamicStyles.wrap]}>
        <Animated.View
          style={[
            styles.premiumGlowBlobHorizontal,
            dynamicStyles.premiumTopHalo,
            {
              backgroundColor: accentColor,
              opacity: premiumTopHaloOpacity,
              transform: [{ scaleX: premiumTopHaloScale }],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.premiumGlowBlobHorizontal,
            dynamicStyles.premiumBottomHalo,
            {
              backgroundColor: accentColor,
              opacity: premiumBottomHaloOpacity,
              transform: [{ scaleX: premiumSideHaloScale }],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.premiumGlowBlobVertical,
            dynamicStyles.premiumLeftHalo,
            {
              backgroundColor: accentColor,
              opacity: premiumSideHaloOpacity,
              transform: [{ scaleY: premiumSideHaloScale }],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.premiumGlowBlobVertical,
            dynamicStyles.premiumRightHalo,
            {
              backgroundColor: accentColor,
              opacity: premiumSideHaloOpacity,
              transform: [{ scaleY: premiumSideHaloScale }],
            },
          ]}
        />

        <Animated.View
          style={[
            styles.premiumCornerGlow,
            dynamicStyles.premiumCornerTopLeft,
            {
              backgroundColor: accentColor,
              opacity: premiumCornerOpacity,
              transform: [{ scale: premiumCornerScale }],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.premiumCornerGlow,
            dynamicStyles.premiumCornerTopRight,
            {
              backgroundColor: accentColor,
              opacity: premiumCornerOpacity,
              transform: [{ scale: premiumCornerScale }],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.premiumCornerGlow,
            dynamicStyles.premiumCornerBottomLeft,
            {
              backgroundColor: accentColor,
              opacity: premiumBottomHaloOpacity,
              transform: [{ scale: premiumCornerScale }],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.premiumCornerGlow,
            dynamicStyles.premiumCornerBottomRight,
            {
              backgroundColor: accentColor,
              opacity: premiumBottomHaloOpacity,
              transform: [{ scale: premiumCornerScale }],
            },
          ]}
        />

        <Animated.View
          style={[
            styles.premiumAuraRing,
            dynamicStyles.premiumOuterSoftRing,
            {
              borderColor: accentColor,
              opacity: premiumOuterRingOpacity,
            },
          ]}
        />
        <Animated.View
          style={[
            styles.premiumAuraRing,
            dynamicStyles.premiumOuterNearRing,
            {
              borderColor: accentColor,
              opacity: premiumNearRingOpacity,
            },
          ]}
        />

        <Animated.View
          style={[
            styles.premiumFrame,
            dynamicStyles.premiumFrame,
            {
              borderColor: borderColor,
              opacity: premiumFrameOpacity,
            },
          ]}
        />

        <Animated.View
          style={[
            styles.premiumGlint,
            dynamicStyles.premiumTopLeftGlint,
            {
              opacity: premiumLeftGlintOpacity,
              transform: [{ scaleX: premiumLeftGlintScale }],
            },
          ]}
        >
          <LinearGradient colors={['transparent', accentColor, '#fff4c2', accentColor, 'transparent']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.fill} />
        </Animated.View>
        <Animated.View
          style={[
            styles.premiumGlint,
            dynamicStyles.premiumTopRightGlint,
            {
              opacity: premiumRightGlintOpacity,
              transform: [{ scaleX: premiumRightGlintScale }],
            },
          ]}
        >
          <LinearGradient colors={['transparent', accentColor, '#fff4c2', accentColor, 'transparent']} start={{ x: 1, y: 0.5 }} end={{ x: 0, y: 0.5 }} style={styles.fill} />
        </Animated.View>

        <Animated.View style={[styles.cornerAccentHorizontal, dynamicStyles.premiumCornerTopLeftH, { opacity: premiumFrameOpacity }]} />
        <Animated.View style={[styles.cornerAccentVertical, dynamicStyles.premiumCornerTopLeftV, { opacity: premiumFrameOpacity }]} />
        <Animated.View style={[styles.cornerAccentHorizontal, dynamicStyles.premiumCornerTopRightH, { opacity: premiumFrameOpacity }]} />
        <Animated.View style={[styles.cornerAccentVertical, dynamicStyles.premiumCornerTopRightV, { opacity: premiumFrameOpacity }]} />
        <Animated.View style={[styles.cornerAccentHorizontal, dynamicStyles.premiumCornerBottomLeftH, { opacity: premiumCornerOpacity }]} />
        <Animated.View style={[styles.cornerAccentVertical, dynamicStyles.premiumCornerBottomLeftV, { opacity: premiumCornerOpacity }]} />
        <Animated.View style={[styles.cornerAccentHorizontal, dynamicStyles.premiumCornerBottomRightH, { opacity: premiumCornerOpacity }]} />
        <Animated.View style={[styles.cornerAccentVertical, dynamicStyles.premiumCornerBottomRightV, { opacity: premiumCornerOpacity }]} />
      </Animated.View>
    );
  }

  if (isBasic) {
    return (
      <Animated.View pointerEvents="none" style={[styles.wrap, dynamicStyles.wrap]}>
        <Animated.View style={[styles.basicTopFrame, dynamicStyles.basicTopFrame, { opacity: basicRailOpacity, backgroundColor: borderColor }]} />
        <View style={[styles.basicTopTrack, dynamicStyles.basicTopTrack]}>
          <Animated.View
            style={[
              styles.horizontalComet,
              {
                width: basicCometWidth,
                height: 1.8,
                opacity: basicSweepOpacity,
                shadowColor: accentColor,
                transform: [{ translateX: basicTopX }],
              },
            ]}
          >
            <LinearGradient colors={['transparent', accentColor, '#ffffff', accentColor, 'transparent']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.fill} />
          </Animated.View>
        </View>
      </Animated.View>
    );
  }

  return (
    <Animated.View pointerEvents="none" style={[styles.wrap, dynamicStyles.wrap]}>
      <Animated.View
        style={[
          styles.standardGlow,
          dynamicStyles.standardGlow,
          {
            borderColor: borderColor,
            shadowColor: accentColor,
            opacity: standardGlowOpacity,
          },
        ]}
      />

      <Animated.View style={[styles.frameHorizontal, dynamicStyles.standardTopFrame, { opacity: standardRailOpacity }]}>
        <LinearGradient colors={[accentColor, '#ffffff', borderColor, accentColor]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.fill} />
      </Animated.View>
      <Animated.View style={[styles.frameVertical, dynamicStyles.standardRightFrame, { opacity: standardRailOpacity }]}>
        <LinearGradient colors={[accentColor, '#ffffff', borderColor, accentColor]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={styles.fill} />
      </Animated.View>
      <Animated.View style={[styles.frameHorizontal, dynamicStyles.standardBottomFrame, { opacity: standardRailOpacity }]}>
        <LinearGradient colors={[accentColor, borderColor, '#ffffff', accentColor]} start={{ x: 1, y: 0.5 }} end={{ x: 0, y: 0.5 }} style={styles.fill} />
      </Animated.View>
      <Animated.View style={[styles.frameVertical, dynamicStyles.standardLeftFrame, { opacity: standardRailOpacity }]}>
        <LinearGradient colors={[accentColor, '#ffffff', borderColor, accentColor]} start={{ x: 0.5, y: 1 }} end={{ x: 0.5, y: 0 }} style={styles.fill} />
      </Animated.View>

      <View style={[styles.standardTrack, dynamicStyles.standardTopTrack]}>
        <Animated.View
          style={[
            styles.horizontalComet,
            {
              width: standardHorizontalCometWidth,
              height: 2.1,
              opacity: topOpacity,
              shadowColor: accentColor,
              transform: [{ translateX: topX }],
            },
          ]}
        >
          <LinearGradient colors={['transparent', accentColor, '#ffffff', accentColor, 'transparent']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.fill} />
        </Animated.View>
      </View>
      <View style={[styles.standardVerticalTrack, dynamicStyles.standardRightTrack]}>
        <Animated.View
          style={[
            styles.verticalComet,
            {
              width: 2.1,
              height: standardVerticalCometHeight,
              opacity: rightOpacity,
              shadowColor: accentColor,
              transform: [{ translateY: rightY }],
            },
          ]}
        >
          <LinearGradient colors={['transparent', accentColor, '#ffffff', accentColor, 'transparent']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={styles.fill} />
        </Animated.View>
      </View>
      <View style={[styles.standardTrack, dynamicStyles.standardBottomTrack]}>
        <Animated.View
          style={[
            styles.horizontalComet,
            {
              width: standardHorizontalCometWidth,
              height: 2.1,
              opacity: bottomOpacity,
              shadowColor: accentColor,
              transform: [{ translateX: bottomX }],
            },
          ]}
        >
          <LinearGradient colors={['transparent', accentColor, '#ffffff', accentColor, 'transparent']} start={{ x: 1, y: 0.5 }} end={{ x: 0, y: 0.5 }} style={styles.fill} />
        </Animated.View>
      </View>
      <View style={[styles.standardVerticalTrack, dynamicStyles.standardLeftTrack]}>
        <Animated.View
          style={[
            styles.verticalComet,
            {
              width: 2.1,
              height: standardVerticalCometHeight,
              opacity: leftOpacity,
              shadowColor: accentColor,
              transform: [{ translateY: leftY }],
            },
          ]}
        >
          <LinearGradient colors={['transparent', accentColor, '#ffffff', accentColor, 'transparent']} start={{ x: 0.5, y: 1 }} end={{ x: 0.5, y: 0 }} style={styles.fill} />
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    zIndex: 12,
  },
  basicTopFrame: {
    position: 'absolute',
    borderRadius: 999,
  },
  basicTopTrack: {
    position: 'absolute',
    overflow: 'hidden',
    borderRadius: 999,
    justifyContent: 'center',
  },
  standardGlow: {
    position: 'absolute',
    borderWidth: 1,
    shadowOpacity: 0.34,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
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
  standardTrack: {
    position: 'absolute',
    overflow: 'hidden',
    borderRadius: 999,
    justifyContent: 'center',
  },
  standardVerticalTrack: {
    position: 'absolute',
    overflow: 'hidden',
    borderRadius: 999,
    alignItems: 'center',
  },
  horizontalComet: {
    position: 'absolute',
    left: 0,
    borderRadius: 999,
    overflow: 'hidden',
    shadowOpacity: 0.88,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  verticalComet: {
    position: 'absolute',
    top: 0,
    borderRadius: 999,
    overflow: 'hidden',
    shadowOpacity: 0.88,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  premiumGlowBlobHorizontal: {
    position: 'absolute',
    borderRadius: 999,
    shadowOpacity: 0.42,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 0 },
    elevation: 16,
  },
  premiumGlowBlobVertical: {
    position: 'absolute',
    borderRadius: 999,
    shadowOpacity: 0.34,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 0 },
    elevation: 14,
  },
  premiumCornerGlow: {
    position: 'absolute',
    borderRadius: 999,
    shadowOpacity: 0.5,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 0 },
    elevation: 16,
  },
  premiumAuraRing: {
    position: 'absolute',
    shadowOpacity: 0.22,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  premiumFrame: {
    position: 'absolute',
  },
  premiumGlint: {
    position: 'absolute',
    borderRadius: 999,
    overflow: 'hidden',
    shadowOpacity: 0.62,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  cornerAccentHorizontal: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: '#ffd76a',
    shadowOpacity: 0.42,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  cornerAccentVertical: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: '#ffd76a',
    shadowOpacity: 0.42,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  fill: {
    flex: 1,
  },
});
