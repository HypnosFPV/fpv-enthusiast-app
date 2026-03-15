// src/hooks/useListingDetail.ts
// Fetches a single listing, increments view count, handles watch toggle,
// and provides the buyer↔seller message thread for that listing.

import { useState, useEffect, useCallback, useRef } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../services/supabase';
import { sendMarketplaceNotification } from '../utils/marketplaceNotifications';
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

// ─── Offer ────────────────────────────────────────────────────────────────────
export interface MarketplaceOffer {
  id:                   string;
  listing_id:           string;
  buyer_id:             string;
  seller_id:            string;
  amount_cents:         number;
  note?:                string | null;
  status:               'pending' | 'accepted' | 'declined' | 'expired' | 'cancelled' | 'countered';
  counter_amount_cents?: number | null;
  order_id?:            string | null;
  created_at:           string;
  updated_at:           string;
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

export function useListingDetail(listingId: string, currentUserId?: string) {
  const [listing,      setListing]      = useState<MarketplaceListing | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [isWatched,    setIsWatched]    = useState(false);
  const [messages,     setMessages]     = useState<ListingMessage[]>([]);
  const [messagesLoad, setMessagesLoad] = useState(false);
  const [sending,      setSending]      = useState(false);
  const [activeOrder,  setActiveOrder]  = useState<ListingOrder | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const [offers,       setOffers]       = useState<MarketplaceOffer[]>([]);

  // ── Fetch listing ─────────────────────────────────────────────────────────
  const fetchListing = useCallback(async () => {
    if (!listingId) return;
    // Only show the full loading skeleton on the very first load.
    // Background refreshes must NOT call setLoading(true) as it causes
    // the rapid "vibrating" flicker on the listing detail screen.
    setLoading(prev => (prev ? true : false));

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

      // Generate signed URLs (1-year expiry) so images work regardless of bucket public setting
      const rawImages: any[] = ((data as any).listing_images ?? [])
        .sort((a: any, b: any) => a.position - b.position);

      let signedImages = rawImages;
      if (rawImages.length > 0) {
        try {
          // Extract storage paths from the stored public URLs
          const paths = rawImages.map((img: any) => {
            const m = img.url.match(/\/object\/(?:public|sign)\/media\/(.+?)(?:\?|$)/);
            const extracted = m ? m[1] : null;
            return extracted ?? img.url;
          });

          const { data: signed, error: signErr2 } = await supabase.storage
            .from('media')
            .createSignedUrls(paths, 60 * 60 * 24 * 365); // 1 year

          if (signed && signed.length === rawImages.length) {
            signedImages = rawImages.map((img: any, i: number) => ({
              ...img,
              url: signed[i]?.signedUrl ?? img.url,
            }));
          }
        } catch (signErr: any) {
          console.warn('[useListingDetail] signed URL error:', signErr?.message);
        }
      }

      const normalized: MarketplaceListing = {
        ...(data as any),
        listing_images: signedImages,
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
      .or(`buyer_id.eq.${currentUserId},seller_id.eq.${currentUserId}`)
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

  const sendMessage = useCallback(async (body: string, sellerId: string, buyerIdOverride?: string): Promise<boolean> => {
    if (!currentUserId || !body.trim()) return false;
    setSending(true);
    const isbuyer  = currentUserId !== sellerId;
    // If seller is replying, use buyerIdOverride (derived from existing thread)
    const buyerId  = isbuyer
      ? currentUserId
      : (buyerIdOverride ?? listing?.seller_id ?? sellerId);
    const { error } = await supabase.from('marketplace_messages').insert({
      listing_id: listingId,
      sender_id:  currentUserId,
      buyer_id:   isbuyer ? currentUserId : buyerId,
      seller_id:  sellerId,
      body:       body.trim(),
    });
    if (error) {
      console.warn('[sendMessage] insert error:', error.message, error.code);
    } else {
      // Fallback refresh in case realtime is slow / not connected
      await fetchMessages();
      // Notify the other party (fire-and-forget)
      if (currentUserId !== sellerId) {
        // Buyer sent message → notify seller
        sendMarketplaceNotification({
          recipientId:  sellerId,
          actorId:      currentUserId,
          type:         'new_message',
          listingId:    listingId,
          listingTitle: listing?.title ?? 'listing',
        });
      }
    }
    setSending(false);
    return !error;
  }, [currentUserId, listingId, listing?.seller_id, fetchMessages]);

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
    fetchOffers();
    subscribeMessages();
    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  // Pin to primitive IDs only — callback refs in deps caused the whole effect
  // (including fetchListing) to re-fire on every render, producing flicker.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingId, currentUserId]);

  // ── Add photos to an existing listing (owner only) ────────────────────
  const addPhotos = useCallback(async (
    imageUris: string[],
    currentUserId: string,
  ): Promise<{ ok: boolean; uploaded: number; error?: string }> => {
    if (!listingId || !imageUris.length) return { ok: false, uploaded: 0, error: 'No images' };

    // Find the current highest position so new photos append after existing ones
    const existingCount = listing?.listing_images?.length ?? 0;
    const imageRows: { listing_id: string; url: string; position: number; is_primary: boolean }[] = [];
    let lastError: string | undefined;

    for (let i = 0; i < imageUris.length; i++) {
      const uri = imageUris[i];
      try {
        const rawExt = (uri.split('.').pop()?.split('?')[0] ?? 'jpg').toLowerCase();
        const ext    = (rawExt === 'heic' || rawExt === 'heif') ? 'jpeg' : rawExt;
        const mime   = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
        const path   = `marketplace/${listingId}/${Date.now()}_${existingCount + i}.${ext}`;

        const blob      = await uriToUint8Array(uri);

        const { error: upErr } = await supabase.storage
          .from('media')
          .upload(path, blob, { contentType: mime, upsert: true });

        if (upErr) {
          console.warn('[addPhotos] storage error:', upErr.message);
          lastError = upErr.message;
        } else {
          const { data: urlData } = supabase.storage.from('media').getPublicUrl(path);
          if (urlData?.publicUrl) {
            imageRows.push({
              listing_id: listingId,
              url:        urlData.publicUrl,
              position:   existingCount + i,
              is_primary: existingCount === 0 && i === 0,
            });
          }
        }
      } catch (e: any) {
        console.warn('[addPhotos] error:', e?.message);
        lastError = e?.message ?? 'Upload failed';
      }
    }

    if (!imageRows.length) return { ok: false, uploaded: 0, error: lastError ?? 'All uploads failed' };

    const { error: dbErr } = await supabase.from('listing_images').insert(imageRows);
    if (dbErr) {
      console.warn('[addPhotos] DB insert error:', dbErr.message);
      return { ok: false, uploaded: 0, error: dbErr.message };
    }

    // Refresh listing so gallery updates immediately
    await fetchListing();
    return { ok: true, uploaded: imageRows.length };
  }, [listingId, listing?.listing_images?.length, fetchListing]);

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

  // ── Update listing fields (owner only) ──────────────────────────────────
  const updateListing = useCallback(async (fields: {
    title?: string;
    description?: string;
    price?: number;
    condition?: string;
    condition_notes?: string;
    ships_from_state?: string;
    shipping_cost?: number;
    free_shipping?: boolean;
  }): Promise<{ ok: boolean; error?: string }> => {
    if (!listingId) return { ok: false, error: 'No listing' };
    const { error } = await supabase
      .from('marketplace_listings')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', listingId);
    if (error) return { ok: false, error: error.message };
    await fetchListing();
    return { ok: true };
  }, [listingId, fetchListing]);

  // ── Delete a single photo (owner only) ───────────────────────────────────
  const deletePhoto = useCallback(async (
    imageId: string,
    imageUrl: string,
  ): Promise<{ ok: boolean; error?: string }> => {
    // Extract storage path from URL
    const m = imageUrl.match(/\/object\/(?:public|sign)\/media\/(.+?)(?:\?|$)/);
    const storagePath = m ? m[1] : null;

    // Delete from DB first
    const { error: dbErr } = await supabase
      .from('listing_images')
      .delete()
      .eq('id', imageId);
    if (dbErr) return { ok: false, error: dbErr.message };

    // Delete from storage (best-effort, don't fail if missing)
    if (storagePath) {
      await supabase.storage.from('media').remove([storagePath]);
    }

    await fetchListing();
    return { ok: true };
  }, [fetchListing]);

  // ── Submit a buyer review for a completed order ────────────────────────────
  const submitReview = useCallback(async (
    orderId: string,
    rating: number,
    comment: string,
  ): Promise<{ ok: boolean; error?: string }> => {
    if (!orderId) return { ok: false, error: 'No order' };

    // Need the seller_id from the active order
    const { data: order, error: orderErr } = await supabase
      .from('marketplace_orders')
      .select('seller_id, status, buyer_id')
      .eq('id', orderId)
      .maybeSingle();

    if (orderErr || !order) return { ok: false, error: 'Order not found' };
    if (!['delivered', 'completed'].includes(order.status))
      return { ok: false, error: 'Order not yet delivered' };

    const { error } = await supabase.from('marketplace_reviews').insert({
      order_id:    orderId,
      reviewer_id: order.buyer_id,
      seller_id:   order.seller_id,
      rating,
      comment:     comment || null,
    });

    if (error) {
      // UNIQUE violation = already reviewed
      if (error.code === '23505') return { ok: false, error: 'already_reviewed' };
      return { ok: false, error: error.message };
    }

    // Refresh listing to pick up updated avg_rating on seller card
    await fetchListing();
    return { ok: true };
  }, [fetchListing]);


  // ── Offers ────────────────────────────────────────────────────────────────
  const fetchOffers = useCallback(async () => {
    if (!currentUserId || !listingId) return;
    const { data } = await supabase
      .from('marketplace_offers')
      .select('*')
      .eq('listing_id', listingId)
      .or(`buyer_id.eq.${currentUserId},seller_id.eq.${currentUserId}`)
      .order('created_at', { ascending: false });
    if (data) setOffers(data as MarketplaceOffer[]);
  }, [currentUserId, listingId]);

  const sendOffer = useCallback(async (
    sellerId: string,
    amountCents: number,
    note: string,
  ): Promise<{ ok: boolean; error?: string }> => {
    if (!currentUserId || !listingId) return { ok: false, error: 'Not logged in' };

    // 0. Block duplicate pending offers from same buyer
    const { data: existing } = await supabase
      .from('marketplace_offers')
      .select('id')
      .eq('listing_id', listingId)
      .eq('buyer_id', currentUserId)
      .eq('status', 'pending')
      .limit(1)
      .maybeSingle();
    if (existing) {
      return { ok: false, error: 'You already have a pending offer on this listing. Wait for the seller to respond before sending another.' };
    }

    // 1. Insert into marketplace_offers
    const { data: offerData, error: offerErr } = await supabase
      .from('marketplace_offers')
      .insert({
        listing_id:   listingId,
        buyer_id:     currentUserId,
        seller_id:    sellerId,
        amount_cents: amountCents,
        note:         note || null,
      })
      .select()
      .single();

    if (offerErr || !offerData) {
      console.warn('[sendOffer] insert error:', offerErr?.message, offerErr?.code);
      return { ok: false, error: offerErr?.message ?? 'Failed to create offer' };
    }

    // 2. Also send as a special message so it appears in the thread
    const msgBody = JSON.stringify({
      amount_cents: amountCents,
      note:         note || undefined,
      offer_id:     (offerData as any).id,
      status:       'pending',
    });
    await supabase.from('marketplace_messages').insert({
      listing_id: listingId,
      sender_id:  currentUserId,
      buyer_id:   currentUserId,
      seller_id:  sellerId,
      body:       `__OFFER__:${msgBody}`,
    });

    await fetchOffers();
    await fetchMessages();
    // Notify seller of new offer (fire-and-forget)
    sendMarketplaceNotification({
      recipientId:  sellerId,
      actorId:      currentUserId!,
      type:         'new_offer',
      listingId:    listingId,
      listingTitle: listing?.title ?? 'listing',
      extraMessage: `$${(amountCents / 100).toFixed(2)}`,
    });
    return { ok: true };
  }, [currentUserId, listingId, fetchOffers, fetchMessages]);

  const acceptOffer = useCallback(async (offerId: string): Promise<{ ok: boolean; error?: string } | null> => {
    const { data, error } = await supabase.rpc('accept_offer', { p_offer_id: offerId });
    if (!error && (data as any)?.ok) {
      await fetchOffers();
      await fetchOrder();
      // Update status in messages
      setMessages(prev => prev.map(m => {
        if (!m.body?.startsWith('__OFFER__:')) return m;
        try {
          const d = JSON.parse(m.body.slice(10));
          if (d.offer_id === offerId) {
            return { ...m, body: `__OFFER__:${JSON.stringify({ ...d, status: 'accepted' })}` };
          }
        } catch {}
        return m;
      }));
    }
    if (!error && (data as any)?.ok) {
      // Notify buyer that offer was accepted
      const accepted = offers.find(o => o.id === offerId);
      if (accepted && listingId) {
        sendMarketplaceNotification({
          recipientId:  accepted.buyer_id,
          actorId:      accepted.seller_id,
          type:         'offer_accepted',
          listingId:    listingId,
          listingTitle: listing?.title ?? 'listing',
          extraMessage: `$${(accepted.amount_cents / 100).toFixed(2)}`,
        });
      }
    }
    return data as { ok: boolean; error?: string } | null;
  }, [fetchOffers, fetchOrder, offers, listingId, listing?.title]);

  const declineOffer = useCallback(async (offerId: string): Promise<{ ok: boolean; error?: string } | null> => {
    const { data, error } = await supabase.rpc('decline_offer', { p_offer_id: offerId });
    if (!error && (data as any)?.ok) {
      await fetchOffers();
      setMessages(prev => prev.map(m => {
        if (!m.body?.startsWith('__OFFER__:')) return m;
        try {
          const d = JSON.parse(m.body.slice(10));
          if (d.offer_id === offerId) {
            return { ...m, body: `__OFFER__:${JSON.stringify({ ...d, status: 'declined' })}` };
          }
        } catch {}
        return m;
      }));
    }
    if (!error && (data as any)?.ok) {
      // Notify buyer that offer was declined
      const declined = offers.find(o => o.id === offerId);
      if (declined && listingId) {
        sendMarketplaceNotification({
          recipientId:  declined.buyer_id,
          actorId:      declined.seller_id,
          type:         'offer_declined',
          listingId:    listingId,
          listingTitle: listing?.title ?? 'listing',
          extraMessage: `$${(declined.amount_cents / 100).toFixed(2)}`,
        });
      }
    }
    return data as { ok: boolean; error?: string } | null;
  }, [fetchOffers, offers, listingId, listing?.title]);

  // ── Counter-offer ─────────────────────────────────────────────────────────
  const counterOffer = useCallback(async (
    offerId: string,
    counterCents: number,
  ): Promise<{ ok: boolean; error?: string } | null> => {
    const { data, error } = await supabase.rpc('counter_offer', {
      p_offer_id:      offerId,
      p_counter_cents: counterCents,
    });
    if (!error && (data as any)?.ok) {
      await fetchOffers();
      // Update message body to reflect countered status
      setMessages(prev => prev.map(m => {
        if (!m.body?.startsWith('__OFFER__:')) return m;
        try {
          const d = JSON.parse(m.body.slice(10));
          if (d.offer_id === offerId) {
            return { ...m, body: `__OFFER__:${JSON.stringify({ ...d, status: 'countered', counter_amount_cents: counterCents })}` };
          }
        } catch {}
        return m;
      }));
      // Notify buyer of counter-offer
      const countered = offers.find(o => o.id === offerId);
      if (countered && listingId) {
        sendMarketplaceNotification({
          recipientId:  countered.buyer_id,
          actorId:      countered.seller_id,
          type:         'offer_countered',
          listingId:    listingId,
          listingTitle: listing?.title ?? 'listing',
          extraMessage: `$${(counterCents / 100).toFixed(2)}`,
        });
      }
    }
    return data as { ok: boolean; error?: string } | null;
  }, [fetchOffers, offers, listingId, listing?.title]);

  return {
    listing, loading, fetchListing,
    isWatched, toggleWatch,
    messages, messagesLoad, sendMessage, sending,
    activeOrder, fetchOrder,
    markShipped, confirmReceipt,
    submitReview,
    addPhotos,
    updateListing,
    deletePhoto,
    offers, sendOffer, acceptOffer, declineOffer, counterOffer,
  };
}
