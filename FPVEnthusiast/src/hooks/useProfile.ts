// src/hooks/useProfile.ts
import { useState, useEffect, useCallback } from 'react';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { supabase } from '../services/supabase';
import type { UserProfile } from '../types/profile';

const ALLOWED_UPDATE_FIELDS: Array<keyof UserProfile> = [
  'username', 'bio', 'avatar_url', 'header_image_url', 'header_video_url',
  'website_url', 'youtube_url', 'instagram_url',
  'twitter_url', 'tiktok_url', 'autoplay_videos',
];

function getExtAndMime(uri: string, explicitMime?: string | null): { ext: string; mime: string } {
  const clean = uri.split('?')[0];
  const raw = (clean.split('.').pop() ?? 'jpg').toLowerCase();
  const ext = raw === 'jpeg' || raw === 'heic' || raw === 'heif' ? 'jpg' : raw;
  if (explicitMime) return { ext, mime: explicitMime };
  if (['mp4', 'm4v', 'mov', 'webm'].includes(ext)) {
    if (ext === 'mov') return { ext, mime: 'video/quicktime' };
    return { ext, mime: `video/${ext === 'm4v' ? 'mp4' : ext}` };
  }
  return { ext, mime: ext === 'jpg' ? 'image/jpeg' : `image/${ext}` };
}

interface PickerUploadConfig {
  pickerOptions: ImagePicker.ImagePickerOptions;
  bucket: string;
  profileField: 'avatar_url' | 'header_image_url' | 'header_video_url';
  extraFields?: Partial<UserProfile>;
}

export interface UseProfileReturn {
  profile: UserProfile | null;
  loading: boolean;
  updating: boolean;
  error: string | null;
  fetchProfile: () => Promise<void>;
  updateProfile: (fields: Partial<UserProfile>) => Promise<{ data?: UserProfile; error?: string }>;
  validateUsername: (username: string) => Promise<{ valid: boolean; message?: string }>;
  uploadAvatar: () => Promise<{ data?: UserProfile; error?: string; canceled?: boolean }>;
  uploadHeaderImage: () => Promise<{ data?: UserProfile; error?: string; canceled?: boolean }>;
  uploadHeaderVideo: () => Promise<{ data?: UserProfile; error?: string; canceled?: boolean }>;
  updateSocialLinks: (links: Partial<UserProfile>) => Promise<{ data?: UserProfile; error?: string }>;
}

export function useProfile(userId?: string): UseProfileReturn {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchErr } = await supabase
        .from('users').select('*').eq('id', userId).single();
      if (fetchErr) throw fetchErr;
      setProfile(data as UserProfile);
    } catch (err: any) {
      console.error('[useProfile] fetchProfile:', err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

  const updateProfile = useCallback(
    async (fields: Partial<UserProfile>): Promise<{ data?: UserProfile; error?: string }> => {
      if (!userId) return { error: 'No user ID' };
      const sanitized = Object.fromEntries(
        Object.entries(fields).filter(([k]) => ALLOWED_UPDATE_FIELDS.includes(k as keyof UserProfile)),
      );
      if (!Object.keys(sanitized).length) return { error: 'No valid fields to update' };
      setUpdating(true);
      setError(null);
      try {
        const { data, error: updateErr } = await supabase
          .from('users').update(sanitized).eq('id', userId).select().single();
        if (updateErr) throw updateErr;
        const updated = data as UserProfile;
        setProfile(updated);
        return { data: updated };
      } catch (err: any) {
        console.error('[useProfile] updateProfile:', err.message);
        setError(err.message);
        return { error: err.message };
      } finally {
        setUpdating(false);
      }
    },
    [userId],
  );

  const validateUsername = useCallback(
    async (username: string): Promise<{ valid: boolean; message?: string }> => {
      if (!username || username.trim().length < 3) {
        return { valid: false, message: 'Username must be at least 3 characters.' };
      }
      if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        return { valid: false, message: 'Letters, numbers, and underscores only.' };
      }
      const { data, error: checkErr } = await supabase
        .from('users').select('id').eq('username', username.trim())
        .neq('id', userId ?? '').maybeSingle();
      if (checkErr) return { valid: false, message: checkErr.message };
      if (data) return { valid: false, message: 'Username is already taken.' };
      return { valid: true };
    },
    [userId],
  );

  const pickAndUpload = useCallback(async ({
    pickerOptions,
    bucket,
    profileField,
    extraFields,
  }: PickerUploadConfig): Promise<{ data?: UserProfile; error?: string; canceled?: boolean }> => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return { error: 'Media library permission denied.' };

    const result = await ImagePicker.launchImageLibraryAsync(pickerOptions);
    if (result.canceled) return { canceled: true };

    const asset = result.assets?.[0];
    if (!asset?.uri) return { error: 'No file selected.' };

    const { ext, mime } = getExtAndMime(asset.uri, (asset as any).mimeType ?? null);
    const path = `${userId}-${Date.now()}.${ext}`;

    setUpdating(true);
    try {
      const base64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: 'base64' as any,
      });
      const arrayBuffer = decode(base64);

      const { error: upErr } = await supabase.storage
        .from(bucket)
        .upload(path, arrayBuffer, { contentType: mime, upsert: true });

      if (upErr) throw upErr;

      const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path);
      const nextFields = {
        [profileField]: urlData.publicUrl,
        ...(extraFields ?? {}),
      } as Partial<UserProfile>;

      return await updateProfile(nextFields);
    } catch (err: any) {
      console.error(`[useProfile] pickAndUpload (${bucket}):`, err.message);
      setUpdating(false);
      return { error: err.message };
    }
  }, [userId, updateProfile]);

  const uploadAvatar = useCallback(
    () => pickAndUpload({
      pickerOptions: { mediaTypes: ['images'] as any, allowsEditing: true, aspect: [1, 1], quality: 0.8 },
      bucket: 'avatars',
      profileField: 'avatar_url',
    }),
    [pickAndUpload],
  );

  const uploadHeaderImage = useCallback(
    () => pickAndUpload({
      pickerOptions: { mediaTypes: ['images'] as any, allowsEditing: true, aspect: [16, 9], quality: 0.85 },
      bucket: 'headers',
      profileField: 'header_image_url',
      extraFields: { header_video_url: null },
    }),
    [pickAndUpload],
  );

  const uploadHeaderVideo = useCallback(
    () => pickAndUpload({
      pickerOptions: { mediaTypes: ['videos'] as any, allowsEditing: false, quality: 0.75 as any, videoMaxDuration: 6 },
      bucket: 'headers',
      profileField: 'header_video_url',
    }),
    [pickAndUpload],
  );

  const updateSocialLinks = useCallback(
    (links: Partial<UserProfile>) => {
      const allowed: Array<keyof UserProfile> = [
        'website_url', 'youtube_url', 'instagram_url', 'twitter_url', 'tiktok_url',
      ];
      const filtered = Object.fromEntries(
        Object.entries(links).filter(([k]) => allowed.includes(k as keyof UserProfile)),
      ) as Partial<UserProfile>;
      return updateProfile(filtered);
    },
    [updateProfile],
  );

  return {
    profile,
    loading,
    updating,
    error,
    fetchProfile,
    updateProfile,
    validateUsername,
    uploadAvatar,
    uploadHeaderImage,
    uploadHeaderVideo,
    updateSocialLinks,
  };
}
