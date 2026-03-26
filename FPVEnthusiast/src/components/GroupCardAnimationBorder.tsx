import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  BlurMask,
  Canvas,
  Line,
  LinearGradient as SkiaLinearGradient,
  RoundedRect,
  vec,
} from '@shopify/react-native-skia';
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

function hexToRgb(input: string) {
  const hex = input.trim().replace('#', '');
  const normalized = hex.length === 3
    ? hex.split('').map((part) => part + part).join('')
    : hex.slice(0, 6);

  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return { r: 255, g: 255, b: 255 };
  }

  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
}

function mixColors(colorA: string, colorB: string, weight = 0.5) {
  const a = hexToRgb(colorA);
  const b = hexToRgb(colorB);
  const t = clamp(weight, 0, 1);
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const mixedBlue = Math.round(a.b + (b.b - a.b) * t);
  return `rgb(${r}, ${g}, ${mixedBlue})`;
}

function withAlpha(color: string, alpha: number) {
  const { r, g, b } = hexToRgb(color);
  const safeAlpha = clamp(alpha, 0, 1);
  return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
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

  const pulseLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const orbitLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  const isBasic = variant === 'basic';
  const isStandard = variant === 'standard';
  const isPremium = variant === 'premium';

  const outerSpread = isPremium ? 22 : isStandard ? 8 : 3;
  const frameInset = Math.max(Math.round(cornerRadius * 0.72), 10);
  const verticalInset = Math.max(Math.round(cornerRadius * 0.82), 12);

  const basicTrackThickness = 4;
  const standardTrackThickness = 7;
  const standardLineThickness = 1.12;

  const horizontalTrackLength = Math.max(width - frameInset * 2, 44);
  const verticalTrackLength = Math.max(height - verticalInset * 2, 44);

  const basicCometWidth = clamp(horizontalTrackLength * 0.22, 48, 86);
  const standardHorizontalCometWidth = clamp(horizontalTrackLength * 0.16, 44, 70);
  const standardVerticalCometHeight = clamp(verticalTrackLength * 0.18, 42, 64);

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
          duration: isPremium ? 3200 : isStandard ? 3000 : 2600,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: isPremium ? 3200 : isStandard ? 3000 : 2600,
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
            duration: 3800,
            easing: Easing.inOut(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(orbitAnim, {
            toValue: 0,
            duration: 3800,
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

    pulseLoopRef.current.start();
    orbitLoopRef.current?.start?.();

    return () => {
      pulseLoopRef.current?.stop?.();
      orbitLoopRef.current?.stop?.();
      pulseAnim.stopAnimation();
      orbitAnim.stopAnimation();
    };
  }, [active, height, isBasic, isPremium, isStandard, orbitAnim, pulseAnim, variant, width]);

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

  const premiumFarOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.32, 0.52],
  });
  const premiumMidOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.44, 0.7],
  });
  const premiumNearOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.68, 1],
  });
  const premiumFarScale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.992, 1.028],
  });
  const premiumNearScale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.998, 1.014],
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

  const premiumTone = useMemo(
    () => ({
      glowFar: mixColors(accentColor, '#ffffff', 0.18),
      glowMid: mixColors(accentColor, '#ffffff', 0.34),
      glowHot: mixColors(accentColor, '#ffffff', 0.62),
      frameDeep: mixColors(borderColor, '#000000', 0.28),
      frameBase: mixColors(accentColor, borderColor, 0.18),
      frameBright: mixColors(accentColor, '#ffffff', 0.82),
      accentBright: mixColors(accentColor, '#ffffff', 0.92),
      accentBase: mixColors(accentColor, '#ffffff', 0.64),
    }),
    [accentColor, borderColor],
  );

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
      premiumCanvas: {
        width: width + outerSpread * 2,
        height: height + outerSpread * 2,
      },
      premiumLayer: {
        top: 0,
        left: 0,
        width: width + outerSpread * 2,
        height: height + outerSpread * 2,
      },
    }),
    [
      basicTrackThickness,
      cornerRadius,
      frameInset,
      height,
      horizontalTrackLength,
      outerSpread,
      standardLineThickness,
      standardTrackThickness,
      verticalInset,
      verticalTrackLength,
      width,
    ],
  );

  if (isPremium) {
    const canvasWidth = width + outerSpread * 2;
    const canvasHeight = height + outerSpread * 2;
    const frameX = outerSpread;
    const frameY = outerSpread;
    const frameR = cornerRadius + 1;

    const topLineInset = 18;
    const sideLineInset = 16;
    const bottomLineInset = 14;

    return (
      <Animated.View pointerEvents="none" style={[styles.wrap, dynamicStyles.wrap, dynamicStyles.premiumCanvas]}>
        <Animated.View
          style={[
            styles.premiumLayer,
            dynamicStyles.premiumLayer,
            { opacity: premiumFarOpacity, transform: [{ scale: premiumFarScale }] },
          ]}
        >
          <Canvas style={styles.fill}>
            <RoundedRect
              x={frameX}
              y={frameY}
              width={width}
              height={height}
              r={frameR}
              color={withAlpha(premiumTone.glowFar, 0.34)}
              style="stroke"
              strokeWidth={5.5}
            >
              <BlurMask blur={28} style="outer" />
            </RoundedRect>
            <RoundedRect
              x={frameX}
              y={frameY}
              width={width}
              height={height}
              r={frameR}
              color={withAlpha(premiumTone.glowMid, 0.2)}
              style="stroke"
              strokeWidth={8.5}
            >
              <BlurMask blur={36} style="outer" />
            </RoundedRect>
            <Line
              p1={vec(frameX + topLineInset, frameY + 1)}
              p2={vec(frameX + width - topLineInset, frameY + 1)}
              color={withAlpha(premiumTone.glowHot, 0.22)}
              style="stroke"
              strokeWidth={4.5}
            >
              <BlurMask blur={18} style="outer" />
            </Line>
          </Canvas>
        </Animated.View>

        <Animated.View
          style={[
            styles.premiumLayer,
            dynamicStyles.premiumLayer,
            { opacity: premiumMidOpacity, transform: [{ scale: premiumNearScale }] },
          ]}
        >
          <Canvas style={styles.fill}>
            <RoundedRect
              x={frameX}
              y={frameY}
              width={width}
              height={height}
              r={frameR}
              color={withAlpha(premiumTone.glowHot, 0.28)}
              style="stroke"
              strokeWidth={2.8}
            >
              <BlurMask blur={16} style="outer" />
            </RoundedRect>

            <Line
              p1={vec(frameX + topLineInset, frameY + 1)}
              p2={vec(frameX + width - topLineInset, frameY + 1)}
              color={withAlpha(premiumTone.glowHot, 0.5)}
              style="stroke"
              strokeWidth={2.4}
            >
              <BlurMask blur={10} style="outer" />
            </Line>

            <Line
              p1={vec(frameX + 1, frameY + sideLineInset)}
              p2={vec(frameX + 1, frameY + height - sideLineInset)}
              color={withAlpha(premiumTone.glowMid, 0.34)}
              style="stroke"
              strokeWidth={2.1}
            >
              <BlurMask blur={10} style="outer" />
            </Line>
            <Line
              p1={vec(frameX + width - 1, frameY + sideLineInset)}
              p2={vec(frameX + width - 1, frameY + height - sideLineInset)}
              color={withAlpha(premiumTone.glowMid, 0.34)}
              style="stroke"
              strokeWidth={2.1}
            >
              <BlurMask blur={10} style="outer" />
            </Line>

            <Line
              p1={vec(frameX + bottomLineInset, frameY + height - 1)}
              p2={vec(frameX + width - bottomLineInset, frameY + height - 1)}
              color={withAlpha(premiumTone.glowMid, 0.24)}
              style="stroke"
              strokeWidth={1.8}
            >
              <BlurMask blur={8} style="outer" />
            </Line>
          </Canvas>
        </Animated.View>

        <Animated.View style={[styles.premiumLayer, dynamicStyles.premiumLayer, { opacity: premiumNearOpacity }]}>
          <Canvas style={styles.fill}>
            <RoundedRect x={frameX} y={frameY} width={width} height={height} r={frameR} style="stroke" strokeWidth={1.45}>
              <SkiaLinearGradient
                start={vec(frameX, frameY)}
                end={vec(frameX + width, frameY)}
                colors={[
                  premiumTone.frameDeep,
                  premiumTone.frameBase,
                  premiumTone.frameBright,
                  premiumTone.frameBase,
                  premiumTone.frameDeep,
                ]}
              />
            </RoundedRect>

            <Line
              p1={vec(frameX + topLineInset, frameY)}
              p2={vec(frameX + width - topLineInset, frameY)}
              color={premiumTone.accentBright}
              style="stroke"
              strokeWidth={1.35}
            />
            <Line
              p1={vec(frameX, frameY + sideLineInset)}
              p2={vec(frameX, frameY + height - sideLineInset)}
              color={premiumTone.accentBase}
              style="stroke"
              strokeWidth={1.05}
            />
            <Line
              p1={vec(frameX + width, frameY + sideLineInset)}
              p2={vec(frameX + width, frameY + height - sideLineInset)}
              color={premiumTone.accentBase}
              style="stroke"
              strokeWidth={1.05}
            />
            <Line
              p1={vec(frameX + bottomLineInset, frameY + height)}
              p2={vec(frameX + width - bottomLineInset, frameY + height)}
              color={withAlpha(premiumTone.accentBase, 0.72)}
              style="stroke"
              strokeWidth={0.95}
            />

            <Line p1={vec(frameX + 12, frameY)} p2={vec(frameX + 30, frameY)} color={premiumTone.accentBright} style="stroke" strokeWidth={1.1} />
            <Line p1={vec(frameX, frameY + 12)} p2={vec(frameX, frameY + 30)} color={premiumTone.accentBright} style="stroke" strokeWidth={1.1} />
            <Line p1={vec(frameX + width - 30, frameY)} p2={vec(frameX + width - 12, frameY)} color={premiumTone.accentBright} style="stroke" strokeWidth={1.1} />
            <Line p1={vec(frameX + width, frameY + 12)} p2={vec(frameX + width, frameY + 30)} color={premiumTone.accentBright} style="stroke" strokeWidth={1.1} />

            <Line p1={vec(frameX + 12, frameY + height)} p2={vec(frameX + 24, frameY + height)} color={premiumTone.accentBase} style="stroke" strokeWidth={1.0} />
            <Line p1={vec(frameX, frameY + height - 24)} p2={vec(frameX, frameY + height - 12)} color={premiumTone.accentBase} style="stroke" strokeWidth={1.0} />
            <Line p1={vec(frameX + width - 24, frameY + height)} p2={vec(frameX + width - 12, frameY + height)} color={premiumTone.accentBase} style="stroke" strokeWidth={1.0} />
            <Line p1={vec(frameX + width, frameY + height - 24)} p2={vec(frameX + width, frameY + height - 12)} color={premiumTone.accentBase} style="stroke" strokeWidth={1.0} />
          </Canvas>
        </Animated.View>
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
  premiumLayer: {
    position: 'absolute',
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
  fill: {
    flex: 1,
  },
});
