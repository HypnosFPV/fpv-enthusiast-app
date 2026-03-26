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
  Polyline,
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


function buildPolylinePoints(points: Array<[number, number]>) {
  return points.map(([x, y]) => `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`).join(' ');
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
          duration: isPremium ? 720 : isStandard ? 3000 : 2600,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: isPremium ? 720 : isStandard ? 3000 : 2600,
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
            duration: 2200,
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
    outputRange: [0.07, 0.13],
  });
  const basicSweepOpacity = pulseAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.24, 0.4, 0.28],
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
    inputRange: [0, 0.08, 0.16, 0.28, 0.42, 0.58, 0.74, 0.88, 1],
    outputRange: [0.62, 1, 0.54, 0.98, 0.6, 1, 0.66, 0.94, 0.72],
  });
  const premiumRailCoreOpacity = pulseAnim.interpolate({
    inputRange: [0, 0.08, 0.16, 0.28, 0.42, 0.58, 0.74, 0.88, 1],
    outputRange: [0.28, 1, 0.2, 1, 0.32, 1, 0.38, 0.96, 0.48],
  });
  const premiumFlashOpacity = pulseAnim.interpolate({
    inputRange: [0, 0.04, 0.1, 0.18, 0.3, 0.44, 0.6, 0.76, 0.9, 1],
    outputRange: [0.12, 1, 0.18, 0.96, 0.22, 1, 0.26, 1, 0.3, 0.14],
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

  const premiumTopOpacity = buildSegmentOpacity(orbitAnim, 0, 1);
  const premiumRightOpacity = buildSegmentOpacity(orbitAnim, 1, 1);
  const premiumBottomOpacity = buildSegmentOpacity(orbitAnim, 2, 1);
  const premiumLeftOpacity = buildSegmentOpacity(orbitAnim, 3, 1);

  const premiumTone = useMemo(() => ({
    carbonShadow: mixColors(borderColor, '#000000', 0.95),
    carbonBase: mixColors(mixColors(accentColor, borderColor, 0.18), '#020204', 0.9),
    carbonLift: withAlpha(mixColors(accentColor, '#a987d4', 0.2), 0.18),
    carbonWeaveShadow: withAlpha(mixColors(borderColor, '#000000', 0.86), 0.58),
    carbonWeaveLight: withAlpha(mixColors(accentColor, '#7a53a5', 0.2), 0.3),
    carbonWeaveMicro: withAlpha(mixColors(borderColor, '#18111e', 0.4), 0.25),
    carbonTint: withAlpha(accentColor, 0.16),
    carbonGloss: withAlpha(mixColors(accentColor, '#f2e5ff', 0.14), 0.1),
    carbonFrameOuter: withAlpha(mixColors(borderColor, '#000000', 0.32), 0.98),
    carbonFrameInner: withAlpha(mixColors(accentColor, borderColor, 0.08), 0.58),
    electricDim: withAlpha(accentColor, 0.62),
    electricSoft: withAlpha(accentColor, 1),
    electricBase: accentColor,
    electricHot: mixColors(accentColor, '#ffffff', 0.46),
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
    const fineWeaveCount = Math.ceil((frameW + frameH) / 8) + 20;
    const microWeaveCount = Math.ceil((frameW + frameH) / 4) + 34;
    const topPulseW = clamp(horizontalTrackLength * 0.48, 132, 196);
    const sidePulseH = clamp(verticalTrackLength * 0.5, 124, 198);
    const edgeInset = Math.max(frameInset - 4, 8);
    const verticalEdgeInset = Math.max(verticalInset - 4, 8);
    const cornerFork = clamp(cornerRadius + 12, 20, 38);

    const topBoltPoints = buildPolylinePoints([
      [0, 5],
      [topPulseW * 0.08, 4.1],
      [topPulseW * 0.16, 6.1],
      [topPulseW * 0.26, 3.1],
      [topPulseW * 0.36, 6.3],
      [topPulseW * 0.48, 2.8],
      [topPulseW * 0.6, 5.8],
      [topPulseW * 0.72, 3.6],
      [topPulseW * 0.84, 5.5],
      [topPulseW, 4.4],
    ]);
    const bottomBoltPoints = buildPolylinePoints([
      [0, 4.8],
      [topPulseW * 0.1, 6.1],
      [topPulseW * 0.2, 3.6],
      [topPulseW * 0.31, 6.4],
      [topPulseW * 0.42, 3.1],
      [topPulseW * 0.54, 6],
      [topPulseW * 0.66, 3.8],
      [topPulseW * 0.77, 5.7],
      [topPulseW * 0.9, 3.5],
      [topPulseW, 5],
    ]);
    const rightBoltPoints = buildPolylinePoints([
      [5, 0],
      [3.9, sidePulseH * 0.1],
      [6.2, sidePulseH * 0.2],
      [3.2, sidePulseH * 0.31],
      [6.1, sidePulseH * 0.44],
      [3.6, sidePulseH * 0.57],
      [6, sidePulseH * 0.69],
      [4, sidePulseH * 0.82],
      [5.8, sidePulseH * 0.92],
      [4.6, sidePulseH],
    ]);
    const leftBoltPoints = buildPolylinePoints([
      [4.7, 0],
      [6, sidePulseH * 0.09],
      [3.4, sidePulseH * 0.19],
      [6.3, sidePulseH * 0.33],
      [3.9, sidePulseH * 0.46],
      [6.1, sidePulseH * 0.59],
      [3.3, sidePulseH * 0.73],
      [5.7, sidePulseH * 0.86],
      [4.1, sidePulseH],
    ]);

    return (
      <Animated.View pointerEvents="none" style={[styles.wrap, dynamicStyles.wrap, dynamicStyles.premiumCanvas, { zIndex: 0 }]}>
        <Animated.View style={[styles.premiumLayer, dynamicStyles.premiumLayer, { opacity: premiumCarbonOpacity }]}>
          <Svg width={premiumCanvasWidth} height={premiumCanvasHeight}>
            <Defs>
              <ClipPath id={clipId}>
                <Rect x={frameX} y={frameY} width={frameW} height={frameH} rx={frameR} ry={frameR} />
              </ClipPath>
              <Pattern id={patternId} patternUnits="userSpaceOnUse" width={12} height={12}>
                <Rect x={0} y={0} width={12} height={12} fill={premiumTone.carbonBase} />
                <Line x1={-4} y1={12} x2={4} y2={0} stroke={premiumTone.carbonWeaveShadow} strokeWidth={4.4} strokeLinecap="square" />
                <Line x1={2} y1={12} x2={10} y2={0} stroke={premiumTone.carbonWeaveLight} strokeWidth={3.4} strokeLinecap="square" />
                <Line x1={8} y1={12} x2={16} y2={0} stroke={premiumTone.carbonWeaveShadow} strokeWidth={4.4} strokeLinecap="square" />
                <Line x1={-2} y1={1} x2={10} y2={13} stroke={premiumTone.carbonWeaveMicro} strokeWidth={1.1} strokeLinecap="square" />
                <Line x1={5} y1={-1} x2={13} y2={7} stroke={premiumTone.carbonLift} strokeWidth={0.9} strokeLinecap="square" />
                <Rect x={0} y={0} width={12} height={3.6} fill={premiumTone.carbonGloss} />
              </Pattern>
            </Defs>

            <Rect x={frameX} y={frameY} width={frameW} height={frameH} rx={frameR} ry={frameR} fill={premiumTone.carbonShadow} />
            <G clipPath={`url(#${clipId})`}>
              <Rect x={frameX} y={frameY} width={frameW} height={frameH} fill={`url(#${patternId})`} />
              <Rect x={frameX} y={frameY} width={frameW} height={frameH} fill={premiumTone.carbonTint} />
              <Rect x={frameX} y={frameY + frameH * 0.18} width={frameW} height={Math.max(frameH * 0.22, 18)} fill={withAlpha(accentColor, 0.035)} />
              {Array.from({ length: fineWeaveCount }).map((_, index) => {
                const startX = frameX - frameH + index * 8;
                return (
                  <Line
                    key={`premium-fine-a-${index}`}
                    x1={startX}
                    y1={frameY + frameH}
                    x2={startX + frameH}
                    y2={frameY}
                    stroke={index % 4 < 2 ? premiumTone.carbonWeaveLight : premiumTone.carbonWeaveShadow}
                    strokeWidth={index % 4 === 0 ? 2.2 : 1.5}
                    strokeLinecap="square"
                  />
                );
              })}
              {Array.from({ length: fineWeaveCount }).map((_, index) => {
                const startX = frameX - 8 + index * 8;
                return (
                  <Line
                    key={`premium-fine-b-${index}`}
                    x1={startX}
                    y1={frameY}
                    x2={startX + frameH}
                    y2={frameY + frameH}
                    stroke={index % 5 === 0 ? premiumTone.carbonLift : premiumTone.carbonWeaveMicro}
                    strokeWidth={index % 2 === 0 ? 1.05 : 0.82}
                    strokeLinecap="square"
                  />
                );
              })}
              {Array.from({ length: microWeaveCount }).map((_, index) => {
                const startX = frameX - frameH + index * 4;
                return (
                  <Line
                    key={`premium-micro-a-${index}`}
                    x1={startX}
                    y1={frameY + frameH}
                    x2={startX + frameH}
                    y2={frameY}
                    stroke={premiumTone.carbonWeaveMicro}
                    strokeWidth={0.48}
                    strokeLinecap="square"
                  />
                );
              })}
              <Rect x={frameX} y={frameY} width={frameW} height={Math.max(frameH * 0.1, 14)} fill={premiumTone.carbonGloss} />
              <Rect x={frameX} y={frameY + frameH * 0.52} width={frameW} height={Math.max(frameH * 0.48, 38)} fill={withAlpha('#000000', 0.22)} />
            </G>

            <Rect x={frameX} y={frameY} width={frameW} height={frameH} rx={frameR} ry={frameR} stroke={premiumTone.carbonFrameOuter} strokeWidth={1.05} fill="none" />
            <Rect x={innerFrameX} y={innerFrameY} width={innerFrameW} height={innerFrameH} rx={innerFrameR} ry={innerFrameR} stroke={premiumTone.carbonFrameInner} strokeWidth={0.85} fill="none" />

            <Line x1={frameX + edgeInset} y1={frameY + 0.8} x2={frameX + frameW - edgeInset} y2={frameY + 0.8} stroke={premiumTone.electricDim} strokeWidth={1.15} strokeLinecap="square" />
            <Line x1={frameX + edgeInset} y1={frameY + frameH - 0.8} x2={frameX + frameW - edgeInset} y2={frameY + frameH - 0.8} stroke={premiumTone.electricDim} strokeWidth={1.15} strokeLinecap="square" />
            <Line x1={frameX + 0.8} y1={frameY + verticalEdgeInset} x2={frameX + 0.8} y2={frameY + frameH - verticalEdgeInset} stroke={premiumTone.electricDim} strokeWidth={1.15} strokeLinecap="square" />
            <Line x1={frameX + frameW - 0.8} y1={frameY + verticalEdgeInset} x2={frameX + frameW - 0.8} y2={frameY + frameH - verticalEdgeInset} stroke={premiumTone.electricDim} strokeWidth={1.15} strokeLinecap="square" />
            <Line x1={frameX + 1.8} y1={frameY + cornerFork} x2={frameX + cornerFork} y2={frameY + 1.8} stroke={premiumTone.electricBase} strokeOpacity={0.54} strokeWidth={1.9} strokeLinecap="square" />
            <Line x1={frameX + frameW - cornerFork} y1={frameY + 1.8} x2={frameX + frameW - 1.8} y2={frameY + cornerFork} stroke={premiumTone.electricBase} strokeOpacity={0.54} strokeWidth={1.9} strokeLinecap="square" />
            <Line x1={frameX + 1.8} y1={frameY + frameH - cornerFork} x2={frameX + cornerFork} y2={frameY + frameH - 1.8} stroke={premiumTone.electricBase} strokeOpacity={0.54} strokeWidth={1.9} strokeLinecap="square" />
            <Line x1={frameX + frameW - cornerFork} y1={frameY + frameH - 1.8} x2={frameX + frameW - 1.8} y2={frameY + frameH - cornerFork} stroke={premiumTone.electricBase} strokeOpacity={0.54} strokeWidth={1.9} strokeLinecap="square" />
          </Svg>
        </Animated.View>

        <View style={[styles.premiumEdgeTrack, { top: outerSpread - 3, left: outerSpread + edgeInset, width: horizontalTrackLength }]}>
          <Animated.View style={[styles.premiumRail, { backgroundColor: premiumTone.electricDim, opacity: premiumRailOpacity }]} />
          <Animated.View style={[styles.premiumRailCore, { backgroundColor: premiumTone.electricBase, opacity: premiumRailCoreOpacity }]} />
          <Animated.View style={[styles.premiumRailFlash, { backgroundColor: premiumTone.electricHot, opacity: premiumFlashOpacity }]} />
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
            <Svg width={topPulseW} height={14}>
              <Polyline points={topBoltPoints} fill="none" stroke={premiumTone.electricSoft} strokeWidth={4.4} strokeOpacity={0.44} strokeLinecap="square" strokeLinejoin="miter" />
              <Polyline points={topBoltPoints} fill="none" stroke={premiumTone.electricBase} strokeWidth={2.9} strokeLinecap="square" strokeLinejoin="miter" />
              <Polyline points={topBoltPoints} fill="none" stroke={premiumTone.electricHot} strokeWidth={1.45} strokeLinecap="square" strokeLinejoin="miter" />
              <Line x1={topPulseW * 0.1} y1={4.3} x2={topPulseW * 0.05} y2={1.2} stroke={premiumTone.electricSoft} strokeWidth={1.25} strokeLinecap="square" />
              <Line x1={topPulseW * 0.16} y1={6.1} x2={topPulseW * 0.11} y2={10.6} stroke={premiumTone.electricBase} strokeWidth={1.45} strokeLinecap="square" />
              <Line x1={topPulseW * 0.23} y1={3.4} x2={topPulseW * 0.3} y2={1.4} stroke={premiumTone.electricHot} strokeWidth={1.15} strokeLinecap="square" />
              <Line x1={topPulseW * 0.36} y1={6.3} x2={topPulseW * 0.32} y2={11.1} stroke={premiumTone.electricBase} strokeWidth={1.15} strokeLinecap="square" />
              <Line x1={topPulseW * 0.48} y1={2.8} x2={topPulseW * 0.43} y2={0.8} stroke={premiumTone.electricHot} strokeWidth={1.1} strokeLinecap="square" />
              <Line x1={topPulseW * 0.56} y1={5.1} x2={topPulseW * 0.62} y2={8.8} stroke={premiumTone.electricSoft} strokeWidth={1.1} strokeLinecap="square" />
              <Line x1={topPulseW * 0.72} y1={3.6} x2={topPulseW * 0.77} y2={0.9} stroke={premiumTone.electricBase} strokeWidth={1.12} strokeLinecap="square" />
              <Line x1={topPulseW * 0.84} y1={5.5} x2={topPulseW * 0.89} y2={9.4} stroke={premiumTone.electricSoft} strokeWidth={1.05} strokeLinecap="square" />
              <Line x1={topPulseW * 0.9} y1={4.6} x2={topPulseW * 0.97} y2={2.2} stroke={premiumTone.electricHot} strokeWidth={1.05} strokeLinecap="square" />
            </Svg>
          </Animated.View>
        </View>

        <View style={[styles.premiumEdgeTrackVertical, { top: outerSpread + verticalEdgeInset, right: outerSpread - 3, height: verticalTrackLength }]}>
          <Animated.View style={[styles.premiumRailVertical, { backgroundColor: premiumTone.electricDim, opacity: premiumRailOpacity }]} />
          <Animated.View style={[styles.premiumRailVerticalCore, { backgroundColor: premiumTone.electricBase, opacity: premiumRailCoreOpacity }]} />
          <Animated.View style={[styles.premiumRailVerticalFlash, { backgroundColor: premiumTone.electricHot, opacity: premiumFlashOpacity }]} />
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
            <Svg width={14} height={sidePulseH}>
              <Polyline points={rightBoltPoints} fill="none" stroke={premiumTone.electricSoft} strokeWidth={4.4} strokeOpacity={0.44} strokeLinecap="square" strokeLinejoin="miter" />
              <Polyline points={rightBoltPoints} fill="none" stroke={premiumTone.electricBase} strokeWidth={2.9} strokeLinecap="square" strokeLinejoin="miter" />
              <Polyline points={rightBoltPoints} fill="none" stroke={premiumTone.electricHot} strokeWidth={1.45} strokeLinecap="square" strokeLinejoin="miter" />
              <Line x1={3.9} y1={sidePulseH * 0.1} x2={1.3} y2={sidePulseH * 0.05} stroke={premiumTone.electricSoft} strokeWidth={1.45} strokeLinecap="square" />
              <Line x1={6.2} y1={sidePulseH * 0.2} x2={10.1} y2={sidePulseH * 0.16} stroke={premiumTone.electricBase} strokeWidth={1.18} strokeLinecap="square" />
              <Line x1={3.2} y1={sidePulseH * 0.31} x2={0.9} y2={sidePulseH * 0.36} stroke={premiumTone.electricHot} strokeWidth={1.15} strokeLinecap="square" />
              <Line x1={6.1} y1={sidePulseH * 0.44} x2={9.8} y2={sidePulseH * 0.49} stroke={premiumTone.electricBase} strokeWidth={1.12} strokeLinecap="square" />
              <Line x1={3.6} y1={sidePulseH * 0.57} x2={1.2} y2={sidePulseH * 0.63} stroke={premiumTone.electricSoft} strokeWidth={1.08} strokeLinecap="square" />
              <Line x1={6} y1={sidePulseH * 0.69} x2={9.4} y2={sidePulseH * 0.74} stroke={premiumTone.electricHot} strokeWidth={1.15} strokeLinecap="square" />
              <Line x1={4.4} y1={sidePulseH * 0.82} x2={1.8} y2={sidePulseH * 0.87} stroke={premiumTone.electricBase} strokeWidth={1.08} strokeLinecap="square" />
            </Svg>
          </Animated.View>
        </View>

        <View style={[styles.premiumEdgeTrack, { bottom: outerSpread - 3, left: outerSpread + edgeInset, width: horizontalTrackLength }]}>
          <Animated.View style={[styles.premiumRail, { backgroundColor: premiumTone.electricDim, opacity: premiumRailOpacity }]} />
          <Animated.View style={[styles.premiumRailCore, { backgroundColor: premiumTone.electricBase, opacity: premiumRailCoreOpacity }]} />
          <Animated.View style={[styles.premiumRailFlash, { backgroundColor: premiumTone.electricHot, opacity: premiumFlashOpacity }]} />
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
            <Svg width={topPulseW} height={14}>
              <Polyline points={bottomBoltPoints} fill="none" stroke={premiumTone.electricSoft} strokeWidth={4.4} strokeOpacity={0.42} strokeLinecap="square" strokeLinejoin="miter" />
              <Polyline points={bottomBoltPoints} fill="none" stroke={premiumTone.electricBase} strokeWidth={2.9} strokeLinecap="square" strokeLinejoin="miter" />
              <Polyline points={bottomBoltPoints} fill="none" stroke={premiumTone.electricHot} strokeWidth={1.45} strokeLinecap="square" strokeLinejoin="miter" />
              <Line x1={topPulseW * 0.1} y1={6.1} x2={topPulseW * 0.05} y2={10.1} stroke={premiumTone.electricSoft} strokeWidth={1.18} strokeLinecap="square" />
              <Line x1={topPulseW * 0.2} y1={3.6} x2={topPulseW * 0.14} y2={1.6} stroke={premiumTone.electricBase} strokeWidth={1.12} strokeLinecap="square" />
              <Line x1={topPulseW * 0.31} y1={6.4} x2={topPulseW * 0.26} y2={1.8} stroke={premiumTone.electricHot} strokeWidth={1.15} strokeLinecap="square" />
              <Line x1={topPulseW * 0.42} y1={3.1} x2={topPulseW * 0.38} y2={0.9} stroke={premiumTone.electricHot} strokeWidth={1.1} strokeLinecap="square" />
              <Line x1={topPulseW * 0.54} y1={6} x2={topPulseW * 0.6} y2={9.5} stroke={premiumTone.electricSoft} strokeWidth={1.12} strokeLinecap="square" />
              <Line x1={topPulseW * 0.66} y1={3.8} x2={topPulseW * 0.71} y2={1.4} stroke={premiumTone.electricBase} strokeWidth={1.08} strokeLinecap="square" />
              <Line x1={topPulseW * 0.77} y1={5.7} x2={topPulseW * 0.83} y2={10.3} stroke={premiumTone.electricSoft} strokeWidth={1.08} strokeLinecap="square" />
              <Line x1={topPulseW * 0.9} y1={3.5} x2={topPulseW * 0.96} y2={1.6} stroke={premiumTone.electricHot} strokeWidth={1.05} strokeLinecap="square" />
            </Svg>
          </Animated.View>
        </View>

        <View style={[styles.premiumEdgeTrackVertical, { top: outerSpread + verticalEdgeInset, left: outerSpread - 3, height: verticalTrackLength }]}>
          <Animated.View style={[styles.premiumRailVertical, { backgroundColor: premiumTone.electricDim, opacity: premiumRailOpacity }]} />
          <Animated.View style={[styles.premiumRailVerticalCore, { backgroundColor: premiumTone.electricBase, opacity: premiumRailCoreOpacity }]} />
          <Animated.View style={[styles.premiumRailVerticalFlash, { backgroundColor: premiumTone.electricHot, opacity: premiumFlashOpacity }]} />
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
            <Svg width={14} height={sidePulseH}>
              <Polyline points={leftBoltPoints} fill="none" stroke={premiumTone.electricSoft} strokeWidth={4.4} strokeOpacity={0.42} strokeLinecap="square" strokeLinejoin="miter" />
              <Polyline points={leftBoltPoints} fill="none" stroke={premiumTone.electricBase} strokeWidth={2.9} strokeLinecap="square" strokeLinejoin="miter" />
              <Polyline points={leftBoltPoints} fill="none" stroke={premiumTone.electricHot} strokeWidth={1.45} strokeLinecap="square" strokeLinejoin="miter" />
              <Line x1={6} y1={sidePulseH * 0.09} x2={10.2} y2={sidePulseH * 0.05} stroke={premiumTone.electricSoft} strokeWidth={1.18} strokeLinecap="square" />
              <Line x1={3.4} y1={sidePulseH * 0.19} x2={0.8} y2={sidePulseH * 0.24} stroke={premiumTone.electricBase} strokeWidth={1.12} strokeLinecap="square" />
              <Line x1={6.3} y1={sidePulseH * 0.33} x2={10.4} y2={sidePulseH * 0.38} stroke={premiumTone.electricHot} strokeWidth={1.15} strokeLinecap="square" />
              <Line x1={3.9} y1={sidePulseH * 0.46} x2={1.1} y2={sidePulseH * 0.51} stroke={premiumTone.electricBase} strokeWidth={1.1} strokeLinecap="square" />
              <Line x1={6.1} y1={sidePulseH * 0.59} x2={9.9} y2={sidePulseH * 0.65} stroke={premiumTone.electricSoft} strokeWidth={1.1} strokeLinecap="square" />
              <Line x1={3.3} y1={sidePulseH * 0.73} x2={0.9} y2={sidePulseH * 0.79} stroke={premiumTone.electricHot} strokeWidth={1.12} strokeLinecap="square" />
              <Line x1={5.4} y1={sidePulseH * 0.87} x2={9.5} y2={sidePulseH * 0.92} stroke={premiumTone.electricBase} strokeWidth={1.05} strokeLinecap="square" />
            </Svg>
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
    height: 16,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  premiumEdgeTrackVertical: {
    position: 'absolute',
    width: 16,
    overflow: 'hidden',
    alignItems: 'center',
  },
  premiumRail: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 7,
    height: 1.8,
    borderRadius: 1,
  },
  premiumRailCore: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 6,
    height: 3.2,
    borderRadius: 1,
  },
  premiumRailFlash: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 6,
    height: 4,
    borderRadius: 1,
  },
  premiumRailVertical: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 7,
    width: 1.8,
    borderRadius: 1,
  },
  premiumRailVerticalCore: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 6,
    width: 3.2,
    borderRadius: 1,
  },
  premiumRailVerticalFlash: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 6,
    width: 4,
    borderRadius: 1,
  },
  premiumPulseCluster: {
    position: 'absolute',
    left: 0,
    top: 0,
    height: 16,
  },
  premiumPulseClusterVertical: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 16,
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
