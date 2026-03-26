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

type DustSpec = {
  key: string;
  size: number;
  style: {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  };
  opacityRange: [number, number];
  scaleRange: [number, number];
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function buildEdgeTravel(anim: Animated.Value, segmentStart: number, maxTravel: number, reverse = false) {
  const from = reverse ? maxTravel : 0;
  const to = reverse ? 0 : maxTravel;

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

function buildEdgeOpacity(anim: Animated.Value, segmentStart: number, maxOpacity: number) {
  const fadeIn = segmentStart + 0.08;
  const fadeOut = segmentStart + 0.9;

  if (segmentStart === 0) {
    return anim.interpolate({
      inputRange: [0, fadeIn, fadeOut, 1, 4],
      outputRange: [0, maxOpacity, maxOpacity, 0, 0],
      extrapolate: 'clamp',
    });
  }

  return anim.interpolate({
    inputRange: [0, segmentStart, fadeIn, fadeOut, segmentStart + 1, 4],
    outputRange: [0, 0, maxOpacity, maxOpacity, 0, 0],
    extrapolate: 'clamp',
  });
}

function buildCornerOpacity(anim: Animated.Value, cornerIndex: 0 | 1 | 2 | 3, peakOpacity: number) {
  const cornerRanges = {
    0: [0, 0.08, 0.2, 3.82, 3.94, 4],
    1: [0, 0.92, 1.04, 1.18, 4],
    2: [0, 1.92, 2.04, 2.18, 4],
    3: [0, 2.92, 3.04, 3.18, 4],
  } as const;

  const inputRange = cornerRanges[cornerIndex];
  const outputRange =
    cornerIndex === 0
      ? [peakOpacity, peakOpacity, 0.16 * peakOpacity, 0.16 * peakOpacity, peakOpacity, peakOpacity]
      : [0, 0, peakOpacity, 0.16 * peakOpacity, 0];

  return anim.interpolate({
    inputRange,
    outputRange,
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
  const secondaryTravelAnim = useRef(new Animated.Value(0)).current;

  const pulseLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const travelLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const secondaryTravelLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  const isBasic = variant === 'basic';
  const isStandard = variant === 'standard';
  const isPremium = variant === 'premium';

  const outerSpread = isPremium ? 12 : isStandard ? 7 : 4;
  const frameInset = Math.max(Math.round(cornerRadius * 0.68), 10);
  const verticalInset = Math.max(Math.round(cornerRadius * 0.8), 12);

  const lineThickness = isPremium ? 1.5 : isStandard ? 1.18 : 1;
  const outerLineThickness = isPremium ? 1 : 0;
  const trackThickness = isPremium ? 9 : isStandard ? 7 : 5;
  const primaryCometThickness = isPremium ? 2.8 : isStandard ? 2.2 : 1.7;
  const secondaryCometThickness = isPremium ? 1.5 : 0;

  const horizontalTrackLength = Math.max(width - frameInset * 2, 40);
  const verticalTrackLength = Math.max(height - verticalInset * 2, 40);

  const primaryHorizontalCometWidth = clamp(horizontalTrackLength * (isPremium ? 0.18 : isStandard ? 0.16 : 0.13), 36, isPremium ? 72 : isStandard ? 56 : 46);
  const primaryVerticalCometHeight = clamp(verticalTrackLength * (isPremium ? 0.19 : isStandard ? 0.17 : 0.14), 34, isPremium ? 74 : isStandard ? 58 : 46);
  const secondaryHorizontalCometWidth = clamp(horizontalTrackLength * 0.11, 22, 38);
  const secondaryVerticalCometHeight = clamp(verticalTrackLength * 0.12, 18, 34);

  useEffect(() => {
    pulseLoopRef.current?.stop?.();
    travelLoopRef.current?.stop?.();
    secondaryTravelLoopRef.current?.stop?.();

    pulseAnim.stopAnimation();
    travelAnim.stopAnimation();
    secondaryTravelAnim.stopAnimation();

    if (!active || width < 40 || height < 40 || variant === 'none') {
      pulseAnim.setValue(0);
      travelAnim.setValue(0);
      secondaryTravelAnim.setValue(0);
      return;
    }

    pulseAnim.setValue(0);
    travelAnim.setValue(0);
    secondaryTravelAnim.setValue(0);

    pulseLoopRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: isPremium ? 2400 : isStandard ? 2800 : 3200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: isPremium ? 2400 : isStandard ? 2800 : 3200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );

    travelLoopRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(travelAnim, {
          toValue: 4,
          duration: isPremium ? 5600 : isStandard ? 6600 : 7200,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(travelAnim, {
          toValue: 0,
          duration: 0,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ]),
    );

    if (isPremium) {
      secondaryTravelLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.delay(1500),
          Animated.timing(secondaryTravelAnim, {
            toValue: 4,
            duration: 6600,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
          Animated.timing(secondaryTravelAnim, {
            toValue: 0,
            duration: 0,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
        ]),
      );
    }

    pulseLoopRef.current.start();
    travelLoopRef.current.start();
    secondaryTravelLoopRef.current?.start?.();

    return () => {
      pulseLoopRef.current?.stop?.();
      travelLoopRef.current?.stop?.();
      secondaryTravelLoopRef.current?.stop?.();
      pulseAnim.stopAnimation();
      travelAnim.stopAnimation();
      secondaryTravelAnim.stopAnimation();
    };
  }, [active, height, isPremium, isStandard, pulseAnim, secondaryTravelAnim, travelAnim, variant, width]);

  const frameOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: isPremium ? [0.78, 1] : isStandard ? [0.44, 0.74] : [0.26, 0.44],
  });
  const outerFrameOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: isPremium ? [0.3, 0.52] : [0, 0],
  });
  const auraOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: isPremium ? [0.24, 0.5] : isStandard ? [0.08, 0.16] : [0.02, 0.05],
  });
  const glowOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: isPremium ? [0.34, 0.72] : isStandard ? [0.14, 0.26] : [0.04, 0.1],
  });
  const auraScale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: isPremium ? [0.996, 1.022] : isStandard ? [0.998, 1.008] : [1, 1.003],
  });

  const primaryOpacityValue = isPremium ? 0.98 : isStandard ? 0.82 : 0.62;
  const secondaryOpacityValue = isPremium ? 0.6 : 0;

  const topPrimaryX = buildEdgeTravel(travelAnim, 0, horizontalTrackLength - primaryHorizontalCometWidth, false);
  const rightPrimaryY = buildEdgeTravel(travelAnim, 1, verticalTrackLength - primaryVerticalCometHeight, false);
  const bottomPrimaryX = buildEdgeTravel(travelAnim, 2, horizontalTrackLength - primaryHorizontalCometWidth, true);
  const leftPrimaryY = buildEdgeTravel(travelAnim, 3, verticalTrackLength - primaryVerticalCometHeight, true);

  const topPrimaryOpacity = buildEdgeOpacity(travelAnim, 0, primaryOpacityValue);
  const rightPrimaryOpacity = buildEdgeOpacity(travelAnim, 1, primaryOpacityValue);
  const bottomPrimaryOpacity = buildEdgeOpacity(travelAnim, 2, primaryOpacityValue);
  const leftPrimaryOpacity = buildEdgeOpacity(travelAnim, 3, primaryOpacityValue);

  const topSecondaryX = buildEdgeTravel(secondaryTravelAnim, 0, horizontalTrackLength - secondaryHorizontalCometWidth, false);
  const rightSecondaryY = buildEdgeTravel(secondaryTravelAnim, 1, verticalTrackLength - secondaryVerticalCometHeight, false);
  const bottomSecondaryX = buildEdgeTravel(secondaryTravelAnim, 2, horizontalTrackLength - secondaryHorizontalCometWidth, true);
  const leftSecondaryY = buildEdgeTravel(secondaryTravelAnim, 3, verticalTrackLength - secondaryVerticalCometHeight, true);

  const topSecondaryOpacity = buildEdgeOpacity(secondaryTravelAnim, 0, secondaryOpacityValue);
  const rightSecondaryOpacity = buildEdgeOpacity(secondaryTravelAnim, 1, secondaryOpacityValue);
  const bottomSecondaryOpacity = buildEdgeOpacity(secondaryTravelAnim, 2, secondaryOpacityValue);
  const leftSecondaryOpacity = buildEdgeOpacity(secondaryTravelAnim, 3, secondaryOpacityValue);

  const cornerTopLeftOpacity = isPremium ? buildCornerOpacity(travelAnim, 0, 0.9) : pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.06, 0.12] });
  const cornerTopRightOpacity = isPremium ? buildCornerOpacity(travelAnim, 1, 0.84) : pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.04, 0.08] });
  const cornerBottomRightOpacity = isPremium ? buildCornerOpacity(travelAnim, 2, 0.84) : pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.04, 0.08] });
  const cornerBottomLeftOpacity = isPremium ? buildCornerOpacity(travelAnim, 3, 0.84) : pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.04, 0.08] });

  const premiumDust = useMemo<DustSpec[]>(() => {
    if (!isPremium) return [];
    return [
      { key: 'd1', size: 3, style: { top: outerSpread - 5, left: outerSpread + 28 }, opacityRange: [0.06, 0.2], scaleRange: [0.92, 1.16] },
      { key: 'd2', size: 4, style: { top: outerSpread + 10, right: outerSpread + 2 }, opacityRange: [0.08, 0.24], scaleRange: [0.88, 1.2] },
      { key: 'd3', size: 2, style: { top: outerSpread + 44, left: outerSpread - 2 }, opacityRange: [0.04, 0.14], scaleRange: [0.96, 1.08] },
      { key: 'd4', size: 3, style: { bottom: outerSpread - 5, right: outerSpread + 32 }, opacityRange: [0.06, 0.18], scaleRange: [0.9, 1.12] },
      { key: 'd5', size: 2, style: { bottom: outerSpread + 12, left: outerSpread + 10 }, opacityRange: [0.03, 0.1], scaleRange: [0.98, 1.08] },
      { key: 'd6', size: 2, style: { top: outerSpread - 1, right: outerSpread + 42 }, opacityRange: [0.03, 0.12], scaleRange: [0.96, 1.1] },
    ];
  }, [isPremium, outerSpread]);

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
        borderRadius: cornerRadius + 5,
      },
      glow: {
        top: outerSpread,
        right: outerSpread,
        bottom: outerSpread,
        left: outerSpread,
        borderRadius: cornerRadius + 2,
      },
      outerFrameTop: {
        top: outerSpread - 3,
        left: outerSpread + frameInset - 2,
        right: outerSpread + frameInset - 2,
        height: outerLineThickness,
      },
      outerFrameBottom: {
        bottom: outerSpread - 3,
        left: outerSpread + frameInset - 2,
        right: outerSpread + frameInset - 2,
        height: outerLineThickness,
      },
      outerFrameLeft: {
        top: outerSpread + verticalInset - 1,
        bottom: outerSpread + verticalInset - 1,
        left: outerSpread - 3,
        width: outerLineThickness,
      },
      outerFrameRight: {
        top: outerSpread + verticalInset - 1,
        bottom: outerSpread + verticalInset - 1,
        right: outerSpread - 3,
        width: outerLineThickness,
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
      topTrack: {
        top: outerSpread - Math.round(trackThickness / 2) + 1,
        left: outerSpread + frameInset,
        width: horizontalTrackLength,
        height: trackThickness,
      },
      bottomTrack: {
        bottom: outerSpread - Math.round(trackThickness / 2) + 1,
        left: outerSpread + frameInset,
        width: horizontalTrackLength,
        height: trackThickness,
      },
      leftTrack: {
        top: outerSpread + verticalInset,
        left: outerSpread - Math.round(trackThickness / 2) + 1,
        width: trackThickness,
        height: verticalTrackLength,
      },
      rightTrack: {
        top: outerSpread + verticalInset,
        right: outerSpread - Math.round(trackThickness / 2) + 1,
        width: trackThickness,
        height: verticalTrackLength,
      },
      cornerTopLeft: { top: outerSpread - 3, left: outerSpread - 3 },
      cornerTopRight: { top: outerSpread - 3, right: outerSpread - 3 },
      cornerBottomRight: { bottom: outerSpread - 3, right: outerSpread - 3 },
      cornerBottomLeft: { bottom: outerSpread - 3, left: outerSpread - 3 },
    }),
    [cornerRadius, frameInset, horizontalTrackLength, lineThickness, outerLineThickness, outerSpread, trackThickness, verticalInset, verticalTrackLength],
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
            opacity: glowOpacity,
            transform: [{ scale: auraScale }],
          },
        ]}
      />

      {isPremium ? (
        <>
          <Animated.View style={[styles.frameHorizontal, dynamicStyles.outerFrameTop, { opacity: outerFrameOpacity }]}>
            <LinearGradient colors={[accentColor, '#ffffff', accentColor]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.fill} />
          </Animated.View>
          <Animated.View style={[styles.frameHorizontal, dynamicStyles.outerFrameBottom, { opacity: outerFrameOpacity }]}>
            <LinearGradient colors={[accentColor, '#ffffff', accentColor]} start={{ x: 1, y: 0.5 }} end={{ x: 0, y: 0.5 }} style={styles.fill} />
          </Animated.View>
          <Animated.View style={[styles.frameVertical, dynamicStyles.outerFrameLeft, { opacity: outerFrameOpacity }]}>
            <LinearGradient colors={[accentColor, '#ffffff', accentColor]} start={{ x: 0.5, y: 1 }} end={{ x: 0.5, y: 0 }} style={styles.fill} />
          </Animated.View>
          <Animated.View style={[styles.frameVertical, dynamicStyles.outerFrameRight, { opacity: outerFrameOpacity }]}>
            <LinearGradient colors={[accentColor, '#ffffff', accentColor]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={styles.fill} />
          </Animated.View>
        </>
      ) : null}

      <Animated.View style={[styles.frameHorizontal, dynamicStyles.frameTop, { opacity: frameOpacity }]}>
        <LinearGradient colors={[accentColor, '#ffffff', borderColor, accentColor]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.fill} />
      </Animated.View>
      <Animated.View style={[styles.frameHorizontal, dynamicStyles.frameBottom, { opacity: frameOpacity }]}>
        <LinearGradient colors={[accentColor, borderColor, '#ffffff', accentColor]} start={{ x: 1, y: 0.5 }} end={{ x: 0, y: 0.5 }} style={styles.fill} />
      </Animated.View>
      <Animated.View style={[styles.frameVertical, dynamicStyles.frameLeft, { opacity: frameOpacity }]}>
        <LinearGradient colors={[accentColor, '#ffffff', borderColor, accentColor]} start={{ x: 0.5, y: 1 }} end={{ x: 0.5, y: 0 }} style={styles.fill} />
      </Animated.View>
      <Animated.View style={[styles.frameVertical, dynamicStyles.frameRight, { opacity: frameOpacity }]}>
        <LinearGradient colors={[accentColor, '#ffffff', borderColor, accentColor]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={styles.fill} />
      </Animated.View>

      <View style={[styles.horizontalTrack, dynamicStyles.topTrack]}>
        <Animated.View
          style={[
            styles.primaryHorizontalComet,
            {
              width: primaryHorizontalCometWidth,
              height: primaryCometThickness,
              opacity: topPrimaryOpacity,
              shadowColor: accentColor,
              transform: [{ translateX: topPrimaryX }],
            },
          ]}
        >
          <LinearGradient colors={['transparent', accentColor, '#ffffff', accentColor, 'transparent']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.fill} />
        </Animated.View>
        {isPremium ? (
          <Animated.View
            style={[
              styles.secondaryHorizontalComet,
              {
                width: secondaryHorizontalCometWidth,
                height: secondaryCometThickness,
                opacity: topSecondaryOpacity,
                shadowColor: accentColor,
                transform: [{ translateX: topSecondaryX }],
              },
            ]}
          >
            <LinearGradient colors={['transparent', borderColor, '#ffffff', accentColor, 'transparent']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.fill} />
          </Animated.View>
        ) : null}
      </View>

      {!isBasic ? (
        <View style={[styles.rightTrack, dynamicStyles.rightTrack]}>
          <Animated.View
            style={[
              styles.primaryVerticalComet,
              {
                width: primaryCometThickness,
                height: primaryVerticalCometHeight,
                opacity: rightPrimaryOpacity,
                shadowColor: accentColor,
                transform: [{ translateY: rightPrimaryY }],
              },
            ]}
          >
            <LinearGradient colors={['transparent', accentColor, '#ffffff', accentColor, 'transparent']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={styles.fill} />
          </Animated.View>
          {isPremium ? (
            <Animated.View
              style={[
                styles.secondaryVerticalComet,
                {
                  width: secondaryCometThickness,
                  height: secondaryVerticalCometHeight,
                  opacity: rightSecondaryOpacity,
                  shadowColor: accentColor,
                  transform: [{ translateY: rightSecondaryY }],
                },
              ]}
            >
              <LinearGradient colors={['transparent', borderColor, '#ffffff', accentColor, 'transparent']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={styles.fill} />
            </Animated.View>
          ) : null}
        </View>
      ) : null}

      {!isBasic ? (
        <View style={[styles.horizontalTrack, dynamicStyles.bottomTrack]}>
          <Animated.View
            style={[
              styles.primaryHorizontalComet,
              {
                width: primaryHorizontalCometWidth,
                height: primaryCometThickness,
                opacity: bottomPrimaryOpacity,
                shadowColor: accentColor,
                transform: [{ translateX: bottomPrimaryX }],
              },
            ]}
          >
            <LinearGradient colors={['transparent', accentColor, '#ffffff', accentColor, 'transparent']} start={{ x: 1, y: 0.5 }} end={{ x: 0, y: 0.5 }} style={styles.fill} />
          </Animated.View>
          {isPremium ? (
            <Animated.View
              style={[
                styles.secondaryHorizontalComet,
                {
                  width: secondaryHorizontalCometWidth,
                  height: secondaryCometThickness,
                  opacity: bottomSecondaryOpacity,
                  shadowColor: accentColor,
                  transform: [{ translateX: bottomSecondaryX }],
                },
              ]}
            >
              <LinearGradient colors={['transparent', accentColor, '#ffffff', borderColor, 'transparent']} start={{ x: 1, y: 0.5 }} end={{ x: 0, y: 0.5 }} style={styles.fill} />
            </Animated.View>
          ) : null}
        </View>
      ) : null}

      {!isBasic ? (
        <View style={[styles.leftTrack, dynamicStyles.leftTrack]}>
          <Animated.View
            style={[
              styles.primaryVerticalComet,
              {
                width: primaryCometThickness,
                height: primaryVerticalCometHeight,
                opacity: leftPrimaryOpacity,
                shadowColor: accentColor,
                transform: [{ translateY: leftPrimaryY }],
              },
            ]}
          >
            <LinearGradient colors={['transparent', accentColor, '#ffffff', accentColor, 'transparent']} start={{ x: 0.5, y: 1 }} end={{ x: 0.5, y: 0 }} style={styles.fill} />
          </Animated.View>
          {isPremium ? (
            <Animated.View
              style={[
                styles.secondaryVerticalComet,
                {
                  width: secondaryCometThickness,
                  height: secondaryVerticalCometHeight,
                  opacity: leftSecondaryOpacity,
                  shadowColor: accentColor,
                  transform: [{ translateY: leftSecondaryY }],
                },
              ]}
            >
              <LinearGradient colors={['transparent', accentColor, '#ffffff', borderColor, 'transparent']} start={{ x: 0.5, y: 1 }} end={{ x: 0.5, y: 0 }} style={styles.fill} />
            </Animated.View>
          ) : null}
        </View>
      ) : null}

      <Animated.View
        style={[
          styles.cornerGem,
          dynamicStyles.cornerTopLeft,
          {
            opacity: cornerTopLeftOpacity,
            shadowColor: accentColor,
            transform: [{ scale: isPremium ? auraScale : 1 }],
          },
        ]}
      >
        <View style={[styles.cornerGemCore, { backgroundColor: '#ffffff' }]} />
      </Animated.View>
      <Animated.View
        style={[
          styles.cornerGem,
          dynamicStyles.cornerTopRight,
          {
            opacity: cornerTopRightOpacity,
            shadowColor: accentColor,
            transform: [{ scale: isPremium ? auraScale : 1 }],
          },
        ]}
      >
        <View style={[styles.cornerGemCore, { backgroundColor: accentColor }]} />
      </Animated.View>
      <Animated.View
        style={[
          styles.cornerGem,
          dynamicStyles.cornerBottomRight,
          {
            opacity: cornerBottomRightOpacity,
            shadowColor: accentColor,
            transform: [{ scale: isPremium ? auraScale : 1 }],
          },
        ]}
      >
        <View style={[styles.cornerGemCore, { backgroundColor: '#ffffff' }]} />
      </Animated.View>
      <Animated.View
        style={[
          styles.cornerGem,
          dynamicStyles.cornerBottomLeft,
          {
            opacity: cornerBottomLeftOpacity,
            shadowColor: accentColor,
            transform: [{ scale: isPremium ? auraScale : 1 }],
          },
        ]}
      >
        <View style={[styles.cornerGemCore, { backgroundColor: accentColor }]} />
      </Animated.View>

      {isPremium
        ? premiumDust.map((dust, index) => {
            const opacity = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: dust.opacityRange });
            const scale = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: dust.scaleRange });
            return (
              <Animated.View
                key={dust.key}
                style={[
                  styles.dust,
                  dust.style,
                  {
                    width: dust.size,
                    height: dust.size,
                    borderRadius: dust.size / 2,
                    backgroundColor: index % 2 === 0 ? accentColor : '#ffffff',
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
    shadowOpacity: 0.34,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 0 },
  },
  glow: {
    position: 'absolute',
    borderWidth: 1,
    shadowOpacity: 0.44,
    shadowRadius: 18,
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
  rightTrack: {
    position: 'absolute',
    overflow: 'hidden',
    borderRadius: 999,
    alignItems: 'center',
  },
  leftTrack: {
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
    shadowOpacity: 0.9,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  secondaryHorizontalComet: {
    position: 'absolute',
    left: 0,
    borderRadius: 999,
    overflow: 'hidden',
    shadowOpacity: 0.7,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  primaryVerticalComet: {
    position: 'absolute',
    top: 0,
    borderRadius: 999,
    overflow: 'hidden',
    shadowOpacity: 0.9,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  secondaryVerticalComet: {
    position: 'absolute',
    top: 0,
    borderRadius: 999,
    overflow: 'hidden',
    shadowOpacity: 0.7,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  cornerGem: {
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
  cornerGemCore: {
    width: 5,
    height: 5,
    borderRadius: 999,
    opacity: 0.98,
  },
  dust: {
    position: 'absolute',
    shadowOpacity: 0.72,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  fill: {
    flex: 1,
  },
});
