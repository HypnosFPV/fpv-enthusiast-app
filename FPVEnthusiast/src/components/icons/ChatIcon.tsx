// src/components/icons/ChatIcon.tsx
// 🗣️ side-profile head (facing right) WEARING FPV goggles over the eyes + 3 speech lines
// Stroke-only SVG, matches DroneIcon / GogglesIcon visual weight.
// viewBox 0 0 32 32
import React from 'react';
import Svg, { Path, Rect, Line, Circle } from 'react-native-svg';

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
  const sw = focused ? 1.9 : 1.6;   // outer stroke
  const sd = focused ? 1.4 : 1.1;   // detail stroke

  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">

      {/* ── HEAD — clean side profile facing RIGHT ────────────────────────
          Back of head on left (~x6), face on right (~x20)
          Crown at top, neck at bottom-center                           */}
      <Path
        d={
          'M 10 27 ' +          // neck base left
          'L 10 24 ' +          // up left neck
          'Q 9 22 9 19 ' +      // back jaw / lower cheek
          'Q 8.5 14 10 11 ' +   // cheek curving up toward top
          'Q 12 6  16 5 ' +     // crown arc (back of skull)
          'Q 20 4  22 8 ' +     // top-forehead
          'Q 23.5 10 23 13 ' +  // forehead sloping down toward brow
          'Q 22.5 16 22 17 ' +  // nose bridge / top of nose
          'L 23 18 ' +          // nose tip protrudes
          'Q 22.5 20 21 21 ' +  // under-nose / upper lip
          'Q 20 22.5 19 23.5 ' + // mouth / chin
          'Q 16 26 13 26 ' +    // chin curves back
          'L 13 27 ' +          // neck base right
          'Z'
        }
        stroke={color}
        strokeWidth={sw}
        strokeLinejoin="round"
        strokeLinecap="round"
        fill="none"
      />

      {/* ── EAR — small bump on back side of head ─────────────────────── */}
      <Path
        d="M 9.5 15 Q 7.5 15.5 7.5 17 Q 7.5 18.5 9.5 19"
        stroke={color}
        strokeWidth={sd - 0.2}
        strokeLinecap="round"
        fill="none"
      />

      {/* ── FPV GOGGLES — ON THE EYES (front of face, eye area) ──────────
          Goggles body sits across x:12→23, y:10→16.5
          This is right in the "eye zone" of the side profile above.     */}

      {/* Main goggle body */}
      <Rect
        x="12"
        y="10"
        width="11"
        height="6"
        rx="1.4"
        stroke={color}
        strokeWidth={sd}
        fill="none"
      />

      {/* Center lens divider */}
      <Line
        x1="17.5" y1="10"
        x2="17.5" y2="16"
        stroke={color}
        strokeWidth={sd - 0.2}
        strokeLinecap="round"
      />

      {/* Goggle strap — goes from back of goggles (x12) to back of head */}
      <Path
        d="M 12 12.5 Q 10.5 12 10 13 Q 9.5 14 10.5 14.5"
        stroke={color}
        strokeWidth={sd - 0.3}
        strokeLinecap="round"
        fill="none"
      />

      {/* Visor/camera bump on front-right of goggles */}
      <Rect
        x="23"
        y="11.5"
        width="2"
        height="3"
        rx="0.5"
        stroke={color}
        strokeWidth={sd - 0.3}
        fill="none"
      />

      {/* ── SPEECH LINES — from mouth area, fanning right ─────────────── */}
      <Line x1="21.5" y1="19.5"  x2="27" y2="17.5" stroke={color} strokeWidth={sw - 0.4} strokeLinecap="round" />
      <Line x1="22"   y1="21.5"  x2="28" y2="21.5" stroke={color} strokeWidth={sw - 0.4} strokeLinecap="round" />
      <Line x1="21.5" y1="23.5"  x2="27" y2="25.5" stroke={color} strokeWidth={sw - 0.4} strokeLinecap="round" />

    </Svg>
  );
}
