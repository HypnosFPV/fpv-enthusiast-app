import React from 'react';
import Svg, { Path } from 'react-native-svg';

interface GogglesIconProps {
  size?: number;
  color?: string;
  focused?: boolean;
}

/**
 * Line-art FPV goggle icon — stroke-only, matches tab-bar icon style.
 * Shape matches reference image exactly. No fill — outlines only.
 */
export default function GogglesIcon({
  size = 28,
  color = '#888',
  focused = false,
}: GogglesIconProps) {
  const h = size * (36 / 56);
  const sw = 1.5;       // outer stroke weight
  const sd = 1.1;       // inner detail stroke weight

  return (
    <Svg width={size} height={h} viewBox="0 0 56 36">

      {/* ── Antenna LEFT */}
      <Path
        d="M 9 10  L 6.5 2  L 11 1.5  L 13.5 9.5  Z"
        fill="none"
        stroke={color}
        strokeWidth={sw - 0.2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* ── Antenna RIGHT */}
      <Path
        d="M 47 10  L 42.5 1.5  L 47 2  L 49.5 10  Z"
        fill="none"
        stroke={color}
        strokeWidth={sw - 0.2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* ── Outer body — stroke only, no fill */}
      <Path
        d={[
          'M 8 10',
          'Q 14 7.5 28 7',
          'Q 42 7.5 48 10',
          'Q 52 11.5 52.5 16',
          'Q 53 21 51 25',
          'Q 49 29 46 30',
          'L 34 30',
          'Q 31.5 30 30.5 31.5',
          'L 29.5 33',
          'Q 28 34.5 26.5 33',
          'L 25.5 31.5',
          'Q 24.5 30 22 30',
          'L 10 30',
          'Q 7 29 5 25',
          'Q 3 21 3 16',
          'Q 3.5 11.5 8 10',
          'Z',
        ].join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={sw}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* ── Lens frame outline — single rounded-rect across both eyes */}
      <Path
        d={[
          'M 9 12',
          'Q 7.5 12 7.5 13.5',
          'L 7.5 24.5',
          'Q 7.5 26 9 26',
          'L 47 26',
          'Q 48.5 26 48.5 24.5',
          'L 48.5 13.5',
          'Q 48.5 12 47 12',
          'Z',
        ].join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={sd}
        strokeLinejoin="round"
      />

      {/* ── Center divider between left and right lens */}
      <Path
        d="M 28 12 L 28 26"
        fill="none"
        stroke={color}
        strokeWidth={sd}
        strokeLinecap="round"
      />

      {/* ── Nose bridge detail */}
      <Path
        d={[
          'M 23 26',
          'Q 22 27.5 24 29',
          'L 26 30',
          'Q 28 30.5 30 30',
          'L 32 29',
          'Q 34 27.5 33 26',
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
