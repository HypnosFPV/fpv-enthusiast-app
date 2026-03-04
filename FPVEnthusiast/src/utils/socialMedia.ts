import { Linking, Alert } from 'react-native';

// ── Platform config ───────────────────────────────────────────────────────────
export const PLATFORM_CONFIG: Record<string, {
  name: string;
  color: string;
  icon: string;
  actionLabel: string;
  embedHeight: number;
}> = {
  youtube: {
    name: 'YouTube',
    color: '#FF0000',
    icon: 'logo-youtube',
    actionLabel: 'Subscribe',
    embedHeight: 220,
  },
  instagram: {
    name: 'Instagram',
    color: '#E1306C',
    icon: 'logo-instagram',
    actionLabel: 'Follow',
    embedHeight: 480,
  },
  tiktok: {
    name: 'TikTok',
    color: '#010101',
    icon: 'musical-notes',
    actionLabel: 'Follow',
    embedHeight: 560,
  },
  facebook: {
    name: 'Facebook',
    color: '#1877F2',
    icon: 'logo-facebook',
    actionLabel: 'Like',
    embedHeight: 300,
  },
};

// ── Detect platform from URL ──────────────────────────────────────────────────
export function detectPlatform(url: string): string | null {
  if (!url) return null;
  const lower = url.toLowerCase();
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'youtube';
  if (lower.includes('instagram.com')) return 'instagram';
  if (lower.includes('tiktok.com')) return 'tiktok';
  if (lower.includes('facebook.com') || lower.includes('fb.com')) return 'facebook';
  return null;
}

// ── Extract YouTube video ID ──────────────────────────────────────────────────
export function getYoutubeVideoId(url: string): string | null {
  if (!url) return null;
  const patterns = [
    /(?:v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:shorts\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

// ── Get YouTube thumbnail URL ─────────────────────────────────────────────────
export function getYoutubeThumbnail(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

// ── Build embed URL for non-YouTube platforms ─────────────────────────────────
export function getEmbedUrl(url: string, platform: string | null): string | null {
  if (!url || !platform) return null;

  switch (platform) {
    case 'youtube': {
      const id = getYoutubeVideoId(url);
      if (!id) return null;
      return `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&playsinline=1&enablejsapi=1`;
    }
    case 'instagram': {
      // Convert post URL to embed
      // e.g. https://www.instagram.com/p/ABC123/ → https://www.instagram.com/p/ABC123/embed
      const match = url.match(/instagram\.com\/(?:p|reel)\/([A-Za-z0-9_-]+)/);
      if (!match) return null;
      return `https://www.instagram.com/p/${match[1]}/embed`;
    }
    case 'tiktok': {
      // e.g. https://www.tiktok.com/@user/video/123456
      const match = url.match(/video\/(\d+)/);
      if (!match) return null;
      return `https://www.tiktok.com/embed/v2/${match[1]}`;
    }
    case 'facebook': {
      const encoded = encodeURIComponent(url);
      return `https://www.facebook.com/plugins/video.php?href=${encoded}&show_text=0&width=560`;
    }
    default:
      return null;
  }
}

// ── Open URL externally ───────────────────────────────────────────────────────
export async function openUrl(url: string): Promise<void> {
  if (!url) return;
  try {
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      await Linking.openURL(url);
    } else {
      Alert.alert('Cannot open link', url);
    }
  } catch (e) {
    Alert.alert('Error', 'Could not open the link.');
  }
}

// ── Share a post (placeholder) ────────────────────────────────────────────────
export function sharePost(url: string): void {
  openUrl(url);
}
