// src/hooks/useSearch.ts
import { useState, useCallback, useRef } from 'react';
import { supabase } from '../services/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface SearchUser {
  id:              string;
  username:        string | null;
  avatar_url:      string | null;
  bio:             string | null;
  followers_count: number;
}

export interface SearchPost {
  id:            string;
  user_id:       string;
  caption:       string | null;
  media_url:     string | null;
  thumbnail_url: string | null;
  platform:      string | null;
  created_at:    string;
  users?: { username: string | null; avatar_url: string | null } | null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useSearch() {
  const [users,   setUsers]   = useState<SearchUser[]>([]);
  const [posts,   setPosts]   = useState<SearchPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [query,   setQuery]   = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Core search ────────────────────────────────────────────────────────────
  const search = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || trimmed.length < 2) {
      setUsers([]);
      setPosts([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const [usersRes, postsRes] = await Promise.all([
      supabase
        .from('users')
        .select('id, username, avatar_url, bio, followers_count')
        .ilike('username', `%${trimmed}%`)
        .limit(20),
      supabase
        .from('posts')
        .select('id, user_id, caption, media_url, thumbnail_url, platform, created_at')
        .ilike('caption', `%${trimmed}%`)
        .order('created_at', { ascending: false })
        .limit(30),
    ]);

    // ── Use unknown as intermediate to avoid Supabase type overlap errors ──
    setUsers((usersRes.data as unknown as SearchUser[]) ?? []);
    setPosts((postsRes.data as unknown as SearchPost[]) ?? []);
    setLoading(false);
  }, []);

  // ── Debounced wrapper ──────────────────────────────────────────────────────
  const debouncedSearch = useCallback((q: string) => {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) {
      setUsers([]);
      setPosts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => search(q), 350);
  }, [search]);

  // ── Clear ──────────────────────────────────────────────────────────────────
  const clearSearch = useCallback(() => {
    setQuery('');
    setUsers([]);
    setPosts([]);
    setLoading(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  return { users, posts, loading, query, debouncedSearch, clearSearch };
}
