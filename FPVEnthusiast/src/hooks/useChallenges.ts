// src/hooks/useChallenges.ts
// FPV Weekly Challenge hook — anonymous submissions, vote-to-win, suggestions

import { useState, useCallback, useEffect } from 'react';
import { supabase } from '../services/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Season {
  id: string;
  number: number;
  name: string;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
}

export interface Challenge {
  id: string;
  season_id: string;
  title: string;
  description?: string | null;
  rules?: string | null;
  created_by?: string | null;
  submission_opens_at: string;
  submission_closes_at: string;
  voting_opens_at: string;
  voting_closes_at: string;
  status: 'active' | 'voting' | 'completed' | 'cancelled';
  max_duration_seconds: number;
  prize_first_props: number;
  prize_second_props: number;
  prize_third_props: number;
  is_featured: boolean;
  created_at: string;
  updated_at: string;
  is_weekly: boolean;
  week_number?: number | null;
  category_id?: string | null;
  // Joined
  entry_count?: number;
  my_entry?: ChallengeEntry | null;
  has_voted?: boolean;
}

export interface ChallengeEntry {
  id: string;
  challenge_id: string;
  user_id: string;
  video_url: string;
  thumbnail_url?: string | null;
  duration_s?: number | null;
  caption?: string | null;
  vote_count: number;
  is_winner: boolean;
  place?: number | null;
  created_at: string;
  // Only revealed after voting ends
  user?: { username?: string | null; avatar_url?: string | null } | null;
  has_voted?: boolean;
}

export interface ChallengeSuggestion {
  id: string;
  challenge_id: string;
  user_id: string;
  title: string;
  description?: string | null;
  vote_count: number;
  has_voted?: boolean;
  created_at: string;
  user?: { username?: string | null; avatar_url?: string | null } | null;
}

export interface LeaderboardEntry {
  user_id?: string;
  id?: string;
  username?: string | null;
  avatar_url?: string | null;
  earned_props: number;
  total_props?: number;
  season_props?: number;
  city?: string | null;
  country?: string | null;
  location_label?: string | null;
  rank: number;
}

export type LeaderboardScope = 'global' | 'local' | 'season';

// ─── Phase helpers ────────────────────────────────────────────────────────────

export function getChallengePhase(ch: Challenge): 'submission' | 'voting' | 'completed' {
  const now = new Date();
  if (ch.status === 'completed' || new Date(ch.voting_closes_at) < now) return 'completed';
  if (new Date(ch.submission_closes_at) < now) return 'voting';
  return 'submission';
}

export function timeLeft(isoDate: string): string {
  const diff = new Date(isoDate).getTime() - Date.now();
  if (diff <= 0) return 'Ended';
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000)  / 60000);
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}

export function propsForPlace(place: number): number {
  return [0, 100, 60, 30][place] ?? 0;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useChallenges(currentUserId?: string) {
  const [seasons,      setSeasons]      = useState<Season[]>([]);
  const [activeSeason, setActiveSeason] = useState<Season | null>(null);
  const [challenges,   setChallenges]   = useState<Challenge[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [creating,     setCreating]     = useState(false);

  // ── Load seasons ──────────────────────────────────────────────────────────
  const loadSeasons = useCallback(async () => {
    const { data } = await supabase
      .from('seasons')
      .select('*')
      .order('number', { ascending: false });
    const list = (data ?? []) as Season[];
    setSeasons(list);
    setActiveSeason(list.find(s => s.is_active) ?? list[0] ?? null);
  }, []);

  // ── Load challenges ───────────────────────────────────────────────────────
  const loadChallenges = useCallback(async (seasonId?: string) => {
    setLoading(true);
    const sid = seasonId ?? activeSeason?.id;
    if (!sid) { setLoading(false); return; }

    const { data, error } = await supabase
      .from('challenges')
      .select(`*, entry_count:challenge_entries(count)`)
      .eq('season_id', sid)
      .order('created_at', { ascending: false });

    if (error) { console.error('[useChallenges]', error.message); setLoading(false); return; }

    // Fetch my entries
    let myEntries: Record<string, ChallengeEntry> = {};
    let myVotedChallengeIds: string[] = [];
    if (currentUserId && data?.length) {
      const ids = data.map((c: any) => c.id);
      const { data: mine } = await supabase
        .from('challenge_entries')
        .select('*')
        .eq('user_id', currentUserId)
        .in('challenge_id', ids);
      (mine ?? []).forEach((e: any) => { myEntries[e.challenge_id] = e; });

      // Check if user has voted in each challenge (challenge_votes joined to challenge_entries)
      const { data: myVotes } = await supabase
        .from('challenge_votes')
        .select('entry_id, challenge_entries(challenge_id)')
        .eq('voter_id', currentUserId);
      (myVotes ?? []).forEach((v: any) => {
        const cid = v.challenge_entries?.challenge_id;
        if (cid) myVotedChallengeIds.push(cid);
      });
    }

    const now = new Date();
    const list = (data ?? []).map((c: any) => {
      let status = c.status;
      if (status === 'active' && new Date(c.submission_closes_at) < now) status = 'voting';
      if (status === 'voting' && new Date(c.voting_closes_at) < now)     status = 'completed';
      return {
        ...c,
        status,
        entry_count: c.entry_count?.[0]?.count ?? 0,
        my_entry: myEntries[c.id] ?? null,
        has_voted: myVotedChallengeIds.includes(c.id),
      };
    }) as Challenge[];

    setChallenges(list);
    setLoading(false);
  }, [activeSeason?.id, currentUserId]);

  // ── Submit entry ──────────────────────────────────────────────────────────
  const submitEntry = useCallback(async (params: {
    challengeId: string;
    videoUrl: string;
    thumbnailUrl?: string;
    durationS?: number;
    caption?: string;
  }): Promise<ChallengeEntry | null> => {
    if (!currentUserId) return null;
    const { data, error } = await supabase
      .from('challenge_entries')
      .insert({
        challenge_id:  params.challengeId,
        user_id:       currentUserId,
        video_url:     params.videoUrl,
        thumbnail_url: params.thumbnailUrl ?? null,
        // caption & duration_s added via migration — safe to include after schema reload
        ...(params.caption    ? { caption:    params.caption }    : {}),
        ...(params.durationS  ? { duration_s: params.durationS }  : {}),
      })
      .select('*')
      .single();
    if (error) { console.error('[useChallenges] submitEntry:', error.message); return null; }
    const entry = data as ChallengeEntry;
    setChallenges(prev => prev.map(c =>
      c.id === params.challengeId
        ? { ...c, my_entry: entry, entry_count: (c.entry_count ?? 0) + 1 }
        : c
    ));
    return entry;
  }, [currentUserId]);

  // ── Load entries for a challenge ──────────────────────────────────────────
  const loadEntries = useCallback(async (
    challengeId: string,
    phase: 'submission' | 'voting' | 'completed',
  ): Promise<ChallengeEntry[]> => {
    const isRevealed = phase === 'completed';
    const select = isRevealed
      ? '*, user:user_id (username, avatar_url)'
      : '*'; // anonymous during submission + voting

    const { data, error } = await supabase
      .from('challenge_entries')
      .select(select)
      .eq('challenge_id', challengeId)
      .order('vote_count', { ascending: false });

    if (error) { console.error('[useChallenges] loadEntries:', error.message); return []; }

    let votedIds: string[] = [];
    if (currentUserId && data?.length) {
      const { data: myVotes } = await supabase
        .from('challenge_votes')
        .select('entry_id')
        .eq('voter_id', currentUserId)
        .in('entry_id', data.map((e: any) => e.id));
      votedIds = (myVotes ?? []).map((v: any) => v.entry_id);
    }

    return (data ?? []).map((e: any) => ({
      ...e,
      // Hide user identity unless revealed
      user: isRevealed ? (Array.isArray(e.user) ? e.user[0] : e.user) : null,
      has_voted: votedIds.includes(e.id),
    })) as ChallengeEntry[];
  }, [currentUserId]);

  // ── Vote on an entry ──────────────────────────────────────────────────────
  const vote = useCallback(async (
    entryId: string,
    entryUserId: string,
    isCurrentlyVoted: boolean,
  ): Promise<{ success: boolean; reason?: string }> => {
    if (!currentUserId) return { success: false, reason: 'not_logged_in' };
    if (entryUserId === currentUserId) return { success: false, reason: 'self_vote' };

    if (isCurrentlyVoted) {
      await supabase.from('challenge_votes').delete()
        .eq('entry_id', entryId).eq('voter_id', currentUserId);
    } else {
      const { error } = await supabase.from('challenge_votes')
        .insert({ entry_id: entryId, voter_id: currentUserId });
      if (error) return { success: false, reason: error.message };
    }

    const voteDelta = isCurrentlyVoted ? -1 : 1;
    try {
      await supabase.rpc('increment_vote', {
        p_entry_id: entryId,
        p_delta: voteDelta,
      });
    } catch (_) {}

    return { success: true };
  }, [currentUserId]);

  // ── Delete (replace) an entry ─────────────────────────────────────────────
  const deleteEntry = useCallback(async (
    entryId: string,
    videoUrl: string,
    thumbnailUrl?: string | null,
  ): Promise<boolean> => {
    if (!currentUserId) return false;

    // Delete storage files
    const extractPath = (url: string) => {
      try {
        const u = new URL(url);
        // path after /object/public/posts/
        const parts = u.pathname.split('/object/public/posts/');
        return parts[1] ?? null;
      } catch { return null; }
    };

    const videoPth = extractPath(videoUrl);
    const thumbPth = thumbnailUrl ? extractPath(thumbnailUrl) : null;

    if (videoPth) {
      await supabase.storage.from('posts').remove([videoPth]).catch(() => null);
    }
    if (thumbPth) {
      await supabase.storage.from('posts').remove([thumbPth]).catch(() => null);
    }

    // Delete DB row
    const { error } = await supabase
      .from('challenge_entries')
      .delete()
      .eq('id', entryId)
      .eq('user_id', currentUserId);

    if (error) {
      console.error('[useChallenges] deleteEntry:', error.message);
      return false;
    }

    // Clear my_entry on the parent challenge
    setChallenges(prev => prev.map(c =>
      c.my_entry?.id === entryId
        ? { ...c, my_entry: null, entry_count: Math.max(0, (c.entry_count ?? 1) - 1) }
        : c
    ));
    return true;
  }, [currentUserId]);

  // ── Suggestions ───────────────────────────────────────────────────────────
  const loadSuggestions = useCallback(async (
    challengeId: string,
  ): Promise<ChallengeSuggestion[]> => {
    const { data, error } = await supabase
      .from('challenge_suggestions')
      .select('*, user:user_id (username, avatar_url)')
      .eq('challenge_id', challengeId)
      .order('vote_count', { ascending: false });
    if (error) { console.error('[useChallenges] loadSuggestions:', error.message); return []; }

    let votedIds: string[] = [];
    if (currentUserId && data?.length) {
      const { data: myVotes } = await supabase
        .from('challenge_suggestion_votes')
        .select('suggestion_id')
        .eq('voter_id', currentUserId)
        .in('suggestion_id', data.map((s: any) => s.id));
      votedIds = (myVotes ?? []).map((v: any) => v.suggestion_id);
    }

    return (data ?? []).map((s: any) => ({
      ...s,
      user: Array.isArray(s.user) ? s.user[0] : s.user,
      has_voted: votedIds.includes(s.id),
    })) as ChallengeSuggestion[];
  }, [currentUserId]);

  const submitSuggestion = useCallback(async (params: {
    challengeId: string;
    title: string;
    description?: string;
  }): Promise<ChallengeSuggestion | null> => {
    if (!currentUserId) return null;
    const { data, error } = await supabase
      .from('challenge_suggestions')
      .insert({
        challenge_id: params.challengeId,
        user_id:      currentUserId,
        title:        params.title,
        description:  params.description ?? null,
      })
      .select('*')
      .single();
    if (error) { console.error('[useChallenges] submitSuggestion:', error.message); return null; }
    return data as ChallengeSuggestion;
  }, [currentUserId]);

  const voteSuggestion = useCallback(async (
    suggestionId: string,
    isCurrentlyVoted: boolean,
  ): Promise<boolean> => {
    if (!currentUserId) return false;
    if (isCurrentlyVoted) {
      await supabase.from('challenge_suggestion_votes').delete()
        .eq('suggestion_id', suggestionId).eq('voter_id', currentUserId);
    } else {
      const { error } = await supabase.from('challenge_suggestion_votes')
        .insert({ suggestion_id: suggestionId, voter_id: currentUserId });
      if (error) return false;
    }
    const sugDelta = isCurrentlyVoted ? -1 : 1;
    try {
      await supabase.rpc('increment_suggestion_vote', {
        p_suggestion_id: suggestionId,
        p_delta: sugDelta,
      });
    } catch (_) {}
    return true;
  }, [currentUserId]);

  // ── Leaderboard ───────────────────────────────────────────────────────────
  const loadLeaderboard = useCallback(async (
    scope: LeaderboardScope,
    seasonId?: string,
    locationLabel?: string,
  ): Promise<LeaderboardEntry[]> => {
    if (scope === 'season' && seasonId) {
      const { data } = await supabase
        .from('leaderboard_season')
        .select('*')
        .eq('season_id', seasonId)
        .order('rank', { ascending: true })
        .limit(100);
      return (data ?? []).map((r: any) => ({ ...r, earned_props: r.earned })) as LeaderboardEntry[];
    }
    if (scope === 'local' && locationLabel) {
      const { data } = await supabase
        .from('leaderboard_global')
        .select('*')
        .eq('location_label', locationLabel)
        .order('rank', { ascending: true })
        .limit(100);
      return (data ?? []) as LeaderboardEntry[];
    }
    const { data } = await supabase
      .from('leaderboard_global')
      .select('*')
      .order('rank', { ascending: true })
      .limit(100);
    return (data ?? []) as LeaderboardEntry[];
  }, []);

  const loadUserProps = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from('users')
      .select('total_props, earned_props, season_props')
      .eq('id', userId)
      .single();
    return data ?? { total_props: 0, earned_props: 0, season_props: 0 };
  }, []);

  useEffect(() => {
    loadSeasons().then(() => loadChallenges());
  }, []);

  useEffect(() => {
    if (activeSeason) loadChallenges(activeSeason.id);
  }, [activeSeason?.id, currentUserId]);


  // ── AI content check ─────────────────────────────────────────────────────
  // Sends the thumbnail base64 to our edge function which calls Google Vision.
  // Returns { approved, issues } where issues is a string[] of problems found.
  const checkThumbnail = useCallback(async (
    thumbnailUri: string,
  ): Promise<{ approved: boolean; issues: string[] }> => {
    try {
      // Read thumbnail as base64
      const resp = await fetch(thumbnailUri);
      const blob = await resp.blob();
      const reader: any = new FileReader();
      const base64: string = await new Promise((resolve, reject) => {
        reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror  = reject;
        reader.readAsDataURL(blob);
      });

      const { data, error } = await supabase.functions.invoke('check-video-content', {
        body: { thumbnailBase64: base64 },
      });

      if (error) {
        console.warn('[checkThumbnail] edge fn error:', error.message);
        return { approved: true, issues: [] }; // fail open — don't block on API errors
      }
      return { approved: data.approved ?? true, issues: data.issues ?? [] };
    } catch (err) {
      console.warn('[checkThumbnail] unexpected error:', err);
      return { approved: true, issues: [] }; // fail open
    }
  }, []);

  return {
    seasons, activeSeason, setActiveSeason,
    challenges, loading, creating,
    loadChallenges, submitEntry, deleteEntry, loadEntries,
    vote, loadLeaderboard, loadUserProps,
    loadSuggestions, submitSuggestion, voteSuggestion,
    checkThumbnail,
  };
}
