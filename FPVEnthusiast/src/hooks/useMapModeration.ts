// src/hooks/useMapModeration.ts
// Admin hook for reviewing and actioning reported fly spots and race events.
// All queries use SECURITY DEFINER RPCs so the client never touches other
// users' rows directly — the server validates is_admin on every call.

import { useState, useCallback } from 'react';
import { supabase } from '../services/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReportStatus = 'open' | 'dismissed' | 'actioned';

export interface SpotReport {
  report_id:    string;
  spot_id:      string;
  spot_name:    string;
  spot_type:    string;
  latitude:     number;
  longitude:    number;
  is_flagged:   boolean;
  is_verified:  boolean;
  report_count: number;
  reason:       string;
  details:      string | null;
  reported_at:  string;
  reporter_username: string | null;
  created_by_username: string | null;
}

export interface EventReport {
  report_id:    string;
  event_id:     string;
  event_name:   string;
  event_type:   string;
  event_source: string;
  start_time:   string;
  city:         string | null;
  state:        string | null;
  reason:       string;
  details:      string | null;
  reported_at:  string;
  reporter_username: string | null;
  organizer_username: string | null;
}

export type ModerationTab = 'spots' | 'events';

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useMapModeration() {
  const [isAdmin,        setIsAdmin]        = useState<boolean | null>(null);
  const [spotReports,    setSpotReports]    = useState<SpotReport[]>([]);
  const [eventReports,   setEventReports]   = useState<EventReport[]>([]);
  const [loading,        setLoading]        = useState(false);
  const [actionId,       setActionId]       = useState<string | null>(null);

  // ── Check admin status ────────────────────────────────────────────────────
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

  // ── Load open spot reports ─────────────────────────────────────────────────
  const loadSpotReports = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_get_spot_reports');
      if (error) { console.error('[useMapModeration] spotReports:', error.message); return; }
      setSpotReports(data ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Load open event reports ────────────────────────────────────────────────
  const loadEventReports = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_get_event_reports');
      if (error) { console.error('[useMapModeration] eventReports:', error.message); return; }
      setEventReports(data ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Dismiss a spot report (keep pin, close report) ────────────────────────
  const dismissSpotReport = useCallback(async (reportId: string): Promise<boolean> => {
    setActionId(reportId);
    try {
      const { error } = await supabase.rpc('admin_dismiss_spot_report', { p_report_id: reportId });
      if (error) { console.error('[useMapModeration] dismissSpot:', error.message); return false; }
      setSpotReports(prev => prev.filter(r => r.report_id !== reportId));
      return true;
    } finally { setActionId(null); }
  }, []);

  // ── Delete a reported spot (removes pin entirely) ─────────────────────────
  const deleteSpot = useCallback(async (spotId: string, reportId: string): Promise<boolean> => {
    setActionId(reportId);
    try {
      const { error } = await supabase.rpc('admin_delete_spot', { p_spot_id: spotId });
      if (error) { console.error('[useMapModeration] deleteSpot:', error.message); return false; }
      setSpotReports(prev => prev.filter(r => r.spot_id !== spotId));
      return true;
    } finally { setActionId(null); }
  }, []);

  // ── Verify a spot (clears flag, sets is_verified) ────────────────────────
  const verifySpot = useCallback(async (spotId: string, reportId: string): Promise<boolean> => {
    setActionId(reportId);
    try {
      const { error } = await supabase.rpc('admin_verify_spot', { p_spot_id: spotId });
      if (error) { console.error('[useMapModeration] verifySpot:', error.message); return false; }
      setSpotReports(prev => prev.filter(r => r.report_id !== reportId));
      return true;
    } finally { setActionId(null); }
  }, []);

  // ── Dismiss an event report (keep event, close report) ───────────────────
  const dismissEventReport = useCallback(async (reportId: string): Promise<boolean> => {
    setActionId(reportId);
    try {
      const { error } = await supabase.rpc('admin_dismiss_event_report', { p_report_id: reportId });
      if (error) { console.error('[useMapModeration] dismissEvent:', error.message); return false; }
      setEventReports(prev => prev.filter(r => r.report_id !== reportId));
      return true;
    } finally { setActionId(null); }
  }, []);

  // ── Delete a reported event ───────────────────────────────────────────────
  const deleteEvent = useCallback(async (eventId: string, reportId: string): Promise<boolean> => {
    setActionId(reportId);
    try {
      const { error } = await supabase.rpc('admin_delete_event', { p_event_id: eventId });
      if (error) { console.error('[useMapModeration] deleteEvent:', error.message); return false; }
      setEventReports(prev => prev.filter(r => r.event_id !== eventId));
      return true;
    } finally { setActionId(null); }
  }, []);

  return {
    isAdmin,
    spotReports,
    eventReports,
    loading,
    actionId,
    checkAdmin,
    loadSpotReports,
    loadEventReports,
    dismissSpotReport,
    deleteSpot,
    verifySpot,
    dismissEventReport,
    deleteEvent,
  };
}
