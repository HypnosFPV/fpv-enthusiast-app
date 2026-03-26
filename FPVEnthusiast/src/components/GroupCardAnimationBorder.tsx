import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, {
  ClipPath,
  Defs,
  G,
  Line,
  LinearGradient as SvgLinearGradient,
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
    } else if (isPremium) {
      orbitLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(orbitAnim, {
            toValue: 4,
            duration: 6800,
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
    outputRange: [0.96, 1, 0.96],
  });
  const premiumRailOpacity = pulseAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.42, 0.78, 0.42],
  });
  const premiumGlowOpacity = pulseAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.12, 0.28, 0.12],
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
    carbonShadow: mixColors(borderColor, '#050507', 0.82),
    carbonBase: mixColors(mixColors(borderColor, accentColor, 0.42), '#09090d', 0.56),
    carbonMid: mixColors(mixColors(borderColor, accentColor, 0.56), '#1c1622', 0.34),
    carbonHigh: mixColors(accentColor, '#ffffff', 0.12),
    carbonPanelA: withAlpha(mixColors(accentColor, '#0c0c10', 0.74), 0.22),
    carbonPanelB: withAlpha(mixColors(borderColor, '#060608', 0.78), 0.28),
    carbonWeaveA: withAlpha(mixColors(accentColor, '#ffffff', 0.08), 0.16),
    carbonWeaveB: withAlpha(mixColors(borderColor, '#000000', 0.22), 0.2),
    carbonTopTint: withAlpha(mixColors(accentColor, '#ffffff', 0.14), 0.1),
    carbonBottomTint: withAlpha(mixColors(borderColor, '#000000', 0.46), 0.18),
    carbonFrameOuter: withAlpha(mixColors(borderColor, '#000000', 0.28), 0.94),
    carbonFrameInner: withAlpha(mixColors(accentColor, '#000000', 0.18), 0.82),
    electricBase: accentColor,
    electricHot: mixColors(accentColor, '#ffffff', 0.16),
    electricGhost: withAlpha(accentColor, 0.14),
    electricSoft: withAlpha(accentColor, 0.66),
    electricLine: withAlpha(accentColor, 0.92),
    electricDim: withAlpha(mixColors(borderColor, accentColor, 0.7), 0.48),
    electricGlow: withAlpha(accentColor, 0.24),
    electricGlowStrong: withAlpha(mixColors(accentColor, '#ffffff', 0.18), 0.34),
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

    const innerInset = 2;
    const innerFrameX = frameX + innerInset;
    const innerFrameY = frameY + innerInset;
    const innerFrameW = Math.max(frameW - innerInset * 2, 0);
    const innerFrameH = Math.max(frameH - innerInset * 2, 0);
    const innerFrameR = Math.max(frameR - innerInset, 1);

    const clipId = `${premiumIdBase}-carbon-clip`;
    const carbonFillId = `${premiumIdBase}-carbon-fill`;
    const carbonTopId = `${premiumIdBase}-carbon-top`;
    const electricOuterId = `${premiumIdBase}-electric-outer`;
    const electricInnerId = `${premiumIdBase}-electric-inner`;

    const weavePitch = 18;
    const weaveBandPitch = 52;
    const weaveLineCount = Math.ceil((frameW + frameH) / weavePitch) + 4;
    const weaveBandCount = Math.ceil((frameW + frameH) / weaveBandPitch) + 4;

    const outerEdgeX = frameX - 1.5;
    const outerEdgeY = frameY - 1.5;
    const outerEdgeW = frameW + 3;
    const outerEdgeH = frameH + 3;
    const outerEdgeR = frameR + 2;

    const innerEdgeX = frameX + 3;
    const innerEdgeY = frameY + 3;
    const innerEdgeW = Math.max(frameW - 6, 0);
    const innerEdgeH = Math.max(frameH - 6, 0);
    const innerEdgeR = Math.max(frameR - 3, 1);

    const cornerBracket = clamp(cornerRadius + 5, 16, 22);
    const cornerInset = 8;

    return (
      <Animated.View pointerEvents="none" style={[styles.wrap, dynamicStyles.wrap, dynamicStyles.premiumCanvas, { zIndex: 0 }]}>
        <Animated.View style={[styles.premiumLayer, dynamicStyles.premiumLayer, { opacity: premiumCarbonOpacity }]}>
          <Svg width={premiumCanvasWidth} height={premiumCanvasHeight}>
            <Defs>
              <ClipPath id={clipId}>
                <Rect x={frameX} y={frameY} width={frameW} height={frameH} rx={frameR} ry={frameR} />
              </ClipPath>
              <SvgLinearGradient id={carbonFillId} x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0%" stopColor={premiumTone.carbonMid} />
                <Stop offset="38%" stopColor={premiumTone.carbonBase} />
                <Stop offset="72%" stopColor={premiumTone.carbonMid} />
                <Stop offset="100%" stopColor={premiumTone.carbonShadow} />
              </SvgLinearGradient>
              <SvgLinearGradient id={carbonTopId} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor={premiumTone.carbonHigh} stopOpacity="0.42" />
                <Stop offset="42%" stopColor={premiumTone.carbonTopTint} stopOpacity="0.22" />
                <Stop offset="100%" stopColor={premiumTone.carbonShadow} stopOpacity="0" />
              </SvgLinearGradient>
              <SvgLinearGradient id={electricOuterId} x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0%" stopColor={premiumTone.electricGhost} />
                <Stop offset="18%" stopColor={premiumTone.electricLine} />
                <Stop offset="52%" stopColor={premiumTone.electricHot} />
                <Stop offset="82%" stopColor={premiumTone.electricLine} />
                <Stop offset="100%" stopColor={premiumTone.electricGhost} />
              </SvgLinearGradient>
              <SvgLinearGradient id={electricInnerId} x1="1" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor={premiumTone.electricGhost} />
                <Stop offset="22%" stopColor={premiumTone.electricBase} />
                <Stop offset="50%" stopColor={premiumTone.electricHot} />
                <Stop offset="78%" stopColor={premiumTone.electricBase} />
                <Stop offset="100%" stopColor={premiumTone.electricGhost} />
              </SvgLinearGradient>
            </Defs>

            <Rect x={frameX} y={frameY} width={frameW} height={frameH} rx={frameR} ry={frameR} fill={`url(#${carbonFillId})`} />
            <Rect x={frameX} y={frameY} width={frameW} height={frameH} rx={frameR} ry={frameR} fill={`url(#${carbonTopId})`} opacity={0.54} />

            <G clipPath={`url(#${clipId})`}>
              {Array.from({ length: weaveBandCount }).map((_, index) => {
                const startX = frameX - frameH + index * weaveBandPitch;
                return (
                  <Line
                    key={`premium-band-a-${index}`}
                    x1={startX}
                    y1={frameY + frameH}
                    x2={startX + frameH}
                    y2={frameY}
                    stroke={premiumTone.carbonPanelA}
                    strokeWidth={14}
                    strokeLinecap="square"
                  />
                );
              })}
              {Array.from({ length: weaveBandCount }).map((_, index) => {
                const startX = frameX - 24 + index * weaveBandPitch;
                return (
                  <Line
                    key={`premium-band-b-${index}`}
                    x1={startX}
                    y1={frameY}
                    x2={startX + frameH}
                    y2={frameY + frameH}
                    stroke={premiumTone.carbonPanelB}
                    strokeWidth={12}
                    strokeLinecap="square"
                  />
                );
              })}
              {Array.from({ length: weaveLineCount }).map((_, index) => {
                const startX = frameX - frameH + index * weavePitch;
                return (
                  <Line
                    key={`premium-weave-a-${index}`}
                    x1={startX}
                    y1={frameY + frameH}
                    x2={startX + frameH}
                    y2={frameY}
                    stroke={premiumTone.carbonWeaveA}
                    strokeWidth={1.2}
                    strokeLinecap="round"
                  />
                );
              })}
              {Array.from({ length: weaveLineCount }).map((_, index) => {
                const startX = frameX - 14 + index * weavePitch;
                return (
                  <Line
                    key={`premium-weave-b-${index}`}
                    x1={startX}
                    y1={frameY}
                    x2={startX + frameH}
                    y2={frameY + frameH}
                    stroke={premiumTone.carbonWeaveB}
                    strokeWidth={1.1}
                    strokeLinecap="round"
                  />
                );
              })}
              <Rect x={frameX} y={frameY} width={frameW} height={Math.max(frameH * 0.2, 30)} fill={premiumTone.carbonTopTint} />
              <Rect x={frameX} y={frameY + frameH * 0.72} width={frameW} height={Math.max(frameH * 0.28, 38)} fill={premiumTone.carbonBottomTint} />
            </G>

            <Rect x={frameX} y={frameY} width={frameW} height={frameH} rx={frameR} ry={frameR} stroke={premiumTone.carbonFrameOuter} strokeWidth={1.4} fill="none" />
            <Rect x={innerFrameX} y={innerFrameY} width={innerFrameW} height={innerFrameH} rx={innerFrameR} ry={innerFrameR} stroke={premiumTone.carbonFrameInner} strokeWidth={1} fill="none" />

            <Rect x={outerEdgeX} y={outerEdgeY} width={outerEdgeW} height={outerEdgeH} rx={outerEdgeR} ry={outerEdgeR} stroke={`url(#${electricOuterId})`} strokeWidth={1.4} strokeDasharray="10 12 5 16" strokeLinecap="round" fill="none" opacity={0.92} />
            <Rect x={innerEdgeX} y={innerEdgeY} width={innerEdgeW} height={innerEdgeH} rx={innerEdgeR} ry={innerEdgeR} stroke={`url(#${electricInnerId})`} strokeWidth={0.9} strokeDasharray="6 14 4 10" strokeLinecap="round" fill="none" opacity={0.74} />

            <Line x1={frameX + cornerInset} y1={frameY + 1} x2={frameX + cornerInset + cornerBracket} y2={frameY + 1} stroke={premiumTone.electricLine} strokeWidth={1.6} strokeLinecap="round" opacity={0.58} />
            <Line x1={frameX + 1} y1={frameY + cornerInset} x2={frameX + 1} y2={frameY + cornerInset + cornerBracket} stroke={premiumTone.electricLine} strokeWidth={1.6} strokeLinecap="round" opacity={0.58} />
            <Line x1={frameX + frameW - cornerInset - cornerBracket} y1={frameY + 1} x2={frameX + frameW - cornerInset} y2={frameY + 1} stroke={premiumTone.electricLine} strokeWidth={1.6} strokeLinecap="round" opacity={0.58} />
            <Line x1={frameX + frameW - 1} y1={frameY + cornerInset} x2={frameX + frameW - 1} y2={frameY + cornerInset + cornerBracket} stroke={premiumTone.electricLine} strokeWidth={1.6} strokeLinecap="round" opacity={0.58} />
            <Line x1={frameX + cornerInset} y1={frameY + frameH - 1} x2={frameX + cornerInset + cornerBracket} y2={frameY + frameH - 1} stroke={premiumTone.electricLine} strokeWidth={1.6} strokeLinecap="round" opacity={0.34} />
            <Line x1={frameX + 1} y1={frameY + frameH - cornerInset - cornerBracket} x2={frameX + 1} y2={frameY + frameH - cornerInset} stroke={premiumTone.electricLine} strokeWidth={1.6} strokeLinecap="round" opacity={0.34} />
            <Line x1={frameX + frameW - cornerInset - cornerBracket} y1={frameY + frameH - 1} x2={frameX + frameW - cornerInset} y2={frameY + frameH - 1} stroke={premiumTone.electricLine} strokeWidth={1.6} strokeLinecap="round" opacity={0.34} />
            <Line x1={frameX + frameW - 1} y1={frameY + frameH - cornerInset - cornerBracket} x2={frameX + frameW - 1} y2={frameY + frameH - cornerInset} stroke={premiumTone.electricLine} strokeWidth={1.6} strokeLinecap="round" opacity={0.34} />
          </Svg>
        </Animated.View>

        <Animated.View
          style={[
            styles.premiumElectricHalo,
            {
              top: outerSpread - 1,
              right: outerSpread - 1,
              bottom: outerSpread - 1,
              left: outerSpread - 1,
              borderRadius: cornerRadius + 3,
              borderColor: premiumTone.electricGlowStrong,
              shadowColor: accentColor,
              opacity: premiumGlowOpacity,
            },
          ]}
        />

        <View style={[styles.standardTrack, dynamicStyles.standardTopTrack]}>
          <Animated.View
            style={[
              styles.horizontalComet,
              {
                width: premiumHorizontalCometWidth,
                height: 2.2,
                opacity: premiumTopOpacity,
                shadowColor: accentColor,
                transform: [{ translateX: premiumTopX }],
              },
            ]}
          >
            <LinearGradient colors={['transparent', premiumTone.electricGhost, premiumTone.electricSoft, premiumTone.electricHot, premiumTone.electricSoft, premiumTone.electricGhost, 'transparent']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.fill} />
          </Animated.View>
        </View>
        <View style={[styles.standardVerticalTrack, dynamicStyles.standardRightTrack]}>
          <Animated.View
            style={[
              styles.verticalComet,
              {
                width: 2.2,
                height: premiumVerticalCometHeight,
                opacity: premiumRightOpacity,
                shadowColor: accentColor,
                transform: [{ translateY: premiumRightY }],
              },
            ]}
          >
            <LinearGradient colors={['transparent', premiumTone.electricGhost, premiumTone.electricSoft, premiumTone.electricHot, premiumTone.electricSoft, premiumTone.electricGhost, 'transparent']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={styles.fill} />
          </Animated.View>
        </View>
        <View style={[styles.standardTrack, dynamicStyles.standardBottomTrack]}>
          <Animated.View
            style={[
              styles.horizontalComet,
              {
                width: premiumHorizontalCometWidth,
                height: 2.2,
                opacity: premiumBottomOpacity,
                shadowColor: accentColor,
                transform: [{ translateX: premiumBottomX }],
              },
            ]}
          >
            <LinearGradient colors={['transparent', premiumTone.electricGhost, premiumTone.electricSoft, premiumTone.electricHot, premiumTone.electricSoft, premiumTone.electricGhost, 'transparent']} start={{ x: 1, y: 0.5 }} end={{ x: 0, y: 0.5 }} style={styles.fill} />
          </Animated.View>
        </View>
        <View style={[styles.standardVerticalTrack, dynamicStyles.standardLeftTrack]}>
          <Animated.View
            style={[
              styles.verticalComet,
              {
                width: 2.2,
                height: premiumVerticalCometHeight,
                opacity: premiumLeftOpacity,
                shadowColor: accentColor,
                transform: [{ translateY: premiumLeftY }],
              },
            ]}
          >
            <LinearGradient colors={['transparent', premiumTone.electricGhost, premiumTone.electricSoft, premiumTone.electricHot, premiumTone.electricSoft, premiumTone.electricGhost, 'transparent']} start={{ x: 0.5, y: 1 }} end={{ x: 0.5, y: 0 }} style={styles.fill} />
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
  premiumElectricHalo: {
    position: 'absolute',
    borderWidth: 1,
    shadowOpacity: 0.42,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
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
