import React from 'react';
import Svg, { Path, G } from 'react-native-svg';

interface GogglesIconProps {
  size?: number;
  color?: string;
  focused?: boolean;
}

/**
 * Line-art FPV goggle icon — stroke only, square viewBox so it renders
 * at the same visual size as other tab-bar icons (Ionicons etc.)
 *
 * viewBox 0 0 28 28 — goggles fill ~80% of the box so they appear
 * the same apparent size as the market/feed/map icons.
 */
export default function GogglesIcon({
  size = 28,
  color = '#888',
  focused = false,
}: GogglesIconProps) {
  const sw = 1.6;   // outer stroke
  const sd = 1.1;   // inner detail stroke

  return (
    <Svg width={size} height={size} viewBox="0 0 28 28">

      {/* ── Antenna LEFT: stub at top-left, angled outward */}
      <Path
        d="M 4.5 9  L 3.2 3.5  L 5.8 3.0  L 7.0 8.5  Z"
        fill="none"
        stroke={color}
        strokeWidth={sw - 0.3}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* ── Antenna RIGHT: mirror */}
      <Path
        d="M 23.5 9  L 21.0 3.0  L 23.8 3.5  L 24.8 9  Z"
        fill="none"
        stroke={color}
        strokeWidth={sw - 0.3}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* ── Outer body */}
      <Path
        d={[
          'M 4.0 9.0',
          'Q 7.0 7.2 14 6.8',     // top arch left-to-center
          'Q 21 7.2 24.0 9.0',    // top arch center-to-right
          'Q 26.2 10.2 26.5 13',  // top-right corner
          'Q 27 16.5 25.5 19.5',  // right side
          'Q 24.2 21.8 22.5 22.2',// bottom-right corner
          'L 17.0 22.2',          // bottom edge right
          'Q 15.8 22.2 15.3 23.0',// right side of nose bridge
          'L 14.8 24.0',          // nose bridge right slope
          'Q 14.0 24.8 13.2 24.0',// nose bridge bottom
          'L 12.7 23.0',          // nose bridge left slope
          'Q 12.2 22.2 11.0 22.2',// left side of nose bridge
          'L 5.5 22.2',           // bottom edge left
          'Q 3.8 21.8 2.5 19.5',  // bottom-left corner
          'Q 1.0 16.5 1.5 13',    // left side
          'Q 1.8 10.2 4.0 9.0',   // top-left corner
          'Z',
        ].join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={sw}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* ── Lens frame: single rounded-rect spanning both eyes */}
      <Path
        d={[
          'M 4.5 10.8',
          'Q 3.5 10.8 3.5 11.8',
          'L 3.5 19.8',
          'Q 3.5 20.8 4.5 20.8',
          'L 23.5 20.8',
          'Q 24.5 20.8 24.5 19.8',
          'L 24.5 11.8',
          'Q 24.5 10.8 23.5 10.8',
          'Z',
        ].join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={sd}
        strokeLinejoin="round"
      />

      {/* ── Center divider */}
      <Path
        d="M 14 10.8 L 14 20.8"
        fill="none"
        stroke={color}
        strokeWidth={sd}
        strokeLinecap="round"
      />

      {/* ── Nose bridge detail */}
      <Path
        d={[
          'M 11.5 20.8',
          'Q 11.0 21.6 12.0 22.2',
          'L 13.0 22.5',
          'Q 14.0 22.7 15.0 22.5',
          'L 16.0 22.2',
          'Q 17.0 21.6 16.5 20.8',
        ].join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={sd}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

    </Svg>
  );
}
