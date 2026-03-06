// src/hooks/useMultiGP.ts
import { useState, useCallback, useEffect } from 'react';
import { supabase } from '../services/supabase';

export interface MultiGPConnection {
  id: string;
  user_id: string;
  api_key: string;
  chapter_name: string | null;
  chapter_id: string | null;
  last_synced_at: string | null;
  is_active: boolean;
  created_at: string;
}

export function useMultiGP(userId?: string) {
  const [connection,  setConnection]  = useState<MultiGPConnection | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [validating,  setValidating]  = useState(false);
  const [syncing,     setSyncing]     = useState(false);

  const fetchConnection = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const { data } = await supabase
        .from('multigp_connections')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      setConnection(data ?? null);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { fetchConnection(); }, [fetchConnection]);

  const validateKey = useCallback(async (
    apiKey: string,
  ): Promise<{ valid: boolean; chapterName: string | null; chapterId: string | null; error?: string }> => {
    setValidating(true);
    try {
      const res = await fetch('https://www.multigp.com/api/multigp/pull/chapter/listing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      });
      const json = await res.json();
      if (!json.status) {
        return { valid: false, chapterName: null, chapterId: null, error: 'Invalid API key — check and try again.' };
      }
      const chapter = Array.isArray(json.data) ? json.data[0] : json.data;
      return {
        valid: true,
        chapterName: chapter?.name ?? chapter?.chapterName ?? null,
        chapterId:   chapter?.id   ?? null,
      };
    } catch {
      return { valid: false, chapterName: null, chapterId: null, error: 'Could not reach MultiGP. Check your connection.' };
    } finally {
      setValidating(false);
    }
  }, []);

  const saveConnection = useCallback(async (
    apiKey: string,
    chapterName: string | null,
    chapterId: string | null,
  ): Promise<{ error?: string }> => {
    if (!userId) return { error: 'Not logged in' };
    setSaving(true);
    try {
      const { error } = await supabase
        .from('multigp_connections')
        .upsert(
          { user_id: userId, api_key: apiKey, chapter_name: chapterName, chapter_id: chapterId, is_active: true },
          { onConflict: 'user_id' },
        );
      if (error) return { error: error.message };
      await fetchConnection();
      return {};
    } finally {
      setSaving(false);
    }
  }, [userId, fetchConnection]);

  const toggleActive = useCallback(async () => {
    if (!connection || !userId) return;
    const next = !connection.is_active;
    const { error } = await supabase
      .from('multigp_connections')
      .update({ is_active: next })
      .eq('user_id', userId);
    if (!error) setConnection(prev => prev ? { ...prev, is_active: next } : null);
  }, [connection, userId]);

  const disconnect = useCallback(async (): Promise<{ error?: string }> => {
    if (!userId) return { error: 'Not logged in' };
    const { error } = await supabase
      .from('multigp_connections')
      .delete()
      .eq('user_id', userId);
    if (error) return { error: error.message };
    setConnection(null);
    return {};
  }, [userId]);

  const triggerSync = useCallback(async (): Promise<{ synced: number; error?: string }> => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('sync-multigp', { body: {} });
      if (error) return { synced: 0, error: error.message };
      await fetchConnection();
      return { synced: data?.synced ?? 0 };
    } finally {
      setSyncing(false);
    }
  }, [fetchConnection]);

  return {
    connection, loading, saving, validating, syncing,
    fetchConnection, validateKey, saveConnection,
    toggleActive, disconnect, triggerSync,
  };
}
