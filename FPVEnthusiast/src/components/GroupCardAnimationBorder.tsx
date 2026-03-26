import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, {
  ClipPath,
  Defs,
  G,
  Line,
  LinearGradient as SvgLinearGradient,
  Pattern,
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
  const trimmed = input.trim();
  const rgbMatch = trimmed.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
  if (rgbMatch) {
    return {
      r: clamp(parseInt(rgbMatch[1], 10), 0, 255),
      g: clamp(parseInt(rgbMatch[2], 10), 0, 255),
      b: clamp(parseInt(rgbMatch[3], 10), 0, 255),
    };
  }

  const hex = trimmed.replace('#', '');
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

  const outerSpread = isPremium ? 18 : isStandard ? 8 : 3;
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
  const premiumHorizontalCometWidth = clamp(horizontalTrackLength * 0.14, 36, 56);
  const premiumVerticalCometHeight = clamp(verticalTrackLength * 0.15, 34, 52);

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
          duration: isPremium ? 1600 : isStandard ? 3000 : 2600,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: isPremium ? 1600 : isStandard ? 3000 : 2600,
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
    } else if (isPremium) {
      orbitLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(orbitAnim, {
            toValue: 4,
            duration: 5200,
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

  const premiumCarbonOpacity = pulseAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.94, 1, 0.94],
  });
  const premiumRailOpacity = pulseAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.34, 0.9, 0.34],
  });
  const premiumGlowOpacity = pulseAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.1, 0.24, 0.1],
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

  const premiumTopX = buildSegmentTranslate(orbitAnim, 0, horizontalTrackLength - premiumHorizontalCometWidth, false);
  const premiumRightY = buildSegmentTranslate(orbitAnim, 1, verticalTrackLength - premiumVerticalCometHeight, false);
  const premiumBottomX = buildSegmentTranslate(orbitAnim, 2, horizontalTrackLength - premiumHorizontalCometWidth, true);
  const premiumLeftY = buildSegmentTranslate(orbitAnim, 3, verticalTrackLength - premiumVerticalCometHeight, true);

  const premiumTopOpacity = buildSegmentOpacity(orbitAnim, 0, 0.96);
  const premiumRightOpacity = buildSegmentOpacity(orbitAnim, 1, 0.96);
  const premiumBottomOpacity = buildSegmentOpacity(orbitAnim, 2, 0.96);
  const premiumLeftOpacity = buildSegmentOpacity(orbitAnim, 3, 0.96);

  const premiumTone = useMemo(() => ({
    carbonShadow: mixColors(borderColor, '#010102', 0.92),
    carbonBase: mixColors(mixColors(accentColor, borderColor, 0.26), '#050507', 0.82),
    carbonLift: withAlpha(mixColors(accentColor, '#655a76', 0.12), 0.11),
    carbonWeaveShadow: withAlpha(mixColors(borderColor, '#000000', 0.72), 0.46),
    carbonWeaveLight: withAlpha(mixColors(accentColor, '#473d57', 0.16), 0.2),
    carbonWeaveMicro: withAlpha(mixColors(borderColor, '#1b1821', 0.36), 0.18),
    carbonTint: withAlpha(accentColor, 0.06),
    carbonGloss: withAlpha(mixColors(accentColor, '#9387a6', 0.08), 0.08),
    carbonFrameOuter: withAlpha(mixColors(borderColor, '#000000', 0.22), 0.96),
    carbonFrameInner: withAlpha(mixColors(accentColor, borderColor, 0.12), 0.4),
    electricDim: withAlpha(accentColor, 0.24),
    electricSoft: withAlpha(accentColor, 0.6),
    electricBase: withAlpha(accentColor, 0.86),
    electricHot: accentColor,
  }), [accentColor, borderColor]);

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

    const innerInset = 2.5;
    const innerFrameX = frameX + innerInset;
    const innerFrameY = frameY + innerInset;
    const innerFrameW = Math.max(frameW - innerInset * 2, 0);
    const innerFrameH = Math.max(frameH - innerInset * 2, 0);
    const innerFrameR = Math.max(frameR - innerInset, 1);

    const clipId = `${premiumIdBase}-carbon-clip`;
    const patternId = `${premiumIdBase}-carbon-pattern`;
    const fineWeaveCount = Math.ceil((frameW + frameH) / 14) + 10;
    const microWeaveCount = Math.ceil((frameW + frameH) / 7) + 18;
    const topPulseW = clamp(horizontalTrackLength * 0.2, 54, 88);
    const sidePulseH = clamp(verticalTrackLength * 0.22, 54, 92);
    const edgeInset = Math.max(frameInset - 4, 8);
    const verticalEdgeInset = Math.max(verticalInset - 4, 8);
    const cornerStub = clamp(cornerRadius + 4, 14, 22);

    return (
      <Animated.View pointerEvents="none" style={[styles.wrap, dynamicStyles.wrap, dynamicStyles.premiumCanvas, { zIndex: 0 }]}>
        <Animated.View style={[styles.premiumLayer, dynamicStyles.premiumLayer, { opacity: premiumCarbonOpacity }]}>
          <Svg width={premiumCanvasWidth} height={premiumCanvasHeight}>
            <Defs>
              <ClipPath id={clipId}>
                <Rect x={frameX} y={frameY} width={frameW} height={frameH} rx={frameR} ry={frameR} />
              </ClipPath>
              <Pattern id={patternId} patternUnits="userSpaceOnUse" width={24} height={24}>
                <Rect x={0} y={0} width={24} height={24} fill={premiumTone.carbonBase} />
                <Line x1={-6} y1={24} x2={10} y2={0} stroke={premiumTone.carbonWeaveShadow} strokeWidth={7} strokeLinecap="square" />
                <Line x1={6} y1={24} x2={22} y2={0} stroke={premiumTone.carbonWeaveLight} strokeWidth={6} strokeLinecap="square" />
                <Line x1={18} y1={24} x2={34} y2={0} stroke={premiumTone.carbonWeaveShadow} strokeWidth={7} strokeLinecap="square" />
                <Line x1={2} y1={0} x2={24} y2={22} stroke={premiumTone.carbonWeaveMicro} strokeWidth={2.2} strokeLinecap="square" />
                <Line x1={-8} y1={8} x2={16} y2={32} stroke={premiumTone.carbonLift} strokeWidth={1.2} strokeLinecap="square" />
                <Rect x={0} y={0} width={24} height={8} fill={premiumTone.carbonGloss} />
              </Pattern>
            </Defs>

            <Rect x={frameX} y={frameY} width={frameW} height={frameH} rx={frameR} ry={frameR} fill={premiumTone.carbonShadow} />
            <G clipPath={`url(#${clipId})`}>
              <Rect x={frameX} y={frameY} width={frameW} height={frameH} fill={`url(#${patternId})`} />
              <Rect x={frameX} y={frameY} width={frameW} height={frameH} fill={premiumTone.carbonTint} />
              {Array.from({ length: fineWeaveCount }).map((_, index) => {
                const startX = frameX - frameH + index * 14;
                return (
                  <Line
                    key={`premium-fine-a-${index}`}
                    x1={startX}
                    y1={frameY + frameH}
                    x2={startX + frameH}
                    y2={frameY}
                    stroke={index % 4 < 2 ? premiumTone.carbonWeaveLight : premiumTone.carbonWeaveShadow}
                    strokeWidth={index % 3 === 0 ? 3.2 : 2.4}
                    strokeLinecap="square"
                  />
                );
              })}
              {Array.from({ length: fineWeaveCount }).map((_, index) => {
                const startX = frameX - 12 + index * 14;
                return (
                  <Line
                    key={`premium-fine-b-${index}`}
                    x1={startX}
                    y1={frameY}
                    x2={startX + frameH}
                    y2={frameY + frameH}
                    stroke={index % 5 === 0 ? premiumTone.carbonLift : premiumTone.carbonWeaveMicro}
                    strokeWidth={index % 2 === 0 ? 1.3 : 1.1}
                    strokeLinecap="square"
                  />
                );
              })}
              {Array.from({ length: microWeaveCount }).map((_, index) => {
                const startX = frameX - frameH + index * 7;
                return (
                  <Line
                    key={`premium-micro-a-${index}`}
                    x1={startX}
                    y1={frameY + frameH}
                    x2={startX + frameH}
                    y2={frameY}
                    stroke={premiumTone.carbonWeaveMicro}
                    strokeWidth={0.9}
                    strokeLinecap="square"
                  />
                );
              })}
              <Rect x={frameX} y={frameY} width={frameW} height={Math.max(frameH * 0.18, 22)} fill={premiumTone.carbonGloss} />
              <Rect x={frameX} y={frameY + frameH * 0.66} width={frameW} height={Math.max(frameH * 0.34, 28)} fill={withAlpha('#000000', 0.16)} />
            </G>

            <Rect x={frameX} y={frameY} width={frameW} height={frameH} rx={frameR} ry={frameR} stroke={premiumTone.carbonFrameOuter} strokeWidth={1.15} fill="none" />
            <Rect x={innerFrameX} y={innerFrameY} width={innerFrameW} height={innerFrameH} rx={innerFrameR} ry={innerFrameR} stroke={premiumTone.carbonFrameInner} strokeWidth={0.9} fill="none" />

            <Line x1={frameX + edgeInset} y1={frameY + 0.8} x2={frameX + frameW - edgeInset} y2={frameY + 0.8} stroke={premiumTone.electricDim} strokeWidth={1.1} strokeLinecap="round" />
            <Line x1={frameX + edgeInset} y1={frameY + frameH - 0.8} x2={frameX + frameW - edgeInset} y2={frameY + frameH - 0.8} stroke={premiumTone.electricDim} strokeWidth={1.1} strokeLinecap="round" />
            <Line x1={frameX + 0.8} y1={frameY + verticalEdgeInset} x2={frameX + 0.8} y2={frameY + frameH - verticalEdgeInset} stroke={premiumTone.electricDim} strokeWidth={1.1} strokeLinecap="round" />
            <Line x1={frameX + frameW - 0.8} y1={frameY + verticalEdgeInset} x2={frameX + frameW - 0.8} y2={frameY + frameH - verticalEdgeInset} stroke={premiumTone.electricDim} strokeWidth={1.1} strokeLinecap="round" />
          </Svg>
        </Animated.View>

        <Animated.View style={[styles.premiumCornerHorizontal, { top: outerSpread + 0.5, left: outerSpread + 1.5, width: cornerStub, backgroundColor: premiumTone.electricBase, opacity: premiumGlowOpacity }]} />
        <Animated.View style={[styles.premiumCornerVertical, { top: outerSpread + 1.5, left: outerSpread + 0.5, height: cornerStub, backgroundColor: premiumTone.electricBase, opacity: premiumGlowOpacity }]} />
        <Animated.View style={[styles.premiumCornerHorizontal, { top: outerSpread + 0.5, right: outerSpread + 1.5, width: cornerStub, backgroundColor: premiumTone.electricBase, opacity: premiumGlowOpacity }]} />
        <Animated.View style={[styles.premiumCornerVertical, { top: outerSpread + 1.5, right: outerSpread + 0.5, height: cornerStub, backgroundColor: premiumTone.electricBase, opacity: premiumGlowOpacity }]} />
        <Animated.View style={[styles.premiumCornerHorizontal, { bottom: outerSpread + 0.5, left: outerSpread + 1.5, width: cornerStub, backgroundColor: premiumTone.electricBase, opacity: premiumGlowOpacity }]} />
        <Animated.View style={[styles.premiumCornerVertical, { bottom: outerSpread + 1.5, left: outerSpread + 0.5, height: cornerStub, backgroundColor: premiumTone.electricBase, opacity: premiumGlowOpacity }]} />
        <Animated.View style={[styles.premiumCornerHorizontal, { bottom: outerSpread + 0.5, right: outerSpread + 1.5, width: cornerStub, backgroundColor: premiumTone.electricBase, opacity: premiumGlowOpacity }]} />
        <Animated.View style={[styles.premiumCornerVertical, { bottom: outerSpread + 1.5, right: outerSpread + 0.5, height: cornerStub, backgroundColor: premiumTone.electricBase, opacity: premiumGlowOpacity }]} />

        <View style={[styles.premiumEdgeTrack, { top: outerSpread - 3, left: outerSpread + edgeInset, width: horizontalTrackLength }]}>
          <Animated.View style={[styles.premiumRail, { backgroundColor: premiumTone.electricDim, opacity: premiumRailOpacity }]} />
          <Animated.View
            style={[
              styles.premiumPulseCluster,
              {
                width: topPulseW,
                opacity: premiumTopOpacity,
                transform: [{ translateX: premiumTopX }],
              },
            ]}
          >
            <View style={[styles.premiumPulseSegment, { left: 0, top: 3, width: Math.round(topPulseW * 0.18), backgroundColor: premiumTone.electricSoft }]} />
            <View style={[styles.premiumPulseSegmentCore, { left: Math.round(topPulseW * 0.2), top: 2, width: Math.round(topPulseW * 0.26), backgroundColor: premiumTone.electricBase }]} />
            <View style={[styles.premiumPulseSegment, { left: Math.round(topPulseW * 0.5), top: 3, width: Math.round(topPulseW * 0.16), backgroundColor: premiumTone.electricHot }]} />
            <View style={[styles.premiumPulseSegmentCore, { left: Math.round(topPulseW * 0.66), top: 2, width: Math.round(topPulseW * 0.22), backgroundColor: premiumTone.electricBase }]} />
            <View style={[styles.premiumPulseBranch, { left: Math.round(topPulseW * 0.28), top: 0, height: 3, backgroundColor: premiumTone.electricSoft }]} />
            <View style={[styles.premiumPulseBranch, { left: Math.round(topPulseW * 0.58), top: 4, height: 2, backgroundColor: premiumTone.electricHot }]} />
            <View style={[styles.premiumPulseBranch, { left: Math.round(topPulseW * 0.8), top: 1, height: 3, backgroundColor: premiumTone.electricSoft }]} />
          </Animated.View>
        </View>

        <View style={[styles.premiumEdgeTrackVertical, { top: outerSpread + verticalEdgeInset, right: outerSpread - 3, height: verticalTrackLength }]}>
          <Animated.View style={[styles.premiumRailVertical, { backgroundColor: premiumTone.electricDim, opacity: premiumRailOpacity }]} />
          <Animated.View
            style={[
              styles.premiumPulseClusterVertical,
              {
                height: sidePulseH,
                opacity: premiumRightOpacity,
                transform: [{ translateY: premiumRightY }],
              },
            ]}
          >
            <View style={[styles.premiumPulseSegmentVertical, { left: 3, top: 0, height: Math.round(sidePulseH * 0.18), backgroundColor: premiumTone.electricSoft }]} />
            <View style={[styles.premiumPulseSegmentVerticalCore, { left: 2, top: Math.round(sidePulseH * 0.22), height: Math.round(sidePulseH * 0.24), backgroundColor: premiumTone.electricBase }]} />
            <View style={[styles.premiumPulseSegmentVertical, { left: 3, top: Math.round(sidePulseH * 0.54), height: Math.round(sidePulseH * 0.16), backgroundColor: premiumTone.electricHot }]} />
            <View style={[styles.premiumPulseSegmentVerticalCore, { left: 2, top: Math.round(sidePulseH * 0.72), height: Math.round(sidePulseH * 0.2), backgroundColor: premiumTone.electricBase }]} />
            <View style={[styles.premiumPulseBranchVertical, { left: 0, top: Math.round(sidePulseH * 0.28), width: 3, backgroundColor: premiumTone.electricSoft }]} />
            <View style={[styles.premiumPulseBranchVertical, { left: 4, top: Math.round(sidePulseH * 0.6), width: 2, backgroundColor: premiumTone.electricHot }]} />
            <View style={[styles.premiumPulseBranchVertical, { left: 1, top: Math.round(sidePulseH * 0.82), width: 3, backgroundColor: premiumTone.electricSoft }]} />
          </Animated.View>
        </View>

        <View style={[styles.premiumEdgeTrack, { bottom: outerSpread - 3, left: outerSpread + edgeInset, width: horizontalTrackLength }]}>
          <Animated.View style={[styles.premiumRail, { backgroundColor: premiumTone.electricDim, opacity: premiumRailOpacity }]} />
          <Animated.View
            style={[
              styles.premiumPulseCluster,
              {
                width: topPulseW,
                opacity: premiumBottomOpacity,
                transform: [{ translateX: premiumBottomX }],
              },
            ]}
          >
            <View style={[styles.premiumPulseSegment, { left: 0, top: 3, width: Math.round(topPulseW * 0.18), backgroundColor: premiumTone.electricSoft }]} />
            <View style={[styles.premiumPulseSegmentCore, { left: Math.round(topPulseW * 0.18), top: 2, width: Math.round(topPulseW * 0.24), backgroundColor: premiumTone.electricBase }]} />
            <View style={[styles.premiumPulseSegment, { left: Math.round(topPulseW * 0.48), top: 3, width: Math.round(topPulseW * 0.18), backgroundColor: premiumTone.electricHot }]} />
            <View style={[styles.premiumPulseSegmentCore, { left: Math.round(topPulseW * 0.68), top: 2, width: Math.round(topPulseW * 0.2), backgroundColor: premiumTone.electricBase }]} />
            <View style={[styles.premiumPulseBranch, { left: Math.round(topPulseW * 0.22), top: 1, height: 3, backgroundColor: premiumTone.electricSoft }]} />
            <View style={[styles.premiumPulseBranch, { left: Math.round(topPulseW * 0.54), top: 4, height: 2, backgroundColor: premiumTone.electricHot }]} />
            <View style={[styles.premiumPulseBranch, { left: Math.round(topPulseW * 0.78), top: 0, height: 3, backgroundColor: premiumTone.electricSoft }]} />
          </Animated.View>
        </View>

        <View style={[styles.premiumEdgeTrackVertical, { top: outerSpread + verticalEdgeInset, left: outerSpread - 3, height: verticalTrackLength }]}>
          <Animated.View style={[styles.premiumRailVertical, { backgroundColor: premiumTone.electricDim, opacity: premiumRailOpacity }]} />
          <Animated.View
            style={[
              styles.premiumPulseClusterVertical,
              {
                height: sidePulseH,
                opacity: premiumLeftOpacity,
                transform: [{ translateY: premiumLeftY }],
              },
            ]}
          >
            <View style={[styles.premiumPulseSegmentVertical, { left: 3, top: 0, height: Math.round(sidePulseH * 0.18), backgroundColor: premiumTone.electricSoft }]} />
            <View style={[styles.premiumPulseSegmentVerticalCore, { left: 2, top: Math.round(sidePulseH * 0.2), height: Math.round(sidePulseH * 0.24), backgroundColor: premiumTone.electricBase }]} />
            <View style={[styles.premiumPulseSegmentVertical, { left: 3, top: Math.round(sidePulseH * 0.52), height: Math.round(sidePulseH * 0.18), backgroundColor: premiumTone.electricHot }]} />
            <View style={[styles.premiumPulseSegmentVerticalCore, { left: 2, top: Math.round(sidePulseH * 0.72), height: Math.round(sidePulseH * 0.2), backgroundColor: premiumTone.electricBase }]} />
            <View style={[styles.premiumPulseBranchVertical, { left: 3, top: Math.round(sidePulseH * 0.26), width: 3, backgroundColor: premiumTone.electricSoft }]} />
            <View style={[styles.premiumPulseBranchVertical, { left: 0, top: Math.round(sidePulseH * 0.6), width: 2, backgroundColor: premiumTone.electricHot }]} />
            <View style={[styles.premiumPulseBranchVertical, { left: 2, top: Math.round(sidePulseH * 0.84), width: 3, backgroundColor: premiumTone.electricSoft }]} />
          </Animated.View>
        </View>
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
  premiumEdgeTrack: {
    position: 'absolute',
    height: 8,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  premiumEdgeTrackVertical: {
    position: 'absolute',
    width: 8,
    overflow: 'hidden',
    alignItems: 'center',
  },
  premiumRail: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 3,
    height: 1.2,
    borderRadius: 999,
  },
  premiumRailVertical: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 3,
    width: 1.2,
    borderRadius: 999,
  },
  premiumPulseCluster: {
    position: 'absolute',
    left: 0,
    top: 0,
    height: 8,
  },
  premiumPulseClusterVertical: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 8,
  },
  premiumPulseSegment: {
    position: 'absolute',
    height: 1.4,
    borderRadius: 999,
  },
  premiumPulseSegmentCore: {
    position: 'absolute',
    height: 2.2,
    borderRadius: 999,
  },
  premiumPulseSegmentVertical: {
    position: 'absolute',
    width: 1.4,
    borderRadius: 999,
  },
  premiumPulseSegmentVerticalCore: {
    position: 'absolute',
    width: 2.2,
    borderRadius: 999,
  },
  premiumPulseBranch: {
    position: 'absolute',
    width: 1.2,
    borderRadius: 999,
  },
  premiumPulseBranchVertical: {
    position: 'absolute',
    height: 1.2,
    borderRadius: 999,
  },
  premiumCornerHorizontal: {
    position: 'absolute',
    height: 1.6,
    borderRadius: 999,
  },
  premiumCornerVertical: {
    position: 'absolute',
    width: 1.6,
    borderRadius: 999,
  },
  premiumSheenTrack: {
    position: 'absolute',
    overflow: 'hidden',
    borderRadius: 999,
  },
  premiumSheenBand: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 999,
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
