import React from 'react';
import Svg, { Path, Ellipse, G } from 'react-native-svg';

interface GogglesIconProps {
  size?: number;
  color?: string;
  focused?: boolean;
}

/**
 * Line-art FPV goggle icon — FACE SIDE (the side that presses against your face).
 *
 * Based on reference image:
 *  - Wide, gently curved outer body — wider than tall (~2.2:1 ratio)
 *  - Two large LANDSCAPE oval eye openings side by side (the foam eye cups)
 *  - Continuous inner panel seam running around both eye cups
 *  - A PROTRUDING nose bridge piece at the bottom-center — trapezoidal bump
 *    that sits between/below the two eye openings
 *  - Two short stubby antennas at top-left and top-right, angled outward
 *
 * viewBox: 0 0 44 26
 */
export default function GogglesIcon({
  size = 28,
  color = '#888',
  focused = false,
}: GogglesIconProps) {
  const sw = 1.8;
  const swInner = 1.1;
  const fill = focused ? color : 'none';
  const fillOp = focused ? 0.13 : 0;
  const h = size * (26 / 44);

  return (
    <Svg width={size} height={h} viewBox="0 0 44 26">

      {/* ── Antenna left: short stub, angled ~20° outward from top-left ─── */}
      <Path
        d="M 6.5 6.5 L 4.0 1.2 L 6.2 0.5 L 8.8 5.8 Z"
        stroke={color}
        strokeWidth={1.3}
        strokeLinejoin="round"
        strokeLinecap="round"
        fill={fill}
        fillOpacity={fillOp}
      />

      {/* ── Antenna right: mirror ────────────────────────────────────────── */}
      <Path
        d="M 37.5 6.5 L 35.2 0.5 L 37.5 1.2 L 40.0 6.5 Z"
        stroke={color}
        strokeWidth={1.3}
        strokeLinejoin="round"
        strokeLinecap="round"
        fill={fill}
        fillOpacity={fillOp}
      />

      {/* ── Outer body ───────────────────────────────────────────────────── */}
      {/*
          Wide rounded rectangle, gently wider at centre.
          Left and right edges are very slightly curved outward (barrel shape).
          Bottom has a small notch/relief where the nose bridge protrudes.
          Approximate: x 1.5–42.5, y 5.5–23, r=3
      */}
      <Path
        d={[
          'M 4.5 5.5',          // top-left (after corner radius)
          'L 39.5 5.5',         // top edge
          'Q 42.5 5.5 42.5 8.5',// top-right corner
          'L 42.5 20.5',        // right edge
          'Q 42.5 23.5 39.5 23.5',// bottom-right corner
          'L 26.5 23.5',        // bottom edge right portion
          // Nose bridge protrusion: drops down then comes back up
          'Q 25.5 23.5 25.2 24.2',
          'L 24.5 25.5',        // bottom of nose bridge right side
          'Q 22.5 26.2 21.5 26.2',// nose bridge bottom curve center
          'Q 20.5 26.2 19.5 25.5',
          'L 18.8 24.2',        // bottom of nose bridge left side
          'Q 18.5 23.5 17.5 23.5',
          'L 4.5 23.5',         // bottom edge left portion
          'Q 1.5 23.5 1.5 20.5',// bottom-left corner
          'L 1.5 8.5',          // left edge
          'Q 1.5 5.5 4.5 5.5',  // top-left corner
          'Z',
        ].join(' ')}
        stroke={color}
        strokeWidth={sw}
        strokeLinejoin="round"
        strokeLinecap="round"
        fill={fill}
        fillOpacity={fillOp}
      />

      {/* ── Inner panel seam — follows outer shape inset by ~2.5 units ───── */}
      {/*
          This is the continuous seam line visible around both eye cups on
          the face foam. It runs as one connected path around both openings.
          Left eye region: roughly x 3.5–20.5, inner seam at x 6–18
          Right eye region: roughly x 23.5–40.5, inner seam at x 25–40
          Connected with a centre bridge at top and bottom.
      */}
      <Path
        d={[
          // Start at top-left of left eye seam
          'M 6.0 8.5',
          'Q 4.5 8.5 4.5 10.0',  // top-left inner corner
          'L 4.5 18.5',
          'Q 4.5 21.0 7.0 21.0', // bottom-left inner corner
          'L 18.0 21.0',
          'Q 20.5 21.0 20.5 18.5',// bottom-right of left eye
          'L 20.5 10.0',
          'Q 20.5 8.5 18.0 8.5', // top-right of left eye
          // Centre bridge connecting left to right at top
          'L 26.0 8.5',
          'Q 23.5 8.5 23.5 10.0',
          'L 23.5 18.5',
          'Q 23.5 21.0 26.0 21.0',
          'L 37.0 21.0',
          'Q 39.5 21.0 39.5 18.5',
          'L 39.5 10.0',
          'Q 39.5 8.5 37.0 8.5',
          // Close back to start across the top bridge
          'L 6.0 8.5',
        ].join(' ')}
        stroke={color}
        strokeWidth={swInner}
        strokeLinejoin="round"
        strokeLinecap="round"
        fill="none"
        strokeOpacity={0.9}
      />

      {/* ── Left eye oval opening ────────────────────────────────────────── */}
      <Ellipse
        cx="12.2"
        cy="15.0"
        rx="6.5"
        ry="5.2"
        stroke={color}
        strokeWidth={sw}
        fill={fill}
        fillOpacity={fillOp * 2.5}
      />

      {/* ── Right eye oval opening ───────────────────────────────────────── */}
      <Ellipse
        cx="31.8"
        cy="15.0"
        rx="6.5"
        ry="5.2"
        stroke={color}
        strokeWidth={sw}
        fill={fill}
        fillOpacity={fillOp * 2.5}
      />

    </Svg>
  );
}
