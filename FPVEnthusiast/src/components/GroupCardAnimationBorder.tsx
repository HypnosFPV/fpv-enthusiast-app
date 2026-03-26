import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, {
  Defs,
  Line,
  LinearGradient as SvgLinearGradient,
  RadialGradient as SvgRadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';
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

  const premiumIdBase = useRef(`premium-${Math.random().toString(36).slice(2, 9)}`).current;

  const isBasic = variant === 'basic';
  const isStandard = variant === 'standard';
  const isPremium = variant === 'premium';

  const outerSpread = isPremium ? 28 : isStandard ? 8 : 3;
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
          duration: isPremium ? 3400 : isStandard ? 3000 : 2600,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: isPremium ? 3400 : isStandard ? 3000 : 2600,
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
    outputRange: [0.16, 0.28],
  });
  const premiumMainOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.28, 0.44],
  });
  const premiumNearOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.34, 0.52],
  });
  const premiumFrameOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.86, 1],
  });
  const premiumAccentOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.52, 0.82],
  });
  const premiumFarScale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.99, 1.028],
  });
  const premiumNearScale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.996, 1.014],
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
      glowHot: mixColors(accentColor, '#ffffff', 0.72),
      glowStrong: mixColors(accentColor, '#ffffff', 0.38),
      glowMid: mixColors(accentColor, borderColor, 0.16),
      glowDeep: mixColors(borderColor, '#000000', 0.22),
      frameBright: mixColors(accentColor, '#ffffff', 0.82),
      frameBase: mixColors(accentColor, borderColor, 0.14),
      frameDeep: mixColors(borderColor, '#000000', 0.26),
      accentBright: mixColors(accentColor, '#ffffff', 0.9),
      accentBase: mixColors(accentColor, '#ffffff', 0.52),
      outerGlowFar: withAlpha(mixColors(accentColor, '#ffffff', 0.22), 0.12),
      outerGlowMain: withAlpha(mixColors(accentColor, '#ffffff', 0.28), 0.24),
      outerGlowNear: withAlpha(mixColors(accentColor, '#ffffff', 0.42), 0.38),
    }),
    [accentColor, borderColor],
  );

  const premiumCanvasWidth = width + outerSpread * 2;
  const premiumCanvasHeight = height + outerSpread * 2;

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
        width: premiumCanvasWidth,
        height: premiumCanvasHeight,
      },
      premiumLayer: {
        top: 0,
        left: 0,
        width: premiumCanvasWidth,
        height: premiumCanvasHeight,
      },
    }),
    [
      basicTrackThickness,
      cornerRadius,
      frameInset,
      horizontalTrackLength,
      outerSpread,
      premiumCanvasHeight,
      premiumCanvasWidth,
      standardLineThickness,
      standardTrackThickness,
      verticalInset,
      verticalTrackLength,
    ],
  );

  if (isPremium) {
    const frameX = outerSpread + 0.5;
    const frameY = outerSpread + 0.5;
    const frameW = Math.max(width - 1, 0);
    const frameH = Math.max(height - 1, 0);
    const frameR = cornerRadius + 1;

    const outerFrameX = outerSpread - 2;
    const outerFrameY = outerSpread - 2;
    const outerFrameW = width + 4;
    const outerFrameH = height + 4;
    const outerFrameR = cornerRadius + 3;

    const topGlowX = outerSpread + frameInset - 10;
    const topGlowY = outerSpread - 26;
    const topGlowW = Math.max(width - frameInset * 2 + 20, 40);
    const topGlowH = 36;

    const bottomGlowX = outerSpread + frameInset + 8;
    const bottomGlowY = outerSpread + height - 6;
    const bottomGlowW = Math.max(width - frameInset * 2 - 16, 40);
    const bottomGlowH = 28;

    const sideGlowY = outerSpread + verticalInset - 6;
    const sideGlowH = Math.max(height - verticalInset * 2 + 12, 34);
    const leftGlowX = outerSpread - 26;
    const rightGlowX = outerSpread + width - 8;
    const sideGlowW = 34;

    const cornerSize = 58;
    const topLeftCornerX = outerSpread - 24;
    const topLeftCornerY = outerSpread - 24;
    const topRightCornerX = outerSpread + width - 34;
    const topRightCornerY = outerSpread - 24;
    const bottomLeftCornerX = outerSpread - 24;
    const bottomLeftCornerY = outerSpread + height - 34;
    const bottomRightCornerX = outerSpread + width - 34;
    const bottomRightCornerY = outerSpread + height - 34;

    const topLeftHX1 = frameX + 12;
    const topLeftHX2 = frameX + 32;
    const topLeftVY1 = frameY + 12;
    const topLeftVY2 = frameY + 32;

    const topRightHX1 = frameX + frameW - 32;
    const topRightHX2 = frameX + frameW - 12;
    const topRightVY1 = frameY + 12;
    const topRightVY2 = frameY + 32;

    const bottomLeftHX1 = frameX + 12;
    const bottomLeftHX2 = frameX + 24;
    const bottomLeftVY1 = frameY + frameH - 24;
    const bottomLeftVY2 = frameY + frameH - 12;

    const bottomRightHX1 = frameX + frameW - 24;
    const bottomRightHX2 = frameX + frameW - 12;
    const bottomRightVY1 = frameY + frameH - 24;
    const bottomRightVY2 = frameY + frameH - 12;

    return (
      <Animated.View pointerEvents="none" style={[styles.wrap, dynamicStyles.wrap, dynamicStyles.premiumCanvas]}>
        <Animated.View
          style={[
            styles.premiumLayer,
            dynamicStyles.premiumLayer,
            { opacity: premiumFarOpacity, transform: [{ scale: premiumFarScale }] },
          ]}
        >
          <Svg width={premiumCanvasWidth} height={premiumCanvasHeight}>
            <Defs>
              <SvgLinearGradient id={`${premiumIdBase}-top-far`} x1="0%" y1="0%" x2="0%" y2="100%">
                <Stop offset="0%" stopColor={withAlpha(premiumTone.glowStrong, 0)} />
                <Stop offset="64%" stopColor={withAlpha(premiumTone.glowStrong, 0.08)} />
                <Stop offset="100%" stopColor={premiumTone.outerGlowFar} />
              </SvgLinearGradient>
              <SvgLinearGradient id={`${premiumIdBase}-bottom-far`} x1="0%" y1="0%" x2="0%" y2="100%">
                <Stop offset="0%" stopColor={premiumTone.outerGlowFar} />
                <Stop offset="46%" stopColor={withAlpha(premiumTone.glowStrong, 0.06)} />
                <Stop offset="100%" stopColor={withAlpha(premiumTone.glowStrong, 0)} />
              </SvgLinearGradient>
              <SvgLinearGradient id={`${premiumIdBase}-left-far`} x1="0%" y1="0%" x2="100%" y2="0%">
                <Stop offset="0%" stopColor={withAlpha(premiumTone.glowStrong, 0)} />
                <Stop offset="60%" stopColor={withAlpha(premiumTone.glowStrong, 0.08)} />
                <Stop offset="100%" stopColor={premiumTone.outerGlowFar} />
              </SvgLinearGradient>
              <SvgLinearGradient id={`${premiumIdBase}-right-far`} x1="0%" y1="0%" x2="100%" y2="0%">
                <Stop offset="0%" stopColor={premiumTone.outerGlowFar} />
                <Stop offset="40%" stopColor={withAlpha(premiumTone.glowStrong, 0.08)} />
                <Stop offset="100%" stopColor={withAlpha(premiumTone.glowStrong, 0)} />
              </SvgLinearGradient>
              <SvgRadialGradient id={`${premiumIdBase}-corner-tl-far`} cx="74%" cy="74%" r="82%">
                <Stop offset="0%" stopColor={premiumTone.outerGlowMain} />
                <Stop offset="42%" stopColor={withAlpha(premiumTone.glowStrong, 0.16)} />
                <Stop offset="100%" stopColor={withAlpha(premiumTone.glowStrong, 0)} />
              </SvgRadialGradient>
              <SvgRadialGradient id={`${premiumIdBase}-corner-tr-far`} cx="26%" cy="74%" r="82%">
                <Stop offset="0%" stopColor={premiumTone.outerGlowMain} />
                <Stop offset="42%" stopColor={withAlpha(premiumTone.glowStrong, 0.16)} />
                <Stop offset="100%" stopColor={withAlpha(premiumTone.glowStrong, 0)} />
              </SvgRadialGradient>
              <SvgRadialGradient id={`${premiumIdBase}-corner-bl-far`} cx="74%" cy="26%" r="82%">
                <Stop offset="0%" stopColor={premiumTone.outerGlowMain} />
                <Stop offset="42%" stopColor={withAlpha(premiumTone.glowStrong, 0.12)} />
                <Stop offset="100%" stopColor={withAlpha(premiumTone.glowStrong, 0)} />
              </SvgRadialGradient>
              <SvgRadialGradient id={`${premiumIdBase}-corner-br-far`} cx="26%" cy="26%" r="82%">
                <Stop offset="0%" stopColor={premiumTone.outerGlowMain} />
                <Stop offset="42%" stopColor={withAlpha(premiumTone.glowStrong, 0.12)} />
                <Stop offset="100%" stopColor={withAlpha(premiumTone.glowStrong, 0)} />
              </SvgRadialGradient>
            </Defs>

            <Rect x={topGlowX} y={topGlowY} width={topGlowW} height={topGlowH} rx={18} ry={18} fill={`url(#${premiumIdBase}-top-far)`} />
            <Rect x={bottomGlowX} y={bottomGlowY} width={bottomGlowW} height={bottomGlowH} rx={16} ry={16} fill={`url(#${premiumIdBase}-bottom-far)`} />
            <Rect x={leftGlowX} y={sideGlowY} width={sideGlowW} height={sideGlowH} rx={18} ry={18} fill={`url(#${premiumIdBase}-left-far)`} />
            <Rect x={rightGlowX} y={sideGlowY} width={sideGlowW} height={sideGlowH} rx={18} ry={18} fill={`url(#${premiumIdBase}-right-far)`} />

            <Rect x={topLeftCornerX} y={topLeftCornerY} width={cornerSize} height={cornerSize} rx={29} ry={29} fill={`url(#${premiumIdBase}-corner-tl-far)`} />
            <Rect x={topRightCornerX} y={topRightCornerY} width={cornerSize} height={cornerSize} rx={29} ry={29} fill={`url(#${premiumIdBase}-corner-tr-far)`} />
            <Rect x={bottomLeftCornerX} y={bottomLeftCornerY} width={cornerSize} height={cornerSize} rx={29} ry={29} fill={`url(#${premiumIdBase}-corner-bl-far)`} />
            <Rect x={bottomRightCornerX} y={bottomRightCornerY} width={cornerSize} height={cornerSize} rx={29} ry={29} fill={`url(#${premiumIdBase}-corner-br-far)`} />
          </Svg>
        </Animated.View>

        <Animated.View
          style={[
            styles.premiumLayer,
            dynamicStyles.premiumLayer,
            { opacity: premiumMainOpacity, transform: [{ scale: premiumNearScale }] },
          ]}
        >
          <Svg width={premiumCanvasWidth} height={premiumCanvasHeight}>
            <Defs>
              <SvgLinearGradient id={`${premiumIdBase}-top-main`} x1="0%" y1="0%" x2="0%" y2="100%">
                <Stop offset="0%" stopColor={withAlpha(premiumTone.glowHot, 0)} />
                <Stop offset="48%" stopColor={withAlpha(premiumTone.glowStrong, 0.16)} />
                <Stop offset="100%" stopColor={premiumTone.outerGlowNear} />
              </SvgLinearGradient>
              <SvgLinearGradient id={`${premiumIdBase}-bottom-main`} x1="0%" y1="0%" x2="0%" y2="100%">
                <Stop offset="0%" stopColor={premiumTone.outerGlowMain} />
                <Stop offset="52%" stopColor={withAlpha(premiumTone.glowStrong, 0.12)} />
                <Stop offset="100%" stopColor={withAlpha(premiumTone.glowHot, 0)} />
              </SvgLinearGradient>
              <SvgLinearGradient id={`${premiumIdBase}-left-main`} x1="0%" y1="0%" x2="100%" y2="0%">
                <Stop offset="0%" stopColor={withAlpha(premiumTone.glowHot, 0)} />
                <Stop offset="44%" stopColor={withAlpha(premiumTone.glowStrong, 0.14)} />
                <Stop offset="100%" stopColor={premiumTone.outerGlowNear} />
              </SvgLinearGradient>
              <SvgLinearGradient id={`${premiumIdBase}-right-main`} x1="0%" y1="0%" x2="100%" y2="0%">
                <Stop offset="0%" stopColor={premiumTone.outerGlowNear} />
                <Stop offset="56%" stopColor={withAlpha(premiumTone.glowStrong, 0.14)} />
                <Stop offset="100%" stopColor={withAlpha(premiumTone.glowHot, 0)} />
              </SvgLinearGradient>
            </Defs>

            <Rect x={topGlowX + 2} y={topGlowY + 10} width={topGlowW - 4} height={24} rx={14} ry={14} fill={`url(#${premiumIdBase}-top-main)`} />
            <Rect x={bottomGlowX + 6} y={bottomGlowY - 6} width={bottomGlowW - 12} height={22} rx={12} ry={12} fill={`url(#${premiumIdBase}-bottom-main)`} />
            <Rect x={leftGlowX + 10} y={sideGlowY + 4} width={22} height={sideGlowH - 8} rx={12} ry={12} fill={`url(#${premiumIdBase}-left-main)`} />
            <Rect x={rightGlowX + 2} y={sideGlowY + 4} width={22} height={sideGlowH - 8} rx={12} ry={12} fill={`url(#${premiumIdBase}-right-main)`} />
            <Rect x={outerFrameX} y={outerFrameY} width={outerFrameW} height={outerFrameH} rx={outerFrameR} ry={outerFrameR} stroke={withAlpha(premiumTone.glowStrong, 0.4)} strokeWidth={2.1} fill="none" />
          </Svg>
        </Animated.View>

        <Animated.View style={[styles.premiumLayer, dynamicStyles.premiumLayer, { opacity: premiumNearOpacity }]}>
          <Svg width={premiumCanvasWidth} height={premiumCanvasHeight}>
            <Defs>
              <SvgLinearGradient id={`${premiumIdBase}-frame`} x1="0%" y1="0%" x2="100%" y2="0%">
                <Stop offset="0%" stopColor={premiumTone.frameDeep} />
                <Stop offset="18%" stopColor={premiumTone.frameBase} />
                <Stop offset="52%" stopColor={premiumTone.frameBright} />
                <Stop offset="82%" stopColor={premiumTone.frameBase} />
                <Stop offset="100%" stopColor={premiumTone.frameDeep} />
              </SvgLinearGradient>
            </Defs>
            <Rect x={frameX} y={frameY} width={frameW} height={frameH} rx={frameR} ry={frameR} stroke={`url(#${premiumIdBase}-frame)`} strokeWidth={1.5} fill="none" />
            <Rect x={outerFrameX} y={outerFrameY} width={outerFrameW} height={outerFrameH} rx={outerFrameR} ry={outerFrameR} stroke={withAlpha(premiumTone.frameBase, 0.42)} strokeWidth={0.9} fill="none" />
          </Svg>
        </Animated.View>

        <Animated.View style={[styles.premiumLayer, dynamicStyles.premiumLayer, { opacity: premiumAccentOpacity }]}>
          <Svg width={premiumCanvasWidth} height={premiumCanvasHeight}>
            <Line x1={topLeftHX1} y1={frameY} x2={topLeftHX2} y2={frameY} stroke={premiumTone.accentBright} strokeWidth={1.2} strokeLinecap="round" />
            <Line x1={frameX} y1={topLeftVY1} x2={frameX} y2={topLeftVY2} stroke={premiumTone.accentBright} strokeWidth={1.2} strokeLinecap="round" />

            <Line x1={topRightHX1} y1={frameY} x2={topRightHX2} y2={frameY} stroke={premiumTone.accentBright} strokeWidth={1.2} strokeLinecap="round" />
            <Line x1={frameX + frameW} y1={topRightVY1} x2={frameX + frameW} y2={topRightVY2} stroke={premiumTone.accentBright} strokeWidth={1.2} strokeLinecap="round" />

            <Line x1={bottomLeftHX1} y1={frameY + frameH} x2={bottomLeftHX2} y2={frameY + frameH} stroke={premiumTone.accentBase} strokeWidth={1.1} strokeLinecap="round" />
            <Line x1={frameX} y1={bottomLeftVY1} x2={frameX} y2={bottomLeftVY2} stroke={premiumTone.accentBase} strokeWidth={1.1} strokeLinecap="round" />

            <Line x1={bottomRightHX1} y1={frameY + frameH} x2={bottomRightHX2} y2={frameY + frameH} stroke={premiumTone.accentBase} strokeWidth={1.1} strokeLinecap="round" />
            <Line x1={frameX + frameW} y1={bottomRightVY1} x2={frameX + frameW} y2={bottomRightVY2} stroke={premiumTone.accentBase} strokeWidth={1.1} strokeLinecap="round" />
          </Svg>
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
