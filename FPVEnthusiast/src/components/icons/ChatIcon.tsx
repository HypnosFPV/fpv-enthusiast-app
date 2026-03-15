// src/components/icons/ChatIcon.tsx
// Side-profile head wearing FPV goggles with speech lines
// Matches the stroke-only style of DroneIcon / GogglesIcon
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
  const sw  = focused ? 1.9 : 1.6;  // main stroke weight
  const sd  = focused ? 1.4 : 1.1;  // detail stroke weight

  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">

      {/* ── HEAD silhouette (side profile, facing right) ── */}
      {/* Skull top + back of head */}
      <Path
        d={[
          'M 9.5 24.5',          // chin
          'Q 8.0 23.0 7.5 21.0', // jaw curve
          'Q 6.5 18.5 6.5 15.5', // neck / lower head
          'Q 6.5 9.5 10.0 7.0',  // back-of-head to top
          'Q 13.0 5.0 16.5 5.5', // skull top arch
          'Q 20.5 6.0 21.5 9.5', // forehead
          'Q 22.5 12.5 22.0 14.5',// brow ridge
          'Q 21.5 16.0 20.5 17.0',// nose bridge area
          'L 20.0 17.5',          // nose tip
          'Q 20.5 18.5 20.0 19.5',// upper lip
          'Q 19.5 20.5 19.0 21.0',// mouth area
          'L 18.5 22.5',          // chin front
          'Q 15.0 25.5 9.5 24.5', // chin back to start
          'Z',
        ].join(' ')}
        stroke={color}
        strokeWidth={sw}
        strokeLinejoin="round"
        strokeLinecap="round"
        fill="none"
      />

      {/* ── FPV GOGGLES on the head ── */}
      {/* Main goggle body — sits across the eye/brow area */}
      <Rect
        x="11.5"
        y="9.5"
        width="9.5"
        height="5.5"
        rx="1.2"
        ry="1.2"
        stroke={color}
        strokeWidth={sd}
        fill="none"
      />
      {/* Center divider between left and right eye */}
      <Line
        x1="16.25" y1="9.5"
        x2="16.25" y2="15.0"
        stroke={color}
        strokeWidth={sd - 0.3}
        strokeLinecap="round"
      />
      {/* Goggle strap going back over the head */}
      <Path
        d="M 11.5 11.5 Q 9.5 11.0 8.5 10.5"
        stroke={color}
        strokeWidth={sd - 0.2}
        strokeLinecap="round"
        fill="none"
      />
      {/* Small FPV camera bump on front of goggles */}
      <Rect
        x="20.5"
        y="11.0"
        width="1.8"
        height="3.2"
        rx="0.5"
        stroke={color}
        strokeWidth={sd - 0.3}
        fill="none"
      />

      {/* ── SPEECH LINES (3 lines radiating from mouth, facing right) ── */}
      {/* Bottom line */}
      <Line
        x1="21.0" y1="21.5"
        x2="26.5" y2="23.5"
        stroke={color}
        strokeWidth={sw - 0.2}
        strokeLinecap="round"
      />
      {/* Middle line (longest) */}
      <Line
        x1="21.0" y1="19.5"
        x2="27.5" y2="19.5"
        stroke={color}
        strokeWidth={sw - 0.2}
        strokeLinecap="round"
      />
      {/* Top line */}
      <Line
        x1="21.0" y1="17.5"
        x2="26.5" y2="15.5"
        stroke={color}
        strokeWidth={sw - 0.2}
        strokeLinecap="round"
      />

    </Svg>
  );
}
