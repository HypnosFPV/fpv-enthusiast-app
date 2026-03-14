// src/hooks/useListingDetail.ts
// Fetches a single listing, increments view count, handles watch toggle,
// and provides the buyer↔seller message thread for that listing.

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../services/supabase';
import type { MarketplaceListing } from './useMarketplace';

// ─── Message thread ────────────────────────────────────────────────────────────
export interface ListingMessage {
  id:         string;
  sender_id:  string;
  buyer_id:   string;
  seller_id:  string;
  body:       string;
  read:       boolean;
  created_at: string;
  sender?: { username: string | null; avatar_url: string | null } | null;
}

// ─── Order (buyer view) ────────────────────────────────────────────────────────
export interface ListingOrder {
  id:               string;
  listing_id:       string;
  buyer_id:         string;
  seller_id:        string;
  amount_cents:     number;
  platform_fee_cents: number;
  seller_payout_cents: number;
  status:           string;
  tracking_number?: string | null;
  carrier?:         string | null;
  shipped_at?:      string | null;
  delivered_at?:    string | null;
  auto_release_at?: string | null;
  created_at:       string;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useListingDetail(listingId: string, currentUserId?: string) {
  const [listing,      setListing]      = useState<MarketplaceListing | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [isWatched,    setIsWatched]    = useState(false);
  const [messages,     setMessages]     = useState<ListingMessage[]>([]);
  const [messagesLoad, setMessagesLoad] = useState(false);
  const [sending,      setSending]      = useState(false);
  const [activeOrder,  setActiveOrder]  = useState<ListingOrder | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // ── Fetch listing ─────────────────────────────────────────────────────────
  const fetchListing = useCallback(async () => {
    if (!listingId) return;
    setLoading(true);

    const { data, error } = await supabase
      .from('marketplace_listings')
      .select(`
        id, seller_id, title, description, category, subcategory,
        condition, condition_notes, price, buy_now_price, listing_type,
        status, auction_end, current_bid, bid_count,
        ships_from_state, shipping_cost, free_shipping, lipo_hazmat,
        view_count, created_at, updated_at,
        listing_images (id, url, position, is_primary)
      `)
      .eq('id', listingId)
      .maybeSingle();

    // Log the error so it’s visible in dev if the query itself fails
    if (error) console.warn('[useListingDetail] fetchListing error:', error.message, 'id:', listingId);

    if (!error && data) {
      // Fetch seller user + profile in a single separate query (no FK join needed)
      const sellerId: string = (data as any).seller_id;
      let seller: MarketplaceListing['seller'] = null;
      if (sellerId) {
        const [{ data: uData }, { data: spData }] = await Promise.all([
          supabase.from('users').select('id, username, avatar_url').eq('id', sellerId).single(),
          supabase.from('seller_profiles').select('avg_rating, total_sales, verification_tier, stripe_onboarded').eq('user_id', sellerId).single(),
        ]);
        if (uData) {
          seller = {
            id:                uData.id,
            username:          uData.username,
            avatar_url:        uData.avatar_url,
            avg_rating:        spData?.avg_rating        ?? undefined,
            total_sales:       spData?.total_sales       ?? undefined,
            verification_tier: spData?.verification_tier ?? undefined,
          };
        }
      }

      const normalized: MarketplaceListing = {
        ...(data as any),
        listing_images: ((data as any).listing_images ?? [])
          .sort((a: any, b: any) => a.position - b.position),
        seller,
        is_watched: false, // updated below
      };
      setListing(normalized);

      // Increment view count (fire-and-forget)
      supabase.rpc('increment_listing_views', { p_listing_id: listingId }).then(() => {});
    }

    setLoading(false);
  }, [listingId]);

  // ── Watchlist status ──────────────────────────────────────────────────────
  const fetchWatchStatus = useCallback(async () => {
    if (!currentUserId || !listingId) return;
    const { data } = await supabase
      .from('listing_watchlist')
      .select('listing_id')
      .eq('user_id', currentUserId)
      .eq('listing_id', listingId)
      .maybeSingle();
    setIsWatched(!!data);
  }, [currentUserId, listingId]);

  const toggleWatch = useCallback(async () => {
    if (!currentUserId) return;
    const next = !isWatched;
    setIsWatched(next);
    if (next) {
      await supabase.from('listing_watchlist')
        .insert({ user_id: currentUserId, listing_id: listingId });
    } else {
      await supabase.from('listing_watchlist')
        .delete()
        .eq('user_id', currentUserId)
        .eq('listing_id', listingId);
    }
  }, [currentUserId, listingId, isWatched]);

  // ── Active order ──────────────────────────────────────────────────────────
  const fetchOrder = useCallback(async () => {
    if (!currentUserId || !listingId) return;
    const { data } = await supabase
      .from('marketplace_orders')
      .select('*')
      .eq('listing_id', listingId)
      .in('status', ['pending','paid','shipped','delivered'])
      .or(`buyer_id.eq.${currentUserId},seller_id.eq.${currentUserId}`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) setActiveOrder(data as ListingOrder);
  }, [currentUserId, listingId]);

  // ── Messages ──────────────────────────────────────────────────────────────
  const fetchMessages = useCallback(async () => {
    if (!currentUserId || !listingId) return;
    setMessagesLoad(true);
    const { data } = await supabase
      .from('marketplace_messages')
      .select(`
        id, sender_id, buyer_id, seller_id, body, read, created_at,
        sender:sender_id ( username, avatar_url )
      `)
      .eq('listing_id', listingId)
      .or(
        `and(buyer_id.eq.${currentUserId}),and(seller_id.eq.${currentUserId})`
      )
      .order('created_at', { ascending: true })
      .limit(100);
    setMessages((data ?? []) as ListingMessage[]);

    // Mark unread messages from other party as read
    const unreadIds = ((data ?? []) as ListingMessage[])
      .filter(m => !m.read && m.sender_id !== currentUserId)
      .map(m => m.id);
    if (unreadIds.length) {
      await supabase
        .from('marketplace_messages')
        .update({ read: true })
        .in('id', unreadIds);
    }
    setMessagesLoad(false);
  }, [currentUserId, listingId]);

  const sendMessage = useCallback(async (body: string, sellerId: string): Promise<boolean> => {
    if (!currentUserId || !body.trim()) return false;
    setSending(true);
    const isbuyer = currentUserId !== sellerId;
    const buyerId  = isbuyer ? currentUserId : listing?.seller_id ?? sellerId;
    const { error } = await supabase.from('marketplace_messages').insert({
      listing_id: listingId,
      sender_id:  currentUserId,
      buyer_id:   isbuyer ? currentUserId : buyerId,
      seller_id:  sellerId,
      body:       body.trim(),
    });
    setSending(false);
    return !error;
  }, [currentUserId, listingId, listing?.seller_id]);

  // ── Realtime: subscribe to new messages ───────────────────────────────────
  const subscribeMessages = useCallback(() => {
    if (!currentUserId || !listingId) return;
    channelRef.current = supabase
      .channel(`listing_msgs_${listingId}_${currentUserId}`)
      .on('postgres_changes', {
        event:  'INSERT',
        schema: 'public',
        table:  'marketplace_messages',
        filter: `listing_id=eq.${listingId}`,
      }, payload => {
        const msg = payload.new as ListingMessage;
        // Only append if it belongs to our thread
        if (msg.buyer_id === currentUserId || msg.seller_id === currentUserId) {
          setMessages(prev => {
            if (prev.some(m => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
          // Auto-mark as read if from other party
          if (msg.sender_id !== currentUserId) {
            supabase.from('marketplace_messages')
              .update({ read: true })
              .eq('id', msg.id)
              .then(() => {});
          }
        }
      })
      .subscribe();
  }, [currentUserId, listingId]);

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchListing();
    fetchWatchStatus();
    fetchOrder();
    fetchMessages();
    subscribeMessages();
    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [fetchListing, fetchWatchStatus, fetchOrder, fetchMessages, subscribeMessages]);

  // ── mark_shipped / confirm_receipt helpers ────────────────────────────────
  const markShipped = useCallback(async (orderId: string, trackingNumber: string, carrier?: string) => {
    const { data, error } = await supabase.rpc('mark_shipped', {
      p_order_id:        orderId,
      p_tracking_number: trackingNumber,
      p_carrier:         carrier ?? null,
    });
    if (!error && (data as any)?.ok) {
      setActiveOrder(prev => prev ? { ...prev, status: 'shipped', tracking_number: trackingNumber } : prev);
    }
    return data as { ok: boolean; error?: string } | null;
  }, []);

  const confirmReceipt = useCallback(async (orderId: string) => {
    const { data, error } = await supabase.rpc('confirm_receipt', { p_order_id: orderId });
    if (!error && (data as any)?.ok) {
      setActiveOrder(prev => prev ? { ...prev, status: 'delivered' } : prev);
      setListing(prev => prev ? { ...prev, status: 'sold' } : prev);
    }
    return data as { ok: boolean; error?: string } | null;
  }, []);

  return {
    listing, loading, fetchListing,
    isWatched, toggleWatch,
    messages, messagesLoad, sendMessage, sending,
    activeOrder, fetchOrder,
    markShipped, confirmReceipt,
  };
}
