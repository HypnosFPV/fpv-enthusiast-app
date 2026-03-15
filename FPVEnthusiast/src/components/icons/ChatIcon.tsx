// src/components/icons/ChatIcon.tsx
// Side-profile speaking head with FPV goggles resting on top of head
// Stroke-only SVG matching DroneIcon / GogglesIcon style
import React from 'react';
import Svg, { Path, Line, Rect } from 'react-native-svg';

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
  const sw = focused ? 1.9 : 1.6;
  const sd = focused ? 1.4 : 1.1;

  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">

      {/* ── HEAD — side profile facing right ────────────────────────────── */}
      <Path
        d={
          // Start at base of neck (bottom-left), go clockwise
          'M 8 28 ' +
          'L 8 25 ' +            // neck left side up
          'Q 7 23 7 20 ' +       // jaw
          'Q 6.5 16 7 13 ' +     // cheek / ear area
          'Q 8 8.5 11 7 ' +      // back of skull curving to top
          'Q 14 5.5 17 6 ' +     // crown
          'Q 20 6.5 21 9 ' +     // forehead slope down
          'Q 22 11 21.5 13 ' +   // brow
          'L 21 14 ' +           // nose bridge
          'Q 21.5 15.5 21 17 ' + // nose
          'Q 20.5 18 20 18.5 ' + // upper lip
          'Q 19.5 20 19 21 ' +   // mouth / chin
          'Q 17 24 13 25 ' +     // chin curve back
          'L 13 28 ' +           // neck right side
          'Z'
        }
        stroke={color}
        strokeWidth={sw}
        strokeLinejoin="round"
        strokeLinecap="round"
        fill="none"
      />

      {/* ── FPV GOGGLES — resting on top/forehead, facing right ─────────── */}
      {/* Main goggle box — sits across the top of the head */}
      <Rect
        x="9"
        y="5"
        width="13"
        height="5"
        rx="1.2"
        stroke={color}
        strokeWidth={sd}
        fill="none"
      />
      {/* Center divider */}
      <Line
        x1="15.5" y1="5"
        x2="15.5" y2="10"
        stroke={color}
        strokeWidth={sd - 0.2}
        strokeLinecap="round"
      />
      {/* Strap going left off the head */}
      <Path
        d="M 9 7 Q 7 7 6 7.5"
        stroke={color}
        strokeWidth={sd - 0.2}
        strokeLinecap="round"
        fill="none"
      />
      {/* Camera/visor bump on front-right of goggles */}
      <Rect
        x="21.5"
        y="6"
        width="2"
        height="3"
        rx="0.4"
        stroke={color}
        strokeWidth={sd - 0.3}
        fill="none"
      />

      {/* ── SPEECH LINES — from mouth, pointing right ───────────────────── */}
      <Line x1="21" y1="16"   x2="27" y2="14.5" stroke={color} strokeWidth={sw - 0.3} strokeLinecap="round" />
      <Line x1="21" y1="18"   x2="27.5" y2="18" stroke={color} strokeWidth={sw - 0.3} strokeLinecap="round" />
      <Line x1="21" y1="20"   x2="27" y2="21.5" stroke={color} strokeWidth={sw - 0.3} strokeLinecap="round" />

    </Svg>
  );
}
