// src/hooks/useMap.ts
import { useState, useCallback } from 'react';
import { supabase } from '../services/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FlySpot {
  id: string;
  created_by: string | null;
  name: string;
  description: string | null;
  spot_type: 'freestyle' | 'bando' | 'race_track' | 'open_field' | 'indoor';
  hazard_level: 'low' | 'medium' | 'high';
  latitude: number;
  longitude: number;
  thumbs_up: number;
  thumbs_down: number;
  created_at: string;
  creator_username?: string;
  // Fraud-prevention fields
  is_verified:  boolean;
  is_flagged:   boolean;
  report_count: number;
  verified_at:  string | null;
}

export interface RaceEvent {
  id: string;
  organizer_id: string | null;
  name: string;
  description: string | null;
  event_type: 'race' | 'meetup' | 'training' | 'tiny_whoop' | 'championship' | 'fun_fly';
  event_source: 'community' | 'multigp' | 'admin';
  latitude: number;
  longitude: number;
  venue_name: string | null;
  city: string | null;
  state: string | null;
  country: string;
  start_time: string;
  end_time: string | null;
  rsvp_count: number;
  max_participants: number | null;
  registration_url: string | null;
  multigp_race_id: string | null;
  multigp_chapter_name: string | null;
  is_cancelled: boolean;
  created_at: string;
  organizer_username?: string;
  user_rsvpd?: boolean;
  fly_spot_id?: string | null;  // linked FPV spot pin
}

export interface SpotComment {
  id: string;
  spot_id: string;
  user_id: string | null;
  username: string | null;
  content: string;
  is_anonymous: boolean;
  created_at: string;
}

export interface NewSpotData {
  name: string;
  description: string;
  spot_type: FlySpot['spot_type'];
  hazard_level: FlySpot['hazard_level'];
  latitude: number;
  longitude: number;
}

export interface NewEventData {
  name: string;
  description: string;
  event_type: RaceEvent['event_type'];
  latitude: number;
  longitude: number;
  venue_name: string;
  city: string;
  state: string;
  start_time: string;
  end_time: string;
  max_participants: string;
  registration_url: string;
  fly_spot_id?: string;  // optional: link to an existing FPV spot pin
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 3959;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function boundingBox(lat: number, lng: number, miles: number) {
  const latDelta = miles / 69;
  const lngDelta = miles / (69 * Math.cos((lat * Math.PI) / 180));
  return {
    minLat: lat - latDelta, maxLat: lat + latDelta,
    minLng: lng - lngDelta, maxLng: lng + lngDelta,
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useMap(userId?: string) {
  const [spots,        setSpots]        = useState<FlySpot[]>([]);
  const [events,       setEvents]       = useState<RaceEvent[]>([]);
  const [comments,     setComments]     = useState<SpotComment[]>([]);
  const [loading,      setLoading]      = useState(false);
  const [mgpSyncing,   setMgpSyncing]   = useState(false);
  const [mgpSyncCount, setMgpSyncCount] = useState(0);

  // ── Fetch fly spots ────────────────────────────────────────────────────────
  const fetchSpots = useCallback(async (
    lat: number, lng: number,
    radiusMiles: number,
    typeFilters: string[],
  ) => {
    setLoading(true);
    try {
      const { minLat, maxLat, minLng, maxLng } = boundingBox(lat, lng, radiusMiles);
      const { data, error } = await supabase
        .from('fly_spots')
        .select('*, creator:created_by(username)')
        .gte('latitude',  minLat).lte('latitude',  maxLat)
        .gte('longitude', minLng).lte('longitude', maxLng)
        .in('spot_type', typeFilters.length
          ? typeFilters
          : ['freestyle','bando','race_track','open_field','indoor']);
      if (error) throw error;
      const filtered = (data ?? [])
        .map((s: any) => ({ ...s, creator_username: s.creator?.username ?? null }))
        .filter((s: FlySpot) =>
          haversineDistance(lat, lng, s.latitude, s.longitude) <= radiusMiles
        );
      setSpots(filtered);
    } catch (e) {
      console.error('fetchSpots:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Fetch race events ──────────────────────────────────────────────────────
  const fetchEvents = useCallback(async (
    lat: number, lng: number,
    radiusMiles: number,
    typeFilters: string[],
  ) => {
    try {
      const { minLat, maxLat, minLng, maxLng } = boundingBox(lat, lng, radiusMiles);
      const { data, error } = await supabase
        .from('race_events')
        .select('*, organizer:organizer_id(username)')
        .gte('latitude',  minLat).lte('latitude',  maxLat)
        .gte('longitude', minLng).lte('longitude', maxLng)
        .in('event_type', typeFilters.length
          ? typeFilters
          : ['race','meetup','training','tiny_whoop','championship','fun_fly'])
        .eq('is_cancelled', false)
        .gte('start_time', new Date().toISOString())
        .order('start_time', { ascending: true });
      if (error) throw error;

      let rsvpdIds: string[] = [];
      if (userId) {
        const { data: rsvps } = await supabase
          .from('event_rsvps')
          .select('event_id')
          .eq('user_id', userId);
        rsvpdIds = (rsvps ?? []).map((r: any) => r.event_id);
      }

      const filtered = (data ?? [])
        .map((e: any) => ({
          ...e,
          organizer_username: e.organizer?.username ?? null,
          user_rsvpd: rsvpdIds.includes(e.id),
        }))
        .filter((e: RaceEvent) =>
          haversineDistance(lat, lng, e.latitude, e.longitude) <= radiusMiles
        );
      setEvents(filtered);
    } catch (e) {
      console.error('fetchEvents:', e);
    }
  }, [userId]);

  // ── Sync MultiGP events via Supabase Edge Function ─────────────────────────
  const syncMultiGPEvents = useCallback(async (
    lat: number,
    lng: number,
    distanceMiles: number,
  ) => {
    setMgpSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('sync-multigp', {
        body: { lat, lng, distance: distanceMiles },
      });
      if (!error && data?.synced) {
        setMgpSyncCount(data.synced);
        console.log(`[MultiGP] Synced ${data.synced} race events`);
      }
    } catch (e) {
      console.log('[MultiGP] Sync skipped (edge function not deployed or no API key)');
    } finally {
      setMgpSyncing(false);
    }
  }, []);


  // ── Chapter owner: push all scheduled races for a specific MultiGP chapter ─
  // Chapter owners enter their chapter slug (e.g. "atl-fpv") and this pulls
  // ALL upcoming races via the sync-multigp-chapter Supabase Edge Function,
  // upserts them into race_events, and returns the count pushed.
  const syncChapterRaces = useCallback(async (chapterId: string): Promise<number> => {
    const cleanId = chapterId.trim().toLowerCase();
    if (!cleanId) throw new Error('Chapter ID is required');
    const { data, error } = await supabase.functions.invoke('sync-multigp-chapter', {
      body: { chapter_id: cleanId },
    });
    if (error) {
      throw new Error(error.message ?? 'Chapter sync failed – ensure the sync-multigp-chapter edge function is deployed');
    }
    const count: number = data?.synced ?? 0;
    if (count > 0) {
      setMgpSyncCount(count);
      console.log(`[MultiGP Chapter] Pushed ${count} race(s) for chapter "${cleanId}"`);
    }
    return count;
  }, []);

  // ── Fetch new nearby events (for push notifications) ──────────────────────
  // Returns events created after `since` that are within radiusMiles of lat/lng
  const fetchNewNearbyEvents = useCallback(async (
    lat: number,
    lng: number,
    radiusMiles: number,
    since: string,
  ): Promise<RaceEvent[]> => {
    try {
      const { minLat, maxLat, minLng, maxLng } = boundingBox(lat, lng, radiusMiles);
      const { data, error } = await supabase
        .from('race_events')
        .select('*')
        .gte('latitude',  minLat).lte('latitude',  maxLat)
        .gte('longitude', minLng).lte('longitude', maxLng)
        .gte('created_at', since)
        .eq('is_cancelled', false)
        .gte('start_time', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) return [];
      return (data ?? []).filter((e: RaceEvent) =>
        haversineDistance(lat, lng, e.latitude, e.longitude) <= radiusMiles
      );
    } catch {
      return [];
    }
  }, []);

  // ── Fetch comments ─────────────────────────────────────────────────────────
  const fetchComments = useCallback(async (spotId: string) => {
    const { data, error } = await supabase
      .from('spot_comments')
      .select('*')
      .eq('spot_id', spotId)
      .order('created_at', { ascending: true });
    if (!error) setComments(data ?? []);
  }, []);

  // ── Add spot ───────────────────────────────────────────────────────────────
  const addSpot = useCallback(async (
    spot: NewSpotData,
    creatorUsername: string,
  ): Promise<{ data: FlySpot | null; error: any }> => {
    if (!userId) return { data: null, error: 'Not logged in' };
    const { data, error } = await supabase
      .from('fly_spots')
      .insert({ ...spot, created_by: userId })
      .select()
      .single();
    if (!error && data) {
      setSpots(prev => [...prev, { ...data, creator_username: creatorUsername }]);
    }
    return { data: data ?? null, error };
  }, [userId]);

  // ── Delete spot ────────────────────────────────────────────────────────────
  const deleteSpot = useCallback(async (spotId: string): Promise<any> => {
    if (!userId) return 'Not logged in';
    const { error } = await supabase
      .from('fly_spots')
      .delete()
      .eq('id', spotId)
      .eq('created_by', userId);   // RLS double-check: only own spots
    if (!error) {
      setSpots(prev => prev.filter(s => s.id !== spotId));
    }
    return error ?? null;
  }, [userId]);

  // ── Vote on spot (rate-limited RPC — max 20 votes/hour) ──────────────────────
  const voteSpot = useCallback(async (
    spotId: string,
    vote: 1 | -1,
    currentVote: 1 | -1 | null,
  ): Promise<{ ok: boolean; error?: string }> => {
    if (!userId) return { ok: false, error: 'not_logged_in' };
    // Toggle off = send vote 0, which the RPC treats as delete
    const effectiveVote = vote === currentVote ? 0 : vote;
    const { data, error } = await supabase.rpc('vote_spot_ratelimited', {
      p_spot_id: spotId,
      p_vote:    effectiveVote,
      p_user_id: userId,
    });
    if (error) return { ok: false, error: error.message };
    if (data?.error === 'rate_limit') return { ok: false, error: 'rate_limit' };
    return { ok: true };
  }, [userId]);

  // ── Report a spot ──────────────────────────────────────────────────────────
  const reportSpot = useCallback(async (
    spotId: string,
    reason: 'wrong_type' | 'wrong_hazard' | 'does_not_exist' | 'dangerous' | 'duplicate' | 'offensive_name' | 'other',
    detail?: string,
  ): Promise<{ ok: boolean; error?: string }> => {
    if (!userId) return { ok: false, error: 'not_logged_in' };
    const { error } = await supabase.from('spot_reports').insert({
      spot_id:     spotId,
      reporter_id: userId,
      reason,
      detail:      detail ?? null,
    });
    if (error) {
      // Unique constraint = already reported
      if (error.message?.includes('unique') || error.code === '23505') {
        return { ok: false, error: 'already_reported' };
      }
      return { ok: false, error: error.message };
    }
    // Optimistically mark as flagged if ≥3 reports likely
    setSpots(prev => prev.map(s =>
      s.id === spotId
        ? { ...s, report_count: (s.report_count ?? 0) + 1 }
        : s
    ));
    return { ok: true };
  }, [userId]);

  // ── Add comment ────────────────────────────────────────────────────────────
  const addComment = useCallback(async (
    spotId: string,
    content: string,
    isAnonymous: boolean,
  ) => {
    if (!userId) return;
    await supabase.from('spot_comments').insert({
      spot_id:      spotId,
      user_id:      userId,
      content,
      is_anonymous: isAnonymous,
    });
    await fetchComments(spotId);
  }, [userId, fetchComments]);

  // ── Add event ──────────────────────────────────────────────────────────────
  const addEvent = useCallback(async (
    evt: NewEventData,
  ): Promise<{ data: RaceEvent | null; error: any }> => {
    if (!userId) return { data: null, error: 'Not logged in' };
    const { data, error } = await supabase
      .from('race_events')
      .insert({
        organizer_id:     userId,
        name:             evt.name,
        description:      evt.description,
        event_type:       evt.event_type,
        event_source:     'community',
        latitude:         evt.latitude,
        longitude:        evt.longitude,
        venue_name:       evt.venue_name,
        city:             evt.city,
        state:            evt.state,
        start_time:       evt.start_time,
        end_time:         evt.end_time || null,
        max_participants: evt.max_participants ? parseInt(evt.max_participants) : null,
        registration_url: evt.registration_url || null,
        fly_spot_id: evt.fly_spot_id ?? null,
      })
      .select()
      .single();
    if (!error && data) {
      setEvents(prev => [{ ...data, user_rsvpd: false }, ...prev]);
    }
    return { data: data ?? null, error };
  }, [userId]);

  // ── Delete event ───────────────────────────────────────────────────────────
  const deleteEvent = useCallback(async (eventId: string): Promise<any> => {
    if (!userId) return 'Not logged in';
    const { error } = await supabase
      .from('race_events')
      .delete()
      .eq('id', eventId)
      .eq('organizer_id', userId);   // RLS double-check: only own events
    if (!error) {
      setEvents(prev => prev.filter(e => e.id !== eventId));
    }
    return error ?? null;
  }, [userId]);

  // ── Toggle RSVP ────────────────────────────────────────────────────────────
  const toggleRsvp = useCallback(async (eventId: string) => {
    if (!userId) return;
    const evt = events.find(e => e.id === eventId);
    if (!evt) return;
    if (evt.user_rsvpd) {
      await supabase.from('event_rsvps').delete()
        .eq('event_id', eventId).eq('user_id', userId);
      await supabase.from('race_events')
        .update({ rsvp_count: Math.max(0, evt.rsvp_count - 1) })
        .eq('id', eventId);
      setEvents(prev => prev.map(e => e.id !== eventId ? e : {
        ...e, user_rsvpd: false, rsvp_count: Math.max(0, e.rsvp_count - 1),
      }));
    } else {
      await supabase.from('event_rsvps').insert({ event_id: eventId, user_id: userId });
      await supabase.from('race_events')
        .update({ rsvp_count: evt.rsvp_count + 1 })
        .eq('id', eventId);
      setEvents(prev => prev.map(e => e.id !== eventId ? e : {
        ...e, user_rsvpd: true, rsvp_count: e.rsvp_count + 1,
      }));
    }
  }, [userId, events]);

  // ── Dedup check: any spot within radiusMiles, ALL types ──────────────────
  const checkNearbySpots = useCallback(async (
    lat: number, lng: number, radiusMiles: number,
  ): Promise<{ tooClose: boolean; nearestName?: string }> => {
    // Use a bounding box then precise haversine — queries ALL spot types
    const { minLat, maxLat, minLng, maxLng } = boundingBox(lat, lng, radiusMiles);
    const { data, error } = await supabase
      .from('fly_spots')
      .select('id, name, latitude, longitude')
      .gte('latitude',  minLat).lte('latitude',  maxLat)
      .gte('longitude', minLng).lte('longitude', maxLng);
    if (error || !data) return { tooClose: false };
    for (const s of data) {
      if (haversineDistance(lat, lng, s.latitude, s.longitude) < radiusMiles) {
        return { tooClose: true, nearestName: s.name };
      }
    }
    return { tooClose: false };
  }, []);

  return {
    spots, events, comments, loading,
    mgpSyncing, mgpSyncCount,
    fetchSpots, fetchEvents, fetchComments,
    syncMultiGPEvents, syncChapterRaces,
    addSpot, voteSpot, addComment, reportSpot, checkNearbySpots,
    addEvent, toggleRsvp,
    deleteSpot, deleteEvent,
    fetchNewNearbyEvents,
  };
}
