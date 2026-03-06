// src/types/index.ts
// Central export for all app types.
// ─────────────────────────────────────────────────────────────────────────────

// Re-export profile types
export type { UserProfile } from './profile';

// ─── Map / Spots ─────────────────────────────────────────────────────────────

export type SpotType = 'freestyle' | 'bando' | 'race_track' | 'open_field' | 'indoor';
export type HazardLevel = 'low' | 'medium' | 'high';
export type EventType = 'race' | 'meetup' | 'training' | 'tiny_whoop' | 'championship' | 'fun_fly';
export type EventSource = 'community' | 'multigp';

// ─── Navigation ──────────────────────────────────────────────────────────────

export type RootTabParamList = {
  feed: undefined;
  map: undefined;
  explore: undefined;
  profile: undefined;
  settings: undefined;
};
