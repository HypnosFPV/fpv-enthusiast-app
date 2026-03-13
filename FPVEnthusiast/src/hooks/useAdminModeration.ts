// src/hooks/useAdminModeration.ts
// Admin hook for reviewing OSD-flagged challenge entries.
// Deliberately omits pilot_id from results to preserve anonymity even for admins.

import { useState, useCallback } from 'react';
import { supabase } from '../services/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ModerationStatus = 'pending' | 'processing' | 'approved' | 'needs_review' | 'rejected';

export interface ModerationFlag {
  type:        'pilot_name' | 'no_thumbnail' | 'error' | 'admin_rejection' | 'admin_override' | 'no_frames' | 'fetch_error';
  text?:       string;       // detected callsign text
  confidence?: number;
  frame?:      number;
  reason?:     string;
  rejected_at?: string;
}

export interface FlaggedEntry {
  id:                      string;
  challenge_id:            string;
  challenge_title:         string;
  entry_number:            number;
  moderation_status:       ModerationStatus;
  moderation_flags:        ModerationFlag[];
  moderation_processed_at: string | null;
  s3_upload_key:           string | null;
  thumbnail_s3_key:        string | null;
  duration_seconds:        number | null;
  submitted_at:            string | null;
  created_at:              string;
  // Derived
  video_url:               string | null;
  thumbnail_url:           string | null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAdminModeration() {
  const [entries,  setEntries]  = useState<FlaggedEntry[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [isAdmin,  setIsAdmin]  = useState<boolean | null>(null); // null = not yet checked
  const [actionId,    setActionId]    = useState<string | null>(null);  // entry being actioned
  const [allEntries,  setAllEntries]  = useState<FlaggedEntry[]>([]);
  const [allLoading,  setAllLoading]  = useState(false);

  // ── Check if current user is an admin ──────────────────────────────────────
  const checkAdmin = useCallback(async (): Promise<boolean> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setIsAdmin(false); return false; }
    const { data } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single();
    const admin = data?.is_admin === true;
    setIsAdmin(admin);
    return admin;
  }, []);

  // ── Load all flagged entries ───────────────────────────────────────────────
  const loadFlaggedEntries = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_get_flagged_entries');
      if (error) {
        console.error('[useAdminModeration] loadFlaggedEntries:', error.message);
        setEntries([]);
        return;
      }

      const enriched: FlaggedEntry[] = (data ?? []).map((row: any) => ({
        ...row,
        moderation_flags: row.moderation_flags ?? [],
        video_url: row.s3_upload_key
          ? supabase.storage.from('posts').getPublicUrl(row.s3_upload_key).data.publicUrl
          : null,
        thumbnail_url: row.thumbnail_s3_key
          ? supabase.storage.from('posts').getPublicUrl(row.thumbnail_s3_key).data.publicUrl
          : null,
      }));

      setEntries(enriched);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Approve an entry ───────────────────────────────────────────────────────
  const approveEntry = useCallback(async (entryId: string): Promise<boolean> => {
    setActionId(entryId);
    try {
      const { error } = await supabase.rpc('admin_approve_entry', { p_entry_id: entryId });
      if (error) { console.error('[useAdminModeration] approve:', error.message); return false; }
      setEntries(prev => prev.filter(e => e.id !== entryId));
      return true;
    } finally {
      setActionId(null);
    }
  }, []);

  // ── Reject an entry ────────────────────────────────────────────────────────
  const rejectEntry = useCallback(async (entryId: string, reason: string): Promise<boolean> => {
    setActionId(entryId);
    try {
      const { error } = await supabase.rpc('admin_reject_entry', {
        p_entry_id: entryId,
        p_reason:   reason,
      });
      if (error) { console.error('[useAdminModeration] reject:', error.message); return false; }
      setEntries(prev => prev.filter(e => e.id !== entryId));
      return true;
    } finally {
      setActionId(null);
    }
  }, []);

  // ── Override an auto-approved entry back into the review queue ────────────
  // Used when a spot-check reveals a missed pilot name in an approved entry.
  const overrideToReview = useCallback(async (entryId: string, reason = 'admin_spot_check'): Promise<boolean> => {
    setActionId(entryId);
    try {
      const { error } = await supabase.rpc('admin_override_to_review', {
        p_entry_id: entryId,
        p_reason:   reason,
      });
      if (error) { console.error('[useAdminModeration] override:', error.message); return false; }
      // Move from allEntries into the flagged queue immediately
      const moved = allEntries.find(e => e.id === entryId);
      if (moved) {
        setAllEntries(prev => prev.filter(e => e.id !== entryId));
        setEntries(prev => [{ ...moved, moderation_status: 'needs_review' }, ...prev]);
      }
      return true;
    } finally {
      setActionId(null);
    }
  }, [allEntries]);

  // ── Load ALL entries (approved + pending) for spot-checking ───────────────
  const loadAllEntries = useCallback(async (challengeId?: string): Promise<void> => {
    setAllLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_get_all_entries', {
        p_challenge_id: challengeId ?? null,
      });
      if (error) {
        console.error('[useAdminModeration] loadAllEntries:', error.message);
        setAllEntries([]);
        return;
      }
      const enriched: FlaggedEntry[] = (data ?? []).map((row: any) => ({
        ...row,
        moderation_flags: row.moderation_flags ?? [],
        video_url: row.s3_upload_key
          ? supabase.storage.from('posts').getPublicUrl(row.s3_upload_key).data.publicUrl
          : null,
        thumbnail_url: row.thumbnail_s3_key
          ? supabase.storage.from('posts').getPublicUrl(row.thumbnail_s3_key).data.publicUrl
          : null,
      }));
      setAllEntries(enriched);
    } finally {
      setAllLoading(false);
    }
  }, []);

  return {
    entries,
    loading,
    isAdmin,
    actionId,
    checkAdmin,
    loadFlaggedEntries,
    approveEntry,
    rejectEntry,
    overrideToReview,
    loadAllEntries,
    allEntries,
    allLoading,
  };
}
