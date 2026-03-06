// src/components/icons/DroneIcon.tsx
import React from 'react';
import Svg, { Circle, Line, Ellipse } from 'react-native-svg';

interface DroneIconProps {
  size?: number;
  color?: string;
  focused?: boolean;
}

export default function DroneIcon({ size = 26, color = '#666', focused = false }: DroneIconProps) {
  const sw = focused ? 1.8 : 1.5;
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      {/* Arms */}
      <Line x1="16" y1="16" x2="6"  y2="6"  stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <Line x1="16" y1="16" x2="26" y2="6"  stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <Line x1="16" y1="16" x2="6"  y2="26" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <Line x1="16" y1="16" x2="26" y2="26" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      {/* Prop rings */}
      <Circle cx="6"  cy="6"  r="3.2" stroke={color} strokeWidth={sw} fill="none" />
      <Circle cx="26" cy="6"  r="3.2" stroke={color} strokeWidth={sw} fill="none" />
      <Circle cx="6"  cy="26" r="3.2" stroke={color} strokeWidth={sw} fill="none" />
      <Circle cx="26" cy="26" r="3.2" stroke={color} strokeWidth={sw} fill="none" />
      {/* Prop blades */}
      <Ellipse cx="6"  cy="6"  rx="3" ry="1" stroke={color} strokeWidth={sw - 0.3} fill={focused ? color : 'none'} opacity={0.6} transform="rotate(-45, 6, 6)"   />
      <Ellipse cx="26" cy="6"  rx="3" ry="1" stroke={color} strokeWidth={sw - 0.3} fill={focused ? color : 'none'} opacity={0.6} transform="rotate(45, 26, 6)"   />
      <Ellipse cx="6"  cy="26" rx="3" ry="1" stroke={color} strokeWidth={sw - 0.3} fill={focused ? color : 'none'} opacity={0.6} transform="rotate(45, 6, 26)"   />
      <Ellipse cx="26" cy="26" rx="3" ry="1" stroke={color} strokeWidth={sw - 0.3} fill={focused ? color : 'none'} opacity={0.6} transform="rotate(-45, 26, 26)" />
      {/* Body */}
      <Circle cx="16" cy="16" r="4" stroke={color} strokeWidth={sw} fill={focused ? color : 'none'} />
      {/* FPV camera lens */}
      <Circle cx="16" cy="16" r="1.5" fill={focused ? '#0a0a0a' : color} opacity={focused ? 1 : 0.5} />
    </Svg>
  );
}
