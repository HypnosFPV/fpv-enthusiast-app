import React from 'react';
import Svg, { Path, Circle, Line } from 'react-native-svg';

interface GogglesIconProps {
  size?: number;
  color?: string;
  focused?: boolean;
}

/**
 * Line-art Orqa FPV.One style goggles icon.
 *
 * The Orqa shell has a very distinctive faceted octagonal silhouette —
 * like a cut gem — viewed straight-on from the face side. The two large
 * circular eye openings are the most recognisable feature.
 *
 * Outer octagon (all-corner-chamfered hex):
 *   top-left chamfer, top-right chamfer, bottom corners chamfered too.
 * Two circles for the lens/eye openings.
 * A small connecting bridge between the two circles.
 */
export default function GogglesIcon({
  size = 28,
  color = '#888',
  focused = false,
}: GogglesIconProps) {
  const stroke = color;
  const sw = 1.5;

  // Outer octagon path – faceted corners, approx 2.3:1 width:height
  // viewBox 0 0 28 28
  // Body:  x: 1.5 → 26.5,  y: 6 → 22
  // Chamfer size: ~3 units on each corner
  const outerBody = [
    'M 4.5 6',       // top edge start (after top-left chamfer)
    'L 23.5 6',      // top edge end
    'L 26.5 9',      // top-right chamfer
    'L 26.5 19',     // right edge
    'L 23.5 22',     // bottom-right chamfer
    'L 4.5 22',      // bottom edge
    'L 1.5 19',      // bottom-left chamfer
    'L 1.5 9',       // left edge
    'Z',             // close → top-left chamfer back to start
  ].join(' ');

  // Inner facet line — horizontal crease across the upper body
  // (mimics the faceted panel seam visible on the Orqa shell)
  // runs from inner-left to inner-right at y=12
  // small notch at centre top (the vent grille hint)

  // Left eye circle: cx=9, cy=14.5, r=4.5
  // Right eye circle: cx=19, cy=14.5, r=4.5

  return (
    <Svg width={size} height={size} viewBox="0 0 28 28">

      {/* ── Outer faceted shell ── */}
      <Path
        d={outerBody}
        stroke={stroke}
        strokeWidth={sw}
        fill={focused ? color : 'none'}
        fillOpacity={focused ? 0.15 : 0}
        strokeLinejoin="miter"
      />

      {/* ── Upper panel facet crease (diagonal cuts top-left / top-right) ── */}
      {/* Left diagonal: from top-left chamfer point down to centre-left */}
      <Line
        x1="4.5" y1="6" x2="7" y2="12"
        stroke={stroke} strokeWidth={sw - 0.4} strokeLinecap="round"
      />
      {/* Right diagonal: from top-right chamfer point down to centre-right */}
      <Line
        x1="23.5" y1="6" x2="21" y2="12"
        stroke={stroke} strokeWidth={sw - 0.4} strokeLinecap="round"
      />
      {/* Horizontal crease across the top panel */}
      <Line
        x1="7" y1="12" x2="21" y2="12"
        stroke={stroke} strokeWidth={sw - 0.4} strokeLinecap="round"
      />

      {/* ── Left eye opening ── */}
      <Circle
        cx="9" cy="16" r="4.2"
        stroke={stroke}
        strokeWidth={sw}
        fill={focused ? color : 'none'}
        fillOpacity={focused ? 0.3 : 0}
      />

      {/* ── Right eye opening ── */}
      <Circle
        cx="19" cy="16" r="4.2"
        stroke={stroke}
        strokeWidth={sw}
        fill={focused ? color : 'none'}
        fillOpacity={focused ? 0.3 : 0}
      />

      {/* ── Nose bridge: short vertical bar connecting the two circles ── */}
      <Line
        x1="14" y1="12.5" x2="14" y2="19.5"
        stroke={stroke} strokeWidth={sw - 0.3} strokeLinecap="round"
      />

    </Svg>
  );
}
