// src/hooks/useChallenges.ts
// Full hook for the FPV Challenge + Props system

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
  submission_ends: string;
  voting_ends: string;
  status: 'active' | 'voting' | 'completed' | 'cancelled';
  max_duration_s: number;
  created_at: string;
  // Joined
  creator?: { username?: string | null; avatar_url?: string | null } | null;
  entry_count?: number;
  my_entry?: ChallengeEntry | null;
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
  // Joined (only revealed after voting ends)
  user?: { username?: string | null; avatar_url?: string | null } | null;
  has_voted?: boolean;
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

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useChallenges(currentUserId?: string) {
  const [seasons,    setSeasons]    = useState<Season[]>([]);
  const [activeSeason, setActiveSeason] = useState<Season | null>(null);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [creating,   setCreating]   = useState(false);

  // ── Load seasons ────────────────────────────────────────────────────────────
  const loadSeasons = useCallback(async () => {
    const { data } = await supabase
      .from('seasons')
      .select('*')
      .order('number', { ascending: false });
    const list = (data ?? []) as Season[];
    setSeasons(list);
    setActiveSeason(list.find(s => s.is_active) ?? list[0] ?? null);
  }, []);

  // ── Load challenges for a given season ──────────────────────────────────────
  const loadChallenges = useCallback(async (seasonId?: string) => {
    setLoading(true);
    const sid = seasonId ?? activeSeason?.id;
    if (!sid) { setLoading(false); return; }

    const { data, error } = await supabase
      .from('challenges')
      .select(`
        *,
        creator:created_by (username, avatar_url),
        entry_count:challenge_entries(count)
      `)
      .eq('season_id', sid)
      .order('created_at', { ascending: false });

    if (error) { console.error('[useChallenges]', error.message); setLoading(false); return; }

    // If user is logged in, fetch their own entries too
    let myEntries: Record<string, ChallengeEntry> = {};
    if (currentUserId && data?.length) {
      const ids = data.map((c: any) => c.id);
      const { data: mine } = await supabase
        .from('challenge_entries')
        .select('*')
        .eq('user_id', currentUserId)
        .in('challenge_id', ids);
      (mine ?? []).forEach((e: any) => { myEntries[e.challenge_id] = e; });
    }

    const list = (data ?? []).map((c: any) => ({
      ...c,
      entry_count: c.entry_count?.[0]?.count ?? 0,
      my_entry: myEntries[c.id] ?? null,
    })) as Challenge[];

    // Auto-advance status based on timestamps
    const now = new Date();
    list.forEach(c => {
      if (c.status === 'active' && new Date(c.submission_ends) < now) {
        c.status = 'voting';
      }
      if (c.status === 'voting' && new Date(c.voting_ends) < now) {
        c.status = 'completed';
      }
    });

    setChallenges(list);
    setLoading(false);
  }, [activeSeason?.id, currentUserId]);

  // ── Create a challenge ──────────────────────────────────────────────────────
  const createChallenge = useCallback(async (params: {
    title: string;
    description?: string;
    rules?: string;
  }): Promise<Challenge | null> => {
    if (!currentUserId || !activeSeason) return null;
    setCreating(true);

    const now = new Date();
    const submissionEnds = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000); // +5 days
    const votingEnds     = new Date(submissionEnds.getTime() + 2 * 24 * 60 * 60 * 1000); // +2 days

    const { data, error } = await supabase
      .from('challenges')
      .insert({
        season_id:       activeSeason.id,
        title:           params.title,
        description:     params.description ?? null,
        rules:           params.rules ?? null,
        created_by:      currentUserId,
        submission_ends: submissionEnds.toISOString(),
        voting_ends:     votingEnds.toISOString(),
        status:          'active',
        max_duration_s:  120,
      })
      .select('*')
      .single();

    setCreating(false);
    if (error) { console.error('[useChallenges] createChallenge:', error.message); return null; }
    const ch = { ...data, entry_count: 0, my_entry: null } as Challenge;
    setChallenges(prev => [ch, ...prev]);
    return ch;
  }, [currentUserId, activeSeason]);

  // ── Submit an entry ─────────────────────────────────────────────────────────
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
        duration_s:    params.durationS ?? null,
        caption:       params.caption ?? null,
      })
      .select('*')
      .single();

    if (error) { console.error('[useChallenges] submitEntry:', error.message); return null; }

    const entry = data as ChallengeEntry;
    // Update local challenge entry info
    setChallenges(prev => prev.map(c =>
      c.id === params.challengeId
        ? { ...c, my_entry: entry, entry_count: (c.entry_count ?? 0) + 1 }
        : c
    ));
    return entry;
  }, [currentUserId]);

  // ── Load entries for a challenge ─────────────────────────────────────────────
  const loadEntries = useCallback(async (
    challengeId: string,
    isVotingDone: boolean,
  ): Promise<ChallengeEntry[]> => {
    // Reveal author only after voting is done
    const select = isVotingDone
      ? '*, user:user_id (username, avatar_url)'
      : '*';

    const { data, error } = await supabase
      .from('challenge_entries')
      .select(select)
      .eq('challenge_id', challengeId)
      .order('vote_count', { ascending: false });

    if (error) { console.error('[useChallenges] loadEntries:', error.message); return []; }

    let votedIds: string[] = [];
    if (currentUserId) {
      const { data: myVotes } = await supabase
        .from('challenge_votes')
        .select('entry_id')
        .eq('voter_id', currentUserId)
        .in('entry_id', (data ?? []).map((e: any) => e.id));
      votedIds = (myVotes ?? []).map((v: any) => v.entry_id);
    }

    return (data ?? []).map((e: any) => ({
      ...e,
      user: isVotingDone ? (Array.isArray(e.user) ? e.user[0] : e.user) : null,
      has_voted: votedIds.includes(e.id),
    })) as ChallengeEntry[];
  }, [currentUserId]);

  // ── Vote on an entry ────────────────────────────────────────────────────────
  const vote = useCallback(async (
    entryId: string,
    isCurrentlyVoted: boolean,
  ): Promise<boolean> => {
    if (!currentUserId) return false;

    if (isCurrentlyVoted) {
      await supabase.from('challenge_votes').delete()
        .eq('entry_id', entryId).eq('voter_id', currentUserId);
    } else {
      const { error } = await supabase.from('challenge_votes')
        .insert({ entry_id: entryId, voter_id: currentUserId });
      if (error) { console.error('[useChallenges] vote:', error.message); return false; }
    }

    // Update vote count in Supabase
    await supabase.rpc('increment_vote', {
      p_entry_id: entryId,
      p_delta:    isCurrentlyVoted ? -1 : 1,
    }).catch(() => null); // graceful if RPC not set up yet; UI handles optimistic

    return true;
  }, [currentUserId]);

  // ── Leaderboard ─────────────────────────────────────────────────────────────
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

    // Global
    const { data } = await supabase
      .from('leaderboard_global')
      .select('*')
      .order('rank', { ascending: true })
      .limit(100);
    return (data ?? []) as LeaderboardEntry[];
  }, []);

  // ── User props balance ───────────────────────────────────────────────────────
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

  return {
    seasons,
    activeSeason,
    setActiveSeason,
    challenges,
    loading,
    creating,
    loadChallenges,
    createChallenge,
    submitEntry,
    loadEntries,
    vote,
    loadLeaderboard,
    loadUserProps,
  };
}

// ─── Helper ───────────────────────────────────────────────────────────────────
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
