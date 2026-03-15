// src/components/icons/ChatIcon.tsx
// Speech bubble containing FPV goggle lens shapes
// Matches stroke-only style of DroneIcon / GogglesIcon / PropIcon
import React from 'react';
import Svg, { Path, Ellipse, Line } from 'react-native-svg';

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
  const sw = focused ? 1.9 : 1.6; // outer stroke
  const sd = focused ? 1.4 : 1.1; // detail stroke

  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">

      {/* ── Speech bubble body ── */}
      <Path
        d={[
          'M 4.5 5.5',
          'Q 4.5 3.5 6.5 3.5',
          'L 25.5 3.5',
          'Q 27.5 3.5 27.5 5.5',
          'L 27.5 19.5',
          'Q 27.5 21.5 25.5 21.5',
          'L 14.0 21.5',
          'L 9.5 26.0',   // tail pointing down-left
          'L 9.5 21.5',
          'L 6.5 21.5',
          'Q 4.5 21.5 4.5 19.5',
          'Z',
        ].join(' ')}
        stroke={color}
        strokeWidth={sw}
        strokeLinejoin="round"
        strokeLinecap="round"
        fill="none"
      />

      {/* ── FPV goggle lenses inside the bubble ── */}
      {/* Left lens */}
      <Ellipse
        cx="11.5"
        cy="12.5"
        rx="4.2"
        ry="3.2"
        stroke={color}
        strokeWidth={sd}
        fill="none"
      />
      {/* Right lens */}
      <Ellipse
        cx="20.5"
        cy="12.5"
        rx="4.2"
        ry="3.2"
        stroke={color}
        strokeWidth={sd}
        fill="none"
      />
      {/* Center bridge between lenses */}
      <Line
        x1="15.7" y1="12.5"
        x2="16.3" y2="12.5"
        stroke={color}
        strokeWidth={sd}
        strokeLinecap="round"
      />

    </Svg>
  );
}
