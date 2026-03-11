// src/components/icons/GogglesIcon.tsx
// FPV goggles silhouette – line-art tab-bar icon.
// Based on the Angular/faceted goggle shape (Walksnail-style boxy design).
// Matches DroneIcon/PropIcon: stroke-only, strokeLinecap="round", fill on focused.
import React from 'react';
import Svg, { Rect, Path, Line, Polygon } from 'react-native-svg';

interface GogglesIconProps {
  size?: number;
  color?: string;
  focused?: boolean;
}

export default function GogglesIcon({ size = 26, color = '#666', focused = false }: GogglesIconProps) {
  const sw  = focused ? 1.8 : 1.5;
  const f   = focused ? color : 'none';
  const lf  = focused ? 'rgba(0,0,0,0.3)' : 'none'; // lens fill when focused

  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">

      {/* ── Main body – boxy outer shell ── */}
      <Rect
        x="2" y="9" width="28" height="16"
        rx="2.5"
        stroke={color} strokeWidth={sw}
        fill={f} opacity={focused ? 0.15 : 1}
      />

      {/* ── Top facet line – the angular panel crease across the top ── */}
      <Line
        x1="4" y1="9" x2="7"  y2="6"
        stroke={color} strokeWidth={sw} strokeLinecap="round"
      />
      <Line
        x1="28" y1="9" x2="25" y2="6"
        stroke={color} strokeWidth={sw} strokeLinecap="round"
      />
      <Line
        x1="7" y1="6" x2="25" y2="6"
        stroke={color} strokeWidth={sw} strokeLinecap="round"
      />

      {/* ── Centre divider between the two lenses ── */}
      <Line
        x1="16" y1="10" x2="16" y2="24"
        stroke={color} strokeWidth={sw * 0.7} strokeLinecap="round"
        opacity={0.5}
      />

      {/* ── Left lens ── */}
      <Rect
        x="4" y="11.5" width="10" height="9"
        rx="1.5"
        stroke={color} strokeWidth={sw}
        fill={focused ? color : 'none'}
        opacity={focused ? 0.25 : 1}
      />

      {/* ── Right lens ── */}
      <Rect
        x="18" y="11.5" width="10" height="9"
        rx="1.5"
        stroke={color} strokeWidth={sw}
        fill={focused ? color : 'none'}
        opacity={focused ? 0.25 : 1}
      />

      {/* ── Triangular logo mark on centre bottom (like the red triangle on the goggles) ── */}
      <Polygon
        points="16,18.5 14.2,22 17.8,22"
        stroke={color} strokeWidth={sw * 0.8}
        strokeLinejoin="round"
        fill={focused ? color : 'none'}
        opacity={focused ? 0.9 : 0.6}
      />

    </Svg>
  );
}
