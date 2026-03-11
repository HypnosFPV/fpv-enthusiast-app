// src/components/icons/PropIcon.tsx
// Single 3-blade FPV propeller – line-art tab-bar icon.
// Matches DroneIcon's stroke style: stroke-only, strokeLinecap="round", fill on focused.
import React from 'react';
import Svg, { Circle, Path, Line } from 'react-native-svg';

interface PropIconProps {
  size?: number;
  color?: string;
  focused?: boolean;
}

export default function PropIcon({ size = 26, color = '#666', focused = false }: PropIconProps) {
  const sw = focused ? 1.8 : 1.5;
  const f  = focused ? color : 'none';

  // Hub centre
  const cx = 16, cy = 16;

  // Three blades at 0°, 120°, 240° — each a tapered teardrop path
  // Blade 1: sweeps up-right (0 deg)
  // Blade 2: sweeps lower-right (120 deg)
  // Blade 3: sweeps lower-left (240 deg)
  // Using rotated Path elements for clean symmetry
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      {/* Hub */}
      <Circle cx={cx} cy={cy} r={2.8} stroke={color} strokeWidth={sw} fill={f} />

      {/* Blade 1 – 0° (pointing up) */}
      <Path
        d={`M${cx} ${cy-3} C${cx+2} ${cy-7}, ${cx+5} ${cy-11}, ${cx+1} ${cy-13} C${cx-2} ${cy-11}, ${cx-3} ${cy-7}, ${cx} ${cy-3} Z`}
        stroke={color}
        strokeWidth={sw}
        strokeLinejoin="round"
        fill={f}
        opacity={focused ? 0.85 : 0.7}
      />
      {/* Blade 2 – 120° */}
      <Path
        d={`M${cx} ${cy-3} C${cx+2} ${cy-7}, ${cx+5} ${cy-11}, ${cx+1} ${cy-13} C${cx-2} ${cy-11}, ${cx-3} ${cy-7}, ${cx} ${cy-3} Z`}
        stroke={color}
        strokeWidth={sw}
        strokeLinejoin="round"
        fill={f}
        opacity={focused ? 0.85 : 0.7}
        transform={`rotate(120, ${cx}, ${cy})`}
      />
      {/* Blade 3 – 240° */}
      <Path
        d={`M${cx} ${cy-3} C${cx+2} ${cy-7}, ${cx+5} ${cy-11}, ${cx+1} ${cy-13} C${cx-2} ${cy-11}, ${cx-3} ${cy-7}, ${cx} ${cy-3} Z`}
        stroke={color}
        strokeWidth={sw}
        strokeLinejoin="round"
        fill={f}
        opacity={focused ? 0.85 : 0.7}
        transform={`rotate(240, ${cx}, ${cy})`}
      />

      {/* Spinner dot centre */}
      <Circle cx={cx} cy={cy} r={1.2} fill={color} opacity={0.9} />
    </Svg>
  );
}
