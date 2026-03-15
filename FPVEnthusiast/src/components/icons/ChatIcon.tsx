// src/components/icons/ChatIcon.tsx
// RadioMaster Boxer FPV radio controller — front-face view
// Stroke-only SVG matching DroneIcon / GogglesIcon style
// viewBox 0 0 32 32
import React from 'react';
import Svg, { Rect, Circle, Line, Path } from 'react-native-svg';

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
  const sw = focused ? 1.9 : 1.6;   // primary stroke
  const sd = focused ? 1.3 : 1.0;   // detail stroke
  const ss = focused ? 1.0 : 0.8;   // fine detail

  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">

      {/* ── SHOULDER SWITCHES — top edge, 4 small tabs ─────────────────── */}
      {/* Left pair (SWA / SWB) */}
      <Rect x="3"  y="3.5" width="3" height="2.5" rx="0.6"
        stroke={color} strokeWidth={ss} fill="none" />
      <Rect x="7.5" y="3.5" width="3" height="2.5" rx="0.6"
        stroke={color} strokeWidth={ss} fill="none" />
      {/* Right pair (SWC / SWD) */}
      <Rect x="21.5" y="3.5" width="3" height="2.5" rx="0.6"
        stroke={color} strokeWidth={ss} fill="none" />
      <Rect x="26" y="3.5" width="3" height="2.5" rx="0.6"
        stroke={color} strokeWidth={ss} fill="none" />

      {/* ── MAIN BODY ───────────────────────────────────────────────────── */}
      {/* Body with slight grips at bottom corners */}
      <Path
        d={
          'M 2 6 ' +          // top-left
          'L 30 6 ' +         // top-right
          'L 30 27 ' +        // bottom-right
          'Q 30 29 28 29 ' +  // grip bottom-right
          'L 22 29 ' +
          'Q 20 29 20 27 ' +  // waist-in right
          'L 12 27 ' +
          'Q 12 29 10 29 ' +  // waist-in left
          'L 4 29 ' +
          'Q 2 29 2 27 ' +    // grip bottom-left
          'Z'
        }
        stroke={color}
        strokeWidth={sw}
        strokeLinejoin="round"
        strokeLinecap="round"
        fill="none"
      />

      {/* ── LCD SCREEN — top center ─────────────────────────────────────── */}
      <Rect x="11" y="8" width="10" height="7" rx="1"
        stroke={color} strokeWidth={sd} fill="none" />
      {/* Screen glare / scanline detail */}
      <Line x1="12.5" y1="9.5" x2="19.5" y2="9.5"
        stroke={color} strokeWidth={ss} strokeLinecap="round" opacity={0.6} />
      <Line x1="12.5" y1="11"  x2="17"   y2="11"
        stroke={color} strokeWidth={ss} strokeLinecap="round" opacity={0.4} />

      {/* ── MENU BUTTONS — small row below screen ───────────────────────── */}
      <Circle cx="13.5" cy="17" r="0.8" stroke={color} strokeWidth={ss} fill="none" />
      <Circle cx="16"   cy="17" r="0.8" stroke={color} strokeWidth={ss} fill="none" />
      <Circle cx="18.5" cy="17" r="0.8" stroke={color} strokeWidth={ss} fill="none" />

      {/* ── LEFT GIMBAL ─────────────────────────────────────────────────── */}
      {/* Outer ring */}
      <Circle cx="8" cy="22" r="4.5"
        stroke={color} strokeWidth={sd} fill="none" />
      {/* Inner ring (gimbal movement indicator) */}
      <Circle cx="8" cy="22" r="2.5"
        stroke={color} strokeWidth={ss} fill="none" />
      {/* Center dot */}
      <Circle cx="8" cy="22" r="0.9"
        stroke={color} strokeWidth={ss} fill="none" />

      {/* ── RIGHT GIMBAL ────────────────────────────────────────────────── */}
      {/* Outer ring */}
      <Circle cx="24" cy="22" r="4.5"
        stroke={color} strokeWidth={sd} fill="none" />
      {/* Inner ring */}
      <Circle cx="24" cy="22" r="2.5"
        stroke={color} strokeWidth={ss} fill="none" />
      {/* Center dot */}
      <Circle cx="24" cy="22" r="0.9"
        stroke={color} strokeWidth={ss} fill="none" />

      {/* ── NECK STRAP CLIP — center between screen and gimbals ─────────── */}
      <Circle cx="16" cy="19.5" r="1"
        stroke={color} strokeWidth={ss} fill="none" />

    </Svg>
  );
}
