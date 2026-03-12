import React from 'react';
import Svg, { Path, Rect, G } from 'react-native-svg';

interface GogglesIconProps {
  size?: number;
  color?: string;
  focused?: boolean;
}

/**
 * Line-art FPV goggle icon based on DJI-style box goggles.
 *
 * Key features from reference image:
 *  - Wide, slightly trapezoidal outer body (wider at top, slightly narrower at bottom)
 *  - Two large landscape-orientation rounded-rect lenses side by side
 *  - Inverted-U nose bridge cutout at the bottom center
 *  - Two short stubby rectangular antennas at top-left and top-right corners
 *  - Clean inner rounded-rect lens inset lines (screen bezel detail)
 *
 * viewBox: 0 0 32 22  (wider than tall, matches goggle proportions)
 * Rendered at requested `size` width; height scales proportionally.
 */
export default function GogglesIcon({
  size = 28,
  color = '#888',
  focused = false,
}: GogglesIconProps) {
  const sw = 1.6;           // main stroke width
  const swThin = 1.1;       // inner detail stroke width
  const fill = focused ? color : 'none';
  const fillOp = focused ? 0.12 : 0;

  // The SVG is 32 wide × 22 tall (aspect ~1.45:1)
  // We render it at `size` wide, height = size * (22/32)
  const h = size * (22 / 32);

  return (
    <Svg
      width={size}
      height={h}
      viewBox="0 0 32 22"
    >
      {/* ── Antenna left: short stubby rect, tilted slightly outward ───────── */}
      {/* Sits at top-left corner of the body, angled ~-15° */}
      <Path
        d="M 5.5 5.5 L 4.2 1.2 L 6.2 0.8 L 7.5 5.2 Z"
        stroke={color}
        strokeWidth={sw - 0.3}
        strokeLinejoin="round"
        fill={fill}
        fillOpacity={fillOp}
      />

      {/* ── Antenna right: mirror of left ─────────────────────────────────── */}
      <Path
        d="M 26.5 5.5 L 25.8 1.2 L 27.8 0.8 L 28.5 5.2 Z"
        stroke={color}
        strokeWidth={sw - 0.3}
        strokeLinejoin="round"
        fill={fill}
        fillOpacity={fillOp}
      />

      {/* ── Outer body ────────────────────────────────────────────────────── */}
      {/* Slightly trapezoidal: top is full width 2–30, bottom insets to 3–29  */}
      {/* Rounded corners r=2. Using a path for the trapezoid shape.           */}
      <Path
        d={[
          'M 4 5.8',        // top-left after antenna base
          'L 28 5.8',       // top edge to top-right
          'Q 30 5.8 30 7.8',// top-right rounded corner
          'L 30 18.5',      // right edge down
          'Q 30 20.5 28 20.5',// bottom-right rounded corner
          // Bottom edge: two segments with nose cutout in middle
          // Right side of nose cutout
          'L 19.5 20.5',
          // Nose bridge inverted-U cutout (goes UP then back down)
          'Q 19.5 20.5 19.2 19.8',
          'L 18.5 18.0',
          'Q 18.0 16.8 16 16.8',
          'Q 14 16.8 13.5 18.0',
          'L 12.8 19.8',
          'Q 12.5 20.5 12.5 20.5',
          // Left side of nose cutout
          'L 4 20.5',
          'Q 2 20.5 2 18.5',// bottom-left rounded corner
          'L 2 7.8',        // left edge up
          'Q 2 5.8 4 5.8',  // top-left rounded corner
          'Z',
        ].join(' ')}
        stroke={color}
        strokeWidth={sw}
        strokeLinejoin="round"
        strokeLinecap="round"
        fill={fill}
        fillOpacity={fillOp}
      />

      {/* ── Left lens: large rounded rect ─────────────────────────────────── */}
      {/* Positioned left of center, landscape orientation                    */}
      <Rect
        x="3.5"
        y="7.2"
        width="11.8"
        height="9.0"
        rx="1.8"
        ry="1.8"
        stroke={color}
        strokeWidth={sw}
        fill={fill}
        fillOpacity={fillOp * 2}
      />

      {/* ── Left lens inner inset line (screen bezel detail) ──────────────── */}
      <Rect
        x="5.0"
        y="8.5"
        width="8.8"
        height="6.2"
        rx="1.2"
        ry="1.2"
        stroke={color}
        strokeWidth={swThin}
        strokeOpacity={0.55}
        fill="none"
      />

      {/* ── Right lens: mirror of left ────────────────────────────────────── */}
      <Rect
        x="16.7"
        y="7.2"
        width="11.8"
        height="9.0"
        rx="1.8"
        ry="1.8"
        stroke={color}
        strokeWidth={sw}
        fill={fill}
        fillOpacity={fillOp * 2}
      />

      {/* ── Right lens inner inset line ───────────────────────────────────── */}
      <Rect
        x="18.2"
        y="8.5"
        width="8.8"
        height="6.2"
        rx="1.2"
        ry="1.2"
        stroke={color}
        strokeWidth={swThin}
        strokeOpacity={0.55}
        fill="none"
      />

    </Svg>
  );
}
