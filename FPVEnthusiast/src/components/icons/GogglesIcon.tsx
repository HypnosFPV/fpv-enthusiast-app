import React from 'react';
import Svg, { Path, G } from 'react-native-svg';

interface GogglesIconProps {
  size?: number;
  color?: string;
  focused?: boolean;
}

/**
 * Line-art FPV goggle icon.
 *
 * Exact replica of reference image (DJI-style front-facing goggles):
 *
 * Structure:
 *  - ONE solid filled dark body shape — wide, low, slightly convex on all sides
 *  - Top edge arches upward gently in the middle
 *  - Bottom edge has a slight downward curve
 *  - Left/right sides curve outward very slightly
 *  - TWO short rectangular antennas at top-left and top-right corners, angled slightly outward
 *  - INSIDE the body: white/colored LINE DETAILS only (no cutouts):
 *      • One large rounded-rect outline that spans nearly the full body width,
 *        split into LEFT and RIGHT lens areas by a center divider line
 *      • Below the lens outline: a nose-bridge/strap shape — two diagonal lines
 *        converging downward to a small trapezoid at bottom center
 *
 * viewBox: 0 0 56 36
 * Body fills roughly x:4–52, y:8–34 with arched top
 */
export default function GogglesIcon({
  size = 28,
  color = '#888',
  focused = false,
}: GogglesIconProps) {
  const h = size * (36 / 56);

  // Stroke width for the detail lines drawn ON TOP of the filled body
  const sw = 1.4;

  // The body fill: when focused use color at full opacity, otherwise use color at low opacity
  const bodyFill   = color;
  const bodyFillOp = focused ? 0.85 : 0.75;

  // The detail lines drawn inside the body (contrasting against the fill)
  // When focused they should be visible — we use a "cut-out" look with
  // the background color. In practice for tab bar icons, color is either
  // active orange or inactive grey, so we draw lines in the parent bg color.
  // Simplest approach: draw detail lines in 'none' fill with stroke same color
  // but we want them to look LIGHTER than the body. So we use white at opacity
  // for the inner lines (matching the reference which has white lines on dark body).
  // For a proper tab icon we use: stroke the inner lines with same color but
  // just draw them as unfilled strokes — they will show as lighter on dark body.

  return (
    <Svg width={size} height={h} viewBox="0 0 56 36">

      {/* ── Antenna LEFT: rectangular stub at top-left, angled ~15° outward */}
      <Path
        d="M 9 10  L 6.5 2  L 11 1.5  L 13.5 9.5  Z"
        fill={bodyFill}
        fillOpacity={bodyFillOp}
        stroke={color}
        strokeWidth={0.8}
        strokeLinejoin="round"
      />

      {/* ── Antenna RIGHT: mirror of left */}
      <Path
        d="M 47 10  L 42.5 1.5  L 47 2  L 49.5 10  Z"
        fill={bodyFill}
        fillOpacity={bodyFillOp}
        stroke={color}
        strokeWidth={0.8}
        strokeLinejoin="round"
      />

      {/* ── Main body silhouette ─────────────────────────────────────────── */}
      {/*
          Wide shape, top edge arches up ~2 units at center.
          Bottom edge is relatively flat with a tiny downward curve.
          Left/right sides curve outward ~1.5 units at mid-height.
          All corners are well-rounded (r~4).
      */}
      <Path
        d={[
          'M 8 10',              // top-left start
          'Q 14 7.5 28 7',       // top edge arching up toward center
          'Q 42 7.5 48 10',      // top edge arching back down to top-right
          'Q 52 11.5 52.5 16',   // top-right corner curving into right side
          'Q 53 21 51 25',       // right side
          'Q 49 29 46 30',       // bottom-right corner
          'L 34 30',             // bottom edge right
          'Q 31.5 30 30.5 31.5', // bottom-right of nose bridge
          'L 29.5 33',           // nose bridge right diagonal
          'Q 28 34.5 26.5 33',   // nose bridge bottom point
          'L 25.5 31.5',         // nose bridge left diagonal
          'Q 24.5 30 22 30',     // bottom-left of nose bridge
          'L 10 30',             // bottom edge left
          'Q 7 29 5 25',         // bottom-left corner
          'Q 3 21 3 16',         // left side
          'Q 3.5 11.5 8 10',     // top-left corner back to start
          'Z',
        ].join(' ')}
        fill={bodyFill}
        fillOpacity={bodyFillOp}
        stroke={color}
        strokeWidth={sw}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* ── Detail lines (white lines on the dark body, matching reference) */}

      {/*
          OUTER lens frame: one large rounded-rect spanning most of the body,
          inset ~3 units from body edges. Reference shows this as a single
          rounded rectangle that goes across both eye areas.
      */}
      <Path
        d={[
          'M 9 12',
          'Q 7.5 12 7.5 13.5',   // top-left corner of lens frame
          'L 7.5 24.5',
          'Q 7.5 26 9 26',       // bottom-left corner
          'L 47 26',
          'Q 48.5 26 48.5 24.5', // bottom-right corner
          'L 48.5 13.5',
          'Q 48.5 12 47 12',     // top-right corner
          'Z',
        ].join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={sw - 0.2}
        strokeLinejoin="round"
        strokeOpacity={focused ? 0.5 : 0.6}
      />

      {/*
          CENTER DIVIDER: vertical line splitting left and right lens areas.
          In the reference this is a thin line at center x=28.
      */}
      <Path
        d="M 28 12 L 28 26"
        fill="none"
        stroke={color}
        strokeWidth={sw - 0.4}
        strokeLinecap="round"
        strokeOpacity={focused ? 0.5 : 0.6}
      />

      {/*
          NOSE BRIDGE detail lines: two diagonal lines from bottom of the
          center divider area converging down to the nose bridge protrusion.
          This matches the white inverted-V / trapezoid detail in the reference.
      */}
      <Path
        d={[
          'M 23 26',             // left start at bottom of lens frame
          'Q 22 27.5 24 29',     // curves down-left then back
          'L 26 30',             // to top of nose bridge left
          'Q 28 30.5 30 30',     // across nose bridge top
          'L 32 29',
          'Q 34 27.5 33 26',     // right side mirror
        ].join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={sw - 0.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeOpacity={focused ? 0.5 : 0.6}
      />

    </Svg>
  );
}
