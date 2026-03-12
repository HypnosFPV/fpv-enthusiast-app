// src/components/icons/PropIcon.tsx
// Single 3-blade FPV propeller – line-art tab-bar icon.
// Matches DroneIcon's stroke style: stroke-only, strokeLinecap="round", fill on focused.
import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

interface PropIconProps {
  size?: number;
  color?: string;
  focused?: boolean;
}

export default function PropIcon({ size = 26, color = '#666', focused = false }: PropIconProps) {
  const sw = focused ? 1.8 : 1.5;
  const f  = focused ? color : 'none';

  // Hub centred in the middle of the 32×32 viewBox
  const cx = 16, cy = 16;

  // Blades are longer and wider — hub at true centre so the prop fills the box
  // Blade tip reaches to y=1.5 (up), total blade length ~14.5 units
  const blade = `M${cx} ${cy-3.2} C${cx+2.5} ${cy-8}, ${cx+6} ${cy-13}, ${cx+1} ${cy-14.5} C${cx-3} ${cy-13}, ${cx-4} ${cy-8}, ${cx} ${cy-3.2} Z`;

  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      {/* Hub ring */}
      <Circle cx={cx} cy={cy} r={3.2} stroke={color} strokeWidth={sw} fill={f} />

      {/* Blade 1 – pointing up */}
      <Path d={blade} stroke={color} strokeWidth={sw} strokeLinejoin="round" fill={f} opacity={focused ? 0.9 : 0.75} />

      {/* Blade 2 – 120° */}
      <Path d={blade} stroke={color} strokeWidth={sw} strokeLinejoin="round" fill={f} opacity={focused ? 0.9 : 0.75}
        transform={`rotate(120, ${cx}, ${cy})`} />

      {/* Blade 3 – 240° */}
      <Path d={blade} stroke={color} strokeWidth={sw} strokeLinejoin="round" fill={f} opacity={focused ? 0.9 : 0.75}
        transform={`rotate(240, ${cx}, ${cy})`} />

      {/* Centre spinner dot */}
      <Circle cx={cx} cy={cy} r={1.4} fill={color} opacity={0.95} />
    </Svg>
  );
}
