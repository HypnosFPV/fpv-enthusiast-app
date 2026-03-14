// src/hooks/useMarketplace.ts
import { useState, useCallback, useEffect } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../services/supabase';

// ─── Category taxonomy ────────────────────────────────────────────────────────

export const CATEGORIES = [
  { slug: 'frames',       label: 'Frames',         icon: '🏗️' },
  { slug: 'flight_ctrl',  label: 'Flight Controllers', icon: '🖥️' },
  { slug: 'escs',         label: 'ESCs',            icon: '⚡' },
  { slug: 'motors',       label: 'Motors',          icon: '🔄' },
  { slug: 'video',        label: 'Video Systems',   icon: '📡' },
  { slug: 'radio',        label: 'Radio / RX',      icon: '📻' },
  { slug: 'batteries',    label: 'Batteries',       icon: '🔋' },
  { slug: 'props',        label: 'Props',           icon: '🌀' },
  { slug: 'cameras',      label: 'Cameras',         icon: '📷' },
  { slug: 'goggles',      label: 'Goggles',         icon: '🥽' },
  { slug: 'whole_builds', label: 'Whole Builds',    icon: '🚁' },
  { slug: 'tools',        label: 'Tools & Chargers', icon: '🔧' },
  { slug: 'parts',        label: 'Parts & Hardware', icon: '🔩' },
  { slug: 'other',        label: 'Other',           icon: '📦' },
] as const;

export type CategorySlug = typeof CATEGORIES[number]['slug'];

export const CONDITIONS = [
  { value: 'new',       label: 'New',         color: '#00e676' },
  { value: 'like_new',  label: 'Like New',    color: '#69f0ae' },
  { value: 'good',      label: 'Good',        color: '#ffcc00' },
  { value: 'fair',      label: 'Fair',        color: '#ff9100' },
  { value: 'for_parts', label: 'For Parts',   color: '#ff4444' },
] as const;

export type ConditionValue = typeof CONDITIONS[number]['value'];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ListingImage {
  id: string;
  url: string;
  position: number;
  is_primary: boolean;
}

export interface MarketplaceListing {
  id: string;
  seller_id: string;
  title: string;
  description: string;
  category: CategorySlug;
  subcategory?: string | null;
  condition: ConditionValue;
  condition_notes?: string | null;
  price: number;
  buy_now_price?: number | null;
  listing_type: 'fixed' | 'auction' | 'hybrid' | 'offer';
  status: 'draft' | 'active' | 'sold' | 'ended' | 'cancelled' | 'flagged';
  auction_end?: string | null;
  current_bid?: number | null;
  bid_count: number;
  ships_from_state?: string | null;
  shipping_cost?: number | null;
  free_shipping: boolean;
  lipo_hazmat: boolean;
  view_count: number;
  created_at: string;
  updated_at: string;
  // joined
  listing_images?: ListingImage[];
  seller?: {
    id: string;
    username: string | null;
    avatar_url: string | null;
    avg_rating?: number;
    total_sales?: number;
    verification_tier?: number;
  } | null;
  is_watched?: boolean;
  is_featured?: boolean;
  featured_until?: string | null;
  featured_type?: 'paid' | 'props' | null;
}

export interface CreateListingParams {
  title: string;
  description: string;
  category: CategorySlug;
  subcategory?: string;
  condition: ConditionValue;
  condition_notes?: string;
  price: number;
  listing_type?: 'fixed' | 'offer';
  ships_from_state?: string;
  shipping_cost?: number;
  free_shipping?: boolean;
  weight_oz?: number;
  lipo_hazmat?: boolean;
  imageUris?: string[];
}

export interface MarketplaceFilters {
  category?: CategorySlug | null;
  condition?: ConditionValue | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  searchQuery?: string;
  freeShipping?: boolean;
}

const PAGE_SIZE = 20;

const LISTING_SELECT = `
  id, seller_id, title, description, category, subcategory,
  condition, condition_notes, price, buy_now_price, listing_type,
  status, auction_end, current_bid, bid_count,
  ships_from_state, shipping_cost, free_shipping, lipo_hazmat,
  view_count, created_at, updated_at,
  listing_images (id, url, position, is_primary),
  seller:seller_id (
    id:user_id,
    users:user_id (id, username, avatar_url),
    avg_rating, total_sales, verification_tier
  )
`;

// Simpler select that joins users directly
// Seller info is fetched separately (batch) to avoid PostgREST FK requirement.
const LISTING_SELECT_V2 = `
  id, seller_id, title, description, category, subcategory,
  condition, condition_notes, price, buy_now_price, listing_type,
  status, auction_end, current_bid, bid_count,
  ships_from_state, shipping_cost, free_shipping, lipo_hazmat,
  view_count, created_at, updated_at,
  listing_images (id, url, position, is_primary)
`;

/** Fetch username + avatar for a set of user IDs (no FK needed). */
async function fetchSellerMap(sellerIds: string[]): Promise<Record<string, { id: string; username: string; avatar_url: string | null }>> {
  if (!sellerIds.length) return {};
  const { data } = await supabase
    .from('users')
    .select('id, username, avatar_url')
    .in('id', sellerIds);
  const map: Record<string, any> = {};
  (data ?? []).forEach((u: any) => { map[u.id] = u; });
  return map;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

// ── base64 → Uint8Array helper (bypasses Hermes Blob bugs in RN 0.81) ────────

async function uriToUint8Array(uri: string): Promise<Uint8Array> {
  const b64 = await (FileSystem as any).readAsStringAsync(uri, { encoding: 'base64' });
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

export function useMarketplace(currentUserId?: string) {
  const [listings, setListings]       = useState<MarketplaceListing[]>([]);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore]         = useState(true);
  const [page, setPage]               = useState(0);
  const [watchlist, setWatchlist]     = useState<Set<string>>(new Set());
  const [filters, setFiltersState]    = useState<MarketplaceFilters>({});

  // ── Fetch watchlist IDs ────────────────────────────────────────────────────
  const fetchWatchlist = useCallback(async () => {
    if (!currentUserId) return;
    const { data } = await supabase
      .from('listing_watchlist')
      .select('listing_id')
      .eq('user_id', currentUserId);
    if (data) setWatchlist(new Set(data.map((r: any) => r.listing_id)));
  }, [currentUserId]);

  // ── Build query with filters ───────────────────────────────────────────────
  const buildQuery = useCallback((fromPage: number, activeFilters: MarketplaceFilters) => {
    let q = supabase
      .from('marketplace_listings')
      .select(LISTING_SELECT_V2)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .range(fromPage * PAGE_SIZE, fromPage * PAGE_SIZE + PAGE_SIZE - 1);

    if (activeFilters.category)   q = q.eq('category', activeFilters.category);
    if (activeFilters.condition)  q = q.eq('condition', activeFilters.condition);
    if (activeFilters.minPrice)   q = q.gte('price', activeFilters.minPrice);
    if (activeFilters.maxPrice)   q = q.lte('price', activeFilters.maxPrice);
    if (activeFilters.freeShipping) q = q.eq('free_shipping', true);
    if (activeFilters.searchQuery?.trim()) {
      q = q.ilike('title', `%${activeFilters.searchQuery.trim()}%`);
    }
    return q;
  }, []);

  // ── Normalize raw row ──────────────────────────────────────────────────────
  const normalize = useCallback((
    raw: any,
    watchSet: Set<string>,
    sellerMap: Record<string, any> = {},
  ): MarketplaceListing => {
    const sellerInfo = sellerMap[raw.seller_id] ?? null;
    return {
      ...raw,
      listing_images: (raw.listing_images ?? []).sort((a: any, b: any) => a.position - b.position),
      seller: sellerInfo
        ? { id: sellerInfo.id, username: sellerInfo.username, avatar_url: sellerInfo.avatar_url }
        : null,
      is_watched: watchSet.has(raw.id),
    };
  }, []);

  // ── Initial / refresh load ─────────────────────────────────────────────────
  const loadListings = useCallback(async (activeFilters: MarketplaceFilters = {}) => {
    setLoading(true);
    setPage(0);
    setHasMore(true);

    const [{ data, error }, wl] = await Promise.all([
      buildQuery(0, activeFilters),
      currentUserId ? supabase
        .from('listing_watchlist')
        .select('listing_id')
        .eq('user_id', currentUserId) : Promise.resolve({ data: [] }),
    ]);

    const wlSet = new Set<string>(
      ((wl as any)?.data ?? []).map((r: any) => r.listing_id)
    );
    setWatchlist(wlSet);

    if (error) {
      console.error('[useMarketplace] loadListings error:', JSON.stringify(error));
      // If join failed (e.g. missing FK) try a bare query without embedded user join
      if (error.code === 'PGRST200' || error.message?.includes('could not find')) {
        const { data: bare, error: bareErr } = await supabase
          .from('marketplace_listings')
          .select('id, seller_id, title, description, category, subcategory, condition, condition_notes, price, buy_now_price, listing_type, status, auction_end, current_bid, bid_count, ships_from_state, shipping_cost, free_shipping, lipo_hazmat, view_count, created_at, updated_at, listing_images (id, url, position, is_primary)')
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .range(0, PAGE_SIZE - 1);
        if (!bareErr && bare) {
          const bareSellerIds = [...new Set(bare.map((r: any) => r.seller_id).filter(Boolean))];
          const bareSellerMap = await fetchSellerMap(bareSellerIds);
          const normalized = bare.map((r: any) => normalize(r, wlSet, bareSellerMap));
          setListings(normalized);
          if (bare.length < PAGE_SIZE) setHasMore(false);
        } else {
          console.error('[useMarketplace] bare fallback error:', JSON.stringify(bareErr));
        }
      }
    } else if (data) {
      const sellerIds = [...new Set(data.map((r: any) => r.seller_id).filter(Boolean))];
      const sellerMap = await fetchSellerMap(sellerIds);
      const normalized = data.map((r: any) => normalize(r, wlSet, sellerMap));
      setListings(normalized);
      if (data.length < PAGE_SIZE) setHasMore(false);
    }
    setLoading(false);
    setRefreshing(false);
  }, [buildQuery, normalize, currentUserId]);

  // ── Load more ──────────────────────────────────────────────────────────────
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const nextPage = page + 1;
    const { data, error } = await buildQuery(nextPage, filters);
    if (!error && data && data.length > 0) {
      const moreSellerIds = [...new Set(data.map((r: any) => r.seller_id).filter(Boolean))];
      const moreSellerMap = await fetchSellerMap(moreSellerIds);
      const normalized = data.map((r: any) => normalize(r, watchlist, moreSellerMap));
      setListings(prev => {
        const ids = new Set(prev.map(l => l.id));
        return [...prev, ...normalized.filter(l => !ids.has(l.id))];
      });
      setPage(nextPage);
      if (data.length < PAGE_SIZE) setHasMore(false);
    } else {
      setHasMore(false);
    }
    setLoadingMore(false);
  }, [loadingMore, hasMore, page, filters, buildQuery, normalize, watchlist]);

  // ── Apply filters ──────────────────────────────────────────────────────────
  const applyFilters = useCallback((newFilters: MarketplaceFilters) => {
    setFiltersState(newFilters);
    loadListings(newFilters);
  }, [loadListings]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadListings(filters);
  }, [loadListings, filters]);

  // ── Toggle watchlist ───────────────────────────────────────────────────────
  const toggleWatch = useCallback(async (listingId: string) => {
    if (!currentUserId) return;
    const isWatched = watchlist.has(listingId);
    // Optimistic
    setWatchlist(prev => {
      const next = new Set(prev);
      isWatched ? next.delete(listingId) : next.add(listingId);
      return next;
    });
    setListings(prev => prev.map(l =>
      l.id === listingId ? { ...l, is_watched: !isWatched } : l
    ));
    if (isWatched) {
      await supabase.from('listing_watchlist')
        .delete()
        .eq('user_id', currentUserId)
        .eq('listing_id', listingId);
    } else {
      await supabase.from('listing_watchlist')
        .insert({ user_id: currentUserId, listing_id: listingId });
    }
  }, [currentUserId, watchlist]);

  // ── Create listing ─────────────────────────────────────────────────────────
  const createListing = useCallback(async (params: CreateListingParams) => {
    if (!currentUserId) return { ok: false, error: 'Not logged in' };

    const { imageUris, ...rest } = params;

    // Upsert seller profile row
    await supabase.from('seller_profiles')
      .upsert({ user_id: currentUserId }, { onConflict: 'user_id', ignoreDuplicates: true });

    const { data: listing, error } = await supabase
      .from('marketplace_listings')
      .insert({ ...rest, seller_id: currentUserId, status: 'active' })
      .select('id')
      .single();

    if (error || !listing) return { ok: false, error: error?.message ?? 'Failed to create listing' };

    // ── Upload images ────────────────────────────────────────────────
    let imagesUploaded = 0;
    let imageError: string | null = null;

    if (imageUris?.length) {
      const imageRows: { listing_id: string; url: string; position: number; is_primary: boolean }[] = [];

      for (let i = 0; i < imageUris.length; i++) {
        const uri = imageUris[i];
        try {
          // Normalise extension: heic/heif → jpeg
          const rawExt = (uri.split('.').pop()?.split('?')[0] ?? 'jpg').toLowerCase();
          const ext    = (rawExt === 'heic' || rawExt === 'heif') ? 'jpeg' : rawExt;
          const mime   = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
          const path   = `marketplace/${listing.id}/${Date.now()}_${i}.${ext}`;

          // Read as base64, then convert via data-URI fetch → Blob.
          // This is the most reliable path in React Native / Hermes:
          const blob = await uriToUint8Array(uri);

          const { error: upErr } = await supabase.storage
            .from('media')
            .upload(path, blob, { contentType: mime, upsert: true });

          if (upErr) {
            console.warn(`[marketplace] upload error image ${i}:`, upErr.message);
            imageError = upErr.message;
          } else {
            const { data: urlData } = supabase.storage.from('media').getPublicUrl(path);
            if (urlData?.publicUrl) {
              imageRows.push({
                listing_id: listing.id,
                url:        urlData.publicUrl,
                position:   i,
                is_primary: i === 0,
              });
              imagesUploaded++;
            }
          }
        } catch (e: any) {
          console.warn(`[marketplace] image ${i} error:`, e?.message ?? e);
          imageError = e?.message ?? 'Upload failed';
        }
      }

      if (imageRows.length) {
        const { error: imgErr } = await supabase.from('listing_images').insert(imageRows);
        if (imgErr) {
          console.warn('[marketplace] listing_images insert error:', imgErr.message);
          imageError = imgErr.message;
          imagesUploaded = 0; // row not saved
        }
      }
    }

    return {
      ok: true,
      listingId: listing.id,
      imagesUploaded,
      imageError,
    };
  }, [currentUserId]);

  // ── Delete listing ─────────────────────────────────────────────────────────
  const deleteListing = useCallback(async (listingId: string) => {
    if (!currentUserId) return { ok: false };
    const { error } = await supabase
      .from('marketplace_listings')
      .update({ status: 'cancelled' })
      .eq('id', listingId)
      .eq('seller_id', currentUserId);
    if (!error) {
      setListings(prev => prev.filter(l => l.id !== listingId));
    }
    return { ok: !error };
  }, [currentUserId]);

  // ── Initial load ───────────────────────────────────────────────────────────
  useEffect(() => { loadListings({}); }, []);

  return {
    listings,
    loading,
    refreshing,
    loadingMore,
    hasMore,
    watchlist,
    filters,
    loadListings,
    loadMore,
    applyFilters,
    onRefresh,
    toggleWatch,
    createListing,
    deleteListing,
  };
}

// ─── Featured listings hook ───────────────────────────────────────────────────

export interface FeaturedListing extends MarketplaceListing {
  is_featured: true;
  featured_until: string;
}

export const FEATURED_PROPS_COST = 4_800;   // must match SQL constant
export const FEATURED_PAID_TIERS = [
  { hours: 24,  label: '24 hours',  price_usd: 4.99  },
  { hours: 72,  label: '3 days',    price_usd: 9.99  },
  { hours: 168, label: '7 days',    price_usd: 19.99 },
] as const;

export function useFeaturedListings() {
  const [featured, setFeatured]   = useState<FeaturedListing[]>([]);
  const [loading,  setLoading]    = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('marketplace_listings')
      .select(`
        id, seller_id, title, description, category, condition, price,
        buy_now_price, listing_type, status, current_bid, bid_count,
        ships_from_state, free_shipping, lipo_hazmat, view_count,
        is_featured, featured_until, featured_type, created_at, updated_at,
        listing_images (id, url, position, is_primary)
      `)
      .eq('is_featured', true)
      .eq('status', 'active')
      .gt('featured_until', new Date().toISOString())
      .order('featured_until', { ascending: false })
      .limit(20);

    if (data) {
      const sellerIds = [...new Set(data.map((r: any) => r.seller_id).filter(Boolean))] as string[];
      const sellerMap = await fetchSellerMap(sellerIds);
      const normalized = data.map((raw: any) => {
        const s = sellerMap[raw.seller_id] ?? null;
        return {
          ...raw,
          listing_images: (raw.listing_images ?? []).sort((a: any, b: any) => a.position - b.position),
          seller: s ? { id: s.id, username: s.username, avatar_url: s.avatar_url } : null,
        } as FeaturedListing;
      });
      setFeatured(normalized);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, []);

  // Spend props to feature a listing for 24 hours
  const spendPropsForFeatured = useCallback(async (listingId: string, userId: string) => {
    const { data, error } = await supabase
      .rpc('spend_props_for_featured', {
        p_listing_id: listingId,
        p_user_id:    userId,
      });
    if (error) return { ok: false, error: error.message };
    if (!data?.ok) return { ok: false, error: data?.error ?? 'unknown' };
    await load(); // refresh carousel
    return { ok: true, endsAt: data.ends_at };
  }, [load]);

  return { featured, loading, reload: load, spendPropsForFeatured };
}
