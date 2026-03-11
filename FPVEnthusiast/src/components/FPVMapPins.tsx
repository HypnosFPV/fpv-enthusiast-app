// src/components/FPVMapPins.tsx
// Custom SVG-based FPV-themed map pin markers for react-native-maps
import React from 'react';
import { View } from 'react-native';
import Svg, {
  Path, G, Circle, Rect, Polygon, Ellipse,
  Line, Defs, RadialGradient, Stop, LinearGradient,
  ClipPath, Text as SvgText,
} from 'react-native-svg';

// ─── Shared pin shell ─────────────────────────────────────────────────────────
// All pins use the same outer shape: shield/teardrop with a shadow dot

interface PinShellProps {
  color: string;
  size?: number;
  children: React.ReactNode;
  glowColor?: string;
  hasEvent?: boolean;  // show calendar badge on spot pins
}

function PinShell({ color, size = 44, children, glowColor, hasEvent }: PinShellProps) {
  const w = size;
  const h = size * 1.35;
  const r = size / 2;
  // Teardrop path: circle on top + triangle pointing down
  // Viewbox 0 0 44 60
  return (
    <View style={{ alignItems: 'center', width: w, height: h + 6 }}>
      <Svg width={w} height={h} viewBox="0 0 44 58">
        <Defs>
          <RadialGradient id={`grad_${color.replace('#','')}`} cx="50%" cy="40%" r="60%">
            <Stop offset="0%" stopColor="#ffffff" stopOpacity="0.25" />
            <Stop offset="100%" stopColor={color} stopOpacity="1" />
          </RadialGradient>
        </Defs>
        {/* Drop shadow */}
        <Ellipse cx="22" cy="56" rx="7" ry="3" fill="rgba(0,0,0,0.35)" />
        {/* Pin body — shield top + pointed bottom */}
        <Path
          d="M22 2 C10 2 4 10 4 20 C4 33 22 54 22 54 C22 54 40 33 40 20 C40 10 34 2 22 2 Z"
          fill={`url(#grad_${color.replace('#','')})`}
          stroke="rgba(255,255,255,0.35)"
          strokeWidth="1.5"
        />
        {/* Inner circle background */}
        <Circle cx="22" cy="20" r="14" fill="rgba(0,0,0,0.30)" />
        {/* Icon content goes here (positioned in 8..36 x 6..34 range) */}
        {children}
        {/* Upcoming-event badge — orange calendar dot on top-right */}
        {hasEvent && (
          <G>
            <Circle cx="35" cy="7" r="6.5" fill="#FF6D00" stroke="#1a1a2e" strokeWidth="1.5" />
            <SvgText x="35" y="10.5" fontSize="7" fill="#fff" fontWeight="bold" textAnchor="middle">📅</SvgText>
          </G>
        )}
      </Svg>
    </View>
  );
}

// ─── SPOT PINS ────────────────────────────────────────────────────────────────

// Freestyle — quad drone top-view (green)
export function FreestylePin({ size = 44, hasEvent = false }: { size?: number; hasEvent?: boolean }) {
  return (
    <PinShell color="#00C853" size={size} hasEvent={hasEvent}>
      {/* Quad drone: 4 arms + motors */}
      <G transform="translate(22,20)">
        {/* Arms */}
        <Line x1="-10" y1="-10" x2="10" y2="10" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
        <Line x1="10" y1="-10" x2="-10" y2="10" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
        {/* Motors */}
        <Circle cx="-10" cy="-10" r="4" fill="#00C853" stroke="#fff" strokeWidth="1.5" />
        <Circle cx="10" cy="-10" r="4" fill="#00C853" stroke="#fff" strokeWidth="1.5" />
        <Circle cx="10"  cy="10"  r="4" fill="#00C853" stroke="#fff" strokeWidth="1.5" />
        <Circle cx="-10" cy="10"  r="4" fill="#00C853" stroke="#fff" strokeWidth="1.5" />
        {/* Centre body */}
        <Rect x="-4" y="-4" width="8" height="8" rx="2" fill="#fff" opacity="0.9" />
      </G>
    </PinShell>
  );
}

// Bando — broken building with hole (orange)
export function BandoPin({ size = 44, hasEvent = false }: { size?: number; hasEvent?: boolean }) {
  return (
    <PinShell color="#FF6D00" size={size} hasEvent={hasEvent}>
      <G transform="translate(22,20)">
        {/* Building outline */}
        <Rect x="-10" y="-10" width="20" height="18" rx="1" fill="none" stroke="#fff" strokeWidth="2" />
        {/* Broken wall */}
        <Path d="M-10 -2 L-6 -2 L-4 4 L-10 4" fill="#fff" opacity="0.7" />
        {/* Hole */}
        <Ellipse cx="4" cy="3" rx="4" ry="5" fill="rgba(0,0,0,0.5)" stroke="#fff" strokeWidth="1.5" />
        {/* Rubble dots */}
        <Circle cx="-8" cy="8" r="1.5" fill="#fff" opacity="0.6" />
        <Circle cx="5"  cy="9" r="1"   fill="#fff" opacity="0.6" />
        <Circle cx="9"  cy="8" r="1.5" fill="#fff" opacity="0.6" />
      </G>
    </PinShell>
  );
}

// Race Track — gates + checkered (blue)
export function RaceTrackPin({ size = 44, hasEvent = false }: { size?: number; hasEvent?: boolean }) {
  return (
    <PinShell color="#2979FF" size={size} hasEvent={hasEvent}>
      <G transform="translate(22,20)">
        {/* Gate arch */}
        <Path d="M-11 8 L-11 -6 C-11 -14 11 -14 11 -6 L11 8"
          fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
        {/* Gate crossbar */}
        <Line x1="-11" y1="-2" x2="11" y2="-2" stroke="#fff" strokeWidth="2" />
        {/* Flag checkered pattern (2x2 mini) */}
        <Rect x="-5" y="-12" width="4" height="3" fill="#fff" />
        <Rect x="-1" y="-9"  width="4" height="3" fill="#fff" />
        <Rect x="-1" y="-12" width="4" height="3" fill="none" />
        <Rect x="-5" y="-9"  width="4" height="3" fill="none" />
      </G>
    </PinShell>
  );
}

// Open Field — grass waves + horizon (yellow)
export function OpenFieldPin({ size = 44, hasEvent = false }: { size?: number; hasEvent?: boolean }) {
  return (
    <PinShell color="#FFD600" size={size} hasEvent={hasEvent}>
      <G transform="translate(22,20)">
        {/* Horizon line */}
        <Line x1="-11" y1="1" x2="11" y2="1" stroke="#fff" strokeWidth="1.5" opacity="0.6" />
        {/* Grass blades */}
        <Path d="M-9 1 C-9 1 -8 -8 -7 -5 C-7 -5 -6 -10 -5 -4" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />
        <Path d="M-2 1 C-2 1 -1 -10 0  -6 C0  -6  1 -12  2 -5" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />
        <Path d="M 5 1 C 5  1  6  -7  7  -4 C 7  -4  8  -9  9  -3" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />
        {/* Sun */}
        <Circle cx="0" cy="-5" r="3" fill="rgba(255,255,255,0.0)" />
      </G>
    </PinShell>
  );
}

// Indoor — house + tiny drone inside (purple)
export function IndoorPin({ size = 44, hasEvent = false }: { size?: number; hasEvent?: boolean }) {
  return (
    <PinShell color="#E040FB" size={size} hasEvent={hasEvent}>
      <G transform="translate(22,20)">
        {/* House roof */}
        <Polygon points="0,-13 -11,-3 11,-3" fill="#fff" opacity="0.9" />
        {/* House walls */}
        <Rect x="-8" y="-3" width="16" height="12" rx="1" fill="#fff" opacity="0.9" />
        {/* Door */}
        <Rect x="-2.5" y="2" width="5" height="7" rx="1" fill="#E040FB" />
        {/* Tiny drone inside */}
        <G transform="translate(0,-7) scale(0.45)">
          <Line x1="-8" y1="-8" x2="8" y2="8" stroke="#E040FB" strokeWidth="3" />
          <Line x1="8" y1="-8" x2="-8" y2="8" stroke="#E040FB" strokeWidth="3" />
          <Circle cx="-8" cy="-8" r="3.5" fill="#E040FB" stroke="#fff" strokeWidth="1.5" />
          <Circle cx=" 8" cy="-8" r="3.5" fill="#E040FB" stroke="#fff" strokeWidth="1.5" />
          <Circle cx=" 8" cy=" 8" r="3.5" fill="#E040FB" stroke="#fff" strokeWidth="1.5" />
          <Circle cx="-8" cy=" 8" r="3.5" fill="#E040FB" stroke="#fff" strokeWidth="1.5" />
          <Rect x="-3" y="-3" width="6" height="6" rx="1.5" fill="#fff" />
        </G>
      </G>
    </PinShell>
  );
}

// ─── EVENT PINS ───────────────────────────────────────────────────────────────

// Race — racing drone profile + speed lines (red)
export function RaceEventPin({ size = 44, isMultiGP = false }: { size?: number; isMultiGP?: boolean }) {
  return (
    <PinShell color="#FF1744" size={size}>
      <G transform="translate(22,20)">
        {/* Speed lines */}
        <Line x1="-13" y1="-4" x2="-4" y2="-4" stroke="#fff" strokeWidth="1.5" opacity="0.6" strokeLinecap="round" />
        <Line x1="-13" y1="0"  x2="-4" y2="0"  stroke="#fff" strokeWidth="1.5" opacity="0.6" strokeLinecap="round" />
        <Line x1="-13" y1="4"  x2="-4" y2="4"  stroke="#fff" strokeWidth="1.5" opacity="0.6" strokeLinecap="round" />
        {/* Racing drone body side-profile */}
        <Ellipse cx="3" cy="0" rx="8" ry="5" fill="#fff" opacity="0.9" />
        {/* Camera lens */}
        <Circle cx="-2" cy="0" r="2.5" fill="#FF1744" stroke="#fff" strokeWidth="1" />
        {/* Prop top */}
        <Ellipse cx="3" cy="-5" rx="5" ry="1.5" fill="#fff" opacity="0.5" />
        {/* Tail */}
        <Path d="M11 -3 L14 0 L11 3" fill="#fff" opacity="0.7" />
        {/* MultiGP badge */}
        {isMultiGP && (
          <Rect x="4" y="-13" width="12" height="7" rx="3.5" fill="#2979FF" />
        )}
        {isMultiGP && (
          <SvgText x="10" y="-7.5" fontSize="5" fill="#fff" fontWeight="bold" textAnchor="middle">M</SvgText>
        )}
      </G>
    </PinShell>
  );
}

// Meetup — two drones facing each other (orange)
export function MeetupEventPin({ size = 44 }: { size?: number }) {
  return (
    <PinShell color="#FF9100" size={size}>
      <G transform="translate(22,20)">
        {/* Drone 1 (left, smaller) */}
        <G transform="translate(-6,-2) scale(0.7)">
          <Line x1="-7" y1="-7" x2="7" y2="7" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
          <Line x1="7"  y1="-7" x2="-7" y2="7" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
          <Circle cx="-7" cy="-7" r="3" fill="#FF9100" stroke="#fff" strokeWidth="1.5" />
          <Circle cx=" 7" cy="-7" r="3" fill="#FF9100" stroke="#fff" strokeWidth="1.5" />
          <Circle cx=" 7" cy=" 7" r="3" fill="#FF9100" stroke="#fff" strokeWidth="1.5" />
          <Circle cx="-7" cy=" 7" r="3" fill="#FF9100" stroke="#fff" strokeWidth="1.5" />
          <Rect x="-3" y="-3" width="6" height="6" rx="1.5" fill="#fff" />
        </G>
        {/* Drone 2 (right, slightly larger) */}
        <G transform="translate(6,-2) scale(0.85)">
          <Line x1="-7" y1="-7" x2="7" y2="7" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
          <Line x1="7"  y1="-7" x2="-7" y2="7" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
          <Circle cx="-7" cy="-7" r="3" fill="#FF9100" stroke="#fff" strokeWidth="1.5" />
          <Circle cx=" 7" cy="-7" r="3" fill="#FF9100" stroke="#fff" strokeWidth="1.5" />
          <Circle cx=" 7" cy=" 7" r="3" fill="#FF9100" stroke="#fff" strokeWidth="1.5" />
          <Circle cx="-7" cy=" 7" r="3" fill="#FF9100" stroke="#fff" strokeWidth="1.5" />
          <Rect x="-3" y="-3" width="6" height="6" rx="1.5" fill="#fff" />
        </G>
        {/* Signal arcs */}
        <Path d="M0 -12 C-4 -12 -4 -8 0 -8" fill="none" stroke="#fff" strokeWidth="1.5" opacity="0.6" strokeLinecap="round" />
        <Path d="M0 -15 C-7 -15 -7 -5 0 -5" fill="none" stroke="#fff" strokeWidth="1" opacity="0.35" strokeLinecap="round" />
      </G>
    </PinShell>
  );
}

// Training — drone + graduation book (cyan)
export function TrainingEventPin({ size = 44 }: { size?: number }) {
  return (
    <PinShell color="#00BCD4" size={size}>
      <G transform="translate(22,20)">
        {/* Open book */}
        <Path d="M0 4 C0 4 -10 2 -11 -4 C-11 -4 -11 -10 0 -8" fill="#fff" opacity="0.85" />
        <Path d="M0 4 C0 4  10 2  11 -4 C 11 -4  11 -10 0 -8" fill="#fff" opacity="0.65" />
        <Line x1="0" y1="-8" x2="0" y2="4" stroke="#00BCD4" strokeWidth="1.5" />
        {/* Mini drone above book */}
        <G transform="translate(0,-12) scale(0.55)">
          <Line x1="-7" y1="-7" x2="7" y2="7" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
          <Line x1="7"  y1="-7" x2="-7" y2="7" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
          <Circle cx="-7" cy="-7" r="3.5" fill="#00BCD4" stroke="#fff" strokeWidth="1.5" />
          <Circle cx=" 7" cy="-7" r="3.5" fill="#00BCD4" stroke="#fff" strokeWidth="1.5" />
          <Circle cx=" 7" cy=" 7" r="3.5" fill="#00BCD4" stroke="#fff" strokeWidth="1.5" />
          <Circle cx="-7" cy=" 7" r="3.5" fill="#00BCD4" stroke="#fff" strokeWidth="1.5" />
          <Rect x="-3" y="-3" width="6" height="6" rx="1.5" fill="#fff" />
        </G>
      </G>
    </PinShell>
  );
}

// Tiny Whoop — tiny ducted whoop shape (pink)
export function TinyWhoopPin({ size = 44 }: { size?: number }) {
  return (
    <PinShell color="#E91E63" size={size}>
      <G transform="translate(22,20)">
        {/* Main whoop body */}
        <Rect x="-7" y="-5" width="14" height="10" rx="3" fill="#fff" opacity="0.9" />
        {/* 4 ducts */}
        <Circle cx="-10" cy="-8"  r="4.5" fill="none" stroke="#fff" strokeWidth="2" />
        <Circle cx=" 10" cy="-8"  r="4.5" fill="none" stroke="#fff" strokeWidth="2" />
        <Circle cx=" 10" cy=" 8"  r="4.5" fill="none" stroke="#fff" strokeWidth="2" />
        <Circle cx="-10" cy=" 8"  r="4.5" fill="none" stroke="#fff" strokeWidth="2" />
        {/* Prop blades inside ducts */}
        <Line x1="-12" y1="-8" x2="-8" y2="-8" stroke="#E91E63" strokeWidth="1.5" />
        <Line x1="-10" y1="-10" x2="-10" y2="-6" stroke="#E91E63" strokeWidth="1.5" />
        <Line x1=" 8"  y1="-8" x2="12" y2="-8" stroke="#E91E63" strokeWidth="1.5" />
        <Line x1=" 10" y1="-10" x2="10" y2="-6" stroke="#E91E63" strokeWidth="1.5" />
        <Line x1=" 8"  y1=" 8" x2="12" y2=" 8" stroke="#E91E63" strokeWidth="1.5" />
        <Line x1=" 10" y1=" 6" x2="10" y2="10" stroke="#E91E63" strokeWidth="1.5" />
        <Line x1="-12" y1=" 8" x2="-8" y2=" 8" stroke="#E91E63" strokeWidth="1.5" />
        <Line x1="-10" y1=" 6" x2="-10" y2="10" stroke="#E91E63" strokeWidth="1.5" />
        {/* Camera */}
        <Circle cx="0" cy="0" r="2.5" fill="#E91E63" stroke="#fff" strokeWidth="1" />
      </G>
    </PinShell>
  );
}

// Championship — trophy with wings (gold)
export function ChampionshipPin({ size = 44 }: { size?: number }) {
  return (
    <PinShell color="#FFD700" size={size}>
      <G transform="translate(22,20)">
        {/* Trophy cup */}
        <Path d="M-6 -12 L-6 2 C-6 6 6 6 6 2 L6 -12 Z" fill="#fff" opacity="0.95" />
        {/* Trophy handles */}
        <Path d="M-6 -10 C-6 -10 -12 -10 -12 -5 C-12 0 -6 0 -6 0" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
        <Path d="M6  -10 C6  -10  12 -10  12 -5 C 12 0  6  0  6  0" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
        {/* Base */}
        <Rect x="-4" y="6" width="8" height="2.5" rx="1" fill="#fff" opacity="0.9" />
        <Rect x="-6" y="8" width="12" height="2.5" rx="1" fill="#fff" opacity="0.9" />
        {/* Star inside */}
        <Polygon
          points="0,-9 1.4,-5 5.5,-5 2.2,-3 3.4,1 0,-1.5 -3.4,1 -2.2,-3 -5.5,-5 -1.4,-5"
          fill="#FFD700"
        />
        {/* Wing lines */}
        <Path d="M-12 -6 C-15 -9 -14 -13 -11 -12" fill="none" stroke="#fff" strokeWidth="1.5" opacity="0.6" strokeLinecap="round" />
        <Path d=" 12 -6 C 15 -9  14 -13  11 -12" fill="none" stroke="#fff" strokeWidth="1.5" opacity="0.6" strokeLinecap="round" />
      </G>
    </PinShell>
  );
}

// Fun Fly — drone with smile (lime green)
export function FunFlyPin({ size = 44 }: { size?: number }) {
  return (
    <PinShell color="#76FF03" size={size}>
      <G transform="translate(22,20)">
        {/* Quad arms */}
        <Line x1="-10" y1="-10" x2="10" y2="10" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
        <Line x1="10"  y1="-10" x2="-10" y2="10" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
        {/* Motors — festive colors */}
        <Circle cx="-10" cy="-10" r="4" fill="#FF4081" stroke="#fff" strokeWidth="1.5" />
        <Circle cx=" 10" cy="-10" r="4" fill="#FF9100" stroke="#fff" strokeWidth="1.5" />
        <Circle cx=" 10" cy=" 10" r="4" fill="#00B0FF" stroke="#fff" strokeWidth="1.5" />
        <Circle cx="-10" cy=" 10" r="4" fill="#FFD600" stroke="#fff" strokeWidth="1.5" />
        {/* Smiley face body */}
        <Circle cx="0" cy="0" r="5" fill="#fff" />
        {/* Eyes */}
        <Circle cx="-2" cy="-1" r="1"   fill="#76FF03" />
        <Circle cx=" 2" cy="-1" r="1"   fill="#76FF03" />
        {/* Smile */}
        <Path d="M-2.5 2 C-1 3.5 1 3.5 2.5 2" fill="none" stroke="#76FF03" strokeWidth="1.2" strokeLinecap="round" />
      </G>
    </PinShell>
  );
}

// ─── Lookup maps (same keys as SPOT_CONFIG / EVENT_CONFIG) ───────────────────

export const SPOT_PIN_MAP: Record<string, React.FC<{ size?: number; hasEvent?: boolean }>> = {
  freestyle:  FreestylePin,
  bando:      BandoPin,
  race_track: RaceTrackPin,
  open_field: OpenFieldPin,
  indoor:     IndoorPin,
};

export const EVENT_PIN_MAP: Record<string, React.FC<{ size?: number; isMultiGP?: boolean }>> = {
  race:         RaceEventPin,
  meetup:       MeetupEventPin,
  training:     TrainingEventPin,
  tiny_whoop:   TinyWhoopPin,
  championship: ChampionshipPin,
  fun_fly:      FunFlyPin,
};
