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
  const fadeIn = segmentStart + 0.08;
  const fadeOut = segmentStart + 0.88;

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

  const pulseLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const orbitLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  const isBasic = variant === 'basic';
  const isStandard = variant === 'standard';
  const isPremium = variant === 'premium';

  const outerSpread = isPremium ? 16 : isStandard ? 7 : 3;
  const frameInset = Math.max(Math.round(cornerRadius * 0.68), 10);
  const verticalInset = Math.max(Math.round(cornerRadius * 0.78), 12);

  const topLineThickness = isPremium ? 1.25 : isStandard ? 1.15 : 1;
  const sideLineThickness = isPremium ? 1.15 : 1.05;
  const trackThickness = isPremium ? 7 : isStandard ? 6 : 4;
  const cometThickness = isPremium ? 1.9 : isStandard ? 2.1 : 1.8;

  const horizontalTrackLength = Math.max(width - frameInset * 2, 40);
  const verticalTrackLength = Math.max(height - verticalInset * 2, 40);

  const basicCometWidth = clamp(horizontalTrackLength * 0.22, 46, 84);
  const standardHorizontalCometWidth = clamp(horizontalTrackLength * 0.16, 42, 68);
  const premiumHorizontalCometWidth = clamp(horizontalTrackLength * 0.12, 28, 52);
  const standardVerticalCometHeight = clamp(verticalTrackLength * 0.17, 40, 62);
  const premiumVerticalCometHeight = clamp(verticalTrackLength * 0.1, 22, 36);

  useEffect(() => {
    pulseLoopRef.current?.stop?.();
    orbitLoopRef.current?.stop?.();

    pulseAnim.stopAnimation();
    orbitAnim.stopAnimation();

    if (!active || width < 40 || height < 40 || variant === 'none') {
      pulseAnim.setValue(0);
      orbitAnim.setValue(0);
      return;
    }

    pulseAnim.setValue(0);
    orbitAnim.setValue(0);

    pulseLoopRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: isPremium ? 3600 : isStandard ? 2800 : 2600,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: isPremium ? 3600 : isStandard ? 2800 : 2600,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );

    orbitLoopRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(orbitAnim, {
          toValue: isBasic ? 1 : 4,
          duration: isPremium ? 9800 : isStandard ? 7000 : 4200,
          easing: isBasic ? Easing.inOut(Easing.cubic) : Easing.linear,
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

    pulseLoopRef.current.start();
    orbitLoopRef.current.start();

    return () => {
      pulseLoopRef.current?.stop?.();
      orbitLoopRef.current?.stop?.();
      pulseAnim.stopAnimation();
      orbitAnim.stopAnimation();
    };
  }, [active, height, isBasic, isPremium, isStandard, orbitAnim, pulseAnim, variant, width]);

  const basicRailOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.16, 0.28],
  });
  const standardRailOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.34, 0.56],
  });
  const standardGlowOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.08, 0.16],
  });
  const premiumOuterAuraOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.22, 0.36],
  });
  const premiumInnerAuraOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.18, 0.3],
  });
  const premiumRailOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.58, 0.72],
  });
  const premiumCornerOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.42, 0.68],
  });
  const premiumAuraScale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1.01, 1.03],
  });

  const basicTopX = orbitAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-basicCometWidth, horizontalTrackLength],
    extrapolate: 'clamp',
  });
  const basicTopOpacity = orbitAnim.interpolate({
    inputRange: [0, 0.12, 0.88, 1],
    outputRange: [0, 0.68, 0.68, 0],
    extrapolate: 'clamp',
  });

  const orbitHorizontalCometWidth = isPremium ? premiumHorizontalCometWidth : standardHorizontalCometWidth;
  const orbitVerticalCometHeight = isPremium ? premiumVerticalCometHeight : standardVerticalCometHeight;
  const orbitPeakOpacity = isPremium ? 0.18 : 0.82;

  const topX = buildSegmentTranslate(orbitAnim, 0, horizontalTrackLength - orbitHorizontalCometWidth, false);
  const rightY = buildSegmentTranslate(orbitAnim, 1, verticalTrackLength - orbitVerticalCometHeight, false);
  const bottomX = buildSegmentTranslate(orbitAnim, 2, horizontalTrackLength - orbitHorizontalCometWidth, true);
  const leftY = buildSegmentTranslate(orbitAnim, 3, verticalTrackLength - orbitVerticalCometHeight, true);

  const topOpacity = buildSegmentOpacity(orbitAnim, 0, orbitPeakOpacity);
  const rightOpacity = buildSegmentOpacity(orbitAnim, 1, orbitPeakOpacity);
  const bottomOpacity = buildSegmentOpacity(orbitAnim, 2, orbitPeakOpacity);
  const leftOpacity = buildSegmentOpacity(orbitAnim, 3, orbitPeakOpacity);

  const dynamicStyles = useMemo(
    () => ({
      wrap: {
        top: -outerSpread,
        right: -outerSpread,
        bottom: -outerSpread,
        left: -outerSpread,
      },
      premiumAuraOuter: {
        top: outerSpread - 12,
        right: outerSpread - 12,
        bottom: outerSpread - 12,
        left: outerSpread - 12,
        borderRadius: cornerRadius + 18,
      },
      premiumAuraInner: {
        top: outerSpread - 2,
        right: outerSpread - 2,
        bottom: outerSpread - 2,
        left: outerSpread - 2,
        borderRadius: cornerRadius + 6,
      },
      standardGlow: {
        top: outerSpread - 1,
        right: outerSpread - 1,
        bottom: outerSpread - 1,
        left: outerSpread - 1,
        borderRadius: cornerRadius + 3,
      },
      topFrame: {
        top: outerSpread,
        left: outerSpread + frameInset,
        right: outerSpread + frameInset,
        height: topLineThickness,
      },
      rightFrame: {
        top: outerSpread + verticalInset,
        bottom: outerSpread + verticalInset,
        right: outerSpread,
        width: sideLineThickness,
      },
      bottomFrame: {
        bottom: outerSpread,
        left: outerSpread + frameInset,
        right: outerSpread + frameInset,
        height: topLineThickness,
      },
      leftFrame: {
        top: outerSpread + verticalInset,
        bottom: outerSpread + verticalInset,
        left: outerSpread,
        width: sideLineThickness,
      },
      topTrack: {
        top: outerSpread - Math.round(trackThickness / 2) + 1,
        left: outerSpread + frameInset,
        width: horizontalTrackLength,
        height: trackThickness,
      },
      rightTrack: {
        top: outerSpread + verticalInset,
        right: outerSpread - Math.round(trackThickness / 2) + 1,
        width: trackThickness,
        height: verticalTrackLength,
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
      premiumCornerTopLeftH: {
        top: outerSpread - 1,
        left: outerSpread + 10,
        width: 16,
        height: 1.2,
      },
      premiumCornerTopLeftV: {
        top: outerSpread + 10,
        left: outerSpread - 1,
        width: 1.2,
        height: 16,
      },
      premiumCornerTopRightH: {
        top: outerSpread - 1,
        right: outerSpread + 10,
        width: 16,
        height: 1.2,
      },
      premiumCornerTopRightV: {
        top: outerSpread + 10,
        right: outerSpread - 1,
        width: 1.2,
        height: 16,
      },
      premiumCornerBottomLeftH: {
        bottom: outerSpread - 1,
        left: outerSpread + 10,
        width: 16,
        height: 1.2,
      },
      premiumCornerBottomLeftV: {
        bottom: outerSpread + 10,
        left: outerSpread - 1,
        width: 1.2,
        height: 16,
      },
      premiumCornerBottomRightH: {
        bottom: outerSpread - 1,
        right: outerSpread + 10,
        width: 16,
        height: 1.2,
      },
      premiumCornerBottomRightV: {
        bottom: outerSpread + 10,
        right: outerSpread - 1,
        width: 1.2,
        height: 16,
      },
    }),
    [cornerRadius, frameInset, horizontalTrackLength, outerSpread, sideLineThickness, topLineThickness, trackThickness, verticalInset, verticalTrackLength],
  );

  return (
    <Animated.View pointerEvents="none" style={[styles.wrap, dynamicStyles.wrap]}>
      {isStandard ? (
        <Animated.View
          style={[
            styles.outlineGlow,
            dynamicStyles.standardGlow,
            {
              borderColor: borderColor,
              shadowColor: accentColor,
              opacity: standardGlowOpacity,
            },
          ]}
        />
      ) : null}

      {isPremium ? (
        <>
          <Animated.View
            style={[
              styles.premiumAuraOuter,
              dynamicStyles.premiumAuraOuter,
              {
                borderColor: accentColor,
                shadowColor: accentColor,
                opacity: premiumOuterAuraOpacity,
                transform: [{ scale: premiumAuraScale }],
              },
            ]}
          />
          <Animated.View
            style={[
              styles.premiumAuraInner,
              dynamicStyles.premiumAuraInner,
              {
                borderColor: borderColor,
                shadowColor: accentColor,
                opacity: premiumInnerAuraOpacity,
                transform: [{ scale: premiumAuraScale }],
              },
            ]}
          />
          <Animated.View style={[styles.cornerAccentHorizontal, dynamicStyles.premiumCornerTopLeftH, { opacity: premiumCornerOpacity }]} />
          <Animated.View style={[styles.cornerAccentVertical, dynamicStyles.premiumCornerTopLeftV, { opacity: premiumCornerOpacity }]} />
          <Animated.View style={[styles.cornerAccentHorizontal, dynamicStyles.premiumCornerTopRightH, { opacity: premiumCornerOpacity }]} />
          <Animated.View style={[styles.cornerAccentVertical, dynamicStyles.premiumCornerTopRightV, { opacity: premiumCornerOpacity }]} />
          <Animated.View style={[styles.cornerAccentHorizontal, dynamicStyles.premiumCornerBottomLeftH, { opacity: premiumCornerOpacity }]} />
          <Animated.View style={[styles.cornerAccentVertical, dynamicStyles.premiumCornerBottomLeftV, { opacity: premiumCornerOpacity }]} />
          <Animated.View style={[styles.cornerAccentHorizontal, dynamicStyles.premiumCornerBottomRightH, { opacity: premiumCornerOpacity }]} />
          <Animated.View style={[styles.cornerAccentVertical, dynamicStyles.premiumCornerBottomRightV, { opacity: premiumCornerOpacity }]} />
        </>
      ) : null}

      <Animated.View style={[styles.frameHorizontal, dynamicStyles.topFrame, { opacity: isPremium ? premiumRailOpacity : isStandard ? standardRailOpacity : basicRailOpacity }]}>
        <LinearGradient colors={[accentColor, '#ffffff', borderColor, accentColor]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.fill} />
      </Animated.View>

      {!isBasic ? (
        <>
          <Animated.View style={[styles.frameVertical, dynamicStyles.rightFrame, { opacity: isPremium ? premiumRailOpacity : standardRailOpacity }]}>
            <LinearGradient colors={[accentColor, '#ffffff', borderColor, accentColor]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={styles.fill} />
          </Animated.View>
          <Animated.View style={[styles.frameHorizontal, dynamicStyles.bottomFrame, { opacity: isPremium ? premiumRailOpacity : standardRailOpacity }]}>
            <LinearGradient colors={[accentColor, borderColor, '#ffffff', accentColor]} start={{ x: 1, y: 0.5 }} end={{ x: 0, y: 0.5 }} style={styles.fill} />
          </Animated.View>
          <Animated.View style={[styles.frameVertical, dynamicStyles.leftFrame, { opacity: isPremium ? premiumRailOpacity : standardRailOpacity }]}>
            <LinearGradient colors={[accentColor, '#ffffff', borderColor, accentColor]} start={{ x: 0.5, y: 1 }} end={{ x: 0.5, y: 0 }} style={styles.fill} />
          </Animated.View>
        </>
      ) : null}

      <View style={[styles.horizontalTrack, dynamicStyles.topTrack]}>
        <Animated.View
          style={[
            styles.horizontalComet,
            {
              width: isBasic ? basicCometWidth : orbitHorizontalCometWidth,
              height: cometThickness,
              opacity: isBasic ? basicTopOpacity : topOpacity,
              shadowColor: accentColor,
              transform: [{ translateX: isBasic ? basicTopX : topX }],
            },
          ]}
        >
          <LinearGradient colors={['transparent', accentColor, '#ffffff', accentColor, 'transparent']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.fill} />
        </Animated.View>
      </View>

      {!isBasic ? (
        <>
          <View style={[styles.verticalTrack, dynamicStyles.rightTrack]}>
            <Animated.View
              style={[
                styles.verticalComet,
                {
                  width: cometThickness,
                  height: orbitVerticalCometHeight,
                  opacity: rightOpacity,
                  shadowColor: accentColor,
                  transform: [{ translateY: rightY }],
                },
              ]}
            >
              <LinearGradient colors={['transparent', accentColor, '#ffffff', accentColor, 'transparent']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={styles.fill} />
            </Animated.View>
          </View>

          <View style={[styles.horizontalTrack, dynamicStyles.bottomTrack]}>
            <Animated.View
              style={[
                styles.horizontalComet,
                {
                  width: orbitHorizontalCometWidth,
                  height: cometThickness,
                  opacity: bottomOpacity,
                  shadowColor: accentColor,
                  transform: [{ translateX: bottomX }],
                },
              ]}
            >
              <LinearGradient colors={['transparent', accentColor, '#ffffff', accentColor, 'transparent']} start={{ x: 1, y: 0.5 }} end={{ x: 0, y: 0.5 }} style={styles.fill} />
            </Animated.View>
          </View>

          <View style={[styles.verticalTrack, dynamicStyles.leftTrack]}>
            <Animated.View
              style={[
                styles.verticalComet,
                {
                  width: cometThickness,
                  height: orbitVerticalCometHeight,
                  opacity: leftOpacity,
                  shadowColor: accentColor,
                  transform: [{ translateY: leftY }],
                },
              ]}
            >
              <LinearGradient colors={['transparent', accentColor, '#ffffff', accentColor, 'transparent']} start={{ x: 0.5, y: 1 }} end={{ x: 0.5, y: 0 }} style={styles.fill} />
            </Animated.View>
          </View>
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
  outlineGlow: {
    position: 'absolute',
    borderWidth: 1,
    shadowOpacity: 0.34,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
  },
  premiumAuraOuter: {
    position: 'absolute',
    borderWidth: 1,
    shadowOpacity: 0.5,
    shadowRadius: 42,
    shadowOffset: { width: 0, height: 0 },
  },
  premiumAuraInner: {
    position: 'absolute',
    borderWidth: 1,
    shadowOpacity: 0.26,
    shadowRadius: 16,
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
  horizontalComet: {
    position: 'absolute',
    left: 0,
    borderRadius: 999,
    overflow: 'hidden',
    shadowOpacity: 0.88,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  verticalComet: {
    position: 'absolute',
    top: 0,
    borderRadius: 999,
    overflow: 'hidden',
    shadowOpacity: 0.88,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  cornerAccentHorizontal: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: '#ffd76a',
    shadowOpacity: 0.72,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  cornerAccentVertical: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: '#ffd76a',
    shadowOpacity: 0.72,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  fill: {
    flex: 1,
  },
});
