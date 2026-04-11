// src/hooks/useFeedAlgorithm.ts
// Personalised feed scoring engine.
// Tracks user signals (likes, views, searches, tag usage, follows, skips)
// and converts them into a weighted interest profile used to score posts.

import { useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '../services/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SignalType =
  | 'like'
  | 'comment'
  | 'view'
  | 'search'
  | 'tag_use'
  | 'follow'
  | 'skip';

export interface TrackSignalParams {
  signal_type: SignalType;
  tag?:          string;        // for like/comment/view/tag_use
  author_id?:    string;        // for like/comment/view/follow
  post_id?:      string;        // for like/comment/view/skip
  search_query?: string;        // for search
  weight?:       number;        // override base weight (0.1 – 5.0)
}

export interface InterestProfile {
  tagWeights:     Record<string, number>;   // tag → accumulated weight
  authorAffinity: Record<string, number>;   // userId → accumulated weight
  topTags:        string[];                 // sorted by weight desc
  topAuthors:     string[];
  lastUpdated:    number;                   // timestamp ms
}

// Scoreable subset of FeedPost (avoids circular import)
export interface ScoredPost {
  id:           string;
  user_id?:     string | null;
  tags?:        string[] | null;
  created_at?:  string | null;
  like_count:   number;
  comment_count: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

// Base weight contributed by each signal type
const BASE_WEIGHTS: Record<SignalType, number> = {
  like:     3.0,
  comment:  5.0,
  view:     1.0,
  search:   2.0,
  tag_use:  4.0,
  follow:   4.0,
  skip:    -0.5,
};

// Recency decay half-life in days for *signals* (older signals matter less)
const SIGNAL_HALFLIFE_DAYS = 14;

// Recency decay half-life in days for *posts* (newer posts rank higher)
const POST_HALFLIFE_DAYS = 3;

// Scoring weights (must sum to 1.0)
const W_TAG     = 0.35;
const W_AUTHOR  = 0.20;
const W_RECENCY = 0.30;
const W_SOCIAL  = 0.15;

// How many signals to read from DB (most recent)
const MAX_SIGNALS = 500;

// ─── Pure scoring helpers ─────────────────────────────────────────────────────

export function scorePost(post: ScoredPost, profile: InterestProfile): number {
  // 1. Tag affinity (0–1)
  const tags = post.tags ?? [];
  let tagScore = 0;
  if (tags.length > 0) {
    const rawSum = tags.reduce((sum, t) => sum + (profile.tagWeights[t] ?? 0), 0);
    const maxPossible = Math.max(...Object.values(profile.tagWeights), 1);
    tagScore = Math.min(rawSum / maxPossible, 1);
  }

  // 2. Author affinity (0–1)
  const uid = post.user_id ?? '';
  const rawAuthor = profile.authorAffinity[uid] ?? 0;
  const maxAuthor = Math.max(...Object.values(profile.authorAffinity), 1);
  const authorScore = uid ? Math.min(rawAuthor / maxAuthor, 1) : 0;

  // 3. Recency decay (0–1) — exponential, half-life = POST_HALFLIFE_DAYS
  const ageMs   = Date.now() - new Date(post.created_at ?? 0).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const recencyScore = Math.exp((-ageDays * Math.LN2) / POST_HALFLIFE_DAYS);

  // 4. Social proof (0–1) — log-scaled engagement
  const engagement   = post.like_count + post.comment_count * 2;
  const socialScore  = Math.min(Math.log1p(engagement) / 6, 1);

  return (
    W_TAG     * tagScore +
    W_AUTHOR  * authorScore +
    W_RECENCY * recencyScore +
    W_SOCIAL  * socialScore
  );
}

export function rankPosts<T extends ScoredPost>(posts: T[], profile: InterestProfile): T[] {
  if (Object.keys(profile.tagWeights).length === 0 &&
      Object.keys(profile.authorAffinity).length === 0) {
    // Cold start: fall back to chronological order
    return [...posts].sort((a, b) =>
      new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
    );
  }
  return [...posts].sort((a, b) => scorePost(b, profile) - scorePost(a, profile));
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useFeedAlgorithm(userId?: string) {
  const [profile, setProfile] = useState<InterestProfile>({
    tagWeights: {}, authorAffinity: {}, topTags: [], topAuthors: [], lastUpdated: 0,
  });
  const [profileLoading, setProfileLoading] = useState(false);

  // Throttle DB writes: batch signals for up to 2s before flushing
  const pendingSignals = useRef<TrackSignalParams[]>([]);
  const flushTimer     = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Build interest profile from DB signals ──────────────────────────────
  const loadProfile = useCallback(async () => {
    if (!userId) return;
    setProfileLoading(true);

    const { data, error } = await supabase
      .from('user_feed_signals')
      .select('signal_type, tag, author_id, weight, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(MAX_SIGNALS);

    if (error) {
      console.warn('[useFeedAlgorithm] loadProfile error:', error.message);
      setProfileLoading(false);
      return;
    }

    const tagWeights:     Record<string, number> = {};
    const authorAffinity: Record<string, number> = {};
    const now = Date.now();

    for (const row of (data ?? [])) {
      const ageMs    = now - new Date(row.created_at).getTime();
      const ageDays  = ageMs / (1000 * 60 * 60 * 24);
      const decay    = Math.exp((-ageDays * Math.LN2) / SIGNAL_HALFLIFE_DAYS);
      const baseW    = BASE_WEIGHTS[row.signal_type as SignalType] ?? 1;
      const rowW     = (row.weight ?? 1) * baseW * decay;

      if (row.tag) {
        tagWeights[row.tag] = (tagWeights[row.tag] ?? 0) + rowW;
      }
      if (row.author_id) {
        authorAffinity[row.author_id] = (authorAffinity[row.author_id] ?? 0) + rowW;
      }
    }

    const topTags    = Object.entries(tagWeights).sort((a, b) => b[1] - a[1]).map(([t]) => t);
    const topAuthors = Object.entries(authorAffinity).sort((a, b) => b[1] - a[1]).map(([u]) => u);

    setProfile({ tagWeights, authorAffinity, topTags, topAuthors, lastUpdated: now });
    setProfileLoading(false);
  }, [userId]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  // ── Track a signal ──────────────────────────────────────────────────────
  const trackSignal = useCallback((params: TrackSignalParams) => {
    if (!userId) return;

    // Batch DB write only. Avoid mutating the local interest profile mid-scroll,
    // which can cause feed chips/layout to change while the user is interacting.
    pendingSignals.current.push(params);
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => {
      const batch = pendingSignals.current.splice(0);
      if (!batch.length) return;
      const rows = batch.map(s => ({
        user_id:      userId,
        signal_type:  s.signal_type,
        tag:          s.tag          ?? null,
        author_id:    s.author_id    ?? null,
        post_id:      s.post_id      ?? null,
        search_query: s.search_query ?? null,
        weight:       s.weight       ?? 1.0,
      }));
      supabase.from('user_feed_signals').insert(rows).then(({ error: e }) => {
        if (e) console.warn('[useFeedAlgorithm] insert signals error:', e.message);
      });
    }, 2000);
  }, [userId]);

  // ── Convenience: track all tags of a post at once ───────────────────────
  const trackPostInteraction = useCallback((
    signal_type: SignalType,
    post: ScoredPost,
  ) => {
    const tags = post.tags ?? [];
    // Track each tag signal
    tags.forEach(tag => trackSignal({ signal_type, tag, author_id: post.user_id ?? undefined, post_id: post.id }));
    // Track author even if no tags
    if (!tags.length && post.user_id) {
      trackSignal({ signal_type, author_id: post.user_id, post_id: post.id });
    }
  }, [trackSignal]);

  return {
    profile,
    profileLoading,
    trackSignal,
    trackPostInteraction,
    scorePost: (post: ScoredPost) => scorePost(post, profile),
    rankPosts: <T extends ScoredPost>(posts: T[]) => rankPosts(posts, profile),
    reloadProfile: loadProfile,
  };
}
