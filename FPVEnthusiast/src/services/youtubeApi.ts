// src/services/youtubeApi.ts
// Handles all communication with the YouTube Data API v3

const API_KEY = process.env.EXPO_PUBLIC_YOUTUBE_API_KEY ?? '';
const BASE    = 'https://www.googleapis.com/youtube/v3';

// ─── TypeScript Types ──────────────────────────────────────────────────────

export interface YTVideo {
  videoId:       string;
  title:         string;
  description:   string;
  thumbnail:     string;
  publishedAt:   string;
  duration?:     string;
  viewCount?:    string;
  likeCount?:    string;
  channelTitle?: string;
}

export interface YTChannel {
  channelId:          string;
  title:              string;
  customUrl?:         string;
  thumbnail:          string;
  subscriberCount?:   string;
  videoCount?:        string;
  uploadsPlaylistId:  string;
}

// ─── resolveChannel ────────────────────────────────────────────────────────
// Accepts any of:
//   https://www.youtube.com/channel/UCxxxxxx
//   https://www.youtube.com/@handle
//   https://www.youtube.com/c/customName
//   UCxxxxxx   (raw channel ID)
//   @handle    (raw handle)

export async function resolveChannel(input: string): Promise<YTChannel> {
  if (!API_KEY) {
    throw new Error('YouTube API key is missing. Check your .env file.');
  }

  let channelId: string | null = null;
  let forHandle: string | null = null;

  const channelMatch = input.match(/youtube\.com\/channel\/(UC[\w-]+)/);
  const handleMatch  = input.match(/youtube\.com\/@([\w.-]+)/);
  const customMatch  = input.match(/youtube\.com\/c\/([\w.-]+)/);

  if (channelMatch) {
    channelId = channelMatch[1];
  } else if (handleMatch) {
    forHandle = '@' + handleMatch[1];
  } else if (customMatch) {
    forHandle = customMatch[1];
  } else if (input.startsWith('UC')) {
    channelId = input.trim();
  } else {
    forHandle = input.trim().startsWith('@') ? input.trim() : '@' + input.trim();
  }

  const url = channelId
    ? `${BASE}/channels?part=snippet,contentDetails,statistics&id=${channelId}&key=${API_KEY}`
    : `${BASE}/channels?part=snippet,contentDetails,statistics&forHandle=${encodeURIComponent(forHandle!)}&key=${API_KEY}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`YouTube API error: ${res.status}`);
  const json = await res.json();

  if (!json.items?.length) {
    throw new Error('Channel not found. Try pasting the full YouTube channel URL.');
  }

  const item = json.items[0];
  return {
    channelId:         item.id,
    title:             item.snippet.title,
    customUrl:         item.snippet.customUrl,
    thumbnail:         item.snippet.thumbnails?.default?.url ?? '',
    subscriberCount:   item.statistics?.subscriberCount,
    videoCount:        item.statistics?.videoCount,
    uploadsPlaylistId: item.contentDetails.relatedPlaylists.uploads,
  };
}

// ─── fetchChannelVideos ────────────────────────────────────────────────────

export async function fetchChannelVideos(
  uploadsPlaylistId: string,
  maxResults = 20,
  pageToken?: string
): Promise<{ videos: YTVideo[]; nextPageToken?: string }> {
  if (!API_KEY) {
    throw new Error('YouTube API key is missing. Check your .env file.');
  }

  let listUrl = `${BASE}/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=${maxResults}&key=${API_KEY}`;
  if (pageToken) listUrl += `&pageToken=${pageToken}`;

  const listRes  = await fetch(listUrl);
  if (!listRes.ok) throw new Error(`YouTube API error: ${listRes.status}`);
  const listJson = await listRes.json();

  const items: any[]                      = listJson.items ?? [];
  const nextPageToken: string | undefined = listJson.nextPageToken;
  const ids = items
    .map((i: any) => i.snippet?.resourceId?.videoId)
    .filter(Boolean)
    .join(',');

  if (!ids) return { videos: [], nextPageToken };

  const detailUrl = `${BASE}/videos?part=snippet,contentDetails,statistics&id=${ids}&key=${API_KEY}`;
  const detailRes  = await fetch(detailUrl);
  if (!detailRes.ok) throw new Error(`YouTube API error: ${detailRes.status}`);
  const detailJson = await detailRes.json();

  const videos: YTVideo[] = (detailJson.items ?? []).map((v: any) => ({
    videoId:      v.id,
    title:        v.snippet.title,
    description:  v.snippet.description ?? '',
    thumbnail:
      v.snippet.thumbnails?.high?.url   ??
      v.snippet.thumbnails?.medium?.url ??
      v.snippet.thumbnails?.default?.url ??
      `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
    publishedAt:  v.snippet.publishedAt,
    duration:     v.contentDetails?.duration,
    viewCount:    v.statistics?.viewCount,
    likeCount:    v.statistics?.likeCount,
    channelTitle: v.snippet.channelTitle,
  }));

  return { videos, nextPageToken };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** "PT3M42S" → "3:42" */
export function formatDuration(iso: string): string {
  if (!iso) return '';
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return '';
  const hours   = parseInt(match[1] ?? '0');
  const minutes = parseInt(match[2] ?? '0');
  const seconds = parseInt(match[3] ?? '0');
  const mm = String(minutes).padStart(hours > 0 ? 2 : 1, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** 1234567 → "1.2M" */
export function formatCount(n?: string): string {
  if (!n) return '0';
  const num = parseInt(n, 10);
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
  if (num >= 1_000)     return (num / 1_000).toFixed(1) + 'K';
  return String(num);
}
