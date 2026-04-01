import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  imageUrl?: string | null;
  videoUrl?: string | null;
  height: number;
  borderRadius?: number;
  startColor: string;
  endColor: string;
  emptyHint?: string;
  editable?: boolean;
}

function BannerVideoLayer({ videoUrl }: { videoUrl: string }) {
  const [ready, setReady] = useState(false);
  const [errored, setErrored] = useState(false);
  const player = useVideoPlayer({ uri: videoUrl }, (instance) => {
    instance.loop = true;
    instance.muted = true;
    instance.play();
  });

  useEffect(() => {
    const sub = player.addListener('statusChange', ({ status }: { status: string }) => {
      if (status === 'readyToPlay') {
        setReady(true);
        setErrored(false);
      }
      if (status === 'error') {
        setErrored(true);
        setReady(true);
      }
    });
    return () => sub.remove();
  }, [player]);

  if (errored) return null;

  return (
    <>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFillObject}
        contentFit="cover"
        nativeControls={false}
        allowsFullscreen={false}
        allowsPictureInPicture={false}
      />
      {!ready ? (
        <View style={styles.loader}>
          <ActivityIndicator color="#fff" size="small" />
        </View>
      ) : null}
    </>
  );
}

export default function ProfileBannerMedia({
  imageUrl,
  videoUrl,
  height,
  borderRadius = 0,
  startColor,
  endColor,
  emptyHint,
  editable = false,
}: Props) {
  const gradientColors = useMemo(() => [startColor, endColor], [startColor, endColor]);
  const showEmpty = !imageUrl && !videoUrl;

  return (
    <View style={[styles.wrap, { height, borderRadius }]}> 
      <LinearGradient
        colors={gradientColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      {imageUrl ? (
        <Image source={{ uri: imageUrl }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
      ) : null}

      {videoUrl ? <BannerVideoLayer videoUrl={videoUrl} /> : null}

      <View style={styles.overlay} />

      {showEmpty ? (
        <View style={styles.emptyState}>
          <Ionicons name={editable ? 'camera-outline' : 'sparkles-outline'} size={26} color="rgba(255,255,255,0.88)" />
          {emptyHint ? <Text style={styles.emptyText}>{emptyHint}</Text> : null}
        </View>
      ) : null}

      {videoUrl ? (
        <View style={styles.videoBadge}>
          <Ionicons name="play" size={12} color="#fff" />
          <Text style={styles.videoBadgeText}>Loop</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    backgroundColor: '#111',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(5,8,18,0.18)',
  },
  loader: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyState: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 24,
  },
  emptyText: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  videoBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(0,0,0,0.38)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  videoBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
});
