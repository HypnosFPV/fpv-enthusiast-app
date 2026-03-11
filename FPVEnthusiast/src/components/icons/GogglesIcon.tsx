import React from 'react';
import Svg, { Rect, Circle, Path, Line, Polygon } from 'react-native-svg';

interface GogglesIconProps {
  size?: number;
  color?: string;
  focused?: boolean;
}

/**
 * Line-art FPV box-goggles icon.
 * Silhouette: wide trapezoidal shell, two large round lenses,
 * nose-bridge cutout at bottom, forehead visor ledge at top.
 * Matches the stroke-only style of DroneIcon / PropIcon.
 */
export default function GogglesIcon({
  size = 28,
  color = '#888',
  focused = false,
}: GogglesIconProps) {
  const fill = focused ? color : 'none';
  const stroke = color;
  const sw = 1.5; // strokeWidth

  return (
    <Svg width={size} height={size} viewBox="0 0 28 28">
      {/* ── Visor / forehead ledge (thin rect across the top) ── */}
      <Rect
        x="3" y="5" width="22" height="2.5"
        rx="1.2"
        stroke={stroke} strokeWidth={sw}
        fill={fill}
      />

      {/* ── Main goggle body ── */}
      {/*  Trapezoid: wider at front (y=7.5), slightly narrower toward face.
          Rendered as a Path so we can shape the bottom nose cutout in one go. */}
      <Path
        d={[
          'M 3 7.5',          // top-left (below visor)
          'L 25 7.5',         // top-right
          'L 25 19',          // bottom-right
          'L 18.5 19',        // start of nose cutout right side
          'Q 16.5 22 14 22',  // right arc of nose bridge
          'Q 11.5 22 9.5 19', // left arc of nose bridge
          'L 3 19',           // bottom-left
          'Z',
        ].join(' ')}
        stroke={stroke} strokeWidth={sw}
        fill={fill}
        strokeLinejoin="round"
      />

      {/* ── Left lens ── */}
      <Rect
        x="4.5" y="9" width="8" height="8"
        rx="3"
        stroke={stroke} strokeWidth={sw}
        fill={focused ? color : 'none'}
        fillOpacity={focused ? 0.25 : 0}
      />

      {/* ── Right lens ── */}
      <Rect
        x="15.5" y="9" width="8" height="8"
        rx="3"
        stroke={stroke} strokeWidth={sw}
        fill={focused ? color : 'none'}
        fillOpacity={focused ? 0.25 : 0}
      />

      {/* ── Nose bridge divider (vertical line between lenses) ── */}
      <Line
        x1="13.5" y1="9" x2="13.5" y2="17"
        stroke={stroke} strokeWidth={sw - 0.3}
        strokeLinecap="round"
      />

      {/* ── Lens reflection dot (top-left of each lens, gives depth) ── */}
      <Circle cx="6.5" cy="11" r="0.8" fill={stroke} />
      <Circle cx="17.5" cy="11" r="0.8" fill={stroke} />
    </Svg>
  );
}
