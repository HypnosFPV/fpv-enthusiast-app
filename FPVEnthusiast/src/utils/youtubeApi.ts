export async function likeYouTubeVideo(
  videoId: string,
  accessToken: string,
  rating: 'like' | 'none' = 'like'
): Promise<void> {
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/videos/rate?id=${videoId}&rating=${rating}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message || `YouTube rate error ${res.status}`);
  }
}

export async function subscribeToChannel(
  channelId: string,
  accessToken: string
): Promise<void> {
  const res = await fetch(
    'https://www.googleapis.com/youtube/v3/subscriptions?part=snippet',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        snippet: {
          resourceId: { kind: 'youtube#channel', channelId },
        },
      }),
    }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message || `YouTube subscribe error ${res.status}`);
  }
}

export async function getChannelIdForVideo(
  videoId: string,
  apiKey: string
): Promise<string> {
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${apiKey}`
  );
  const data = await res.json();
  const channelId = data?.items?.[0]?.snippet?.channelId;
  if (!channelId) throw new Error('Channel ID not found for video');
  return channelId;
}
