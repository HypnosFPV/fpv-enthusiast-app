// src/components/icons/ChatIcon.tsx
// Radiomaster Boxer FPV radio — front-face lineart replica
// Layout (top→bottom): flat antenna bar | 4 shoulder switches | body |
//   power pill (center) | left gimbal + right gimbal | trim sliders |
//   oval button row | [nav stack left] [LCD center] [scroll wheel right]
// Stroke-only SVG matching DroneIcon / GogglesIcon visual weight
// viewBox 0 0 32 32
import React from 'react';
import Svg, { Rect, Circle, Line, Path, G } from 'react-native-svg';

interface ChatIconProps {
  size?: number;
  color?: string;
  focused?: boolean;
}

export default function ChatIcon({
  size = 28,
  color = '#888',
  focused = false,
}: ChatIconProps) {
  const sw = focused ? 1.8 : 1.5;   // body / gimbal stroke
  const sd = focused ? 1.2 : 0.9;   // detail stroke
  const ss = focused ? 0.9 : 0.7;   // fine / sub-detail

  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">

      {/* ── ANTENNA — flat bar across top center ───────────────────────── */}
      <Rect x="9" y="1" width="14" height="1.8" rx="0.9"
        stroke={color} strokeWidth={sw} fill="none" />

      {/* ── SHOULDER SWITCHES — 4 toggle tabs at top edge of body ──────── */}
      {/* Far-left */}
      <Rect x="2"    y="2.5" width="2.5" height="3.5" rx="0.5"
        stroke={color} strokeWidth={ss} fill="none" />
      {/* Left-center */}
      <Rect x="5.5"  y="2.5" width="2.5" height="3.5" rx="0.5"
        stroke={color} strokeWidth={ss} fill="none" />
      {/* Right-center */}
      <Rect x="24"   y="2.5" width="2.5" height="3.5" rx="0.5"
        stroke={color} strokeWidth={ss} fill="none" />
      {/* Far-right */}
      <Rect x="27.5" y="2.5" width="2.5" height="3.5" rx="0.5"
        stroke={color} strokeWidth={ss} fill="none" />

      {/* ── MAIN BODY ───────────────────────────────────────────────────── */}
      <Rect x="1" y="4" width="30" height="27" rx="3"
        stroke={color} strokeWidth={sw} fill="none" />

      {/* ── POWER BUTTON — oval pill, center between gimbals at top ─────── */}
      <Rect x="13" y="5.5" width="6" height="2.5" rx="1.25"
        stroke={color} strokeWidth={sd} fill="none" />

      {/* ── LEFT GIMBAL ─────────────────────────────────────────────────── */}
      {/* Outer ring */}
      <Circle cx="9" cy="15" r="6.2"
        stroke={color} strokeWidth={sw} fill="none" />
      {/* Inner ring (gimbal plate) */}
      <Circle cx="9" cy="15" r="3.6"
        stroke={color} strokeWidth={sd} fill="none" />
      {/* Stick nub */}
      <Circle cx="9" cy="15" r="1.3"
        stroke={color} strokeWidth={sd} fill="none" />

      {/* ── RIGHT GIMBAL ────────────────────────────────────────────────── */}
      <Circle cx="23" cy="15" r="6.2"
        stroke={color} strokeWidth={sw} fill="none" />
      <Circle cx="23" cy="15" r="3.6"
        stroke={color} strokeWidth={sd} fill="none" />
      <Circle cx="23" cy="15" r="1.3"
        stroke={color} strokeWidth={sd} fill="none" />

      {/* ── TRIM SLIDERS — short horizontal bars between/below gimbals ──── */}
      {/* Left trim (below left gimbal) */}
      <Line x1="13.5" y1="21.2" x2="16" y2="21.2"
        stroke={color} strokeWidth={sd} strokeLinecap="round" />
      {/* Right trim */}
      <Line x1="16" y1="21.2" x2="18.5" y2="21.2"
        stroke={color} strokeWidth={sd} strokeLinecap="round" />
      {/* Trim tick marks */}
      <Line x1="14.8" y1="20.4" x2="14.8" y2="22"
        stroke={color} strokeWidth={ss} strokeLinecap="round" />
      <Line x1="17.2" y1="20.4" x2="17.2" y2="22"
        stroke={color} strokeWidth={ss} strokeLinecap="round" />

      {/* ── OVAL BUTTON ROW — 6 small pills below gimbals ───────────────── */}
      {[4.5, 8, 11.5, 15, 18.5, 22, 25.5].map((x, i) => (
        <Rect key={i} x={x} y="22.5" width="2.5" height="1.4" rx="0.7"
          stroke={color} strokeWidth={ss} fill="none" />
      ))}

      {/* ── NAV BUTTONS — vertical stack, lower-left ────────────────────── */}
      {[24.5, 26.2, 27.9, 29.6].map((y, i) => (
        <Rect key={i} x="2" y={y} width="4" height="1.3" rx="0.65"
          stroke={color} strokeWidth={ss} fill="none" />
      ))}

      {/* ── LCD SCREEN — bottom center ──────────────────────────────────── */}
      <Rect x="9" y="24.5" width="14" height="6" rx="1"
        stroke={color} strokeWidth={sd} fill="none" />
      {/* Screen glare line */}
      <Line x1="10" y1="25.6" x2="22" y2="25.6"
        stroke={color} strokeWidth={ss} strokeLinecap="round" opacity={0.5} />

      {/* ── SCROLL WHEEL — lower-right, ridged ──────────────────────────── */}
      <Rect x="26.5" y="24.5" width="3" height="6" rx="1"
        stroke={color} strokeWidth={sd} fill="none" />
      {/* Ridges */}
      <Line x1="26.5" y1="26.2" x2="29.5" y2="26.2"
        stroke={color} strokeWidth={ss} strokeLinecap="square" />
      <Line x1="26.5" y1="27.5" x2="29.5" y2="27.5"
        stroke={color} strokeWidth={ss} strokeLinecap="square" />
      <Line x1="26.5" y1="28.8" x2="29.5" y2="28.8"
        stroke={color} strokeWidth={ss} strokeLinecap="square" />

    </Svg>
  );
}
