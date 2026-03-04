// src/types/profile.ts
export interface UserProfile {
  id: string;
  email?: string | null;
  username?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
  header_image_url?: string | null;
  followers_count?: number | null;
  following_count?: number | null;
  total_props?: number | null;
  website_url?: string | null;
  youtube_url?: string | null;
  instagram_url?: string | null;
  twitter_url?: string | null;
  tiktok_url?: string | null;
  autoplay_videos?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
}
