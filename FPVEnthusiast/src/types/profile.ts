// src/types/profile.ts
// ─── UserProfile type ─────────────────────────────────────────────────────────
// Mirrors the `users` table in Supabase.
// Run SUPABASE_ADDITIONS.sql first to ensure all columns exist.

export interface UserProfile {
  id: string;
  username:          string | null;
  email?:            string | null;
  avatar_url?:       string | null;
  header_image_url?: string | null;   // banner photo
  bio?:              string | null;
  website_url?:      string | null;
  youtube_url?:      string | null;
  instagram_url?:    string | null;
  twitter_url?:      string | null;
  tiktok_url?:       string | null;
  autoplay_videos?:  boolean;         // default true — controlled in Settings
  followers_count?:  number;          // maintained by DB trigger
  following_count?:  number;          // maintained by DB trigger
  total_props?:      number;          // maintained manually or via trigger
  created_at?:       string;
  is_admin?:         boolean;          // admin moderation access
}
