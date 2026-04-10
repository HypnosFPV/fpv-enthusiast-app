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
  pilot_id: string;                        // real column name in live DB
  entry_number: number;
  processing_status: string;               // enum: uploading, processing, ready, failed
  moderation_status: 'pending' | 'processing' | 'approved' | 'needs_review' | 'rejected'; // OSD scan
  moderation_flags?: Array<{ type: string; text?: string; confidence?: number }> | null;
  s3_upload_key?: string | null;
  s3_processed_key?: string | null;
  thumbnail_s3_key?: string | null;
  original_filename?: string | null;
  file_size_bytes?: number | null;
  duration_seconds?: number | null;
  audio_removed: boolean;
  processing_completed_at?: string | null;
  processing_error?: string | null;
  status: string;                          // enum: pending, active, disqualified, winner
  vote_count: number;
  final_rank?: number | null;              // 1/2/3 for winners, null otherwise
  props_awarded: number;
  submitted_at?: string | null;
  created_at: string;
  updated_at: string;
  // Derived helpers
  video_url?: string | null;              // public URL derived from s3_upload_key
  thumbnail_url?: string | null;          // public URL derived from thumbnail_s3_key
  has_voted?: boolean;
  // Only revealed after voting ends
  user?: { username?: string | null; avatar_url?: string | null } | null;
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
  earned_props: number;        // leaderboard score (= lifetime_props from global view)
  total_props?: number;        // spendable wallet balance
  lifetime_props?: number;     // immutable all-time earned (leaderboard source)
  spendable_props?: number;    // alias for total_props exposed by leaderboard_global view
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

function timeValueOrFallback(value?: string | null, fallback = Number.POSITIVE_INFINITY): number {
  if (!value) return fallback;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? fallback : parsed;
}

function sortChallengeEntries(
  entries: ChallengeEntry[],
  phase: 'submission' | 'voting' | 'completed',
): ChallengeEntry[] {
  return [...entries].sort((a, b) => {
    if (phase === 'completed') {
      const aRank = a.final_rank ?? Number.POSITIVE_INFINITY;
      const bRank = b.final_rank ?? Number.POSITIVE_INFINITY;
      if (aRank !== bRank) return aRank - bRank;
    }

    if (a.vote_count !== b.vote_count) return b.vote_count - a.vote_count;

    const submittedDiff =
      timeValueOrFallback(a.submitted_at) - timeValueOrFallback(b.submitted_at);
    if (submittedDiff !== 0) return submittedDiff;

    return timeValueOrFallback(a.created_at) - timeValueOrFallback(b.created_at);
  });
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
      // Fetch user's own entries (for my_entry)
      const { data: mine } = await supabase
        .from('challenge_entries')
        .select('*')
        .eq('pilot_id', currentUserId)
        .in('challenge_id', ids);
      (mine ?? []).forEach((e: any) => { myEntries[e.challenge_id] = e; });

      // Fetch ALL entries for these challenges (lightweight — only id + challenge_id)
      // Needed to map any voted entry_id → challenge_id regardless of pilot.
      const { data: allEntries } = await supabase
        .from('challenge_entries')
        .select('id, challenge_id')
        .in('challenge_id', ids);

      // Check if user has voted in each challenge.
      // Avoid embedded PostgREST join (needs FK) — instead look up challenge_id
      // from the entries we already fetched in 'mine' above.
      const entryIdToChallengeId: Record<string, string> = {};
      (mine ?? []).forEach((e: any) => { entryIdToChallengeId[e.id] = e.challenge_id; });

      const { data: myVotes } = await supabase
        .from('challenge_votes')
        .select('entry_id')
        .eq('voter_id', currentUserId);
      (myVotes ?? []).forEach((v: any) => {
        // First try the local map (entries the user submitted)
        const cid = entryIdToChallengeId[v.entry_id];
        if (cid) { myVotedChallengeIds.push(cid); return; }
        // Fallback: scan allEntries for this entry_id
        // (user voted on someone else's entry — pilot_id != currentUserId)
        for (const e of (allEntries ?? [])) {
          if (e.id === v.entry_id) { myVotedChallengeIds.push(e.challenge_id); return; }
        }
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
    s3UploadKey: string;          // storage path returned after upload
    thumbnailS3Key?: string;
    frameS3Keys?: string[];       // up to 6 evenly-spaced frame thumbnails for OSD scanning
    durationSeconds?: number;
    originalFilename?: string;
    fileSizeBytes?: number;
  }): Promise<ChallengeEntry | null> => {
    if (!currentUserId) return null;

    // entry_number is assigned atomically by the DB trigger (assign_entry_number).
    // Do NOT include it in the insert payload — the trigger owns it entirely.
    const { data, error } = await supabase
      .from('challenge_entries')
      .insert({
        challenge_id:      params.challengeId,
        pilot_id:          currentUserId,
        s3_upload_key:     params.s3UploadKey,
        thumbnail_s3_key:  params.thumbnailS3Key ?? null,
        duration_seconds:  params.durationSeconds ? Math.round(params.durationSeconds) : null,
        original_filename: params.originalFilename ?? null,
        file_size_bytes:   params.fileSizeBytes ?? null,
        submitted_at:      new Date().toISOString(),
      })
      .select('*')
      .single();
    if (error) { console.error('[useChallenges] submitEntry:', error.message); return null; }
    const entry = data as ChallengeEntry;

    // ── Trigger OSD pilot-name scan asynchronously ─────────────────────────
    // Fire-and-forget: the edge function updates moderation_status on its own.
    supabase.functions.invoke('scan-osd-text', {
      body: {
        entry_id:       entry.id,
        s3_key:         params.s3UploadKey,
        frame_s3_keys:  params.frameS3Keys ?? [],  // multi-frame OSD scan
      },
    }).catch((e: any) => console.warn('[useChallenges] scan-osd-text invoke failed:', e));
    // Derive public URLs for immediate display
    const videoUrl = params.s3UploadKey
      ? supabase.storage.from('posts').getPublicUrl(params.s3UploadKey).data.publicUrl
      : null;
    const thumbUrl = params.thumbnailS3Key
      ? supabase.storage.from('posts').getPublicUrl(params.thumbnailS3Key).data.publicUrl
      : null;
    const enriched = { ...entry, video_url: videoUrl, thumbnail_url: thumbUrl };
    setChallenges(prev => prev.map(c =>
      c.id === params.challengeId
        ? { ...c, my_entry: enriched, entry_count: (c.entry_count ?? 0) + 1 }
        : c
    ));
    // ── Props award: first challenge entry ever ──────────────────────────────
    try {
      await supabase.from('props_log').insert({
        user_id:      currentUserId,
        amount:       25,
        reason:       'first_challenge_entry',
        reference_id: currentUserId,
      });
    } catch (_) { /* duplicate = already awarded, ignore */ }

    return enriched;
  }, [currentUserId]);

  // ── Load entries for a challenge ──────────────────────────────────────────
  const loadEntries = useCallback(async (
    challengeId: string,
    phase: 'submission' | 'voting' | 'completed',
  ): Promise<ChallengeEntry[]> => {
    const isRevealed = phase === 'completed';
    const select = isRevealed
      ? '*, user:pilot_id (username, avatar_url)'
      : '*'; // anonymous during submission + voting

    let query = supabase
      .from('challenge_entries')
      .select(select)
      .eq('challenge_id', challengeId);

    if (phase === 'completed') {
      query = query.order('final_rank', { ascending: true, nullsFirst: false });
    }

    const { data, error } = await query
      .order('vote_count', { ascending: false })
      .order('submitted_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });

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

    const enriched = (data ?? []).map((e: any) => {
      const videoUrl = e.s3_upload_key
        ? supabase.storage.from('posts').getPublicUrl(e.s3_upload_key).data.publicUrl
        : null;
      const thumbUrl = e.thumbnail_s3_key
        ? supabase.storage.from('posts').getPublicUrl(e.thumbnail_s3_key).data.publicUrl
        : null;
      return {
        ...e,
        video_url: videoUrl,
        thumbnail_url: thumbUrl,
        user: isRevealed ? (Array.isArray(e.user) ? e.user[0] : e.user) : null,
        has_voted: votedIds.includes(e.id),
      };
    }) as ChallengeEntry[];

    return sortChallengeEntries(enriched, phase);
  }, [currentUserId]);

  // ── Vote on an entry ──────────────────────────────────────────────────────
  const VOTE_PROPS = 10; // props awarded for casting a first vote in a challenge

  const vote = useCallback(async (
    entryId: string,
    entryPilotId: string,
    isCurrentlyVoted: boolean,
    challengeId?: string,   // needed for per-challenge dedup of vote reward
  ): Promise<{ success: boolean; reason?: string; propsAwarded?: number }> => {
    if (!currentUserId) return { success: false, reason: 'not_logged_in' };
    if (entryPilotId === currentUserId) return { success: false, reason: 'self_vote' };

    if (isCurrentlyVoted) {
      // Removing a vote — no props change (can't un-earn)
      await supabase.from('challenge_votes').delete()
        .eq('entry_id', entryId).eq('voter_id', currentUserId);
    } else {
      const { error } = await supabase.from('challenge_votes')
        .insert({ entry_id: entryId, voter_id: currentUserId, ...(challengeId ? { challenge_id: challengeId } : {}) });
      if (error) return { success: false, reason: error.message };
    }

    const voteDelta = isCurrentlyVoted ? -1 : 1;
    try {
      await supabase.rpc('increment_vote', {
        p_entry_id: entryId,
        p_delta: voteDelta,
      });
    } catch (_) {}

    // ── Props reward: 10 props for first vote cast in this challenge ──────────
    // Only fires when adding a vote (not removing) and challengeId is known.
    // The props_log_dedup UNIQUE(user_id, reason, reference_id) constraint
    // silently ignores duplicates, so this is safe to call every time.
    let propsAwarded = 0;
    if (!isCurrentlyVoted && challengeId && currentUserId) {
      const { error: propErr } = await supabase.from('props_log').insert({
        user_id:      currentUserId,
        amount:       VOTE_PROPS,
        reason:       'challenge_vote',
        reference_id: challengeId,   // one award per challenge, not per entry
      });
      if (!propErr) propsAwarded = VOTE_PROPS;
      // propErr with code '23505' = duplicate = already awarded this week → ignore
    }

    return { success: true, propsAwarded };
  }, [currentUserId]);

  // ── Delete (replace) an entry ─────────────────────────────────────────────
  const deleteEntry = useCallback(async (
    entryId: string,
    s3UploadKey?: string | null,
    thumbnailS3Key?: string | null,
  ): Promise<boolean> => {
    if (!currentUserId) return false;

    // Delete storage files directly by key (no URL parsing needed)
    if (s3UploadKey) {
      try { await supabase.storage.from('posts').remove([s3UploadKey]); } catch (_) {}
    }
    if (thumbnailS3Key) {
      try { await supabase.storage.from('posts').remove([thumbnailS3Key]); } catch (_) {}
    }

    // Delete DB row (RLS enforces pilot_id = auth.uid())
    const { error } = await supabase
      .from('challenge_entries')
      .delete()
      .eq('id', entryId)
      .eq('pilot_id', currentUserId);

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
      .select('total_props, earned_props, lifetime_props, season_props')
      .eq('id', userId)
      .single();
    return data ?? { total_props: 0, earned_props: 0, lifetime_props: 0, season_props: 0 };
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
