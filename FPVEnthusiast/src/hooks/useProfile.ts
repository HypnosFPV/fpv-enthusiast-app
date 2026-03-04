// src/hooks/useProfile.ts
import { useState, useEffect, useCallback } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../services/supabase';
import type { UserProfile } from '../types/profile';

// ─── Allowed columns for update ───────────────────────────────────────────────
const ALLOWED_UPDATE_FIELDS: Array<keyof UserProfile> = [
  'username',
  'bio',
  'avatar_url',
  'header_image_url',
  'website_url',
  'youtube_url',
  'instagram_url',
  'twitter_url',
  'tiktok_url',
  'autoplay_videos',
];

// ─── Hook return type ─────────────────────────────────────────────────────────
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
  updateSocialLinks: (links: Partial<UserProfile>) => Promise<{ data?: UserProfile; error?: string }>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useProfile(userId?: string): UseProfileReturn {
  const [profile,  setProfile]  = useState<UserProfile | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchProfile = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchErr } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

      if (fetchErr) throw fetchErr;
      setProfile(data as UserProfile);
    } catch (err: any) {
      console.error('[useProfile] fetchProfile:', err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  // ── Update ─────────────────────────────────────────────────────────────────
  const updateProfile = useCallback(
    async (fields: Partial<UserProfile>): Promise<{ data?: UserProfile; error?: string }> => {
      if (!userId) return { error: 'No user ID' };

      const sanitized = Object.fromEntries(
        Object.entries(fields).filter(([k]) =>
          ALLOWED_UPDATE_FIELDS.includes(k as keyof UserProfile)
        )
      );
      if (!Object.keys(sanitized).length) return { error: 'No valid fields to update' };

      setUpdating(true);
      setError(null);
      try {
        const { data, error: updateErr } = await supabase
          .from('users')
          .update(sanitized)
          .eq('id', userId)
          .select()
          .single();

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
    [userId]
  );

  // ── Username validation ────────────────────────────────────────────────────
  const validateUsername = useCallback(
    async (username: string): Promise<{ valid: boolean; message?: string }> => {
      if (!username || username.trim().length < 3)
        return { valid: false, message: 'Username must be at least 3 characters.' };
      if (!/^[a-zA-Z0-9_]+$/.test(username))
        return { valid: false, message: 'Letters, numbers, and underscores only.' };

      const { data, error: checkErr } = await supabase
        .from('users')
        .select('id')
        .eq('username', username.trim())
        .neq('id', userId ?? '')
        .maybeSingle();

      if (checkErr) return { valid: false, message: checkErr.message };
      if (data)     return { valid: false, message: 'Username is already taken.' };
      return { valid: true };
    },
    [userId]
  );

  // ── Avatar upload ──────────────────────────────────────────────────────────
  const uploadAvatar = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return { error: 'Media library permission denied.' };

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled) return { canceled: true };

    const uri  = result.assets[0].uri;
    const ext  = uri.split('.').pop() ?? 'jpg';
    const path = `avatars/${userId}-${Date.now()}.${ext}`;

    try {
      const blob = await (await fetch(uri)).blob();
      const { error: upErr } = await supabase.storage
        .from('media')
        .upload(path, blob, { contentType: `image/${ext}`, upsert: true });
      if (upErr) throw upErr;

      const { data: urlData } = supabase.storage.from('media').getPublicUrl(path);
      return await updateProfile({ avatar_url: urlData.publicUrl });
    } catch (err: any) {
      return { error: err.message };
    }
  }, [userId, updateProfile]);

  // ── Header image upload ────────────────────────────────────────────────────
  const uploadHeaderImage = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return { error: 'Media library permission denied.' };

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.85,
    });
    if (result.canceled) return { canceled: true };

    const uri  = result.assets[0].uri;
    const ext  = uri.split('.').pop() ?? 'jpg';
    const path = `headers/${userId}-${Date.now()}.${ext}`;

    try {
      const blob = await (await fetch(uri)).blob();
      const { error: upErr } = await supabase.storage
        .from('media')
        .upload(path, blob, { contentType: `image/${ext}`, upsert: true });
      if (upErr) throw upErr;

      const { data: urlData } = supabase.storage.from('media').getPublicUrl(path);
      return await updateProfile({ header_image_url: urlData.publicUrl });
    } catch (err: any) {
      return { error: err.message };
    }
  }, [userId, updateProfile]);

  // ── Social links ───────────────────────────────────────────────────────────
  const updateSocialLinks = useCallback(
    (links: Partial<UserProfile>) => {
      const allowed: Array<keyof UserProfile> = [
        'website_url','youtube_url','instagram_url','twitter_url','tiktok_url',
      ];
      const filtered = Object.fromEntries(
        Object.entries(links).filter(([k]) => allowed.includes(k as keyof UserProfile))
      ) as Partial<UserProfile>;
      return updateProfile(filtered);
    },
    [updateProfile]
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
    updateSocialLinks,
  };
}
